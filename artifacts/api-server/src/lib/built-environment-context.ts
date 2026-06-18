import { fetchLINZParcelsNear, type LinzParcelNearby } from "./linz";
import { selectNearestResidentialParcels } from "./neighbourhood-context";
import { logger } from "./logger";

const AC_PROPERTY_VALUE_MAPSERVER =
  "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/PropertyValueInfo/MapServer";

export type BuiltEnvironmentSignal =
  | "last_missing_piece"
  | "mixed_renewal"
  | "older_environment"
  | "insufficient_data"
  | "unknown";

export type BuiltEnvironmentConfidence = "high" | "medium" | "low" | "unknown";

export interface BuiltEnvironmentExample {
  address: string | null;
  distanceM: number | null;
  buildYear: number | null;
  buildYearRange: string | null;
}

export interface BuiltEnvironmentContext {
  radiusM: number;
  assessedProperties: number;
  knownBuildYearCount: number;
  modernCount: number;
  post2000Count: number;
  oldCount: number;
  unknownCount: number;
  modernShare: number;
  post2000Share: number;
  medianBuildYear: number | null;
  subjectBuildYear: number | null;
  subjectBuildYearRange: string | null;
  signal: BuiltEnvironmentSignal;
  confidence: BuiltEnvironmentConfidence;
  reasons: string[];
  nearbyExamples: BuiltEnvironmentExample[];
}

interface BuildYearInfo {
  representativeYear: number | null;
  exactYear: number | null;
  range: string | null;
}

export interface ParcelBuildAssessment {
  parcel: LinzParcelNearby;
  address: string | null;
  buildYear: number | null;
  buildYearRange: string | null;
  representativeYear: number | null;
}

export const BUILT_ENVIRONMENT_RADIUS_M = 100;
export const BUILT_ENVIRONMENT_FULL_SCAN_COUNT = 30;
export const BUILT_ENVIRONMENT_LIGHT_SCAN_COUNT = 12;

const DEFAULT_CONTEXT: BuiltEnvironmentContext = {
  radiusM: BUILT_ENVIRONMENT_RADIUS_M,
  assessedProperties: 0,
  knownBuildYearCount: 0,
  modernCount: 0,
  post2000Count: 0,
  oldCount: 0,
  unknownCount: 0,
  modernShare: 0,
  post2000Share: 0,
  medianBuildYear: null,
  subjectBuildYear: null,
  subjectBuildYearRange: null,
  signal: "unknown",
  confidence: "unknown",
  reasons: ["Built-environment context was unavailable for this address."],
  nearbyExamples: [],
};

function roundShare(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100) / 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  return a != null && b != null ? Math.round((a + b) / 2) : null;
}

function parseBuildYear(raw: unknown): BuildYearInfo {
  if (raw == null || raw === "") return { representativeYear: null, exactYear: null, range: null };
  const text = String(raw).trim();
  const exact = text.match(/\b(18|19|20)\d{2}\b/);
  if (exact) {
    const year = Number(exact[0]);
    if (year >= 1800 && year <= new Date().getFullYear() + 1) {
      return { representativeYear: year, exactYear: year, range: null };
    }
  }

  const decade = text.match(/\b((?:18|19|20)\d0)s?\b/);
  if (decade) {
    const start = Number(decade[1]);
    if (start >= 1800 && start <= new Date().getFullYear()) {
      return { representativeYear: start + 5, exactYear: null, range: `${start}s` };
    }
  }

  return { representativeYear: null, exactYear: null, range: null };
}

function bestBuildYear(attrs: Record<string, unknown>): BuildYearInfo {
  const exact = parseBuildYear(
    attrs["YEARBUILT"] ?? attrs["YEAR_BUILT"] ?? attrs["BUILT_YEAR"] ?? attrs["BUILDYEAR"],
  );
  if (exact.exactYear != null) return exact;
  return parseBuildYear(attrs["DECADEBUILT"] ?? attrs["DECADE_BUILT"] ?? attrs["DECADE_BUILT_TXT"]);
}

function parcelPoint(parcel: LinzParcelNearby): { lat: number; lng: number } | null {
  const bbox = parcel.bbox;
  if (!bbox) return null;
  const polygon = bbox.polygon?.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ?? [];
  if (polygon.length > 0) {
    const sums = polygon.reduce(
      (acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }),
      { lat: 0, lng: 0 },
    );
    return { lat: sums.lat / polygon.length, lng: sums.lng / polygon.length };
  }
  return {
    lat: (bbox.minLat + bbox.maxLat) / 2,
    lng: (bbox.minLng + bbox.maxLng) / 2,
  };
}

