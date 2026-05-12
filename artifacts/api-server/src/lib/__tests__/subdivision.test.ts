import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectSubdivision, parseStreetNumberSuffix } from "../subdivision";
import { geocodeAddress } from "../geocode";

vi.mock("../geocode", () => ({
  geocodeAddress: vi.fn(),
}));

const mockedGeocodeAddress = vi.mocked(geocodeAddress);

describe("subdivision detection", () => {
  beforeEach(() => {
    mockedGeocodeAddress.mockReset();
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
