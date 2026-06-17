import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLrsTitlePreviewCacheForTests,
  estateTypeFromLrsTitles,
  fetchLINZTitlesByAddress,
  fetchLINZTitlesByAddressDetailed,
  isLinzTitleServiceAvailable,
  mapLinzParcelFeature,
  screenAddressFreehold,
  tenureCategoryFromEstate,
} from "../linz";

function lrsTitleResponses(addressId: string, address: string, typeCode: string, typeDesc: string) {
  return [
    new Response(JSON.stringify({ data: [{ id: addressId, address, source: "address", rank: 1 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      titles: { items: [{ titleNo: "NA1/1", type: { code: typeCode, desc: typeDesc }, status: { code: "LIVE", desc: "Live" } }] },
      address: { id: Number(addressId), string: address },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
}

describe("LINZ title service availability window", () => {
  const ORIG_START = process.env["LINZ_TITLE_SERVICE_START_HOUR"];
  const ORIG_END = process.env["LINZ_TITLE_SERVICE_END_HOUR"];
  afterEach(() => {
    if (ORIG_START === undefined) delete process.env["LINZ_TITLE_SERVICE_START_HOUR"];
    else process.env["LINZ_TITLE_SERVICE_START_HOUR"] = ORIG_START;
    if (ORIG_END === undefined) delete process.env["LINZ_TITLE_SERVICE_END_HOUR"];
    else process.env["LINZ_TITLE_SERVICE_END_HOUR"] = ORIG_END;
  });

  it("is open at midday NZ and closed early morning / late night (NZST, no DST in June)", () => {
    expect(isLinzTitleServiceAvailable(new Date("2026-06-16T00:00:00Z"))).toBe(true);  // 12:00 NZ
    expect(isLinzTitleServiceAvailable(new Date("2026-06-15T18:00:00Z"))).toBe(false); // 06:00 NZ
    expect(isLinzTitleServiceAvailable(new Date("2026-06-16T11:00:00Z"))).toBe(false); // 23:00 NZ
  });

  it("honours env-overridden window bounds", () => {
    process.env["LINZ_TITLE_SERVICE_START_HOUR"] = "0";
    process.env["LINZ_TITLE_SERVICE_END_HOUR"] = "24";
    expect(isLinzTitleServiceAvailable(new Date("2026-06-15T18:00:00Z"))).toBe(true); // 06:00 NZ now in window
    process.env["LINZ_TITLE_SERVICE_START_HOUR"] = "13";
    expect(isLinzTitleServiceAvailable(new Date("2026-06-16T00:00:00Z"))).toBe(false); // 12:00 NZ below start
  });
});

describe("freehold title screening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearLrsTitlePreviewCacheForTests();
  });

  it("keeps a fee-simple title as freehold", async () => {
    const responses = lrsTitleResponses("1", "1 Freehold Lane, St Heliers, Auckland", "FSIM", "Fee simple");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1]));
    const result = await screenAddressFreehold("1 Freehold Lane, St Heliers, Auckland");
    expect(result.decision).toBe("keep");
  });

  it("rejects a positively non-freehold (cross lease) title", async () => {
    const responses = lrsTitleResponses("2", "2 Crosslease Way, Kohimarama, Auckland", "CRLE", "Cross lease");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(responses[0]).mockResolvedValueOnce(responses[1]));
    const result = await screenAddressFreehold("2 Crosslease Way, Kohimarama, Auckland");
    expect(result.decision).toBe("reject");
  });

  it("returns a caveat when the title cannot be confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    ));
    const result = await screenAddressFreehold("99 Unknown Road, Nowhere");
    expect(result.decision).toBe("caveat");
  });
});

describe("tenureCategoryFromEstate", () => {
  it("maps each LINZ estate string to a tenure category", () => {
    expect(tenureCategoryFromEstate("Fee Simple")).toBe("freehold");
    expect(tenureCategoryFromEstate("Freehold")).toBe("freehold");
    expect(tenureCategoryFromEstate("Cross Lease")).toBe("cross_lease");
    expect(tenureCategoryFromEstate("Leasehold")).toBe("leasehold");
    expect(tenureCategoryFromEstate("Unit Title")).toBe("unit_title");
    expect(tenureCategoryFromEstate("Stratum")).toBe("unit_title");
  });

  it("returns null for empty or unrecognised estates", () => {
    expect(tenureCategoryFromEstate(null)).toBeNull();
    expect(tenureCategoryFromEstate("")).toBeNull();
    expect(tenureCategoryFromEstate("Some Other Estate")).toBeNull();
  });
});

describe("LINZ parcel area mapping", () => {
  it("uses survey area for report facts while preserving calculated polygon area", () => {
    const parcel = mapLinzParcelFeature({
      _id: "parcel-1",
      survey_area: 32113,
      calc_area: 32092,
      titles: "NA123/45",
      appellation: "Lot 1 DP 12345",
    });

    expect(parcel.area_sqm).toBe(32113);
    expect(parcel.survey_area_sqm).toBe(32113);
    expect(parcel.calc_area_sqm).toBe(32092);
  });
});

