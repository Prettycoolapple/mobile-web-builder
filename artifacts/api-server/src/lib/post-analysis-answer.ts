import type { Locale } from "./prompts";

export type PostAnalysisIntent = "rental_ownership_costs" | "market_value_estimate" | "subdivision_lot_feasibility";

const DEFAULT_INTEREST_RATE = 0.07;
const DEFAULT_LVR = 0.8;
const PROFESSIONAL_FEE_RATE = 0.015;

const ZH_NO_BASE =
  "\u79df\u8d41\u6301\u6709\u6210\u672c\uff1a\u8fd9\u4efd\u62a5\u544a\u6ca1\u6709\u786e\u8ba4\u552e\u4ef7\u6216 CV\uff0c\u6240\u4ee5\u6211\u4e0d\u4f1a\u7ed9\u51fa\u5177\u4f53\u91d1\u989d\u3002\u516c\u5f0f\u662f\uff1a\u4e70\u5165\u4ef7\u6216 CV + \u4e13\u4e1a\u8d39\u7528 + \u8d37\u6b3e\u5229\u606f\uff1b\u82e5\u6309 80% \u8d37\u6b3e\u30017.0% \u5e74\u5229\u7387\u4f30\u7b97\uff0c\u5e74\u5229\u606f\u7ea6\u4e3a\u4ef7\u683c x 80% x 7.0%\u3002";
const ZH_LISTING_PRICE = "\u62a5\u544a\u4e2d\u7684\u6302\u724c\u4ef7";
const ZH_CV = "\u62a5\u544a\u4e2d\u7684 CV";

function hasRentalOwnershipCostIntent(message: string): boolean {
  const text = message.toLowerCase();
  const rentalSignal =
    /\b(rental|rent(?:al)?\s+property|investment\s+property|landlord|tenant|cash\s*flow|cashflow)\b/i.test(text) ||
    /(?:出租|租赁|租賃|投资房|投資房|租金)/u.test(message);
  const costSignal =
    /\b(expected\s+costs?|costs?\s+(?:to|of)\s+own(?:ing|ership)?|own(?:ing|ership)?\s+costs?|holding\s+costs?|outgoings?|mortgage|interest|finance|repayments?|afford|carry(?:ing)?\s+costs?)\b/i.test(text) ||
    /(?:持有成本|成本|费用|費用|开销|開銷|贷款|貸款|利息|供楼|供樓)/u.test(message);
  return rentalSignal && costSignal;
}

function hasMarketValueIntent(message: string): boolean {
  const text = message.toLowerCase();
  return (
    /\b(?:market\s+value|estimated\s+(?:market\s+)?value|property\s+value|worth|valuation|value\s+of\s+(?:this|the)\s+property|what\s+is\s+(?:it|this|the\s+property)\s+worth)\b/i.test(text) ||
    /(?:\u5e02\u573a\u4ef7\u503c|\u5e02\u5834\u50f9\u503c|\u5e02\u503c|\u4f30\u503c|\u4ef7\u503c|\u50f9\u503c|\u503c\u591a\u5c11|\u503c\u5e7e\u591a)/u.test(message)
  );
}

// Matches the same lot-count phrasing as claude.ts's detectFilterSpecFromText
// (kept as its own small regex here rather than imported, since claude.ts
// pulls in the full LLM/pipeline module graph and this file must stay a
// light, dependency-free helper). Requires an explicit subdivision/split word
// so a bare number in the address itself is never mistaken for a lot count.
function extractRequestedLotCount(message: string): number | null {
  const hasSubdivisionWord = /\bsubdiv\w*\b|\bsplit\b/i.test(message) || /\u5206\u5272|\u7ec6\u5206|\u7d30\u5206/.test(message);
  if (!hasSubdivisionWord) return null;

  const t = message.toLowerCase();
  const match =
    t.match(/split\s+into\s+(\d+)/) ||
    t.match(/subdiv\w*\s+into\s+(\d+)/) ||
    t.match(/(\d+)\s*(?:standalone\s+)?lots?\b/) ||
    message.match(/(?:\u5206\u5272|\u7ec6\u5206|\u7d30\u5206)\s*(?:\u6210)?\s*(\d+)\s*(?:\u5957|\u5757|\u584a|\u4e2a|\u500b|\u680b|\u68df)?/);
  if (!match) return null;

  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 2 && n <= 50 ? n : null;
}

