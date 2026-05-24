import { describe, expect, it } from "vitest";
import {
  hasNonStandardSalePropertyReference,
  hasNumberedStreetAddress,
  hasUnnumberedStreetLine,
} from "../street-address-detect";

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

describe("hasNonStandardSalePropertyReference", () => {
  it("detects balance-land style listing labels on a road", () => {
    expect(hasNonStandardSalePropertyReference("Village 2/& Balance Land, Ara weiti road")).toBe(true);
  });

  it("does not flag normal numbered addresses", () => {
    expect(hasNonStandardSalePropertyReference("2/14 Example Street Road")).toBe(false);
    expect(hasNonStandardSalePropertyReference("66A Marine Parade")).toBe(false);
  });

  it("requires a street/road reference so generic land searches still use discovery", () => {
    expect(hasNonStandardSalePropertyReference("show me lifestyle land in Okura Bush")).toBe(false);
  });
});
