import { afterEach, describe, expect, it, vi } from "vitest";
import { normaliseNzAddressForGeocode, tryGeocodeAddress } from "../geocode";
import { extractSuburb } from "../utils";

describe("geocode address selection", () => {
  const originalGoogleKey = process.env.GOOGLE_MAPS_API_KEY;

  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = originalGoogleKey;
    vi.unstubAllGlobals();
  });

  it("prefers the exact parent street number over a suffixed variant", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              formatted_address: "8A Hampton Drive, St Heliers, Auckland 1071, New Zealand",
              geometry: { location: { lat: -36.854, lng: 174.858 } },
              address_components: [
                { long_name: "8A", short_name: "8A", types: ["street_number"] },
              ],
            },
            {
              formatted_address: "8 Hampton Drive, St Heliers, Auckland 1071, New Zealand",
              geometry: { location: { lat: -36.853, lng: 174.857 } },
              address_components: [
                { long_name: "8", short_name: "8", types: ["street_number"] },
              ],
            },
          ],
        }),
      })),
    );

    await expect(tryGeocodeAddress("8 Hampton Drive, St Heliers")).resolves.toMatchObject({
      formatted: "8 Hampton Drive, St Heliers, Auckland 1071, New Zealand",
    });
  });

  it("keeps an explicitly requested suffixed lot ahead of the parent", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: "OK",
          results: [
            {
              formatted_address: "8 Hampton Drive, St Heliers, Auckland 1071, New Zealand",
              geometry: { location: { lat: -36.853, lng: 174.857 } },
              address_components: [
                { long_name: "8", short_name: "8", types: ["street_number"] },
              ],
            },
            {
              formatted_address: "8A Hampton Drive, St Heliers, Auckland 1071, New Zealand",
              geometry: { location: { lat: -36.854, lng: 174.858 } },
              address_components: [
                { long_name: "8A", short_name: "8A", types: ["street_number"] },
              ],
            },
          ],
        }),
      })),
    );

    await expect(tryGeocodeAddress("8A Hampton Drive, St Heliers")).resolves.toMatchObject({
      formatted: "8A Hampton Drive, St Heliers, Auckland 1071, New Zealand",
    });
  });

  it("uses the exact Whakatane council address point instead of nearby 1140 Braemar Road", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Geocortex/Cadastre/MapServer/1/query")) {
        return new Response(JSON.stringify({ features: [
          {
            attributes: { HouseNumber: 1134, Suffix: null, Address: "1134 BRAEMAR ROAD", Town: "Rotoma" },
            geometry: { x: 176.7156598, y: -38.0165820 },
          },
          {
            attributes: { HouseNumber: 1140, Suffix: null, Address: "1140 BRAEMAR ROAD", Town: "Rotoma" },
            geometry: { x: 176.7193241, y: -38.0155546 },
          },
        ] }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("1134 Braemar Road, Rotoma 3192, New Zealand")).resolves.toMatchObject({
      formatted: "1134 BRAEMAR ROAD, Rotoma, New Zealand",
      lat: -38.0165820,
      lng: 176.7156598,
    });
  });

  it("uses the PNCC parcel centroid for an exact Palmerston North address", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/PROPERTY_PARCEL_ADDR_VIEW/FeatureServer/0/query")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("where")).toBe("UPPER(FULLADDRESS) LIKE '54 MANAWATU STREET%'");
        expect(parsed.searchParams.get("returnCentroid")).toBe("true");
        return new Response(JSON.stringify({ features: [{
          attributes: { FULLADDRESS: "54 MANAWATU STREET PALMERSTON NORTH" },
          centroid: { x: 175.6412559975, y: -40.3651486422 },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("54 Manawatu Street, Hokowhitu, Palmerston North")).resolves.toMatchObject({
      formatted: "54 MANAWATU STREET PALMERSTON NORTH, New Zealand",
      lat: -40.3651486422,
      lng: 175.6412559975,
    });
  });

  it("uses the MDC address point for an exact Feilding address", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/MDC_PROPERTY_ADDRESSPOINTS/FeatureServer/0/query")) {
        expect(new URL(url).searchParams.get("where"))
          .toBe("UPPER(house_numb) = '156' AND UPPER(road_name) = 'NORTH STREET'");
        return new Response(JSON.stringify({ features: [{
          attributes: { addr_full: "156 North Street, Feilding" },
          geometry: { x: 175.5782755285, y: -40.2160887709 },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("156 North Street, Feilding")).resolves.toMatchObject({
      formatted: "156 North Street, Feilding, Manawatu District, New Zealand",
      lat: -40.2160887709,
      lng: 175.5782755285,
    });
  });

  it("resolves abbreviated Braemar Rd through Whakatane even when the locality says Rotorua", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gis.rdc.govt.nz")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      if (url.includes("/Geocortex/Cadastre/MapServer/1/query")) {
        expect(new URL(url).searchParams.get("where")).toContain("1140 BRAEMAR ROAD");
        return new Response(JSON.stringify({ features: [{
          attributes: { HouseNumber: 1140, Suffix: null, Address: "1140 BRAEMAR ROAD", Town: "Rotoma" },
          geometry: { x: 176.7193241, y: -38.0155546 },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("1140 Braemar Rd, Rotorua")).resolves.toMatchObject({
      formatted: "1140 BRAEMAR ROAD, Rotoma, New Zealand",
      lat: -38.0155546,
      lng: 176.7193241,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Google for a comma-less rural address when both council probes miss", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gis.whakatane.govt.nz")) {
        const where = new URL(url).searchParams.get("where") ?? "";
        expect(where).toContain("1140 BRAEMAR ROAD");
        expect(where).not.toContain("ROTOMA");
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      if (url.includes("gis.rdc.govt.nz")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      if (url.includes("maps.googleapis.com")) {
        return new Response(JSON.stringify({
          status: "OK",
          results: [{
            formatted_address: "1140 Braemar Road, Rotomā, Whakatāne District, Bay of Plenty, New Zealand",
            geometry: { location: { lat: -38.0155546, lng: 176.7193241 } },
            address_components: [{ long_name: "1140", short_name: "1140", types: ["street_number"] }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("1140 Braemar Rd Rotoma")).resolves.toMatchObject({
      formatted: "1140 Braemar Road, Rotomā, Whakatāne District, Bay of Plenty, New Zealand",
      lat: -38.0155546,
      lng: 176.7193241,
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("gis.whakatane.govt.nz"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("maps.googleapis.com"))).toBe(true);
  });

  it("does not accept a nearby Braemar Road address from fallback geocoders", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Geocortex/Cadastre/MapServer/1/query")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      if (url.includes("maps.googleapis.com")) {
        return new Response(JSON.stringify({
          status: "OK",
          results: [{
            formatted_address: "1140 Braemar Road, Rotoma 3192, New Zealand",
            geometry: { location: { lat: -38.0155, lng: 176.7193 } },
            address_components: [{ long_name: "1140", short_name: "1140", types: ["street_number"] }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("1138 Braemar Road, Rotoma 3192, New Zealand")).resolves.toBeNull();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("maps.googleapis.com"))).toBe(true);
  });

  it("resolves comma-separated Whakatane state-highway addresses through the exact council point", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Geocortex/Cadastre/MapServer/1/query")) {
        expect(new URL(url).searchParams.get("where")).toContain("2926A STATE HIGHWAY 30");
        return new Response(JSON.stringify({ features: [{
          attributes: { HouseNumber: 2926, Suffix: "A", Address: "2926A STATE HIGHWAY 30", Town: "Rotoma" },
          geometry: { x: 176.7097369, y: -38.0263534 },
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(tryGeocodeAddress("2926A, State Highway 30, Onepu, Whakatāne District, Bay of Plenty, 3075")).resolves.toMatchObject({
      formatted: "2926A STATE HIGHWAY 30, Rotoma, New Zealand",
      lat: -38.0263534,
      lng: 176.7097369,
    });
  });

  it("rejects a geocoder result with a different street number", async () => {
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("maps.googleapis.com")) {
        return new Response(JSON.stringify({
          status: "OK",
          results: [{
            formatted_address: "1140 Braemar Road, Rotoma 3192, New Zealand",
            geometry: { location: { lat: -38.0155, lng: 176.7193 } },
            address_components: [{ long_name: "1140", short_name: "1140", types: ["street_number"] }],
          }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }));

    await expect(tryGeocodeAddress("1134 Braemar Road, Somewhere Else")).resolves.toBeNull();
  });
});

describe("normaliseNzAddressForGeocode", () => {
  it("cleans realestate.co.nz address punctuation and Auckland City admin labels", () => {
    expect(normaliseNzAddressForGeocode("9 Rukutai Street , Orakei, Auckland City, Auckland"))
      .toBe("9 Rukutai Street, Orakei, Auckland");
  });

  it("removes duplicated country and postcode noise from app-formatted addresses", () => {
    expect(normaliseNzAddressForGeocode("70 Screen Road, Coatesville 0793, New Zealand"))
      .toBe("70 Screen Road, Coatesville");
  });
});

describe("extractSuburb", () => {
  it("skips street fragments in Nominatim-style rural addresses", () => {
    expect(extractSuburb("70, Screen Road, Coatesville, Rodney, Auckland, 0792"))
      .toBe("coatesville");
  });
});
