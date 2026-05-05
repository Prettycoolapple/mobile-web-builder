import { describe, expect, it } from "vitest";
import { hasNumberedStreetAddress, hasUnnumberedStreetLine } from "../street-address-detect";

describe("hasNumberedStreetAddress", () => {
  it("accepts letter suffix after number (66A Marine Parade)", () => {
    expect(hasNumberedStreetAddress("66A marine parade mellons bay")).toBe(true);
    expect(hasNumberedStreetAddress("我要分析 66A marine parade Melons Bay")).toBe(true);
  });

  it("accepts slash flat prefix (2/14 … Road)", () => {
    expect(hasNumberedStreetAddress("2/14 example street road")).toBe(true);
  });

  it("accepts plain number (66 Marine Parade)", () => {
    expect(hasNumberedStreetAddress("66 Marine Parade, Mellons Bay")).toBe(true);
  });

  it("rejects suburb-only", () => {
    expect(hasNumberedStreetAddress("Mellons Bay")).toBe(false);
  });
});

describe("hasUnnumberedStreetLine", () => {
  it("is false when a numbered lot is present (66A)", () => {
    expect(hasUnnumberedStreetLine("66A marine parade")).toBe(false);
  });
});
