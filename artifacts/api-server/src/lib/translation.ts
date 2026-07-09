import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import type { Locale } from "./prompts";
import { terrainSlopeText, type TerrainContour } from "./terrain-slope-copy";
import { isIntensityProgrammeCopyEn } from "./intensity-programme-copy";
import { formatTitleTypeForDisplay } from "./titleDisplay";
import {
  canonicalBuildYearFromReport,
  isIncompleteDataDisclaimerRiskBullet,
  sanitizeReportScoresReasons,
} from "./risk-summary";

// ─── Chinese detection ───────────────────────────────────────────────────────
// A string is considered "already Chinese" if CJK codepoints make up at least
// ~30% of the non-whitespace characters. This threshold keeps us from running
// a full LLM translation call on output that is already predominantly zh
// while still catching English text that slipped through the language prompt.
const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const CJK_GLOBAL_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/g;

export function containsChinese(text: string): boolean {
  if (!text) return false;
  return CJK_RE.test(text);
}

export function isPredominantlyChinese(text: string, threshold = 0.3): boolean {
  if (!text) return false;
  const stripped = text.replace(/\s+/g, "");
  if (stripped.length === 0) return false;
  const cjk = (stripped.match(CJK_GLOBAL_RE) ?? []).length;
  return cjk / stripped.length >= threshold;
}

function isBadTranslationOutput(source: string, translated: string): boolean {
  const out = translated.trim();
  if (!out) return true;
  if (/无法执行这个请求|请提供需要翻译|不能执行该请求|无法翻译|provide.*english/i.test(out)) return true;
  if (!containsChinese(source) && !containsChinese(out)) return true;
  return false;
}

// ─── Translation call (DeepSeek chat — low latency) ───────────────────────────
// Strict translation prompt: preserve entities, numbers, JSON shapes, currency,
// addresses and enum values. Translate natural-language prose only.
const TRANSLATION_SYSTEM = `You are a precise English → Simplified Chinese (简体中文) translator for a New Zealand real estate feasibility app.

Rules:
- Translate natural-language English prose into fluent Simplified Chinese.
- Preserve ALL numbers, dates (YYYY-MM-DD), NZD currency amounts (including $, commas), units (m², %), percentages, and URLs exactly as they appear.
- Preserve NZ place names, street addresses, zone codes (SHZ, MHS, MHU, THAB, Business), and technical enum values ("low", "high", "moderate", "clear", "restricted", "flat", "gentle", "steep", "on-parcel", "boundary", "live", "estimated") as-is.
- For zone full names and overlay names used in prose: keep the English term, then add a Simplified Chinese translation in parentheses on first mention, e.g. "Mixed Housing Suburban (混合住房郊区区)".
- Preserve markdown formatting (bold, bullets, links, headings) exactly.
- Output ONLY the translated text. No preface, no explanation, no quotes around the output.`;

export async function translateToChinese(text: string): Promise<string> {
  if (!text) return text;
  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        systemInstruction: TRANSLATION_SYSTEM,
        maxOutputTokens: Math.min(8192, Math.max(512, text.length * 3)),
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: "user", parts: [{ text }] }],
    });
    const out = (response.text ?? "").trim();
    if (isBadTranslationOutput(text, out)) return text;
    return out;
  } catch (err) {
    logger.warn({ err: (err as Error).message, sample: text.slice(0, 80) }, "translateToChinese failed — returning original");
    return text;
  }
}

// ─── Conditional translation helpers ─────────────────────────────────────────
export async function ensureChinese(text: string): Promise<string> {
  if (!text) return text;
  if (isPredominantlyChinese(text)) return text;
  return translateToChinese(text);
}

// ─── Cached free-text translation (listing cards / detail prose) ──────────────
// Listing descriptions and headlines repeat heavily (curated factual blurbs,
// re-opened cards), so we memoise translations by exact source text. In-flight
// requests are de-duplicated so N cards showing the same blurb share one call.
const freeTextTranslationCache = new Map<string, string>();
const freeTextTranslationInFlight = new Map<string, Promise<string>>();
const FREE_TEXT_CACHE_MAX = 3000;

