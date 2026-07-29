import { describe, expect, it } from "vitest";
import { estimateCosts } from "../cost-estimator";
import { regionalCostProfileForProvider } from "../regional-cost-profiles";
import type { MergedPropertyData } from "../scrapers/merge";

function minimal(overrides: Partial<MergedPropertyData> = {}): MergedPropertyData {
  return {
    cv_nzd: 1_000_000,
    cv_year: 2024,
    land_area_sqm: 500,
    floor_area_sqm: null,
    build_year: null,
    build_year_range: null,
    bedrooms: null,
    bathrooms: null,
    zone_code: "SHZ",
    zone_description: null,
    min_lot_size_sqm: 600,
    overlays: [],
    school_zones: { primary: null, intermediate: null, secondary: null },
    last_sale_price: null,
    last_sale_date: null,
    listing_active: false,
    listing_price: null,
    main_photo_url: null,
    photo_urls: [],
    overlay_map_image_base64: null,
    comparables: [],
    data_sources: {},
    discrepancies: [],
    contour: "flat",
    contour_slope_degrees: null,
    contour_source: null,
    contour_text: null,
    asbestos_risk: "unknown",
    infrastructure: [],
    missing_critical_fields: [],
    estate_type: null,
    ...overrides,
  };
}

describe("estimateCosts — contributions, land rate & Veolia", () => {
  it("adds development contributions on net new dwellings (app-wide)", () => {
    // Vacant site (no existing dwelling) → all modelled units are new.
    const c = estimateCosts(minimal({ floor_area_sqm: null, bedrooms: null }), 3);
    expect(c.contributions_units).toBe(3);
    // base per unit = 13k IGC + 15k council DC + 8k stormwater = 36k.
    expect(c.contributions_low).toBe(108_000);
    expect(c.contributions_high).toBeGreaterThan(c.contributions_low);
  });

  it("charges contributions only on ADDITIONAL units when a dwelling exists", () => {
    const c = estimateCosts(minimal({ floor_area_sqm: 140, bedrooms: 3 }), 3);
    // 3 modelled − 1 existing connection credit = 2 net new.
    expect(c.contributions_units).toBe(2);
    expect(c.contributions_low).toBe(72_000);
  });

  it("estimates annual land rates from CV and carries them over the holding horizon", () => {
    const c = estimateCosts(minimal({ cv_nzd: 1_000_000 }), 1);
    // 1,000,000 × 0.0028 + 900 = 3,700 → rounded 4,000/yr.
    expect(c.land_rate_annual).toBe(4_000);
    expect(c.land_rate_low).toBeGreaterThan(0);
    expect(c.land_rate_high).toBeGreaterThan(c.land_rate_low);
  });

  it("zeroes land rate when CV is unavailable", () => {
    const c = estimateCosts(minimal({ cv_nzd: null }), 1);
    expect(c.land_rate_annual).toBe(0);
    expect(c.land_rate_low).toBe(0);
  });

  it("adds a bounded Veolia allowance only inside the Papakura franchise", () => {
    const out = estimateCosts(minimal({ floor_area_sqm: null, bedrooms: null }), 3);
    expect(out.veolia_in_zone).toBe(false);
    expect(out.veolia_low).toBe(0);
    expect(out.veolia_high).toBe(0);

    const inZone = estimateCosts(
      minimal({
        floor_area_sqm: null,
        bedrooms: null,
        veolia_service_zone: { inServiceZone: true, network: "papakura", source: "static_boundary_v1" },
      }),
      3,
    );
    expect(inZone.veolia_in_zone).toBe(true);
    expect(inZone.veolia_low).toBe(24_000); // 8k × 3 new units
    expect(inZone.veolia_high).toBe(105_000); // 35k × 3, under the cap
    // Veolia allowance flows into the totals.
    expect(inZone.total_low).toBeGreaterThan(out.total_low);
  });
});