export function detectPostAnalysisIntent(message: string): PostAnalysisIntent | null {
  if (hasRentalOwnershipCostIntent(message)) return "rental_ownership_costs";
  if (hasMarketValueIntent(message)) return "market_value_estimate";
  if (extractRequestedLotCount(message) != null) return "subdivision_lot_feasibility";
  return null;
}

export function detectPostAnalysisIntents(message: string): PostAnalysisIntent[] {
  const intents: PostAnalysisIntent[] = [];
  if (hasRentalOwnershipCostIntent(message)) intents.push("rental_ownership_costs");
  if (hasMarketValueIntent(message)) intents.push("market_value_estimate");
  if (extractRequestedLotCount(message) != null) intents.push("subdivision_lot_feasibility");
  return intents;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = numberFromValue(value);
    if (n != null) return n;
  }
  return null;
}

function formatNZD(value: number): string {
  return `$${Math.round(value).toLocaleString("en-NZ")}`;
}

// Unlike numberFromValue (used for whole-dollar amounts), star scores are
// meaningful to one decimal place (e.g. 4.2/5) so this must not round.
function floatFromValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function asArrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    : [];
}

function reportPotentialLots(report: Record<string, unknown>): number | null {
  const planning = asRecord(report["planning"]);
  return firstNumber(report["potential_lots"], planning?.["potentialLots"]);
}

function reportScores(report: Record<string, unknown>): {
  ease: number | null;
  cost: number | null;
  roi: number | null;
  composite: number | null;
} {
  const scores = asRecord(report["scores"]);
  return {
    ease: floatFromValue(scores?.["ease"]),
    cost: floatFromValue(scores?.["cost"]),
    roi: floatFromValue(scores?.["roi"]),
    composite: floatFromValue(scores?.["composite"]),
  };
}

function bestRoiScenario(report: Record<string, unknown>): { years: number; roiPercent: number; gdv: number | null } | null {
  let best: { years: number; roiPercent: number; gdv: number | null } | null = null;
  for (const scenario of asArrayOfRecords(report["roiScenarios"])) {
    const roiPercent = floatFromValue(scenario["roi_percent"]);
    const years = firstNumber(scenario["years"]);
    if (roiPercent == null || years == null) continue;
    if (!best || roiPercent > best.roiPercent) {
      best = { years, roiPercent, gdv: firstNumber(scenario["gdv"]) };
    }
  }
  return best;
}

function firstRiskBullet(report: Record<string, unknown>): string | null {
  const risks = report["riskSummary"];
  if (!Array.isArray(risks)) return null;
  const first = risks.find((r) => typeof r === "string" && r.trim());
  return typeof first === "string" ? first.trim() : null;
}

// When a report has NO development score (the ease/cost/roi/composite stars are
// suppressed → the header shows "—/5"), append a bubble letting the user know
// what that means and where to go next. Fires only when scores are absent — a
// present-but-low score still returns null (product decision: no-score only).
// The report carries `score_unavailable_reason` (non-null when suppressed) plus
// a null `scores` object; either signal means "no score".
function hasNoDevelopmentScore(report: Record<string, unknown>): boolean {
  if (report["score_unavailable_reason"] != null) return true;
  const scores = asRecord(report["scores"]);
  if (scores == null) return true;
  return floatFromValue(scores["composite"]) == null;
}

export function buildDevScoreNotice(
  report: Record<string, unknown> | null | undefined,
  locale: Locale = "en",
): string | null {
  if (!report || !hasNoDevelopmentScore(report)) return null;
  return locale === "zh"
    ? "该物业暂无开发评分。这有时是因为该地块的部分规划或物业数据暂时不足，也可能反映其分割或开发潜力较为有限——建议您联系专业开发顾问，以确认可行的方案。"
    : "This property doesn't have a development score. Sometimes this simply means we don't yet have enough data for the site, though it can also indicate limited subdivision or development potential — we recommend getting in touch with a specialist consultant to confirm what's achievable.";
}

