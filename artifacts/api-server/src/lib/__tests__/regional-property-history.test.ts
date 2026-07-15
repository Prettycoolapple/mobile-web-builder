import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRegionalPropertyHistory } from "../regional-property-history";

describe("regional property history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns Christchurch's complete exact-address rating unit for a multi-parcel property", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/2/query")) {
        return new Response(JSON.stringify({
          features: [{ attributes: {
            RatingUnitID: 74280,
            PreferredStreetAddressID: 140960,
            StreetAddress: "21 Defoe Place",
            LocalityName: "Waltham",
            drvLegalDescription: "Pt Lots 13,14 DP 1417",
            Shape__Area: 552.127685315,
          } }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        features: [{ attributes: {
          StreetAddressID: 140960,
          StreetAddress: "21 Defoe Place",
          LocalityName: "Waltham",
        } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "christchurch",
      "21 Defoe Pl, Waltham, Christchurch 8023, New Zealand",
      -43.5472275,
      172.6478817,
      363,
    )).resolves.toMatchObject({
      land_area_sqm: 552,
      land_area_source: "christchurch_council_rating_unit",
      land_area_scope: "rating_unit",
      sources_confirmed: ["land_area_sqm (Christchurch City Council rating unit GIS)"],
    });

    const ratingUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(ratingUrl.pathname).toContain("/OpenData/Property/FeatureServer/2/query");
    expect(ratingUrl.searchParams.get("where")).toBe("UPPER(StreetAddress) = '21 DEFOE PLACE'");
    const preferredUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(preferredUrl.pathname).toContain("/OpenData/Property/FeatureServer/3/query");
    expect(preferredUrl.searchParams.get("where")).toBe("StreetAddressID = 140960");
  });

  it("keeps the LINZ parcel when Christchurch's preferred address does not match", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(url.pathname.endsWith("/2/query") ? {
        features: [{ attributes: {
          PreferredStreetAddressID: 140960,
          StreetAddress: "21 Defoe Place",
          LocalityName: "Waltham",
          drvLegalDescription: "Pt Lots 13,14 DP 1417",
          Shape__Area: 552.127,
        } }],
      } : {
        features: [{ attributes: {
          StreetAddressID: 140960,
          StreetAddress: "23 Defoe Place",
          LocalityName: "Waltham",
        } }],
      }), { status: 200 });
    }));

    await expect(fetchRegionalPropertyHistory(
      "christchurch",
      "21 Defoe Place, Waltham, Christchurch",
      -43.5472,
      172.6479,
      363,
    )).resolves.toMatchObject({
      land_area_sqm: 363,
      land_area_source: "linz",
      land_area_scope: "parcel",
    });
  });

  it("keeps the LINZ parcel for Christchurch child addresses, invalid areas, and service failures", async () => {
    const childFetch = vi.fn();
    vi.stubGlobal("fetch", childFetch);
    await expect(fetchRegionalPropertyHistory(
      "christchurch",
      "21A Defoe Place, Waltham, Christchurch",
      -43.5472,
      172.6479,
      180,
    )).resolves.toMatchObject({ land_area_sqm: 180, land_area_source: "linz" });
    expect(childFetch).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{ attributes: {
        PreferredStreetAddressID: 140960,
        StreetAddress: "21 Defoe Place",
        LocalityName: "Waltham",
        Shape__Area: -1,
      } }],
    }), { status: 200 })));
    await expect(fetchRegionalPropertyHistory(
      "christchurch",
      "21 Defoe Place, Waltham, Christchurch",
      -43.5472,
      172.6479,
      363,
    )).resolves.toMatchObject({ land_area_sqm: 363, land_area_source: "linz" });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    await expect(fetchRegionalPropertyHistory(
      "christchurch",
      "21 Defoe Place, Waltham, Christchurch",
      -43.5472,
      172.6479,
      363,
    )).resolves.toMatchObject({ land_area_sqm: 363, land_area_source: "linz" });
  });

  it("returns the exact Whakatane council CV rather than a neighbouring Braemar property", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      features: [
        { attributes: { Location: "1140 BRAEMAR ROAD Rotoma", CapitalValue: 630_000, SurveyArea: 3_435 } },
        { attributes: { Location: "1134 BRAEMAR ROAD Rotoma", CapitalValue: 1_310_000, SurveyArea: 61_829 } },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "whakatane",
      "1134 Braemar Road, Rotoma, Rotorua 3192",
      -38.0165820,
      176.7156598,
    )).resolves.toMatchObject({
      cv_nzd: 1_310_000,
      cv_year: 2025,
      land_area_sqm: 61_829,
      sources_confirmed: expect.arrayContaining(["cv_nzd (Whakatane District Council rating GIS)"]),
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toContain("/Geocortex/PropertyRoadSearch/MapServer/2/query");
    expect(requestUrl.searchParams.get("geometry")).toBe("176.7156598,-38.016582");
  });

  it("returns 1140's distinct council CV", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{ attributes: {
        Location: "1140 BRAEMAR ROAD Rotoma",
        CapitalValue: 630_000,
        SurveyArea: 3_435,
      } }],
    }), { status: 200 })));

    await expect(fetchRegionalPropertyHistory(
      "whakatane",
      "1140 Braemar Rd, Rotorua",
      -38.0155546,
      176.7193241,
    )).resolves.toMatchObject({ cv_nzd: 630_000, land_area_sqm: 3_435 });
  });

  it("retries Whakatane by exact address text when the point misses the rating polygon", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.has("geometry")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      expect(url.searchParams.get("where")).toBe("UPPER(Location) LIKE '1140 BRAEMAR ROAD%'");
      return new Response(JSON.stringify({ features: [{ attributes: {
        Location: "1140 BRAEMAR ROAD Rotoma",
        CapitalValue: 630_000,
        SurveyArea: 3_435,
      } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "whakatane",
      "1140 Braemar Rd Rotoma",
      -38.0158,
      176.7190,
    )).resolves.toMatchObject({ cv_nzd: 630_000, land_area_sqm: 3_435 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not attach a neighbouring valuation when the exact number is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{ attributes: { Location: "1140 BRAEMAR ROAD Rotoma", CapitalValue: 630_000 } }],
    }), { status: 200 })));

    await expect(fetchRegionalPropertyHistory(
      "whakatane",
      "1138 Braemar Road, Rotoma",
      -38.0155546,
      176.7193241,
      4_000,
    )).resolves.toMatchObject({ cv_nzd: null, land_area_sqm: 4_000 });
  });

  it("does not query Whakatane valuation data for a genuine Rotorua property", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "rotorua",
      "85 Whittaker Road, Koutu, Rotorua",
      -38.1251,
      176.2438,
      541,
    )).resolves.toMatchObject({ cv_nzd: null, land_area_sqm: 541 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the exact Southland District Council CV for 77 Kruger Street", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      features: [
        { attributes: { Address: "75 Kruger Street,Balfour", CapitalValue: "$210000" } },
        { attributes: { Address: "77 Kruger Street,Balfour", CapitalValue: "$250000", LandValue: "$80000" } },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "southland",
      "77 Kruger Street, Balfour, Southland 9746",
      -45.8372796,
      168.5815783,
      2_023,
    )).resolves.toMatchObject({
      cv_nzd: 250_000,
      land_area_sqm: 2_023,
      land_area_source: "linz",
      sources_confirmed: expect.arrayContaining(["cv_nzd (Southland District Council rating GIS)"]),
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toContain("/External_Property_Layers/MapServer/3/query");
    expect(requestUrl.searchParams.get("geometry")).toBe("168.5815783,-45.8372796");
  });

  it("does not attach a neighbouring Southland valuation when the street address differs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{ attributes: { Address: "75 Kruger Street,Balfour", CapitalValue: "$210000" } }],
    }), { status: 200 })));

    await expect(fetchRegionalPropertyHistory(
      "southland",
      "77 Kruger Street, Balfour",
      -45.8372796,
      168.5815783,
      2_023,
    )).resolves.toMatchObject({ cv_nzd: null, land_area_sqm: 2_023 });
  });
});
