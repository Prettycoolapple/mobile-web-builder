/**
 * Shared riskSummary hygiene for feasibility reports (server + translation).
 */

/**
 * True when a bullet implies the paid report is unreliable because "key" facts
 * (land area, zoning, etc.) were not obtained — must never appear in riskSummary
 * or in scores.*_reasons on the property card.
 *
 * Mobile display filter: `artifacts/mobile/lib/riskSummaryIncompleteDataFilter.ts` (keep in sync).
 */
export function isIncompleteDataDisclaimerRiskBullet(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const s = text.toLowerCase();

  const en: RegExp[] = [
    /\bkey\s+data\s+(was|were)\s+not\s+(obtained|available|retrieved|fetched)\b/i,
    /\bcritical\s+data\s+(was|were)\s+not\s+(obtained|available|retrieved|fetched)\b/i,
    /\bunable\s+to\s+identif(y|ication)\b[^.]{0,70}\b(specific\s+)?site\s+risk/i,
    /\bcannot\s+identif(y|ication)\b[^.]{0,70}\b(specific\s+)?site\s+risk/i,
    /\bunable\s+to\s+identif(y|ication)\b[^.]{0,50}\bsite[- ]specific\s+risk/i,
    /land\s+area.{0,130}(zoning|planning\s+zon(e|ing)).{0,90}(not\s+obtained|missing|unavailable|could\s+not\s+be)/i,
    /(zoning|planning\s+zon(e|ing)).{0,130}land\s+area.{0,90}(not\s+obtained|missing|unavailable|could\s+not\s+be)/i,
    /\binsufficient\s+(information|data)\b.{0,90}\b(complete|accurate|analysis|risk\s+assessment|identif)\b/i,
    /\bnot\s+enough\s+information\b.{0,120}\b(analysis|accurat|risk)\b/i,
    /\bthe\s+analysis\s+(is\s+)?incomplete\b.{0,80}\b(data|information)\b/i,
    /\bcould\s+not\s+identif(y|ication)\b[^.]{0,60}\brisk\b/i,
    /\baddress\s+(was\s+)?not\s+found\b/i,
    /\bnot\s+found\s+in\s+(the\s+)?(real[- ]time\s+)?database\b/i,
    /\bno\s+match\b.{0,80}\b(database|records?)\b/i,
    /\bunable\s+to\s+confirm\b.{0,90}\b(zoning|land\s+area|lot\s+size)\b/i,
    /\bcannot\s+confirm\b.{0,90}\b(zoning|land\s+area|lot\s+size)\b/i,
    /\bcould\s+not\s+confirm\b.{0,90}\b(zoning|land\s+area)\b/i,
    /\bdata\s+source\b.{0,70}\b(unavailable|missing|not\s+available)\b/i,
    /\bsource\s+(was\s+)?unavailable\b/i,
    /\bassuming\b.{0,120}\b(this\s+)?(site|property|location|address)\b/i,
    /\bassumed\b.{0,80}\b(location|coastal|site|property)\b/i,
    /\bhypothes(izing|is)\b.{0,60}\b(location|site)\b/i,
    /\black\s+of\s+information\b.{0,80}\b(from|in)\b.{0,40}\b(database|records?)\b/i,
  ];
  if (en.some((re) => re.test(s))) return true;

  const zh: RegExp[] = [
    /关键数据[^。]{0,20}(未获取|缺失|不足)/,
    /土地面积[^。]{0,40}规划分区[^。]{0,25}关键数据/,
    /规划分区[^。]{0,25}关键数据[^。]{0,20}(未获取|缺失|不足)/,
    /土地面积[^。]{0,15}[、，,][^。]{0,20}规划分区[^。]{0,40}(等[^。]{0,8}关键数据[^。]{0,12})?(未获取|缺失|不足)/,
    /无法识别[^。]{0,18}具体场地风险/,
    /无法[^。]{0,8}识别[^。]{0,18}具体?场地风险/,
    /(信息|数据)[^。]{0,25}(不足|缺失)[^。]{0,40}分析[^。]{0,15}(不|无)[^。]{0,8}准确/,
    /数据[^。]{0,15}(未获取|缺失|不足)[^。]{0,35}无法[^。]{0,12}(识别|评估)[^。]{0,12}风险/,
    /实时数据库[^。]{0,25}(未|不)[^。]{0,8}(找到|收录|查询到)/,
    /未在[^。]{0,20}实时数据库[^。]{0,20}(找到|查到|收录)/,
    /地址[^。]{0,25}(未在|不在)[^。]{0,20}(数据库|实时|系统)/,
    /无法确认[^。]{0,35}(分区|规划分区|土地面积|宗地)/,
    /不能确认[^。]{0,35}(分区|规划分区|土地面积)/,
    /来源[^。]{0,18}(不可用|未知|缺失|暂无)/,
    /数据源[^。]{0,15}(不可用|缺失|未获取)/,
    /假定[^。]{0,5}(该|此|本)/,
    /假设[^。]{0,30}(该|此|本)[^。]{0,20}(址|地|地块)/,
    /缺少[^。]{0,15}可靠[^。]{0,12}数据/,
  ];
  if (zh.some((re) => re.test(text))) return true;

  return false;
}

