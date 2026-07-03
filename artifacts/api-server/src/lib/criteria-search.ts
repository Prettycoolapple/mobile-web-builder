import type { PropertyCandidate } from "./pre-screen";
import type { SearchFilterSpec } from "./claude";
import type { PropertyFeatureIndexRow } from "@workspace/db";
import { searchFeatureIndex, type FeatureSearchFilter } from "./property-feature-index";
import { getCachedRaw } from "./property-cache";
import { normaliseDiscoveryAddressKey } from "./address-key";
import { SCORING_VERSION } from "./card-score";

/**
 * Orchestrates "reverse engineering" criteria search: turn a structured
 * SearchFilterSpec into matches over the analysed-property feature index, then
 * hydrate each surfaced card's full scores from the property cache. Deliberately
 * surfaced ONE card at a time (see the caller's page size) to pace the ask.
 *
 * Index tier only, for now: terrain/pipe/ROI criteria are answerable ONLY from
 * measured cached data, so every returned candidate is a genuine, verified match
 * — never an LLM guess. The live-market tier (cheap lot/price screening of
 * on-market listings) and the live price/photo cross-check are follow-up seams
 * marked below.
 */

export interface CriteriaCandidate extends PropertyCandidate {
  /** Where this match came from — cache (measured) vs a live listing screen. */
  provenance: "analyzed_cache" | "live_market";
  /** ISO date this property was last analysed (cache freshness for the caveat). */
  lastAnalyzedAt?: string | null;
  /** Which criteria are *verified* (measured) vs merely modelled, per attribute. */
  criteriaMatch?: {
    slope?: "verified" | "unverified";
    servicesOnParcel?: "verified" | "unverified";
    lots?: "verified" | "modelled";
  };
}

export interface CriteriaSearchResult {
  candidates: CriteriaCandidate[];
  coverage: {
    /** True when more analysed matches remain past this page. */
    hasMore: boolean;
    /** The scope actually searched. */
    scope: SearchFilterSpec["searchScope"];
  };
}

function specToFilter(spec: SearchFilterSpec, suburbs: string[]): FeatureSearchFilter {
  return {
    suburbs,
    minPotentialLots: spec.minPotentialLots,
    maxSlopeDegrees: spec.maxSlopeDegrees,
    servicesOnParcel: spec.infrastructureOnParcel,
    minRoiPct: spec.minRoiPct,
    // No separate region gate needed: the pipeline already nulls out
    // zone/lots/ROI at the source for any property whose region isn't
    // properly modelled (regional-rules.ts), so those rows can never satisfy
    // the numeric predicates above regardless of which region they're in.
    // Score/lot/ROI constraints must exclude stale-formula rows.
    minScoringVersion: SCORING_VERSION,
  };
}

/** Hydrate a matched index row into a full candidate card (1 cache read). */
async function hydrateCandidate(
  row: PropertyFeatureIndexRow,
  spec: SearchFilterSpec,
): Promise<CriteriaCandidate | null> {
  const address = row.formattedAddress?.trim();
  if (!address) return null;

  const cached = await getCachedRaw(row.addressKey);
  const ds = cached?.rawData.derived_scores ?? null;
  const s = ds?.scores ?? null;

  const lastRefreshed = row.lastRefreshedAt ? new Date(row.lastRefreshedAt) : null;

  return {
    address,
    // Current price/photo come from a live listing cross-check (follow-up seam),
    // never the cache — listing price is volatile and intentionally not stored.
    price: 0,
    priceIsPlaceholder: true,
    priceDisplay: "Run full analysis for current pricing",
    landArea: row.landAreaSqm ?? ds?.landArea ?? undefined,
    zone: row.zoneCode ?? ds?.zone ?? undefined,
    scores: {
      ease: s?.ease ?? 0,
      cost: s?.cost ?? 0,
      roi: s?.roi ?? 0,
      composite: s?.composite ?? row.scoreComposite ?? 0,
    },
    potentialLots: row.potentialLots ?? ds?.potentialLots ?? undefined,
    standardVacantLots: row.standardVacantLots ?? ds?.standardVacantLots ?? undefined,
    minLotSize: row.minLotSizeSqm ?? ds?.minLotSize ?? undefined,
    titleType: row.estateType ?? undefined,
    screeningStatus: "verified",
    provenance: "analyzed_cache",
    lastAnalyzedAt: lastRefreshed ? lastRefreshed.toISOString() : null,
    criteriaMatch: {
      // Terrain and services are MEASURED — safe to mark verified.
      slope: spec.maxSlopeDegrees != null ? "verified" : undefined,
      servicesOnParcel: spec.infrastructureOnParcel.length > 0 ? "verified" : undefined,
      // Lot yield is modelled from area + zone, not surveyed.
      lots: spec.minPotentialLots != null ? "modelled" : undefined,
    },
  };
}

