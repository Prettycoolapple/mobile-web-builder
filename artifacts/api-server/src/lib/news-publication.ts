export type NewsReadinessStats = {
  block_count: string;
  text_block_count: string;
  invalid_text_count: string;
};

type QueryResult = { rows: Array<Record<string, unknown>> };
export type NewsPublicationQuery = (text: string, values?: unknown[]) => Promise<QueryResult>;

export async function loadNewsReadinessStats(
  query: NewsPublicationQuery,
  postId: string,
): Promise<NewsReadinessStats> {
  const result = await query(
    `select
       count(*)::text block_count,
       count(*) filter (where block_type='text')::text text_block_count,
       count(*) filter (
         where block_type='text'
           and (btrim(coalesce(text_en,''))='' or btrim(coalesce(text_zh,''))='')
       )::text invalid_text_count
     from news_post_blocks where post_id=$1`,
    [postId],
  );
  const row = result.rows[0];
  return {
    block_count: String(row?.block_count ?? "0"),
    text_block_count: String(row?.text_block_count ?? "0"),
    invalid_text_count: String(row?.invalid_text_count ?? "0"),
  };
}

export function newsPostReadinessError(
  post: Record<string, unknown>,
  stats: NewsReadinessStats,
): string | null {
  if (
    post.translation_stale
    || !String(post.title_en ?? "").trim()
    || !String(post.title_zh ?? "").trim()
    || Number(stats.block_count) === 0
    || Number(stats.text_block_count) === 0
    || Number(stats.invalid_text_count) > 0
  ) return "Complete and confirm both languages before publishing";
  return null;
}

export type SilentReleaseResult = {
  postCount: number;
  releasedAt: unknown;
  replayed: boolean;
};

/**
 * Runs inside the caller's database transaction. The advisory transaction lock
 * serializes different request keys, while the batch row makes same-key retries
 * idempotent after an ambiguous HTTP response.
 */
export async function releaseStagedNewsPosts(
  query: NewsPublicationQuery,
  options: { idempotencyKey: string; releasedBy: string },
): Promise<SilentReleaseResult> {
  await query("select pg_advisory_xact_lock(hashtext('news-staged-launch-release'))");
  const prior = await query(
    `select post_count,released_at from news_release_batches where idempotency_key=$1`,
    [options.idempotencyKey],
  );
  if (prior.rows[0]) {
    return {
      postCount: Number(prior.rows[0].post_count),
      releasedAt: prior.rows[0].released_at,
      replayed: true,
    };
  }

  const staged = await query(
    `select * from news_posts
     where status='draft' and staged_at is not null
     order by created_at,id
     for update`,
  );
  if (staged.rows.length === 0) {
    const error = new Error("There are no staged posts to release") as Error & { status?: number };
    error.status = 409;
    throw error;
  }
  for (const post of staged.rows) {
    if (post.audience !== "everyone") {
      const error = new Error("Every staged launch post must target Everyone") as Error & { status?: number };
      error.status = 409;
      throw error;
    }
    const stats = await loadNewsReadinessStats(query, String(post.id));
    const readinessError = newsPostReadinessError(post, stats);
    if (readinessError) {
      const error = new Error(`A staged post is no longer ready: ${readinessError}`) as Error & { status?: number };
      error.status = 409;
      throw error;
    }
  }

  const batch = await query(
    `insert into news_release_batches(idempotency_key,released_by,post_count)
     values($1,$2,$3) returning released_at`,
    [options.idempotencyKey, options.releasedBy, staged.rows.length],
  );
  const releasedAt = batch.rows[0]?.released_at;

  for (const post of staged.rows) {
    await query(
      `insert into news_post_recipients(post_id,user_id)
       select $1,p.id from profiles p where p.role<>'admin'
       on conflict do nothing`,
      [post.id],
    );
    await query(
      `insert into news_post_guest_recipients(post_id,guest_session_id)
       select $1,g.id from news_guest_sessions g where g.claimed_by_user_id is null
       on conflict do nothing`,
      [post.id],
    );
    await query(
      `update news_posts
       set status='sent',staged_at=null,published_at=created_at,released_at=$2,
           publication_mode='silent_backfill',release_batch_id=$3,
           published_sequence=nextval('news_post_publish_sequence'),updated_at=now()
       where id=$1`,
      [post.id, releasedAt, options.idempotencyKey],
    );
  }

  return { postCount: staged.rows.length, releasedAt, replayed: false };
}