function reportPurchaseBase(report: Record<string, unknown>): { amount: number; source: "listing price" | "CV" } | null {
  const overviewSnapshot = asRecord(report["property_overview_snapshot"]);
  const overview = asRecord(report["propertyOverview"]);
  const selectedListing = asRecord(report["selectedListingContext"]);
  const selectedOverviewListing = asRecord(overview?.["selectedListingContext"]);

  const listing = firstNumber(
    overviewSnapshot?.["listing_price_nzd"],
    overview?.["listing_price_nzd"],
    overview?.["listingPrice"],
    report["listing_price_nzd"],
    report["listingPrice"],
    selectedListing?.["price"],
    selectedOverviewListing?.["price"],
  );
  if (listing != null) return { amount: listing, source: "listing price" };

  const cv = firstNumber(
    overviewSnapshot?.["cv_nzd"],
    overview?.["cv_nzd"],
    overview?.["cv"],
    report["cv_nzd"],
    report["cv"],
  );
  if (cv != null) return { amount: cv, source: "CV" };

  return null;
}

function reportMarketValueBase(report: Record<string, unknown>): { amount: number; source: "listing price" | "CV" | "average comparable sale" | "estimated GDV" } | null {
  const overviewSnapshot = asRecord(report["property_overview_snapshot"]);
  const overview = asRecord(report["propertyOverview"]);
  const selectedListing = asRecord(report["selectedListingContext"]);
  const selectedOverviewListing = asRecord(overview?.["selectedListingContext"]);
  const listing = firstNumber(
    overviewSnapshot?.["listing_price_nzd"],
    overview?.["listing_price_nzd"],
    overview?.["listingPrice"],
    report["listing_price_nzd"],
    report["listingPrice"],
    selectedListing?.["price"],
    selectedOverviewListing?.["price"],
  );
  if (listing != null) return { amount: listing, source: "listing price" };

  const cv = firstNumber(
    overviewSnapshot?.["cv_nzd"],
    overview?.["cv_nzd"],
    overview?.["cv"],
    report["cv_nzd"],
    report["cv"],
  );
  if (cv != null) return { amount: cv, source: "CV" };

  const avgSale = firstNumber(report["avg_sale_price"], report["averageSalePrice"], report["avgComparableSale"]);
  if (avgSale != null) return { amount: avgSale, source: "average comparable sale" };

  const best = bestRoiScenario(report);
  if (best?.gdv != null) return { amount: best.gdv, source: "estimated GDV" };
  return null;
}

