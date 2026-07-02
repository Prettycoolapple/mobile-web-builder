import type { RawPropertyData } from "./pipeline";

/**
 * Single-property data lookups (Q4): answer "what's the estimated market value /
 * land area / zone of this property?" instantly from the cached analysis of the
 * OPEN report — no full re-run — with the source and data age. Pure + db-free so
 * it is unit-testable; the caller resolves the cache row and passes raw_data in.
 */

export type PropertyDataField = "value" | "land_area" | "zone";

const ZONE_EN = /\b(what|which)\b.*\bzon(e|ing|ed)\b|\bzoning\b|\bzone is\b|planning zone/i;
const ZONE_ZH = /什么区|哪个?区划|区划是?|规划分?区|分区是/;
const LAND_EN = /\bland (area|size)\b|\bsection size\b|\blot size\b|how (big|large)[^?]*\b(land|section|site)\b|\bsqm\b|\bm2\b|\bm²\b/i;
const LAND_ZH = /地块面积|土地面积|占地面积|地皮.*面积|多大.*地|地有多大|占地/;
const VALUE_EN = /\bmarket value\b|\bestimated value\b|\bvaluation\b|\bcapital value\b|\bcv\b|worth\b|how much.*(worth|value)|value of this/i;
const VALUE_ZH = /估值|市值|市场价值?|资本价值|政府估价|值多少|(这|该)(个|套|栋|處|处)?(房|房子|物业|房产).*(值|价)/;

/** Classify a followup as a specific cached-data lookup, else null. */
export function detectPropertyDataLookup(text: string): PropertyDataField | null {
  if (ZONE_EN.test(text) || ZONE_ZH.test(text)) return "zone";
  if (LAND_EN.test(text) || LAND_ZH.test(text)) return "land_area";
  if (VALUE_EN.test(text) || VALUE_ZH.test(text)) return "value";
  return null;
}

function fmtNzd(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-NZ");
}

function ageText(ageDays: number, zh: boolean): string {
  if (ageDays <= 1) return zh ? "今天" : "today";
  if (ageDays < 31) return zh ? `${ageDays} 天前` : `${ageDays} days ago`;
  const months = Math.max(1, Math.round(ageDays / 30));
  return zh ? `约 ${months} 个月前` : `about ${months} month${months === 1 ? "" : "s"} ago`;
}

/** Highest-priority capital value across the cached sources, with its label. */
function pickCv(raw: RawPropertyData, zh: boolean): { cv: number; source: string; year: number | null } | null {
  const candidates: Array<{ cv: number | null | undefined; year: number | null | undefined; source: string }> = [
    { cv: raw.propertyValue?.cv_nzd, year: raw.propertyValue?.cv_year, source: zh ? "政府估价" : "council valuation" },
    { cv: raw.qv?.cv_nzd, year: null, source: "QV" },
    { cv: raw.property_history?.cv_nzd, year: null, source: zh ? "房产记录" : "property records" },
    { cv: raw.oneroof?.cv_nzd, year: null, source: "OneRoof" },
    { cv: raw.homes?.cv_nzd, year: null, source: "Homes.co.nz" },
    { cv: raw.hougarden?.cv_nzd, year: null, source: "Hougarden" },
  ];
  for (const c of candidates) {
    if (typeof c.cv === "number" && c.cv > 0) return { cv: c.cv, source: c.source, year: c.year ?? null };
  }
  return null;
}

function pickLandArea(raw: RawPropertyData): number | null {
  const a =
    raw.derived_scores?.landArea ??
    raw.propertyValue?.land_area_sqm ??
    raw.qv?.land_area_sqm ??
    raw.homes?.land_area_sqm ??
    raw.hougarden?.land_area_sqm ??
    null;
  return typeof a === "number" && a > 0 ? a : null;
}

/**
 * Compose the answer from cached raw_data. Returns null when the requested datum
 * isn't cached (caller then falls through to the normal chat reply, which can run
 * the pipeline and self-heal). Always labels source + data age; never asserts a
 * precise "market value" we don't have (CV is the recorded valuation).
 */
export function buildPropertyDataLookupAnswer(
  field: PropertyDataField,
  raw: RawPropertyData,
  ageDays: number,
  address: string,
  locale: string,
): string | null {
  const zh = locale === "zh";
  const asOf = ageText(ageDays, zh);

  if (field === "value") {
    const cv = pickCv(raw, zh);
    if (!cv) return null;
    const yr = cv.year ? (zh ? `（${cv.year}年）` : ` (${cv.year})`) : "";
    if (zh) {
      return `${address} 记录在案的资本价值（CV，来自${cv.source}${yr}）为 ${fmtNzd(cv.cv)}。这是估价记录，并非实时市场评估——运行完整分析可获得基于成交对比的市场估值。（数据更新于${asOf}。）`;
    }
    return `The recorded capital (rating) value for ${address} is ${fmtNzd(cv.cv)} (${cv.source}${yr}). That's a valuation on record, not a live market appraisal — run the full analysis for a comparable-sales market estimate. (Data as of ${asOf}.)`;
  }

  if (field === "land_area") {
    const area = pickLandArea(raw);
    if (area == null) return null;
    if (zh) return `${address} 的土地面积约为 ${Math.round(area)} 平方米。（数据更新于${asOf}。）`;
    return `${address} has a land area of about ${Math.round(area)} m². (Data as of ${asOf}.)`;
  }

  // zone
  const zone = raw.derived_scores?.zone ?? null;
  if (!zone) return null;
  if (zh) return `${address} 的规划分区为 ${zone}。（数据更新于${asOf}。）`;
  return `${address} is zoned ${zone}. (Data as of ${asOf}.)`;
}
