import { describe, expect, it, vi } from "vitest";
import {
  assessDwellingCondition,
  buildDwellingConditionFingerprint,
  dwellingConditionCostPenalty,
  selectedDwellingConditionPhotoUrls,
  type DwellingConditionAssessment,
} from "../dwelling-condition";

describe("dwelling condition assessment", () => {
  it("treats 2007 as recent and 2006 as not recent in 2026", async () => {
    const recent = await assessDwellingCondition({ address: "1 Test Street", buildYear: 2007, currentYear: 2026 });
    const oldEnough = await assessDwellingCondition({ address: "2 Test Street", buildYear: 2006, currentYear: 2026 });

    expect(recent.recentImprovement).toBe(true);
    expect(recent.costPenalty).toBe(0.5);
    expect(recent.source).toBe("build_year");

    expect(oldEnough.recentImprovement).toBe(false);
    expect(oldEnough.costPenalty).toBe(0);
  });

  it("detects strong renovation wording", async () => {
    const result = await assessDwellingCondition({
      address: "3 Test Street",
      buildYear: 1960,
      currentYear: 2026,
      description: "This character home has been fully renovated throughout with upgraded fixed finishes.",
    });

    expect(result.condition).toBe("renovated");
    expect(result.recentImprovement).toBe(true);
    expect(result.costPenalty).toBe(1);
    expect(result.source).toBe("listing_text");
  });

  it("does not penalise renovation potential", async () => {
    const result = await assessDwellingCondition({
      address: "4 Test Street",
      buildYear: 1960,
      currentYear: 2026,
      description: "Original home with renovation potential. Bring your builder and make it yours.",
    });

    expect(result.recentImprovement).toBe(false);
    expect(result.costPenalty).toBe(0);
    expect(["original", "dated"]).toContain(result.condition);
  });

  it("does not treat a brand new kitchen alone as a major recent improvement", async () => {
    const result = await assessDwellingCondition({
      address: "5 Test Street",
      buildYear: 1960,
      currentYear: 2026,
      description: "A tidy home with a brand new kitchen and sunny living.",
    });

    expect(result.condition).toBe("maintained");
    expect(result.recentImprovement).toBe(false);
    expect(result.costPenalty).toBe(0);
  });

  it("detects extensions and additions", async () => {
    const result = await assessDwellingCondition({
      address: "6 Test Street",
      buildYear: 1960,
      currentYear: 2026,
      description: "A consented extension added a second living space and new master wing.",
    });

    expect(result.condition).toBe("extended");
    expect(result.additionOrExtension).toBe(true);
    expect(result.recentImprovement).toBe(true);
    expect(result.costPenalty).toBe(1);
  });

  it("reuses a cached matching fingerprint without calling text or vision providers", async () => {
    const input = {
      address: "7 Test Street",
      buildYear: 1950,
      currentYear: 2026,
      description: "A modern family home with designer finishes.",
      photoUrls: ["https://example.test/a.jpg"],
    };
    const fingerprint = buildDwellingConditionFingerprint(input);
    const cached: DwellingConditionAssessment = {
      assessmentVersion: 1,
      sourceFingerprint: fingerprint,
      assessedAt: "2026-01-01T00:00:00.000Z",
      condition: "unknown",
      recentImprovement: false,
      additionOrExtension: false,
      confidence: "low",
      source: "listing_text",
      evidence: [],
      costPenalty: 0,
    };
    const textLlm = vi.fn().mockRejectedValue(new Error("should not call"));
    const vision = vi.fn().mockRejectedValue(new Error("should not call"));

    const result = await assessDwellingCondition({ ...input, cachedAssessment: cached }, { textLlm, vision });

    expect(result).toBe(cached);
    expect(textLlm).not.toHaveBeenCalled();
    expect(vision).not.toHaveBeenCalled();
  });

  it("recomputes when listing evidence changes", async () => {
    const oldInput = {
      address: "8 Test Street",
      buildYear: 1950,
      currentYear: 2026,
      description: "A modern family home.",
    };
    const cached: DwellingConditionAssessment = {
      assessmentVersion: 1,
      sourceFingerprint: buildDwellingConditionFingerprint(oldInput),
      assessedAt: "2026-01-01T00:00:00.000Z",
      condition: "unknown",
      recentImprovement: false,
      additionOrExtension: false,
      confidence: "low",
      source: "listing_text",
      evidence: [],
      costPenalty: 0,
    };
    const textLlm = vi.fn().mockResolvedValue({
      condition: "renovated",
      recentImprovement: true,
      additionOrExtension: false,
      confidence: "medium",
      evidence: ["modern fixed finishes"],
      costPenalty: 0.5,
    });

    const result = await assessDwellingCondition(
      { ...oldInput, description: "A modern designer home with immaculate fixed finishes.", cachedAssessment: cached },
      { textLlm },
    );

    expect(textLlm).toHaveBeenCalledTimes(1);
    expect(result.condition).toBe("renovated");
    expect(result.costPenalty).toBe(0.5);
  });

  it("skips vision safely when no vision provider is configured", async () => {
    const previous = {
      enabled: process.env.RENOVATION_VISION_ENABLED,
      key: process.env.RENOVATION_VISION_API_KEY,
      baseUrl: process.env.RENOVATION_VISION_BASE_URL,
      model: process.env.RENOVATION_VISION_MODEL,
    };
    delete process.env.RENOVATION_VISION_ENABLED;
    delete process.env.RENOVATION_VISION_API_KEY;
    delete process.env.RENOVATION_VISION_BASE_URL;
    delete process.env.RENOVATION_VISION_MODEL;
    try {
      const result = await assessDwellingCondition({
        address: "9 Test Street",
        buildYear: 1950,
        currentYear: 2026,
        description: "",
        photoUrls: ["https://example.test/a.jpg", "https://example.test/a.jpg", "https://example.test/b.jpg"],
      });

      expect(selectedDwellingConditionPhotoUrls(["a", "a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
      expect(result.condition).toBe("unknown");
      expect(result.costPenalty).toBe(0);
    } finally {
      if (previous.enabled == null) delete process.env.RENOVATION_VISION_ENABLED;
      else process.env.RENOVATION_VISION_ENABLED = previous.enabled;
      if (previous.key == null) delete process.env.RENOVATION_VISION_API_KEY;
      else process.env.RENOVATION_VISION_API_KEY = previous.key;
      if (previous.baseUrl == null) delete process.env.RENOVATION_VISION_BASE_URL;
      else process.env.RENOVATION_VISION_BASE_URL = previous.baseUrl;
      if (previous.model == null) delete process.env.RENOVATION_VISION_MODEL;
      else process.env.RENOVATION_VISION_MODEL = previous.model;
    }
  });
});

describe("dwelling condition cost penalty", () => {
  it("only applies to subdivision or redevelopment scenarios", async () => {
    const assessment = await assessDwellingCondition({
      address: "10 Test Street",
      buildYear: 2020,
      currentYear: 2026,
    });

    expect(dwellingConditionCostPenalty(assessment, 1)).toBe(0);
    expect(dwellingConditionCostPenalty(assessment, 2)).toBe(1);
  });
});
