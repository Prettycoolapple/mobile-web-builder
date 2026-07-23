import { describe, expect, it, vi } from "vitest";

const poolMocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: poolMocks }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import { buildNewsPushMessage, runNewsDispatch } from "../news-push";

describe("news push presentation", () => {
  it("shows the app name above the localized post title", () => {
    const base = { token: "ExpoPushToken[test]", titleEn: "Market update", titleZh: "市场动态", postId: "post-1" };
    expect(buildNewsPushMessage({ ...base, locale: "en" })).toMatchObject({
      title: "Project Alpha", body: "Market update", data: { type: "news_post", postId: "post-1" },
    });
    expect(buildNewsPushMessage({ ...base, locale: "zh" }).body).toBe("市场动态");
  });

  it("skips legacy tokens and only claims News-capable devices", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes("returning d.id")) return { rows: [] };
      return { rows: [] };
    });
    poolMocks.query.mockResolvedValue({ rows: [] });
    poolMocks.connect.mockResolvedValue({ query: clientQuery, release: vi.fn() });

    await expect(runNewsDispatch()).resolves.toEqual({ claimed: 0, accepted: 0, failed: 0 });

    expect(String(poolMocks.query.mock.calls[0]?.[0])).toContain("t.news_capable_at is null");
    const claimSql = clientQuery.mock.calls.map((call) => String(call[0])).find((sql) => sql.includes("returning d.id"));
    expect(claimSql).toContain("t.news_capable_at is not null");
  });
});
