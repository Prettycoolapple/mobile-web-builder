import { logger } from "./logger";

export type AmenityCategory =
  | "school"
  | "hospital"
  | "clinic"
  | "swimming_pool"
  | "recreation_centre"
  | "park"
  | "gym"
  | "supermarket"
  | "pharmacy"
  | "unknown";

export type NearbyAmenitySource =
  | "google_places"
  | "google_text_search"
  | "osm_overpass"
  | "report_school_zones";

export interface NearbyAmenityRequest {
  categories: AmenityCategory[];
  rawTerms: string[];
}

export interface NearbyAmenityTarget {
  address: string;
  lat: number;
  lng: number;
}

export interface NearbyAmenityResult {
  category: AmenityCategory;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
  driveDistanceMeters: number | null;
  driveDurationMinutes: number | null;
  source: NearbyAmenitySource;
  notes?: string | null;
}

export interface ReportSchoolZoneSummary {
  name: string;
  level: string | null;
  yearLevels: string | null;
  authority: string | null;
  enrolmentScheme: string | null;
}

interface CategoryConfig {
  label: string;
  radiusMeters: number;
  googleTypes: string[];
  osmTags: Array<[string, string]>;
  textQueries: string[];
}

const CATEGORY_CONFIG: Record<AmenityCategory, CategoryConfig> = {
  school: {
    label: "School",
    radiusMeters: 4000,
    googleTypes: ["school"],
    osmTags: [["amenity", "school"]],
    textQueries: ["school"],
  },
  hospital: {
    label: "Hospital",
    radiusMeters: 8000,
    googleTypes: ["hospital"],
    osmTags: [["amenity", "hospital"], ["healthcare", "hospital"]],
    textQueries: ["hospital"],
  },
  clinic: {
    label: "Clinic",
    radiusMeters: 6000,
    googleTypes: ["doctor"],
    osmTags: [["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "clinic"], ["healthcare", "doctor"]],
    textQueries: ["medical centre", "clinic", "GP"],
  },
  swimming_pool: {
    label: "Swimming pool",
    radiusMeters: 6000,
    googleTypes: ["swimming_pool"],
    osmTags: [["leisure", "swimming_pool"], ["sport", "swimming"]],
    textQueries: ["swimming pool"],
  },
  recreation_centre: {
    label: "Recreation centre",
    radiusMeters: 6000,
    googleTypes: ["sports_complex", "community_center"],
    osmTags: [["leisure", "sports_centre"], ["amenity", "community_centre"]],
    textQueries: ["recreation centre", "leisure centre", "sports centre"],
  },
  park: {
    label: "Park",
    radiusMeters: 3000,
    googleTypes: ["park"],
    osmTags: [["leisure", "park"]],
    textQueries: ["park"],
  },
  gym: {
    label: "Gym",
    radiusMeters: 5000,
    googleTypes: ["gym"],
    osmTags: [["leisure", "fitness_centre"], ["sport", "fitness"]],
    textQueries: ["gym", "fitness centre"],
  },
  supermarket: {
    label: "Supermarket",
    radiusMeters: 5000,
    googleTypes: ["supermarket"],
    osmTags: [["shop", "supermarket"]],
    textQueries: ["supermarket"],
  },
  pharmacy: {
    label: "Pharmacy",
    radiusMeters: 5000,
    googleTypes: ["pharmacy"],
    osmTags: [["amenity", "pharmacy"], ["shop", "chemist"]],
    textQueries: ["pharmacy"],
  },
  unknown: {
    label: "Amenity",
    radiusMeters: 5000,
    googleTypes: [],
    osmTags: [],
    textQueries: [],
  },
};

const CATEGORY_ALIASES: Array<{ category: AmenityCategory; label: string; pattern: RegExp }> = [
  { category: "school", label: "schools", pattern: /\b(?:school|schools|college|kindergarten|primary|intermediate|secondary)\b/i },
  { category: "school", label: "schools", pattern: /(?:\u5b66\u6821|\u5b78\u6821|\u5c0f\u5b66|\u5c0f\u5b78|\u4e2d\u5b66|\u4e2d\u5b78|\u5b66\u533a|\u5b78\u5340)/u },
  { category: "hospital", label: "hospitals", pattern: /\b(?:hospital|hospitals|a\s*&\s*e|emergency\s+department)\b/i },
  { category: "hospital", label: "hospitals", pattern: /(?:\u533b\u9662|\u91ab\u9662)/u },
  { category: "clinic", label: "clinics", pattern: /\b(?:clinic|clinics|medical\s+centre|medical\s+center|gp|doctor|doctors)\b/i },
  { category: "clinic", label: "clinics", pattern: /(?:\u8bca\u6240|\u8a3a\u6240|\u95e8\u8bca|\u9580\u8a3a|\u533b\u7597\u4e2d\u5fc3|\u91ab\u7642\u4e2d\u5fc3)/u },
  { category: "swimming_pool", label: "swimming pools", pattern: /\b(?:swimming\s+pool|swimming\s+pools|public\s+pool|pools?)\b/i },
  { category: "swimming_pool", label: "swimming pools", pattern: /(?:\u6e38\u6cf3\u6c60|\u6cf3\u6c60)/u },
  { category: "recreation_centre", label: "recreation centres", pattern: /\b(?:recreation\s+cent(?:re|er)|recreational\s+cent(?:re|er)|leisure\s+cent(?:re|er)|sports?\s+cent(?:re|er)|community\s+cent(?:re|er))\b/i },
  { category: "recreation_centre", label: "recreation centres", pattern: /(?:\u5eb7\u4f53|\u5eb7\u9ad4|\u5a31\u4e50\u4e2d\u5fc3|\u5a1b\u6a02\u4e2d\u5fc3|\u8fd0\u52a8\u4e2d\u5fc3|\u904b\u52d5\u4e2d\u5fc3|\u4f53\u80b2\u9986|\u9ad4\u80b2\u9928)/u },
  { category: "park", label: "parks", pattern: /\b(?:park|parks|playground|reserve)\b/i },
  { category: "park", label: "parks", pattern: /(?:\u516c\u56ed|\u516c\u5712)/u },
  { category: "gym", label: "gyms", pattern: /\b(?:gym|gyms|fitness\s+centre|fitness\s+center)\b/i },
  { category: "gym", label: "gyms", pattern: /(?:\u5065\u8eab\u623f|\u5065\u8eab\u4e2d\u5fc3)/u },
  { category: "supermarket", label: "supermarkets", pattern: /\b(?:supermarket|supermarkets|grocery|groceries)\b/i },
  { category: "supermarket", label: "supermarkets", pattern: /(?:\u8d85\u5e02)/u },
  { category: "pharmacy", label: "pharmacies", pattern: /\b(?:pharmacy|pharmacies|chemist|chemists)\b/i },
  { category: "pharmacy", label: "pharmacies", pattern: /(?:\u836f\u623f|\u85e5\u623f)/u },
];

const NEARBY_PATTERN =
  /\b(?:nearby|near|around|close\s+to|within|surrounding|local|in\s+the\s+area|walking\s+distance)\b/i;
const NEARBY_PATTERN_ZH = /(?:\u9644\u8fd1|\u5468\u8fb9|\u5468\u908a|\u5468\u56f4|\u5468\u570d|\u5468\u906d|\u65c1\u8fb9|\u65c1\u908a|\u914d\u5957)/u;
const CONTEXTUAL_PROPERTY_PATTERN =
  /\b(?:this|the)\s+(?:property|house|home|site|address|area)\b/i;
const CONTEXTUAL_PROPERTY_PATTERN_ZH = /(?:\u8fd9\u4e2a\u623f|\u9019\u500b\u623f|\u8fd9\u5957|\u9019\u5957|\u8fd9\u4e2a\u7269\u4e1a|\u9019\u500b\u7269\u696d|\u8fd9\u4e2a\u5730\u5740|\u9019\u500b\u5730\u5740)/u;
const GENERIC_AMENITY_PATTERN =
  /\b(?:amenit(?:y|ies)|facilit(?:y|ies)|local\s+services?|neighbou?rhood\s+services?)\b/i;
const GENERIC_AMENITY_PATTERN_ZH = /(?:\u914d\u5957|\u751f\u6d3b\u8bbe\u65bd|\u751f\u6d3b\u8a2d\u65bd|\u8bbe\u65bd|\u8a2d\u65bd)/u;

export function extractNearbyAmenityCategories(text: string): AmenityCategory[] {
  const categories: AmenityCategory[] = [];
  for (const alias of CATEGORY_ALIASES) {
    alias.pattern.lastIndex = 0;
    if (alias.pattern.test(text)) categories.push(alias.category);
  }
  return unique(categories);
}

export function extractNearbyAmenityTerms(text: string): string[] {
  const terms: string[] = [];
  for (const alias of CATEGORY_ALIASES) {
    alias.pattern.lastIndex = 0;
    if (alias.pattern.test(text)) terms.push(alias.label);
  }
  if (GENERIC_AMENITY_PATTERN.test(text) || GENERIC_AMENITY_PATTERN_ZH.test(text)) terms.push("amenities");
  return unique(terms).slice(0, 8);
}

export function detectNearbyAmenityIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const nearby =
    NEARBY_PATTERN.test(raw) ||
    NEARBY_PATTERN_ZH.test(raw) ||
    CONTEXTUAL_PROPERTY_PATTERN.test(raw) ||
    CONTEXTUAL_PROPERTY_PATTERN_ZH.test(raw);
  const categories = extractNearbyAmenityCategories(raw);
  const generic = GENERIC_AMENITY_PATTERN.test(raw) || GENERIC_AMENITY_PATTERN_ZH.test(raw);
  return nearby && (categories.length > 0 || generic);
}

export function normaliseNearbyAmenityTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return unique(
    raw
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ).slice(0, 8);
}