export async function translateFreeTextToChinese(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
  if (isPredominantlyChinese(text)) return text;
  const cached = freeTextTranslationCache.get(text);
  if (cached != null) return cached;
  const pending = freeTextTranslationInFlight.get(text);
  if (pending) return pending;

  const promise = (async () => {
    const out = await translateToChinese(text);
    if (out === text && !containsChinese(text)) return out;
    if (freeTextTranslationCache.size >= FREE_TEXT_CACHE_MAX) {
      const drop = Math.ceil(FREE_TEXT_CACHE_MAX * 0.1);
      let i = 0;
      for (const k of freeTextTranslationCache.keys()) {
        freeTextTranslationCache.delete(k);
        if (++i >= drop) break;
      }
    }
    freeTextTranslationCache.set(text, out);
    return out;
  })().finally(() => {
    freeTextTranslationInFlight.delete(text);
  });

  freeTextTranslationInFlight.set(text, promise);
  return promise;
}

export async function translateFreeTextBatchToChinese(texts: string[]): Promise<string[]> {
  return Promise.all(texts.map((t) => translateFreeTextToChinese(t)));
}

/**
 * Deterministic mapping for NZ land-title statuses. The LLM translator
 * preserves short enum-like tokens (e.g. "Freehold") as-is per its system
 * prompt, so we'd get untranslated English in the title pill on Chinese-OS
 * devices. The pill is a small, high-confidence field, so we resolve it from
 * a fixed table rather than burn an LLM call.
 *
 * Format: "<Chinese> (<English>)" — keeps the universally recognised English
 * legal term alongside the Chinese translation. NZ settlement/contract
 * paperwork uses the English label.
 *
 * Returns null for unknown variants so the caller can fall back to the
 * generic LLM-translation path.
 */
export function localiseTitleTypeForZh(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  // Normalise common variants before lookup. "Fee Simple" is already mapped to
  // "Freehold" by formatTitleTypeForDisplay upstream; this handles defence in
  // depth in case the raw LINZ string slips through.
  //
  // Priority order: more-specific tenures first so compound phrases like
  // "Stratum in Freehold" or "Cross Lease over Fee Simple" pick up the
  // specific tenure (Stratum / Cross Lease) rather than the generic Freehold
  // catch-all.
  const normalised =
    /\bstratum\b/.test(key) ? "stratum"
    : /\bcross\s*lease\b/.test(key) ? "cross lease"
    : /\bunit\s+title\b/.test(key) ? "unit title"
    : /\bleasehold\b/.test(key) ? "leasehold"
    : /\bfee\s*simple\b/.test(key) || /\bfreehold\b/.test(key) ? "freehold"
    : null;
  if (!normalised) return null;
  const TITLE_TYPE_ZH: Record<string, string> = {
    freehold: "永久产权 (Freehold)",
    leasehold: "租赁产权 (Leasehold)",
    "cross lease": "交叉租赁产权 (Cross Lease)",
    "unit title": "单元产权 (Unit Title)",
    stratum: "层级产权 (Stratum)",
  };
  return TITLE_TYPE_ZH[normalised] ?? null;
}

export function localiseSiteStatusForZh(
  siteStatus: unknown,
  rawLabel: string | null | undefined,
): string | null {
  const status = typeof siteStatus === "string" ? siteStatus.trim().toLowerCase() : "";
  if (status === "has_dwelling") return "已检测到现有住宅";
  if (status === "vacant_land") return "空地 / 建地";
  if (status === "unknown") return "地块状态未知";

  const key = typeof rawLabel === "string" ? rawLabel.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (!key) return null;
  if (key === "existing dwelling detected") return "已检测到现有住宅";
  if (key === "vacant land / section") return "空地 / 建地";
  if (key === "site condition unknown") return "地块状态未知";
  return null;
}

export async function ensureChineseForLocale(text: string, locale: Locale): Promise<string> {
  if (locale !== "zh") return text;
  return ensureChinese(text);
}

