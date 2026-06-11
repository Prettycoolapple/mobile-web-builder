import { describe, expect, it } from "vitest";
import { buildListingTeaser } from "../listing-teaser";

describe("buildListingTeaser", () => {
  it("uses marketing copy while excluding address and property facts", () => {
    const teaser = buildListingTeaser(
      "1/2 Kenny Road delivers peaceful, north-facing living with elegant indoor-outdoor flow. Four bedrooms and three bathrooms support flexible family living. Walk to village cafes and transport.",
      {
        address: "1/2 Kenny Road, Remuera, Auckland City, Auckland 1050",
        listingTitle: "1/2 Kenny Road",
        bedrooms: 4,
        bathrooms: 3,
      },
    );

    expect(teaser).toBe("Walk to village cafes and transport.");
    expect(teaser).not.toMatch(/Kenny Road|bedroom|bathroom/i);
  });

  it("ignores templated marketplace fallback descriptions", () => {
    const teaser = buildListingTeaser(
      "House for sale at 1/2 Kenny Road, Remuera, Auckland City, Auckland 1050, with 4 beds, 3 baths.",
      {
        address: "1/2 Kenny Road, Remuera, Auckland City, Auckland 1050",
        bedrooms: 4,
        bathrooms: 3,
      },
    );

    expect(teaser).toBeNull();
  });

  it("keeps section selling points without repeating land area", () => {
    const teaser = buildListingTeaser(
      "Rare elevated section with wide urban views and a sheltered building platform. 310sqm land area in a tightly held Remuera pocket. Concept plans are available for review.",
      {
        address: "10 Standen Avenue, Remuera, Auckland City, Auckland 1050",
        propertyType: "section",
        landAreaSqm: 310,
      },
    );

    expect(teaser).toBe("Rare elevated section with wide urban views and a sheltered building platform.");
    expect(teaser).not.toMatch(/310|sqm|Standen/i);
  });
});
