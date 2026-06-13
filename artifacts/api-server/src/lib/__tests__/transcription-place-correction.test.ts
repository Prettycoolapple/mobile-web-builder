import { describe, expect, it } from "vitest";
import {
  correctTranscribedNzPlaces,
  isHighConfidenceSuburbMatch,
  NZ_PROPERTY_TRANSCRIPTION_PROMPT,
} from "../transcription-place-correction";

const fakeLookup = async (candidate: string) => {
  if (candidate.toLowerCase() === "malins bay") return { text: "Mellons Bay", confidence: 0.73 };
  return null;
};

describe("transcription place correction", () => {
  it("nudges the transcription model with NZ property vocabulary without forcing a language", () => {
    expect(NZ_PROPERTY_TRANSCRIPTION_PROMPT).toContain("Mellons Bay");
    expect(NZ_PROPERTY_TRANSCRIPTION_PROMPT).toContain("Marine Parade");
    expect(NZ_PROPERTY_TRANSCRIPTION_PROMPT).toContain("Mandarin Chinese");
    expect(NZ_PROPERTY_TRANSCRIPTION_PROMPT).toContain("do not translate");
  });

  it("corrects high-confidence comma locality mistakes", async () => {
    await expect(
      correctTranscribedNzPlaces("What is currently listed in Marine Parade, Malins Bay.", fakeLookup),
    ).resolves.toBe("What is currently listed in Marine Parade, Mellons Bay.");
  });

  it("corrects mixed Chinese and English suburb names", async () => {
    await expect(
      correctTranscribedNzPlaces("帮我找 Malins Bay 在卖的房源", fakeLookup),
    ).resolves.toBe("帮我找 Mellons Bay 在卖的房源");
  });

  it("leaves low-confidence text untouched", async () => {
    await expect(
      correctTranscribedNzPlaces("What is currently listed in Imaginary Bay.", async () => null),
    ).resolves.toBe("What is currently listed in Imaginary Bay.");
  });

  it("accepts close multi-token suburb matches only when confidence is high enough", () => {
    expect(isHighConfidenceSuburbMatch("Malins Bay", {
      suburb: { id: "1", title: "Mellons Bay", slug: "mellons-bay", fqSlug: "auckland_manukau-city_mellons-bay", districtId: 223 },
      alias: "mellons bay",
      distance: 3,
      similarity: 0.73,
      margin: 0.08,
    })).toBe(true);

    expect(isHighConfidenceSuburbMatch("Malins Bay", {
      suburb: { id: "2", title: "Murrays Bay", slug: "murrays-bay", fqSlug: "auckland_north-shore-city_murrays-bay", districtId: 224 },
      alias: "murrays bay",
      distance: 4,
      similarity: 0.6,
      margin: 0.02,
    })).toBe(false);
  });
});
