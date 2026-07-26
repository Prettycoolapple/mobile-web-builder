import type { PlanningProviderId } from "./regional-planning";

export type CostProfileId =
  | "auckland-default"
  | "hamilton-default"
  | "waipa-default"
  | "matamata-piako-default"
  | "manawatu-default"
  | "selwyn-default"
  | "christchurch-default"
  | "canterbury-default"
  | "nelson-default"
  | "whangarei-default"
  | "qldc-default"
  | "wairarapa-default"
  | "kapiti-default"
  | "wellington-default"
  | "dunedin-default"
  | "taupo-default"
  | "rotorua-default"
  | "whakatane-default"
  | "western-bay-default"
  | "tauranga-default"
  | "napier-default"
  | "southland-default"
  | "unsupported-default";

export type CostContourClass = "flat" | "subtle" | "gentle" | "moderate" | "steep" | "very_steep";

export interface RegionalCostProfile {
  id: CostProfileId;
  providerId: PlanningProviderId;
  label: string;
  source: "auckland_default_pending_regional_rates" | "regional_verified";
  demolition: {
    lowAsbestosLow: number;
    highAsbestosLow: number;
    lowAsbestosHigh: number;
    highAsbestosHigh: number;
    lowUnknownAsbestos: number;
    highUnknownAsbestos: number;
  };
  construction: {
    baseLowPerSqm: number;
    baseHighPerSqm: number;
    marketAnchorFactor: number;
    marketAnchorMin: number;
    marketAnchorMax: number;
    marketLowMultiplier: number;
    marketHighMultiplier: number;
    contourMultipliers: Partial<Record<CostContourClass, number>>;
  };
  retaining: {
    buckets: Partial<Record<CostContourClass, { low: number; high: number }>>;
    largeSite: {
      moderate: { lowRate: number; highRate: number; floorLow: number; floorHigh: number };
      steep: { lowRate: number; highRate: number; floorLow: number; floorHigh: number };
      verySteep: { lowRate: number; highRate: number; floorLow: number; floorHigh: number };
      ruralLifestyleMultiplier: number;
    };
  };
  consents: {
    lowRate: number;
    highRate: number;
  };
  finance: {
    annualRate: number;
    lowYears: number;
    highYears: number;
  };
  contingency: {
    lowRate: number;
    highRate: number;
  };
  /**
   * Development contributions charged per NET NEW dwelling: Watercare Infrastructure
   * Growth Charge (water + wastewater) + Auckland Council development contributions
   * (transport/reserves/community) + stormwater. Approximate, area-averaged, and
   * tunable — actual figures vary by funding area and by year.
   */
  contributions: {
    igcPerUnit: number;
    councilDcPerUnit: number;
    stormwaterPerUnit: number;
    /** High-side multiplier over the summed base to reflect area/schedule variation. */
    highMultiplier: number;
  };
  /**
   * Extra, BOUNDED allowance per net new connection inside the Veolia (Papakura)
   * franchise — covers Veolia growth/connection charges and connection-approval
   * overhead only. Deliberately excludes worst-case forced main extensions, which
   * are surfaced as a risk (unpredictable, project-specific) rather than modelled.
   */
  veolia: {
    perLotLow: number;
    perLotHigh: number;
    /** Ceiling on the total Veolia high allowance so large schemes don't blow up. */
    totalCapHigh: number;
  };
  /**
   * Annual council land rates model. NZ metro councils rate on Capital Value:
   * annual ≈ cv × rateInDollarPerCv + fixedAnnualCharges.
   */
  rates: {
    rateInDollarPerCv: number;
    fixedAnnualCharges: number;
  };
}

export type RegionalCostAssumptions = Omit<RegionalCostProfile, "id" | "providerId" | "label">;

