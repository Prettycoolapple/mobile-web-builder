import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import { buildNewsPushMessage } from "../news-push";

describe("news push presentation", () => {
  it("shows the app name above the localized post title", () => {
    const base = { token: "ExpoPushToken[test]", titleEn: "Market update", titleZh: "市场动态", postId: "post-1" };
    expect(buildNewsPushMessage({ ...base, locale: "en" })).toMatchObject({
      title: "Project Alpha", body: "Market update", data: { type: "news_post", postId: "post-1" },
    });
    expect(buildNewsPushMessage({ ...base, locale: "zh" }).body).toBe("市场动态");
  });
});
