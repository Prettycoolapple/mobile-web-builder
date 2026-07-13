import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: vi.fn(),
    },
  },
}));

vi.mock("../geocode", () => ({
  nominatimSearchNz: vi.fn(async () => []),
  tryGeocodeAddress: vi.fn(async () => ({
    lat: -37.779,
    lng: 175.271,
    formatted: "289 Ulster Street, Whitiora, Hamilton 3200, New Zealand",
    suburb: "whitiora",
  })),
}));

vi.mock("../linz", () => ({
  fetchLINZAddressCandidates: vi.fn(async () => []),
}));

import { tryGeocodeAddress } from "../geocode";
import { fetchLINZAddressCandidates } from "../linz";
import { resolveAddressForAnalysis } from "../address-clarification";

const mockedFetchLINZAddressCandidates = vi.mocked(fetchLINZAddressCandidates);
const mockedTryGeocodeAddress = vi.mocked(tryGeocodeAddress);

describe("unit address resolution", () => {
  beforeEach(() => {
    mockedFetchLINZAddressCandidates.mockReset();
    mockedFetchLINZAddressCandidates.mockResolvedValue([]);
    mockedTryGeocodeAddress.mockReset();
    mockedTryGeocodeAddress.mockResolvedValue({
      lat: -37.779,
      lng: 175.271,
      formatted: "289 Ulster Street, Whitiora, Hamilton 3200, New Zealand",
      suburb: "whitiora",
    });
  });

  it("uses the LINZ slash-unit address when geocoding only returns the parent", async () => {
    mockedFetchLINZAddressCandidates.mockResolvedValue([
      {
        address: "1/289 Ulster Street, Whitiora, Hamilton 3200, New Zealand",
        id: "unit-1-289",
        rank: 0.98,
      },
    ]);

    await expect(resolveAddressForAnalysis("1/289 Ulster Street, Whitiora", "en")).resolves.toEqual({
      resolvedAddress: "1/289 Ulster Street, Whitiora, Hamilton 3200, New Zealand",
      clarification: null,
    });
  });

  it("deduplicates the district and council labels for 2926A State Highway 30", async () => {
    const canonical = {
      lat: -38.0263534,
      lng: 176.7097369,
      formatted: "2926A STATE HIGHWAY 30, Rotomā, New Zealand",
      suburb: null,
    };
    mockedTryGeocodeAddress.mockResolvedValue(canonical);
    mockedFetchLINZAddressCandidates.mockResolvedValue([{
      address: "2926A, State Highway 30, Whakatāne District, Bay of Plenty, 3075",
      id: "linz-2926a",
      rank: 0.99,
    }]);

    await expect(resolveAddressForAnalysis(
      "2926A State Highway 30, Onepu, Whakatāne District",
      "en",
    )).resolves.toEqual({
      resolvedAddress: canonical.formatted,
      clarification: null,
    });
  });
});
