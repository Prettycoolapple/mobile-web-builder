import { describe, expect, it } from "vitest";
import { buildReportFollowUpFallback, detectReportFollowUpTopic } from "../report-followup-fallback";

const report = {
  address: "202 West Tamaki Road, Glendowie, Auckland City, Auckland",
  zone_label: "Mixed Housing Suburban",
  zone_code: "MHS",
  potential_lots: 4,
  planning: {
    potentialLots: 4,
    minLotSize: "400m²",
    netAreaSqm: 1180,
    subdivisionSummary: "Four standard lots achievable subject to retaining design.",
    overlays: [{ name: "Overland flow path", status: "Present", detail: "Crosses the rear boundary" }],
  },
  riskSummary: [
    "Overland flow path crosses the rear of the site.",
    "Retaining walls are a material cost driver on this slope.",
  ],
  costItems: [
    { label: "Land (CV)", low: 1770000, high: 1770000 },
    { label: "Construction", low: 1530000, high: 1990000 },
  ],
  totalCostLow: 4440000,
  totalCostHigh: 5930000,
  cost_per_unit_avg: 1040000,
  roiScenarios: [
    { years: 2, cases: [{ case: "base", gdv: 6400000, gross_profit: 900000, roi_percent: 17.4, viable: true }] },
  ],
  infrastructure: [
    { name: "Wastewater", location: "West Tamaki Road", distance_metres: 32, risk: "low", estimatedCostLow: 5000, estimatedCostHigh: 30000, note: "Connection available" },
  ],
};

describe("detectReportFollowUpTopic", () => {
  it("maps the follow-ups that were failing in chat", () => {
    expect(detectReportFollowUpTopic("What are the key risks")).toBe("risks");
    expect(detectReportFollowUpTopic("Can you explain the cost estimate you factored in?")).toBe("costs");
    expect(detectReportFollowUpTopic("5 个地块的审批流程是什么？")).toBe("consent_process");
    expect(detectReportFollowUpTopic("What ROI can I expect?")).toBe("roi");
    expect(detectReportFollowUpTopic("基础设施接驳情况如何?")).toBe("infrastructure");
  });

  it("returns null for questions the stored report cannot answer", () => {
    expect(detectReportFollowUpTopic("What's the weather like in Auckland?")).toBeNull();
    expect(detectReportFollowUpTopic("")).toBeNull();
  });
});

describe("buildReportFollowUpFallback", () => {
  it("answers a risk question from the report's own bullets", () => {
    const answer = buildReportFollowUpFallback("What are the key risks", report);
    expect(answer).toContain("Overland flow path crosses the rear of the site.");
    expect(answer).toContain("Retaining walls are a material cost driver");
    expect(answer).toContain("temporarily unavailable");
  });

  it("answers a cost question with the stored line items and total", () => {
    const answer = buildReportFollowUpFallback("Can you explain the cost estimate you factored in?", report);
    expect(answer).toContain("Land (CV): $1,770,000");
    expect(answer).toContain("Construction: $1,530,000 – $1,990,000");
    expect(answer).toContain("Total: $4,440,000 – $5,930,000");
    expect(answer).toContain("Per unit average: $1,040,000");
  });

  it("answers the Chinese consent-process question with planning facts", () => {
    const answer = buildReportFollowUpFallback("5 个地块的审批流程是什么？", report, "zh");
    expect(answer).toContain("Mixed Housing Suburban");
    expect(answer).toContain("可能地块数：4");
    expect(answer).toContain("AI 助手暂时不可用");
  });

  it("quotes ROI scenarios verbatim rather than recalculating", () => {
    const answer = buildReportFollowUpFallback("What ROI can I expect?", report);
    expect(answer).toContain("2yr");
    expect(answer).toContain("ROI 17.4%");
    expect(answer).toContain("GDV $6,400,000");
  });

  it("answers from the first report of a combined listing package", () => {
    const group = { kind: "combined_listing_group", packageAddress: "A & B", reports: [report] };
    const answer = buildReportFollowUpFallback("What are the key risks", group);
    expect(answer).toContain("Overland flow path crosses the rear of the site.");
  });

  it("returns null when there is no report or no matching data", () => {
    expect(buildReportFollowUpFallback("What are the key risks", null)).toBeNull();
    expect(buildReportFollowUpFallback("What are the key risks", { address: "1 Test Road" })).toBeNull();
    expect(buildReportFollowUpFallback("Tell me a joke", report)).toBeNull();
  });
});
