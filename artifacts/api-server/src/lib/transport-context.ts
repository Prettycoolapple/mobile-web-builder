import { inflateRawSync } from "node:zlib";
import { logger } from "./logger";

export type TransportConfidence = "high" | "medium" | "low" | "unknown";
export type TransportAccessTier = "excellent" | "good" | "limited" | "poor" | "unknown";
export type TransportMode = "bus" | "train" | "ferry" | "unknown";
export type ServiceIntensity = "frequent" | "regular" | "limited" | "unknown";
export type HighwayAccessTier = "excellent" | "good" | "neutral" | "remote" | "exposureRisk" | "unknown";
export type ExposureTier = "low" | "moderate" | "high" | "unknown";
export type RoiInfluence = "positive" | "neutral" | "negative" | "mixed";

export interface NearestTransitStop {
  name: string;
  mode: TransportMode;
  distanceM: number;
  routeCount: number;
  serviceIntensity: ServiceIntensity;
}

export interface PublicTransportContext {
  accessTier: TransportAccessTier;
  nearestStop: NearestTransitStop | null;
  nearestByMode: NearestTransitStop[];
  confidence: TransportConfidence;
}

export interface HighwayAccessContext {
  name: string | null;
  distanceM: number | null;
  accessTier: HighwayAccessTier;
  exposureTier: ExposureTier;
  confidence: TransportConfidence;
}

export interface CityCommuteContext {
  centreName: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  convenienceTier: TransportAccessTier;
  confidence: TransportConfidence;
}

export interface TransportContext {
  publicTransport: PublicTransportContext;
  /** @deprecated Highway context is retained for old saved reports; active UI ignores it. */
  highwayAccess: HighwayAccessContext;
  cityCommute: CityCommuteContext;
  roiInfluence: {
    influence: RoiInfluence;
    reasons: string[];
    numericAdjustmentApplied: false;
  };
}

type Point = { lat: number; lng: number };
type FeedRegion = "auckland" | "wellington" | "christchurch";

interface GtfsFeedConfig {
  region: FeedRegion;
  label: string;
  url: string;
  envUrl?: string;
  envKey?: string;
  keyHeader?: string;
  centre: CityCentre;
}

export interface CityCentre extends Point {
  name: string;
  region: FeedRegion | "regional";
}

interface ParsedStop extends Point {
  id: string;
  name: string;
}

interface StopSummary extends ParsedStop {
  routeTypes: Set<number>;
  routeIds: Set<string>;
  departureCount: number;
}

