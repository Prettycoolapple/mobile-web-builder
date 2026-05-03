import { logger } from "./logger";

/** MoE Schools Directory on data.govt.nz (CKAN datastore). */
const CKAN_DATASTORE_SEARCH = "https://catalogue.data.govt.nz/api/3/action/datastore_search";
const SCHOOLS_RESOURCE_ID = "4b292323-9fcc-41f8-814b-3c7b19cf14b3";

export type SchoolAuthorityCategory = "public" | "state_integrated" | "private" | "unknown";

export interface SchoolZoneDetail {
  level: "primary" | "intermediate" | "secondary";
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

async function searchSchoolRecord(query: string): Promise<CkanRecord | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const cacheKey = q.toLowerCase();
  if (searchCache.has(cacheKey)) return searchCache.get(cacheKey) ?? null;

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
      searchCache.set(cacheKey, null);
      return null;
    }
    const json = (await resp.json()) as { success?: boolean; result?: { records?: CkanRecord[] } };
    if (!json.success || !json.result?.records?.length) {
      searchCache.set(cacheKey, null);
      return null;
    }
    const open = json.result.records.filter((r) => String(r.Status ?? "").toLowerCase() === "open");
    const pool = open.length > 0 ? open : json.result.records;
    pool.sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0));
    const best = pool[0];
    searchCache.set(cacheKey, best);
    return best;
  } catch (err) {
    logger.warn({ err: (err as Error).message, query: q }, "school-directory: fetch failed");
    searchCache.set(cacheKey, null);
    return null;
  }
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

/**
 * Enriches Hougarden-extracted zone school names with MoE Schools Directory fields.
 * Runs up to three CKAN searches (parallel). Results are cached in-memory for the process lifetime.
 */
export async function enrichSchoolZonesDetail(
  school_zones: { primary: string | null; intermediate: string | null; secondary: string | null },
  timing?: Record<string, number>,
): Promise<SchoolZoneDetail[]> {
  const start = Date.now();
  const jobs: Array<{ level: SchoolZoneDetail["level"]; label: string }> = [];
  if (school_zones.primary?.trim()) jobs.push({ level: "primary", label: school_zones.primary.trim() });
  if (school_zones.intermediate?.trim()) jobs.push({ level: "intermediate", label: school_zones.intermediate.trim() });
  if (school_zones.secondary?.trim()) jobs.push({ level: "secondary", label: school_zones.secondary.trim() });

  const results = await Promise.all(
    jobs.map(async ({ level, label }) => {
      const rec = await searchSchoolRecord(label);
      return detailFromRecord(level, label, rec);
    }),
  );

  if (timing) timing["school_directory_ms"] = Date.now() - start;
  return results;
}
