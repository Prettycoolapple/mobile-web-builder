import type { Request } from "express";
import { pool } from "@workspace/db";
import { getAnonymousInstallHash } from "./anonymous-discovery";

const GUEST_ID_RE = /^ng_[A-Za-z0-9_-]{16,128}$/;

export interface NewsViewer {
  key: string;
  userId: string | null;
  guestSessionId: string | null;
  installationHash: string | null;
  isAdmin: boolean;
}

interface NewsDbClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export function clampNewsSeenSequence(requested: unknown, latestVisible: number): number {
  const normalized = Math.max(0, Math.floor(Number(requested) || 0));
  return Math.min(normalized, Math.max(0, latestVisible));
}

export function canPermanentlyDeleteNewsPost(status: string, audience: string): boolean {
  return status === "draft" || audience === "specific_user";
}

function guestIdFromRequest(req: Request): string | null {
  const value = req.get("x-news-guest-session-id")?.trim() ?? "";
  return GUEST_ID_RE.test(value) ? value : null;
}

function ownerColumns(viewer: NewsViewer): [string | null, string | null] {
  return [viewer.userId, viewer.guestSessionId];
}

export async function mergeGuestNewsActivity(
  client: NewsDbClient,
  guestSessionId: string,
  installationHash: string,
  userId: string,
): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`news-guest:${guestSessionId}`]);
  const session = await client.query<{ claimed_by_user_id: string | null }>(
    `insert into news_guest_sessions(id,installation_hash,last_seen_at)
     values($1,$2,now())
     on conflict(id) do update set last_seen_at=now()
       where news_guest_sessions.installation_hash=excluded.installation_hash
     returning claimed_by_user_id`,
    [guestSessionId, installationHash],
  );
  if (!session.rows[0]) throw new Error("Guest session does not belong to this installation");
  const claimedBy = session.rows[0].claimed_by_user_id;
  if (claimedBy && claimedBy !== userId) throw new Error("Guest session has already been claimed");

  const userKey = `user:${userId}`;
  const guestKey = `guest:${guestSessionId}`;
  await client.query(
    `insert into news_post_engagements(
       post_id,viewer_key,user_id,first_push_opened_at,first_read_at,last_read_at,created_at
     )
     select post_id,$2,$3,first_push_opened_at,first_read_at,last_read_at,created_at
     from news_post_engagements where viewer_key=$1
     on conflict(post_id,viewer_key) do update set
       first_push_opened_at=case
         when news_post_engagements.first_push_opened_at is null then excluded.first_push_opened_at
         when excluded.first_push_opened_at is null then news_post_engagements.first_push_opened_at
         else least(news_post_engagements.first_push_opened_at,excluded.first_push_opened_at) end,
       first_read_at=case
         when news_post_engagements.first_read_at is null then excluded.first_read_at
         when excluded.first_read_at is null then news_post_engagements.first_read_at
         else least(news_post_engagements.first_read_at,excluded.first_read_at) end,
       last_read_at=case
         when news_post_engagements.last_read_at is null then excluded.last_read_at
         when excluded.last_read_at is null then news_post_engagements.last_read_at
         else greatest(news_post_engagements.last_read_at,excluded.last_read_at) end`,
    [guestKey, userKey, userId],
  );
  await client.query(
    `update news_post_read_sessions
     set viewer_key=$2,user_id=$3,guest_session_id=null
     where viewer_key=$1`,
    [guestKey, userKey, userId],
  );
  await client.query(
    `insert into news_viewer_states(viewer_key,user_id,last_seen_sequence,updated_at)
     select $2,$3,last_seen_sequence,now() from news_viewer_states where viewer_key=$1
     on conflict(viewer_key) do update set
       last_seen_sequence=greatest(news_viewer_states.last_seen_sequence,excluded.last_seen_sequence),
       updated_at=now()`,
    [guestKey, userKey, userId],
  );
  await client.query(`delete from news_post_engagements where viewer_key=$1`, [guestKey]);
  await client.query(`delete from news_viewer_states where viewer_key=$1`, [guestKey]);
  await client.query(
    `update push_tokens set user_id=$2,guest_session_id=null,updated_at=now() where guest_session_id=$1`,
    [guestSessionId, userId],
  );
  await client.query(
    `update news_guest_sessions set claimed_by_user_id=$2,claimed_at=coalesce(claimed_at,now()),last_seen_at=now()
     where id=$1`,
    [guestSessionId, userId],
  );
}

