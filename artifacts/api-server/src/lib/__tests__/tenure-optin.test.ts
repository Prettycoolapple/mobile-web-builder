import { describe, expect, it } from "vitest";
import { isBareTenureAffirmation, parseOfferedTenuresFromAssistant } from "../tenure-optin";

// The exact offer string produced by buildTenureExclusionReminder in routes/analyse.ts.
const CROSS_LEASE_OFFER =
  "I left out 1 cross-lease property (a cross-lease can only be subdivided once every cross-lease owner consents to convert the title to freehold) because subdivision needs a freehold title. Tell me if you'd like me to include any of these — I'll show them with a note on what's involved.";

const MIXED_OFFER =
  "I left out 2 cross-lease properties (…); and 1 leasehold property (…) because subdivision needs a freehold title. Tell me if you'd like me to include any of these — I'll show them with a note on what's involved.";

describe("parseOfferedTenuresFromAssistant", () => {
  it("extracts cross-lease from the real offer string", () => {
    expect(parseOfferedTenuresFromAssistant(CROSS_LEASE_OFFER)).toEqual(["cross_lease"]);
  });

  it("extracts cross-lease from the mobile serialized search note", () => {
    expect(
      parseOfferedTenuresFromAssistant(`[Search results shown: 1 Example Road||https://example.test/listing]\n[Assistant search note: ${CROSS_LEASE_OFFER}]`),
    ).toEqual(["cross_lease"]);
  });

  it("extracts multiple tenures, in canonical order", () => {
    expect(parseOfferedTenuresFromAssistant(MIXED_OFFER)).toEqual(["cross_lease", "leasehold"]);
  });

  it("does NOT match unrelated prose that merely mentions a tenure", () => {
    expect(
      parseOfferedTenuresFromAssistant("This property is a cross-lease title, which affects resale."),
    ).toEqual([]);
    expect(parseOfferedTenuresFromAssistant("")).toEqual([]);
    expect(parseOfferedTenuresFromAssistant(null)).toEqual([]);
  });

  it("does not confuse 'freehold' wording for leasehold", () => {
    expect(parseOfferedTenuresFromAssistant(CROSS_LEASE_OFFER)).not.toContain("leasehold");
  });
});

describe("isBareTenureAffirmation", () => {
  it("accepts bare affirmatives and 'include' phrasings", () => {
    for (const t of ["Yes include", "yes", "yes please", "sure", "ok", "go ahead", "include them", "show me all", "好的", "可以", "都加进来"]) {
      expect(isBareTenureAffirmation(t), t).toBe(true);
    }
  });

  it("rejects negatives and unrelated messages", () => {
    for (const t of ["no", "no thanks", "don't include them", "不要", "show me Ponsonby instead", "what is subdividable", ""]) {
      expect(isBareTenureAffirmation(t), t).toBe(false);
    }
  });

  it("end-to-end: bare 'Yes include' after the offer resolves to the offered tenures", () => {
    const offered = isBareTenureAffirmation("Yes include")
      ? parseOfferedTenuresFromAssistant(CROSS_LEASE_OFFER)
      : [];
    expect(offered).toEqual(["cross_lease"]);
  });
});
