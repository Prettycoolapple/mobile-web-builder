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