describe("estimateCosts — existing dwelling / demolition", () => {
  it("infers a dwelling when floor area exists but build year is unknown (non-vacant demolition budget)", () => {
    const c = estimateCosts(minimal({ floor_area_sqm: 140, build_year: null }), 1);
    expect(c.demo_vacant).toBe(false);
    expect(c.has_existing_dwelling).toBe(true);
    expect(c.demo_low).toBeGreaterThan(0);
  });

  it("infers a dwelling from bedrooms alone", () => {
    const c = estimateCosts(minimal({ build_year: null, floor_area_sqm: null, bedrooms: 3 }), 1);
    expect(c.demo_vacant).toBe(false);
    expect(c.demo_low).toBeGreaterThan(0);
  });

  it("treats as vacant only when there are no structure signals (demo $0)", () => {
    const c = estimateCosts(
      minimal({
        build_year: null,
        floor_area_sqm: null,
        bedrooms: null,
        bathrooms: null,
        last_sale_price: null,
        listing_price: null,
      }),
      1,
    );
    expect(c.demo_vacant).toBe(true);
    expect(c.demo_low).toBe(0);
  });

  it("does not infer a dwelling from section listing price alone", () => {
    const c = estimateCosts(
      minimal({
        property_type: "Residential Section",
        listing_title: "36 Marine Parade, Mellons Bay section",
        listing_url: "https://www.realestate.co.nz/residential/sale/auckland/manukau-city/mellons-bay/section",
        listing_active: true,
        listing_price: 1_500_000,
        last_sale_price: 1_200_000,
        build_year: null,
        floor_area_sqm: null,
        bedrooms: null,
        bathrooms: null,
      }),
      1,
    );

    expect(c.demo_vacant).toBe(true);
    expect(c.has_existing_dwelling).toBe(false);
    expect(c.demo_low).toBe(0);
    expect(c.demo_high).toBe(0);
  });

  it("scales construction and consent costs by the final dwelling count", () => {
    const property = minimal({
      cv_nzd: 1_770_000,
      land_area_sqm: 825,
      floor_area_sqm: 220,
      zone_code: "MHS",
      min_lot_size_sqm: 400,
      contour: "flat",
    });

    const oneDwelling = estimateCosts(property, 1, { sqm_per_lot: 412 });
    const twoDwellings = estimateCosts(property, 2, { sqm_per_lot: 412 });

    expect(oneDwelling.construction_low).toBe(541_000);
    expect(oneDwelling.construction_high).toBe(704_000);
    expect(twoDwellings.units).toBe(2);
    expect(twoDwellings.construction_low).toBe(1_081_000);
    expect(twoDwellings.construction_high).toBe(oneDwelling.construction_high * 2);
    expect(twoDwellings.consents_low).toBe(141_000);
    expect(twoDwellings.consents_high).toBe(225_000);
    expect(twoDwellings.total_low).toBeGreaterThan(oneDwelling.total_low);
  });

  it("uses the perception-based moderate retaining bucket for small urban sites", () => {
    const c = estimateCosts(minimal({ contour: "moderate", land_area_sqm: 600, zone_code: "MHS" }), 1);
    expect(c.retaining_low).toBe(30_000);
    expect(c.retaining_high).toBe(100_000);
    expect(c.large_site_terrain_adjusted).toBe(false);
  });

  it("uses a higher development-envelope allowance for large CLZ sites with steep pockets", () => {
    const c = estimateCosts(
      minimal({
        contour: "moderate",
        land_area_sqm: 32_113,
        zone_code: "CLZ",
        min_lot_size_sqm: 10_000,
        contour_steep_area_ratio: 0.12,
        contour_moderate_area_ratio: 0.28,
        contour_local_slope_p90_degrees: 23,
        contour_local_slope_p95_degrees: 31,
        contour_sample_count: 420,
      }),
      1,
    );

    expect(c.retaining_low).toBeGreaterThan(200_000);
    expect(c.retaining_high).toBeGreaterThan(400_000);
    expect(c.retaining_area_sqm_estimate).toBeGreaterThanOrEqual(900);
    expect(c.large_site_terrain_adjusted).toBe(true);
  });

  it("does not overstate mostly subtle large rural sites", () => {
    const c = estimateCosts(
      minimal({
        contour: "subtle",
        land_area_sqm: 28_000,
        zone_code: "CLZ",
        contour_steep_area_ratio: 0,
        contour_moderate_area_ratio: 0.04,
        contour_local_slope_p90_degrees: 5.8,
        contour_local_slope_p95_degrees: 9,
        contour_sample_count: 360,
      }),
      1,
    );

    expect(c.retaining_low).toBe(5_000);
    expect(c.retaining_high).toBe(25_000);
    expect(c.large_site_terrain_adjusted).toBe(false);
  });

  it("keeps missing contour as unknown without fabricating retaining costs", () => {
    const c = estimateCosts(
      minimal({
        contour: null,
        land_area_sqm: 32_113,
        zone_code: "CLZ",
        contour_steep_area_ratio: 0.2,
        contour_moderate_area_ratio: 0.3,
        contour_sample_count: 420,
      }),
      1,
    );

    expect(c.retaining_unknown).toBe(true);
    expect(c.retaining_low).toBe(0);
    expect(c.retaining_high).toBe(0);
  });

  it("adds TDR/TTR allowance for additional CLZ titles only", () => {
    const oneLot = estimateCosts(minimal({ zone_code: "CLZ", land_area_sqm: 10_000, contour: "flat" }), 1);
    const twoLots = estimateCosts(minimal({ zone_code: "CLZ", land_area_sqm: 20_000, contour: "flat" }), 2);

    expect(oneLot.tdr_ttr_required).toBe(false);
    expect(oneLot.tdr_ttr_low).toBe(0);
    expect(twoLots.tdr_ttr_required).toBe(true);
    expect(twoLots.tdr_ttr_low).toBe(160_000);
    expect(twoLots.tdr_ttr_high).toBe(250_000);
    expect(twoLots.tdr_ttr_note).toContain("TDR/TTR");
    expect(twoLots.total_low).toBeGreaterThan(oneLot.total_low);
  });

  it("does not add TDR/TTR allowance for urban multi-lot zones", () => {
    const c = estimateCosts(minimal({ zone_code: "MHU", land_area_sqm: 600, contour: "flat" }), 3);

    expect(c.tdr_ttr_required).toBe(false);
    expect(c.tdr_ttr_low).toBe(0);
    expect(c.tdr_ttr_high).toBe(0);
  });

  it("applies the package saving to construction only", () => {
    const property = minimal({ cv_nzd: 400_000, contour: "flat", floor_area_sqm: null });
    const standard = estimateCosts(property, 1, { sqm_per_lot: 171 });
    const packaged = estimateCosts(property, 1, {
      sqm_per_lot: 171,
      construction_cost_multiplier: 0.93,
      construction_discount_reason: "7% coordinated package delivery saving.",
    });

    expect(packaged.construction_low).toBeCloseTo(standard.construction_low * 0.93, -3);
    expect(packaged.construction_high).toBeCloseTo(standard.construction_high * 0.93, -3);
    expect(packaged.land_cv_nzd).toBe(standard.land_cv_nzd);
    expect(packaged.contributions_low).toBe(standard.contributions_low);
    expect(packaged.construction_cost_multiplier).toBe(0.93);
    expect(packaged.construction_discount_reason).toContain("7%");
    expect(packaged.total_low).toBeLessThan(standard.total_low);
  });

  it("supports provider-specific cost profiles while defaulting to Auckland-equivalent values", () => {
    const property = minimal({
      cv_nzd: 1_000_000,
      contour: "flat",
      floor_area_sqm: 120,
    });
    const aucklandDefault = estimateCosts(property, 1);
    const hamiltonDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("hamilton"),
    });
    const whangareiDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("whangarei"),
    });
    const nelsonDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("nelson"),
    });
    const rotoruaDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("rotorua"),
    });
    const whakataneDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("whakatane"),
    });
    const southlandDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("southland"),
    });
    const westernBayDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("western-bay"),
    });
    const wairarapaDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("wairarapa"),
    });
    const matamataPiakoDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("matamata-piako"),
    });
    const manawatuDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("manawatu"),
    });
    const selwynDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("selwyn"),
    });
    const thamesCoromandelDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("thames-coromandel"),
    });
    const bullerDefault = estimateCosts(property, 1, {
      cost_profile: regionalCostProfileForProvider("buller"),
    });
    const customProfile = regionalCostProfileForProvider("whangarei");
    customProfile.construction.baseLowPerSqm = 3_000;
    customProfile.construction.baseHighPerSqm = 4_000;
    const whangareiCustom = estimateCosts(property, 1, { cost_profile: customProfile });

    expect(hamiltonDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(hamiltonDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(whangareiDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(whangareiDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(nelsonDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(nelsonDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(rotoruaDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(whakataneDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(southlandDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(westernBayDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(wairarapaDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(wairarapaDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(matamataPiakoDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(matamataPiakoDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(manawatuDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(manawatuDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(manawatuDefault.cost_profile_id).toBe("manawatu-default");
    expect(selwynDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(selwynDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(selwynDefault.cost_profile_id).toBe("selwyn-default");
    expect(thamesCoromandelDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(thamesCoromandelDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(thamesCoromandelDefault.cost_profile_id).toBe("thames-coromandel-default");
    expect(bullerDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(bullerDefault.construction_high).toBe(aucklandDefault.construction_high);
    expect(bullerDefault.cost_profile_id).toBe("buller-default");
    expect(whangareiCustom.construction_low).toBeGreaterThan(whangareiDefault.construction_low);
    expect(regionalCostProfileForProvider("hamilton")).toMatchObject({ id: "hamilton-default", providerId: "hamilton" });
    expect(regionalCostProfileForProvider("waipa")).toMatchObject({
      id: "waipa-default",
      providerId: "waipa",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("whangarei")).toMatchObject({ id: "whangarei-default", providerId: "whangarei" });
    expect(regionalCostProfileForProvider("nelson")).toMatchObject({ id: "nelson-default", providerId: "nelson" });
    expect(regionalCostProfileForProvider("rotorua")).toMatchObject({ id: "rotorua-default", providerId: "rotorua" });
    expect(regionalCostProfileForProvider("taupo")).toMatchObject({
      id: "taupo-default",
      providerId: "taupo",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("whakatane")).toMatchObject({ id: "whakatane-default", providerId: "whakatane" });
    expect(regionalCostProfileForProvider("western-bay")).toMatchObject({
      id: "western-bay-default",
      providerId: "western-bay",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("tauranga")).toMatchObject({
      id: "tauranga-default",
      providerId: "tauranga",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("napier")).toMatchObject({
      id: "napier-default",
      providerId: "napier",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("hastings")).toMatchObject({
      id: "hastings-default",
      providerId: "hastings",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("southland")).toMatchObject({
      id: "southland-default",
      providerId: "southland",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("wairarapa")).toMatchObject({
      id: "wairarapa-default",
      providerId: "wairarapa",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("matamata-piako")).toMatchObject({
      id: "matamata-piako-default",
      providerId: "matamata-piako",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("kapiti")).toMatchObject({
      id: "kapiti-default",
      providerId: "kapiti",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("manawatu")).toMatchObject({
      id: "manawatu-default",
      providerId: "manawatu",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("selwyn")).toMatchObject({
      id: "selwyn-default",
      providerId: "selwyn",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("thames-coromandel")).toMatchObject({
      id: "thames-coromandel-default",
      providerId: "thames-coromandel",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("buller")).toMatchObject({
      id: "buller-default",
      providerId: "buller",
      source: "auckland_default_pending_regional_rates",
    });
    expect(regionalCostProfileForProvider("unsupported").id).toBe("unsupported-default");

    // Queenstown + Wellington ship their own editable cost modules that start
    // life seeded from the Auckland numbers (empty override == Auckland-equal).
    const qldcDefault = estimateCosts(property, 1, { cost_profile: regionalCostProfileForProvider("qldc") });
    const wellingtonDefault = estimateCosts(property, 1, { cost_profile: regionalCostProfileForProvider("wellington") });
    expect(qldcDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(wellingtonDefault.construction_low).toBe(aucklandDefault.construction_low);
    expect(regionalCostProfileForProvider("qldc")).toMatchObject({ id: "qldc-default", providerId: "qldc" });
    expect(regionalCostProfileForProvider("wellington")).toMatchObject({ id: "wellington-default", providerId: "wellington" });

    // Each region's profile is an independent copy — tuning one must not leak
    // into another or into the Auckland baseline.
    const qldcMutable = regionalCostProfileForProvider("qldc");
    qldcMutable.construction.baseLowPerSqm = 9_999;
    expect(regionalCostProfileForProvider("qldc").construction.baseLowPerSqm).not.toBe(9_999);
    expect(regionalCostProfileForProvider("wellington").construction.baseLowPerSqm).toBe(
      regionalCostProfileForProvider("auckland-legacy").construction.baseLowPerSqm,
    );
  });
});