export function buildNearbyAmenityRequest(text: string, semanticTerms: string[] = []): NearbyAmenityRequest {
  const categories = new Set<AmenityCategory>(extractNearbyAmenityCategories(text));
  const rawTerms = new Set<string>(extractNearbyAmenityTerms(text));
  for (const term of semanticTerms) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    rawTerms.add(trimmed);
    for (const category of extractNearbyAmenityCategories(trimmed)) categories.add(category);
  }

  const generic = GENERIC_AMENITY_PATTERN.test(text) || GENERIC_AMENITY_PATTERN_ZH.test(text);
  if (categories.size === 0 && generic) {
    categories.add("school");
    categories.add("hospital");
    categories.add("park");
    categories.add("supermarket");
  }
  if (categories.size === 0 && semanticTerms.length > 0) categories.add("unknown");

  return {
    categories: [...categories],
    rawTerms: [...rawTerms].slice(0, 8),
  };
}

export function amenityRequestHasSearchableCategories(request: NearbyAmenityRequest): boolean {
  return request.categories.some((category) => category !== "school" && category !== "unknown") ||
    request.categories.includes("school") ||
    request.rawTerms.length > 0;
}

export async function fetchNearbyAmenities(
  target: NearbyAmenityTarget,
  request: NearbyAmenityRequest,
  options: { maxPerCategory?: number; includeDriveTimes?: boolean } = {},
): Promise<NearbyAmenityResult[]> {
  const maxPerCategory = Math.max(1, Math.min(8, options.maxPerCategory ?? 5));
  const categories = request.categories.length > 0 ? request.categories : ["unknown" as AmenityCategory];
  const all: NearbyAmenityResult[] = [];

  for (const category of categories) {
    const config = CATEGORY_CONFIG[category];
    const cacheKey = nearbyCacheKey(target, category, request.rawTerms, config.radiusMeters);
    const cached = nearbyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      all.push(...cached.results.slice(0, maxPerCategory));
      continue;
    }

    let results: NearbyAmenityResult[] = [];
    const googleKey = placesApiKey();
    if (googleKey) {
      results = await fetchGooglePlaces(target, category, request.rawTerms, googleKey).catch((err) => {
        logger.warn({ err, category, address: target.address }, "Nearby amenities: Google Places lookup failed");
        return [];
      });
    }
    if (results.length === 0) {
      results = await fetchOverpassAmenities(target, category).catch((err) => {
        logger.warn({ err, category, address: target.address }, "Nearby amenities: Overpass fallback failed");
        return [];
      });
    }

    results = dedupeNearbyResults(results)
      .sort((a, b) => (a.distanceMeters ?? Number.POSITIVE_INFINITY) - (b.distanceMeters ?? Number.POSITIVE_INFINITY))
      .slice(0, maxPerCategory);

    if (options.includeDriveTimes) {
      results = await enrichDriveTimes(target, results);
    }

    nearbyCache.set(cacheKey, { results, expiresAt: Date.now() + nearbyCacheTtlMs() });
    all.push(...results);
  }

  return all;
}

