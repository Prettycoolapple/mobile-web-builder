-- Run after add-news-phase-2.sql. Safe to re-run.
begin;

alter table news_posts add column if not exists staged_at timestamptz;
alter table news_posts add column if not exists released_at timestamptz;
alter table news_posts add column if not exists publication_mode text not null default 'push';
alter table news_posts add column if not exists release_batch_id text;

alter table news_posts drop constraint if exists news_posts_publication_mode_check;
alter table news_posts add constraint news_posts_publication_mode_check
  check (publication_mode in ('push', 'silent_backfill'));

create index if not exists news_posts_staged_launch_idx
  on news_posts (staged_at, created_at, id)
  where status = 'draft' and staged_at is not null;

create table if not exists news_release_batches (
  idempotency_key text primary key,
  released_by text not null references profiles(id) on delete restrict,
  post_count integer not null check (post_count >= 0),
  released_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'news_posts_release_batch_id_fkey'
  ) then
    alter table news_posts add constraint news_posts_release_batch_id_fkey
      foreign key (release_batch_id) references news_release_batches(idempotency_key)
      on delete restrict;
  end if;
end $$;

alter table push_tokens add column if not exists news_capable_at timestamptz;
create index if not exists push_tokens_news_capable_idx
  on push_tokens (news_capable_at)
  where news_capable_at is not null;

revoke all on table news_release_batches from anon, authenticated;

commit;
