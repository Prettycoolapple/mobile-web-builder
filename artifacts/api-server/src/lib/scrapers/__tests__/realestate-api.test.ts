import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetSuburbIndexCacheForTests,
  addressLineAppearsInText,
  addressesLikelyMatch,
  extractCombinedListingAddressParts,
  extractListingFactAreaSqm,
  findLocationInTextViaIndex,
  findSuburbId,
  looksLikeCombinedListingAddress,
  normaliseListingLandAreaSqm,
  reconcileListingBedBath,
  reconcileListingLandArea,
  resolveLocationToSuburbNames,
  resolveRealestateLocation,
  searchListingsByName,
} from "../realestate-api";

afterEach(() => {
  vi.restoreAllMocks();
  _resetSuburbIndexCacheForTests();
});

function locationDirectoryPayload() {
  return {
    data: [
        { type: "regions", id: "36", attributes: { title: "Waikato", slug: "waikato" } },
        { type: "regions", id: "45", attributes: { title: "Canterbury", slug: "canterbury" } },
        { type: "regions", id: "46", attributes: { title: "Otago", slug: "otago" } },
        { type: "regions", id: "50", attributes: { title: "Central Otago / Lakes District", slug: "central-otago-lakes-district" } },
        { type: "regions", id: "35", attributes: { title: "Auckland", slug: "auckland" } },
      ],
      included: [
        { type: "districts", id: "278", attributes: { title: "Timaru", slug: "timaru", "fq-slug": "canterbury_timaru" } },
        { type: "districts", id: "235", attributes: { title: "South Waikato", slug: "south-waikato", "fq-slug": "waikato_south-waikato" } },
        { type: "districts", id: "237", attributes: { title: "Hamilton City", slug: "hamilton-city", "fq-slug": "waikato_hamilton-city" } },
        { type: "districts", id: "282", attributes: { title: "Christchurch City", slug: "christchurch-city", "fq-slug": "canterbury_christchurch-city" } },
        { type: "districts", id: "277", attributes: { title: "Waimate", slug: "waimate", "fq-slug": "canterbury_waimate" } },
        { type: "districts", id: "286", attributes: { title: "Dunedin City", slug: "dunedin-city", "fq-slug": "otago_dunedin-city" } },
        { type: "districts", id: "288", attributes: { title: "Queenstown-Lakes District", slug: "queenstown-lakes-district", "fq-slug": "central-otago-lakes-district_queenstown-lakes-district" } },
        { type: "districts", id: "223", attributes: { title: "Manukau City", slug: "manukau-city", "fq-slug": "auckland_manukau-city" } },
        { type: "districts", id: "285", attributes: { title: "Clutha", slug: "clutha", "fq-slug": "otago_clutha" } },
        { type: "suburbs", id: "4151", attributes: { title: "Timaru Central", slug: "timaru-central", "fq-slug": "canterbury_timaru_timaru-central", "parent-id": 278 } },
        { type: "suburbs", id: "3159", attributes: { title: "Gleniti", slug: "gleniti", "fq-slug": "canterbury_timaru_gleniti", "parent-id": 278 } },
        { type: "suburbs", id: "4069", attributes: { title: "Tirau", slug: "tirau", "fq-slug": "waikato_south-waikato_tirau", "parent-id": 235 } },
        { type: "suburbs", id: "4100", attributes: { title: "Milton", slug: "milton", "fq-slug": "otago_clutha_milton", "parent-id": 285 } },
        { type: "suburbs", id: "4101", attributes: { title: "Otaio", slug: "otaio", "fq-slug": "canterbury_waimate_otaio", "parent-id": 277 } },
        { type: "suburbs", id: "4102", attributes: { title: "Clarks Beach", slug: "clarks-beach", "fq-slug": "auckland_manukau-city_clarks-beach", "parent-id": 223 } },
      ],
  };
}

function mockLocationDirectory() {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => locationDirectoryPayload(),
  } as Response);
}

