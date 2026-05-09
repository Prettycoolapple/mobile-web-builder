import { describe, expect, it } from "vitest";
import { estimateNewBuildFloorSqm } from "../roi-calculator";

describe("estimateNewBuildFloorSqm", () => {
  it("models total floor area, not just the ground-floor footprint, on infill lots", () => {
    const sqmPerLot = 412;
    const singleLevelFootprint = Math.round(sqmPerLot * 0.38);

    expect(estimateNewBuildFloorSqm(sqmPerLot)).toBe(204);
    expect(estimateNewBuildFloorSqm(sqmPerLot)).toBeGreaterThan(singleLevelFootprint);
  });
});
