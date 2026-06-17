import { describe, it, expect } from "vitest";
import { matchCanary, buildCanaryReport } from "../canaries";

describe("canary honeytokens", () => {
  it("matches a seeded trap address (including abbreviation / noise variants)", () => {
    const canary = matchCanary("188B Seabreeze Knoll, Maraetai, Auckland");
    expect(canary).not.toBeNull();
    // Same address with postcode/country noise still trips the trap.
    expect(matchCanary("188b seabreeze knoll, maraetai 2018, new zealand")?.id).toBe(canary?.id);
  });

  it("does not match ordinary addresses", () => {
    expect(matchCanary("12 King Street, Auckland")).toBeNull();
    expect(matchCanary("")).toBeNull();
    expect(matchCanary(null)).toBeNull();
  });

  it("emits the exact fabricated fingerprint in the report", () => {
    const canary = matchCanary("188B Seabreeze Knoll, Maraetai, Auckland");
    expect(canary).not.toBeNull();
    const report = buildCanaryReport(canary!, "188B Seabreeze Knoll");
    const scores = report.scores as Record<string, number | string[]>;
    expect(scores.composite).toBe(canary!.scores.composite);
    expect(scores.ease).toBe(canary!.scores.ease);
    expect(scores.cost).toBe(canary!.scores.cost);
    expect(scores.roi).toBe(canary!.scores.roi);
    expect(report.riskSummary).toContain(canary!.marker);
    expect(report.canary).toBe(true);
  });
});