describe("realestate-api location resolution", () => {
  it("resolves Timaru as a Canterbury district, not fuzzy Tirau", async () => {
    mockLocationDirectory();

    await expect(findSuburbId("Timaru")).resolves.toBeNull();
    const resolved = await resolveRealestateLocation("Timaru");

    expect(resolved?.status).toBe("district");
    if (resolved?.status === "district") {
      expect(resolved.district.fqSlug).toBe("canterbury_timaru");
      expect(resolved.suburbs.map((suburb) => suburb.title)).toEqual(["Timaru Central", "Gleniti"]);
    }
  });

  it("honours explicit region hints when resolving close place names", async () => {
    mockLocationDirectory();

    const timaru = await resolveRealestateLocation("Timaru, Canterbury");
    const tirau = await resolveRealestateLocation("Tirau");
    const wrongRegion = await resolveRealestateLocation("Timaru, Waikato");
    const contradictedExtraction = await resolveRealestateLocation("Tirau", "sections in Timaru, Canterbury");

    expect(timaru?.status).toBe("district");
    expect(tirau?.status).toBe("suburb");
    if (tirau?.status === "suburb") expect(tirau.suburb.fqSlug).toBe("waikato_south-waikato_tirau");
    expect(wrongRegion?.status).toBe("invalid");
    expect(contradictedExtraction?.status).toBe("invalid");
  });

  it("finds district names inside natural language search text", async () => {
    mockLocationDirectory();

    const resolved = await findLocationInTextViaIndex("sections in Timaru, Canterbury");

    expect(resolved?.status).toBe("district");
    if (resolved?.status === "district") expect(resolved.district.title).toBe("Timaru");
  });

  it("treats city and region names as real search areas instead of fuzzy suburbs", async () => {
    mockLocationDirectory();

    const hamilton = await resolveRealestateLocation("Hamilton");
    const christchurch = await resolveRealestateLocation("Christchurch");
    const otago = await resolveRealestateLocation("Otago");

    expect(hamilton?.status).toBe("district");
    if (hamilton?.status === "district") expect(hamilton.district.title).toBe("Hamilton City");
    expect(christchurch?.status).toBe("district");
    if (christchurch?.status === "district") expect(christchurch.district.title).toBe("Christchurch City");
    expect(otago?.status).toBe("region");
    if (otago?.status === "region") expect(otago.region.title).toBe("Otago");
  });

  it("expands a REGION name into every leaf-suburb name it contains (criteria search fan-out)", async () => {
    mockLocationDirectory();

    // Waikato region → South Waikato + Hamilton City districts → their suburbs.
    const waikato = await resolveLocationToSuburbNames("Waikato");
    expect(waikato?.scope).toBe("region");
    expect(waikato?.label).toBe("Waikato");
    expect(waikato?.suburbNames).toContain("tirau"); // South Waikato child

    // Otago region → Clutha district → Milton.
    const otago = await resolveLocationToSuburbNames("otago");
    expect(otago?.scope).toBe("region");
    expect(otago?.suburbNames).toContain("milton");
  });

  it("expands a DISTRICT/city name into its leaf suburbs, keeps a leaf suburb as itself, and returns null for unknowns", async () => {
    mockLocationDirectory();

    const timaru = await resolveLocationToSuburbNames("Timaru");
    expect(timaru?.scope).toBe("district");
    expect(timaru?.suburbNames).toEqual(["timaru central", "gleniti"]);

    const tirau = await resolveLocationToSuburbNames("Tirau");
    expect(tirau?.scope).toBe("suburb");
    expect(tirau?.suburbNames).toEqual(["tirau"]);

    await expect(resolveLocationToSuburbNames("not a real place xyz")).resolves.toBeNull();
  });

  it("finds city and region names inside natural language search text", async () => {
    mockLocationDirectory();

    const waikatoHamilton = await findLocationInTextViaIndex("What's on the market in Waikato Hamilton region?");
    const christchurch = await findLocationInTextViaIndex("Anything in Christchurch");
    const otago = await findLocationInTextViaIndex("I mean otago");

    expect(waikatoHamilton?.status).toBe("district");
    if (waikatoHamilton?.status === "district") expect(waikatoHamilton.district.title).toBe("Hamilton City");
    expect(christchurch?.status).toBe("district");
    if (christchurch?.status === "district") expect(christchurch.district.title).toBe("Christchurch City");
    expect(otago?.status).toBe("region");
    if (otago?.status === "region") expect(otago.region.title).toBe("Otago");
  });

  it("uses district and region listing filters for broader official locations", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (rawUrl) => {
      const url = String(rawUrl);
      if (url.includes("/locations?")) {
        return { ok: true, json: async () => locationDirectoryPayload() } as Response;
      }
      if (url.includes("/listings?")) {
        return { ok: true, json: async () => ({ data: [], meta: { totalResults: 0 } }) } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await searchListingsByName({ suburbName: "Christchurch", minPrice: 0, maxPrice: 3_000_000 });
    const christchurchListingUrl = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
    expect(decodeURIComponent(christchurchListingUrl)).toContain("filter[district][]=282");

    _resetSuburbIndexCacheForTests();
    fetchMock.mockClear();
    await searchListingsByName({ suburbName: "Otago", minPrice: 0, maxPrice: 3_000_000 });
    const otagoListingUrl = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
    expect(decodeURIComponent(otagoListingUrl)).toContain("filter[region][]=46");
  });
});

describe("realestate-api listing land-area reconciliation", () => {
  it("uses listing-page land area when the search API returns a large outlier", () => {
    const result = reconcileListingLandArea(6337, 1198);

    expect(result).toEqual({ landArea: 1198, landAreaApprox: true });
  });

  it("keeps the search API land area when the listing page agrees within tolerance", () => {
    const result = reconcileListingLandArea(1200, 1198);

    expect(result).toEqual({ landArea: 1200, landAreaApprox: false });
  });

  it("does not invent a land area when the search API and listing page are both missing", () => {
    const result = reconcileListingLandArea(null, null);

    expect(result).toEqual({ landArea: null, landAreaApprox: false });
  });
});

describe("realestate-api listing fact extraction", () => {
  it("prefers explicit listing-description area facts over bad header totals", () => {
    const text = `
      Floor area 483m2 Land area 6337m2
      Property details
      Floor Area:79sqm (more or less)
      Land Area:1199sqm (more or less)
    `;

    expect(extractListingFactAreaSqm(text, "floor")).toBe(79);
    expect(extractListingFactAreaSqm(text, "land")).toBe(1199);
  });
});

describe("realestate-api listing bed/bath reconciliation", () => {
  it("prefers the listing-page bathroom count over the API aggregate", () => {
    // 66A Marine Parade: API bathrooms-total-count 9, page shows 5.
    expect(reconcileListingBedBath(6, 9, 6, 5)).toEqual({ bedrooms: 6, bathrooms: 5 });
  });

  it("drops an implausible bathroom aggregate when the page has no count", () => {
    // API says 9 baths / 6 beds and the page gave us no bathroom value.
    expect(reconcileListingBedBath(6, 9, 6, null)).toEqual({ bedrooms: 6, bathrooms: null });
  });

  it("keeps the API count when it is plausible and the page agrees", () => {
    expect(reconcileListingBedBath(3, 1, 3, 1)).toEqual({ bedrooms: 3, bathrooms: 1 });
  });

  it("keeps the API count when the page offers no comparison and it is plausible", () => {
    expect(reconcileListingBedBath(4, 3, null, null)).toEqual({ bedrooms: 4, bathrooms: 3 });
  });
});

describe("realestate-api structured listing area units", () => {
  it("converts hectare land-area values to square metres", () => {
    expect(normaliseListingLandAreaSqm(1.4933, "HA")).toBe(14933);
    expect(normaliseListingLandAreaSqm(8734, "SQM")).toBe(8734);
  });
});

describe("realestate-api combined listing detection", () => {
  it("flags package listings with multiple street addresses", () => {
    expect(looksLikeCombinedListingAddress("15 Fisherton Street & 7 Stanmore Road, Grey Lynn")).toBe(true);
    expect(looksLikeCombinedListingAddress("15 Fisherton Street, Grey Lynn")).toBe(false);
  });

  it("extracts child addresses from explicit package listings", () => {
    expect(extractCombinedListingAddressParts("15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland")).toEqual({
      packageAddress: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn, Auckland",
        "7 Stanmore Road, Grey Lynn, Auckland",
      ],
    });
  });

  it("does not split unit or apartment slash addresses as package listings", () => {
    const addresses = [
      "3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland",
      "3/31 Scanlan Street, Grey Lynn, Auckland City, Auckland",
      "Unit 3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland",
      "Apartment 3, 31 Scanlan Street, Grey Lynn, Auckland City, Auckland",
    ];

    for (const address of addresses) {
      expect(looksLikeCombinedListingAddress(address)).toBe(false);
      expect(extractCombinedListingAddressParts(address)).toBeNull();
    }
  });

  it("expands shared street names for package listing shorthand", () => {
    expect(extractCombinedListingAddressParts("15 & 17 Fisherton Street, Grey Lynn")).toEqual({
      packageAddress: "15 & 17 Fisherton Street, Grey Lynn",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn",
        "17 Fisherton Street, Grey Lynn",
      ],
    });
  });

  it("expands comma-separated shared-street package numbers", () => {
    expect(extractCombinedListingAddressParts("3, 5, 7, 9 and 11 Rukutai Street, Orakei, Auckland")).toEqual({
      packageAddress: "3, 5, 7, 9 and 11 Rukutai Street, Orakei, Auckland",
      childAddresses: [
        "3 Rukutai Street, Orakei, Auckland",
        "5 Rukutai Street, Orakei, Auckland",
        "7 Rukutai Street, Orakei, Auckland",
        "9 Rukutai Street, Orakei, Auckland",
        "11 Rukutai Street, Orakei, Auckland",
      ],
    });
  });

  it("expands package listings across multiple street groups", () => {
    expect(extractCombinedListingAddressParts("3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei")).toEqual({
      packageAddress: "3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei",
      childAddresses: [
        "3 Rukutai Street, Orakei",
        "5 Rukutai Street, Orakei",
        "7 Rukutai Street, Orakei",
        "9 Rukutai Street, Orakei",
        "11 Rukutai Street, Orakei",
        "12 Godden Crescent, Orakei",
      ],
    });
  });

  it("normalises Cresent typo while detecting package listings", () => {
    expect(extractCombinedListingAddressParts("11 Rukutai Street and 12 Godden Cresent, Orakei")).toEqual({
      packageAddress: "11 Rukutai Street and 12 Godden Crescent, Orakei",
      childAddresses: [
        "11 Rukutai Street, Orakei",
        "12 Godden Crescent, Orakei",
      ],
    });
  });

  it("keeps more than four package children", () => {
    const parsed = extractCombinedListingAddressParts("1, 3, 5, 7, 9 and 11 Example Street, Orakei");
    expect(parsed?.childAddresses).toHaveLength(6);
    expect(parsed?.childAddresses.at(-1)).toBe("11 Example Street, Orakei");
  });

  it("ignores prompt text before an embedded package address", () => {
    expect(extractCombinedListingAddressParts("Analyse the package 15 Fisherton Street & 7 Stanmore Road, Grey Lynn")).toEqual({
      packageAddress: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn",
        "7 Stanmore Road, Grey Lynn",
      ],
    });
  });

  it("does not treat a lot-count phrase like '3 lot subdivision' as a second street number", () => {
    // Regression: "Create a feasibility for a 3 lot subdivision at 13 Campbell
    // place papakura" was mis-split into "3 Campbell Place" + "13 Campbell
    // Place" because both bare numbers sat before one street name. The "3"
    // here is not joined to "13" by a listing connector (&, and, +, /), so it
    // must not be read as a package.
    expect(
      looksLikeCombinedListingAddress("Create a feasibility for a 3 lot subdivision at 13 Campbell place papakura"),
    ).toBe(false);
    expect(
      extractCombinedListingAddressParts("Create a feasibility for a 3 lot subdivision at 13 Campbell place papakura"),
    ).toBeNull();
  });
});