export function reportSchoolZonesToAmenityResults(zones: ReportSchoolZoneSummary[]): NearbyAmenityResult[] {
  return zones.map((zone) => ({
    category: "school",
    name: zone.name,
    address: null,
    lat: null,
    lng: null,
    distanceMeters: null,
    driveDistanceMeters: null,
    driveDurationMinutes: null,
    source: "report_school_zones",
    notes: [
      zone.level,
      zone.yearLevels,
      zone.authority,
      zone.enrolmentScheme ? `scheme: ${zone.enrolmentScheme}` : null,
    ].filter(Boolean).join("; ") || null,
  }));
}

export function renderNearbyAmenitiesAnswer(args: {
  target: NearbyAmenityTarget;
  request: NearbyAmenityRequest;
  results: NearbyAmenityResult[];
  searchedLiveAmenities: boolean;
}): string {
  const { target, request, results } = args;
  const labels = readableCategoryList(request.categories);
  if (results.length === 0) {
    return [
      `I could not find matching nearby ${labels || "amenities"} around ${target.address}.`,
      "Try a wider radius or a more specific amenity name.",
    ].join("\n\n");
  }

  const lines: string[] = [];
  lines.push(`Nearby ${labels || "amenities"} for ${target.address}:`);
  lines.push("");
  lines.push("| Type | Name | Distance | Notes | Address |");
  lines.push("|---|---|---:|---|---|");
  for (const result of results) {
    lines.push(
      [
        tableCell(result.source === "report_school_zones" ? "School zone" : CATEGORY_CONFIG[result.category].label),
        tableCell(result.name),
        tableCell(formatDistance(result)),
        tableCell(result.notes ?? ""),
        tableCell(result.address ?? ""),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("These are context amenities only and are not included in the development score.");
  return lines.join("\n");
}

async function fetchGooglePlaces(
  target: NearbyAmenityTarget,
  category: AmenityCategory,
  rawTerms: string[],
  apiKey: string,
): Promise<NearbyAmenityResult[]> {
  const config = CATEGORY_CONFIG[category];
  if (category !== "unknown" && config.googleTypes.length > 0) {
    const nearby = await fetchGoogleNearbyByTypes(target, category, config.googleTypes, config.radiusMeters, apiKey);
    if (nearby.length > 0) return nearby;
  }

  const textQueries = category === "unknown"
    ? rawTerms.filter((term) => term.toLowerCase() !== "amenities")
    : config.textQueries;
  const results: NearbyAmenityResult[] = [];
  for (const query of textQueries.slice(0, 3)) {
    const textResults = await fetchGoogleTextSearch(target, category, query, config.radiusMeters, apiKey);
    results.push(...textResults);
    if (results.length >= 5) break;
  }
  return results;
}

async function fetchGoogleNearbyByTypes(
  target: NearbyAmenityTarget,
  category: AmenityCategory,
  includedTypes: string[],
  radiusMeters: number,
  apiKey: string,
): Promise<NearbyAmenityResult[]> {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: googlePlacesHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      includedTypes,
      maxResultCount: 8,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: {
          center: { latitude: target.lat, longitude: target.lng },
          radius: radiusMeters,
        },
      },
      languageCode: "en",
      regionCode: "NZ",
    }),
  });
  if (!resp.ok) throw new Error(`Google Places nearby HTTP ${resp.status}`);
  const data = await resp.json() as GooglePlacesResponse;
  return googlePlacesToResults(data, target, category, "google_places");
}

