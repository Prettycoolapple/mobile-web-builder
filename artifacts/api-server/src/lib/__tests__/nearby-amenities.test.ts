import { describe, expect, it } from "vitest";
import {
  buildNearbyAmenityRequest,
  detectNearbyAmenityIntent,
  renderNearbyAmenitiesAnswer,
  reportSchoolZonesToAmenityResults,
  type NearbyAmenityTarget,
} from "../nearby-amenities";

const target: NearbyAmenityTarget = {
  address: "33 Harris Road, Auckland",
  lat: -36.9,
  lng: 174.8,
};

describe("nearby amenity intent", () => {
  it("detects nearby schools and hospitals without treating the address as analysis", () => {
    const text = "33 Harris road \u5468\u8fb9\u6709\u4ec0\u4e48\u5b66\u6821\u533b\u9662";
    expect(detectNearbyAmenityIntent(text)).toBe(true);

    const request = buildNearbyAmenityRequest(text);
    expect(request.categories).toEqual(["school", "hospital"]);
    expect(request.rawTerms).toContain("schools");
    expect(request.rawTerms).toContain("hospitals");
  });

  it("maps future amenity categories such as pools and recreation centres", () => {
    const request = buildNearbyAmenityRequest("is there a swimming pool or recreational center near this property?");
    expect(request.categories).toEqual(["swimming_pool", "recreation_centre"]);
  });
});

describe("nearby amenity rendering", () => {
  it("renders report school zones and live amenities as a chat table", () => {
    const zones = reportSchoolZonesToAmenityResults([
      {
        name: "Example Primary School",
        level: "primary",
        yearLevels: "Years 1-6",
        authority: "State",
        enrolmentScheme: "Home zone",
      },
    ]);
    const output = renderNearbyAmenitiesAnswer({
      target,
      request: { categories: ["school", "hospital"], rawTerms: ["schools", "hospitals"] },
      results: [
        ...zones,
        {
          category: "hospital",
          name: "Example Hospital",
          address: "1 Hospital Road",
          lat: -36.91,
          lng: 174.81,
          distanceMeters: 1500,
          driveDistanceMeters: null,
          driveDurationMinutes: null,
          source: "google_places",
        },
      ],
      searchedLiveAmenities: true,
    });

    expect(output).toContain("| Type | Name | Distance | Notes | Address |");
    expect(output).toContain("School zone");
    expect(output).toContain("Example Hospital");
    expect(output).toContain("1.5 km");
    expect(output).not.toContain("listingUrl");
    expect(output).not.toContain('"candidates"');
  });
});