export function filterRiskSummaryRemoveIncompleteDataDisclaimerBullets(bullets: string[]): string[] {
  return bullets.filter((b) => typeof b !== "string" || !isIncompleteDataDisclaimerRiskBullet(b));
}

/**
 * Comparable-sales / exit-price data-reliability hedges — removed from riskSummary
 * and score-card reasons (same rule as analyse route legacy filter).
 */
export function isComparableDataReliabilityRiskBullet(text: string): boolean {
  if (typeof text !== "string" || !text.trim()) return false;
  const s = text.toLowerCase();

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
    /exit\s+price\s+(is\s+)?(hard|difficult|challenging|tricky)\s+to\s+(predict|estimate|assess|evaluate|determine|quantif)/i,
    /exit\s+(price|value)\s+(cannot|can't|could\s+not)\s+be\s+(accurately\s+)?(predicted|estimated|assessed|determined|quantified)/i,
    /exit\s+pricing\s+(is\s+)?(uncertain|hard|difficult|challenging)/i,
    /price\s+(is\s+)?(hard|difficult)\s+to\s+(predict|estimate|assess|quantif)/i,
    /(hard|difficult|challenging)\s+to\s+(accurately\s+)?(predict|estimate|assess|evaluate|quantif)\s+(exit\s+)?(price|gdv|sale\s+price|resale)/i,
    /gdv\s+(is\s+)?(hard|difficult|uncertain|unreliable)\s+to\s+(predict|estimate|evaluat)/i,
    /unable\s+to\s+evaluat.*gdv/i,
    /gdv\s+(is\s+)?(hard|difficult)\s+to\s+evaluat/i,
    /evaluat.*gdv.*difficult/i,
    /accurate\s+(gdv|exit|resale|roi)\s+(estimate|prediction)\s+(is\s+)?(not\s+)?(possible|available|feasible)/i,
    /roi\s+(is\s+|assumptions?\s+are?\s+)?(unreliable|uncertain|unavailable|limited|hard)/i,
    /roi\s+sale[- ]price\s+assumptions?\s+are\s+unavailable/i,
    /roi\s+accuracy\s+(is\s+)?(limited|reduced|impacted)/i,
    /analysis\s+(is\s+)?(unreliable|uncertain|limited)\s+(due\s+to|because)/i,
    /data\s+(source|quality|availability)\s+(limits?|affects?|impacts?|reduces?)\s+(accuracy|reliability|confidence)/i,
    /(limited|insufficient|lack\s+of)\s+data\s+(makes?|means?|results?\s+in)\s+(it\s+)?(hard|difficult|challenging|impossible)/i,
    /(data|information)\s+(gaps?|shortfalls?|limitations?)\s+(affect|impact|limit|reduce)\s+(accuracy|confidence|pricing|roi)/i,
    /market\s+data\s+(is\s+)?(unavailable|missing|lacking|limited|insufficient)/i,
    /comparable\s+sales\s+were\s+(not\s+fetched|unavailable|not\s+available)/i,
    /development\s+risk.*high.*comparable/i,
    /sales\s+data\s+(is\s+)?(missing|unavailable|lacking|insufficient|limited|scarce)/i,
    /pricing\s+data\s+(is\s+)?(missing|unavailable|lacking|insufficient|limited|scarce)/i,
    /no\s+sales\s+data/i,
    /without\s+(reliable\s+|real\s+)?comparable\s+(sales\s+)?data/i,
    /due\s+to\s+(limited|lack\s+of|no|insufficient|missing)\s+(comparable|sales|market)\s+(data|sales|information)/i,
  ];

  if (enPatterns.some((re) => re.test(s))) return true;

  const zhPatterns: RegExp[] = [
    /可比.*(销售|成交|数据).*(缺失|缺乏|不足|不可靠|不可用|有限|有限制|较少|稀缺)/,
    /缺乏可靠.*可比/,
    /(无|没有|缺少|缺乏).*(可比|市场).*(成交|销售|数据)/,
    /可比.*(成交|销售).*(数据|记录).*(缺失|缺乏|不足|不可用|有限)/,
    /市场.*(可比|成交|销售).*(数据|信息).*(缺失|缺乏|不足|不可靠|稀缺|有限)/,
    /(退出|售出|销售|离场).*(价格|估值|价值).*(难以|无法|不易|不能).*(预测|评估|确定|精确|准确|量化)/,
    /(难以|无法|不易).*(精确|准确|可靠).*(预测|评估|确定|量化).*(退出|售出|销售|离场).*(价格|估值)/,
    /gdv\s*(评估|预测|估算)?.*(困难|不确定|不可靠|有限)/i,
    /(数据|信息).*(缺失|不足|缺乏|有限).*(影响|降低|限制).*(准确|精度|可靠|信心)/,
    /分析.*(不可靠|有限|不确定).*(因为|由于).*(数据|可比)/,
    /无可比.*(成交|销售|记录|数据)/,
    /市场数据.*(缺失|不足|有限|不可靠)/,
    /退出价格.*(难以|无法|不易|不能|不易于)/,
    /价格.*难以.*精确/,
    /难以精确评估/,
    /退出价格[^。]{0,12}难以[^。]{0,8}量化/,
  ];

  if (zhPatterns.some((re) => re.test(text))) return true;

  return false;
}

