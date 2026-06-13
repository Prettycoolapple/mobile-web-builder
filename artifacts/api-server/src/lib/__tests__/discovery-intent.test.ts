import { describe, expect, it } from "vitest";
import {
  hasStandardSubdivisionYield,
  isDevelopmentDiscoveryIntent,
  isSubdivisionRulesInformationIntent,
  isStandardSubdivisionDiscoveryIntent,
} from "../discovery-intent";
import { detectMode, isListingBrowseIntent } from "../claude";

describe("listing browse intent", () => {
  it("treats explicit 'more properties/listings' continuations as plain browse", () => {
    expect(isListingBrowseIntent("show more properties i mean")).toBe(true);
    expect(isListingBrowseIntent("show more listings")).toBe(true);
    expect(isListingBrowseIntent("find me more homes")).toBe(true);
    expect(isListingBrowseIntent("any other houses")).toBe(true);
    expect(isListingBrowseIntent("更多房源")).toBe(true);
    expect(isListingBrowseIntent("再看几个房子")).toBe(true);
  });

  it("does not treat a bare 'show more' or unrelated phrases as browse", () => {
    expect(isListingBrowseIntent("show more")).toBe(false);
    expect(isListingBrowseIntent("show more detail")).toBe(false);
    expect(isListingBrowseIntent("analyse 35 Maugham Drive, Bucklands Beach")).toBe(false);
    expect(isListingBrowseIntent("tell me about the report")).toBe(false);
  });

  it("still flags classic availability questions", () => {
    expect(isListingBrowseIntent("what is available in Bucklands Beach?")).toBe(true);
    expect(isListingBrowseIntent("anything for sale in Remuera")).toBe(true);
    expect(isListingBrowseIntent("What is currently listed in Marine Parade, Mellons Bay?")).toBe(true);
    expect(isListingBrowseIntent("show me what is listed in Orakei")).toBe(true);
  });
});

describe("discovery intent", () => {
  it("treats Chinese subdivision searches as strict standard subdivision intent", () => {
    const query = "orakei \u6709\u4ec0\u4e48\u53ef\u4ee5\u5206\u5272\u7684\u5730\u5417";

    expect(isDevelopmentDiscoveryIntent(query)).toBe(true);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(true);
  });

  it("keeps broad Chinese development searches separate from strict subdivision", () => {
    const query = "orakei \u6709\u4ec0\u4e48\u5f00\u53d1\u6f5c\u529b\u7684\u5730";

    expect(isDevelopmentDiscoveryIntent(query)).toBe(true);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(false);
  });

  it("does not treat plain Chinese for-sale price searches as development intent", () => {
    const query = "\u4e2d\u533a\u6709\u4ec0\u4e48150\u4e07\u5230200\u4e07\u5728\u5356\u7684";

    expect(isDevelopmentDiscoveryIntent(query)).toBe(false);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(false);
  });

  it("still treats explicit Chinese development wording as development intent", () => {
    const query = "\u4e2d\u533a\u6709\u4ec0\u4e48\u53ef\u4ee5\u5f00\u53d1\u7684\u5730\u5728150-200\u4e07\u4e4b\u95f4";

    expect(isDevelopmentDiscoveryIntent(query)).toBe(true);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(false);
  });

  it("keeps generic English land or section sale searches neutral", () => {
    expect(isDevelopmentDiscoveryIntent("central auckland homes for sale between 1.5m and 2m")).toBe(false);
    expect(isDevelopmentDiscoveryIntent("sections for sale in central auckland")).toBe(false);
  });

  it("requires at least two computed lots for standard subdivision cards", () => {
    expect(hasStandardSubdivisionYield({ potentialLots: 1 })).toBe(false);
    expect(hasStandardSubdivisionYield({ potentialLots: 2 })).toBe(true);
  });

  it("keeps subdivision rules questions out of discovery search", () => {
    const query = "what is the subdivision rules in coatesville";

    expect(isSubdivisionRulesInformationIntent(query)).toBe(true);
    expect(isDevelopmentDiscoveryIntent(query)).toBe(false);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(false);
    expect(detectMode(query)).toBe("followup");
  });

  it("still treats explicit subdivision listing searches as discovery intent", () => {
    const query = "show me properties in Coatesville that meet subdivision rules";

    expect(isSubdivisionRulesInformationIntent(query)).toBe(false);
    expect(isDevelopmentDiscoveryIntent(query)).toBe(true);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(true);
    expect(detectMode(query)).toBe("discover");
  });

  it("still treats area-wide subdividable searches as discovery intent", () => {
    const query = "what's subdividable in Glendowie?";

    expect(isSubdivisionRulesInformationIntent(query)).toBe(false);
    expect(isDevelopmentDiscoveryIntent(query)).toBe(true);
    expect(isStandardSubdivisionDiscoveryIntent(query)).toBe(true);
    expect(detectMode(query)).toBe("discover");
  });
});