async function fetchGoogleTextSearch(
  target: NearbyAmenityTarget,
  category: AmenityCategory,
  query: string,
  radiusMeters: number,
  apiKey: string,
): Promise<NearbyAmenityResult[]> {
  const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: googlePlacesHeaders(apiKey),
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      textQuery: `${query} near ${target.address}`,
      maxResultCount: 8,
      locationBias: {
        circle: {
          center: { latitude: target.lat, longitude: target.lng },
          radius: radiusMeters,
        },
      },
      languageCode: "en",
      regionCode: "NZ",
    }),
  });
  if (!resp.ok) throw new Error(`Google Places text HTTP ${resp.status}`);
  const data = await resp.json() as GooglePlacesResponse;
  return googlePlacesToResults(data, target, category, "google_text_search");
}

function googlePlacesHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types",
  };
}

interface GooglePlacesResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
  }>;
}

function googlePlacesToResults(
  data: GooglePlacesResponse,
  target: NearbyAmenityTarget,
  category: AmenityCategory,
  source: Extract<NearbyAmenitySource, "google_places" | "google_text_search">,
): NearbyAmenityResult[] {
  return (data.places ?? [])
    .map((place): NearbyAmenityResult | null => {
      const name = place.displayName?.text?.trim();
      if (!name) return null;
      const lat = numberOrNull(place.location?.latitude);
      const lng = numberOrNull(place.location?.longitude);
      return {
        category,
        name,
        address: place.formattedAddress?.trim() || null,
        lat,
        lng,
        distanceMeters: lat != null && lng != null ? haversineMeters(target.lat, target.lng, lat, lng) : null,
        driveDistanceMeters: null,
        driveDurationMinutes: null,
        source,
      };
    })
    .filter((result): result is NearbyAmenityResult => result !== null);
}

