import { randomUUID } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { optionalAuth, requireAdmin } from "../lib/auth";
import { getAnonymousInstallHash } from "../lib/anonymous-discovery";
import { getAllowedOrigins } from "../lib/env";
import { hitRateLimit, ipRateLimit, minutes } from "../lib/rateLimit";
import { ObjectNotFoundError, ObjectStorageService, s3StorageService } from "../lib/objectStorage";
import { translateNewsPost, type NewsLanguage } from "../lib/news-translation";
import { runAfterResponse } from "../lib/vercel-wait-until";
import { runNewsDispatch, runNewsReceiptCheck } from "../lib/news-push";
import { loadNewsReadinessStats, newsPostReadinessError, releaseStagedNewsPosts } from "../lib/news-publication";
import { canAccessNewsSql, canPermanentlyDeleteNewsPost, clampNewsSeenSequence, lockActiveGuestNewsViewer, newsOwnerValues, resolveNewsViewer, type NewsViewer } from "../lib/news-viewer";

const router = Router();
const storage = new ObjectStorageService();
const AUDIENCES = new Set(["specific_user", "everyone", "paid_general", "sales_agent", "service_provider"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_NEWS_IMAGE_BYTES = 25 * 1024 * 1024;
const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const publicNewsLimit = ipRateLimit({ name: "news-public", max: 300, windowMs: minutes(5) });
let newsStorageCorsPromise: Promise<void> | null = null;

async function ensureNewsStorageCors(): Promise<void> {
  if (!s3StorageService.isConfigured) return;
  if (!newsStorageCorsPromise) {
    newsStorageCorsPromise = s3StorageService.configureCors(getAllowedOrigins())
      .then(() => undefined)
      .catch((error) => {
        newsStorageCorsPromise = null;
        throw error;
      });
  }
  await newsStorageCorsPromise;
}

function userId(req: Request): string {
  return (req as Request & { userId: string }).userId;
}

async function guestInstallationLimit(req: Request, res: Response, next: NextFunction) {
  if ((req as Request & { userId?: string }).userId) return next();
  const hash = getAnonymousInstallHash(req.headers as Record<string, unknown>);
  if (!hash) return next();
  const result = await hitRateLimit(`news-public:install:${hash}`, 240, minutes(5));
  if (result.allowed) return next();
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.status(429).json({ error: "Too many requests", code: "RATE_LIMITED", retryAfterSeconds: result.retryAfterSeconds });
}

function viewerError(res: Response, error: unknown): void {
  const status = Number((error as { status?: number })?.status) || 401;
  res.status(status).json({ error: error instanceof Error ? error.message : "Guest identity is required", code: "GUEST_IDENTITY_REQUIRED" });
}

function sendNewsSetupError(res: Response, error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? "");
  if (code !== "42P01" && code !== "42703") return false;
  res.status(503).json({
    error: "News database setup is incomplete. Run the latest News SQL migrations in Supabase SQL Editor, then redeploy.",
    code: "NEWS_MIGRATION_REQUIRED",
  });
  return true;
}

async function deleteNewsObjects(paths: string[], req: Request): Promise<void> {
  await Promise.all(paths.map(async (objectPath) => {
    try {
      const s3Key = s3StorageService.keyForObjectPath(objectPath);
      if (s3Key) await s3StorageService.delete(s3Key);
      else await storage.deleteObjectEntity(objectPath);
    }
    catch (error) { req.log.warn({ error, objectPath }, "Could not remove deleted news image object"); }
  }));
}

type AdminBlockInput = {
  type: "text" | "image";
  textEn?: string;
  textZh?: string;
  imageId?: string;
};

function parseBlocks(value: unknown): AdminBlockInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 60) return null;
  const blocks: AdminBlockInput[] = [];
  const usedImages = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const block = raw as Record<string, unknown>;
    if (block.type === "text") {
      if (typeof block.textEn !== "string" || typeof block.textZh !== "string") return null;
      if (block.textEn.length > 20_000 || block.textZh.length > 20_000) return null;
      blocks.push({ type: "text", textEn: block.textEn, textZh: block.textZh });
    } else if (block.type === "image" && typeof block.imageId === "string" && !usedImages.has(block.imageId)) {
      usedImages.add(block.imageId);
      blocks.push({ type: "image", imageId: block.imageId });
    } else {
      return null;
    }
  }
  return blocks;
}

function adminPost(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    sourceLanguage: row.source_language,
    titleEn: row.title_en,
    bodyEn: row.body_en,
    titleZh: row.title_zh,
    bodyZh: row.body_zh,
    audience: row.audience,
    targetUserId: row.target_user_id,
    targetEmail: row.resolved_target_email ?? row.target_email ?? null,
    translationStale: row.translation_stale,
    contentRevision: row.content_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    stagedAt: row.staged_at,
    releasedAt: row.released_at,
    publicationMode: row.publication_mode ?? "push",
    releaseBatchId: row.release_batch_id,
    audienceUsers: Number(row.audience_users ?? 0),
    guestAudience: Number(row.guest_audience ?? 0),
    devices: Number(row.devices ?? 0),
    pushHandoffs: Number(row.push_handoffs ?? 0),
    pushOpens: Number(row.push_opens ?? 0),
    readers: Number(row.readers ?? 0),
    naturalReaders: Number(row.natural_readers ?? 0),
    averageReadSeconds: Number(row.average_read_seconds ?? 0),
    failedDeliveries: Number(row.failed_deliveries ?? 0),
    unknownDeliveries: Number(row.unknown_deliveries ?? 0),
  };
}

