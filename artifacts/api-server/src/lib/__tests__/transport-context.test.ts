import { describe, expect, it } from "vitest";
import {
  buildTransportRoiInfluence,
  classifyCommuteConvenience,
  classifyHighwayDistance,
  classifyServiceIntensity,
  classifyTransitAccessForStop,
  routeTypeToMode,
} from "../transport-context";
import type { CityCommuteContext, HighwayAccessContext, PublicTransportContext } from "../transport-context";

describe("transport context classifiers", () => {
  it("classifies GTFS route modes and service intensity", () => {
    expect(routeTypeToMode(2)).toBe("train");
    expect(routeTypeToMode(4)).toBe("ferry");
    expect(routeTypeToMode(3)).toBe("bus");
    expect(routeTypeToMode(999)).toBe("unknown");

    expect(classifyServiceIntensity(220, 2)).toBe("frequent");
    expect(classifyServiceIntensity(30, 4)).toBe("regular");
    expect(classifyServiceIntensity(2, 1)).toBe("limited");
    expect(classifyServiceIntensity(0, 0)).toBe("unknown");
  });

  it("classifies public transport access from nearest stop distance and mode", () => {
    expect(classifyTransitAccessForStop(null)).toBe("poor");
    expect(classifyTransitAccessForStop({
      name: "Frequent bus stop",
      mode: "bus",
      distanceM: 350,
      routeCount: 8,
      serviceIntensity: "frequent",
    })).toBe("excellent");
    expect(classifyTransitAccessForStop({
      name: "Train station",
      mode: "train",
      distanceM: 900,
      routeCount: 1,
      serviceIntensity: "regular",
    })).toBe("good");
    expect(classifyTransitAccessForStop({
      name: "Distant ferry",
      mode: "ferry",
      distanceM: 1400,
      routeCount: 1,
      serviceIntensity: "limited",
    })).toBe("limited");
  });

  it("classifies motorway/highway access and exposure risk", () => {
    expect(classifyHighwayDistance(null)).toEqual({ accessTier: "unknown", exposureTier: "unknown" });
    expect(classifyHighwayDistance(120)).toEqual({ accessTier: "exposureRisk", exposureTier: "high" });
    expect(classifyHighwayDistance(1200)).toEqual({ accessTier: "excellent", exposureTier: "low" });
    expect(classifyHighwayDistance(4200)).toEqual({ accessTier: "good", exposureTier: "low" });
    expect(classifyHighwayDistance(7000)).toEqual({ accessTier: "neutral", exposureTier: "low" });
    expect(classifyHighwayDistance(9000)).toEqual({ accessTier: "remote", exposureTier: "low" });
  });

  it("classifies CBD commute convenience from distance, highway access, and transit access", () => {
    expect(classifyCommuteConvenience(null, "unknown", "unknown")).toBe("unknown");
    expect(classifyCommuteConvenience(7, "excellent", "poor")).toBe("excellent");
    expect(classifyCommuteConvenience(14, "remote", "good")).toBe("good");
    expect(classifyCommuteConvenience(25, "neutral", "poor")).toBe("limited");
    expect(classifyCommuteConvenience(55, "good", "excellent")).toBe("poor");
  });

  it("creates ROI narrative without applying numeric adjustments", () => {
    const publicTransport: PublicTransportContext = {
      accessTier: "good",
      nearestStop: null,
      nearestByMode: [],
      confidence: "medium",
    };
    const highwayAccess: HighwayAccessContext = {
      name: "Auckland SH1",
      distanceM: 120,
      accessTier: "exposureRisk",
      exposureTier: "high",
      confidence: "low",
    };
    const cityCommute: CityCommuteContext = {
      centreName: "Auckland CBD",
      distanceKm: 8,
      convenienceTier: "good",
      confidence: "low",
    };

    const influence = buildTransportRoiInfluence(publicTransport, highwayAccess, cityCommute);

    expect(influence.influence).toBe("mixed");
    expect(influence.numericAdjustmentApplied).toBe(false);
    expect(influence.reasons.join(" ")).toContain("public transport");
    expect(influence.reasons.join(" ")).toContain("noise");
  });
});