// ─── Risk-summary scrubbing ───────────────────────────────────────────────────
// Removes any bullet that references comparable-sales data quality, exit-price
// predictability, GDV reliability, or any data-source limitations. Applied
// both during translation (to catch cached/old reports) and at analysis time.
function isBadRiskBullet(text: string): boolean {
  if (!text) return false;
  if (isIncompleteDataDisclaimerRiskBullet(text)) return true;
  // English
  const enPatterns: RegExp[] = [
    /lack\s+of\s+(reliable\s+)?comparable/i,
    /no\s+(real\s+|reliable\s+)?comparable\s+sales/i,
    /comparable\s+sales\s+(data\s+)?(are\s+|is\s+)?(not\s+)?(available|fetched|present|lacking|missing|limited|insufficient|scarce|sparse)/i,
    /comparable\s+(sale\s+)?data\s+(is\s+|are\s+)?(unavailable|missing|lacking|limited|insufficient|not\s+available)/i,
    /limited\s+comparable/i,
    /scarce\s+comparable/i,
    /insufficient\s+comparable/i,
    /synthetic\s+comparable/i,
    /no\s+comparable\s+(data|sales|transactions)/i,
    /comparable\s+(sales\s+)?data\s+gap/i,
    /exit\s+price\s+(is\s+)?(hard|difficult|challenging|tricky)\s+to\s+(predict|estimate|assess|evaluate|determine)/i,
    /exit\s+(price|value)\s+(cannot|can't|could\s+not)\s+be\s+(accurately\s+)?(predicted|estimated|assessed|determined)/i,
    /exit\s+pricing\s+(is\s+)?(uncertain|hard|difficult|challenging)/i,
    /(hard|difficult|challenging)\s+to\s+(accurately\s+)?(predict|estimate|assess|evaluate)\s+(exit\s+)?(price|gdv|sale\s+price|resale)/i,
    /gdv\s+(is\s+)?(hard|difficult|uncertain|unreliable)\s+to\s+(predict|estimate|evaluat)/i,
    /unable\s+to\s+evaluat.*gdv/i,
    /roi\s+(is\s+|assumptions?\s+are?\s+)?(unreliable|uncertain|unavailable|limited|hard)/i,
    /roi\s+sale[- ]price\s+assumptions?\s+are\s+unavailable/i,
    /roi\s+accuracy\s+(is\s+)?(limited|reduced|impacted)/i,
    /analysis\s+(is\s+)?(unreliable|uncertain|limited)\s+(due\s+to|because)/i,
    /data\s+(source|quality|availability)\s+(limits?|affects?|impacts?|reduces?)\s+(accuracy|reliability|confidence)/i,
    /market\s+data\s+(is\s+)?(unavailable|missing|lacking|limited|insufficient)/i,
    /comparable\s+sales\s+were\s+(not\s+fetched|unavailable|not\s+available)/i,
    /sales\s+data\s+(is\s+)?(missing|unavailable|lacking|insufficient|limited|scarce)/i,
    /pricing\s+data\s+(is\s+)?(missing|unavailable|lacking|insufficient|limited|scarce)/i,
    /no\s+sales\s+data/i,
    /without\s+(reliable\s+|real\s+)?comparable\s+(sales\s+)?data/i,
    /due\s+to\s+(limited|lack\s+of|no|insufficient|missing)\s+(comparable|sales|market)\s+(data|sales|information)/i,
    /price\s+(is\s+)?(hard|difficult)\s+to\s+(predict|estimate|assess)/i,
    /development\s+risk.*high.*comparable/i,
    /accurate\s+(gdv|exit|resale|roi)\s+(estimate|prediction)\s+(is\s+)?(not\s+)?(possible|available|feasible)/i,
  ];
  if (enPatterns.some((re) => re.test(text))) return true;
  // Chinese
  const zhPatterns: RegExp[] = [
    /可比.*(销售|成交|数据).*(缺失|缺乏|不足|不可靠|不可用|有限|较少|稀缺)/,
    /缺乏可靠.*可比/,
    /(无|没有|缺少|缺乏).*(可比|市场).*(成交|销售|数据)/,
    /可比.*(成交|销售).*(数据|记录).*(缺失|缺乏|不足|不可用|有限)/,
    /市场.*(可比|成交|销售).*(数据|信息).*(缺失|缺乏|不足|不可靠|稀缺|有限)/,
    /(退出|售出|销售|离场).*(价格|估值|价值).*(难以|无法|不易|不能).*(预测|评估|确定|精确|准确)/,
    /(难以|无法|不易).*(精确|准确|可靠).*(预测|评估|确定).*(退出|售出|销售|离场).*(价格|估值)/,
    /gdv\s*(评估|预测|估算)?.*(困难|不确定|不可靠|有限)/i,
    /(数据|信息).*(缺失|不足|缺乏|有限).*(影响|降低|限制).*(准确|精度|可靠|信心)/,
    /分析.*(不可靠|有限|不确定).*(因为|由于).*(数据|可比)/,
    /无可比.*(成交|销售|记录|数据)/,
    /市场数据.*(缺失|不足|有限|不可靠)/,
    /退出价格.*(难以|无法|不易|不能)/,
    /价格.*难以.*精确/,
    /难以精确评估/,
    /销售数据.*(缺失|不足|有限|稀缺|不可靠)/,
    /数据缺失.*退出/,
    /退出.*数据缺失/,
  ];
  if (zhPatterns.some((re) => re.test(text))) return true;
  return false;
}

// ─── Report-object narrative translation ─────────────────────────────────────
// Walks a FeasibilityReport-shaped object and translates only the user-facing
// natural-language fields. Structural fields (addresses, zone codes, numbers,
// enums, dates) are left untouched so downstream consumers still parse them
// the same way.
const STRING_ARRAY_FIELDS = ["ease_reasons", "cost_reasons", "roi_reasons", "riskSummary"] as const;

async function translateIfString(value: unknown): Promise<unknown> {
  if (typeof value !== "string") return value;
  return ensureChinese(value);
}

function translateInfrastructureNoteIfKnown(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^No mapped public (water supply|wastewater|stormwater) service found within (\d+)m of the parcel$/i);
  if (!match) return null;
  const service = match[1]!.toLowerCase();
  const label =
    service === "water supply" ? "供水" :
    service === "wastewater" ? "污水" :
    "雨水";
  return `在距离该地块${match[2]}米范围内未找到已规划的公共${label}服务`;
}

