import { fetchLINZParcelsNear, fetchLINZTitle, type LinzParcel, type LinzParcelNearby, type LinzTitle } from "./linz";
import { logger } from "./logger";

export type SignalConfidence = "high" | "medium" | "low" | "unknown";
export type SignalLevel = "none" | "low" | "moderate" | "high" | "unknown";

export interface NeighbourhoodSignal {
  level: SignalLevel;
  count: number;
  assessedLots: number;
  confidence: SignalConfidence;
}

export interface NeighbourhoodMarketAdjustment {
  gdvMultiplier: number;
  applied: boolean;
  reason: string | null;
}

export interface NeighbourhoodContext {
  assessedLots: number;
  radiusM: number;
  publicHousingSignal: NeighbourhoodSignal;
  /** @deprecated Retained so older saved reports and generated clients remain tolerant. */
  terraceHousingSignal: NeighbourhoodSignal;
  confidence: SignalConfidence;
  marketAdjustment: NeighbourhoodMarketAdjustment;
  reasons: string[];
}

interface NeighbourParcelAssessment {
  parcel: LinzParcelNearby;
  title: LinzTitle | null;
  titleLookupSucceeded: boolean;
  publicHousing: boolean;
  /** @deprecated Surrounding typology is no longer used for ROI or active report UI. */
  terraceHousing: boolean;
}

export const PUBLIC_HOUSING_SCAN_RADIUS_M = 500;
const PUBLIC_HOUSING_SCAN_COUNT = 300;

const DEFAULT_CONTEXT: NeighbourhoodContext = {
  assessedLots: 0,
  radiusM: 0,
  publicHousingSignal: { level: "unknown", count: 0, assessedLots: 0, confidence: "unknown" },
  terraceHousingSignal: { level: "unknown", count: 0, assessedLots: 0, confidence: "unknown" },
  confidence: "unknown",
  marketAdjustment: { gdvMultiplier: 1, applied: false, reason: null },
  reasons: ["Neighbourhood market context was unavailable for this address."],
};

