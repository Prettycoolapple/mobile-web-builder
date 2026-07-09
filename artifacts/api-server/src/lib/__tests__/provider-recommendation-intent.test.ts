import { describe, expect, it } from "vitest";
import { detectProviderRecommendationIntent } from "../provider-recommendation-intent";

describe("provider recommendation intent fallback", () => {
  it("detects Chinese architect/designer recommendation requests", () => {
    expect(detectProviderRecommendationIntent("\u4e3a\u6211\u63a8\u8350\u5efa\u7b51\u5e08\u6216\u8bbe\u8ba1\u5e08")).toMatchObject({
      wantsProviderRecommendation: true,
      wantsAnotherProvider: false,
      suggestedDiscipline: "architect_designer",
    });
  });

  it("detects short mixed-language engineer follow-ups", () => {
    expect(detectProviderRecommendationIntent("Civil\u5de5\u7a0b\u5e08\u5462")).toMatchObject({
      wantsProviderRecommendation: true,
      wantsAnotherProvider: false,
      suggestedDiscipline: "engineer",
    });
  });

  it("detects Chinese planner recommendation requests", () => {
    expect(detectProviderRecommendationIntent("\u63a8\u8350\u89c4\u5212\u5e08")).toMatchObject({
      wantsProviderRecommendation: true,
      wantsAnotherProvider: false,
      suggestedDiscipline: "planner",
    });
  });

  it("does not classify ordinary long engineering questions as provider requests", () => {
    expect(detectProviderRecommendationIntent("What civil engineering constraints affect subdivision on this site?")).toMatchObject({
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
    });
  });
});