// Builds the chat reply that automatically follows a just-generated report
// when the user's original message described a subdivision by lot count
// (e.g. "a 3 lot subdivision at 13 X Place") — this is what future-proofs the
// not-yet-built "AI subdivision" button on the Plan tab's site plan card:
// once that button exists it can call this same helper directly instead of
// going through chat text.
function buildSubdivisionLotAnswer(
  requestedLots: number,
  report: Record<string, unknown>,
  locale: Locale,
): string {
  const modelledLots = reportPotentialLots(report);
  const { ease, cost, roi, composite } = reportScores(report);
  const best = bestRoiScenario(report);
  const risk = firstRiskBullet(report);

  if (modelledLots == null && ease == null && cost == null && roi == null) {
    return locale === "zh"
      ? `关于 ${requestedLots} 块分割：这份报告目前没有足够的地块/规划数据来建模具体块数和收益，建议直接联系规划师或建筑师确认可行方案。`
      : `For a ${requestedLots}-lot subdivision: this report doesn't have enough lot/planning data yet to model that specific yield and return — I'd recommend confirming the concept directly with a planner or architect.`;
  }

  const lotsLine =
    modelledLots != null
      ? modelledLots === requestedLots
        ? locale === "zh"
          ? `报告建模的潜在地块数为 ${modelledLots} 块，与你询问的 ${requestedLots} 块一致。`
          : `The report models ${modelledLots} potential lot${modelledLots === 1 ? "" : "s"} here, matching the ${requestedLots}-lot subdivision you asked about.`
        : modelledLots < requestedLots
          ? locale === "zh"
            ? `但报告在现有区划下只建模出 ${modelledLots} 块，少于你询问的 ${requestedLots} 块——达到 ${requestedLots} 块可能需要额外的设计引导审批或放宽条件。`
            : `But the report only models ${modelledLots} potential lot${modelledLots === 1 ? "" : "s"} under the standard planning rules — fewer than the ${requestedLots} you're asking about, so reaching ${requestedLots} would likely need a design-led / non-complying consent pathway.`
          : locale === "zh"
            ? `报告建模可达 ${modelledLots} 块，多于你询问的 ${requestedLots} 块，还有进一步提升的空间。`
            : `The report actually models ${modelledLots} potential lots — more than the ${requestedLots} you asked about, so there may be room to go further.`
      : locale === "zh"
        ? `目前数据无法确认具体可建模的地块数。`
        : `The exact modelled lot count isn't confirmed from the available data.`;

  const scoreLine =
    ease != null && cost != null && roi != null
      ? locale === "zh"
        ? `可行度 ${ease}/5，成本 ${cost}/5，回报 ${roi}/5${composite != null ? `（综合 ${composite}/5）` : ""}。`
        : `Feasibility ${ease}/5, cost ${cost}/5, return ${roi}/5${composite != null ? ` (overall ${composite}/5)` : ""}.`
      : "";

  const roiLine = best
    ? locale === "zh"
      ? `最佳情况大约 ${best.years} 年内实现 ${best.roiPercent.toFixed(0)}% 的投资回报率${best.gdv != null ? `，预估总销售额约 ${formatNZD(best.gdv)}` : ""}。`
      : `Best case is roughly ${best.roiPercent.toFixed(0)}% ROI over about ${best.years} years${best.gdv != null ? `, on an estimated GDV of ${formatNZD(best.gdv)}` : ""}.`
    : locale === "zh"
      ? `因没有真实成交数据，暂无法给出具体回报率。`
      : `No return figure is available yet — no real comparable sales were fetched for this scenario.`;

  const riskLine = risk
    ? locale === "zh"
      ? `主要风险：${risk}`
      : `Key risk to weigh: ${risk}`
    : "";

  return [lotsLine, scoreLine, roiLine, riskLine].filter(Boolean).join(" ");
}