async function fetchOverpassAmenities(target: NearbyAmenityTarget, category: AmenityCategory): Promise<NearbyAmenityResult[]> {
  const config = CATEGORY_CONFIG[category];
  if (config.osmTags.length === 0) return [];
  const clauses = config.osmTags.flatMap(([key, value]) => [
    `node["${key}"="${value}"](around:${config.radiusMeters},${target.lat},${target.lng});`,
    `way["${key}"="${value}"](around:${config.radiusMeters},${target.lat},${target.lng});`,
    `relation["${key}"="${value}"](around:${config.radiusMeters},${target.lat},${target.lng});`,
  ]);
  const query = `[out:json][timeout:8];(${clauses.join("")});out center tags 20;`;
  const resp = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
  const data = await resp.json() as {
    elements?: Array<{
      lat?: number;
      lon?: number;
      center?: { lat?: number; lon?: number };
      tags?: Record<string, string>;
    }>;
  };
  return (data.elements ?? [])
    .map((element): NearbyAmenityResult | null => {
      const name = element.tags?.name?.trim();
      if (!name) return null;
      const lat = numberOrNull(element.lat ?? element.center?.lat);
      const lng = numberOrNull(element.lon ?? element.center?.lon);
      return {
        category,
        name,
        address: element.tags?.["addr:full"] ?? ([
          element.tags?.["addr:housenumber"],
          element.tags?.["addr:street"],
          element.tags?.["addr:suburb"],
        ].filter(Boolean).join(" ") || null),
        lat,
        lng,
        distanceMeters: lat != null && lng != null ? haversineMeters(target.lat, target.lng, lat, lng) : null,
        driveDistanceMeters: null,
        driveDurationMinutes: null,
        source: "osm_overpass",
      };
    })
    .filter((result): result is NearbyAmenityResult => result !== null);
}

