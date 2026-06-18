import { logger } from "./logger";
import type { SchoolZoneGisHit, SchoolZoneLevel } from "./school-zones-gis";

/** MoE Schools Directory on data.govt.nz (CKAN datastore). */
const CKAN_DATASTORE_SEARCH = "https://catalogue.data.govt.nz/api/3/action/datastore_search";
const SCHOOLS_RESOURCE_ID = "4b292323-9fcc-41f8-814b-3c7b19cf14b3";

export type SchoolAuthorityCategory = "public" | "state_integrated" | "private" | "unknown";

export interface SchoolZoneDetail {
  level: SchoolZoneLevel;
  /** Text from listing/Hougarden used as the search query. */
  sourceLabel: string;
  /** Official name from MoE directory when matched. */
  orgName: string | null;
  orgType: string | null;
  authority: string | null;
  authorityCategory: SchoolAuthorityCategory;
  /** Schooling Equity Index (EQI) — replaces deciles for funding; lower ≈ higher barriers. */
  equityIndex: string | null;
  enrolmentScheme: string | null;
  roll: number | null;
  matched: boolean;
  /** MoE Institution_type for the zoned school (e.g. "Contributing", "Secondary (Year 9-15)"). */
  institutionType?: string | null;
  /** Human year-range label, e.g. "Years 1–6". */
  yearLevels?: string | null;
}

type CkanRecord = Record<string, unknown>;

function authorityCategory(raw: string | null | undefined): SchoolAuthorityCategory {
  if (!raw?.trim()) return "unknown";
  const a = raw.trim().toLowerCase();
  if (a === "state") return "public";
  if (a.includes("integrated")) return "state_integrated";
  if (a.includes("private")) return "private";
  return "unknown";
}

const searchCache = new Map<string, CkanRecord | null>();

function normaliseSchoolName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bst[.]?\b/g, "saint")
    .replace(/\bmt[.]?\b/g, "mount")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|school|college|intermediate|primary)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSchoolSearchQueries(query: string): string[] {
  const q = query.trim().replace(/\s+/g, " ");
  const variants = [
    q,
    q.replace(/\bSt[.]?\b/gi, "Saint"),
    q.replace(/\bSaint\b/gi, "St"),
    q.replace(/\bMt[.]?\b/gi, "Mount"),
    q.replace(/\bMount\b/gi, "Mt"),
    q.replace(/\bSchool\b/gi, "").trim(),
    q.replace(/\bCollege\b/gi, "").trim(),
    normaliseSchoolName(q),
  ];
  return [...new Set(variants.filter((v) => v.length >= 2))];
}

function schoolMatchScore(query: string, rec: CkanRecord): number {
  const orgName = String(rec.Org_Name ?? "").trim();
  if (!orgName) return -1;
  const q = normaliseSchoolName(query);
  const name = normaliseSchoolName(orgName);
  if (!q || !name) return -1;

  let score = 0;
  if (q === name) score += 100;
  if (name.startsWith(q) || q.startsWith(name)) score += 45;
  if (name.includes(q) || q.includes(name)) score += 35;

  const qTokens = new Set(q.split(" ").filter((t) => t.length > 1));
  const nameTokens = new Set(name.split(" ").filter((t) => t.length > 1));
  let overlap = 0;
  for (const token of qTokens) {
    if (nameTokens.has(token)) overlap++;
  }
  score += overlap * 12;

  const status = String(rec.Status ?? "").toLowerCase();
  if (status === "open") score += 10;
  const authority = String(rec.Authority ?? "").toLowerCase();
  if (authority === "state") score += 5;
  if (authority.includes("integrated")) score += 3;
  if (authority.includes("private")) score -= 3;
  return score;
}