interface CachedFeed {
  loadedAt: number;
  stops: ParsedStop[];
  routeTypesByRouteId: Map<string, number>;
  routeIdsByStopId: Map<string, Set<string>>;
  departureCountByStopId: Map<string, number>;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const RAPID_TRANSIT_SCAN_RADIUS_M = 3600;
const feedCache = new Map<FeedRegion, CachedFeed>();
const inflight = new Map<FeedRegion, Promise<CachedFeed | null>>();

const CITY_CENTRES: CityCentre[] = [
  { region: "auckland", name: "Auckland CBD", lat: -36.8485, lng: 174.7633 },
  { region: "wellington", name: "Wellington CBD", lat: -41.2865, lng: 174.7762 },
  { region: "christchurch", name: "Christchurch CBD", lat: -43.5321, lng: 172.6362 },
  { region: "regional", name: "Hamilton city centre", lat: -37.7870, lng: 175.2793 },
  { region: "regional", name: "Tauranga city centre", lat: -37.6878, lng: 176.1651 },
  { region: "regional", name: "Dunedin city centre", lat: -45.8788, lng: 170.5028 },
];

const AUCKLAND_CBD = CITY_CENTRES[0]!;
const WELLINGTON_CBD = CITY_CENTRES[1]!;
const CHRISTCHURCH_CBD = CITY_CENTRES[2]!;

const FEEDS: GtfsFeedConfig[] = [
  {
    region: "auckland",
    label: "Auckland Transport GTFS",
    url: "https://gtfs.at.govt.nz/gtfs.zip",
    envUrl: "AT_GTFS_URL",
    centre: AUCKLAND_CBD,
  },
  {
    region: "wellington",
    label: "Metlink GTFS",
    url: "https://static.opendata.metlink.org.nz/v1/gtfs/full.zip",
    envUrl: "METLINK_GTFS_URL",
    centre: WELLINGTON_CBD,
  },
  {
    region: "christchurch",
    label: "Metro Christchurch GTFS",
    url: "https://apis.metroinfo.co.nz/rti/gtfs/v1/gtfs.zip",
    envUrl: "METRO_CHCH_GTFS_URL",
    envKey: "METRO_CHCH_API_KEY",
    keyHeader: "Ocp-Apim-Subscription-Key",
    centre: CHRISTCHURCH_CBD,
  },
];

const HIGHWAY_CORRIDORS: Array<{ name: string; region: FeedRegion; points: Point[] }> = [
  { name: "Auckland SH1 / Northern-Southern Motorway", region: "auckland", points: [
    { lat: -36.715, lng: 174.735 }, { lat: -36.793, lng: 174.748 }, { lat: -36.848, lng: 174.765 }, { lat: -36.920, lng: 174.838 }, { lat: -37.000, lng: 174.885 },
  ] },
  { name: "Auckland SH16 / Northwestern Motorway", region: "auckland", points: [
    { lat: -36.855, lng: 174.762 }, { lat: -36.864, lng: 174.705 }, { lat: -36.867, lng: 174.620 }, { lat: -36.840, lng: 174.505 },
  ] },
  { name: "Auckland SH20 / Southwestern Motorway", region: "auckland", points: [
    { lat: -36.930, lng: 174.705 }, { lat: -36.970, lng: 174.785 }, { lat: -37.000, lng: 174.850 },
  ] },
  { name: "Wellington SH1", region: "wellington", points: [
    { lat: -41.180, lng: 174.825 }, { lat: -41.235, lng: 174.812 }, { lat: -41.286, lng: 174.776 }, { lat: -41.323, lng: 174.797 },
  ] },
  { name: "Wellington SH2", region: "wellington", points: [
    { lat: -41.190, lng: 174.930 }, { lat: -41.220, lng: 174.885 }, { lat: -41.260, lng: 174.815 },
  ] },
  { name: "Christchurch SH1", region: "christchurch", points: [
    { lat: -43.405, lng: 172.580 }, { lat: -43.510, lng: 172.555 }, { lat: -43.620, lng: 172.530 },
  ] },
  { name: "Christchurch SH74 / Northern Arterial", region: "christchurch", points: [
    { lat: -43.430, lng: 172.650 }, { lat: -43.480, lng: 172.675 }, { lat: -43.530, lng: 172.690 },
  ] },
];

const UNKNOWN_HIGHWAY_CONTEXT: HighwayAccessContext = {
  name: null,
  distanceM: null,
  accessTier: "unknown",
  exposureTier: "unknown",
  confidence: "unknown",
};

function distanceMeters(a: Point, b: Point): number {
  const r = 6_371_000;
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function project(point: Point, ref: Point): { x: number; y: number } {
  return {
    x: (point.lng - ref.lng) * 111_320 * Math.cos((ref.lat * Math.PI) / 180),
    y: (point.lat - ref.lat) * 111_320,
  };
}

function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const ref = p;
  const pp = project(p, ref);
  const aa = project(a, ref);
  const bb = project(b, ref);
  const dx = bb.x - aa.x;
  const dy = bb.y - aa.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(pp.x - aa.x, pp.y - aa.y);
  const t = Math.max(0, Math.min(1, ((pp.x - aa.x) * dx + (pp.y - aa.y) * dy) / lenSq));
  return Math.hypot(pp.x - (aa.x + t * dx), pp.y - (aa.y + t * dy));
}

function nearestCentre(lat: number, lng: number): CityCentre {
  const p = { lat, lng };
  return [...CITY_CENTRES].sort((a, b) => distanceMeters(p, a) - distanceMeters(p, b))[0] ?? AUCKLAND_CBD;
}

function regionForPoint(lat: number, lng: number): FeedRegion | null {
  const centre = nearestCentre(lat, lng);
  const dKm = distanceMeters({ lat, lng }, centre) / 1000;
  if (centre.region === "regional" || dKm > 85) return null;
  return centre.region;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (quoted && line[i + 1] === "\"") {
        cur += "\"";
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function extractZipEntries(buf: Buffer, wanted: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const wantedSet = new Set(wanted);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("GTFS zip: EOCD not found");
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  let ptr = centralOffset;
  const end = centralOffset + centralSize;
  while (ptr < end && out.size < wantedSet.size) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const rawName = buf.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    const baseName = rawName.split("/").pop() ?? rawName;
    if (wantedSet.has(baseName)) {
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const compressed = buf.slice(dataStart, dataStart + compSize);
      const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (bytes) out.set(baseName, bytes.toString("utf8"));
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function routeTypeToMode(routeType: number): TransportMode {
  if (routeType === 2) return "train";
  if (routeType === 4) return "ferry";
  if (routeType === 3 || routeType === 0 || routeType === 1) return "bus";
  return "unknown";
}

function bestMode(types: Set<number>): TransportMode {
  if ([...types].some((t) => routeTypeToMode(t) === "train")) return "train";
  if ([...types].some((t) => routeTypeToMode(t) === "ferry")) return "ferry";
  if ([...types].some((t) => routeTypeToMode(t) === "bus")) return "bus";
  return "unknown";
}

export function classifyServiceIntensity(departures: number, routeCount: number): ServiceIntensity {
  if (departures >= 180 || routeCount >= 8) return "frequent";
  if (departures >= 55 || routeCount >= 3) return "regular";
  if (departures > 0 || routeCount > 0) return "limited";
  return "unknown";
}

export function classifyTransitAccessForStop(stop: NearestTransitStop | null): TransportAccessTier {
  if (!stop) return "poor";
  const d = stop.distanceM;
  const rapid = stop.mode === "train" || stop.mode === "ferry";
  if ((rapid && d <= 800) || (stop.mode === "bus" && d <= 400 && stop.serviceIntensity === "frequent")) return "excellent";
  if ((rapid && d <= 1200) || (stop.mode === "bus" && d <= 500)) return "good";
  if (d <= 1500) return "limited";
  return "poor";
}

async function loadFeed(config: GtfsFeedConfig): Promise<CachedFeed | null> {
  const cached = feedCache.get(config.region);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached;
  const active = inflight.get(config.region);
  if (active) return active;

  const promise = (async () => {
    const url = process.env[config.envUrl ?? ""]?.trim() || config.url;
    const headers: Record<string, string> = { accept: "application/zip,application/octet-stream,*/*" };
    const key = config.envKey ? process.env[config.envKey]?.trim() : "";
    if (key && config.keyHeader) headers[config.keyHeader] = key;
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(18_000) });
    if (!resp.ok) throw new Error(`${config.label} returned HTTP ${resp.status}`);
    const entries = extractZipEntries(Buffer.from(await resp.arrayBuffer()), ["stops.txt", "routes.txt", "trips.txt", "stop_times.txt"]);
    const stops = parseCsv(entries.get("stops.txt") ?? "")
      .map((r) => ({ id: r.stop_id, name: r.stop_name || r.stop_id, lat: Number(r.stop_lat), lng: Number(r.stop_lon) }))
      .filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lng));
    const routeTypesByRouteId = new Map<string, number>();
    for (const r of parseCsv(entries.get("routes.txt") ?? "")) {
      const t = Number(r.route_type);
      if (r.route_id && Number.isFinite(t)) routeTypesByRouteId.set(r.route_id, t);
    }
    const routeIdByTripId = new Map<string, string>();
    for (const t of parseCsv(entries.get("trips.txt") ?? "")) {
      if (t.trip_id && t.route_id) routeIdByTripId.set(t.trip_id, t.route_id);
    }
    const routeIdsByStopId = new Map<string, Set<string>>();
    const departureCountByStopId = new Map<string, number>();
    for (const st of parseCsv(entries.get("stop_times.txt") ?? "")) {
      const routeId = routeIdByTripId.get(st.trip_id);
      if (!routeId || !st.stop_id) continue;
      let set = routeIdsByStopId.get(st.stop_id);
      if (!set) {
        set = new Set();
        routeIdsByStopId.set(st.stop_id, set);
      }
      set.add(routeId);
      departureCountByStopId.set(st.stop_id, (departureCountByStopId.get(st.stop_id) ?? 0) + 1);
    }
    const loaded = { loadedAt: Date.now(), stops, routeTypesByRouteId, routeIdsByStopId, departureCountByStopId };
    feedCache.set(config.region, loaded);
    logger.info({ region: config.region, stops: stops.length }, "Transport context: GTFS feed loaded");
    return loaded;
  })().catch((err) => {
    logger.warn({ region: config.region, err: (err as Error).message }, "Transport context: GTFS feed unavailable");
    return null;
  }).finally(() => inflight.delete(config.region));

  inflight.set(config.region, promise);
  return promise;
}

function buildPublicTransportContext(feed: CachedFeed | null, lat: number, lng: number): PublicTransportContext {
  if (!feed) {
    return { accessTier: "unknown", nearestStop: null, nearestByMode: [], confidence: "unknown" };
  }
  const p = { lat, lng };
  const nearby: Array<StopSummary & { distance: number }> = feed.stops
    .map((s) => {
      const routeIds = feed.routeIdsByStopId.get(s.id) ?? new Set<string>();
      const routeTypes = new Set([...routeIds].map((id) => feed.routeTypesByRouteId.get(id)).filter((v): v is number => typeof v === "number"));
      return {
        ...s,
        routeIds,
        routeTypes,
        departureCount: feed.departureCountByStopId.get(s.id) ?? 0,
        distance: Math.round(distanceMeters(p, s)),
      };
    })
    .filter((s) => s.distance <= RAPID_TRANSIT_SCAN_RADIUS_M && s.routeIds.size > 0)
    .filter((s) => {
      const mode = bestMode(s.routeTypes);
      return mode === "train" || mode === "ferry";
    })
    .sort((a, b) => a.distance - b.distance);

  const nearestByMode = (["train", "ferry"] as TransportMode[])
    .map((mode) => {
      const stop = nearby.find((s) => bestMode(s.routeTypes) === mode);
      if (!stop) return null;
      return {
        name: stop.name,
        mode,
        distanceM: stop.distance,
        routeCount: stop.routeIds.size,
        serviceIntensity: classifyServiceIntensity(stop.departureCount, stop.routeIds.size),
      };
    })
    .filter((s): s is NearestTransitStop => s !== null);

  const nearestStop = [...nearestByMode].sort((a, b) => {
    const aTier = classifyTransitAccessForStop(a);
    const bTier = classifyTransitAccessForStop(b);
    const rank: Record<TransportAccessTier, number> = { excellent: 0, good: 1, limited: 2, poor: 3, unknown: 4 };
    if (rank[aTier] !== rank[bTier]) return rank[aTier] - rank[bTier];
    return a.distanceM - b.distanceM;
  })[0] ?? null;

  return {
    accessTier: classifyTransitAccessForStop(nearestStop),
    nearestStop,
    nearestByMode,
    confidence: "medium",
  };
}

export function classifyHighwayDistance(distanceM: number | null): { accessTier: HighwayAccessTier; exposureTier: ExposureTier } {
  if (distanceM == null) return { accessTier: "unknown", exposureTier: "unknown" };
  if (distanceM < 150) return { accessTier: "exposureRisk", exposureTier: "high" };
  if (distanceM < 300) return { accessTier: "excellent", exposureTier: "moderate" };
  if (distanceM <= 3000) return { accessTier: "excellent", exposureTier: "low" };
  if (distanceM <= 5000) return { accessTier: "good", exposureTier: "low" };
  if (distanceM <= 8000) return { accessTier: "neutral", exposureTier: "low" };
  return { accessTier: "remote", exposureTier: "low" };
}

function buildHighwayContext(lat: number, lng: number, region: FeedRegion | null): HighwayAccessContext {
  if (!region) return { name: null, distanceM: null, accessTier: "unknown", exposureTier: "unknown", confidence: "unknown" };
  const p = { lat, lng };
  let best: { name: string; distanceM: number } | null = null;
  for (const corridor of HIGHWAY_CORRIDORS.filter((c) => c.region === region)) {
    for (let i = 0; i < corridor.points.length - 1; i++) {
      const a = corridor.points[i];
      const b = corridor.points[i + 1];
      if (!a || !b) continue;
      const d = distancePointToSegment(p, a, b);
      if (!best || d < best.distanceM) best = { name: corridor.name, distanceM: Math.round(d) };
    }
  }
  if (!best) return { name: null, distanceM: null, accessTier: "unknown", exposureTier: "unknown", confidence: "unknown" };
  const classified = classifyHighwayDistance(best.distanceM);
  return { name: best.name, distanceM: best.distanceM, ...classified, confidence: "low" };
}

export function classifyCommuteConvenience(distanceKm: number | null, highway: HighwayAccessTier, transit: TransportAccessTier): TransportAccessTier {
  if (distanceKm == null) return "unknown";
  if (distanceKm <= 8 && (transit === "excellent" || highway === "excellent" || highway === "good")) return "excellent";
  if (distanceKm <= 16 && (transit === "excellent" || transit === "good" || highway === "excellent" || highway === "good")) return "good";
  if (distanceKm <= 28 && (transit !== "poor" || highway !== "remote")) return "limited";
  if (distanceKm <= 45 && highway !== "unknown") return "limited";
  return "poor";
}

export function classifyRouteCommuteConvenience(distanceKm: number | null, durationMinutes: number | null): TransportAccessTier {
  if (distanceKm == null || durationMinutes == null) return "unknown";
  if (durationMinutes <= 20 || distanceKm <= 8) return "excellent";
  if (durationMinutes <= 30 || distanceKm <= 14) return "good";
  if (durationMinutes <= 45 || distanceKm <= 24) return "limited";
  return "poor";
}

export function parseGoogleDurationSeconds(duration: string | null | undefined): number | null {
  if (!duration) return null;
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

export async function fetchGoogleRoutesCommute(
  lat: number,
  lng: number,
  centre: CityCentre,
): Promise<CityCommuteContext> {
  const unavailable: CityCommuteContext = {
    centreName: centre.name,
    distanceKm: null,
    durationMinutes: null,
    convenienceTier: "unknown",
    confidence: "unknown",
  };
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"]?.trim();
  if (!apiKey) {
    logger.info("Transport context: GOOGLE_MAPS_API_KEY not set; CBD route commute hidden");
    return unavailable;
  }

  try {
    const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: lat, longitude: lng } } },
        destination: { location: { latLng: { latitude: centre.lat, longitude: centre.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        languageCode: "en-NZ",
        regionCode: "NZ",
        units: "METRIC",
      }),
      signal: AbortSignal.timeout(8_000),
    });

    const data = (await resp.json().catch(() => ({}))) as {
      routes?: Array<{ duration?: string; distanceMeters?: number }>;
      error?: { message?: string };
    };
    if (!resp.ok) {
      throw new Error(data.error?.message || `Google Routes returned HTTP ${resp.status}`);
    }

    const route = data.routes?.[0];
    const distanceMeters = Number(route?.distanceMeters);
    const seconds = parseGoogleDurationSeconds(route?.duration);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0 || seconds == null || seconds <= 0) {
      return unavailable;
    }

    const distanceKm = Math.round((distanceMeters / 1000) * 10) / 10;
    const durationMinutes = Math.max(1, Math.round(seconds / 60));
    return {
      centreName: centre.name,
      distanceKm,
      durationMinutes,
      convenienceTier: classifyRouteCommuteConvenience(distanceKm, durationMinutes),
      confidence: "high",
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Transport context: Google Routes commute unavailable");
    return unavailable;
  }
}

