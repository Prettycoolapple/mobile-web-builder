-- Run after add-news-posts.sql. Safe to re-run.
begin;

create sequence if not exists news_post_publish_sequence;
alter table news_posts add column if not exists published_sequence integer;
update news_posts
set published_sequence = nextval('news_post_publish_sequence')
where published_at is not null and published_sequence is null;
create unique index if not exists news_posts_published_sequence_unique
  on news_posts (published_sequence) where published_sequence is not null;

create table if not exists news_guest_sessions (
  id text primary key,
  installation_hash text not null,
  claimed_by_user_id text references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  claimed_at timestamptz,
  constraint news_guest_sessions_id_check
    check (id ~ '^ng_[A-Za-z0-9_-]{16,128}$'),
  constraint news_guest_sessions_hash_check
    check (installation_hash ~ '^[a-f0-9]{64}$')
);
create index if not exists news_guest_sessions_install_idx
  on news_guest_sessions (installation_hash, last_seen_at desc);
create index if not exists news_guest_sessions_claimed_idx
  on news_guest_sessions (claimed_by_user_id);

create table if not exists news_post_guest_recipients (
  post_id text not null references news_posts(id) on delete cascade,
  guest_session_id text not null references news_guest_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,guest_session_id)
);
create index if not exists news_post_guest_recipients_guest_idx
  on news_post_guest_recipients (guest_session_id,created_at desc);

alter table push_tokens add column if not exists guest_session_id text references news_guest_sessions(id) on delete cascade;
alter table push_tokens alter column user_id drop not null;
create index if not exists push_tokens_guest_session_idx on push_tokens (guest_session_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'push_tokens_exactly_one_owner') then
    alter table push_tokens add constraint push_tokens_exactly_one_owner
      check (((user_id is not null)::integer + (guest_session_id is not null)::integer) = 1);
  end if;
end $$;

create table if not exists news_post_blocks (
  id text primary key default gen_random_uuid()::text,
  post_id text not null references news_posts(id) on delete cascade,
  block_type text not null check (block_type in ('text','image')),
  sort_order integer not null check (sort_order >= 0),
  text_en text,
  text_zh text,
  image_id text references news_post_images(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_post_blocks_shape_check check (
    (block_type = 'text' and image_id is null and text_en is not null and text_zh is not null)
    or (block_type = 'image' and image_id is not null and text_en is null and text_zh is null)
  ),
  unique(post_id, sort_order),
  unique(post_id, image_id)
);

-- Backfill legacy posts as body first, then their existing ordered images.
insert into news_post_blocks(post_id, block_type, sort_order, text_en, text_zh)
select p.id, 'text', 0, p.body_en, p.body_zh
from news_posts p
where (btrim(p.body_en) <> '' or btrim(p.body_zh) <> '')
  and not exists (select 1 from news_post_blocks b where b.post_id=p.id);

insert into news_post_blocks(post_id, block_type, sort_order, image_id)
select i.post_id, 'image',
       coalesce((select max(b.sort_order)+1 from news_post_blocks b where b.post_id=i.post_id), 0)
       + row_number() over (partition by i.post_id order by i.sort_order, i.id) - 1,
       i.id
from news_post_images i
where not exists (
  select 1 from news_post_blocks b where b.post_id=i.post_id and b.image_id=i.id
);

create table if not exists news_viewer_states (
  viewer_key text primary key,
  user_id text references profiles(id) on delete cascade,
  guest_session_id text references news_guest_sessions(id) on delete cascade,
  last_seen_sequence integer not null default 0 check (last_seen_sequence >= 0),
  updated_at timestamptz not null default now(),
  constraint news_viewer_states_owner_check check (
    ((user_id is not null)::integer + (guest_session_id is not null)::integer) = 1
  )
);

create table if not exists news_post_engagements (
  post_id text not null references news_posts(id) on delete cascade,
  viewer_key text not null,
  user_id text references profiles(id) on delete cascade,
  guest_session_id text references news_guest_sessions(id) on delete cascade,
  first_push_opened_at timestamptz,
  first_read_at timestamptz,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(post_id, viewer_key),
  constraint news_post_engagements_owner_check check (
    ((user_id is not null)::integer + (guest_session_id is not null)::integer) = 1
  )
);
create index if not exists news_post_engagements_post_read_idx
  on news_post_engagements (post_id, first_read_at);

insert into news_post_engagements(
  post_id, viewer_key, user_id, first_push_opened_at, first_read_at, last_read_at, created_at
)
select post_id, 'user:' || user_id, user_id,
       first_push_opened_at, first_read_at, last_read_at, created_at
from news_post_recipients
on conflict (post_id, viewer_key) do update set
  first_push_opened_at = coalesce(news_post_engagements.first_push_opened_at, excluded.first_push_opened_at),
  first_read_at = coalesce(news_post_engagements.first_read_at, excluded.first_read_at),
  last_read_at = greatest(news_post_engagements.last_read_at, excluded.last_read_at);

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'news_post_deliveries_post_id_user_id_fkey') then
    alter table news_post_deliveries drop constraint news_post_deliveries_post_id_user_id_fkey;
  end if;
end $$;
alter table news_post_deliveries alter column user_id drop not null;
alter table news_post_deliveries add column if not exists guest_session_id text references news_guest_sessions(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'news_post_deliveries_post_id_fkey') then
    alter table news_post_deliveries add constraint news_post_deliveries_post_id_fkey foreign key(post_id) references news_posts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_post_deliveries_user_id_fkey') then
    alter table news_post_deliveries add constraint news_post_deliveries_user_id_fkey foreign key(user_id) references profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_post_deliveries_owner_check') then
    alter table news_post_deliveries add constraint news_post_deliveries_owner_check
      check (((user_id is not null)::integer + (guest_session_id is not null)::integer) = 1);
  end if;
end $$;

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'news_post_read_sessions_post_id_user_id_fkey') then
    alter table news_post_read_sessions drop constraint news_post_read_sessions_post_id_user_id_fkey;
  end if;
end $$;
alter table news_post_read_sessions add column if not exists viewer_key text;
alter table news_post_read_sessions add column if not exists guest_session_id text references news_guest_sessions(id) on delete cascade;
update news_post_read_sessions set viewer_key='user:' || user_id where viewer_key is null and user_id is not null;
alter table news_post_read_sessions alter column viewer_key set not null;
alter table news_post_read_sessions alter column user_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'news_post_read_sessions_post_id_fkey') then
    alter table news_post_read_sessions add constraint news_post_read_sessions_post_id_fkey foreign key(post_id) references news_posts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_post_read_sessions_user_id_fkey') then
    alter table news_post_read_sessions add constraint news_post_read_sessions_user_id_fkey foreign key(user_id) references profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'news_post_read_sessions_owner_check') then
    alter table news_post_read_sessions add constraint news_post_read_sessions_owner_check
      check (((user_id is not null)::integer + (guest_session_id is not null)::integer) = 1);
  end if;
end $$;
drop index if exists news_post_read_sessions_post_user_idx;
create index if not exists news_post_read_sessions_post_viewer_idx
  on news_post_read_sessions (post_id, viewer_key, started_at);

revoke all on table news_guest_sessions, news_post_guest_recipients, news_post_blocks, news_viewer_states,
  news_post_engagements from anon, authenticated;

commit;