export type TranslateReportNarrativeOptions = {
  /**
   * When false, `propertyOverview.titleType` and `schoolZones` user-facing strings
   * are not translated (stay English). Used when the app language is Chinese but
   * the device OS is not (per product: land title + school block follow OS).
   *
   * When false, multi-lot / programme-intensity lines in riskSummary, scores.*_reasons,
   * and developmentStrategies assumptions also stay English. When true (Chinese OS),
   * those strings are translated with the rest of the zh narrative.
   */
  translateTitleAndSchoolFields?: boolean;
};

async function translateReportZhStringArray(
  arr: unknown,
  osChinese: boolean,
): Promise<unknown> {
  if (!Array.isArray(arr)) return arr;
  return Promise.all(
    arr.map(async (item) => {
      if (typeof item !== "string") return item;
      if (!osChinese && isIntensityProgrammeCopyEn(item)) return item;
      return ensureChinese(item);
    }),
  );
}

async function translateSchoolZoneDetails(arr: unknown): Promise<unknown> {
  if (!Array.isArray(arr)) return arr;
  return Promise.all(
    (arr as Array<Record<string, unknown>>).map(async (z) => ({
      ...z,
      sourceLabel: await translateIfString(z.sourceLabel),
      orgName: typeof z.orgName === "string" && z.orgName ? await translateIfString(z.orgName) : z.orgName,
      orgType: typeof z.orgType === "string" && z.orgType ? await translateIfString(z.orgType) : z.orgType,
      authority: typeof z.authority === "string" && z.authority ? await translateIfString(z.authority) : z.authority,
      equityIndex: typeof z.equityIndex === "string" && z.equityIndex ? await translateIfString(z.equityIndex) : z.equityIndex,
      enrolmentScheme:
        typeof z.enrolmentScheme === "string" && z.enrolmentScheme
          ? await translateIfString(z.enrolmentScheme)
          : z.enrolmentScheme,
    })),
  );
}

