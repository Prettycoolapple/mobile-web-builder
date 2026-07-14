/** Idempotent migration for LIM/title offers, agent phone claims and SMS audit. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function findWorkspaceRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

const root = findWorkspaceRoot(__dirname);
for (const envPath of [
  path.join(root, ".env"),
  path.join(root, "lib", "db", ".env"),
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}
for (const envPath of [
  path.join(root, ".env.local"),
  path.join(root, "lib", "db", ".env.local"),
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });
}

if (!process.env.DATABASE_URL?.trim())
  throw new Error("DATABASE_URL is not set");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS listing_agent_targets (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number text NOT NULL,
      agent_name text,
      agency_name text,
      source text,
      source_listing_url text,
      matched_agent_user_id text REFERENCES profiles(id) ON DELETE SET NULL,
      opted_out_at timestamptz,
      opt_out_keyword text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS listing_agent_targets_phone_unique
      ON listing_agent_targets(phone_number);
    CREATE INDEX IF NOT EXISTS listing_agent_targets_matched_agent_idx
      ON listing_agent_targets(matched_agent_user_id);

    CREATE TABLE IF NOT EXISTS lim_title_requests (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      agent_target_id text NOT NULL REFERENCES listing_agent_targets(id) ON DELETE RESTRICT,
      matched_agent_user_id text REFERENCES profiles(id) ON DELETE SET NULL,
      dm_thread_id text REFERENCES dm_threads(id) ON DELETE SET NULL,
      claim_token text NOT NULL,
      report_key text NOT NULL,
      report_history_id text,
      chat_session_id text NOT NULL,
      property_key text NOT NULL,
      property_address text NOT NULL,
      listing_url text,
      listing_source text,
      requested_documents text[] NOT NULL DEFAULT ARRAY['lim_report','title']::text[],
      offer_source text NOT NULL,
      status text NOT NULL DEFAULT 'offered',
      metadata_json jsonb,
      offer_shown_at timestamptz,
      declined_at timestamptz,
      consented_at timestamptz,
      connected_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE lim_title_requests ADD COLUMN IF NOT EXISTS claim_token text;
    UPDATE lim_title_requests
      SET claim_token = substring(md5(random()::text || id || clock_timestamp()::text), 1, 12)
      WHERE claim_token IS NULL OR claim_token = '';
    ALTER TABLE lim_title_requests ALTER COLUMN claim_token SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS lim_title_requests_buyer_target_property_unique
      ON lim_title_requests(requester_user_id, agent_target_id, property_key);
    CREATE UNIQUE INDEX IF NOT EXISTS lim_title_requests_claim_token_unique
      ON lim_title_requests(claim_token);
    CREATE INDEX IF NOT EXISTS lim_title_requests_report_idx
      ON lim_title_requests(requester_user_id, report_key);
    CREATE INDEX IF NOT EXISTS lim_title_requests_agent_status_idx
      ON lim_title_requests(matched_agent_user_id, status);
    CREATE INDEX IF NOT EXISTS lim_title_requests_target_status_idx
      ON lim_title_requests(agent_target_id, status);
    ALTER TABLE lim_title_requests
      ADD COLUMN IF NOT EXISTS admin_sms_sent_at timestamptz,
      ADD COLUMN IF NOT EXISTS documents_delivered_at timestamptz;

    CREATE TABLE IF NOT EXISTS post_report_prompt_allocations (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      report_history_id text NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
      channel text NOT NULL CHECK (channel IN ('lim_title', 'service_provider')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS post_report_prompt_allocations_user_report_unique
      ON post_report_prompt_allocations(requester_user_id, report_history_id);
    CREATE INDEX IF NOT EXISTS post_report_prompt_allocations_report_idx
      ON post_report_prompt_allocations(report_history_id);

    CREATE TABLE IF NOT EXISTS lead_sms_deliveries (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id text NOT NULL REFERENCES lim_title_requests(id) ON DELETE CASCADE,
      agent_target_id text NOT NULL REFERENCES listing_agent_targets(id) ON DELETE CASCADE,
      to_phone text NOT NULL,
      body text NOT NULL,
      twilio_sid text,
      status text NOT NULL DEFAULT 'queued',
      attempt_count integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error text,
      sent_at timestamptz,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lead_sms_deliveries_request_unique
      ON lead_sms_deliveries(request_id);
    CREATE UNIQUE INDEX IF NOT EXISTS lead_sms_deliveries_twilio_sid_unique
      ON lead_sms_deliveries(twilio_sid) WHERE twilio_sid IS NOT NULL;
    CREATE INDEX IF NOT EXISTS lead_sms_deliveries_retry_idx
      ON lead_sms_deliveries(status, next_attempt_at);

    ALTER TABLE dm_messages
      ADD COLUMN IF NOT EXISTS message_kind text,
      ADD COLUMN IF NOT EXISTS metadata_json jsonb,
      ADD COLUMN IF NOT EXISTS lead_request_id text;
    CREATE INDEX IF NOT EXISTS dm_messages_lead_request_idx
      ON dm_messages(lead_request_id) WHERE lead_request_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS dm_messages_thread_sender_created_idx
      ON dm_messages(thread_id, sender_id, created_at);

    -- This rollout is deliberately human-managed. Prevent any legacy queued
    -- lead notification from being replayed if SMS automation is revisited.
    UPDATE lead_sms_deliveries
      SET status = 'disabled',
          last_error = 'Disabled by human-managed LIM/title workflow',
          updated_at = now()
      WHERE status IN ('queued', 'processing', 'failed', 'undelivered');
  `);
  const { rows } = await client.query(`
    SELECT
      to_regclass('public.post_report_prompt_allocations') IS NOT NULL AS has_prompt_allocations,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lim_title_requests'
          AND column_name = 'admin_sms_sent_at'
      ) AS has_admin_sms_sent_at,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'lim_title_requests'
          AND column_name = 'documents_delivered_at'
      ) AS has_documents_delivered_at,
      (
        SELECT count(*)::int FROM lead_sms_deliveries
        WHERE status IN ('queued', 'processing', 'failed', 'undelivered')
      ) AS automated_deliveries_remaining
  `);
  const verification = rows[0];
  if (
    !verification?.has_prompt_allocations ||
    !verification?.has_admin_sms_sent_at ||
    !verification?.has_documents_delivered_at ||
    verification?.automated_deliveries_remaining !== 0
  ) {
    throw new Error(
      `LIM/title migration verification failed: ${JSON.stringify(verification)}`,
    );
  }
  console.log("LIM/title human-managed lead tables ensured and verified");
} finally {
  await client.end();
}