export function filterRiskSummaryRemoveComparableReliabilityBullets(bullets: string[]): string[] {
  return bullets.filter((b) => !isComparableDataReliabilityRiskBullet(b));
}

/** Strip data-disclaimer lines from feasibility score-card reason bullets. */
export function filterScoreReasonStrings(reasons: string[] | null | undefined): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .filter((r) => typeof r === "string" && r.trim().length > 0)
    .filter(
      (r) =>
        !isIncompleteDataDisclaimerRiskBullet(r) && !isComparableDataReliabilityRiskBullet(r),
    );
}

/** Mutates `scores` in place: cleans ease/cost/roi reason arrays when present. */
export function sanitizeReportScoresReasons(scores: Record<string, unknown> | undefined | null): void {
  if (!scores || typeof scores !== "object") return;
  for (const key of ["ease_reasons", "cost_reasons", "roi_reasons"] as const) {
    if (!(key in scores)) continue;
    scores[key] = filterScoreReasonStrings(scores[key] as string[]);
  }
}

/** Drop bullets that mention asbestos in English or Chinese. */
export function filterRiskSummaryRemoveAsbestosBullets(bullets: string[]): string[] {
  return bullets.filter((b) => typeof b !== "string" || !/asbestos|石棉/i.test(b));
}

/**
 * Best-effort canonical construction year for gating narrative (e.g. asbestos in riskSummary).
 */
export function canonicalBuildYearFromReport(
  parsed: Record<string, unknown>,
  mergedBuildYear: number | null | undefined,
): number | null {
  if (mergedBuildYear != null && typeof mergedBuildYear === "number" && Number.isFinite(mergedBuildYear)) {
    return mergedBuildYear;
  }
  const po = parsed.propertyOverview as Record<string, unknown> | undefined;
  if (!po) return null;
  if (typeof po.build_year === "number" && Number.isFinite(po.build_year)) return po.build_year;
  if (typeof po.buildYear === "number" && Number.isFinite(po.buildYear)) return po.buildYear;
  if (typeof po.buildYear === "string") {
    const n = parseInt(po.buildYear.replace(/\D/g, "").slice(0, 4), 10);
    if (Number.isFinite(n) && n >= 1800 && n <= 2100) return n;
  }
  const snap = parsed.property_overview_snapshot as Record<string, unknown> | undefined;
  if (snap && typeof snap.build_year === "number" && Number.isFinite(snap.build_year)) return snap.build_year;
  if (snap && typeof snap.buildYear === "string") {
    const n = parseInt(String(snap.buildYear).replace(/\D/g, "").slice(0, 4), 10);
    if (Number.isFinite(n) && n >= 1800 && n <= 2100) return n;
  }
  const asbestos = parsed.asbestos as Record<string, unknown> | undefined;
  if (asbestos?.buildYear != null) {
    if (typeof asbestos.buildYear === "number" && Number.isFinite(asbestos.buildYear)) return asbestos.buildYear;
    if (typeof asbestos.buildYear === "string") {
      const n = parseInt(asbestos.buildYear.replace(/\D/g, "").slice(0, 4), 10);
      if (Number.isFinite(n) && n >= 1800 && n <= 2100) return n;
    }
  }
  return null;
}
