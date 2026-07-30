import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: vi.fn(),
    },
  },
}));

import { ai } from "@workspace/integrations-gemini-ai";
import {
  detectMode,
  extractChatIntent,
  isListingBrowseIntent,
  isListingBrowseContinuation,
  normaliseAdditionalSuburbs,
  normaliseIncludeTenures,
} from "../claude";

const mockedGenerateContent = vi.mocked(ai.models.generateContent);

function mockIntentJson(intent: Record<string, unknown>) {
  mockedGenerateContent.mockResolvedValueOnce({ text: JSON.stringify(intent) } as Awaited<ReturnType<typeof ai.models.generateContent>>);
}

describe("chat intent extraction", () => {
  beforeEach(() => {
    mockedGenerateContent.mockReset();
  });

  it("routes nearby amenity questions to chat, not listing cards or analysis", async () => {
    mockIntentJson({
      intentCategory: "single_property_analysis",
      subject: "unknown",
      execution: "run_feasibility_report",
      confidence: 0.6,
      mode: "analyse",
      address: "33 Harris Road",
      suburb: null,
      minPrice: null,
      maxPrice: null,
      criteria: "nearby schools and hospitals",
      discoveryPresentation: null,
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      nearbyAmenityTerms: [],
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "Model incorrectly saw a numbered address.",
    });

    const text = "33 Harris road \u5468\u8fb9\u6709\u4ec0\u4e48\u5b66\u6821\u533b\u9662";
    const intent = await extractChatIntent([{ role: "user", content: text }]);

    expect(intent.intentCategory).toBe("nearby_amenity_lookup");
    expect(intent.execution).toBe("answer_nearby_amenities");
    expect(intent.mode).toBe("followup");
    expect(intent.nearbyAmenityTerms).toEqual(["schools", "hospitals"]);
    expect(detectMode(text)).toBe("followup");
    expect(isListingBrowseIntent(text)).toBe(false);
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

  it.each([
    "What are the main development risks?",
    "What are the risks?",
  ])("keeps an open-report risk question in chat even when the model selects discovery: %s", async (message) => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.8,
      mode: "discover",
      address: null,
      suburb: "papakura",
      minPrice: null,
      maxPrice: null,
      criteria: "development risks",
      discoveryPresentation: "scored_screening",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: true,
      reasoning: "Model incorrectly interpreted development as property discovery.",
    });

    const intent = await extractChatIntent(
      [{ role: "user", content: message }],
      { address: "13 Campbell Place, Papakura", suburb: "Papakura" },
    );

    expect(intent.intentCategory).toBe("followup");
    expect(intent.execution).toBe("answer_in_chat");
    expect(intent.mode).toBe("followup");
    expect(intent.discoveryPresentation).toBeNull();
    expect(intent.wideScanSubdivisionIntent).toBe(false);
  });

  it("preserves an explicit property search when a report is open", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.95,
      mode: "discover",
      address: null,
      suburb: "papakura",
      minPrice: null,
      maxPrice: null,
      criteria: "subdividable properties in Papakura",
      discoveryPresentation: "scored_screening",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: true,
      reasoning: "The user explicitly asked to show other properties.",
    });

    const intent = await extractChatIntent(
      [{ role: "user", content: "Show me subdividable properties in Papakura" }],
      { address: "13 Campbell Place, Papakura", suburb: "Papakura" },
    );

    expect(intent.intentCategory).toBe("property_discovery");
    expect(intent.execution).toBe("show_listing_cards");
    expect(intent.mode).toBe("discover");
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

  it("captures multiple suburbs in order and a freehold-title requirement", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.95,
      mode: "discover",
      address: null,
      suburb: "st heliers",
      // Mixed case + a duplicate of the primary to exercise normalisation.
      additionalSuburbs: ["Kohimarama", "st heliers", "Mission Bay"],
      minPrice: null,
      maxPrice: 1500000,
      criteria: "subdividable, freehold title",
      requiresFreeholdTitle: true,
      discoveryPresentation: "scored_screening",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "Subdividable freehold search across two suburbs.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What is subdividable under $1.5M with a freehold title in St Heliers or Kohimarama?" },
    ]);

    expect(intent.suburb).toBe("st heliers");
    expect(intent.additionalSuburbs).toEqual(["kohimarama", "mission bay"]);
    expect(intent.maxPrice).toBe(1500000);
    expect(intent.requiresFreeholdTitle).toBe(true);
  });

  it("normaliseAdditionalSuburbs lowercases, drops the primary, and dedupes in order", () => {
    expect(normaliseAdditionalSuburbs(["Kohimarama", "St Heliers", "kohimarama", "Mission Bay"], "st heliers"))
      .toEqual(["kohimarama", "mission bay"]);
    expect(normaliseAdditionalSuburbs(undefined, "st heliers")).toEqual([]);
    expect(normaliseAdditionalSuburbs(["", "  ", null, 7], null)).toEqual([]);
  });

  it("captures an explicit non-freehold opt-in (includeTenures)", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.92,
      mode: "discover",
      address: null,
      suburb: "st heliers",
      additionalSuburbs: [],
      minPrice: null,
      maxPrice: null,
      criteria: "subdividable, include cross-lease",
      requiresFreeholdTitle: false,
      includeTenures: ["cross_lease"],
      discoveryPresentation: "scored_screening",
      isFollowUp: true,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "User opted in to cross-lease.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "show me subdividable in St Heliers" },
      { role: "assistant", content: "I left out some cross-lease properties because subdivision needs a freehold title. Tell me if you'd like me to include them." },
      { role: "user", content: "yes, include the cross-lease ones too" },
    ]);

    expect(intent.includeTenures).toEqual(["cross_lease"]);
  });

  it("defaults includeTenures to [] when no opt-in is mentioned", async () => {
    mockIntentJson({
      intentCategory: "property_discovery",
      subject: "subdivision",
      execution: "show_listing_cards",
      confidence: 0.9,
      mode: "discover",
      address: null,
      suburb: "orakei",
      additionalSuburbs: [],
      minPrice: null,
      maxPrice: null,
      criteria: "subdividable in Orakei",
      requiresFreeholdTitle: false,
      discoveryPresentation: "scored_screening",
      isFollowUp: false,
      includeNegotiation: false,
      needsClarification: false,
      clarificationQuestion: null,
      wantsProviderRecommendation: false,
      wantsAnotherProvider: false,
      suggestedDiscipline: null,
      wideScanSubdivisionIntent: true,
      reasoning: "Plain subdivision search.",
    });

    const intent = await extractChatIntent([
      { role: "user", content: "What is subdividable in Orakei?" },
    ]);

    expect(intent.includeTenures).toEqual([]);
  });

  it("normaliseIncludeTenures maps synonyms/stratum and dedupes", () => {
    expect(normaliseIncludeTenures(["cross-lease", "Cross Lease", "leasehold"]))
      .toEqual(["cross_lease", "leasehold"]);
    expect(normaliseIncludeTenures(["stratum", "unit title"])).toEqual(["unit_title"]);
    expect(normaliseIncludeTenures(["cross_lease", "leasehold", "unit_title"]))
      .toEqual(["cross_lease", "leasehold", "unit_title"]);
    expect(normaliseIncludeTenures(undefined)).toEqual([]);
    expect(normaliseIncludeTenures(["", null, 7, "freehold"])).toEqual([]);
  });

  it("isListingBrowseContinuation: continuations yes, fresh browses no", () => {
    // Continuations ("more"/"other"/…) — should inherit the prior presentation.
    expect(isListingBrowseContinuation("Show me more property options")).toBe(true);
    expect(isListingBrowseContinuation("any other listings?")).toBe(true);
    expect(isListingBrowseContinuation("更多房源")).toBe(true);
    // Fresh browse — should reset to plain listing cards, not inherit.
    expect(isListingBrowseContinuation("show me listings in Ponsonby")).toBe(false);
    // Not a listing-browse phrase at all.
    expect(isListingBrowseContinuation("what is subdividable in Mission Bay")).toBe(false);
  });
});