const AUCKLAND_DEFAULT: RegionalCostAssumptions = {
  source: "auckland_default_pending_regional_rates",
  demolition: {
    lowAsbestosLow: 15_000,
    highAsbestosLow: 30_000,
    lowAsbestosHigh: 35_000,
    highAsbestosHigh: 80_000,
    lowUnknownAsbestos: 20_000,
    highUnknownAsbestos: 60_000,
  },
  construction: {
    baseLowPerSqm: 2_650,
    baseHighPerSqm: 3_450,
    marketAnchorFactor: 0.34,
    marketAnchorMin: 2_100,
    marketAnchorMax: 5_200,
    marketLowMultiplier: 0.9,
    marketHighMultiplier: 1.1,
    contourMultipliers: {
      moderate: 1.08,
      steep: 1.18,
      very_steep: 1.28,
    },
  },
  retaining: {
    buckets: {
      subtle: { low: 5_000, high: 25_000 },
      gentle: { low: 5_000, high: 25_000 },
      moderate: { low: 30_000, high: 100_000 },
      steep: { low: 100_000, high: 250_000 },
      very_steep: { low: 250_000, high: 600_000 },
    },
    largeSite: {
      moderate: { lowRate: 90, highRate: 240, floorLow: 120_000, floorHigh: 350_000 },
      steep: { lowRate: 180, highRate: 420, floorLow: 250_000, floorHigh: 750_000 },
      verySteep: { lowRate: 240, highRate: 520, floorLow: 350_000, floorHigh: 950_000 },
      ruralLifestyleMultiplier: 1.15,
    },
  },
  consents: {
    lowRate: 0.13,
    highRate: 0.16,
  },
  finance: {
    annualRate: 0.075,
    lowYears: 1.5,
    highYears: 2.5,
  },
  contingency: {
    lowRate: 0.08,
    highRate: 0.12,
  },
  contributions: {
    // Watercare IGC (water + wastewater), ~metro Auckland.
    igcPerUnit: 13_000,
    // Auckland Council development contributions (transport/reserves/community), area-averaged.
    councilDcPerUnit: 15_000,
    // Stormwater contribution, area-averaged (note: Papakura-area stormwater can run materially higher).
    stormwaterPerUnit: 8_000,
    highMultiplier: 1.3,
  },
  veolia: {
    perLotLow: 8_000,
    perLotHigh: 35_000,
    totalCapHigh: 300_000,
  },
  rates: {
    // Auckland residential rates in the dollar of CV (general + targeted), approximate.
    rateInDollarPerCv: 0.0028,
    // Fixed annual charges (waste management etc.).
    fixedAnnualCharges: 900,
  },
};

/**
 * Region-specific cost modules. Each region starts life as a copy of the
 * Auckland assumptions (an empty override object == "still using Auckland
 * numbers") and can be tuned independently later without touching any other
 * region. To make, say, Queenstown diverge from Auckland, set only the fields
 * that differ inside `qldc` below — the rest deep-merge from AUCKLAND_DEFAULT.
 * When a region's numbers have been verified against local rates, also set
 * `source: "regional_verified"` in its override so the report can stop
 * captioning them as Auckland-pending.
 *
 * NOTE: nested objects are merged key-by-key; arrays/records (e.g.
 * contourMultipliers, retaining.buckets) are shallow-replaced when provided.
 */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const REGIONAL_COST_OVERRIDES: Partial<Record<PlanningProviderId, DeepPartial<RegionalCostAssumptions>>> = {
  // ── Queenstown Lakes District ──────────────────────────────────────────────
  // Seeded from Auckland. Tune to QLDC construction/retaining/contribution rates
  // (alpine build premiums, QLDC development contributions, ORC land rates) here.
  hamilton: {},
  // Seeded from Auckland by request. This isolated module can be replaced with
  // Waipa-specific build, contribution and rates inputs without changing Auckland.
  waipa: {},
  // Seeded from Auckland by request. Keep Matamata-Piako-specific build,
  // contribution and rates inputs isolated here without changing Auckland.
  "matamata-piako": {},
  // Seeded from Auckland by request. Tune Manawatu construction,
  // contributions and rates here without changing the Auckland baseline.
  manawatu: {},
  // Seeded from Auckland by request. Tune Selwyn build, Selwyn Water
  // connection/development contributions and council-rate inputs here later.
  selwyn: {},
  qldc: {},
  // Seeded from Auckland by request. Tune Taupō District construction,
  // rural servicing, contributions and council-rate assumptions here later
  // without changing either Auckland or another regional profile.
  taupo: {},
  rotorua: {},
  whakatane: {},
  // Seeded from Auckland by request. Tune Western Bay construction,
  // contributions and rates here without changing the Auckland baseline.
  "western-bay": {},
  // Seeded from Auckland by request. Tune Tauranga build, development
  // contributions and council-rate assumptions here without changing Auckland.
  tauranga: {},
  // Seeded from Auckland by request. Tune Napier construction, development
  // contributions and council-rate assumptions here without changing Auckland.
  napier: {},
  // Seeded from Auckland by request. Keep Southland-specific changes isolated here.
  southland: {},
  // Seeded from Auckland by request. Tune Wairarapa build, contribution, and
  // council-rate assumptions here without changing the Auckland baseline.
  wairarapa: {},
  // Seeded from Auckland by request. Tune Kāpiti construction, development
  // contributions and council-rate assumptions independently here.
  kapiti: {},
  // ── Wellington region (Wellington City, Lower/Upper Hutt, Porirua, Kāpiti) ──
  // Seeded from Auckland. Tune to Wellington Water / council DC + GWRC/TA land
  // rates and Wellington build costs here.
  wellington: {},
};

