import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLrsTitlePreviewCacheForTests,
  estateTypeFromLrsTitles,
  fetchLINZTitlesByAddress,
  fetchLINZTitlesByAddressDetailed,
  mapLinzParcelFeature,
} from "../linz";

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
