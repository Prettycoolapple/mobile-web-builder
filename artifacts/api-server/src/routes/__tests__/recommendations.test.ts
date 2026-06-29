import { describe, expect, it } from "vitest";
import { reportHasPlanningOverlayOrControl } from "../../lib/planning-overlays";

describe("reportHasPlanningOverlayOrControl", () => {
  it("detects constrained planning overlays and controls", () => {
    expect(
      reportHasPlanningOverlayOrControl({
        planning: {
          overlays: [
            { name: "Height Variation Control", status: "control" },
          ],
        },
      }),
    ).toBe(true);

    expect(
      reportHasPlanningOverlayOrControl({
        planning: {
          overlays: [
            { name: "Flood Plain", status: "restricted" },
          ],
        },
      }),
    ).toBe(true);
  });

  it("does not treat clear or absent overlay data as constrained planning", () => {
    expect(reportHasPlanningOverlayOrControl({ planning: { overlays: [] } })).toBe(false);
    expect(
      reportHasPlanningOverlayOrControl({
        planning: {
          overlays: [
            { name: "No overlays detected", status: "clear" },
          ],
        },
      }),
    ).toBe(false);
  });
});