async function fetchSchoolRecords(query: string): Promise<CkanRecord[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url = `${CKAN_DATASTORE_SEARCH}?resource_id=${encodeURIComponent(SCHOOLS_RESOURCE_ID)}&limit=10&q=${encodeURIComponent(q)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ProjectAlphaNZ/1.0 (school zone enrichment)",
      },
      signal: AbortSignal.timeout(14_000),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "school-directory: CKAN HTTP error");
      return [];
    }
    const json = (await resp.json()) as { success?: boolean; result?: { records?: CkanRecord[] } };
    if (!json.success || !json.result?.records?.length) {
      return [];
    }
    return json.result.records;
  } catch (err) {
    logger.warn({ err: (err as Error).message, query: q }, "school-directory: fetch failed");
    return [];
  }
}

async function searchSchoolRecord(query: string): Promise<CkanRecord | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const cacheKey = normaliseSchoolName(q);
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey) ?? null;

  const seen = new Set<string>();
  const candidates: CkanRecord[] = [];
  for (const variant of buildSchoolSearchQueries(q)) {
    const records = await fetchSchoolRecords(variant);
    for (const rec of records) {
      const orgName = String(rec.Org_Name ?? "").trim();
      const key = normaliseSchoolName(orgName);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push(rec);
    }
  }

  if (candidates.length === 0) {
    searchCache.set(cacheKey, null);
    return null;
  }

  const ranked = candidates
    .map((rec) => ({ rec, score: schoolMatchScore(q, rec) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (Number(b.rec.rank) || 0) - (Number(a.rec.rank) || 0);
    });
  const best = ranked[0];
  const result = best && best.score >= 20 ? best.rec : null;
  searchCache.set(cacheKey, result);
  return result;
}

function detailFromRecord(level: SchoolZoneDetail["level"], label: string, rec: CkanRecord | null): SchoolZoneDetail {
  if (!rec) {
    return {
      level,
      sourceLabel: label,
      orgName: null,
      orgType: null,
      authority: null,
      authorityCategory: "unknown",
      equityIndex: null,
      enrolmentScheme: null,
      roll: null,
      matched: false,
    };
  }
  const auth = String(rec.Authority ?? "").trim() || null;
  const rollRaw = rec.Total;
  const roll =
    rollRaw != null && rollRaw !== "" && !Number.isNaN(Number(rollRaw)) ? Math.round(Number(rollRaw)) : null;
  return {
    level,
    sourceLabel: label,
    orgName: String(rec.Org_Name ?? "").trim() || null,
    orgType: String(rec.Org_Type ?? "").trim() || null,
    authority: auth,
    authorityCategory: authorityCategory(auth ?? undefined),
    equityIndex: String(rec.EQi_Index ?? "").trim() || null,
    enrolmentScheme: String(rec.Enrolment_Scheme ?? "").trim() || null,
    roll,
    matched: true,
  };
}

const byIdCache = new Map<number, CkanRecord | null>();

/** Exact lookup by MoE school number (School_Id) — precise join for GIS zone hits. */
async function searchSchoolRecordById(schoolId: number): Promise<CkanRecord | null> {
  if (!Number.isFinite(schoolId)) return null;
  if (byIdCache.has(schoolId)) return byIdCache.get(schoolId) ?? null;

  const filters = encodeURIComponent(JSON.stringify({ School_Id: schoolId }));
  const url = `${CKAN_DATASTORE_SEARCH}?resource_id=${encodeURIComponent(SCHOOLS_RESOURCE_ID)}&limit=1&filters=${filters}`;
  let rec: CkanRecord | null = null;
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ProjectAlphaNZ/1.0 (school zone enrichment)" },
      signal: AbortSignal.timeout(14_000),
    });
    if (resp.ok) {
      const json = (await resp.json()) as { success?: boolean; result?: { records?: CkanRecord[] } };
      const found = json.success ? json.result?.records?.[0] ?? null : null;
      // Confirm the id matches (a filter on a text column can be lenient).
      rec = found && String(found.School_Id ?? "").trim() === String(schoolId) ? found : null;
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, schoolId }, "school-directory: by-id fetch failed");
  }
  byIdCache.set(schoolId, rec);
  return rec;
}

function detailFromGisHit(hit: SchoolZoneGisHit, rec: CkanRecord | null): SchoolZoneDetail {
  const base = detailFromRecord(hit.level, hit.schoolName, rec);
  return {
    ...base,
    // Always prefer the authoritative GIS zone name; keep directory enrichment fields.
    orgName: base.matched && base.orgName ? base.orgName : hit.schoolName,
    institutionType: hit.institutionType,
    yearLevels: hit.yearLevels,
  };
}

/**
 * Enriches official MoE enrolment-zone hits (from the GIS point-in-polygon query)
 * with Schools Directory fields (authority, EQI, roll, enrolment scheme). Joins by
 * School_Id first, falling back to a name search. Enrichment is additive — an
 * unmatched school still displays with its authoritative GIS name.
 */
export async function enrichSchoolZonesFromGis(
  hits: SchoolZoneGisHit[],
  timing?: Record<string, number>,
): Promise<SchoolZoneDetail[]> {
  const start = Date.now();
  const results = await Promise.all(
    hits.map(async (hit) => {
      let rec: CkanRecord | null = null;
      if (hit.schoolId != null) rec = await searchSchoolRecordById(hit.schoolId);
      if (!rec) rec = await searchSchoolRecord(hit.schoolName);
      return detailFromGisHit(hit, rec);
    }),
  );
  if (timing) timing["school_directory_ms"] = Date.now() - start;
  return results;
}