const PROVIDER_PROFILE_META: Record<PlanningProviderId, { id: CostProfileId; label: string }> = {
  "auckland-legacy": { id: "auckland-default", label: "Auckland default cost profile" },
  hamilton: { id: "hamilton-default", label: "Hamilton default cost profile" },
  waipa: { id: "waipa-default", label: "Waipā default cost profile (Auckland assumptions)" },
  "matamata-piako": { id: "matamata-piako-default", label: "Matamata-Piako default cost profile (Auckland assumptions)" },
  manawatu: { id: "manawatu-default", label: "Manawatu default cost profile (Auckland assumptions)" },
  selwyn: { id: "selwyn-default", label: "Selwyn District default cost profile (Auckland assumptions)" },
  christchurch: { id: "christchurch-default", label: "Christchurch default cost profile" },
  canterbury: { id: "canterbury-default", label: "Canterbury default cost profile" },
  nelson: { id: "nelson-default", label: "Nelson default cost profile" },
  whangarei: { id: "whangarei-default", label: "Whangarei default cost profile" },
  qldc: { id: "qldc-default", label: "Queenstown Lakes default cost profile" },
  wairarapa: { id: "wairarapa-default", label: "Wairarapa default cost profile (Auckland assumptions)" },
  kapiti: { id: "kapiti-default", label: "Kāpiti Coast default cost profile (Auckland assumptions)" },
  wellington: { id: "wellington-default", label: "Wellington region default cost profile" },
  dunedin: { id: "dunedin-default", label: "Dunedin default cost profile" },
  taupo: { id: "taupo-default", label: "Taupō District default cost profile (Auckland assumptions)" },
  rotorua: { id: "rotorua-default", label: "Rotorua default cost profile" },
  whakatane: { id: "whakatane-default", label: "Whakatane default cost profile" },
  "western-bay": { id: "western-bay-default", label: "Western Bay of Plenty default cost profile (Auckland assumptions)" },
  tauranga: { id: "tauranga-default", label: "Tauranga City default cost profile (Auckland assumptions)" },
  napier: { id: "napier-default", label: "Napier City default cost profile (Auckland assumptions)" },
  southland: { id: "southland-default", label: "Southland District default cost profile (Auckland assumptions)" },
  unsupported: { id: "unsupported-default", label: "Unsupported-region default cost profile" },
};

function cloneDefaultAssumptions(): Omit<RegionalCostProfile, "id" | "providerId" | "label"> {
  return {
    source: AUCKLAND_DEFAULT.source,
    demolition: { ...AUCKLAND_DEFAULT.demolition },
    construction: {
      ...AUCKLAND_DEFAULT.construction,
      contourMultipliers: { ...AUCKLAND_DEFAULT.construction.contourMultipliers },
    },
    retaining: {
      buckets: Object.fromEntries(
        Object.entries(AUCKLAND_DEFAULT.retaining.buckets).map(([key, value]) => [
          key,
          value ? { ...value } : value,
        ]),
      ) as RegionalCostProfile["retaining"]["buckets"],
      largeSite: {
        moderate: { ...AUCKLAND_DEFAULT.retaining.largeSite.moderate },
        steep: { ...AUCKLAND_DEFAULT.retaining.largeSite.steep },
        verySteep: { ...AUCKLAND_DEFAULT.retaining.largeSite.verySteep },
        ruralLifestyleMultiplier: AUCKLAND_DEFAULT.retaining.largeSite.ruralLifestyleMultiplier,
      },
    },
    consents: { ...AUCKLAND_DEFAULT.consents },
    finance: { ...AUCKLAND_DEFAULT.finance },
    contingency: { ...AUCKLAND_DEFAULT.contingency },
    contributions: { ...AUCKLAND_DEFAULT.contributions },
    veolia: { ...AUCKLAND_DEFAULT.veolia },
    rates: { ...AUCKLAND_DEFAULT.rates },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges a region's override onto a fresh Auckland clone. Only keys present
 * in the override are touched, so an empty override yields the Auckland numbers
 * verbatim. Nested plain objects recurse; everything else (numbers, arrays) is
 * replaced by the override value.
 */
function applyOverride(base: Record<string, unknown>, override: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = base[key];
    if (isPlainObject(value) && isPlainObject(current)) {
      applyOverride(current, value);
    } else {
      base[key] = value;
    }
  }
}

function assumptionsForProvider(id: PlanningProviderId): RegionalCostAssumptions {
  const assumptions = cloneDefaultAssumptions();
  const override = REGIONAL_COST_OVERRIDES[id];
  if (override) applyOverride(assumptions as unknown as Record<string, unknown>, override as Record<string, unknown>);
  return assumptions;
}

export function defaultRegionalCostProfile(): RegionalCostProfile {
  return {
    ...cloneDefaultAssumptions(),
    id: "auckland-default",
    providerId: "auckland-legacy",
    label: "Auckland default cost profile",
  };
}

export function regionalCostProfileForProvider(providerId: PlanningProviderId | null | undefined): RegionalCostProfile {
  const id = providerId ?? "auckland-legacy";
  const meta = PROVIDER_PROFILE_META[id];
  return {
    ...assumptionsForProvider(id),
    id: meta.id,
    providerId: id,
    label: meta.label,
  };
}
