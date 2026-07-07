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

import { fetchLINZAddressCandidates } from "../linz";
import { resolveAddressForAnalysis } from "../address-clarification";

const mockedFetchLINZAddressCandidates = vi.mocked(fetchLINZAddressCandidates);

describe("unit address resolution", () => {
  beforeEach(() => {
    mockedFetchLINZAddressCandidates.mockReset();
    mockedFetchLINZAddressCandidates.mockResolvedValue([]);
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
});
