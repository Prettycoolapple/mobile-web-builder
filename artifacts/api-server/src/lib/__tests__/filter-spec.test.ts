import { describe, it, expect } from "vitest";
import { normaliseFilterSpec, detectFilterSpecFromText } from "../claude";

describe("normaliseFilterSpec", () => {
  it("returns null for non-objects and empty constraint sets", () => {
    expect(normaliseFilterSpec(null)).toBeNull();
    expect(normaliseFilterSpec("x")).toBeNull();
    expect(normaliseFilterSpec({})).toBeNull();
    expect(normaliseFilterSpec({ searchScope: "both", infrastructureOnParcel: [] })).toBeNull();
    // A lone lot-count of 1 is not a "split" → no constraint survives.
    expect(normaliseFilterSpec({ minPotentialLots: 1 })).toBeNull();
  });

  it("keeps and clamps real constraints", () => {
    expect(normaliseFilterSpec({ minPotentialLots: 4 })).toMatchObject({
      minPotentialLots: 4,
      searchScope: "both",
    });
    expect(normaliseFilterSpec({ minPotentialLots: 999 })?.minPotentialLots).toBe(50);
    expect(normaliseFilterSpec({ minRoiPct: -5 })).toBeNull();
    expect(normaliseFilterSpec({ maxSlopeDegrees: 3 })?.maxSlopeDegrees).toBe(3);
  });

  it("whitelists infrastructure keys and search scope", () => {
    expect(
      normaliseFilterSpec({ infrastructureOnParcel: ["storm", "junk", "water", "storm"] })?.infrastructureOnParcel,
    ).toEqual(["storm", "water"]);
    expect(normaliseFilterSpec({ minPotentialLots: 3, searchScope: "nonsense" })?.searchScope).toBe("both");
    expect(normaliseFilterSpec({ minPotentialLots: 3, searchScope: "analyzed_index" })?.searchScope).toBe(
      "analyzed_index",
    );
  });
});

describe("detectFilterSpecFromText (regex fallback)", () => {
  it("extracts lot count from Chinese and English", () => {
    expect(detectFilterSpecFromText("westharbour有哪些可分割成4套独栋的地")?.minPotentialLots).toBe(4);
    expect(detectFilterSpecFromText("which land can be split into 4 standalone houses")?.minPotentialLots).toBe(4);
    expect(detectFilterSpecFromText("show me 3 lot subdivision sites")?.minPotentialLots).toBe(3);
  });

  it("extracts flat/gentle slope and on-parcel services (Chinese)", () => {
    const spec = detectFilterSpecFromText("基本平地，坡小，雨水污水管道都在地上");
    expect(spec).not.toBeNull();
    expect(spec?.maxSlopeDegrees).toBe(8); // gentle widens flat's 3 to 8
    expect(spec?.infrastructureOnParcel).toEqual(expect.arrayContaining(["storm", "sewer"]));
  });

  it("extracts return percentage", () => {
    expect(detectFilterSpecFromText("What's on the market in Waikato with return over 7%")?.minRoiPct).toBe(7);
    expect(detectFilterSpecFromText("回报超过7%的房子")?.minRoiPct).toBe(7);
    // The exact production phrasing that slipped past the LLM extractor.
    expect(detectFilterSpecFromText("有什么可以开发的地回报大于 7%")?.minRoiPct).toBe(7);
  });

  it("only trusts a bare N套/N栋 count alongside a development/subdivision word", () => {
    expect(detectFilterSpecFromText("可以开发3栋的地")?.minPotentialLots).toBe(3);
    // A plain browse for "3 homes" must NOT be hijacked into a criteria search.
    expect(detectFilterSpecFromText("看看3套房")).toBeNull();
  });

  it("returns null when no measurable criteria are present", () => {
    expect(detectFilterSpecFromText("show me listings in ponsonby")).toBeNull();
    expect(detectFilterSpecFromText("what are the subdivision rules in coatesville")).toBeNull();
  });
});
