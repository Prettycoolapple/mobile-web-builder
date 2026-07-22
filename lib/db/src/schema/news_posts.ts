import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { pushTokens } from "./push_tokens";
import { newsGuestSessions } from "./news_guests";

export const newsPosts = pgTable(
  "news_posts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    createdBy: text("created_by").notNull().references(() => profiles.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("draft"),
    sourceLanguage: text("source_language").notNull(),
    titleEn: text("title_en").notNull().default(""),
    bodyEn: text("body_en").notNull().default(""),
    titleZh: text("title_zh").notNull().default(""),
    bodyZh: text("body_zh").notNull().default(""),
    audience: text("audience").notNull().default("specific_user"),
    targetUserId: text("target_user_id").references(() => profiles.id, { onDelete: "restrict" }),
    translationStale: boolean("translation_stale").notNull().default(true),
    contentRevision: integer("content_revision").notNull().default(1),
    sendIdempotencyKey: text("send_idempotency_key").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    sendStartedAt: timestamp("send_started_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    publishedSequence: integer("published_sequence").unique(),
  },
  (table) => [index("news_posts_status_created_idx").on(table.status, table.createdAt)],
);

export const newsPostImages = pgTable(
  "news_post_images",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("news_post_images_post_order_unique").on(table.postId, table.sortOrder)],
);

export const newsPostBlocks = pgTable(
  "news_post_blocks",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    blockType: text("block_type").notNull(),
    sortOrder: integer("sort_order").notNull(),
    textEn: text("text_en"),
    textZh: text("text_zh"),
    imageId: text("image_id").references(() => newsPostImages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("news_post_blocks_type_check", sql`${table.blockType} in ('text','image')`),
    check("news_post_blocks_shape_check", sql`(${table.blockType}='text' and ${table.imageId} is null and ${table.textEn} is not null and ${table.textZh} is not null) or (${table.blockType}='image' and ${table.imageId} is not null and ${table.textEn} is null and ${table.textZh} is null)`),
    uniqueIndex("news_post_blocks_post_order_unique").on(table.postId, table.sortOrder),
    uniqueIndex("news_post_blocks_post_image_unique").on(table.postId, table.imageId),
  ],
);

export const newsPostRecipients = pgTable(
  "news_post_recipients",
  {
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    firstPushOpenedAt: timestamp("first_push_opened_at", { withTimezone: true }),
    firstReadAt: timestamp("first_read_at", { withTimezone: true }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),
    index("news_post_recipients_user_idx").on(table.userId, table.createdAt),
  ],
);

export const newsPostGuestRecipients = pgTable(
  "news_post_guest_recipients",
  {
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").notNull().references(() => newsGuestSessions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.guestSessionId] }),
    index("news_post_guest_recipients_guest_idx").on(table.guestSessionId, table.createdAt),
  ],
);

export const newsPostDeliveries = pgTable(
  "news_post_deliveries",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").references(() => newsGuestSessions.id, { onDelete: "cascade" }),
    pushTokenId: text("push_token_id").references(() => pushTokens.id, { onDelete: "set null" }),
    locale: text("locale").notNull(),
    status: text("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    expoTicketId: text("expo_ticket_id"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    receiptCheckedAt: timestamp("receipt_checked_at", { withTimezone: true }),
  },
  (table) => [
    check("news_post_deliveries_owner_check", sql`(${table.userId} is not null)::integer + (${table.guestSessionId} is not null)::integer = 1`),
    uniqueIndex("news_post_deliveries_post_token_unique").on(table.postId, table.pushTokenId),
    index("news_post_deliveries_worker_idx").on(table.status, table.leaseExpiresAt, table.createdAt),
    index("news_post_deliveries_ticket_idx").on(table.expoTicketId),
  ],
);

export const newsPostReadSessions = pgTable(
  "news_post_read_sessions",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    userId: text("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").references(() => newsGuestSessions.id, { onDelete: "cascade" }),
    entrySource: text("entry_source").notNull(),
    activeSeconds: integer("active_seconds").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    check("news_post_read_sessions_owner_check", sql`(${table.userId} is not null)::integer + (${table.guestSessionId} is not null)::integer = 1`),
    index("news_post_read_sessions_post_viewer_idx").on(table.postId, table.viewerKey, table.startedAt),
  ],
);

export const newsViewerStates = pgTable(
  "news_viewer_states",
  {
    viewerKey: text("viewer_key").primaryKey(),
    userId: text("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").references(() => newsGuestSessions.id, { onDelete: "cascade" }),
    lastSeenSequence: integer("last_seen_sequence").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("news_viewer_states_owner_check", sql`(${table.userId} is not null)::integer + (${table.guestSessionId} is not null)::integer = 1`)],
);

export const newsPostEngagements = pgTable(
  "news_post_engagements",
  {
    postId: text("post_id").notNull().references(() => newsPosts.id, { onDelete: "cascade" }),
    viewerKey: text("viewer_key").notNull(),
    userId: text("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").references(() => newsGuestSessions.id, { onDelete: "cascade" }),
    firstPushOpenedAt: timestamp("first_push_opened_at", { withTimezone: true }),
    firstReadAt: timestamp("first_read_at", { withTimezone: true }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("news_post_engagements_owner_check", sql`(${table.userId} is not null)::integer + (${table.guestSessionId} is not null)::integer = 1`),
    primaryKey({ columns: [table.postId, table.viewerKey] }),
    index("news_post_engagements_post_read_idx").on(table.postId, table.firstReadAt),
  ],
);

export type NewsPost = typeof newsPosts.$inferSelect;
export type NewsPostImage = typeof newsPostImages.$inferSelect;
export type NewsPostBlock = typeof newsPostBlocks.$inferSelect;