export async function translateReportNarrative(
  report: Record<string, unknown>,
  options?: TranslateReportNarrativeOptions,
): Promise<Record<string, unknown>> {
  const translateTitleSchool = options?.translateTitleAndSchoolFields !== false;
  const osChinese = translateTitleSchool;
  if (!report || typeof report !== "object") return report;
  const out: Record<string, unknown> = { ...report };

  // scores.*_reasons — scrub data-disclaimer lines, then translate (OS-gated like title/school)
  if (out.scores && typeof out.scores === "object") {
    const scores = { ...(out.scores as Record<string, unknown>) };
    sanitizeReportScoresReasons(scores);
    for (const field of STRING_ARRAY_FIELDS) {
      if (field in scores) scores[field] = await translateReportZhStringArray(scores[field], osChinese);
    }
    out.scores = scores;
  }

  // propertyOverview.titleType — LINZ English tenure phrase → Chinese (OS-gated).
  // For the small enumerated set of NZ land-title statuses we use a
  // deterministic mapping (Freehold/Leasehold/Cross Lease/Unit Title/Stratum →
  // Chinese with English in parens). The DeepSeek translator preserves these
  // short enum-like tokens as English by design, so the pill would otherwise
  // render "Freehold" untranslated on Chinese-OS devices.
  if (out.propertyOverview && typeof out.propertyOverview === "object") {
    const po = { ...(out.propertyOverview as Record<string, unknown>) };
    if (translateTitleSchool) {
      const rawTitle =
        typeof po.titleType === "string" ? formatTitleTypeForDisplay(po.titleType) ?? po.titleType : po.titleType;
      const mapped = typeof rawTitle === "string" ? localiseTitleTypeForZh(rawTitle) : null;
      po.titleType = mapped ?? (await translateIfString(rawTitle));
      const mappedSiteStatus = localiseSiteStatusForZh(po.siteStatus, typeof po.siteStatusLabel === "string" ? po.siteStatusLabel : null);
      po.siteStatusLabel = mappedSiteStatus ?? (await translateIfString(po.siteStatusLabel));
    } else {
      po.titleType =
        typeof po.titleType === "string" ? formatTitleTypeForDisplay(po.titleType) ?? po.titleType : po.titleType;
    }
    out.propertyOverview = po;
  }

  // schoolZones — MoE / listing strings → Chinese when OS is Chinese
  if (translateTitleSchool && Array.isArray(out.schoolZones)) {
    out.schoolZones = await translateSchoolZoneDetails(out.schoolZones);
  }

  // titleInsight: body copy for the dedicated land-title section. This is
  // generated after the LLM report, so translate it explicitly with the rest of
  // the report narrative for Chinese-OS users.
  if (translateTitleSchool && out.titleInsight && typeof out.titleInsight === "object") {
    const insight = { ...(out.titleInsight as Record<string, unknown>) };
    const rawInsightTitle =
      typeof insight.titleType === "string"
        ? formatTitleTypeForDisplay(insight.titleType) ?? insight.titleType
        : insight.titleType;
    const mappedInsightTitle = typeof rawInsightTitle === "string" ? localiseTitleTypeForZh(rawInsightTitle) : null;
    insight.titleType = mappedInsightTitle ?? (await translateIfString(rawInsightTitle));
    insight.opportunity = await translateIfString(insight.opportunity);
    if (Array.isArray(insight.risks)) {
      insight.risks = await translateReportZhStringArray(insight.risks, true);
    }
    out.titleInsight = insight;
  }

  // planning.overlays[].detail, planning.subdivisionSummary, planning.easement_summary,
  // planning.lot_impact_note
  if (out.planning && typeof out.planning === "object") {
    const planning = { ...(out.planning as Record<string, unknown>) };
    if (Array.isArray(planning.overlays)) {
      planning.overlays = await Promise.all(
        (planning.overlays as Array<Record<string, unknown>>).map(async (o) => ({
          ...o,
          detail: await translateIfString(o.detail),
        })),
      );
    }
    planning.subdivisionSummary = await translateIfString(planning.subdivisionSummary);
    // subdivisionPathwayNote is deterministic English prose from buildSubdivisionPathwayNote
    // and was previously never translated. Translate it here so Chinese-locale users see it
    // in Chinese rather than raw English inside the orange callout box.
    planning.subdivisionPathwayNote = await translateIfString(planning.subdivisionPathwayNote);
    planning.easement_summary = await translateIfString(planning.easement_summary);
    planning.lot_impact_note = await translateIfString(planning.lot_impact_note);
    out.planning = planning;
  }

  // asbestos.notes, asbestos.worksafeNote
  if (out.asbestos && typeof out.asbestos === "object") {
    const asbestos = { ...(out.asbestos as Record<string, unknown>) };
    asbestos.notes = await translateIfString(asbestos.notes);
    asbestos.worksafeNote = await translateIfString(asbestos.worksafeNote);
    out.asbestos = asbestos;
  }

  // costItems[].label — deterministic NZ English labels rendered in-report
  if (Array.isArray(out.costItems)) {
    out.costItems = await Promise.all(
      (out.costItems as Array<Record<string, unknown>>).map(async (ci) => ({
        ...ci,
        label: await translateIfString(ci.label),
      })),
    );
  }

  // developmentStrategies: rationale_zh/assumptions/cost labels (mobile prefers rationale_zh when locale is zh)
  if (Array.isArray(out.developmentStrategies)) {
    out.developmentStrategies = await Promise.all(
      (out.developmentStrategies as Array<Record<string, unknown>>).map(async (s) => {
        const rationaleRaw = typeof s.rationale === "string" ? s.rationale : "";
        const rationaleZhRaw = typeof s.rationale_zh === "string" ? s.rationale_zh : "";
        const rationaleZhTranslated =
          rationaleZhRaw.trim().length > 0
            ? await translateIfString(s.rationale_zh)
            : rationaleRaw.trim().length > 0
              ? await ensureChinese(rationaleRaw)
              : s.rationale_zh;
        let assumptionsTranslated = s.assumptions;
        if (Array.isArray(s.assumptions)) {
          assumptionsTranslated = await Promise.all(
            (s.assumptions as unknown[]).map(async (a) => {
              if (typeof a !== "string") return a;
              if (!osChinese && isIntensityProgrammeCopyEn(a)) return a;
              return ensureChinese(a);
            }),
          );
        }
        let costItems = s.costItems;
        if (Array.isArray(s.costItems)) {
          costItems = await Promise.all(
            (s.costItems as Array<Record<string, unknown>>).map(async (ci) => ({
              ...ci,
              label: await translateIfString(ci.label),
            })),
          );
        }
        return {
          ...s,
          rationale_zh: rationaleZhTranslated,
          assumptions: assumptionsTranslated,
          costItems,
        };
      }),
    );
  }

  // terrain.slope — deterministic zh copy when classification is known (no LLM)
  if (out.terrain && typeof out.terrain === "object") {
    const terrain = { ...(out.terrain as Record<string, unknown>) };
    const cls = terrain.classification as TerrainContour | null | undefined;
    const degrees = terrain.slope_degrees as number | null | undefined;
    if (cls) {
      terrain.slope = terrainSlopeText(cls, degrees, "zh");
    } else {
      terrain.slope = await translateIfString(terrain.slope);
    }
    out.terrain = terrain;
  }

  // infrastructure[].name, .note
  if (Array.isArray(out.infrastructure)) {
    out.infrastructure = await Promise.all(
      (out.infrastructure as Array<Record<string, unknown>>).map(async (i) => ({
        ...i,
        name: await translateIfString(i.name),
        note: translateInfrastructureNoteIfKnown(i.note) ?? (await translateIfString(i.note)),
      })),
    );
  }

  // riskSummary[] — scrub data-source reliability bullets, then translate
  if ("riskSummary" in out) {
    let pre = Array.isArray(out.riskSummary)
      ? (out.riskSummary as unknown[]).filter((b) => typeof b !== "string" || !isBadRiskBullet(b))
      : out.riskSummary;
    const y = canonicalBuildYearFromReport(out, undefined);
    if (y != null && y > 2000 && Array.isArray(pre)) {
      pre = (pre as unknown[]).filter(
        (b) => typeof b !== "string" || !/asbestos|石棉/i.test(b),
      );
    }
    out.riskSummary = await translateReportZhStringArray(pre, osChinese);
  }

  // neighbourhoodContext: aggregate market-context prose shown in the ROI section.
  if (out.neighbourhoodContext && typeof out.neighbourhoodContext === "object") {
    const context = { ...(out.neighbourhoodContext as Record<string, unknown>) };
    if (context.marketAdjustment && typeof context.marketAdjustment === "object") {
      const marketAdjustment = { ...(context.marketAdjustment as Record<string, unknown>) };
      marketAdjustment.reason = await translateIfString(marketAdjustment.reason);
      context.marketAdjustment = marketAdjustment;
    }
    if (Array.isArray(context.reasons)) {
      context.reasons = await translateReportZhStringArray(context.reasons, osChinese);
    }
    out.neighbourhoodContext = context;
  }

  // transportContext: commute/highway/public-transport prose shown in the ROI section.
  if (out.transportContext && typeof out.transportContext === "object") {
    const context = { ...(out.transportContext as Record<string, unknown>) };
    if (context.roiInfluence && typeof context.roiInfluence === "object") {
      const roiInfluence = { ...(context.roiInfluence as Record<string, unknown>) };
      if (Array.isArray(roiInfluence.reasons)) {
        roiInfluence.reasons = await translateReportZhStringArray(roiInfluence.reasons, osChinese);
      }
      context.roiInfluence = roiInfluence;
    }
    out.transportContext = context;
  }

  // builtEnvironmentContext.reasons[] — hardcoded English signal strings → Chinese
  if (translateTitleSchool && out.builtEnvironmentContext && typeof out.builtEnvironmentContext === "object") {
    const bec = { ...(out.builtEnvironmentContext as Record<string, unknown>) };
    if (Array.isArray(bec.reasons)) {
      bec.reasons = await translateReportZhStringArray(bec.reasons, true);
    }
    out.builtEnvironmentContext = bec;
  }

  // disclaimer
  if ("disclaimer" in out) {
    out.disclaimer = await translateIfString(out.disclaimer);
  }

  // brief_summary (nested in search candidates, but safe here too)
  if ("brief_summary" in out) {
    out.brief_summary = await translateIfString(out.brief_summary);
  }

  return out;
}

