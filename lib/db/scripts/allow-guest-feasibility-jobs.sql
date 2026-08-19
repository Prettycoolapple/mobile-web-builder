-- Allow guest-owned background feasibility jobs. Safe to re-run.
--
-- Same statements as allow-guest-feasibility-jobs.mjs, for pasting straight
-- into the Supabase SQL editor when DATABASE_URL is not available locally.
begin;

-- Guests have no profiles row to reference.
alter table feasibility_jobs alter column user_id drop not null;

-- guest_hash: hashed anonymous install id, the only thing authorising a guest's
--             status poll (they have no bearer token).
-- guest_ip_hash: keeps guest jobs counting toward the per-IP report ceiling.
-- result_json: guests write no `searches` history row, so the finished report
--              lives on the job itself.
alter table feasibility_jobs
  add column if not exists guest_hash text,
  add column if not exists guest_ip_hash text,
  add column if not exists result_json jsonb;

-- A job with neither owner could never be polled back by anyone, and would
-- quietly burn a full pipeline run. Reject it at the table.
alter table feasibility_jobs drop constraint if exists feasibility_jobs_owner_present;
alter table feasibility_jobs
  add constraint feasibility_jobs_owner_present
  check (user_id is not null or guest_hash is not null);

create index if not exists feasibility_jobs_guest_created_idx
  on feasibility_jobs (guest_hash, created_at);

commit;