describe("realestate-api address matching", () => {
  it("matches geocoder comma-formatted street numbers to listing addresses", () => {
    expect(
      addressesLikelyMatch(
        "1, Chesterfield Avenue, Saint Heliers, Orakei, Auckland, 1074",
        "1 Chesterfield Avenue, Saint Heliers, Auckland City, Auckland",
      ),
    ).toBe(true);
  });

  it("rejects a different street number on the same street", () => {
    expect(
      addressesLikelyMatch("8 Hampton Drive, St Heliers", "12 Hampton Drive, St Heliers"),
    ).toBe(false);
  });

  it("rejects letter-suffix neighbours in free text and URL slugs", () => {
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "https://homes.co.nz/address/auckland/st-heliers/8a-hampton-drive",
      ),
    ).toBe(false);
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "<h1>8A Hampton Drive, St Heliers</h1><p>5 bedrooms 2 bathrooms</p>",
      ),
    ).toBe(false);
  });

  it("accepts exact street lines in text and URL slugs", () => {
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "https://homes.co.nz/address/auckland/st-heliers/8-hampton-drive",
      ),
    ).toBe(true);
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "<h1>8 Hampton Dr, Saint Heliers</h1><p>3 bedrooms 1 bathroom</p>",
      ),
    ).toBe(true);
  });

  it("rejects the same number on a different street type", () => {
    expect(
      addressesLikelyMatch("8 Hampton Drive, St Heliers", "8 Hampton Street, St Heliers"),
    ).toBe(false);
  });

  it("accepts street-type abbreviation variants (Rd vs Road)", () => {
    expect(
      addressesLikelyMatch("8 Hampton Road, St Heliers", "8 Hampton Rd, St Heliers"),
    ).toBe(true);
  });

  it("accepts a unit/suffix variant via containment", () => {
    expect(
      addressesLikelyMatch("8 Hampton Drive", "8 Hampton Drive Flat 2"),
    ).toBe(true);
  });
});