const ADMIN_POST_SELECT = `
  select p.*, coalesce(p.target_email,target.email) as resolved_target_email,
    (select count(*) from news_post_recipients r where r.post_id=p.id) as audience_users,
    (select count(*) from news_post_guest_recipients gr where gr.post_id=p.id) as guest_audience,
    (select count(*) from news_post_deliveries d where d.post_id=p.id) as devices,
    (select count(*) from news_post_deliveries d where d.post_id=p.id and d.status='receipt_ok') as push_handoffs,
    (select count(*) from news_post_engagements e where e.post_id=p.id and e.first_push_opened_at is not null) as push_opens,
    (select count(*) from news_post_engagements e where e.post_id=p.id and e.first_read_at is not null) as readers,
    (select count(*) from news_post_engagements e where e.post_id=p.id and e.first_read_at is not null
      and exists(select 1 from news_post_read_sessions s where s.post_id=p.id and s.viewer_key=e.viewer_key and s.entry_source='feed')) as natural_readers,
    coalesce((select avg(viewer_seconds) from (
      select sum(s.active_seconds)::numeric viewer_seconds from news_post_read_sessions s
      join news_post_engagements e on e.post_id=s.post_id and e.viewer_key=s.viewer_key
      where s.post_id=p.id and e.first_read_at is not null group by s.viewer_key
    ) totals),0) as average_read_seconds,
    (select count(*) from news_post_deliveries d where d.post_id=p.id and d.status in ('ticket_error','receipt_error')) as failed_deliveries,
    (select count(*) from news_post_deliveries d where d.post_id=p.id and d.status='unknown') as unknown_deliveries
  from news_posts p left join profiles target on target.id=p.target_user_id
`;

router.get("/admin/news-posts", requireAdmin, async (req, res) => {
  try {
    const [result, staged] = await Promise.all([
      pool.query(`${ADMIN_POST_SELECT} order by p.created_at desc limit 200`),
      pool.query<{ count: string }>(`select count(*)::text count from news_posts where status='draft' and staged_at is not null`),
    ]);
    const stagedCount = Number(staged.rows[0]?.count ?? 0);
    res.json({
      posts: result.rows.map(adminPost),
      stagedCount,
      bulkSendEnabled: process.env.NEWS_BULK_SEND_ENABLED === "true",
    });
  } catch (error) {
    req.log.error({ error }, "Admin news list failed");
    if (sendNewsSetupError(res, error)) return;
    res.status(500).json({ error: "Failed to load news posts" });
  }
});

router.post("/admin/news-posts", requireAdmin, async (req, res) => {
  const sourceLanguage = req.body?.sourceLanguage === "zh" ? "zh" : "en";
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query(`insert into news_posts(created_by,source_language) values($1,$2) returning *`, [userId(req), sourceLanguage]);
    await client.query(
      `insert into news_post_blocks(post_id,block_type,sort_order,text_en,text_zh) values($1,'text',0,'','')`,
      [result.rows[0].id],
    );
    await client.query("commit");
    res.status(201).json(adminPost(result.rows[0]));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "Admin news create failed");
    if (sendNewsSetupError(res, error)) return;
    res.status(500).json({ error: "Failed to create draft" });
  } finally {
    client.release();
  }
});

router.get("/admin/news-posts/:postId", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`${ADMIN_POST_SELECT} where p.id=$1`, [req.params.postId]);
    if (!result.rows[0]) return void res.status(404).json({ error: "Post not found" });
    const blocks = await pool.query(
      `select b.id,b.block_type,b.sort_order,b.text_en,b.text_zh,b.image_id,
        i.object_path,i.content_type,i.byte_size
       from news_post_blocks b left join news_post_images i on i.id=b.image_id
       where b.post_id=$1 order by b.sort_order`,
      [req.params.postId],
    );
    const images = await pool.query(`select id,object_path,content_type,byte_size,sort_order from news_post_images where post_id=$1 order by sort_order`, [req.params.postId]);
    res.json({
      ...adminPost(result.rows[0]),
      blocks: blocks.rows.map((row) => row.block_type === "image"
        ? { id: row.id, type: "image", imageId: row.image_id, url: `/api/news/${req.params.postId}/images/${row.image_id}` }
        : { id: row.id, type: "text", textEn: row.text_en ?? "", textZh: row.text_zh ?? "" }),
      images: images.rows.map((row) => ({ id: row.id, objectPath: row.object_path, contentType: row.content_type, byteSize: row.byte_size, sortOrder: row.sort_order, url: `/api/news/${req.params.postId}/images/${row.id}` })),
    });
  } catch (error) {
    req.log.error({ error }, "Admin news detail failed");
    res.status(500).json({ error: "Failed to load post" });
  }
});