// Answers a specific question the user attached to the analyse request
// (rental ownership costs, N-lot subdivision feasibility). Null when the
// message carries no such intent.
function buildIntentAnswer(
  intent: PostAnalysisIntent,
  message: string,
  report: Record<string, unknown>,
  locale: Locale,
): string | null {
  if (intent === "subdivision_lot_feasibility") {
    const requestedLots = extractRequestedLotCount(message);
    return requestedLots != null ? buildSubdivisionLotAnswer(requestedLots, report, locale) : null;
  }

  if (intent === "market_value_estimate") {
    const base = reportMarketValueBase(report);
    if (!base) {
      return locale === "zh"
        ? "\u8be5\u7269\u4e1a\u7684\u5e02\u573a\u4ef7\u503c\u76ee\u524d\u65e0\u6cd5\u4ece\u62a5\u544a\u4e2d\u76f4\u63a5\u786e\u8ba4\u3002\u5982\u679c\u9700\u8981\u66f4\u51c6\u786e\u7684\u5e02\u503c\uff0c\u5efa\u8bae\u4ee5\u8fd1\u671f\u540c\u7c7b\u6210\u4ea4\u6216\u6ce8\u518c\u4f30\u4ef7\u5e08\u8bc4\u4f30\u4e3a\u51c6\u3002"
        : "The report does not contain enough confirmed pricing evidence to state a market value. For a tighter value, use recent comparable settled sales or a registered valuation.";
    }
    if (locale === "zh") {
      const source = base.source === "listing price"
        ? "\u6302\u724c\u4ef7"
        : base.source === "CV"
          ? "CV"
          : base.source === "average comparable sale"
            ? "\u53ef\u6bd4\u6210\u4ea4\u5747\u503c"
            : "\u62a5\u544a\u6a21\u578b\u4f30\u7b97\u7684\u603b\u552e\u503c";
      return `\u5e02\u573a\u4ef7\u503c\u7c97\u4f30\uff1a\u7ea6 ${formatNZD(base.amount)}\uff0c\u4f9d\u636e\u662f\u62a5\u544a\u4e2d\u7684${source}\u3002\u8fd9\u662f\u53c2\u8003\u4f30\u7b97\uff0c\u4e0d\u7b49\u540c\u4e8e\u6ce8\u518c\u4f30\u4ef7\u6216\u5b9e\u9645\u6210\u4ea4\u4ef7\u3002`;
    }
    return `Estimated market value: about ${formatNZD(base.amount)}, using the report's ${base.source}. Treat this as an indicative estimate, not a registered valuation or confirmed sale price.`;
  }

  const base = reportPurchaseBase(report);
  if (!base) {
    return locale === "zh"
      ? ZH_NO_BASE
      : "Rental ownership cost: the report does not have a confirmed price or CV, so I would not put a dollar figure on it. Use: purchase price or CV + professional fees + finance interest; at 80% lending and 7.0% p.a., annual interest is roughly price x 80% x 7.0%.";
  }

  const professionalFee = Math.round(base.amount * PROFESSIONAL_FEE_RATE);
  const annualInterest = Math.round(base.amount * DEFAULT_LVR * DEFAULT_INTEREST_RATE);
  const weeklyInterest = Math.round(annualInterest / 52);
  const firstYearCost = base.amount + professionalFee + annualInterest;

  if (locale === "zh") {
    const source = base.source === "listing price" ? ZH_LISTING_PRICE : ZH_CV;
    return `\u79df\u8d41\u6301\u6709\u6210\u672c\u7c97\u7b97\uff1a\u6309${source} ${formatNZD(base.amount)}\uff0c\u4e13\u4e1a\u8d39\u7528\u5148\u6309\u7ea6 1.5% \u4f30 ${formatNZD(professionalFee)}\uff1b\u82e5\u6309 80% \u8d37\u6b3e\u30017.0% \u5e74\u5229\u7387\uff0c\u5229\u606f\u7ea6 ${formatNZD(annualInterest)}/\u5e74\uff08\u7ea6 ${formatNZD(weeklyInterest)}/\u5468\uff09\u3002\u9996\u5e74\u4e70\u5165+\u4e13\u4e1a\u8d39+\u5229\u606f\u7ea6 ${formatNZD(firstYearCost)}\uff0c\u672a\u542b\u5730\u7a0e\u3001\u4fdd\u9669\u3001\u7ef4\u4fee\u548c\u7a7a\u7f6e\u671f\u3002`;
  }

  return `Rental ownership cost, roughly: using the report's ${base.source} of ${formatNZD(base.amount)}, allow about ${formatNZD(professionalFee)} for professional fees (1.5%). At 80% lending and 7.0% p.a., interest is about ${formatNZD(annualInterest)}/year (${formatNZD(weeklyInterest)}/week). First-year purchase + fees + interest is about ${formatNZD(firstYearCost)}, before rates, insurance, maintenance, and vacancy.`;
}

export function buildPostAnalysisAnswers(
  message: string,
  report: Record<string, unknown> | null | undefined,
  locale: Locale = "en",
): string[] {
  if (!report) return [];
  const parts = detectPostAnalysisIntents(message)
    .map((intent) => buildIntentAnswer(intent, message, report, locale))
    .filter((p): p is string => !!p);
  const notice = buildDevScoreNotice(report, locale);
  if (notice) parts.push(notice);
  return parts;
}

export function buildPostAnalysisAnswer(
  message: string,
  report: Record<string, unknown> | null | undefined,
  locale: Locale = "en",
): string | null {
  const combined = buildPostAnalysisAnswers(message, report, locale).join("\n\n");
  return combined || null;
}
