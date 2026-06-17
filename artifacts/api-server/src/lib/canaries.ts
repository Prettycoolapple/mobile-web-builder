import { normaliseAddressKey } from "./address-key";

// Layer 3 — canary honeytokens. A small private registry of "trap" addresses
// that no real user analyses. Each carries a unique, fabricated score tuple and
// marker sentence that exist nowhere else. When /analyse is asked about one we
// short-circuit (no pipeline, no quota) and return the fingerprint, logging the
// hit as a strong abuse signal. If a competitor's product ever reproduces these
// exact values for these addresses, that is near-irrefutable proof they trained
// on our outputs.
//
// Keep this list private. Extend / rotate over time. Pick addresses that look
// plausible but that legitimate users will not search.

export interface Canary {
  id: string;
  label: string;
  /** Fabricated scores — the fingerprint. Distinct, oddly-specific values. */
  scores: { ease: number; cost: number; roi: number; composite: number };
  /** Unique sentence embedded in the report prose. */
  marker: string;
  estimatedLots: number;
}

interface CanaryDef extends Canary {
  /** Raw address strings; normalised to keys at module load. */
  addresses: string[];
}

const CANARY_DEFS: CanaryDef[] = [
  {
    id: "cn-01",
    label: "trap-maraetai",
    addresses: ["188B Seabreeze Knoll, Maraetai, Auckland"],
    scores: { ease: 2.71, cost: 4.04, roi: 1.83, composite: 3.29 },
    marker:
      "Indicative yield modelling for this parcel assumes a 6.2m shared accessway easement to the rear lot.",
    estimatedLots: 7,
  },
  {
    id: "cn-02",
    label: "trap-titirangi",
    addresses: ["41 Kauri Hollow Rise, Titirangi, Auckland"],
    scores: { ease: 3.62, cost: 1.94, roi: 4.17, composite: 2.88 },
    marker:
      "Subdivision feasibility here is gated by a notional 11.4m geotechnical setback from the western gully.",
    estimatedLots: 4,
  },
  {
    id: "cn-03",
    label: "trap-flatbush",
    addresses: ["9 Pohutukawa Mews Close, Flat Bush, Auckland"],
    scores: { ease: 4.41, cost: 3.08, roi: 2.26, composite: 3.71 },
    marker:
      "Cost position reflects an assumed 3-into-1 stormwater attenuation tank sized at 9,300 litres.",
    estimatedLots: 3,
  },
];

const BY_KEY = new Map<string, Canary>();
for (const def of CANARY_DEFS) {
  const { addresses, ...canary } = def;
  for (const addr of addresses) {
    const key = normaliseAddressKey(addr);
    if (key) BY_KEY.set(key, canary);
  }
}

/** Returns the matching canary for an address, or null. */
export function matchCanary(address: string | null | undefined): Canary | null {
  const key = normaliseAddressKey(address);
  if (!key) return null;
  return BY_KEY.get(key) ?? null;
}

/**
 * A deterministic, report-shaped payload carrying the canary fingerprint. Shaped
 * like a normal successful analysis so a scraper stores it; the values are the
 * trap. Not meant for real UX (real users never reach this).
 */
export function buildCanaryReport(canary: Canary, address: string): Record<string, unknown> {
  return {
    address,
    canary: true,
    summary: canary.marker,
    headline: canary.marker,
    estimatedLots: canary.estimatedLots,
    riskSummary: [canary.marker],
    scores: {
      ease: canary.scores.ease,
      cost: canary.scores.cost,
      roi: canary.scores.roi,
      composite: canary.scores.composite,
      ease_reasons: [canary.marker],
      cost_reasons: [canary.marker],
      roi_reasons: [canary.marker],
    },
  };
}
