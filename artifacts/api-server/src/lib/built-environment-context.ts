import { fetchLINZAddressCandidates, fetchLINZParcelsNear, type LinzParcelNearby } from "./linz";
import { selectNearestResidentialParcels } from "./neighbourhood-context";
import { logger } from "./logger";
import { scrapePropertyValue } from "./scrapers/propertyvalue";

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
  status?: BuiltEnvironmentNearbyStatus;
}

export type BuiltEnvironmentNearbyStatus = "old" | "modern" | "new" | "unknown";

export interface BuiltEnvironmentNearbyStatusEntry {
  address: string | null;
  status: BuiltEnvironmentNearbyStatus;
  buildYear: number | null;
  buildYearRange: string | null;
  distanceM: number | null;
}

export interface BuiltEnvironmentStatusCounts {
  old: number;
  modern: number;
  new: number;
  unknown: number;
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
  nearbyStatus: BuiltEnvironmentNearbyStatusEntry[];
  statusCounts: BuiltEnvironmentStatusCounts;
  renewedShare: number;
  newCount: number;
}

interface BuildYearInfo {
  representativeYear: number | null;
  exactYear: number | null;
  range: string | null;
}

export interface ParcelBuildAssessment {
  parcel: LinzParcelNearby;
  address: string | null;
  distanceM: number | null;
  buildYear: number | null;
  buildYearRange: string | null;
  representativeYear: number | null;
}

export interface AddressBuildAssessment {
  address: string | null;
  distanceM: number | null;
  buildYear: number | null;
  buildYearRange: string | null;
  representativeYear: number | null;
}

export type BuiltEnvironmentAssessment = ParcelBuildAssessment | AddressBuildAssessment;

export const BUILT_ENVIRONMENT_RADIUS_M = 100;
export const BUILT_ENVIRONMENT_FULL_SCAN_COUNT = 30;
export const BUILT_ENVIRONMENT_LIGHT_SCAN_COUNT = 12;
export const BUILT_ENVIRONMENT_FULL_STATUS_COUNT = 15;

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
  nearbyStatus: [],
  statusCounts: { old: 0, modern: 0, new: 0, unknown: 0 },
  renewedShare: 0,
  newCount: 0,
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

