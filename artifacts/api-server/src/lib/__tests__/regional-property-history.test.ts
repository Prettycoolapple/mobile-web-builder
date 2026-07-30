import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRegionalPropertyHistory } from "../regional-property-history";

describe("regional property history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns Taupō District's exact rateable-land area for 302 Whangamata Road", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{ attributes: {
        valuation_id: "0738426000",
        property_location: "302 Whangamata Road, Taupo Ward",
        property_legal_desc: "Lot 2 DPS 87710",
        cert_of_title: "SA69C/153",
        PARCEL_AREA: 47_130,
      } }],
    }), { status: 200 })));

    await expect(fetchRegionalPropertyHistory(
      "taupo", "302 Whangamata Road, Kinloch", -38.6206095, 175.9763673,
    )).resolves.toMatchObject({
      land_area_sqm: 47_130,
      land_area_source: "taupo_council_rateable_land_gis",
      land_area_scope: "rating_unit",
      sources_confirmed: ["land_area_sqm (Taupō District Council rateable land GIS)"],
    });
  });

  it("returns Selwyn's exact council rating record for 100 Birchs Road", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{ attributes: {
        Assessment_ID: "2355235600",
        CertificateTitle: "724483",
        Location: "100 Birchs Road",
        FullLegal: "Lot 7 DP 494658",
        LandValue: 860_000,
        CapitalValue: 1_590_000,
        Hectares: 0.4621,
        Shape_Area: 4618.48,
      } }],
    }), { status: 200 })));

    await expect(fetchRegionalPropertyHistory(
      "selwyn", "100 Birchs Road, Prebbleton, Selwyn District", -43.5929461, 172.5104991,
    )).resolves.toMatchObject({
      cv_nzd: 1_590_000,
      cv_year: 2024,
      land_area_sqm: 4_621,
      land_area_source: "selwyn_council_rating_gis",
      land_area_scope: "rating_unit",
      sources_confirmed: expect.arrayContaining([
        "cv_nzd (Selwyn District Council 2024 rating valuation GIS)",
        "land_area_sqm (Selwyn District Council rating GIS)",
      ]),
    });
  });

  it("returns Buller's parcel area and related council valuation for 175 Romilly Street", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("queryRelatedRecords")) {
        return new Response(JSON.stringify({
          relatedRecordGroups: [{
            objectId: 16765,
            relatedRecords: [{ attributes: {
              OBJECTID: 3232,
              LandValue: 130_000,
              CapitalValue: 350_000,
              ValuationDate: 1_756_684_800_000,
              ImprovementsValue: 220_000,
            } }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        features: [{ attributes: {
          OBJECTID: 16765,
          Appellation: "Lot 2 DP 4334",
          Titles: "NL43/96",
          SurveyArea: 1_012,
          ValNum: "1896029500",
          ParcelID: 3_596_659,
        } }],
      }), { status: 200 });
    }));

    await expect(fetchRegionalPropertyHistory(
      "buller", "175 Romilly Street, Westport", -41.76295052, 171.60663355,
    )).resolves.toMatchObject({
      cv_nzd: 350_000,
      cv_year: 2025,
      land_area_sqm: 1_012,
      land_area_source: "buller_council_property_gis",
      land_area_scope: "parcel",
    });
  });

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

  it("returns PNCC's exact rating-unit CV and area for a Palmerston North property", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      features: [
        { attributes: { LOCATION: "3 RIMU PLACE", CURR_CAPITAL_VALUE: "$ 600000", RATES_AREA: 0.0967, RATES_YEAR: "2026/27" } },
        { attributes: { LOCATION: "5 RIMU PLACE", CURR_CAPITAL_VALUE: "$ 550000", RATES_AREA: 0.0964, RATES_YEAR: "2026/27" } },
      ],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "manawatu",
      "5 Rimu Place, Cloverlea, Palmerston North",
      -40.3466946,
      175.5813663,
    )).resolves.toMatchObject({
      cv_nzd: 550_000,
      cv_year: 2026,
      land_area_sqm: 964,
      land_area_source: "pncc_council_rating_gis",
      land_area_scope: "rating_unit",
      sources_confirmed: expect.arrayContaining([
        "cv_nzd (Palmerston North City Council rating GIS)",
        "land_area_sqm (Palmerston North City Council rating GIS)",
      ]),
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.pathname).toContain("/PROPERTY_PARCEL_VALUATION_VIEW/FeatureServer/0/query");
    expect(requestUrl.searchParams.get("geometry")).toBe("175.5813663,-40.3466946");
  });

  it("does not invent council values when a Manawatu District point has no PNCC rating polygon", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }), { status: 200 })));

    await expect(fetchRegionalPropertyHistory(
      "manawatu", "156 North Street, Feilding", -40.2160888, 175.5782755, 751,
    )).resolves.toMatchObject({
      cv_nzd: null,
      land_area_sqm: 751,
      land_area_source: "linz",
      land_area_scope: "parcel",
    });
  });

  it("returns Western Bay council CV and legal area for 30 Athenree Road", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const features = url.pathname.endsWith("/12/query")
        ? [{ attributes: {
            ParcelID: "1019/63",
            ValuationID: "06610-45000",
            ParcelAddress: "30 ATHENREE ROAD",
            ValuationAddress: "30 ATHENREE ROAD ATHENREE",
            LegalDescription: "LOT 4 DPS 4295",
            LegalArea: 0.1012,
          } }]
        : url.pathname.endsWith("/6/query")
          ? [{ attributes: { ValuationNumber: "06610-45000", ImprovementValue: "215,000" } }]
          : [{ attributes: { ValuationNumber: "06610-45000", CapitalValue: "710,000" } }];
      return new Response(JSON.stringify({ features }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "western-bay",
      "30 Athenree Road, Athenree, Bay of Plenty",
      -37.4460583,
      175.9643635,
    )).resolves.toMatchObject({
      cv_nzd: 710_000,
      land_area_sqm: 1_012,
      land_area_source: "western_bay_council_rating_gis",
      sources_confirmed: expect.arrayContaining(["cv_nzd (Western Bay of Plenty District Council rating GIS)"]),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("/Property/MapServer/"))).toBe(true);
  });

  it("returns Western Bay council CV and legal area for 481 Pukehina Parade", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify({ features: url.pathname.endsWith("/12/query")
        ? [{ attributes: { ValuationID: "06922*374*00*", ParcelAddress: "481 PUKEHINA PARADE", LegalArea: 0.0819 } }]
        : url.pathname.endsWith("/6/query")
          ? [{ attributes: { ValuationNumber: "0692237400", ImprovementValue: "0" } }]
          : [{ attributes: { ValuationNumber: "0692237400", CapitalValue: "1,020,000" } }],
      }), { status: 200 });
    }));

    await expect(fetchRegionalPropertyHistory(
      "western-bay", "481 Pukehina Parade, Pukehina", -37.7720624, 176.4995595,
    )).resolves.toMatchObject({
      cv_nzd: 1_020_000,
      land_area_sqm: 819,
      property_type: "Vacant land / section",
      sources_confirmed: expect.arrayContaining([
        "property_type (Western Bay of Plenty District Council zero improvement value)",
      ]),
    });
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

  it("uses an exact Napier council address record without accepting a neighbour", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      features: [
        { properties: { property_address: "21 Wycliffe Street", regarea: 0.0710 } },
        { properties: { property_address: "23 Wycliffe Street", regarea: 0.0806 } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "napier",
      "23 Wycliffe Street, Onekawa, Napier",
      -39.5112541,
      176.8915180,
    )).resolves.toMatchObject({
      land_area_sqm: 806,
      land_area_source: "napier_council_property_wfs",
      land_area_scope: "parcel",
      cv_nzd: null,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("typeNames=NCC%3ANCS_PROPADDRESS");
  });

  it("uses the exact Hastings rating unit for 226 Havelock Road", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      features: [
        { attributes: { PR_address: "224 Havelock Road HAVELOCK NORTH 4130", VAL_area: 0.0800 } },
        {
          attributes: {
            PR_address: "226 Havelock Road HAVELOCK NORTH 4130",
            PropertyNo: 55494,
            RT_assessment_no: "1026169500",
            VAL_area: 2.9483,
            PR_cert_of_title: "1237991",
            OperativeDPZone: "Hastings General Residential",
          },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "hastings",
      "226 Havelock Road, Akina, Hastings",
      -39.65520308,
      176.85964827,
    )).resolves.toMatchObject({
      land_area_sqm: 29_483,
      land_area_source: "hastings_council_property_gis",
      land_area_scope: "rating_unit",
      cv_nzd: null,
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/Property/Property_Data/MapServer/0/query");
  });

  it("uses New Plymouth's exact rating unit for 70 Pioneer Road", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [
        { attributes: { full_address: "68 Pioneer Road, NEW PLYMOUTH", property_area: 0.0500, capital_value: 410_000 } },
        { attributes: {
          full_address: "70 Pioneer Road, NEW PLYMOUTH",
          property_area: 0.0506,
          capital_value: 425_000,
          land_value: 270_000,
          rate_year: 2026,
          legaldesc: "Lot 66 DP 1957",
        } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(fetchRegionalPropertyHistory(
      "new-plymouth",
      "70 Pioneer Road, Moturoa, New Plymouth",
      -39.06562567,
      174.03497135,
    )).resolves.toMatchObject({
      cv_nzd: 425_000,
      cv_year: 2026,
      land_area_sqm: 506,
      land_area_source: "new_plymouth_council_rating_gis",
      land_area_scope: "rating_unit",
      property_type: "Residential",
    });
  });

  it("uses Tauranga's exact assessment and 2023 valuation records", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const features = url.includes("/Assessment/FeatureServer/2/query")
        ? [
            { attributes: { LOCATIONADDRESS: "14 LODGE AVENUE", VNZ: "0677213500", Shape__Area: 700 } },
            { attributes: { LOCATIONADDRESS: "16 LODGE AVENUE", SUBURB: "Mount Maunganui", VNZ: "0677213600", ValuationNumber: "06772-136-00", Shape__Area: 856.9 } },
          ]
        : [{ attributes: { VNZ: "0677213600", LandArea: 0.0855, CV2023: 1_580_000, LV2023: 1_550_000, VI2023: 30_000, Shape__Area: 856.9 } }];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRegionalPropertyHistory(
      "tauranga",
      "16 Lodge Avenue, Mount Maunganui, Tauranga",
      -37.6646905,
      176.2110862,
    )).resolves.toMatchObject({
      cv_nzd: 1_580_000,
      cv_year: 2023,
      land_area_sqm: 855,
      land_area_source: "tauranga_council_rating_gis",
      land_area_scope: "rating_unit",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("VNZ%3D%270677213600%27");
  });

  it("uses Kāpiti's exact rating polygon for 37 Tieko Street", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [
        { attributes: { Location: "35 Tieko Street, Paraparaumu", Capital_Value: 800_000, Hectares: 0.5 } },
        { attributes: {
          Valuation_ID: "1526029202",
          Location: "37 Tieko Street, Paraparaumu",
          Capital_Value: 950_000,
          Land_Value: 710_000,
          Improvements_Value: 240_000,
          Hectares: 3.9122,
          Valuation_Date: Date.UTC(2023, 7, 1),
          Legal: "Lot 3 DP 378541",
        } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(fetchRegionalPropertyHistory(
      "kapiti",
      "37 Tieko Street, Otaihanga, Paraparaumu",
      -40.8838658,
      175.0208898,
    )).resolves.toMatchObject({
      cv_nzd: 950_000,
      cv_year: 2023,
      land_area_sqm: 39_122,
      land_area_source: "kapiti_council_rating_gis",
      land_area_scope: "rating_unit",
    });
  });
});
