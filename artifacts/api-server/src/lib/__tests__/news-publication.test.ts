import { describe, expect, it } from "vitest";
import { newsPostReadinessError, releaseStagedNewsPosts, type NewsReadinessStats } from "../news-publication";

const readyStats: NewsReadinessStats = {
  block_count: "3",
  text_block_count: "2",
  invalid_text_count: "0",
};

describe("news publication readiness", () => {
  it("accepts a complete reviewed bilingual post", () => {
    expect(newsPostReadinessError({
      title_en: "Market update",
      title_zh: "市场动态",
      translation_stale: false,
    }, readyStats)).toBeNull();
  });

  it("rejects stale, empty, image-only, and partially translated posts", () => {
    const complete = { title_en: "Market update", title_zh: "市场动态", translation_stale: false };
    expect(newsPostReadinessError({ ...complete, translation_stale: true }, readyStats)).toBeTruthy();
    expect(newsPostReadinessError({ ...complete, title_zh: "" }, readyStats)).toBeTruthy();
    expect(newsPostReadinessError(complete, { ...readyStats, text_block_count: "0" })).toBeTruthy();
    expect(newsPostReadinessError(complete, { ...readyStats, invalid_text_count: "1" })).toBeTruthy();
  });
});

describe("silent launch release", () => {
  it("locks and releases the complete staged set without creating push deliveries", async () => {
    const statements: string[] = [];
    const query = async (sql: string) => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("from news_release_batches where")) return { rows: [] };
      if (sql.includes("select * from news_posts")) return {
        rows: [
          { id: "older", audience: "everyone", title_en: "Old", title_zh: "旧", translation_stale: false },
          { id: "newer", audience: "everyone", title_en: "New", title_zh: "新", translation_stale: false },
        ],
      };
      if (sql.includes("count(*)::text block_count")) return { rows: [readyStats] };
      if (sql.includes("insert into news_release_batches")) return { rows: [{ released_at: "2026-07-24T00:00:00Z" }] };
      return { rows: [] };
    };

    await expect(releaseStagedNewsPosts(query, {
      idempotencyKey: "release-key-1",
      releasedBy: "admin-1",
    })).resolves.toEqual({
      postCount: 2,
      releasedAt: "2026-07-24T00:00:00Z",
      replayed: false,
    });

    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements.find((sql) => sql.includes("select * from news_posts"))).toContain("order by created_at,id");
    expect(statements.filter((sql) => sql.includes("nextval('news_post_publish_sequence')"))).toHaveLength(2);
    expect(statements.some((sql) => sql.includes("insert into news_post_deliveries"))).toBe(false);
    expect(statements.filter((sql) => sql.includes("publication_mode='silent_backfill'"))).toHaveLength(2);
  });

  it("returns an idempotent replay before touching staged posts", async () => {
    const statements: string[] = [];
    const query = async (sql: string) => {
      statements.push(sql);
      if (sql.includes("from news_release_batches where")) {
        return { rows: [{ post_count: 20, released_at: "2026-07-24T00:00:00Z" }] };
      }
      return { rows: [] };
    };

    await expect(releaseStagedNewsPosts(query, {
      idempotencyKey: "release-key-1",
      releasedBy: "admin-1",
    })).resolves.toMatchObject({ postCount: 20, replayed: true });
    expect(statements.some((sql) => sql.includes("select * from news_posts"))).toBe(false);
  });
});