describe("LINZ LRS public title preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearLrsTitlePreviewCacheForTests();
  });

  it("resolves cross lease tenure from the public address title preview", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          {
            id: "1666137",
            address: "38 Te Arawa Street, Orakei, Auckland",
            source: "address",
            rank: 0.64,
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        titles: {
          items: [
            {
              titleNo: "NA60C/140",
              type: { code: "CRLE", desc: "Cross lease" },
              status: { code: "LIVE", desc: "Live" },
              legalDescriptions: ["Lot 241 Deposited Plan 49124", "Flat 1 Deposited Plan 108104"],
              landDistrict: "North Auckland",
              indicativeArea: 791,
            },
            {
              titleNo: "NA63A/1182",
              type: { code: "CRLE", desc: "Cross lease" },
              status: { code: "LIVE", desc: "Live" },
              legalDescriptions: ["Lot 241 Deposited Plan 49124", "Flat 2 Deposited Plan 112400"],
              landDistrict: "North Auckland",
              indicativeArea: 791,
            },
          ],
        },
        address: { id: 1666137, string: "38 Te Arawa Street, Orakei, Auckland" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await fetchLINZTitlesByAddress("38 Te Arawa Street, Orakei, Auckland");

    expect(preview?.address_id).toBe("1666137");
    expect(preview?.titles).toHaveLength(2);
    expect(estateTypeFromLrsTitles(preview?.titles ?? [])).toBe("Cross Lease");
    expect(fetchMock.mock.calls[1][0].toString()).toContain("/public-searches/lws/titles?addressId=1666137");
  });

  it("reports live LRS source when title preview resolves", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "1666137", address: "38 Te Arawa Street, Orakei, Auckland", source: "address", rank: 0.64 }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        titles: {
          items: [{
            titleNo: "NA60C/140",
            type: { code: "CRLE", desc: "Cross lease" },
            status: { code: "LIVE", desc: "Live" },
          }],
        },
        address: { id: 1666137, string: "38 Te Arawa Street, Orakei, Auckland" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const lookup = await fetchLINZTitlesByAddressDetailed("38 Te Arawa Street, Orakei, Auckland");

    expect(lookup.status).toBe("resolved");
    expect(lookup.source).toBe("live");
    expect(estateTypeFromLrsTitles(lookup.preview?.titles ?? [])).toBe("Cross Lease");
  });

  it("uses an exact cached LRS title when title rows are temporarily unavailable", async () => {
    const liveFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "1666137", address: "38 Te Arawa Street, Orakei, Auckland", source: "address", rank: 0.64 }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        titles: {
          items: [{
            titleNo: "NA60C/140",
            type: { code: "CRLE", desc: "Cross lease" },
            status: { code: "LIVE", desc: "Live" },
          }],
        },
        address: { id: 1666137, string: "38 Te Arawa Street, Orakei, Auckland" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", liveFetch);
    await fetchLINZTitlesByAddressDetailed("38 Te Arawa Street, Orakei, Auckland");

    const unavailableFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "1666137", address: "38 Te Arawa Street, Orakei, Auckland", source: "address", rank: 0.64 }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", unavailableFetch);

    const lookup = await fetchLINZTitlesByAddressDetailed("38 Te Arawa Street, Orakei, Auckland");

    expect(lookup.status).toBe("unavailable");
    expect(lookup.source).toBe("cache");
    expect(estateTypeFromLrsTitles(lookup.preview?.titles ?? [])).toBe("Cross Lease");
  });

  it("retries with a LINZ-style address when Google-formatted address includes postcode and country", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          {
            id: "1666137",
            address: "38 Te Arawa Street, Orakei, Auckland",
            source: "address",
            rank: 0.79,
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        titles: {
          items: [
            {
              titleNo: "NA60C/140",
              type: { code: "CRLE", desc: "Cross lease" },
              status: { code: "LIVE", desc: "Live" },
              legalDescriptions: ["Lot 241 Deposited Plan 49124", "Flat 1 Deposited Plan 108104"],
              landDistrict: "North Auckland",
              indicativeArea: 791,
            },
          ],
        },
        address: { id: 1666137, string: "38 Te Arawa Street, Orakei, Auckland" },
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await fetchLINZTitlesByAddress("38 Te Arawa Street, Orakei, Auckland 1071, New Zealand");

    expect(estateTypeFromLrsTitles(preview?.titles ?? [])).toBe("Cross Lease");
    expect(fetchMock.mock.calls[2][0].toString()).toContain("q=38+Te+Arawa+Street%2C+Orakei%2C+Auckland");
    expect(fetchMock.mock.calls[3][0].toString()).toContain("addressId=1666137");
  });

  it("rejects a mismatched address suggestion instead of trusting a neighbour", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: [
        {
          id: "999",
          address: "38A Te Arawa Street, Orakei, Auckland",
          source: "address",
          rank: 0.99,
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const preview = await fetchLINZTitlesByAddress("38 Te Arawa Street, Orakei, Auckland");

    expect(preview).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });
});