router.patch("/admin/news-posts/:postId", requireAdmin, async (req, res) => {
  const revision = Number(req.body?.contentRevision);
  const sourceLanguage = req.body?.sourceLanguage;
  const audience = req.body?.audience;
  const blocks = parseBlocks(req.body?.blocks);
  if (!Number.isInteger(revision) || !["en", "zh"].includes(sourceLanguage) || !AUDIENCES.has(audience) || !blocks) {
    return void res.status(400).json({ error: "Invalid draft data" });
  }
  if (typeof req.body?.titleEn !== "string" || typeof req.body?.titleZh !== "string" || req.body.titleEn.length > 120 || req.body.titleZh.length > 120) {
    return void res.status(400).json({ error: "Titles are required and limited to 120 characters" });
  }
  let targetUserId: string | null = null;
  let targetEmail: string | null = null;
  if (audience === "specific_user") {
    if (typeof req.body.targetEmail !== "string" || req.body.targetEmail.trim().length > 320) return void res.status(400).json({ error: "Enter a valid target email" });
    targetEmail = req.body.targetEmail.trim().toLowerCase() || null;
    const target = await pool.query<{ id: string }>(`select id from profiles where lower(email)=lower($1) and role <> 'admin' limit 1`, [req.body.targetEmail.trim()]);
    targetUserId = target.rows[0]?.id ?? null;
  }
  const imageIds = blocks.flatMap((block) => block.type === "image" && block.imageId ? [block.imageId] : []);
  const bodyEn = blocks.filter((block) => block.type === "text").map((block) => block.textEn ?? "").join("\n\n");
  const bodyZh = blocks.filter((block) => block.type === "text").map((block) => block.textZh ?? "").join("\n\n");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [req.params.postId]);
    if (imageIds.length) {
      const attached = await client.query<{ id: string }>(`select id from news_post_images where post_id=$1 and id=any($2::text[])`, [req.params.postId, imageIds]);
      if (attached.rows.length !== imageIds.length) {
        await client.query("rollback");
        return void res.status(400).json({ error: "Every image block must reference an attached image" });
      }
    }
    const result = await client.query(
      `update news_posts set source_language=$3,title_en=$4,body_en=$5,title_zh=$6,body_zh=$7,
       audience=$8,target_user_id=$9,target_email=$10,translation_stale=$11,content_revision=content_revision+1,updated_at=now()
       where id=$1 and status='draft' and staged_at is null and content_revision=$2 returning *`,
      [req.params.postId, revision, sourceLanguage, req.body.titleEn, bodyEn, req.body.titleZh, bodyZh, audience, targetUserId, targetEmail, req.body.translationStale !== false],
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return void res.status(409).json({ error: "Draft changed, was staged, or was edited in another session. Refresh before saving.", code: "REVISION_CONFLICT" });
    }
    await client.query(`delete from news_post_blocks where post_id=$1`, [req.params.postId]);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      await client.query(
        `insert into news_post_blocks(id,post_id,block_type,sort_order,text_en,text_zh,image_id)
         values($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), req.params.postId, block.type, index, block.type === "text" ? block.textEn : null, block.type === "text" ? block.textZh : null, block.type === "image" ? block.imageId : null],
      );
    }
    await client.query("commit");
    res.json(adminPost(result.rows[0]));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "Admin news update failed");
    res.status(500).json({ error: "Failed to save draft" });
  } finally {
    client.release();
  }
});

router.post("/admin/news-posts/:postId/translate", requireAdmin, async (req, res) => {
  const sourceLanguage: NewsLanguage = req.body?.sourceLanguage === "zh" ? "zh" : "en";
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const texts: string[] = Array.isArray(req.body?.texts) ? (req.body.texts as unknown[]).filter((text): text is string => typeof text === "string") : [];
  if (!title || texts.length === 0 || texts.some((text) => !text.trim())) return void res.status(400).json({ error: "Title and text blocks are required" });
  try {
    const [titleResult, ...blockResults] = await Promise.all([
      translateNewsPost({ sourceLanguage, title, body: texts[0]! }),
      ...texts.map((body) => translateNewsPost({ sourceLanguage, title: "News", body })),
    ]);
    res.json({ title: titleResult.title, texts: blockResults.map((result) => result.body) });
  } catch (error) {
    req.log.warn({ error }, "News translation failed");
    res.status(502).json({ error: "Translation service is unavailable" });
  }
});

router.post("/admin/news-posts/:postId/images/upload-url", requireAdmin, async (req, res) => {
  const contentType = String(req.body?.contentType ?? "");
  const byteSize = Number(req.body?.byteSize);
  if (!IMAGE_TYPES.has(contentType) || !Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_NEWS_IMAGE_BYTES) return void res.status(400).json({ error: "Use a JPEG, PNG, WebP, or GIF image up to 25 MB" });
  const count = await pool.query<{ count: string }>(`select count(i.id)::text count from news_posts p left join news_post_images i on i.post_id=p.id where p.id=$1 and p.status='draft' and p.staged_at is null group by p.id`, [req.params.postId]);
  if (!count.rows[0]) return void res.status(404).json({ error: "Draft not found" });
  if (Number(count.rows[0].count) >= 10) return void res.status(400).json({ error: "A post can contain at most 10 images" });
  try {
    if (s3StorageService.isConfigured) {
      try {
        await ensureNewsStorageCors();
      } catch (error) {
        req.log.warn({ error }, "Could not verify News image storage CORS before upload");
      }
      const upload = await s3StorageService.getPresignedUploadUrl({ contentType, namespace: `news/${req.params.postId}` });
      return void res.json({ uploadUrl: upload.uploadURL, objectPath: upload.objectPath });
    }
    const uploadUrl = await storage.getObjectEntityUploadURL({ contentType, namespace: `news/${req.params.postId}` });
    res.json({ uploadUrl, objectPath: storage.normalizeObjectEntityPath(uploadUrl) });
  } catch (error) {
    req.log.error({ error }, "News image upload URL failed");
    res.status(503).json({ error: "Image storage is unavailable" });
  }
});

router.post("/admin/news-posts/:postId/images", requireAdmin, async (req, res) => {
  const { objectPath, contentType } = req.body ?? {};
  const byteSize = Number(req.body?.byteSize);
  const expectedS3Prefix = `/s3/news/${req.params.postId}/`;
  if (typeof objectPath !== "string" || (!objectPath.startsWith("/objects/") && !objectPath.startsWith(expectedS3Prefix)) || !IMAGE_TYPES.has(contentType) || !Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_NEWS_IMAGE_BYTES) return void res.status(400).json({ error: "Invalid image metadata" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [req.params.postId]);
    const draft = await client.query(`select id from news_posts where id=$1 and status='draft' and staged_at is null`, [req.params.postId]);
    if (!draft.rows[0]) { await client.query("rollback"); return void res.status(404).json({ error: "Draft not found" }); }
    const count = await client.query<{ count: string }>(`select count(*)::text count from news_post_images where post_id=$1`, [req.params.postId]);
    if (Number(count.rows[0]?.count ?? 0) >= 10) { await client.query("rollback"); return void res.status(400).json({ error: "A post can contain at most 10 images" }); }
    const s3Key = s3StorageService.keyForObjectPath(objectPath);
    if (s3Key) {
      const uploaded = await s3StorageService.head(s3Key);
      if (uploaded.size == null || uploaded.size <= 0 || uploaded.size > MAX_NEWS_IMAGE_BYTES) {
        await client.query("rollback"); return void res.status(400).json({ error: "Uploaded image size could not be verified" });
      }
    }
    const image = await client.query(
      `insert into news_post_images(post_id,object_path,content_type,byte_size,sort_order)
       select $1,$2,$3,$4,coalesce(max(sort_order)+1,0) from news_post_images where post_id=$1 returning *`,
      [req.params.postId, objectPath, contentType, byteSize],
    );
    await client.query(
      `insert into news_post_blocks(post_id,block_type,sort_order,image_id)
       select $1,'image',coalesce(max(sort_order)+1,0),$2 from news_post_blocks where post_id=$1`,
      [req.params.postId, image.rows[0].id],
    );
    await client.query(`update news_posts set content_revision=content_revision+1,updated_at=now() where id=$1`, [req.params.postId]);
    await client.query("commit");
    res.status(201).json(image.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "News image register failed");
    res.status(400).json({ error: "Could not attach image" });
  } finally { client.release(); }
});

router.patch("/admin/news-posts/:postId/images/reorder", requireAdmin, async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.imageIds) ? req.body.imageIds.filter((id: unknown): id is string => typeof id === "string") : [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ id: string }>(`select i.id from news_post_images i join news_posts p on p.id=i.post_id where i.post_id=$1 and p.status='draft' and p.staged_at is null order by i.sort_order for update of i`, [req.params.postId]);
    if (ids.length !== existing.rows.length || new Set(ids).size !== ids.length || ids.some((id) => !existing.rows.some((row) => row.id === id))) {
      await client.query("rollback"); return void res.status(400).json({ error: "Image order must include every attached image exactly once" });
    }
    await client.query(`update news_post_images set sort_order=sort_order+1000 where post_id=$1`, [req.params.postId]);
    for (let index = 0; index < ids.length; index += 1) await client.query(`update news_post_images set sort_order=$3 where post_id=$1 and id=$2`, [req.params.postId, ids[index], index]);
    await client.query(`update news_posts set content_revision=content_revision+1,updated_at=now() where id=$1`, [req.params.postId]);
    await client.query("commit"); res.json({ ok: true });
  } catch (error) { await client.query("rollback").catch(() => undefined); req.log.error({ error }, "News image reorder failed"); res.status(500).json({ error: "Could not reorder images" }); }
  finally { client.release(); }
});

router.delete("/admin/news-posts/:postId/images/:imageId", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ id: string; object_path: string }>(`delete from news_post_images where id=$1 and post_id=$2 and exists(select 1 from news_posts where id=$2 and status='draft' and staged_at is null) returning id,object_path`, [req.params.imageId, req.params.postId]);
    if (!result.rows[0]) { await client.query("rollback"); return void res.status(404).json({ error: "Draft image not found" }); }
    await client.query(`update news_posts set content_revision=content_revision+1,updated_at=now() where id=$1`, [req.params.postId]);
    await client.query("commit");
    runAfterResponse(deleteNewsObjects([result.rows[0].object_path], req));
    res.json({ ok: true });
  } catch (error) {
    await client.query("rollback").catch(() => undefined); req.log.error({ error }, "News image removal failed"); res.status(500).json({ error: "Could not remove image" });
  } finally { client.release(); }
});

router.post("/admin/news-posts/:postId/stage", requireAdmin, async (req, res) => {
  const revision = Number(req.body?.contentRevision);
  if (!Number.isInteger(revision)) return void res.status(400).json({ error: "Content revision is required" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('news-staged-launch-release'))");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [req.params.postId]);
    const locked = await client.query(`select * from news_posts where id=$1 for update`, [req.params.postId]);
    const post = locked.rows[0];
    if (!post) { await client.query("rollback"); return void res.status(404).json({ error: "Post not found" }); }
    if (post.status !== "draft" || post.content_revision !== revision) {
      await client.query("rollback");
      return void res.status(409).json({ error: "Draft changed or is no longer editable. Refresh before staging." });
    }
    if (post.audience !== "everyone") {
      await client.query("rollback");
      return void res.status(400).json({ error: "Only Everyone posts can be staged for the launch backlog" });
    }
    const stats = await loadNewsReadinessStats(
      (text, values) => client.query(text, values),
      post.id,
    );
    const readinessError = newsPostReadinessError(post, stats);
    if (readinessError) {
      await client.query("rollback");
      return void res.status(400).json({ error: readinessError });
    }
    const staged = await client.query(
      `update news_posts set staged_at=coalesce(staged_at,now()),updated_at=now()
       where id=$1 returning *`,
      [post.id],
    );
    await client.query("commit");
    res.json(adminPost(staged.rows[0]));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "News post staging failed");
    if (sendNewsSetupError(res, error)) return;
    res.status(500).json({ error: "Failed to stage post" });
  } finally { client.release(); }
});

router.post("/admin/news-posts/:postId/unstage", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('news-staged-launch-release'))");
    const result = await client.query(
      `update news_posts set staged_at=null,updated_at=now()
       where id=$1 and status='draft' returning *`,
      [req.params.postId],
    );
    if (!result.rows[0]) {
      await client.query("rollback");
      return void res.status(404).json({ error: "Staged draft not found" });
    }
    await client.query("commit");
    res.json(adminPost(result.rows[0]));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "News post unstaging failed");
    if (sendNewsSetupError(res, error)) return;
    res.status(500).json({ error: "Failed to return post to draft" });
  } finally { client.release(); }
});

router.post("/admin/news-posts/release-staged", requireAdmin, async (req, res) => {
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey.trim() : "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    return void res.status(400).json({ error: "A valid idempotency key is required" });
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await releaseStagedNewsPosts(
      (text, values) => client.query(text, values),
      { idempotencyKey, releasedBy: userId(req) },
    );
    await client.query("commit");
    res.json({ ok: true, ...result });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "Staged News release failed");
    if (sendNewsSetupError(res, error)) return;
    const status = Number((error as { status?: number })?.status) || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : "Failed to release staged posts" });
  } finally { client.release(); }
});

router.delete("/admin/news-posts/:postId", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [req.params.postId]);
    const post = await client.query<{ status: string; audience: string }>(
      `select status,audience from news_posts where id=$1 for update`,
      [req.params.postId],
    );
    if (!post.rows[0]) { await client.query("rollback"); return void res.status(404).json({ error: "Post not found" }); }
    if (!canPermanentlyDeleteNewsPost(post.rows[0].status, post.rows[0].audience)) {
      await client.query("rollback");
      return void res.status(409).json({ error: "Sent bulk posts cannot be permanently deleted. Archive the post instead." });
    }
    const images = await client.query<{ object_path: string }>(`select object_path from news_post_images where post_id=$1`, [req.params.postId]);
    await client.query(`delete from news_posts where id=$1`, [req.params.postId]);
    await client.query("commit");
    runAfterResponse(deleteNewsObjects(images.rows.map((row) => row.object_path), req));
    res.json({ ok: true });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "Admin news delete failed");
    res.status(500).json({ error: "Failed to delete test post" });
  } finally { client.release(); }
});

async function audienceCounts(postId: string) {
  const result = await pool.query<{
    users: string; user_devices: string; users_without_devices: string;
    guests: string; guest_devices: string; guests_without_devices: string;
  }>(`
    with post as (select * from news_posts where id=$1), eligible as (
      select p.id from profiles p,post n where p.role<>'admin' and (
        (n.audience='specific_user' and (p.id=n.target_user_id or (n.target_user_id is null and lower(p.email)=lower(n.target_email)))) or n.audience='everyone' or
        (n.audience='paid_general' and p.role='general' and p.subscription_tier in ('standard','pro')) or
        (n.audience='sales_agent' and p.role='sales_agent') or
        (n.audience='service_provider' and p.role='service_provider')
      )
    ), guests as (
      select g.id from news_guest_sessions g,post n where n.audience='everyone' and g.claimed_by_user_id is null
    )
    select
      (select count(*) from eligible)::text users,
      (select count(t.id) from push_tokens t join eligible e on e.id=t.user_id where t.news_capable_at is not null)::text user_devices,
      (select count(*) from eligible e where not exists(select 1 from push_tokens t where t.user_id=e.id and t.news_capable_at is not null))::text users_without_devices,
      (select count(*) from guests)::text guests,
      (select count(t.id) from push_tokens t join guests g on g.id=t.guest_session_id where t.news_capable_at is not null)::text guest_devices,
      (select count(*) from guests g where not exists(select 1 from push_tokens t where t.guest_session_id=g.id and t.news_capable_at is not null))::text guests_without_devices
  `, [postId]);
  const row = result.rows[0];
  return {
    users: Number(row?.users ?? 0),
    userDevices: Number(row?.user_devices ?? 0),
    usersWithoutDevices: Number(row?.users_without_devices ?? 0),
    guestInstallations: Number(row?.guests ?? 0),
    guestDevices: Number(row?.guest_devices ?? 0),
    guestInstallationsWithoutDevices: Number(row?.guests_without_devices ?? 0),
    devices: Number(row?.user_devices ?? 0) + Number(row?.guest_devices ?? 0),
    noDevices: Number(row?.users_without_devices ?? 0) + Number(row?.guests_without_devices ?? 0),
  };
}

router.post("/admin/news-posts/:postId/preflight", requireAdmin, async (req, res) => {
  try { res.json(await audienceCounts(req.params.postId)); }
  catch (error) {
    req.log.error({ error }, "News preflight failed");
    if (sendNewsSetupError(res, error)) return;
    res.status(500).json({ error: "Preflight failed" });
  }
});

router.post("/admin/news-posts/:postId/send", requireAdmin, async (req, res) => {
  const revision = Number(req.body?.contentRevision);
  const key = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : "";
  if (!Number.isInteger(revision) || !key) return void res.status(400).json({ error: "Revision and idempotency key are required" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query(`select * from news_posts where id=$1 for update`, [req.params.postId]);
    const post = locked.rows[0];
    if (!post) { await client.query("rollback"); return void res.status(404).json({ error: "Post not found" }); }
    if (post.send_idempotency_key === key && post.status !== "draft") { await client.query("commit"); return void res.json({ ok: true, postId: post.id, status: post.status }); }
    if (post.status !== "draft" || post.content_revision !== revision) { await client.query("rollback"); return void res.status(409).json({ error: "Draft changed or was already sent" }); }
    if (post.staged_at) {
      await client.query("rollback");
      return void res.status(409).json({ error: "Return this post to draft before sending it with push" });
    }
    const stats = await loadNewsReadinessStats(
      (text, values) => client.query(text, values),
      post.id,
    );
    const readinessError = newsPostReadinessError(post, stats);
    if (readinessError) {
      await client.query("rollback"); return void res.status(400).json({ error: readinessError });
    }
    if (post.audience !== "specific_user" && process.env.NEWS_BULK_SEND_ENABLED !== "true") { await client.query("rollback"); return void res.status(403).json({ error: "Bulk sending is disabled until the mobile news reader is released", code: "BULK_DISABLED" }); }
    let resolvedTargetUserId: string | null = post.target_user_id;
    if (post.audience === "specific_user" && !resolvedTargetUserId) {
      const target = await client.query<{ id: string }>(
        `select id from profiles where lower(email)=lower($1) and role <> 'admin' limit 1`,
        [post.target_email ?? ""],
      );
      resolvedTargetUserId = target.rows[0]?.id ?? null;
      if (!resolvedTargetUserId) {
        await client.query("rollback");
        return void res.status(400).json({ error: "No non-admin account has that test email address. Check the email or sign into that test account once first." });
      }
      await client.query(`update news_posts set target_user_id=$2 where id=$1`, [post.id, resolvedTargetUserId]);
    }
    await client.query(`insert into news_post_recipients(post_id,user_id)
      select $1,p.id from profiles p where p.role<>'admin' and (
        ($2='specific_user' and p.id=$3) or $2='everyone' or
        ($2='paid_general' and p.role='general' and p.subscription_tier in ('standard','pro')) or
        ($2='sales_agent' and p.role='sales_agent') or ($2='service_provider' and p.role='service_provider')
      ) on conflict do nothing`, [post.id, post.audience, resolvedTargetUserId]);
    await client.query(`insert into news_post_deliveries(post_id,user_id,guest_session_id,push_token_id,locale)
      select $1,r.user_id,null,t.id,coalesce(t.locale,'en')
      from news_post_recipients r join push_tokens t on t.user_id=r.user_id
      where r.post_id=$1 and t.news_capable_at is not null
      on conflict(post_id,push_token_id) do nothing`, [post.id]);
    if (post.audience === "everyone") {
      await client.query(`insert into news_post_guest_recipients(post_id,guest_session_id)
        select $1,g.id from news_guest_sessions g where g.claimed_by_user_id is null
        on conflict do nothing`, [post.id]);
      await client.query(`insert into news_post_deliveries(post_id,user_id,guest_session_id,push_token_id,locale)
        select $1,null,g.guest_session_id,t.id,coalesce(t.locale,'en')
        from news_post_guest_recipients g join push_tokens t on t.guest_session_id=g.guest_session_id
        where g.post_id=$1 and t.news_capable_at is not null
        on conflict(post_id,push_token_id) do nothing`, [post.id]);
    }
    const deliveryCount = await client.query<{ count: string }>(`select count(*)::text count from news_post_deliveries where post_id=$1`, [post.id]);
    const hasDevices = Number(deliveryCount.rows[0]?.count ?? 0) > 0;
    if (post.audience === "specific_user" && !hasDevices) {
      await client.query("rollback");
      return void res.status(409).json({
        error: "This account has no News-capable push device. Open the latest app, sign in with this email, allow notifications, then try again.",
        code: "NO_NEWS_CAPABLE_DEVICE",
      });
    }
    await client.query(
      `update news_posts set status=$3,send_idempotency_key=$2,send_started_at=now(),published_at=now(),
       released_at=now(),publication_mode='push',
       published_sequence=nextval('news_post_publish_sequence'),updated_at=now() where id=$1`,
      [post.id, key, hasDevices ? "queued" : "sent"],
    );
    await client.query("commit");
    const counts = await audienceCounts(post.id);
    runAfterResponse(runNewsDispatch().catch((error) => req.log.error({ error }, "Immediate news dispatch failed")));
    res.status(202).json({ ok: true, postId: post.id, status: hasDevices ? "queued" : "sent", ...counts });
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    req.log.error({ error }, "Admin news send failed");
    if (sendNewsSetupError(res, error)) return;
    res.status(500).json({ error: "Failed to queue post" });
  } finally { client.release(); }
});

router.post("/admin/news-posts/:postId/archive", requireAdmin, async (req, res) => {
  const archive = req.body?.archive !== false;
  const result = await pool.query(`update news_posts set status=case when $2 then 'archived' else case when published_at is null then 'draft' else 'sent' end end,archived_at=case when $2 then now() else null end,staged_at=case when $2 then null else staged_at end,updated_at=now() where id=$1 returning status`, [req.params.postId, archive]);
  if (!result.rows[0]) return void res.status(404).json({ error: "Post not found" });
  res.json({ ok: true, status: result.rows[0].status });
});

router.post("/admin/news-posts/:postId/retry-unknown", requireAdmin, async (req, res) => {
  const result = await pool.query(`update news_post_deliveries set status='queued',last_error_code=null,last_error_message=null where post_id=$1 and status='unknown' returning id`, [req.params.postId]);
  runAfterResponse(runNewsDispatch());
  res.json({ queued: result.rowCount ?? 0 });
});

// Every public News route resolves a valid account or a pseudonymous guest.
router.use("/news", optionalAuth, publicNewsLimit, guestInstallationLimit);

router.post("/news/session", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req, true);
    res.json({ ok: true, viewerType: viewer.userId ? "user" : "guest" });
  } catch (error) {
    if (sendNewsSetupError(res, error)) return;
    viewerError(res, error);
  }
});

router.post("/news/push-token", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const platform = req.body?.platform === "ios" ? "ios" : req.body?.platform === "android" ? "android" : "";
  const locale = req.body?.locale === "zh" ? "zh" : "en";
  if (!EXPO_TOKEN_RE.test(token) || !platform) return void res.status(400).json({ error: "Invalid push token or platform" });
  try {
    const viewer = await resolveNewsViewer(req);
    const [ownerUserId, ownerGuestId] = newsOwnerValues(viewer);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await lockActiveGuestNewsViewer(client, viewer);
      await client.query(
        `insert into push_tokens(user_id,guest_session_id,token,platform,locale,news_capable_at,updated_at)
         values($1,$2,$3,$4,$5,now(),now())
         on conflict(token) do update set user_id=excluded.user_id,guest_session_id=excluded.guest_session_id,
           platform=excluded.platform,locale=excluded.locale,news_capable_at=now(),updated_at=now()`,
        [ownerUserId, ownerGuestId, token, platform, locale],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    res.json({ ok: true });
  } catch (error) {
    if (sendNewsSetupError(res, error)) return;
    viewerError(res, error);
  }
});

async function latestVisibleSequence(viewer: NewsViewer): Promise<number> {
  const result = await pool.query<{ sequence: number | null }>(
    `select max(p.published_sequence)::integer sequence from news_posts p
     where p.published_at is not null and p.archived_at is null and ${canAccessNewsSql("p", 1)}`,
    [viewer.isAdmin, viewer.userId, viewer.guestSessionId],
  );
  return Number(result.rows[0]?.sequence ?? 0);
}

router.get("/news/unread-status", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const [latest, state] = await Promise.all([
      latestVisibleSequence(viewer),
      pool.query<{ last_seen_sequence: number }>(`select last_seen_sequence from news_viewer_states where viewer_key=$1`, [viewer.key]),
    ]);
    const lastSeen = Number(state.rows[0]?.last_seen_sequence ?? 0);
    res.json({ hasUnread: latest > lastSeen, latestSequence: latest, lastSeenSequence: lastSeen });
  } catch (error) { viewerError(res, error); }
});

router.patch("/news/seen-through", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const through = clampNewsSeenSequence(req.body?.throughSequence, await latestVisibleSequence(viewer));
    const [ownerUserId, ownerGuestId] = newsOwnerValues(viewer);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await lockActiveGuestNewsViewer(client, viewer);
      await client.query(
        `insert into news_viewer_states(viewer_key,user_id,guest_session_id,last_seen_sequence,updated_at)
         values($1,$2,$3,$4,now())
         on conflict(viewer_key) do update set
           last_seen_sequence=greatest(news_viewer_states.last_seen_sequence,excluded.last_seen_sequence),updated_at=now()`,
        [viewer.key, ownerUserId, ownerGuestId, through],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    res.json({ ok: true, lastSeenSequence: through });
  } catch (error) { viewerError(res, error); }
});

router.get("/news", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const before = typeof req.query.before === "string" ? req.query.before : null;
    const locale = req.get("x-locale")?.toLowerCase().startsWith("zh") ? "zh" : "en";
    const result = await pool.query(
      `select p.id,p.published_at,p.published_sequence,
        case when $4='zh' then p.title_zh else p.title_en end title,
        left(coalesce((select string_agg(case when $4='zh' then b.text_zh else b.text_en end,' ' order by b.sort_order)
          from news_post_blocks b where b.post_id=p.id and b.block_type='text'),
          case when $4='zh' then p.body_zh else p.body_en end),240) excerpt,
        coalesce((select b.image_id from news_post_blocks b where b.post_id=p.id and b.block_type='image' order by b.sort_order limit 1),
          (select i.id from news_post_images i where i.post_id=p.id order by i.sort_order limit 1)) hero_image_id,
        (select count(*)::integer from news_post_images i where i.post_id=p.id) image_count
       from news_posts p
       where p.published_at is not null and p.archived_at is null and ${canAccessNewsSql("p", 1)}
         and ($5::timestamptz is null or p.published_at<$5)
       order by p.published_sequence desc,p.published_at desc limit $6`,
      [viewer.isAdmin, viewer.userId, viewer.guestSessionId, locale, before, limit],
    );
    res.json({
      posts: result.rows.map((row) => ({
        id: row.id, title: row.title, excerpt: row.excerpt, publishedAt: row.published_at,
        publishedSequence: Number(row.published_sequence), imageCount: Number(row.image_count),
        heroImageUrl: row.hero_image_id ? `/api/news/${row.id}/images/${row.hero_image_id}` : null,
      })),
      nextCursor: result.rows.length === limit ? result.rows.at(-1)?.published_at : null,
    });
  } catch (error) { viewerError(res, error); }
});

router.get("/news/:postId", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const locale = req.get("x-locale")?.toLowerCase().startsWith("zh") ? "zh" : "en";
    const result = await pool.query(
      `select p.id,p.published_at,p.published_sequence,
        case when $5='zh' then p.title_zh else p.title_en end title,
        case when $5='zh' then p.body_zh else p.body_en end body
       from news_posts p where p.id=$1 and p.published_at is not null and p.archived_at is null and ${canAccessNewsSql("p")}`,
      [req.params.postId, viewer.isAdmin, viewer.userId, viewer.guestSessionId, locale],
    );
    if (!result.rows[0]) return void res.status(404).json({ error: "Post not found" });
    const blocks = await pool.query(
      `select b.block_type,b.sort_order,b.image_id,case when $2='zh' then b.text_zh else b.text_en end text
       from news_post_blocks b where b.post_id=$1 order by b.sort_order`,
      [req.params.postId, locale],
    );
    const normalized = blocks.rows.length ? blocks.rows.map((block) => block.block_type === "image"
      ? { type: "image", imageId: block.image_id, url: `/api/news/${req.params.postId}/images/${block.image_id}` }
      : { type: "text", text: block.text ?? "" })
      : [{ type: "text", text: result.rows[0].body }];
    res.json({ id: result.rows[0].id, title: result.rows[0].title, body: result.rows[0].body, publishedAt: result.rows[0].published_at, publishedSequence: Number(result.rows[0].published_sequence), blocks: normalized });
  } catch (error) { viewerError(res, error); }
});

router.post("/news/:postId/push-open", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await lockActiveGuestNewsViewer(client, viewer);
      const allowed = await client.query(`select 1 from news_posts p where p.id=$1 and p.published_at is not null and p.archived_at is null and ${canAccessNewsSql("p")}`, [req.params.postId, viewer.isAdmin, viewer.userId, viewer.guestSessionId]);
      if (!allowed.rows[0]) { await client.query("rollback"); return void res.status(404).json({ error: "Post not found" }); }
      const [ownerUserId, ownerGuestId] = newsOwnerValues(viewer);
      await client.query(
        `insert into news_post_engagements(post_id,viewer_key,user_id,guest_session_id,first_push_opened_at)
         values($1,$2,$3,$4,now())
         on conflict(post_id,viewer_key) do update set first_push_opened_at=coalesce(news_post_engagements.first_push_opened_at,now())`,
        [req.params.postId, viewer.key, ownerUserId, ownerGuestId],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    res.json({ ok: true });
  } catch (error) { viewerError(res, error); }
});

router.put("/news/:postId/read-sessions/:sessionId", async (req, res) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const seconds = Math.min(86_400, Math.max(0, Math.floor(Number(req.body?.activeSeconds) || 0)));
    const source = req.body?.entrySource === "push" ? "push" : "feed";
    const ended = req.body?.ended === true;
    const sessionId = req.params.sessionId || randomUUID();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await lockActiveGuestNewsViewer(client, viewer);
      const allowed = await client.query(`select 1 from news_posts p where p.id=$1 and p.published_at is not null and p.archived_at is null and ${canAccessNewsSql("p")}`, [req.params.postId, viewer.isAdmin, viewer.userId, viewer.guestSessionId]);
      if (!allowed.rows[0]) { await client.query("rollback"); return void res.status(404).json({ error: "Post not found" }); }
      const [ownerUserId, ownerGuestId] = newsOwnerValues(viewer);
      await client.query(
        `insert into news_post_engagements(post_id,viewer_key,user_id,guest_session_id)
         values($1,$2,$3,$4) on conflict(post_id,viewer_key) do nothing`,
        [req.params.postId, viewer.key, ownerUserId, ownerGuestId],
      );
      const session = await client.query(
        `insert into news_post_read_sessions(id,post_id,viewer_key,user_id,guest_session_id,entry_source,active_seconds,ended_at)
         values($1,$2,$3,$4,$5,$6,$7,case when $8 then now() else null end)
         on conflict(id) do update set active_seconds=greatest(news_post_read_sessions.active_seconds,excluded.active_seconds),
           last_heartbeat_at=now(),ended_at=case when $8 then coalesce(news_post_read_sessions.ended_at,now()) else news_post_read_sessions.ended_at end
         where news_post_read_sessions.post_id=$2 and news_post_read_sessions.viewer_key=$3 returning active_seconds`,
        [sessionId, req.params.postId, viewer.key, ownerUserId, ownerGuestId, source, seconds, ended],
      );
      if (!session.rows[0]) { await client.query("rollback"); return void res.status(409).json({ error: "Reading session belongs to another viewer" }); }
      if (Number(session.rows[0].active_seconds) >= 5) {
        await client.query(`update news_post_engagements set first_read_at=coalesce(first_read_at,now()),last_read_at=now() where post_id=$1 and viewer_key=$2`, [req.params.postId, viewer.key]);
      }
      await client.query("commit");
      res.json({ ok: true, activeSeconds: Number(session.rows[0].active_seconds) });
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } catch (error) {
    req.log.error({ error }, "News read session failed");
    const status = Number((error as { status?: number })?.status);
    if (status) viewerError(res, error); else res.status(500).json({ error: "Failed to record reading session" });
  }
});

router.get("/news/:postId/images/:imageId", async (req: Request, res: Response) => {
  try {
    const viewer = await resolveNewsViewer(req);
    const allowed = await pool.query<{ object_path: string }>(
      `select i.object_path from news_post_images i join news_posts p on p.id=i.post_id
       where i.id=$1 and i.post_id=$2 and (
         $3::boolean or (p.published_at is not null and p.archived_at is null and ${canAccessNewsSql("p", 3)})
       )`,
      [req.params.imageId, req.params.postId, viewer.isAdmin, viewer.userId, viewer.guestSessionId],
    );
    if (!allowed.rows[0]) return void res.status(404).end();
    const s3Key = s3StorageService.keyForObjectPath(allowed.rows[0].object_path);
    if (s3Key) {
      const response = await s3StorageService.download(s3Key);
      res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) { const { Readable } = await import("node:stream"); Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>).pipe(res); } else res.end();
      return;
    }
    if (storage.isLocal) {
      const local = storage.readLocalFile(allowed.rows[0].object_path);
      res.setHeader("Content-Type", local.contentType); res.setHeader("Content-Length", local.size); local.stream.pipe(res); return;
    }
    const file = await storage.getObjectEntityFile(allowed.rows[0].object_path);
    const response = await storage.downloadObject(file);
    res.status(response.status); response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) { const { Readable } = await import("node:stream"); Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>).pipe(res); } else res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return void res.status(404).end();
    if (Number((error as { status?: number })?.status)) return viewerError(res, error);
    req.log.error({ error }, "News image failed"); res.status(500).end();
  }
});

export async function runNewsWorkers() {
  let dispatch = { claimed: 0, accepted: 0, failed: 0 };
  for (let batch = 0; batch < 6; batch += 1) {
    const result = await runNewsDispatch();
    dispatch = { claimed: dispatch.claimed + result.claimed, accepted: dispatch.accepted + result.accepted, failed: dispatch.failed + result.failed };
    if (result.claimed < 100) break;
  }
  const receipts = await runNewsReceiptCheck();
  return { dispatch, receipts };
}

export default router;
