import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { profiles } from "./profiles";
import { rubinLayouts } from "./rubin_layouts";

/**
 * What each user sees when they reopen a site: their most recent layout for it.
 *
 * Overwritten on every save, unlike the corpus. The two are answering different
 * questions — "which layouts exist for this site" versus "which one is *mine*,
 * now" — and conflating them would mean either the corpus losing options or the
 * user being handed back a layout they had already replaced.
 *
 * `geo_key` is duplicated from the layout row on purpose: the app's Rubin screen
 * looks a saved layout up before the site has finished loading, when it has
 * coordinates and no parcel id yet.
 */
export const rubinUserLayouts = pgTable(
  "rubin_user_layouts",
  {
    userId: text("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    /** `parcel:{parcelId}` when known, else the geo key. */
    siteKey: text("site_key").notNull(),
    /** `{lat4}:{lng4}` — the coordinate-only lookup path. */
    geoKey: text("geo_key").notNull(),
    layoutId: text("layout_id")
      .references(() => rubinLayouts.id, { onDelete: "cascade" })
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.siteKey] }),
    index("rubin_user_layouts_user_geo_idx").on(t.userId, t.geoKey),
  ],
);

export type RubinUserLayout = typeof rubinUserLayouts.$inferSelect;
export type InsertRubinUserLayout = typeof rubinUserLayouts.$inferInsert;
