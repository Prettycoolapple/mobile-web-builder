import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRegionalPlanningOverlays,
  fetchRegionalPlanningZone,
  regionalPlanningSmokeTargets,
} from "../regional-arcgis";
import type { RegionalJurisdiction } from "../regional-planning";

function jurisdiction(providerId: RegionalJurisdiction["providerId"]): RegionalJurisdiction {
  return {
    providerId,
    providerName: "Test regional provider",
    territorialAuthority: "Test Council",
    region: "Test Region",
    coverageStatus: "partial",
    planName: "Test Plan",
    endpointRefs: [],
    reason: "test",
  };
}

describe("regional ArcGIS planning fetchers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes coded-value zone fields into readable regional zone descriptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/query")) {
        return new Response(JSON.stringify({
          features: [
            {
              attributes: {
                OBJECTID: 3041,
                Zone: "21",
                Stage: "Stage 1 and 2",
                Label: null,
              },
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        fields: [
          {
            name: "Zone",
            domain: {
              type: "codedValue",
              codedValues: [{ code: "21", name: "Queenstown Town Centre" }],
            },
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const zone = await fetchRegionalPlanningZone(jurisdiction("qldc"), -45.031, 168.662);

    expect(zone).toMatchObject({
      zone_code: "21",
      zone_description: expect.stringContaining("Queenstown Town Centre"),
      min_lot_size_sqm: null,
    });
    expect(zone.raw_zone).toContain("\"Zone\":\"21\"");
  });

  it("maps configured regional overlay hits into conservative report overlays", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [
        {
          attributes: {
            NAME: "Example heritage area",
            Type: "Heritage",
          },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const overlays = await fetchRegionalPlanningOverlays(jurisdiction("christchurch"), -43.532, 172.636);

    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays[0]).toMatchObject({
      name: "Heritage Area",
      status: "restricted",
    });
    expect(overlays[0]?.detail).toContain("Confirm implications in the local district plan");
  });

  it("exposes smoke targets for configured regional layers", () => {
    const targets = regionalPlanningSmokeTargets();

    expect(targets.some((target) => target.providerId === "hamilton" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "christchurch" && target.label.includes("Heritage"))).toBe(true);
    expect(targets.some((target) => target.providerId === "qldc" && target.kind === "zone")).toBe(true);
  });
});
