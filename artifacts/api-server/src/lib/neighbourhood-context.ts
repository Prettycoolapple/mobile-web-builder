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
  terraceHousingSignal: NeighbourhoodSignal;
  confidence: SignalConfidence;
  marketAdjustment: NeighbourhoodMarketAdjustment;
  reasons: string[];
}

interface NeighbourParcelAssessment {
  parcel: LinzParcelNearby;
  title: LinzTitle | null;
  ownerLookupAttempted: boolean;
  publicHousing: boolean;
  terraceHousing: boolean;
}

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

export function selectNearestResidentialParcels(parcels: LinzParcelNearby[], subjectParcelId?: string | null, maxLots = 7): LinzParcelNearby[] {
  const subject = (subjectParcelId ?? "").trim();
  const seen = new Set<string>();
  return parcels
    .filter((parcel) => {
      if (subject && parcel.parcel_id === subject) return false;
      if (seen.has(parcel.parcel_id)) return false;
      seen.add(parcel.parcel_id);
      if (isRoadOrAccessParcel(parcel)) return false;
      if (parcel.area_sqm != null && parcel.area_sqm < 35) return false;
      return true;
    })
    .sort((a, b) => (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER))
    .slice(0, maxLots);
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
  if (assessed < 3) return "unknown";
  const ratio = ownerLookups / assessed;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.45) return "medium";
  if (ownerLookups > 0) return "low";
  return "unknown";
}

function confidenceForTerrace(assessed: number): SignalConfidence {
  if (assessed >= 5) return "medium";
  if (assessed >= 3) return "low";
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

function combineConfidence(publicSignal: NeighbourhoodSignal, terraceSignal: NeighbourhoodSignal): SignalConfidence {
  if (publicSignal.confidence === "high") return "high";
  if (publicSignal.confidence === "medium" || terraceSignal.confidence === "medium") return "medium";
  if (publicSignal.confidence === "low" || terraceSignal.confidence === "low") return "low";
  return "unknown";
}

function buildContext(assessments: NeighbourParcelAssessment[], radiusM: number): NeighbourhoodContext {
  const assessedLots = assessments.length;
  const ownerLookups = assessments.filter((a) => a.ownerLookupAttempted).length;
  const publicCount = assessments.filter((a) => a.publicHousing).length;
  const terraceCount = assessments.filter((a) => a.terraceHousing).length;

  const publicHousingSignal: NeighbourhoodSignal = {
    level: signalLevel(publicCount, assessedLots),
    count: publicCount,
    assessedLots,
    confidence: confidenceForPublicHousing(assessedLots, ownerLookups),
  };
  const terraceHousingSignal: NeighbourhoodSignal = {
    level: signalLevel(terraceCount, assessedLots),
    count: terraceCount,
    assessedLots,
    confidence: confidenceForTerrace(assessedLots),
  };
  const marketAdjustment = marketAdjustmentFromSignals(publicHousingSignal);
  const reasons: string[] = [];

  if (assessedLots < 3) {
    reasons.push("Fewer than three nearby residential lots could be assessed, so no neighbourhood market adjustment was applied.");
  } else {
    reasons.push(`${assessedLots} nearby residential lots were assessed for aggregate market context.`);
    if (publicCount > 0) {
      reasons.push(`${publicCount} nearby lot${publicCount === 1 ? "" : "s"} showed a confirmed public-housing ownership signal.`);
    }
    if (terraceCount > 0) {
      reasons.push(`${terraceCount} nearby lot${terraceCount === 1 ? "" : "s"} showed terrace, townhouse, unit-title, or small-lot attached-housing signals.`);
    }
    if (marketAdjustment.reason) reasons.push(marketAdjustment.reason);
  }

  return {
    assessedLots,
    radiusM,
    publicHousingSignal,
    terraceHousingSignal,
    confidence: combineConfidence(publicHousingSignal, terraceHousingSignal),
    marketAdjustment,
    reasons,
  };
}

async function assessParcels(parcels: LinzParcelNearby[]): Promise<NeighbourParcelAssessment[]> {
  const out: NeighbourParcelAssessment[] = [];
  for (const parcel of parcels) {
    let title: LinzTitle | null = null;
    let ownerLookupAttempted = false;
    if (parcel.title_no) {
      ownerLookupAttempted = true;
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
      ownerLookupAttempted,
      publicHousing: owners.some(isPublicHousingOwner),
      terraceHousing: isTerraceLikeParcel(parcel, title),
    });
  }
  return out;
}

export async function fetchNeighbourhoodContext(opts: {
  lat: number;
  lng: number;
  subjectParcelId?: string | null;
}): Promise<NeighbourhoodContext> {
  const radii = [90, 150];
  for (const radiusM of radii) {
    const parcels = await fetchLINZParcelsNear(opts.lat, opts.lng, radiusM, 35);
    if (parcels === null) return DEFAULT_CONTEXT;
    const selected = selectNearestResidentialParcels(parcels, opts.subjectParcelId, 7);
    if (selected.length < 3 && radiusM !== radii[radii.length - 1]) continue;
    const assessments = await assessParcels(selected);
    return buildContext(assessments, radiusM);
  }
  return DEFAULT_CONTEXT;
}
