import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: vi.fn(),
    },
  },
}));

import { ai } from "@workspace/integrations-gemini-ai";
import { extractChatIntent } from "../claude";

const mockedGenerateContent = vi.mocked(ai.models.generateContent);

function mockIntentJson(intent: Record<string, unknown>) {
  mockedGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(intent) } as Awaited<ReturnType<typeof ai.models.generateContent>>);
}

describe("chat intent extraction", () => {
  beforeEach(() => {
    mockedGenerateContent.mockReset();
  });

  it("lets semantic answer-in-chat execution override a legacy discover mode", async () => {
    mockIntentJson({
      intentCategory: "rules_explanation",
      subject: "subdivision",
      execution: "answer_in_chat",
      confidence: 0.93,
      mode: "discover",
      address: null,
      suburb: "coatesville",
      minPrice: null,
      maxPrice: null,
      criteria: "subdivision rules in coatesville",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "The user asks for rules, not listings.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "what is the subdivision rules in coatesville" },
    ]);

    expect(intent.intentCategory).toBe("rules_explanation");
    expect(intent.subject).toBe("subdivision");
    expect(intent.execution).toBe("answer_in_chat");
    expect(intent.mode).toBe("followup");
  });

  it("routes explicit subdivision listing searches to listing cards", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.9,
      mode: "discover",
      address: null,
      suburb: "coatesville",
      minPrice: null,
      maxPrice: null,
      criteria: "subdividable properties in coatesville",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: true,
      reasoning: "The user asks to show properties.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "show me subdividable properties in coatesville" },
    ]);

    expect(intent.intentCategory).toBe("property_discovery");
    expect(intent.execution).toBe("show_listing_cards");
    expect(intent.mode).toBe("discover");
  });
});
