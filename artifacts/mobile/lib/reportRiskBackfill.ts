/**
 * Keep aligned with `artifacts/api-server/src/lib/report-risk-backfill.ts` — same
 * candidate sentences so cached reports get ≥3 factual risk bullets client-side.
 */
import type { FeasibilityReport } from "@/context/ChatContext";
import { isIncompleteDataDisclaimerRiskBullet } from "./riskSummaryIncompleteDataFilter";

export interface RiskBackfillContext {
  isZh: boolean;
  zoneCode: string | null;
  zoneLabel: string | null;
  potentialLots: number;
  netAreaSqm: number | null;
  minLotSqm: number | null;
  overlays: Array<{ name: string; status: string }>;
  contour: "flat" | "subtle" | "gentle" | "moderate" | "steep" | "very_steep" | null;
  infrastructure: Array<{ name: string; location: string; risk: string }>;
  estateType: string | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function redundantWithList(candidate: string, existing: string[]): boolean {
  if (!candidate.trim()) return true;
  if (isIncompleteDataDisclaimerRiskBullet(candidate)) return true;
  const c = norm(candidate);
  if (c.length < 20) return false;
  for (const e of existing) {
    const en = norm(e);
    if (en.length < 20) continue;
    const shorter = c.length <= en.length ? c : en;
    const longer = c.length > en.length ? c : en;
    const head = shorter.slice(0, Math.min(36, shorter.length));
    if (longer.includes(head)) return true;
  }
  return false;
}

function overlayRiskSentence(o: { name: string; status: string }, isZh: boolean): string | null {
  if (o.status !== "restricted" && o.status !== "moderate") return null;
  const n = o.name.toLowerCase();
  if (n.includes("flood")) {
    return isZh
      ? "洪水敏感区通常对场地标高、地板高度与雨水排放有更严格要求，工程设计需满足议会相关技术标准。"
      : "Flood-sensitive overlays typically tighten finished floor levels and stormwater discharge — engineered drainage usually needs to satisfy council standards.";
  }
  if (n.includes("heritage")) {
    return isZh
      ? "遗产相关管控可能影响拆除范围与外立面改动，实质性工程前宜尽早做遗产影响评估。"
      : "Heritage controls can restrict demolition and façade changes — an early heritage impact assessment is often worthwhile.";
  }
  if (n.includes("coastal") || n.includes("hazard")) {
    return isZh
      ? "海岸或自然灾害敏感叠加层可能限制临海侧的建筑体量与退让，请对照现行图则核对高度与侵蚀防控要求。"
      : "Coastal or coastal-hazard overlays may limit built form and setbacks toward the water — check the operative maps for height and erosion controls.";
  }
  if (n.includes("tree")) {
    return isZh
      ? "显著树木保护层可能限制开挖、车道位置与建筑体量，设计时需避开受保护树冠与根系范围。"
      : "Notable tree overlays can constrain excavation, driveways, and building bulk around protected canopies and root zones.";
  }
  if (n.includes("volcanic") || n.includes("viewshaft") || n.includes("view shaft")) {
    return isZh
      ? "火山景观廊道等叠加层常限制高度与屋面轮廓，以避免遮挡区域景观视廊。"
      : "Volcanic viewshaft-type overlays often cap height and roof profiles to preserve designated view corridors.";
  }
  if (n.includes("landslip") || n.includes("erosion")) {
    return isZh
      ? "滑坡或侵蚀敏感区常要求更陡边坡处的岩土勘察与稳定方案。"
      : "Landslip or erosion overlays usually trigger geotechnical investigation and stabilisation design on vulnerable batters.";
  }
  return isZh
    ? `「${o.name}」叠加层标记为需额外审慎对待，建设前应把该层要求纳入总体设计与许可策略。`
    : `The "${o.name}" overlay is flagged as requiring extra care — fold its requirements into early design and consent strategy.`;
}

function zoneSentence(ctx: RiskBackfillContext): string | null {
  const { isZh, zoneCode, zoneLabel, potentialLots, minLotSqm } = ctx;
  const zc = (zoneCode ?? "").trim().toUpperCase();
  const zl = (zoneLabel ?? "").trim();

  if (zc === "SHZ" || /single house zone/i.test(zl)) {
    return isZh
      ? "独立住宅区（SHZ）对净地块上的住宅数量与建筑覆盖率有限制；加建或分割前须核对最小地块面积、院落与高度控制是否允许预期户型布局。"
      : "Single House Zone limits how many dwellings and how much coverage fit on the net site — confirm minimum lot size, yards, and height against your intended layout before assuming extra units.";
  }
  if (zc === "MHS" || /mixed housing suburban/i.test(zl)) {
    return isZh
      ? "混合住房郊区（MHS）允许中等强度开发，但仍对后院、高度与临街立面有明确要求，需提供满足规范的建筑方案。"
      : "Mixed Housing Suburban allows moderate intensity, but outdoor space, height, and street-facing façades still have to meet code — design needs to prove compliance.";
  }
  if (zc === "MHU" || /mixed housing urban/i.test(zl)) {
    return isZh
      ? "混合住房城市区（MHU）倾向更高密度，需同时处理停车、私密性与相邻物业的日照与景观影响。"
      : "Mixed Housing Urban skews denser — parking, privacy, and effects on neighbours’ outlook and daylight need explicit resolution.";
  }
  if (zc === "THAB" || /terrace housing and apartment/i.test(zl)) {
    return isZh
      ? "联排与公寓建筑区（THAB）以实现中高密为主，设计方案通常要论证居住舒适度、停车与对周边街区的体量关系。"
      : "Terrace Housing and Apartment Buildings zoning targets medium–high density — designs usually must address amenity, parking, and bulk relative to adjoining streets.";
  }
  if (zc === "LLRZ" || zc === "LSZ" || zc === "RUR" || /large lot|rural/i.test(zl)) {
    return isZh
      ? "大地块或农村类分区往往限制可建住宅数量并拉长公用设施接驳距离，整体工期与资金占用需按多块地统筹估算。"
      : "Large-lot or rural-style zoning usually caps how many dwellings stack on the land and stretches services — programme and capital need to be planned across the whole holding.";
  }
  if (zl) {
    return isZh
      ? `本报告采用的规划分区为「${zl}」${potentialLots > 1 ? `（约 ${potentialLots} 个潜在住宅地块）` : ""}；建筑体量、退让与停车布置须与该分区规则一致${minLotSqm != null && minLotSqm > 0 ? `（最小净地块约 ${Math.round(minLotSqm)} m²）` : ""}。`
      : `This report uses zoning as ${zl}${potentialLots > 1 ? ` (~${potentialLots} potential lots)` : ""} — bulk, setbacks, and parking must align with those controls${minLotSqm != null && minLotSqm > 0 ? ` (minimum lot size ≈ ${Math.round(minLotSqm)} m²)` : ""}.`;
  }
  return null;
}

function terrainSentence(ctx: RiskBackfillContext): string | null {
  const { isZh, contour } = ctx;
  if (contour === "very_steep") {
    return isZh
      ? "极陡地形通常意味着高成本地基、挡土墙和岩土工程风险；在确认开发布局前，应先完成地形测量和岩土工程复核。"
      : "Very steep terrain usually means high-cost foundations, retaining, and geotechnical risk; confirm survey and geotech advice before relying on a development layout.";
  }
  if (contour === "steep") {
    return isZh
      ? "场地坡度较陡时挡土墙与平整工程量显著，岩土勘察与雨水径流路径应尽早纳入总图。"
      : "Steep sites usually mean substantial retaining and earthworks — geotech and overland stormwater paths should be locked in early.";
  }
  if (contour === "moderate") {
    return isZh
      ? "中等坡度场地可能需要分台与局部挡土结构，建造标高需兼顾车道坡度与排水。"
      : "Moderate slopes often need benching and local retaining — finished levels must work for driveway grades and drainage.";
  }
  return null;
}

function infrastructureSentence(ctx: RiskBackfillContext): string | null {
  const { isZh, infrastructure: items } = ctx;
  const risky = items.filter(
    (i) =>
      (i.location === "neighbour" || i.location === "boundary") &&
      (i.risk === "moderate" || i.risk === "high"),
  );
  if (risky.length === 0) return null;
  return isZh
    ? "主要市政管线贴近地块边界或位于邻地一侧时，接驳、改线或共墙施工可能带来额外工程协调与费用，应在方案阶段预留余地。"
    : "Major council services hugging the boundary or sitting on adjoining land can add tie-in, diversion, or co-build coordination — budget and programme should allow for that in early design.";
}

function crossLeaseSentence(ctx: RiskBackfillContext): string | null {
  const et = (ctx.estateType ?? "").toLowerCase();
  if (!et.includes("cross") && !et.includes("stratum")) return null;
  return ctx.isZh
    ? "交叉租赁或分层产权下，改建与外墙维护常需与其他产权方协商，可能限制拆除与加建位置。"
    : "Cross-lease or stratum titles often need co-owner agreement for rebuilds and façades — that can constrain where and how you extend.";
}

function netAreaZoneSentence(ctx: RiskBackfillContext): string | null {
  const { isZh, netAreaSqm, zoneLabel } = ctx;
  const zl = (zoneLabel ?? "").trim();
  if (netAreaSqm == null || netAreaSqm <= 0 || !zl) return null;
  return isZh
    ? `在约 ${Math.round(netAreaSqm)} m² 的净用地与当前分区前提下，建筑覆盖率与室外活动场地需同时满足规范，避免方案在后期因退让不足而返工。`
    : `On ~${Math.round(netAreaSqm)} m² net area under the current zone, building coverage and usable outdoor space both have to stack up — weak yard or coverage assumptions get unwound late in consent.`;
}

function multiLotDrivewaySentence(ctx: RiskBackfillContext): string | null {
  const n = ctx.potentialLots;
  if (n < 2 || n >= 4) return null;
  return ctx.isZh
    ? `约 ${n} 个潜在地块时，车道坡度、转弯半径与雨污水主管走向通常要一次性统筹，否则后期分块施工易产生冲突。`
    : `With ~${n} potential lots, driveway grades, turning, and trunk services need a single master plan — phasing without that often clashes on site.`;
}

function genericConsentSentence(ctx: RiskBackfillContext): string {
  return ctx.isZh
    ? "实际项目通常需资源许可与建筑许可并联或顺接推进，现场条件、邻居意见与施工图深化都会反作用于可建范围与工期。"
    : "Live projects usually chase resource and building consent together or in sequence — site conditions, neighbour feedback, and design development all feed back into what can be built and how fast.";
}

function buildRiskBackfillCandidates(ctx: RiskBackfillContext): string[] {
  const out: string[] = [];

  const zs = zoneSentence(ctx);
  if (zs) out.push(zs);

  let overlayAdds = 0;
  for (const o of ctx.overlays) {
    if (overlayAdds >= 2) break;
    const b = overlayRiskSentence(o, ctx.isZh);
    if (b) {
      out.push(b);
      overlayAdds++;
    }
  }

  const ts = terrainSentence(ctx);
  if (ts) out.push(ts);

  const is = infrastructureSentence(ctx);
  if (is) out.push(is);

  const cs = crossLeaseSentence(ctx);
  if (cs) out.push(cs);

  const ms = multiLotDrivewaySentence(ctx);
  if (ms) out.push(ms);

  const ns = netAreaZoneSentence(ctx);
  if (ns) out.push(ns);

  out.push(genericConsentSentence(ctx));

  return out;
}

function emergencyFallbackBullets(ctx: RiskBackfillContext): string[] {
  if (ctx.isZh) {
    return [
      "施工图与许可阶段应在总图上逐一核对停车位、雨水排放落点与市政接口位置，减少与现场既有设施冲突。",
      "若建筑轮廓或层数相对现状有调整，应复核地基与邻近界墙安全，必要时加强基础或挡土设计。",
      "销售或建设若分期推进，持有期利息与运维费用会显著影响现金流，应在资金计划中单独列项测算。",
    ];
  }
  return [
    "Before lodging consent, pin stall counts, stormwater discharge points, and utility offsets on the site plan — late clashes with live services are costly.",
    "If the footprint or storey count moves from what is there today, check foundation capacity and fences on the boundaries — upgrades are common.",
    "Phased sales or construction stretches holding costs — model interest and operating carry explicitly in the cashflow.",
  ];
}

export function ensureMinRiskSummaryBulletsFromReport(
  bullets: string[],
  min: number,
  ctx: RiskBackfillContext,
): string[] {
  const out = bullets.filter((b) => typeof b === "string" && b.trim().length > 0);
  if (out.length >= min) return out;

  for (const c of buildRiskBackfillCandidates(ctx)) {
    if (out.length >= min) break;
    if (redundantWithList(c, out)) continue;
    out.push(c);
  }
  for (const e of emergencyFallbackBullets(ctx)) {
    if (out.length >= min) break;
    if (redundantWithList(e, out)) continue;
    out.push(e);
  }
  return out;
}

function inferZoneCodeFromLabel(zl: string): string | null {
  if (!zl.trim()) return null;
  const u = zl.toUpperCase();
  if (/\bSHZ\b/.test(u) || u.includes("SINGLE HOUSE ZONE")) return "SHZ";
  if (/\bMHS\b/.test(u) || u.includes("MIXED HOUSING SUBURBAN")) return "MHS";
  if (/\bMHU\b/.test(u) || u.includes("MIXED HOUSING URBAN")) return "MHU";
  if (/\bTHAB\b/.test(u) || u.includes("TERRACE HOUSING AND APARTMENT")) return "THAB";
  if (/\b(LLRZ|LDRZ|RUR|LSZ)\b/.test(u) || u.includes("LARGE LOT") || u.includes("RURAL")) return "LLRZ";
  return null;
}

function parseMinLotSqm(minLotSize?: string): number | null {
  if (!minLotSize?.trim()) return null;
  const n = parseInt(minLotSize.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 50 ? n : null;
}

export function feasibilityReportToRiskContext(report: FeasibilityReport, isZh: boolean): RiskBackfillContext {
  const plan = report.planning;
  const zl =
    [report.zone_label, plan?.zone, report.propertyOverview?.zone].find(
      (s): s is string => typeof s === "string" && !!s.trim(),
    )?.trim() ?? null;
  const zc = zl ? inferZoneCodeFromLabel(zl) : null;
  const overlays = (plan?.overlays ?? []).map((o) => ({ name: o.name, status: o.status }));
  const infra = (report.infrastructure ?? []).map((i) => ({
    name: i.name,
    location: i.location === "off-parcel" ? "unknown" : i.location,
    risk: i.risk,
  }));

  return {
    isZh,
    zoneCode: zc,
    zoneLabel: zl,
    potentialLots: report.potential_lots ?? plan?.potentialLots ?? 0,
    netAreaSqm: plan?.netAreaSqm ?? null,
    minLotSqm: parseMinLotSqm(plan?.minLotSize) ?? null,
    overlays,
    contour: report.terrain?.classification ?? null,
    infrastructure: infra,
    estateType: report.propertyOverview?.titleType ?? null,
  };
}

export function ensureRiskSummaryMinForReport(
  report: FeasibilityReport,
  bullets: string[],
  min = 3,
): string[] {
  const isZh = bullets.some((b) => /[\u4e00-\u9fff]/.test(b));
  return ensureMinRiskSummaryBulletsFromReport(bullets, min, feasibilityReportToRiskContext(report, isZh));
}
