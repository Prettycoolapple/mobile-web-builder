begin;

alter table push_tokens add column if not exists locale text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'push_tokens_locale_check') then
    alter table push_tokens add constraint push_tokens_locale_check check (locale is null or locale in ('en', 'zh'));
  end if;
end $$;
create index if not exists profiles_email_lower_idx on profiles (lower(email));

create table if not exists news_posts (
  id text primary key default gen_random_uuid()::text,
  created_by text not null references profiles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','queued','sending','sent','partially_failed','archived')),
  source_language text not null check (source_language in ('en','zh')),
  title_en text not null default '', body_en text not null default '',
  title_zh text not null default '', body_zh text not null default '',
  audience text not null default 'specific_user' check (audience in ('specific_user','everyone','paid_general','sales_agent','service_provider')),
  target_user_id text references profiles(id) on delete restrict,
  translation_stale boolean not null default true,
  content_revision integer not null default 1 check (content_revision > 0),
  send_idempotency_key text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  send_started_at timestamptz, published_at timestamptz, archived_at timestamptz,
  constraint news_posts_specific_target_check check (status = 'draft' or (audience = 'specific_user' and target_user_id is not null) or (audience <> 'specific_user' and target_user_id is null)),
  constraint news_posts_title_length_check check (char_length(title_en) <= 120 and char_length(title_zh) <= 120),
  constraint news_posts_body_length_check check (char_length(body_en) <= 20000 and char_length(body_zh) <= 20000),
  constraint news_posts_send_content_check check (status = 'draft' or (btrim(title_en) <> '' and btrim(title_zh) <> '' and btrim(body_en) <> '' and btrim(body_zh) <> '' and translation_stale = false))
);
create index if not exists news_posts_status_created_idx on news_posts (status, created_at desc);

create table if not exists news_post_images (
  id text primary key default gen_random_uuid()::text,
  post_id text not null references news_posts(id) on delete cascade,
  object_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  sort_order integer not null check (sort_order >= 0), created_at timestamptz not null default now(),
  unique (post_id, sort_order)
);

create table if not exists news_post_recipients (
  post_id text not null references news_posts(id) on delete cascade,
  user_id text not null references profiles(id) on delete cascade,
  first_push_opened_at timestamptz, first_read_at timestamptz, last_read_at timestamptz,
  created_at timestamptz not null default now(), primary key (post_id, user_id)
);
create index if not exists news_post_recipients_user_idx on news_post_recipients (user_id, created_at desc);

create table if not exists news_post_deliveries (
  id text primary key default gen_random_uuid()::text,
  post_id text not null, user_id text not null,
  push_token_id text references push_tokens(id) on delete set null,
  locale text not null check (locale in ('en','zh')),
  status text not null default 'queued' check (status in ('queued','dispatching','ticket_ok','ticket_error','receipt_ok','receipt_error','unknown','skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0), lease_expires_at timestamptz,
  expo_ticket_id text, last_error_code text, last_error_message text,
  created_at timestamptz not null default now(), dispatched_at timestamptz, receipt_checked_at timestamptz,
  foreign key (post_id, user_id) references news_post_recipients(post_id, user_id) on delete cascade,
  unique (post_id, push_token_id)
);
create index if not exists news_post_deliveries_worker_idx on news_post_deliveries (status, lease_expires_at, created_at);
create index if not exists news_post_deliveries_ticket_idx on news_post_deliveries (expo_ticket_id) where expo_ticket_id is not null;

create table if not exists news_post_read_sessions (
  id text primary key, post_id text not null, user_id text not null,
  entry_source text not null check (entry_source in ('push','feed')),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  started_at timestamptz not null default now(), last_heartbeat_at timestamptz not null default now(), ended_at timestamptz,
  foreign key (post_id, user_id) references news_post_recipients(post_id, user_id) on delete cascade
);
create index if not exists news_post_read_sessions_post_user_idx on news_post_read_sessions (post_id, user_id, started_at);

revoke all on table news_posts, news_post_images, news_post_recipients, news_post_deliveries, news_post_read_sessions from anon, authenticated;
commit;
