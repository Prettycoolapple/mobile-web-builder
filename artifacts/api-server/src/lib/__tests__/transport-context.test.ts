import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTransportRoiInfluence,
  classifyCommuteConvenience,
  classifyHighwayDistance,
  classifyRouteCommuteConvenience,
  classifyServiceIntensity,
  classifyTransitAccessForStop,
  fetchGoogleRoutesCommute,
  parseGoogleDurationSeconds,
  routeTypeToMode,
} from "../transport-context";
import type { CityCommuteContext, HighwayAccessContext, PublicTransportContext } from "../transport-context";

describe("transport context classifiers", () => {
  const originalFetch = global.fetch;
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalGoogleKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
    vi.restoreAllMocks();
  });

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

    expect(classifyRouteCommuteConvenience(null, null)).toBe("unknown");
    expect(classifyRouteCommuteConvenience(7.9, 24)).toBe("excellent");
    expect(classifyRouteCommuteConvenience(13, 28)).toBe("good");
    expect(classifyRouteCommuteConvenience(22, 42)).toBe("limited");
    expect(classifyRouteCommuteConvenience(35, 55)).toBe("poor");
  });

  it("creates train/ferry and CBD ROI narrative without highway notes or numeric adjustments", () => {
    const publicTransport: PublicTransportContext = {
      accessTier: "good",
      nearestStop: {
        name: "Orakei Station",
        mode: "train",
        distanceM: 1250,
        routeCount: 2,
        serviceIntensity: "regular",
      },
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
      distanceKm: 8.4,
      durationMinutes: 18,
      convenienceTier: "good",
      confidence: "high",
    };

    const influence = buildTransportRoiInfluence(publicTransport, highwayAccess, cityCommute);

    expect(influence.influence).toBe("positive");
    expect(influence.numericAdjustmentApplied).toBe(false);
    expect(influence.reasons.join(" ")).toContain("train");
    expect(influence.reasons.join(" ")).toContain("Google Routes");
    expect(influence.reasons.join(" ")).not.toContain("motorway");
    expect(influence.reasons.join(" ")).not.toContain("noise");
  });

  it("parses Google duration strings", () => {
    expect(parseGoogleDurationSeconds("1260s")).toBe(1260);
    expect(parseGoogleDurationSeconds("3.5s")).toBe(3.5);
    expect(parseGoogleDurationSeconds("bad")).toBeNull();
  });

  it("fetches Google Routes commute distance and minutes", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ routes: [{ duration: "1260s", distanceMeters: 16234 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const commute = await fetchGoogleRoutesCommute(-36.9, 174.85, {
      name: "Auckland CBD",
      lat: -36.8485,
      lng: 174.7633,
      region: "auckland",
    });

    expect(commute).toMatchObject({
      centreName: "Auckland CBD",
      distanceKm: 16.2,
      durationMinutes: 21,
      confidence: "high",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Goog-Api-Key": "test-key",
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        }),
      }),
    );
  });

  it("hides Google Routes commute when the API is unavailable", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Routes API disabled" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ) as typeof fetch;

    const commute = await fetchGoogleRoutesCommute(-36.9, 174.85, {
      name: "Auckland CBD",
      lat: -36.8485,
      lng: 174.7633,
      region: "auckland",
    });

    expect(commute.distanceKm).toBeNull();
    expect(commute.durationMinutes).toBeNull();
    expect(commute.confidence).toBe("unknown");
  });
});