// ─── Chat /chat payload translation ──────────────────────────────────────────
// The /chat route wraps everything as { content, mode }. Content may be plain
// prose (text/followup), JSON from discover/clarification, or a stringified
// FeasibilityReport. We handle each shape so Chinese users always see Chinese
// natural-language content.
export async function translateChatContent(
  content: string,
  mode: string | undefined,
  locale: Locale,
  translateTitleAndSchoolFields = true,
): Promise<string> {
  if (locale !== "zh" || !content) return content;

  const trimmed = content.trim();

  // Discover payload: { candidates, aiIntro, noListings, suburb, ... }
  if (mode === "discover" && trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        candidates?: Array<Record<string, unknown>>;
        aiIntro?: string;
        [k: string]: unknown;
      };
      if (typeof parsed.aiIntro === "string") {
        parsed.aiIntro = await ensureChinese(parsed.aiIntro);
      }
      if (Array.isArray(parsed.candidates)) {
        parsed.candidates = await Promise.all(
          parsed.candidates.map(async (c) => ({
            ...c,
            briefSummary:
              typeof c.briefSummary === "string" ? await ensureChinese(c.briefSummary) : c.briefSummary,
            brief_summary:
              typeof c.brief_summary === "string" ? await ensureChinese(c.brief_summary) : c.brief_summary,
          })),
        );
      }
      return JSON.stringify(parsed);
    } catch {
      // fall through
    }
  }

  // Clarification payload: either plain string or JSON with `question`
  if (mode === "clarification") {
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as { clarificationType?: unknown; question?: unknown; options?: unknown; [k: string]: unknown };
        if (typeof parsed.question === "string") {
          parsed.question = await ensureChinese(parsed.question);
        }
        if (parsed.clarificationType === "discovery_exhausted" && Array.isArray(parsed.options)) {
          parsed.options = await Promise.all(
            parsed.options.map((option) =>
              typeof option === "string" ? ensureChinese(option) : option,
            ),
          );
        }
        return JSON.stringify(parsed);
      } catch {
        // fall through to plain-text handling
      }
    }
    return ensureChinese(content);
  }

  // Analyse / followup: may be a full FeasibilityReport JSON, or plain markdown.
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const looksLikeReport =
        parsed && ("scores" in parsed || "propertyOverview" in parsed || "riskSummary" in parsed);
      if (looksLikeReport) {
        const translated = await translateReportNarrative(parsed, { translateTitleAndSchoolFields });
        return JSON.stringify(translated);
      }
    } catch {
      // Malformed JSON-ish content (e.g. truncated model output). Running it
      // through the LLM translator would garble the quotes/braces and produce
      // pseudo-JSON that clients can neither parse into a card nor safely
      // strip, so it would surface as raw JSON text in the chat. Return it
      // untouched and let the client-side JSON guards handle it.
      return content;
    }
  }

  // Plain text / markdown reply. JSON payloads that reach here (structured
  // modes we don't recognise) must never be LLM-translated as a whole string —
  // that breaks their machine-parseable shape.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return content;
  return ensureChinese(content);
}
