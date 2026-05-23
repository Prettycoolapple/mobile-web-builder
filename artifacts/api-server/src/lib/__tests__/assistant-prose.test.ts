import { describe, expect, it } from "vitest";
import { sanitizeAssistantProse } from "../claude";

describe("assistant prose sanitizing", () => {
  it("removes generic follow-up disclaimers and provider outros", () => {
    const cleaned = sanitizeAssistantProse(
      [
        "The best ROI path is to hold the existing dwelling first and avoid the rebuild cost stack.",
        "以上基于已获取数据的分析。如需进一步探讨某个具体策略，我可以从 Project Alpha 的数据库中查看是否有已签约的服务提供商可供推荐。",
      ].join("\n\n"),
      "zh",
    );

    expect(cleaned).toBe("The best ROI path is to hold the existing dwelling first and avoid the rebuild cost stack.");
  });
});
