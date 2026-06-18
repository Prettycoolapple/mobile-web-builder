import { describe, expect, it } from "vitest";
import {
  dedupeEquivalentAddressOptions,
  detectMultiSuburbAmbiguity,
  filterAddressOptionsForAnalysis,
  isFullStreetAddressForAnalysis,
} from "../address-clarification";

describe("address clarification candidate dedupe", () => {
  it("collapses equivalent formatted variants for the same mapped address", () => {
    const options = dedupeEquivalentAddressOptions([
      {
        formatted: "825 Riddell Road, St Heliers, Auckland 1071, New Zealand",
        lat: -36.851,
        lng: 174.857,
      },
      {
        formatted: "825, Riddell Road, Saint Heliers, Orakei, Auckland, 1074",
        lat: -36.8511,
        lng: 174.8571,
      },
    ]);

    expect(options).toEqual([
      {
        formatted: "825 Riddell Road, St Heliers, Auckland 1071, New Zealand",
        lat: -36.851,
        lng: 174.857,
      },
    ]);
  });

  it("keeps same-number street addresses when they map to different places", () => {
    const options = dedupeEquivalentAddressOptions([
      {
        formatted: "1 Queen Street, Auckland Central, Auckland 1010, New Zealand",
        lat: -36.844,
        lng: 174.768,
      },
      {
        formatted: "1 Queen Street, Wainuiomata, Lower Hutt 5014, New Zealand",
        lat: -41.261,
        lng: 174.949,
      },
    ]);

    expect(options).toHaveLength(2);
  });

  it("rejects suburb or district candidates for property analysis", () => {
    const options = filterAddressOptionsForAnalysis("15 fishertown street, grey Lynn", [
      {
        formatted: "Grey Lynn, Auckland, New Zealand",
        lat: -36.861,
        lng: 174.731,
      },
    ]);

    expect(options).toEqual([]);
    expect(isFullStreetAddressForAnalysis("Grey Lynn, Auckland, New Zealand")).toBe(false);
  });

  it("keeps corrected full street address candidates with the same street number", () => {
    const options = filterAddressOptionsForAnalysis("15 fishertown street, grey Lynn", [
      {
        formatted: "15 Fisherton Street, Grey Lynn, Auckland 1021, New Zealand",
        lat: -36.858,
        lng: 174.735,
      },
    ]);

    expect(options).toHaveLength(1);
    expect(isFullStreetAddressForAnalysis(options[0]!.formatted)).toBe(true);
  });

  it("keeps numbered highway address candidates", () => {
    const options = filterAddressOptionsForAnalysis("527A Coatesville-Riverhead Highway", [
      {
        formatted: "527A, Coatesville-Riverhead Highway, Coatesville, Riverhead, Rodney, Auckland, 0793",
        lat: -36.7326907,
        lng: 174.6298135,
      },
    ]);

    expect(options).toHaveLength(1);
    expect(isFullStreetAddressForAnalysis("534, Coatesville-Riverhead Highway, Coatesville, Riverhead, Rodney, Auckland, 0793")).toBe(true);
  });

  it("keeps numbered geocoder street-line candidates without conventional suffixes", () => {
    const options = filterAddressOptionsForAnalysis("1 Broadway Newmarket", [
      {
        formatted: "1, Broadway, Newmarket, Auckland, 1023",
        lat: -36.869,
        lng: 174.779,
      },
      {
        formatted: "12, The Anchorage, Auckland, 2012",
        lat: -36.887,
        lng: 174.912,
      },
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]!.formatted).toBe("1, Broadway, Newmarket, Auckland, 1023");
    expect(isFullStreetAddressForAnalysis("12, The Anchorage, Auckland, 2012")).toBe(true);
  });

  it("rejects different street numbers when the user supplied a number", () => {
    const options = filterAddressOptionsForAnalysis("15 fishertown street, grey Lynn", [
      {
        formatted: "51 Fisherton Street, Grey Lynn, Auckland 1021, New Zealand",
        lat: -36.858,
        lng: 174.735,
      },
    ]);

    expect(options).toEqual([]);
  });
});

describe("multi-suburb address ambiguity", () => {
  const rosebankAvondale = {
    formatted: "35 Rosebank Road, Avondale, Auckland 1026, New Zealand",
    lat: -36.894,
    lng: 174.689,
  };
  const rosebankPapatoetoe = {
    formatted: "35 Rosebank Road, Papatoetoe, Auckland 2025, New Zealand",
    lat: -36.977,
    lng: 174.861,
  };

  it("asks when a bare street number+name maps to multiple suburbs", () => {
    const ambiguous = detectMultiSuburbAmbiguity("35 Rosebank Road", [
      rosebankAvondale,
      rosebankPapatoetoe,
    ]);

    expect(ambiguous).not.toBeNull();
    expect(ambiguous).toHaveLength(2);
  });

  it("treats a bare '… Auckland' (region only, no suburb) as still ambiguous", () => {
    const ambiguous = detectMultiSuburbAmbiguity("35 Rosebank Road, Auckland", [
      rosebankAvondale,
      rosebankPapatoetoe,
    ]);

    expect(ambiguous).toHaveLength(2);
  });

  it("does NOT ask once the user names the suburb", () => {
    expect(
      detectMultiSuburbAmbiguity("35 Rosebank Road, Avondale", [
        rosebankAvondale,
        rosebankPapatoetoe,
      ]),
    ).toBeNull();
  });

  it("does NOT ask when the street resolves to a single place", () => {
    expect(detectMultiSuburbAmbiguity("35 Rosebank Road", [rosebankAvondale])).toBeNull();
  });
});
