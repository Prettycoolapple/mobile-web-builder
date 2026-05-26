import { describe, expect, it } from "vitest";
import { terrainSlopeText } from "../terrain-slope-copy";

describe("terrainSlopeText", () => {
  it("returns Chinese flat copy with degrees", () => {
    expect(terrainSlopeText("flat", 2.7, "zh")).toBe(
      "平坦地形（~2.7 度） - 根据等高线数据，预计无需进行明显的挡土工程。",
    );
  });

  it("returns English flat copy with degrees", () => {
    expect(terrainSlopeText("flat", 2.7, "en")).toBe(
      "Flat terrain (~2.7 degrees) - no meaningful retaining expected from contour data.",
    );
  });

  it("returns null when contour is missing", () => {
    expect(terrainSlopeText(null, 2.7, "zh")).toBeNull();
  });
});
