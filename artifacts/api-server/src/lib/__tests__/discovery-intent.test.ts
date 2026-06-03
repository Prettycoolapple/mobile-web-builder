import { describe, expect, it } from "vitest";
import {
  hasStandardSubdivisionYield,
  isDevelopmentDiscoveryIntent,
  isStandardSubdivisionDiscoveryIntent,
} from "../discovery-intent";

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
});
