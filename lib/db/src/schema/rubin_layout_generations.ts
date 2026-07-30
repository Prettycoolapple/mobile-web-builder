import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { rubinLayouts } from "./rubin_layouts";

/**
 * One row per generation event — including the ones that deduped.
 *
 * `rubin_layouts` deliberately keeps only distinct geometry, which would
 * otherwise erase the two things that make the corpus interpretable: how many
 * times a layout was arrived at (a layout five users independently landed on is
 * evidence about the site, not noise), and who to attribute it to. That is what
 * this table is for.
 *
 * It is written on **every** save, whether the layout was new or already known.
 */
export const rubinLayoutGenerations = pgTable(
  "rubin_layout_generations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    layoutId: text("layout_id")
      .references(() => rubinLayouts.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    /** Where the run came from; only `embed` exists today. */
    source: text("source").default("embed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("rubin_layout_generations_layout_idx").on(t.layoutId),
    index("rubin_layout_generations_user_time_idx").on(t.userId, t.createdAt),
  ],
);

export type RubinLayoutGeneration = typeof rubinLayoutGenerations.$inferSelect;
export type InsertRubinLayoutGeneration = typeof rubinLayoutGenerations.$inferInsert;
