import { describe, expect, it } from "vitest";
import { terrainSlopeText } from "../terrain-slope-copy";

describe("terrainSlopeText", () => {
  it("returns English flat copy with degrees", () => {
    expect(terrainSlopeText("flat", 2.7, "en")).toBe(
      "Flat terrain (~2.7 degrees) - effectively level; suitable for standard building and easy walking.",
    );
  });

  it("returns English very steep copy with degrees", () => {
    expect(terrainSlopeText("very_steep", 18.2, "en")).toBe(
      "Very steep terrain (~18.2 degrees) - severe terrain with extreme foundation, retaining, and engineering cost risk.",
    );
  });

  it("returns null when contour is missing", () => {
    expect(terrainSlopeText(null, 2.7, "zh")).toBeNull();
  });
});
