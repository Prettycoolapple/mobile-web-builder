import { describe, expect, it } from "vitest";
import {
  canonicalBuildYearFromReport,
  filterRiskSummaryRemoveAsbestosBullets,
  filterRiskSummaryRemoveIncompleteDataDisclaimerBullets,
  isIncompleteDataDisclaimerRiskBullet,
} from "../risk-summary";

describe("incomplete-data disclaimer bullets", () => {
  it("removes ZH and EN bullets that imply paid report lacks land/zoning facts", () => {
    const zh = "土地面积、规划分区等关键数据未获取，无法识别具体场地风险。";
    expect(isIncompleteDataDisclaimerRiskBullet(zh)).toBe(true);
    expect(
      filterRiskSummaryRemoveIncompleteDataDisclaimerBullets([
        zh,
        "岸线附近需查阅规划图。",
      ]),
    ).toEqual(["岸线附近需查阅规划图。"]);

    expect(
      isIncompleteDataDisclaimerRiskBullet(
        "Key data was not obtained for land area and zoning, so specific site risks cannot be identified.",
      ),
    ).toBe(true);
  });

  it("keeps normal coastal / terrain risk lines", () => {
    expect(
      isIncompleteDataDisclaimerRiskBullet(
        "Coastal erosion may affect long-term development; check unitary plan overlays.",
      ),
    ).toBe(false);
  });
});

describe("filterRiskSummaryRemoveAsbestosBullets", () => {
  it("removes EN and ZH asbestos mentions", () => {
    expect(
      filterRiskSummaryRemoveAsbestosBullets([
        "Slope may need retaining",
        "Low asbestos risk — built 2009",
        "Coastal rules apply",
      ]),
    ).toEqual(["Slope may need retaining", "Coastal rules apply"]);

    expect(
      filterRiskSummaryRemoveAsbestosBullets(["石棉风险低 — 2009 年建造"]),
    ).toEqual([]);
  });
});

describe("canonicalBuildYearFromReport", () => {
  it("prefers merged build year, then propertyOverview", () => {
    expect(
      canonicalBuildYearFromReport(
        { propertyOverview: { buildYear: "1995" } },
        2009,
      ),
    ).toBe(2009);

    expect(
      canonicalBuildYearFromReport({ propertyOverview: { buildYear: "2009" } }, undefined),
    ).toBe(2009);
  });
});