async function queryCouncilBuildInfo(
  lat: number,
  lng: number,
  timeoutMs: number,
): Promise<{ address: string | null; build: BuildYearInfo } | null> {
  const url = new URL(`${AC_PROPERTY_VALUE_MAPSERVER}/3/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set(
    "outFields",
    "FORMATTEDADDRESS,ADDRESS,ADDRESSINONELINE,DECADEBUILT,DECADE_BUILT,YEARBUILT,YEAR_BUILT,BUILT_YEAR,BUILDYEAR,LANDUSEDESCRIPTION,FLOORAREA,CV",
  );
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) return null;
  const data = (await resp.json()) as {
    features?: Array<{ attributes?: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (data.error) return null;
  const attrs = data.features?.[0]?.attributes;
  if (!attrs) return null;
  const address = String(
    attrs["FORMATTEDADDRESS"] ?? attrs["ADDRESS"] ?? attrs["ADDRESSINONELINE"] ?? "",
  ).trim() || null;
  return { address, build: bestBuildYear(attrs) };
}

async function assessParcel(parcel: LinzParcelNearby, timeoutMs: number): Promise<ParcelBuildAssessment> {
  const point = parcelPoint(parcel);
  if (!point) {
    return { parcel, address: null, buildYear: null, buildYearRange: null, representativeYear: null };
  }
  try {
    const result = await queryCouncilBuildInfo(point.lat, point.lng, timeoutMs);
    return {
      parcel,
      address: result?.address ?? null,
      buildYear: result?.build.exactYear ?? null,
      buildYearRange: result?.build.range ?? null,
      representativeYear: result?.build.representativeYear ?? null,
    };
  } catch (err) {
    logger.debug({ err: (err as Error).message, parcelId: parcel.parcel_id }, "Built environment parcel lookup failed");
    return { parcel, address: null, buildYear: null, buildYearRange: null, representativeYear: null };
  }
}

async function assessParcels(parcels: LinzParcelNearby[], timeoutMs: number): Promise<ParcelBuildAssessment[]> {
  const concurrency = 5;
  const results: ParcelBuildAssessment[] = [];
  for (let i = 0; i < parcels.length; i += concurrency) {
    const batch = parcels.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map((parcel) => assessParcel(parcel, timeoutMs))));
  }
  return results;
}

function confidenceFor(knownCount: number, assessedCount: number): BuiltEnvironmentConfidence {
  if (knownCount < 3 || assessedCount <= 0) return "unknown";
  const share = knownCount / assessedCount;
  if (knownCount >= 8 && share >= 0.6) return "high";
  if (knownCount >= 5 && share >= 0.45) return "medium";
  return "low";
}

function isSubjectOld(subjectBuildYear: number | null, subjectBuildYearRange: string | null): boolean {
  if (subjectBuildYear != null) return subjectBuildYear < 2000;
  const parsed = parseBuildYear(subjectBuildYearRange);
  return parsed.representativeYear != null && parsed.representativeYear < 2000;
}

export function buildBuiltEnvironmentContext(args: {
  assessments: ParcelBuildAssessment[];
  radiusM: number;
  subjectBuildYear?: number | null;
  subjectBuildYearRange?: string | null;
}): BuiltEnvironmentContext {
  const assessedProperties = args.assessments.length;
  const years = args.assessments
    .map((a) => a.representativeYear)
    .filter((year): year is number => year != null);
  const knownBuildYearCount = years.length;
  const modernCount = years.filter((year) => year >= 2010).length;
  const post2000Count = years.filter((year) => year >= 2000).length;
  const oldCount = years.filter((year) => year < 1980).length;
  const unknownCount = Math.max(0, assessedProperties - knownBuildYearCount);
  const modernShare = roundShare(modernCount, knownBuildYearCount);
  const post2000Share = roundShare(post2000Count, knownBuildYearCount);
  const subjectBuildYear = args.subjectBuildYear ?? null;
  const subjectBuildYearRange = args.subjectBuildYearRange ?? null;
  const subjectOld = isSubjectOld(subjectBuildYear, subjectBuildYearRange);
  const confidence = confidenceFor(knownBuildYearCount, assessedProperties);

  let signal: BuiltEnvironmentSignal = "unknown";
  if (knownBuildYearCount < 3) signal = "insufficient_data";
  else if (subjectOld && post2000Share >= 0.45) signal = "last_missing_piece";
  else if (subjectOld && post2000Share >= 0.25) signal = "mixed_renewal";
  else if (oldCount / knownBuildYearCount >= 0.6) signal = "older_environment";
  else signal = "unknown";

  const reasons: string[] = [];
  if (assessedProperties <= 0) {
    reasons.push(`No nearby residential parcels could be assessed within ${args.radiusM} m.`);
  } else if (knownBuildYearCount < 3) {
    reasons.push(`Only ${knownBuildYearCount} nearby build year${knownBuildYearCount === 1 ? "" : "s"} could be confirmed within ${args.radiusM} m.`);
  } else {
    reasons.push(`${knownBuildYearCount} of ${assessedProperties} nearby residential properties had usable build year or decade data within ${args.radiusM} m.`);
    if (signal === "last_missing_piece") {
      reasons.push("Older subject dwelling sits among a strong nearby renewal pattern; rebuild may unlock value to match the neighbourhood.");
    } else if (signal === "mixed_renewal") {
      reasons.push("Nearby redevelopment is visible but mixed; rebuild value uplift should be treated as supportive rather than decisive.");
    } else if (signal === "older_environment") {
      reasons.push("Most known nearby homes are older, so a new build may need to lead rather than complete the local renewal pattern.");
    }
  }

  return {
    radiusM: args.radiusM,
    assessedProperties,
    knownBuildYearCount,
    modernCount,
    post2000Count,
    oldCount,
    unknownCount,
    modernShare,
    post2000Share,
    medianBuildYear: median(years),
    subjectBuildYear,
    subjectBuildYearRange,
    signal,
    confidence,
    reasons,
    nearbyExamples: args.assessments
      .filter((a) => a.representativeYear != null)
      .slice(0, 5)
      .map((a) => ({
        address: a.address,
        distanceM: a.parcel.distance_m,
        buildYear: a.buildYear,
        buildYearRange: a.buildYearRange,
      })),
  };
}

export async function fetchBuiltEnvironmentContext(opts: {
  lat: number;
  lng: number;
  subjectParcelId?: string | null;
  subjectBuildYear?: number | null;
  subjectBuildYearRange?: string | null;
  radiusM?: number;
  maxParcels?: number;
  timeoutMsPerParcel?: number;
}): Promise<BuiltEnvironmentContext> {
  const radiusM = opts.radiusM ?? BUILT_ENVIRONMENT_RADIUS_M;
  const maxParcels = opts.maxParcels ?? BUILT_ENVIRONMENT_FULL_SCAN_COUNT;
  const timeoutMsPerParcel = opts.timeoutMsPerParcel ?? 2500;

  try {
    const parcels = await fetchLINZParcelsNear(opts.lat, opts.lng, radiusM, Math.max(maxParcels * 3, 40));
    if (parcels === null) {
      return { ...DEFAULT_CONTEXT, radiusM, subjectBuildYear: opts.subjectBuildYear ?? null, subjectBuildYearRange: opts.subjectBuildYearRange ?? null };
    }
    const selected = selectNearestResidentialParcels(parcels, opts.subjectParcelId, maxParcels, radiusM);
    const assessments = await assessParcels(selected, timeoutMsPerParcel);
    return buildBuiltEnvironmentContext({
      assessments,
      radiusM,
      subjectBuildYear: opts.subjectBuildYear ?? null,
      subjectBuildYearRange: opts.subjectBuildYearRange ?? null,
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, lat: opts.lat, lng: opts.lng }, "Built environment context failed");
    return { ...DEFAULT_CONTEXT, radiusM, subjectBuildYear: opts.subjectBuildYear ?? null, subjectBuildYearRange: opts.subjectBuildYearRange ?? null };
  }
}

export function builtEnvironmentScoreAdjustment(context: BuiltEnvironmentContext | null | undefined): {
  roiDelta: number;
  reason: string | null;
} {
  if (!context || (context.confidence !== "medium" && context.confidence !== "high")) {
    return { roiDelta: 0, reason: null };
  }
  if (context.signal === "last_missing_piece") {
    return {
      roiDelta: 0.5,
      reason: "Older dwelling among newer nearby homes suggests rebuild value may be unlocked.",
    };
  }
  if (context.signal === "mixed_renewal") {
    return {
      roiDelta: 0.25,
      reason: "Some nearby renewal supports rebuild demand, though the surrounding build environment is mixed.",
    };
  }
  if (context.signal === "older_environment") {
    return {
      roiDelta: 0,
      reason: "Nearby homes are mostly older, so a new build may need to lead the local environment rather than complete it.",
    };
  }
  return { roiDelta: 0, reason: null };
}