async function enrichDriveTimes(target: NearbyAmenityTarget, results: NearbyAmenityResult[]): Promise<NearbyAmenityResult[]> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"]?.trim();
  const limit = Number(process.env["NEARBY_AMENITIES_DRIVE_TIME_LIMIT"] ?? 0);
  if (!apiKey || !Number.isFinite(limit) || limit <= 0) return results;

  const out = [...results];
  let enriched = 0;
  for (let i = 0; i < out.length && enriched < limit; i++) {
    const result = out[i]!;
    if (result.lat == null || result.lng == null) continue;
    const route = await fetchDriveRoute(target, result, apiKey).catch(() => null);
    if (route) {
      out[i] = {
        ...result,
        driveDistanceMeters: route.distanceMeters,
        driveDurationMinutes: route.durationMinutes,
      };
      enriched += 1;
    }
  }
  return out;
}

async function fetchDriveRoute(
  target: NearbyAmenityTarget,
  result: NearbyAmenityResult,
  apiKey: string,
): Promise<{ distanceMeters: number | null; durationMinutes: number | null } | null> {
  if (result.lat == null || result.lng == null) return null;
  const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: target.lat, longitude: target.lng } } },
      destination: { location: { latLng: { latitude: result.lat, longitude: result.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      languageCode: "en-NZ",
      units: "METRIC",
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json() as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
  const route = data.routes?.[0];
  if (!route) return null;
  return {
    distanceMeters: numberOrNull(route.distanceMeters),
    durationMinutes: durationSeconds(route.duration) != null ? Math.round(durationSeconds(route.duration)! / 60) : null,
  };
}

function formatDistance(result: NearbyAmenityResult): string {
  if (result.source === "report_school_zones") return "In zone";
  const drive = result.driveDistanceMeters != null
    ? `${formatMeters(result.driveDistanceMeters)} drive${result.driveDurationMinutes != null ? ` / ${result.driveDurationMinutes} min` : ""}`
    : null;
  if (drive) return drive;
  return result.distanceMeters != null ? formatMeters(result.distanceMeters) : "";
}

function formatMeters(value: number): string {
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} km`;
}

function readableCategoryList(categories: AmenityCategory[]): string {
  const labels = unique(categories.filter((c) => c !== "unknown").map((c) => CATEGORY_CONFIG[c].label.toLowerCase()));
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function dedupeNearbyResults(results: NearbyAmenityResult[]): NearbyAmenityResult[] {
  const seen = new Set<string>();
  const out: NearbyAmenityResult[] = [];
  for (const result of results) {
    const key = [result.category, result.name, result.address ?? ""]
      .join("|")
      .toLowerCase()
      .replace(/[^a-z0-9|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(result);
  }
  return out;
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "-";
}

function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earth = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function durationSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

function placesApiKey(): string | null {
  return process.env["GOOGLE_PLACES_API_KEY"]?.trim() || process.env["GOOGLE_MAPS_API_KEY"]?.trim() || null;
}

function nearbyCacheTtlMs(): number {
  const raw = Number(process.env["NEARBY_AMENITIES_CACHE_TTL_MS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 7 * 24 * 60 * 60_000;
}

function nearbyCacheKey(target: NearbyAmenityTarget, category: AmenityCategory, terms: string[], radius: number): string {
  return [
    target.lat.toFixed(4),
    target.lng.toFixed(4),
    category,
    radius,
    terms.map((term) => term.toLowerCase().trim()).sort().join(","),
  ].join("|");
}

const nearbyCache = new Map<string, { results: NearbyAmenityResult[]; expiresAt: number }>();

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
