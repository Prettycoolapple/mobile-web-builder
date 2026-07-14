import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectSubdivision, mergeSubdivisionCorrection, parseStreetNumberSuffix } from "../subdivision";
import { geocodeAddress } from "../geocode";
import { fetchLINZAddressCandidates, fetchLINZLetterSuffixAddresses, fetchLINZTitlesByAddressDetailed } from "../linz";

vi.mock("../geocode", () => ({
  geocodeAddress: vi.fn(),
}));

vi.mock("../linz", () => ({
  fetchLINZAddressCandidates: vi.fn(async () => []),
  fetchLINZLetterSuffixAddresses: vi.fn(async () => []),
  fetchLINZTitlesByAddressDetailed: vi.fn(async () => ({ preview: null, status: "no_result", source: null })),
  lrsAddressLooksExact: vi.fn((requested: string, candidate: string) => {
    const normalise = (value: string) =>
      value
        .toLowerCase()
        .replace(/\bauckland\b/g, "")
        .replace(/\b\d{4}\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const req = normalise(requested).split(" ");
    const cand = normalise(candidate).split(" ");
    if (req[0] !== cand[0]) return false;
    const reqTokens = new Set(req.slice(1));
    return cand.slice(1).filter(Boolean).every((token) => reqTokens.has(token));
  }),
}));

const mockedGeocodeAddress = vi.mocked(geocodeAddress);
const mockedFetchLINZAddressCandidates = vi.mocked(fetchLINZAddressCandidates);
const mockedFetchLINZLetterSuffixAddresses = vi.mocked(fetchLINZLetterSuffixAddresses);
const mockedFetchLINZTitlesByAddressDetailed = vi.mocked(fetchLINZTitlesByAddressDetailed);

describe("subdivision detection", () => {
  beforeEach(() => {
    mockedGeocodeAddress.mockReset();
    mockedFetchLINZAddressCandidates.mockReset();
    mockedFetchLINZAddressCandidates.mockResolvedValue([]);
    mockedFetchLINZLetterSuffixAddresses.mockReset();
    mockedFetchLINZLetterSuffixAddresses.mockResolvedValue([]);
    mockedFetchLINZTitlesByAddressDetailed.mockReset();
    mockedFetchLINZTitlesByAddressDetailed.mockResolvedValue({ preview: null, status: "no_result", source: null });
  });

  it("parses parent and child street-number suffixes", () => {
    expect(parseStreetNumberSuffix("66 Marine Parade, Mellons Bay")).toEqual({
      number: "66",
      letter: "",
      rest: "Marine Parade, Mellons Bay",
    });
    expect(parseStreetNumberSuffix("66A Marine Parade, Mellons Bay")).toEqual({
      number: "66",
      letter: "A",
      rest: "Marine Parade, Mellons Bay",
    });
  });

  it("blocks confirmed parent addresses and asks for child lots only", async () => {
    const result = await detectSubdivision("66 Marine Parade, Mellons Bay");

    expect(result.isSubdivided).toBe(true);
    expect(result.subLots).toEqual([
      "66A Marine Parade, Mellons Bay, Auckland 2014",
      "66B Marine Parade, Mellons Bay, Auckland 2014",
      "66C Marine Parade, Mellons Bay, Auckland 2014",
    ]);
    expect(result.subLots).not.toContain("66 Marine Parade, Mellons Bay");
  });

  it("recognises confirmed subdivisions even when the suburb is misspelled and not comma-separated", async () => {
    const result = await detectSubdivision("66 marine parade melons bay");

    expect(result.isSubdivided).toBe(true);
    expect(result.subLots).toEqual([
      "66A Marine Parade, Mellons Bay, Auckland 2014",
      "66B Marine Parade, Mellons Bay, Auckland 2014",
      "66C Marine Parade, Mellons Bay, Auckland 2014",
    ]);
  });

  it("does not block an explicitly selected child lot", async () => {
    await expect(detectSubdivision("66A Marine Parade, Mellons Bay")).resolves.toEqual({
      isSubdivided: false,
      parentAddress: "66A Marine Parade, Mellons Bay",
      subLots: [],
    });
  });

  it("lets a confirmed base address win over neighbouring LINZ suffix addresses", async () => {
    mockedFetchLINZAddressCandidates.mockResolvedValue([
      { address: "15 Amy Street, Ellerslie, Auckland 1051", id: "base-15", rank: 0.97 },
    ]);
    mockedFetchLINZLetterSuffixAddresses.mockResolvedValue([
      { letter: "A", address: "15A Amy Street, Ellerslie, Auckland", id: "child-15a", rank: 0.71 },
      { letter: "B", address: "15B Amy Street, Ellerslie, Auckland", id: "child-15b", rank: 0.7 },
    ]);

    await expect(detectSubdivision("15 Amy Street, Ellerslie")).resolves.toEqual({
      isSubdivided: false,
      parentAddress: "15 Amy Street, Ellerslie",
      subLots: [],
    });
    expect(mockedFetchLINZLetterSuffixAddresses).not.toHaveBeenCalled();
  });

  it("does not count a suffixed LINZ candidate as proof the base address exists", async () => {
    mockedFetchLINZAddressCandidates.mockResolvedValue([
      { address: "15A Amy Street, Ellerslie, Auckland 1051", id: "child-15a", rank: 0.97 },
    ]);
    mockedFetchLINZLetterSuffixAddresses.mockResolvedValue([
      { letter: "A", address: "15A Amy Street, Ellerslie, Auckland", id: "child-15a", rank: 0.71 },
      { letter: "B", address: "15B Amy Street, Ellerslie, Auckland", id: "child-15b", rank: 0.7 },
    ]);

    await expect(detectSubdivision("15 Amy Street, Ellerslie")).resolves.toEqual({
      isSubdivided: true,
      parentAddress: "15 Amy Street, Ellerslie",
      subLots: [
        "15A Amy Street, Ellerslie, Auckland",
        "15B Amy Street, Ellerslie, Auckland",
      ],
    });
  });

  it("asks for child lots from LINZ even when the parent address may still geocode", async () => {
    mockedFetchLINZLetterSuffixAddresses.mockResolvedValue([
      { letter: "A", address: "38A Rosebank Road, Papatoetoe, Auckland", id: "2429567", rank: 0.46 },
      { letter: "B", address: "38B Rosebank Road, Papatoetoe, Auckland", id: "2429568", rank: 0.46 },
      { letter: "C", address: "38C Rosebank Road, Papatoetoe, Auckland", id: "2429569", rank: 0.46 },
      { letter: "D", address: "38D Rosebank Road, Papatoetoe, Auckland", id: "2429570", rank: 0.46 },
    ]);
    mockedGeocodeAddress.mockResolvedValue({
      lat: -36.971,
      lng: 174.838,
      formatted: "38 Rosebank Road, Papatoetoe, Auckland 2025, New Zealand",
      suburb: "papatoetoe",
    });

    await expect(detectSubdivision("38 Rosebank Road, Papatoetoe")).resolves.toEqual({
      isSubdivided: true,
      parentAddress: "38 Rosebank Road, Papatoetoe",
      subLots: [
        "38A Rosebank Road, Papatoetoe, Auckland",
        "38B Rosebank Road, Papatoetoe, Auckland",
        "38C Rosebank Road, Papatoetoe, Auckland",
        "38D Rosebank Road, Papatoetoe, Auckland",
      ],
    });
  });

  it("keeps the parent canonical when suffix addresses share one live title", async () => {
    mockedFetchLINZLetterSuffixAddresses.mockResolvedValue([
      { letter: "A", address: "91A Thornton Road, Cambridge, Waipa", id: "1697540", rank: 0.9 },
      { letter: "B", address: "91B Thornton Road, Cambridge, Waipa", id: "1697541", rank: 0.9 },
    ]);
    mockedFetchLINZTitlesByAddressDetailed.mockImplementation(async (address) => ({
      preview: {
        address_id: address.includes("91A") ? "1697540" : "1697541",
        address,
        titles: [{
          title_no: "76331",
          title_type: "Freehold",
          title_status: "LIVE",
          legal_descriptions: ["Lot 1 DP 319375"],
          land_district: "South Auckland",
          issue_date: null,
          indicative_area_sqm: 1867,
        }],
      },
      status: "resolved",
      source: "live",
    }));

    await expect(detectSubdivision("91 Thornton Road, Cambridge")).resolves.toEqual({
      isSubdivided: false,
      parentAddress: "91 Thornton Road, Cambridge",
      subLots: [
        "91A Thornton Road, Cambridge, Waipa",
        "91B Thornton Road, Cambridge, Waipa",
      ],
      classification: "same_title_aliases",
      canonicalAddress: "91 Thornton Road, Cambridge",
      geocodeFallbackAddress: "91A Thornton Road, Cambridge, Waipa",
      sharedTitleNo: "76331",
    });

    await expect(detectSubdivision("91B Thornton Road, Cambridge")).resolves.toMatchObject({
      isSubdivided: false,
      parentAddress: "91 Thornton Road, Cambridge",
      canonicalAddress: "91 Thornton Road, Cambridge",
      geocodeFallbackAddress: "91B Thornton Road, Cambridge",
      sharedTitleNo: "76331",
      classification: "same_title_aliases",
    });
  });

  it("does not treat one neighbouring suffix as proof the parent was subdivided away", async () => {
    mockedGeocodeAddress.mockImplementation(async (address: string) => {
      if (address === "8 Hampton Drive, St Heliers") {
        return { lat: -36.853, lng: 174.857, formatted: "8 Hampton Drive, St Heliers, Auckland 1071, New Zealand", suburb: "st heliers" };
      }
      if (address.startsWith("8A ")) {
        return { lat: -36.854, lng: 174.858, formatted: "8A Hampton Drive, St Heliers, Auckland 1071, New Zealand", suburb: "st heliers" };
      }
      throw new Error(`No match for ${address}`);
    });

    await expect(detectSubdivision("8 Hampton Drive, St Heliers")).resolves.toEqual({
      isSubdivided: false,
      parentAddress: "8 Hampton Drive, St Heliers",
      subLots: [],
    });
  });

  it("does not block a valid parent address even when multiple child lots also geocode", async () => {
    mockedGeocodeAddress.mockImplementation(async (address: string) => {
      if (address === "8 Hampton Drive, St Heliers") {
        return { lat: -36.853, lng: 174.857, formatted: "8 Hampton Drive, St Heliers, Auckland 1071, New Zealand", suburb: "st heliers" };
      }
      if (address.startsWith("8A ")) {
        return { lat: -36.854, lng: 174.858, formatted: "8A Hampton Drive, St Heliers, Auckland 1071, New Zealand", suburb: "st heliers" };
      }
      if (address.startsWith("8B ")) {
        return { lat: -36.8545, lng: 174.8585, formatted: "8B Hampton Drive, St Heliers, Auckland 1071, New Zealand", suburb: "st heliers" };
      }
      throw new Error(`No match for ${address}`);
    });

    await expect(detectSubdivision("8 Hampton Drive, St Heliers")).resolves.toEqual({
      isSubdivided: false,
      parentAddress: "8 Hampton Drive, St Heliers",
      subLots: [],
    });
  });

  it("asks for a child lot when multiple distinct suffixes are found", async () => {
    mockedGeocodeAddress.mockImplementation(async (address: string) => {
      if (address.startsWith("42A ")) {
        return { lat: -36.85, lng: 174.86, formatted: "42A Example Road, Auckland 1071, New Zealand", suburb: "auckland" };
      }
      if (address.startsWith("42B ")) {
        return { lat: -36.851, lng: 174.861, formatted: "42B Example Road, Auckland 1071, New Zealand", suburb: "auckland" };
      }
      throw new Error(`No match for ${address}`);
    });

    await expect(detectSubdivision("42 Example Road, Auckland")).resolves.toEqual({
      isSubdivided: true,
      parentAddress: "42 Example Road, Auckland",
      subLots: [
        "42A Example Road, Auckland 1071, New Zealand",
        "42B Example Road, Auckland 1071, New Zealand",
      ],
    });
  });
});

describe("subdivision correction merge", () => {
  const subdivisionClarification = JSON.stringify({
    clarificationType: "subdivision",
    question: '"4 Inglis Street" looks like it has been subdivided into separate lots. Which one would you like me to analyse?',
    options: ["4A Inglis Street, Mosgiel", "4B Inglis Street, Mosgiel"],
    parentAddress: "4 Inglis Street",
  });

  it("merges a bare suburb correction with the parent street from the prior subdivision clarification", () => {
    // Regression for the exact bug report: user typed "4 Inglis street", got
    // asked to pick between the Mosgiel sub-lots, then replied "Birkenhead"
    // meaning "4 Inglis Street, Birkenhead" — a different real address.
    expect(mergeSubdivisionCorrection(subdivisionClarification, "Birkenhead")).toEqual({
      mergedAddress: "4 Inglis Street, Birkenhead",
    });
  });

  it("strips any suburb already attached to the parent address before merging", () => {
    const clarification = JSON.stringify({
      clarificationType: "subdivision",
      parentAddress: "4 Inglis Street, Mosgiel",
    });
    expect(mergeSubdivisionCorrection(clarification, "Birkenhead")).toEqual({
      mergedAddress: "4 Inglis Street, Birkenhead",
    });
  });

  it("returns null when the previous assistant turn wasn't a subdivision clarification", () => {
    const otherClarification = JSON.stringify({ clarificationType: "address_ambiguous", options: [] });
    expect(mergeSubdivisionCorrection(otherClarification, "Birkenhead")).toBeNull();
  });

  it("returns null when there is no prior assistant content", () => {
    expect(mergeSubdivisionCorrection(null, "Birkenhead")).toBeNull();
    expect(mergeSubdivisionCorrection(undefined, "Birkenhead")).toBeNull();
  });

  it("returns null for a reply that starts with a number (the user picked a sub-lot directly)", () => {
    expect(mergeSubdivisionCorrection(subdivisionClarification, "4A Inglis Street, Mosgiel")).toBeNull();
  });

  it("returns null for an empty or overly long reply", () => {
    expect(mergeSubdivisionCorrection(subdivisionClarification, "   ")).toBeNull();
    expect(
      mergeSubdivisionCorrection(subdivisionClarification, "actually never mind show me something else entirely different"),
    ).toBeNull();
  });

  it("returns null when the prior assistant content isn't valid JSON", () => {
    expect(mergeSubdivisionCorrection("Here are some listings in Ponsonby.", "Birkenhead")).toBeNull();
  });
});