function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

export function buildTransportRoiInfluence(
  pt: PublicTransportContext,
  commuteOrHighway: CityCommuteContext | HighwayAccessContext,
  maybeCommute?: CityCommuteContext,
): TransportContext["roiInfluence"] {
  const commute = maybeCommute ?? (commuteOrHighway as CityCommuteContext);
  const positives: string[] = [];
  const negatives: string[] = [];
  const stop = pt.nearestStop;
  if (stop && (pt.accessTier === "excellent" || pt.accessTier === "good")) {
    positives.push(`Nearby ${stop.mode} access at ${stop.name} (${Math.round(stop.distanceM)} m) may support buyer demand and rental appeal.`);
  }
  if (commute.confidence !== "unknown" && commute.centreName && commute.distanceKm != null && commute.durationMinutes != null) {
    const commuteText = `About ${commute.durationMinutes} min / ${formatKm(commute.distanceKm)} to ${commute.centreName}.`;
    if (commute.convenienceTier === "excellent" || commute.convenienceTier === "good") {
      positives.push(`${commuteText} That commute profile may support sales-price resilience.`);
    } else if (commute.convenienceTier === "poor") {
      negatives.push(`${commuteText} Longer CBD access may narrow buyer demand for commute-sensitive purchasers.`);
    } else {
      positives.push(`${commuteText} This commute context supports pricing assumptions.`);
    }
  }
  const influence: RoiInfluence = positives.length > 0 && negatives.length > 0
    ? "mixed"
    : positives.length > 0
      ? "positive"
      : negatives.length > 0
        ? "negative"
        : "neutral";
  return {
    influence,
    reasons: [...positives, ...negatives],
    numericAdjustmentApplied: false,
  };
}

export async function fetchTransportContext(lat: number, lng: number): Promise<TransportContext> {
  const region = regionForPoint(lat, lng);
  const feedConfig = region ? FEEDS.find((f) => f.region === region) ?? null : null;
  const feed = feedConfig ? await loadFeed(feedConfig) : null;
  const publicTransport = buildPublicTransportContext(feed, lat, lng);
  const centre = feedConfig?.centre ?? nearestCentre(lat, lng);
  const cityCommute = await fetchGoogleRoutesCommute(lat, lng, centre);
  return {
    publicTransport,
    highwayAccess: UNKNOWN_HIGHWAY_CONTEXT,
    cityCommute,
    roiInfluence: buildTransportRoiInfluence(publicTransport, cityCommute),
  };
}
