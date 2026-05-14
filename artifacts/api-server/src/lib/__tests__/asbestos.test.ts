import { describe, expect, it } from "vitest";
import { classifyAsbestos } from "../asbestos";
import { checkAsbestosRisk } from "../property-data";

describe("asbestos classification", () => {
  it("treats 1940 as asbestos-era risk, not pre-1940 low risk", () => {
    expect(classifyAsbestos(1940).risk).toBe("high");
    expect(checkAsbestosRisk(1940).risk).toBe("high");
  });

  it("keeps clearly pre-1940 construction as low risk", () => {
    expect(classifyAsbestos(1939).risk).toBe("low");
    expect(checkAsbestosRisk(1920).risk).toBe("low");
  });
});
