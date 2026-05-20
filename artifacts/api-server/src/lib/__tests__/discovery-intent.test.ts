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

  it("requires at least two computed lots for standard subdivision cards", () => {
    expect(hasStandardSubdivisionYield({ potentialLots: 1 })).toBe(false);
    expect(hasStandardSubdivisionYield({ potentialLots: 2 })).toBe(true);
  });
});