/**
 * Run a criteria search over analysed properties. Pagination is by SHOWN-MEMORY,
 * not offset: `excludeDiscoveryKeys` carries the normalised keys of cards already
 * shown to this user, so each "show me another" surfaces the next unshown match
 * (the caller records the shown card into the same 30-day shown memory the rest
 * of discovery uses). `pageSize` is 1 for the deliberate one-card-at-a-time pace.
 */
export async function runCriteriaSearch(
  spec: SearchFilterSpec,
  opts: { suburbs: string[]; pageSize: number; excludeDiscoveryKeys?: Set<string> },
): Promise<CriteriaSearchResult> {
  const filter = specToFilter(spec, opts.suburbs);
  const excluded = opts.excludeDiscoveryKeys ?? new Set<string>();
  // Window big enough to skip already-shown rows and still fill the page + a
  // lookahead for hasMore.
  const window = opts.pageSize + excluded.size + 1;
  const rows = await searchFeatureIndex(filter, { limit: window, offset: 0 });

  const unshown: PropertyFeatureIndexRow[] = [];
  for (const row of rows) {
    const addr = row.formattedAddress?.trim();
    if (!addr) continue;
    if (excluded.has(normaliseDiscoveryAddressKey(addr))) continue;
    unshown.push(row);
  }

  const hasMore = unshown.length > opts.pageSize;
  const pageRows = unshown.slice(0, opts.pageSize);

  const candidates: CriteriaCandidate[] = [];
  for (const row of pageRows) {
    const cand = await hydrateCandidate(row, spec);
    if (cand) candidates.push(cand);
  }

  return {
    candidates,
    coverage: {
      hasMore,
      scope: spec.searchScope,
    },
  };
}

function titleCaseSuburbLabel(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function matchedAttrs(spec: SearchFilterSpec, card: CriteriaCandidate, zh: boolean): string {
  const parts: string[] = [];
  if (spec.minPotentialLots != null) {
    const n = card.potentialLots ?? spec.minPotentialLots;
    parts.push(zh ? `可分成约 ${n} 块（估算）` : `models to ~${n} lots`);
  }
  if (spec.maxSlopeDegrees != null) parts.push(zh ? "地势平缓（已核实）" : "gentle/flat terrain (verified)");
  if (spec.infrastructureOnParcel.length > 0) parts.push(zh ? "雨污水管在地块内（已核实）" : "storm & sewer on the parcel (verified)");
  if (spec.minRoiPct != null) parts.push(zh ? `估算回报 ≥ ${spec.minRoiPct}%` : `modelled return ≥ ${spec.minRoiPct}%`);
  return parts.join(zh ? "；" : "; ");
}

/**
 * Intro that MATCHES the card shown — honest about pacing (one at a time) and
 * non-exhaustiveness, WITHOUT revealing the retrieval mechanism (cache/index vs
 * live) to the user. Keep this framing generic: "here's a match", not "here's
 * an analysed/cached property".
 */
export function buildCriteriaSearchIntro(
  spec: SearchFilterSpec,
  card: CriteriaCandidate,
  coverage: CriteriaSearchResult["coverage"],
  suburb: string | null,
  locale: string,
): string {
  const zh = locale === "zh";
  const area = suburb ? titleCaseSuburbLabel(suburb) : zh ? "该区域" : "the area";
  const attrs = matchedAttrs(spec, card, zh);
  const more = coverage.hasMore ? (zh ? "想看下一个就说“换一个”。" : " Say “show me another” for the next one.") : "";
  if (zh) {
    return `在${area}找到一处符合条件的房产：${attrs}。为了让您逐一仔细查看，我每次只展示一个。运行完整分析可确认细节和当前价格。${more}`;
  }
  return `Found a match in ${area}: ${attrs}. I show one at a time so you can review each properly. Run the full analysis to confirm details and current pricing.${more}`;
}

/**
 * Honest "no match yet" message. Generic framing — never mentions
 * cache/index/analysed-properties, and never singles out a region: regional
 * coverage varies by property (regional-rules.ts), not by a fixed area list.
 */
export function buildCriteriaSearchEmptyMessage(suburb: string | null, locale: string): string {
  const zh = locale === "zh";
  const area = suburb ? titleCaseSuburbLabel(suburb) : zh ? "该区域" : "that area";
  if (zh) {
    return `暂时没有在${area}找到完全符合这些条件的房产。可以试试放宽条件，或换个区域，我也会持续更新可选房源。`;
  }
  return `I couldn't find a property in ${area} matching all of those criteria right now. Try broadening the criteria or the area — I'll keep more options coming as they become available.`;
}