function stripMacrons(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normaliseOwnerName(owner: string): string {
  return stripMacrons(owner)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPublicHousingOwner(owner: string): boolean {
  const n = normaliseOwnerName(owner);
  if (!n) return false;
  if (/\bKAINGA ORA\b/.test(n)) return true;
  if (/\bHOUSING NEW ZEALAND\b/.test(n)) return true;
  if (/\bHOUSING CORPORATION\b/.test(n)) return true;
  if (/\bNEW ZEALAND HOUSING\b/.test(n)) return true;
  return false;
}

function isRoadOrAccessParcel(parcel: LinzParcel): boolean {
  const text = [
    parcel.appellation,
    parcel.legal_description,
    parcel.topology_type,
  ].filter(Boolean).join(" ").toLowerCase();
  if (!text) return false;
  return /\b(road|legal road|motorway|railway|access way|right of way|reserve|esplanade|stream|river|drainage)\b/.test(text);
}

export function selectNearestResidentialParcels(
  parcels: LinzParcelNearby[],
  subjectParcelId?: string | null,
  maxLots = Number.POSITIVE_INFINITY,
  radiusM?: number,
): LinzParcelNearby[] {
  const subject = (subjectParcelId ?? "").trim();
  const seen = new Set<string>();
  const selected = parcels
    .filter((parcel) => {
      if (subject && parcel.parcel_id === subject) return false;
      if (seen.has(parcel.parcel_id)) return false;
      seen.add(parcel.parcel_id);
      if (radiusM != null && (parcel.distance_m == null || parcel.distance_m > radiusM)) return false;
      if (isRoadOrAccessParcel(parcel)) return false;
      if (parcel.area_sqm != null && parcel.area_sqm < 35) return false;
      return true;
    })
    .sort((a, b) => (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER));
  return Number.isFinite(maxLots) ? selected.slice(0, maxLots) : selected;
}

export function selectResidentialParcelsWithinRadius(
  parcels: LinzParcelNearby[],
  subjectParcelId?: string | null,
  radiusM = 100,
): LinzParcelNearby[] {
  return selectNearestResidentialParcels(parcels, subjectParcelId, Number.POSITIVE_INFINITY, radiusM);
}

export function isTerraceLikeParcel(parcel: LinzParcel, title: LinzTitle | null): boolean {
  const text = [
    parcel.appellation,
    parcel.legal_description,
    parcel.topology_type,
    title?.estate_type,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\b(terrace|townhouse|attached dwelling|unit title|stratum|unit|flat)\b/.test(text)) return true;
  if (title?.estate_type && /\b(unit|stratum)\b/i.test(title.estate_type)) return true;
  if (parcel.area_sqm != null && parcel.area_sqm > 45 && parcel.area_sqm <= 220) return true;
  return false;
}

function signalLevel(count: number, assessed: number): SignalLevel {
  if (assessed <= 0) return "unknown";
  if (count <= 0) return "none";
  if (count >= 4 || count / assessed >= 0.5) return "high";
  if (count >= 2) return "moderate";
  return "low";
}

function confidenceForPublicHousing(assessed: number, ownerLookups: number): SignalConfidence {
  if (assessed <= 0 || ownerLookups <= 0) return "unknown";
  const ratio = ownerLookups / assessed;
  if (ownerLookups >= 3 && ratio >= 0.75) return "high";
  if (ownerLookups >= 2 && ratio >= 0.45) return "medium";
  if (ownerLookups > 0) return "low";
  return "unknown";
}

export function marketAdjustmentFromSignals(publicSignal: NeighbourhoodSignal): NeighbourhoodMarketAdjustment {
  if (publicSignal.confidence !== "high" && publicSignal.confidence !== "medium") {
    return { gdvMultiplier: 1, applied: false, reason: null };
  }

  const count = publicSignal.count;
  const share = publicSignal.assessedLots > 0 ? count / publicSignal.assessedLots : 0;
  let multiplier = 1;
  if (count >= 4 || share >= 0.5) multiplier = 0.93;
  else if (count >= 2) multiplier = 0.97;
  multiplier = Math.max(0.9, multiplier);

  if (multiplier >= 1) return { gdvMultiplier: 1, applied: false, reason: null };
  const pct = Math.round((1 - multiplier) * 100);
  return {
    gdvMultiplier: multiplier,
    applied: true,
    reason: `Local public-housing concentration detected with ${publicSignal.confidence} confidence; GDV adjusted by ${pct}% to reflect buyer-perception risk.`,
  };
}

function combineConfidence(publicSignal: NeighbourhoodSignal): SignalConfidence {
  if (publicSignal.confidence === "high") return "high";
  if (publicSignal.confidence === "medium") return "medium";
  if (publicSignal.confidence === "low") return "low";
  return "unknown";
}

function buildContext(assessments: NeighbourParcelAssessment[], radiusM: number): NeighbourhoodContext {
  const assessedLots = assessments.length;
  const ownerLookups = assessments.filter((a) => a.titleLookupSucceeded).length;
  const publicCount = assessments.filter((a) => a.publicHousing).length;

  const publicHousingSignal: NeighbourhoodSignal = {
    level: signalLevel(publicCount, ownerLookups),
    count: publicCount,
    assessedLots: ownerLookups,
    confidence: confidenceForPublicHousing(assessedLots, ownerLookups),
  };
  const terraceHousingSignal: NeighbourhoodSignal = {
    level: "unknown",
    count: 0,
    assessedLots: 0,
    confidence: "unknown",
  };
  const marketAdjustment = marketAdjustmentFromSignals(publicHousingSignal);
  const reasons: string[] = [];

  if (assessedLots <= 0) {
    reasons.push(`No nearby residential parcels could be assessed within ${radiusM} m.`);
  } else if (ownerLookups <= 0) {
    reasons.push(`LINZ title-owner data was unavailable for residential parcels within ${radiusM} m, so no public-housing conclusion was made.`);
  } else {
    reasons.push(`LINZ title-owner data was checked for ${ownerLookups} of ${assessedLots} residential parcels within ${radiusM} m.`);
    if (publicCount > 0) {
      reasons.push(`${publicCount} nearby lot${publicCount === 1 ? "" : "s"} showed a confirmed public-housing ownership signal.`);
    }
    if (ownerLookups < assessedLots) {
      reasons.push(`${assessedLots - ownerLookups} nearby residential parcel${assessedLots - ownerLookups === 1 ? "" : "s"} could not be checked against title-owner records.`);
    }
    if (marketAdjustment.reason) reasons.push(marketAdjustment.reason);
  }

  return {
    assessedLots,
    radiusM,
    publicHousingSignal,
    terraceHousingSignal,
    confidence: combineConfidence(publicHousingSignal),
    marketAdjustment,
    reasons,
  };
}

async function assessParcels(parcels: LinzParcelNearby[]): Promise<NeighbourParcelAssessment[]> {
  const out: NeighbourParcelAssessment[] = [];
  for (const parcel of parcels) {
    let title: LinzTitle | null = null;
    if (parcel.title_no) {
      try {
        title = await fetchLINZTitle(parcel.title_no);
      } catch (err) {
        logger.debug({ title_no: parcel.title_no, err: (err as Error).message }, "Neighbourhood context: title lookup failed");
      }
    }
    const owners = title?.owners ?? [];
    out.push({
      parcel,
      title,
      titleLookupSucceeded: title !== null,
      publicHousing: owners.some(isPublicHousingOwner),
      terraceHousing: false,
    });
  }
  return out;
}

export async function fetchNeighbourhoodContext(opts: {
  lat: number;
  lng: number;
  subjectParcelId?: string | null;
}): Promise<NeighbourhoodContext> {
  const radiusM = PUBLIC_HOUSING_SCAN_RADIUS_M;
  const parcels = await fetchLINZParcelsNear(opts.lat, opts.lng, radiusM, PUBLIC_HOUSING_SCAN_COUNT);
  if (parcels === null) return DEFAULT_CONTEXT;
  const selected = selectResidentialParcelsWithinRadius(parcels, opts.subjectParcelId, radiusM);
  const assessments = await assessParcels(selected);
  return buildContext(assessments, radiusM);
}
