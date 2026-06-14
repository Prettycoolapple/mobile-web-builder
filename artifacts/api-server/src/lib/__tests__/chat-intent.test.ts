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
      discoveryPresentation: "scored_screening",
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
    expect(intent.discoveryPresentation).toBe("scored_screening");
  });

  it("classifies currently available suburb searches as generic listing discovery", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "market",
      execution: "show_listing_cards",
      confidence: 0.95,
      mode: "discover",
      address: null,
      suburb: "st heliers",
      minPrice: null,
      maxPrice: null,
      criteria: "currently available listings in Saint Heliers",
      discoveryPresentation: "generic_listing",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "The user is asking to browse current listings.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What is currently available in Saint Heliers?" },
    ]);

    expect(intent.intentCategory).toBe("property_discovery");
    expect(intent.execution).toBe("show_listing_cards");
    expect(intent.mode).toBe("discover");
    expect(intent.discoveryPresentation).toBe("generic_listing");
  });

  it("classifies currently on-market suburb searches as generic listing discovery", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "market",
      execution: "show_listing_cards",
      confidence: 0.95,
      mode: "discover",
      address: null,
      suburb: "highland park",
      minPrice: null,
      maxPrice: null,
      criteria: "currently on the market in Highland Park",
      discoveryPresentation: "generic_listing",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "The user is asking to browse current listings.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What's currently on the market in Highland Park?" },
    ]);

    expect(intent.mode).toBe("discover");
    expect(intent.discoveryPresentation).toBe("generic_listing");
  });

  it("classifies area-wide subdividable searches as scored screening discovery", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.95,
      mode: "discover",
      address: null,
      suburb: "orakei",
      minPrice: null,
      maxPrice: null,
      criteria: "subdividable properties in Orakei",
      discoveryPresentation: "scored_screening",
      isFollowUp: false,
      includeNegotiation: true,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: true,
      reasoning: "The user wants subdivision opportunities.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What is subdividable in Orakei?" },
    ]);

    expect(intent.mode).toBe("discover");
    expect(intent.discoveryPresentation).toBe("scored_screening");
  });

  it("resets a fresh plain availability search to generic after earlier subdivision context", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "market",
      execution: "show_listing_cards",
      confidence: 0.95,
      mode: "discover",
      address: null,
      suburb: "st heliers",
      minPrice: null,
      maxPrice: null,
      criteria: "currently available listings in Saint Heliers",
      discoveryPresentation: "generic_listing",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "The latest message is a fresh plain availability search.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What is subdividable in Orakei?" },
      { role: "assistant", content: "I found a few subdivision opportunities in Orakei." },
      { role: "user", content: "What is currently available in Saint Heliers?" },
    ]);

    expect(intent.mode).toBe("discover");
    expect(intent.discoveryPresentation).toBe("generic_listing");
  });

  it("keeps a price clarification after subdivision discovery as scored screening", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.9,
      mode: "discover",
      address: null,
      suburb: "orakei",
      minPrice: 2500000,
      maxPrice: 3000000,
      criteria: "subdividable properties in Orakei between $2.5M and $3M",
      discoveryPresentation: "scored_screening",
      isFollowUp: true,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: true,
      reasoning: "The user answered the price question for an existing subdivision search.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What is subdividable in Orakei?" },
      { role: "assistant", content: "Do you have a price range in mind?" },
      { role: "user", content: "$2.5M-$3M" },
    ]);

    expect(intent.mode).toBe("discover");
    expect(intent.minPrice).toBe(2500000);
    expect(intent.maxPrice).toBe(3000000);
    expect(intent.discoveryPresentation).toBe("scored_screening");
  });

  it("falls back to generic listing discovery when LLM parsing fails for currently available searches", async () => {
    mockedGenerateContent.mockRejectedValueOnce(new Error("llm unavailable"));

    const intent = await extractChatIntent([
      { role: "user", content: "What is currently available in Saint Heliers?" },
    ]);

    expect(intent.mode).toBe("discover");
    expect(intent.discoveryPresentation).toBe("generic_listing");
  });
});
