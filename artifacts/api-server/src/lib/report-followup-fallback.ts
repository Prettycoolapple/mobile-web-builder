import type { Locale } from "./prompts";

/**
 * Last-resort answers for follow-up questions about an open feasibility report,
 * built straight from the report data with no LLM involved.
 *
 * The chat turn normally goes through the language model. When the provider is
 * down (or every retry fails) the user used to get "couldn't reach the service"
 * for questions the report already answers — risks, cost breakdown, ROI,
 * zoning, infrastructure. These builders quote the stored figures verbatim so a
 * provider outage degrades to a shorter answer instead of a dead conversation.
 *
 * Everything here must come from the report. Nothing is inferred or estimated.
 */

type ReportRecord = Record<string, unknown>;

function asRecord(value: unknown): ReportRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ReportRecord) : null;
}

function asArrayOfRecords(value: unknown): ReportRecord[] {
  return Array.isArray(value) ? value.filter((v): v is ReportRecord => !!v && typeof v === "object") : [];
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
    : [];
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function nzd(value: unknown): string | null {
  const n = numberOf(value);
  return n != null && n > 0 ? `$${Math.round(n).toLocaleString("en-NZ")}` : null;
}

function range(low: unknown, high: unknown): string | null {
  const lo = nzd(low);
  const hi = nzd(high);
  if (lo && hi) return lo === hi ? lo : `${lo} – ${hi}`;
  return lo ?? hi;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export type ReportFollowUpTopic = "risks" | "costs" | "roi" | "planning" | "infrastructure" | "consent_process";

const TOPIC_PATTERNS: Array<{ topic: ReportFollowUpTopic; en: RegExp; zh: RegExp }> = [
  {
    topic: "consent_process",
    en: /\b(consent(?:ing)? process|resource consent|building consent|approval process|approvals? (?:process|pathway|steps)|consent pathway|what.{0,20}steps|council process|how long.{0,30}(?:consent|approval))\b/i,
    zh: /(审批流程|審批流程|报建|報建|资源同意|資源同意|建筑许可|建築許可|申请流程|申請流程|报批|報批|审批|審批)/u,
  },
  {
    topic: "risks",
    en: /\b(risks?|red flags?|concerns?|watch ?outs?|what could go wrong|downsides?)\b/i,
    zh: /(风险|風險|隐患|隱患|问题点|問題點|注意事项|注意事項)/u,
  },
  {
    topic: "costs",
    en: /\b(cost|costs|costing|budget|expenses?|breakdown|how much.{0,25}(?:cost|build|develop)|price to build)\b/i,
    zh: /(成本|费用|費用|预算|預算|造价|造價|花多少|明细|明細)/u,
  },
  {
    topic: "roi",
    en: /\b(roi|return on investment|returns?|profit|margin|yield|gdv|feasib\w*|make money|worth doing)\b/i,
    zh: /(回报|回報|利润|利潤|收益|毛利|可行性|赚钱|賺錢|投资回报|投資回報)/u,
  },
  {
    topic: "planning",
    en: /\b(zon(?:e|ing)|planning|overlays?|lots?|subdivid\w*|subdivision|density|site coverage|hirb|height)\b/i,
    zh: /(分区|分區|规划|規劃|区划|區劃|覆盖|覆蓋|地块|地塊|分割|细分|細分|密度|限高)/u,
  },
  {
    topic: "infrastructure",
    en: /\b(infrastructure|services?|water|wastewater|stormwater|sewer|power|connections?)\b/i,
    zh: /(基础设施|基礎設施|市政|供水|污水|雨水|排水|电力|電力|接驳|接駁)/u,
  },
];

/** The report topic a follow-up question is asking about, if we can answer it offline. */
export function detectReportFollowUpTopic(message: string): ReportFollowUpTopic | null {
  if (!message?.trim()) return null;
  for (const { topic, en, zh } of TOPIC_PATTERNS) {
    if (en.test(message) || zh.test(message)) return topic;
  }
  return null;
}

function reportAddress(report: ReportRecord): string | null {
  const overview = asRecord(report["property_overview_snapshot"]) ?? asRecord(report["propertyOverview"]);
  return textOf(report["address"]) ?? textOf(overview?.["address"]);
}

function buildRisksAnswer(report: ReportRecord, locale: Locale): string | null {
  const risks = stringsOf(report["riskSummary"]).slice(0, 8);
  if (risks.length === 0) return null;
  const heading = locale === "zh" ? "报告中列出的主要风险：" : "The key risks recorded in this report:";
  return [heading, ...risks.map((risk, i) => `${i + 1}. ${risk}`)].join("\n");
}

function buildCostsAnswer(report: ReportRecord, locale: Locale): string | null {
  const lines: string[] = [];
  for (const item of asArrayOfRecords(report["costItems"])) {
    const label = textOf(item["label"]);
    const amount = range(item["low"], item["high"]);
    if (label && amount) lines.push(`• ${label}: ${amount}`);
  }
  const total = range(report["totalCostLow"], report["totalCostHigh"]);
  if (lines.length === 0 && !total) return null;

  const heading = locale === "zh" ? "报告中的开发成本估算：" : "The development cost estimate in this report:";
  const parts = [heading, ...lines];
  if (total) parts.push(locale === "zh" ? `合计：${total}` : `Total: ${total}`);
  const perUnit = nzd(report["cost_per_unit_avg"]);
  if (perUnit) parts.push(locale === "zh" ? `每户平均：${perUnit}` : `Per unit average: ${perUnit}`);
  if (report["total_excludes_land"] === true) {
    parts.push(locale === "zh" ? "（合计不含土地成本。）" : "(The total excludes the land cost.)");
  }
  return parts.join("\n");
}

function buildRoiAnswer(report: ReportRecord, locale: Locale): string | null {
  const lines: string[] = [];
  for (const scenario of asArrayOfRecords(report["roiScenarios"])) {
    const years = numberOf(scenario["years"]);
    const cases = asArrayOfRecords(scenario["cases"]);
    const caseText = cases
      .map((c) => {
        const label = textOf(c["case"]);
        const gdv = nzd(c["gdv"]);
        const profit = nzd(c["gross_profit"]);
        const roi = numberOf(c["roi_percent"]);
        const bits = [gdv ? `GDV ${gdv}` : null, profit ? `profit ${profit}` : null, roi != null ? `ROI ${roi}%` : null]
          .filter(Boolean)
          .join(", ");
        return label && bits ? `${label}: ${bits}` : null;
      })
      .filter(Boolean)
      .join(" | ");
    if (years != null && caseText) lines.push(`• ${years}yr — ${caseText}`);
  }
  if (lines.length === 0) return null;
  const heading = locale === "zh" ? "报告中的投资回报测算：" : "The ROI scenarios in this report:";
  return [heading, ...lines].join("\n");
}

function buildPlanningAnswer(report: ReportRecord, locale: Locale): string | null {
  const planning = asRecord(report["planning"]);
  const overview = asRecord(report["property_overview_snapshot"]) ?? asRecord(report["propertyOverview"]);
  const parts: string[] = [];
  const zone = textOf(report["zone_label"]) ?? textOf(planning?.["zone"]) ?? textOf(overview?.["zone"]);
  const zoneCode = textOf(report["zone_code"]);
  if (zone) parts.push(locale === "zh" ? `分区：${zone}${zoneCode ? `（${zoneCode}）` : ""}` : `Zone: ${zone}${zoneCode ? ` (${zoneCode})` : ""}`);
  const lots = numberOf(planning?.["potentialLots"] ?? report["potential_lots"]);
  if (lots != null) parts.push(locale === "zh" ? `可能地块数：${lots}` : `Potential lots: ${lots}`);
  const minLot = textOf(planning?.["minLotSize"]) ?? (numberOf(planning?.["minLotSize"]) != null ? `${numberOf(planning?.["minLotSize"])}m²` : null);
  if (minLot) parts.push(locale === "zh" ? `最小地块面积：${minLot}` : `Minimum lot size: ${minLot}`);
  const net = numberOf(planning?.["netAreaSqm"]);
  if (net != null) parts.push(locale === "zh" ? `可分割净面积：${net}m²` : `Net subdividable area: ${net}m²`);
  const summary = textOf(planning?.["subdivisionSummary"]);
  if (summary) parts.push(summary);
  const overlays = asArrayOfRecords(planning?.["overlays"])
    .map((o) => {
      const name = textOf(o["name"]);
      const status = textOf(o["status"]);
      return name ? `• ${name}${status ? `: ${status}` : ""}` : null;
    })
    .filter(Boolean) as string[];
  if (overlays.length > 0) {
    parts.push(locale === "zh" ? "叠加层：" : "Overlays:");
    parts.push(...overlays.slice(0, 8));
  }
  if (parts.length === 0) return null;
  const heading = locale === "zh" ? "报告中的规划信息：" : "The planning position in this report:";
  return [heading, ...parts].join("\n");
}

function buildInfrastructureAnswer(report: ReportRecord, locale: Locale): string | null {
  const lines = asArrayOfRecords(report["infrastructure"])
    .map((inf) => {
      const name = textOf(inf["name"]);
      if (!name) return null;
      const location = textOf(inf["location"]);
      const distance = numberOf(inf["distance_metres"]);
      const risk = textOf(inf["risk"]);
      const cost = range(inf["estimatedCostLow"], inf["estimatedCostHigh"]);
      const bits = [
        location,
        distance != null ? `~${Math.round(distance)}m` : null,
        risk ? (locale === "zh" ? `风险：${risk}` : `risk: ${risk}`) : null,
        cost ? (locale === "zh" ? `成本 ${cost}` : `cost ${cost}`) : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `• ${name}${bits ? ` — ${bits}` : ""}`;
    })
    .filter(Boolean) as string[];
  if (lines.length === 0) return null;
  const heading = locale === "zh" ? "报告中的基础设施情况：" : "The infrastructure position in this report:";
  return [heading, ...lines].join("\n");
}

function buildConsentProcessAnswer(report: ReportRecord, locale: Locale): string | null {
  // No consent walkthrough is invented here — only what the report holds about
  // the planning pathway, which is what the staged process hangs off.
  const planning = buildPlanningAnswer(report, locale);
  const risks = stringsOf(report["riskSummary"]).slice(0, 4);
  if (!planning && risks.length === 0) return null;
  const parts: string[] = [];
  if (planning) parts.push(planning);
  if (risks.length > 0) {
    parts.push(locale === "zh" ? "\n影响审批的已知因素：" : "\nKnown factors that affect consenting:");
    parts.push(...risks.map((risk, i) => `${i + 1}. ${risk}`));
  }
  return parts.join("\n");
}

const UNAVAILABLE_NOTE = {
  en: "\n\n(The AI assistant is temporarily unavailable, so this comes straight from your report data. Ask again shortly for the full explanation.)",
  zh: "\n\n（AI 助手暂时不可用，以上内容直接取自报告数据。稍后再问即可获得完整解读。）",
};

/**
 * Answer a follow-up from the report alone. Returns null when the question
 * isn't one the stored data can answer — the caller should then surface an
 * honest "try again" message rather than guessing.
 */
export function buildReportFollowUpFallback(
  message: string,
  reportOrGroup: Record<string, unknown> | null | undefined,
  locale: Locale = "en",
): string | null {
  if (!reportOrGroup) return null;
  // Combined listing packages send the whole group as chat context; answer from
  // its first report rather than giving up.
  const groupReports = Array.isArray(reportOrGroup["reports"]) ? asArrayOfRecords(reportOrGroup["reports"]) : [];
  const report = groupReports[0] ?? reportOrGroup;
  const topic = detectReportFollowUpTopic(message);
  if (!topic) return null;

  const answer =
    topic === "risks" ? buildRisksAnswer(report, locale)
    : topic === "costs" ? buildCostsAnswer(report, locale)
    : topic === "roi" ? buildRoiAnswer(report, locale)
    : topic === "planning" ? buildPlanningAnswer(report, locale)
    : topic === "infrastructure" ? buildInfrastructureAnswer(report, locale)
    : buildConsentProcessAnswer(report, locale);
  if (!answer) return null;

  const address = reportAddress(report);
  const header = address ? `${address}\n` : "";
  return `${header}${answer}${locale === "zh" ? UNAVAILABLE_NOTE.zh : UNAVAILABLE_NOTE.en}`;
}