async function ensureGuestSession(req: Request): Promise<NewsViewer> {
  const installationHash = getAnonymousInstallHash(req.headers as Record<string, unknown>);
  const guestSessionId = guestIdFromRequest(req);
  if (!installationHash || !guestSessionId) {
    const error = new Error("Guest installation headers are required");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }
  const result = await pool.query<{ claimed_by_user_id: string | null }>(
    `insert into news_guest_sessions(id,installation_hash,last_seen_at)
     values($1,$2,now())
     on conflict(id) do update set last_seen_at=now()
       where news_guest_sessions.installation_hash=excluded.installation_hash
     returning claimed_by_user_id`,
    [guestSessionId, installationHash],
  );
  if (!result.rows[0] || result.rows[0].claimed_by_user_id) {
    const error = new Error("Guest session is no longer active");
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
  return {
    key: `guest:${guestSessionId}`,
    userId: null,
    guestSessionId,
    installationHash,
    isAdmin: false,
  };
}

export async function resolveNewsViewer(req: Request, mergeGuest = false): Promise<NewsViewer> {
  const authenticatedUserId = (req as Request & { userId?: string }).userId ?? null;
  if (!authenticatedUserId) return ensureGuestSession(req);

  const installationHash = getAnonymousInstallHash(req.headers as Record<string, unknown>);
  const guestSessionId = guestIdFromRequest(req);
  if (mergeGuest && installationHash && guestSessionId) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await mergeGuestNewsActivity(client as unknown as NewsDbClient, guestSessionId, installationHash, authenticatedUserId);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      // A stale guest id must not block valid account access. The client will
      // rotate it after sign-out; ownership is still enforced for guest calls.
      req.log.warn({ error }, "Could not merge guest news activity");
    } finally {
      client.release();
    }
  }
  return {
    key: `user:${authenticatedUserId}`,
    userId: authenticatedUserId,
    guestSessionId: null,
    installationHash,
    isAdmin: (req as Request & { role?: string }).role === "admin",
  };
}

export function newsOwnerValues(viewer: NewsViewer): [string | null, string | null] {
  return ownerColumns(viewer);
}

export async function lockActiveGuestNewsViewer(
  client: NewsDbClient,
  viewer: NewsViewer,
): Promise<void> {
  if (!viewer.guestSessionId) return;
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`news-guest:${viewer.guestSessionId}`]);
  const active = await client.query(
    `select 1 from news_guest_sessions
     where id=$1 and installation_hash=$2 and claimed_by_user_id is null
     for update`,
    [viewer.guestSessionId, viewer.installationHash],
  );
  if (!active.rows[0]) {
    const error = new Error("Guest session is no longer active");
    (error as Error & { status?: number }).status = 409;
    throw error;
  }
}

export function canAccessNewsSql(alias = "p", firstParameter = 2): string {
  const adminParameter = `$${firstParameter}`;
  const userParameter = `$${firstParameter + 1}`;
  const guestParameter = `$${firstParameter + 2}`;
  return `(
    ${adminParameter}::boolean
    or (${userParameter}::text is not null and (${alias}.audience='everyone' or exists(
      select 1 from news_post_recipients ar where ar.post_id=${alias}.id and ar.user_id=${userParameter}
    )))
    or (${guestParameter}::text is not null and ${alias}.audience='everyone')
  )`;
}