function normaliseAddress(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(saint)\b/g, "st")
    .replace(/\b(mount)\b/g, "mt")
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function statusForYear(year: number | null): BuiltEnvironmentNearbyStatus {
  if (year == null) return "unknown";
  if (year < 1990) return "old";
  if (year < 2020) return "modern";
  return "new";
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

function representativeYearFor(buildYear: number | null, buildYearRange: string | null): number | null {
  if (buildYear != null) return buildYear;
  return parseBuildYear(buildYearRange).representativeYear;
}

interface ParsedStreetAddress {
  number: number;
  suffix: string | null;
  street: string;
  locality: string | null;
}

function parseStreetAddress(address: string): ParsedStreetAddress | null {
  const trimmed = address.trim();
  if (/^\d+\s*\/\s*\d+/i.test(trimmed)) return null;
  const match = trimmed.match(/^(\d+)([a-z])?\s+([^,]+)(?:,\s*(.+))?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  const street = match[3]?.trim();
  if (!Number.isFinite(number) || number <= 0 || !street) return null;
  const locality = match[4]?.replace(/\bnew zealand\b/ig, "").replace(/\b\d{4}\b/g, "").trim() || null;
  return {
    number,
    suffix: match[2]?.toUpperCase() ?? null,
    street,
    locality,
  };
}

export function generateNearbyAddressCandidates(address: string, maxCandidates = 45): string[] {
  const parsed = parseStreetAddress(address);
  if (!parsed) return [];
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (number: number) => {
    if (!Number.isFinite(number) || number <= 0 || number === parsed.number) return;
    const value = `${number} ${parsed.street}${parsed.locality ? `, ${parsed.locality}` : ""}`;
    const key = normaliseAddress(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(value);
  };

  for (let step = 1; candidates.length < maxCandidates && step <= 24; step++) {
    add(parsed.number + step * 2);
    add(parsed.number - step * 2);
    add(parsed.number + (step * 2 - 1));
    add(parsed.number - (step * 2 - 1));
  }

  return candidates.slice(0, maxCandidates);
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
    return { parcel, address: null, distanceM: parcel.distance_m, buildYear: null, buildYearRange: null, representativeYear: null };
  }
  try {
    const result = await queryCouncilBuildInfo(point.lat, point.lng, timeoutMs);
    return {
      parcel,
      address: result?.address ?? null,
      distanceM: parcel.distance_m,
      buildYear: result?.build.exactYear ?? null,
      buildYearRange: result?.build.range ?? null,
      representativeYear: result?.build.representativeYear ?? null,
    };
  } catch (err) {
    logger.debug({ err: (err as Error).message, parcelId: parcel.parcel_id }, "Built environment parcel lookup failed");
    return { parcel, address: null, distanceM: parcel.distance_m, buildYear: null, buildYearRange: null, representativeYear: null };
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

// Normalised suburb token for cross-suburb matching. Reduces a locality string
// ("Saint Heliers, Auckland") to just the suburb and expands common NZ abbreviations
// to LINZ canonical long forms so "Mt Eden", "Pt Chev", "St Heliers", etc. all match.
function suburbToken(locality: string | null | undefined): string | null {
  if (!locality) return null;
  const suburb = locality.split(",")[0]?.toLowerCase().trim();
  if (!suburb) return null;
  return suburb
    .replace(/\bmt\b/g, "mount")
    .replace(/\bpt\b/g, "point")
    .replace(/\bst\b/g, "saint")
    .replace(/\bnth\b/g, "north")
    .replace(/\bsth\b/g, "south")
    .replace(/\best\b/g, "east")
    .replace(/\bwst\b/g, "west")
    .replace(/\bjct\b/g, "junction")
    .replace(/\s+/g, " ")
    .trim() || null;
}

async function validateNearbyAddresses(subjectAddress: string, targetCount: number, timeoutMs: number): Promise<string[]> {
  const rawCandidates = generateNearbyAddressCandidates(subjectAddress, Math.max(targetCount * 3, 30));
  const subjectKey = normaliseAddress(subjectAddress);
  const subjectSuburb = suburbToken(parseStreetAddress(subjectAddress)?.locality);
  const unique = new Map<string, string>();
  const concurrency = 4;

  for (let i = 0; i < rawCandidates.length && unique.size < targetCount; i += concurrency) {
    const batch = rawCandidates.slice(i, i + concurrency);
    const resolved = await Promise.all(
      batch.map(async (candidate) => {
        // Fetch several matches, not just the top one: the app's suburb spelling
        // ("St Heliers") often only matches LINZ via the street-only query variant,
        // which can return the same street number in MULTIPLE suburbs (e.g. Hampton
        // Drive in both Saint Heliers and Swannanoa). Pick the first whose suburb
        // matches the subject so a wrong-suburb top hit doesn't shadow the right one.
        const matches = await fetchLINZAddressCandidates(candidate, { timeoutMs, maxResults: 5 }).catch(
          () => [] as Awaited<ReturnType<typeof fetchLINZAddressCandidates>>,
        );
        if (!subjectSuburb) return matches[0]?.address ?? null;
        const match = matches.find((m) => {
          const s = suburbToken(parseStreetAddress(m.address)?.locality);
          return !s || s === subjectSuburb;
        });
        return match?.address ?? null;
      }),
    );
    for (const address of resolved) {
      const key = normaliseAddress(address);
      if (!address || !key || key === subjectKey || unique.has(key)) continue;
      unique.set(key, address);
      if (unique.size >= targetCount) break;
    }
  }

  return Array.from(unique.values());
}

function timeoutAfter<T>(timeoutMs: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), timeoutMs));
}

async function assessAddress(address: string, timeoutMs: number): Promise<AddressBuildAssessment> {
  try {
    const result = await Promise.race([
      scrapePropertyValue(address),
      timeoutAfter<null>(timeoutMs, null),
    ]);
    const buildYear = result?.build_year ?? null;
    const buildYearRange = result?.build_year_range ?? null;
    return {
      address: result?.address_confirmed ?? address,
      distanceM: null,
      buildYear,
      buildYearRange,
      representativeYear: representativeYearFor(buildYear, buildYearRange),
    };
  } catch (err) {
    logger.debug({ err: (err as Error).message, address }, "Built environment address lookup failed");
    return { address, distanceM: null, buildYear: null, buildYearRange: null, representativeYear: null };
  }
}

async function assessAddresses(addresses: string[], timeoutMs: number): Promise<AddressBuildAssessment[]> {
  const concurrency = 4;
  const results: AddressBuildAssessment[] = [];
  for (let i = 0; i < addresses.length; i += concurrency) {
    const batch = addresses.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map((address) => assessAddress(address, timeoutMs))));
  }
  return results;
}

function confidenceFor(knownCount: number, assessedCount: number): BuiltEnvironmentConfidence {
  if (knownCount < 3 || assessedCount <= 0) return "unknown";
  if (knownCount >= 8) return "high";
  if (knownCount >= 5) return "medium";
  return "low";
}

function isSubjectOld(subjectBuildYear: number | null, subjectBuildYearRange: string | null): boolean {
  if (subjectBuildYear != null) return subjectBuildYear < 1990;
  const parsed = parseBuildYear(subjectBuildYearRange);
  return parsed.representativeYear != null && parsed.representativeYear < 1990;
}

export function buildBuiltEnvironmentContext(args: {
  assessments: BuiltEnvironmentAssessment[];
  radiusM: number;
  subjectBuildYear?: number | null;
  subjectBuildYearRange?: string | null;
}): BuiltEnvironmentContext {
  const assessedProperties = args.assessments.length;
  const years = args.assessments
    .map((a) => a.representativeYear)
    .filter((year): year is number => year != null);
  const knownBuildYearCount = years.length;
  const newCount = years.filter((year) => year >= 2020).length;
  const modernCount = years.filter((year) => year >= 1990 && year < 2020).length;
  const post2000Count = years.filter((year) => year >= 2000).length;
  const oldCount = years.filter((year) => year < 1990).length;
  const unknownCount = Math.max(0, assessedProperties - knownBuildYearCount);
  const modernShare = roundShare(modernCount, knownBuildYearCount);
  const post2000Share = roundShare(post2000Count, knownBuildYearCount);
  const renewedShare = roundShare(modernCount + newCount, knownBuildYearCount);
  const subjectBuildYear = args.subjectBuildYear ?? null;
  const subjectBuildYearRange = args.subjectBuildYearRange ?? null;
  const subjectOld = isSubjectOld(subjectBuildYear, subjectBuildYearRange);
  const confidence = confidenceFor(knownBuildYearCount, assessedProperties);

  let signal: BuiltEnvironmentSignal = "unknown";
  if (knownBuildYearCount < 3) signal = "insufficient_data";
  else if (subjectOld && renewedShare >= 0.45) signal = "last_missing_piece";
  else if (subjectOld && oldCount / knownBuildYearCount >= 0.6) signal = "older_environment";
  else if (subjectOld && renewedShare >= 0.25) signal = "mixed_renewal";
  else signal = "unknown";

  const reasons: string[] = [];
  if (assessedProperties <= 0) {
    reasons.push("Nearby build-era data was unavailable for this address.");
  } else if (knownBuildYearCount < 3) {
    reasons.push("Nearby build-era data is limited, so this factor has not changed the score.");
  } else {
    if (signal === "last_missing_piece") {
      reasons.push("Older subject dwelling sits among modern or new nearby homes; rebuild may unlock value to match the neighbourhood.");
    } else if (signal === "mixed_renewal") {
      reasons.push("Nearby renewal is visible but mixed; rebuild value uplift should be treated as supportive rather than decisive.");
    } else if (signal === "older_environment") {
      reasons.push("Most known nearby homes are old, so value matching is less certain and a new build may need to lead local renewal.");
    } else {
      reasons.push("Nearby build ages do not show a clear renewal pattern, so this factor is score-neutral.");
    }
  }

  const nearbyStatus = args.assessments
    .slice(0, BUILT_ENVIRONMENT_FULL_STATUS_COUNT)
    .map((a) => {
      const status = statusForYear(a.representativeYear);
      return {
        address: a.address,
        distanceM: a.distanceM,
        buildYear: a.buildYear,
        buildYearRange: a.buildYearRange,
        status,
      };
    });

  return {
    radiusM: args.radiusM,
    assessedProperties,
    knownBuildYearCount,
    modernCount,
    post2000Count,
    oldCount,
    unknownCount,
    newCount,
    modernShare,
    post2000Share,
    renewedShare,
    medianBuildYear: median(years),
    subjectBuildYear,
    subjectBuildYearRange,
    signal,
    confidence,
    reasons,
    statusCounts: {
      old: oldCount,
      modern: modernCount,
      new: newCount,
      unknown: unknownCount,
    },
    nearbyStatus,
    nearbyExamples: args.assessments
      .filter((a) => a.representativeYear != null)
      .slice(0, 5)
      .map((a) => ({
        address: a.address,
        distanceM: a.distanceM,
        buildYear: a.buildYear,
        buildYearRange: a.buildYearRange,
        status: statusForYear(a.representativeYear),
      })),
  };
}

export async function fetchBuiltEnvironmentContext(opts: {
  address?: string | null;
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
  const targetAddressCount = maxParcels <= BUILT_ENVIRONMENT_LIGHT_SCAN_COUNT
    ? BUILT_ENVIRONMENT_LIGHT_SCAN_COUNT
    : BUILT_ENVIRONMENT_FULL_STATUS_COUNT;

  try {
    if (opts.address?.trim()) {
      const addresses = await validateNearbyAddresses(opts.address, targetAddressCount, timeoutMsPerParcel);
      if (addresses.length > 0) {
        const assessments = await assessAddresses(addresses, timeoutMsPerParcel);
        return buildBuiltEnvironmentContext({
          assessments,
          radiusM,
          subjectBuildYear: opts.subjectBuildYear ?? null,
          subjectBuildYearRange: opts.subjectBuildYearRange ?? null,
        });
      }
    }

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
      roiDelta: -0.25,
      reason: "Nearby homes are mostly older, so a new build may need to lead the local environment rather than complete it.",
    };
  }
  return { roiDelta: 0, reason: null };
}
