import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useAuth } from "@/context/AuthContext";
import { getApiBase } from "@/lib/api";
import Svg, { Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { StarRating } from "@/components/StarRating";
import { prefetchSitePlanAssets, SitePlanCard } from "@/components/report/SitePlanCard";
import { useWatchlist, type WatchlistCandidate } from "@/context/WatchlistContext";
import { useColors } from "@/hooks/useColors";
import { useT, translate, translateForOS, isOSChineseLocale } from "@/lib/i18n";
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";
import { shareReport } from "@/lib/propertyShares";
import { confirmRemoveFromWatchlist, notifyWatchlistError } from "@/lib/watchlist-confirm";
import {
  filterRiskSummaryRemoveIncompleteDataDisclaimerBullets,
  filterScoreReasonStrings,
} from "@/lib/riskSummaryIncompleteDataFilter";
import { ensureRiskSummaryMinForReport } from "@/lib/reportRiskBackfill";
import { formatTitleTypeForDisplay, localiseTitleTypeZh } from "@/lib/titleDisplay";
import { viaImageProxy, streetViewUrlFor, staticMapUrlFor } from "@/lib/reportPhotoCache";
import {
  FeasibilityReport as Report,
  ROIScenario,
  ROICaseResult,
  CostItem,
  InfrastructureService,
  ComparableSale,
  AsbestosInfo,
  PlanningOverlay,
  PlanningInfo,
  EasementEntry,
  DevelopmentStrategyScenario,
  DevelopmentStrategyId,
  SchoolZoneDetail,
  NeighbourhoodContext,
  TransportContext,
  BuiltEnvironmentContext,
  TitleInsight,
} from "@/context/ChatContext";

/** Comparable sale address cards are hidden for now; `comparableSales` remains on the report for ROI logic. Set to true to show cards again. */
const SHOW_COMPARABLE_SALES_IN_UI = false;

interface Props {
  report: Report;
  onFollowUp: (question: string) => void;
  onAnalyseProperty?: (address: string) => void;
}

function formatNZD(n: number | string | undefined | null): string {
  const num = n == null ? NaN : Number(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${Math.round(num / 1_000).toLocaleString()}k`;
  return `$${Math.round(num).toLocaleString()}`;
}

function formatSignedNZD(n: number | string | undefined | null): string {
  const num = n == null ? NaN : Number(n);
  if (isNaN(num)) return "—";
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  return `${sign}${formatNZD(Math.abs(num))}`;
}

function formatDistanceM(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(Number(m))) return "unknown";
  const n = Number(m);
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(n)} m`;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function capitalize(s: string | undefined): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function localisePropertyType(value: string, t: (key: string) => string): string {
  const raw = value.trim();
  if (!isOSChineseLocale()) return raw;
  switch (raw.toUpperCase()) {
    case "RESIDENTIAL":
      return t("report.property_type_residential");
    case "COMMERCIAL":
      return t("report.property_type_commercial");
    case "INDUSTRIAL":
      return t("report.property_type_industrial");
    case "RURAL":
      return t("report.property_type_rural");
    default:
      return raw;
  }
}

function localiseSiteStatusLabel(
  siteStatus: NonNullable<Report["propertyOverview"]>["siteStatus"] | undefined,
  fallbackLabel: string | undefined,
  t: (key: string) => string,
): string {
  if (siteStatus === "has_dwelling") return t("report.site_status_has_dwelling");
  if (siteStatus === "vacant_land") return t("report.site_status_vacant_land");
  if (siteStatus === "unknown") return t("report.site_status_unknown");
  return fallbackLabel || t("report.site_status_unknown");
}

function hasCjk(text: string | null | undefined): boolean {
  return typeof text === "string" && /[\u3400-\u9fff]/.test(text);
}

function localiseTitleInsightZh(insight: TitleInsight | null | undefined): TitleInsight | null | undefined {
  if (!insight?.isCrossLease) return insight;
  const zhRisks = [
    "交叉租赁（Cross Lease）产权下，任何重建、加建或外墙改动通常都需要其他交叉租赁产权方书面同意，这会直接限制开发自由度，也是相较 Freehold 的核心劣势。",
    "若考虑将交叉租赁转换为独立产权（Freehold），通常需要规划师、建筑/设计师、测量与法律共同参与，涉及时间与费用成本，且需要所有相关方配合。",
    "若计划合并，例如收购邻近交叉租赁物业并一并转换，其可行性、价值释放与风险都应先由专业人士正式评估后再决策。",
  ];
  return {
    ...insight,
    titleType: localiseTitleTypeZh(insight.titleType) ?? insight.titleType,
    opportunity: hasCjk(insight.opportunity)
      ? insight.opportunity
      : "交叉租赁（Cross Lease）物业通常比同区 Freehold 便宜。若你有足够资金，可考虑收购相邻的交叉租赁物业，将两者一并转换为独立 Freehold 产权，这往往能释放可观价值。这类转换需要规划师、建筑/设计师等专业人士评估所需工作与投资规模，建议先获取专业意见再决策。",
    risks: (insight.risks ?? []).map((risk, idx) => (hasCjk(risk) ? risk : zhRisks[idx] ?? risk)),
  };
}

function scoreColor(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 4) return colors.success;
  if (score >= 2.5) return colors.amber;
  return colors.red;
}

function getAsbestosRisk(a: AsbestosInfo): "low" | "high" | "unknown" | "moderate" {
  return (a.risk || a.riskLevel || "unknown") as any;
}

function getInfraLabel(loc: string, t: (key: string) => string): string {
  switch (loc) {
    case "on-parcel":  return t("report.infra_on_parcel");
    case "boundary":   return t("report.infra_boundary");
    case "neighbour":  return t("report.infra_neighbour");
    case "public-land":return t("report.infra_public_road");
    case "unknown":    return t("report.infra_unknown");
    default:           return t("report.infra_unknown");
  }
}

function cleanInfrastructureNote(note: string): string {
  return note
    .replace(/\s*[\(\uff08]\s*(?:~|approx\.?|approximately|约)\s*\d+(?:\.\d+)?\s*(?:m|metres?|meters?|米)\s*(?:from\s+[^)\uff09]+)?[\)\uff09]/gi, "")
    .replace(/\s*[\(\uff08]\s*\d+(?:\.\d+)?\s*(?:m|metres?|meters?|米)\s*(?:from\s+[^)\uff09]+)?[\)\uff09]/gi, "")
    .replace(/\s+([,.;，。；])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function localizeRiskSummaryItem(item: string, osChinese: boolean): string {
  const cleaned = item.trim();
  if (!osChinese || /[\u3400-\u9fff]/.test(cleaned)) return cleaned;

  const elevatedAsbestos = cleaned.match(
    /^Elevated asbestos risk\s*[—–-]\s*(built\s+(\d{4})|build year unknown)\s*\(1940[–-]1990 era\);\s*licensed removal required,\s*demolition cost\s*(.+?)[,;]\s*WorkSafe notification needed\.?$/i,
  );
  if (elevatedAsbestos) {
    const buildYear = elevatedAsbestos[2];
    const buildText = buildYear ? `${buildYear} 年建造` : "建造年份未知";
    const cost = (elevatedAsbestos[3] ?? "").trim();
    return `石棉风险高 — ${buildText}（1940–1990 年建筑期），需要持证清除，拆除费用约 ${cost}，须向 WorkSafe 申报。`;
  }

  return cleaned;
}

function hasOverlay(report: Report, keyword: string): boolean {
  const overlays = report.planning?.overlays ?? [];
  return overlays.some(
    (o) =>
      o.name.toLowerCase().includes(keyword.toLowerCase()) &&
      (o.status === "restricted" || o.status === "moderate")
  );
}

function overlayStatus(report: Report): "good" | "warning" | "risk" | "neutral" {
  const overlays = report.planning?.overlays ?? [];
  if (overlays.some((o) => o.status === "restricted")) return "risk";
  if (overlays.some((o) => o.status === "moderate")) return "warning";
  return "good";
}

function contourStatus(terrain: Report["terrain"]): "good" | "warning" | "risk" | "neutral" {
  if (!terrain || terrain.classification === null) return "neutral";
  if (terrain.classification === "steep" || terrain.classification === "very_steep") return "risk";
  if (terrain.classification === "moderate") return "warning";
  return "good";
}

function infraStatus(infra: Report["infrastructure"]): "good" | "warning" | "risk" | "neutral" {
  if (!infra || infra.length === 0) return "neutral";
  if (infra.some((s) => s.location === "neighbour")) return "warning";
  return "good";
}

function roiStatus(score: number): "good" | "warning" | "risk" | "neutral" {
  if (score >= 4) return "good";
  if (score >= 2.5) return "warning";
  return "risk";
}

function getScenarioRoi(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.roi_percent ?? s.roi);
}

function getScenarioAnnualisedRoi(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.annualised_roi_percent ?? s.annualisedRoi);
}

function getScenarioProfit(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.gross_profit ?? s.grossProfit);
}

function getScenarioTotalCost(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.total_cost_mid ?? s.totalCost);
}

function getSaleDate(c: ComparableSale): string {
  return c.sale_date || c.saleDate || "—";
}

function getSalePrice(c: ComparableSale): number {
  return safeNum(c.price_nzd ?? c.price);
}

function getSaleSize(c: ComparableSale): number {
  return safeNum(c.floor_sqm ?? c.land_sqm ?? c.size);
}

function getSalePsm(c: ComparableSale): number {
  return safeNum(c.price_per_sqm ?? c.pricePerSqm);
}

function isSourceBackedComparable(c: ComparableSale): boolean {
  const address = c.address?.trim() ?? "";
  if (!address || /unknown address|default/i.test(address)) return false;
  return getSalePrice(c) > 100_000 && /\d/.test(address) && /[a-z]/i.test(address);
}

function getScenarioBest(scenarios: ROIScenario[]): ROIScenario | undefined {
  return (
    scenarios.find((s) => s.isBest || s.viable) ??
    scenarios.reduce((best, s) => getScenarioRoi(s) > getScenarioRoi(best) ? s : best, scenarios[0])
  );
}

function getCostLow(item: CostItem): number { return safeNum(item.low); }
function getCostHigh(item: CostItem): number { return safeNum(item.high); }

/**
 * Build the ordered list of image URLs/URIs to render in the report's hero
 * carousel. The pipeline is, in priority order:
 *
 *  1. `cachedPhotoUris` — local files persisted by `lib/reportPhotoCache.ts`
 *     after a successful download. These keep working even if the original
 *     CDN URL has rotated or been hot-link-blocked.
 *  2. `photoUrls`/`photoUrl` — wrapped in our `/image-proxy` so the request
 *     succeeds against hot-link-protected real-estate CDNs.
 *  3. `${apiBase}/streetview?…` then `${apiBase}/staticmap?…` — Google Street View
 *     then Maps Static (satellite) when there are no listing URLs, or as
 *     **carousel fallbacks** when listing/CDN images fail (`ReportPhotoCarousel`).
 */
const FALLBACK_PHOTO_TARGET = 4;

function getReportPhotoUrls(report: Report): string[] {
  const address = (report.address ?? "").trim();
  const streetview = address ? streetViewUrlFor(address) : null;
  const staticMap = address ? staticMapUrlFor(address) : null;

  /** Keep all listing photos, then lightly pad sparse sets with Street View/Satellite. */
  const withFallbacks = (urls: string[]): string[] => {
    let out = [...urls];
    if (streetview && out.length < FALLBACK_PHOTO_TARGET && !out.includes(streetview))
      out.push(streetview);
    if (staticMap && out.length < FALLBACK_PHOTO_TARGET && !out.includes(staticMap))
      out.push(staticMap);
    return out;
  };

  const cached = (report.cachedPhotoUris ?? []).filter(
    (uri): uri is string => typeof uri === "string" && uri.length > 0,
  );

  const remote = Array.from(
    new Set(
      [
        ...(report.photoUrls ?? []),
        ...(report.photoUrl ? [report.photoUrl] : []),
      ].filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  );
  if (remote.length > 0) {
    const proxied = remote.map((u) => (u.startsWith("file://") ? u : viaImageProxy(u)));
    return withFallbacks([...proxied, ...cached.filter((uri) => !proxied.includes(uri))]);
  }

  if (cached.length > 0) return withFallbacks(cached);

  if (!address) return [];
  return withFallbacks([]);
}

function renderSectionChildren(
  children: React.ReactNode,
  colors: ReturnType<typeof useColors>,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string" || typeof child === "number") {
      return (
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20 }}>
          {String(child)}
        </Text>
      );
    }
    return child;
  });
}

function SectionCard({
  title,
  icon,
  status,
  defaultOpen = false,
  alert = false,
  children,
  colors,
}: {
  title: string;
  icon?: string;
  status?: "good" | "warning" | "risk" | "neutral";
  defaultOpen?: boolean;
  /** Surfaces a red exclamation badge while collapsed — flags a low-scoring item that needs attention. */
  alert?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dotColor =
    status === "good" ? colors.success
    : status === "warning" ? colors.amber
    : status === "risk" ? colors.red
    : null;

  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        {dotColor && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
        {icon?.trim() ? <Text style={styles.sectionIcon}>{icon}</Text> : null}
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", flex: 1 }]}>
          {title}
        </Text>
        {alert && !open ? (
          <Feather name="alert-circle" size={15} color={colors.red} style={{ marginRight: 4 }} />
        ) : null}
        <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
      </TouchableOpacity>
      {open && <View style={[styles.sectionBody, { borderTopColor: colors.border }]}>{renderSectionChildren(children, colors)}</View>}
    </View>
  );
}

function InfoRow({ label, value, valueColor, colors }: {
  label: string; value: string; valueColor?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor || colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{value}</Text>
    </View>
  );
}

function ScoreStarBlock({
  score, label, colors,
}: {
  score: number; label: string;
  colors: ReturnType<typeof useColors>;
}) {
  const color = scoreColor(score, colors);
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
      <StarRating score={score} maxStars={3} size={16} gap={4} color={color} emptyColor="rgba(250,250,249,0.18)" />
      <Text style={{ color: "rgba(250,250,249,0.55)", fontFamily: "DM_Sans_400Regular", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label}
      </Text>
    </View>
  );
}

const CJK_TEXT_RE = /[\u3400-\u9fff]/;

/** Drop vendor attribution from commute lines (legacy cached reports). */
function stripGoogleRoutesAttribution(text: string): string {
  return text
    .replace(/^Google Routes estimates about /i, "About ")
    .replace(/^Google Routes\s*/i, "");
}

function normalizeScoreReason(reason: string): string {
  return reason
    .trim()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const SCORE_REASON_ZH: Record<string, string> = {
  "single house zone - subdivision heavily restricted": "Single House Zone（单一住宅区）— 分割开发限制较强",
  "large lot / countryside / rural zone - development very limited": "大地块 / 乡村 / 农村分区 — 开发潜力非常有限",
  "heritage overlay - demolition may require resource consent": "历史保护叠加层 — 拆除可能需要资源许可",
  "flood overlay - engineering and consent complexity": "洪涝叠加层 — 工程和审批复杂度较高",
  "notable tree overlay - design constraints apply": "显著树木叠加层 — 设计将受到限制",
  "volcanic viewshaft - height restrictions apply": "火山视线保护 — 建筑高度将受限制",
  "coastal protection overlay - additional consenting required": "海岸保护叠加层 — 可能需要额外审批",
  "steep terrain - significant earthworks required": "陡坡地形 — 预计需要大量土方工程",
  "moderate slope - some retaining wall work expected": "中等坡度 — 预计需要一定挡土墙工程",
  "probable asbestos - specialist demolition required": "可能存在石棉 — 需要专业拆除处理",
  "service infrastructure on neighbouring land - easement needed": "基础设施位于邻地 — 可能需要地役权",
  "cross-lease title - co-owner consent constrains development": "Cross-lease 产权 — 开发须获共同业主同意",
  "leasehold title - limited development rights vs freehold": "租赁地权 — 开发权利较永久产权受限",
  "land area limits subdivision to single dwelling": "土地面积限制分割 — 可能仅适合单一住宅",
  "excellent cost efficiency per unit": "单元成本效率优秀",
  "good cost per unit for nz market": "单元成本在新西兰市场中较好",
  "moderate cost - market viable": "成本中等 — 市场上仍具可行性",
  "high cost per unit - margin is thin": "单元成本较高 — 利润空间偏薄",
  "very high cost - roi challenging": "成本很高 — 投资回报具挑战",
  "extreme cost - feasibility doubtful": "成本极高 — 可行性存疑",
  "cost position looks attractive relative to the current property value": "成本位置相对当前物业价值较有吸引力",
  "cost position appears workable relative to the current property value": "成本位置相对当前物业价值基本可行",
  "cost position is tight relative to the current property value": "成本位置相对当前物业价值偏紧",
  "cost rating uses relative value pressure, not a fixed per-unit threshold": "成本评分按相对价值压力评估，而不是固定单元成本门槛",
  "cost position needs market validation against real exit evidence": "成本位置需要用真实销售退出证据进一步验证",
  "cost position looks efficient relative to the estimated end value": "成本位置相对预估完工价值较高效",
  "cost position appears workable relative to the estimated end value": "成本位置相对预估完工价值基本可行",
  "cost position is tight relative to the estimated end value": "成本位置相对预估完工价值偏紧",
  "modelled value gives a useful buffer over acquisition and delivery costs": "模型价值相对买入与交付成本有一定缓冲",
  "modelled value only modestly covers acquisition and delivery costs": "模型价值仅小幅覆盖买入与交付成本",
  "modelled value does not cover acquisition and delivery costs": "模型价值暂未覆盖买入与交付成本",
  "exceptional return - strong development opportunity": "卓越回报 — 开发机会强",
  "strong return - well above typical nz threshold": "强劲回报 — 明显高于新西兰常见门槛",
  "solid return - meets typical developer hurdle rate": "稳健回报 — 符合常见开发门槛",
  "marginal return - viable but sensitive to cost overruns": "边际回报 — 可行但对成本超支敏感",
  "low return - high risk of negative outcome": "低回报 — 出现负收益的风险较高",
  "negative return - not viable at current market values": "负回报 — 按当前市场价值不可行",
  "roi unavailable - no real fetched comparable sales were available": "回报暂不可用 — 暂未获取到真实可比销售记录",
  "sale price assumptions were not estimated from synthetic comparables": "售价假设未使用模拟可比销售估算",
  "roi uses terrace/townhouse comparables for the modelled exit product rather than generic standalone-house suburb sales.": "回报估算已优先使用排房 / 联排房可比销售，而不是泛化的独栋住宅区域成交。",
  "several potential lots increase programme length and absorption exposure versus a single-dwelling flip.": "多个潜在地块会拉长开发周期，并增加销售吸收风险。",
  "high lot count - long construction and phased sales typically stretch capital recovery; headline roi is a full-project figure, not short-cycle annualised performance.": "潜在地块数量较多 — 较长施工周期和分批销售通常会拉长资金回收；显示的回报是整个项目口径，并非短周期年化表现。",
};

function localizeScoreReason(reason: string, locale: string): string {
  const cleaned = stripGoogleRoutesAttribution(reason);
  if (locale !== "zh" || CJK_TEXT_RE.test(cleaned)) return cleaned;

  const normalized = normalizeScoreReason(cleaned);
  const translated = SCORE_REASON_ZH[normalized];
  if (translated) return translated;

  const costPerUnit = cleaned.match(/^Cost per unit:\s*(.+)$/i);
  if (costPerUnit) return `单元成本：约${costPerUnit[1].replace(/^~\s*/, "")}`;

  const bestCase = cleaned.match(/^Best case:\s*(.+?)\s+ROI over\s+(.+?)\s+years?$/i);
  if (bestCase) return `最佳情况：约${bestCase[1].replace(/^~\s*/, "")} ROI，周期约 ${bestCase[2].replace(/^~\s*/, "")} 年`;

  const baseCase = cleaned.match(/^Base case:\s*(.+?)\s+ROI over\s+(.+?)\s+years?$/i);
  if (baseCase) return `基准情况：约${baseCase[1].replace(/^~\s*/, "")} ROI，周期约 ${baseCase[2].replace(/^~\s*/, "")} 年`;

  return cleaned;
}

/**
 * Succinct investment verdict for the score card. Builds a 2-sentence summary
 * from the actual scoring reasons rather than canned text, so every property
 * gets a specific explanation of its ease/cost/ROI signals.
 */
function buildInvestmentVerdict(
  ease: number,
  cost: number,
  roi: number,
  _composite: number,
  locale: string,
  reasons?: { ease: string[]; cost: string[]; roi: string[] },
): string {
  const isZh = locale === "zh";
  const band = (s: number): "high" | "mid" | "low" => (s >= 4 ? "high" : s >= 2.5 ? "mid" : "low");
  const easeBand = band(ease);
  const costBand = band(cost);
  const roiBand = band(roi);

  // First descriptive (non-numeric) reason from a dimension
  const qualLabel = (arr: string[] | undefined): string | null => {
    if (!arr?.length) return null;
    const s = arr.find((r) => typeof r === "string" && r.trim() && !/best case|base case|\d+(?:\.\d+)?\s*%|\$[\d,.]+/i.test(r));
    return (s ?? arr[0] ?? "").trim() || null;
  };
  // Specific numeric line, e.g. "Best case: ~24.8% ROI over ~4 years"
  const numericLine = (arr: string[] | undefined): string | null => {
    if (!arr?.length) return null;
    const s = arr.find((r) => typeof r === "string" && /best case|base case|\d+(?:\.\d+)?\s*%/i.test(r));
    return (s ?? "").trim() || null;
  };
  // Up to 2 ease labels joined
  const easeConstraints = (reasons?.ease ?? [])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter((r) => r && !/\d+(?:\.\d+)?\s*%|\$[\d,.]+/.test(r))
    .slice(0, 2)
    .join(isZh ? "，且" : "; ");

  const easeLabel = qualLabel(reasons?.ease);
  const costLabel = qualLabel(reasons?.cost);
  const costDetail = (reasons?.cost ?? []).find((r, i) => i > 0 && typeof r === "string" && r.trim())?.trim() ?? null;
  const roiLabel = qualLabel(reasons?.roi);
  const roiNumber = numericLine(reasons?.roi);

  const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  const uc = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // ── ALL GREEN: high ROI, workable cost, clear ease ───────────────────────────
  if (roiBand === "high" && costBand !== "low" && easeBand !== "low") {
    if (isZh) {
      const roiNote = roiNumber ?? roiLabel ?? "回报强劲";
      const costNote = costLabel ?? "成本位置可控";
      return `${roiNote}；${costNote}，规划路径顺畅。整体信号一致，可尽快联系规划师或建筑师验证方案。`;
    }
    const roiNote = roiNumber ?? roiLabel ?? "returns are strong";
    const costNote = costLabel ?? "cost position is workable";
    return `${uc(roiNote)}. ${uc(costNote)}, and the planning path is clear. Consistent signals — get a planner or architect to validate the scheme quickly.`;
  }

  // ── HIGH RETURN BUT COST GATED ───────────────────────────────────────────────
  if (roiBand === "high" && costBand === "low") {
    if (isZh) {
      const roiNote = roiNumber ?? roiLabel ?? "回报上行空间存在";
      const costConstraint = costLabel ?? "成本覆盖偏紧";
      return `${roiNote}，但${costConstraint}是关键门槛。买入价折让或方案精简是解锁回报的核心变量，先拿专业报价再决定。`;
    }
    const roiNote = roiNumber ?? roiLabel ?? "return upside exists";
    const costConstraint = costLabel ?? "value coverage is tight";
    return `${uc(roiNote)}, but ${lc(costConstraint)} is the gatekeeper. Entry price or scheme efficiency is the lever — get a build quote before committing.`;
  }

  // ── PLANNING / TITLE BLOCKS FIRST ───────────────────────────────────────────
  if (easeBand === "low") {
    if (isZh) {
      const constraint = easeConstraints || easeLabel || "审批或产权存在限制";
      const roiNote = roiBand !== "low" && roiNumber ? `若规划路径确认，${roiNumber}。` : "";
      return `首要门槛是规划和产权可行性：${constraint}。${roiNote}建议先找规划师或律师确认可行性，再深入测算回报。`;
    }
    const constraint = easeConstraints || easeLabel || "consent or title constraints apply";
    const roiNote = roiBand !== "low" && roiNumber ? ` If planning clears, ${lc(roiNumber)}.` : "";
    return `The first hurdle is planning and title: ${constraint}.${roiNote} Confirm viability before deeper financial modelling.`;
  }

  // ── WEAK ROI ─────────────────────────────────────────────────────────────────
  if (roiBand === "low") {
    if (isZh) {
      const roiConstraint = roiLabel ?? "回报偏低";
      const easeNote = easeLabel ? `${easeLabel}；` : (easeBand === "high" ? "规划路径较顺畅，但" : "");
      const costNote = costBand === "low" ? `${costLabel ?? "成本覆盖偏紧"}，加之` : "";
      return `${easeNote}${costNote}${roiConstraint}，当前缓冲不足。重点放在压价、优化方案或等待市场条件改善。`;
    }
    const roiConstraint = roiLabel ?? "returns are low";
    const easeNote = easeLabel ? `${easeLabel}; ` : (easeBand === "high" ? "Planning path is clear, but " : "");
    const costNote = costBand === "low" ? `${costLabel ? `${lc(costLabel)}, and ` : ""}` : "";
    return `${uc(easeNote)}${costNote}${lc(roiConstraint)} on current assumptions. Focus on price reduction or scheme change before proceeding.`;
  }

  // ── TIGHT COST, MODERATE RETURN (e.g. cross-lease single-dwelling) ───────────
  if (costBand === "low") {
    if (isZh) {
      const easeNote = easeConstraints || easeLabel || (easeBand === "mid" ? "开发受一定限制" : "规划路径基本可行");
      const costConstraint = costLabel ?? "成本位置偏紧";
      const extra = costDetail ? `（${costDetail}）` : "";
      const roiNote = roiNumber ?? roiLabel ?? "回报有限";
      return `${easeNote}；${costConstraint}${extra}。${roiNote}，买入价控制是实现回报的主要杠杆。`;
    }
    const easeNote = easeConstraints || easeLabel || (easeBand === "mid" ? "development has some constraints" : "planning path is workable");
    const costConstraint = costLabel ?? "cost position is tight";
    const extra = costDetail ? ` (${lc(costDetail)})` : "";
    const roiNote = roiNumber ?? roiLabel ?? "returns are moderate";
    return `${uc(easeNote)}. ${uc(costConstraint)}${extra}. ${uc(roiNote)} — entry price is the key lever.`;
  }

  // ── MID / MID / MID FALLTHROUGH — use actual facts ───────────────────────────
  {
    if (isZh) {
      const driver = roiNumber ?? roiLabel ?? "回报处于中间区间";
      const concern = easeConstraints || easeLabel || costLabel || "存在需要核实的不确定性";
      return `${driver}；但${concern}。建议针对最大风险点做专项核查再决策。`;
    }
    const driver = roiNumber ?? roiLabel ?? "returns are in the mid range";
    const concern = easeConstraints || easeLabel || costLabel || "key uncertainties remain";
    return `${uc(driver)}. However, ${lc(concern)}. Verify the biggest risk point before committing.`;
  }
}

function scoreUnavailableVerdict(reason: string | null | undefined, locale: string): string {
  const isZh = locale === "zh";
  switch (reason) {
    case "missing_land_area_sqm":
      return isZh
        ? "由于尚未确认土地面积，暂时无法计算开发评分。下方已确认的房产与规划资料仍可供参考。"
        : "Development scores aren't available because the land area could not be confirmed. The verified property and planning facts below are still available.";
    case "missing_zone":
      return isZh
        ? "由于尚未确认规划分区，暂时无法计算开发评分。下方已确认的房产资料仍可供参考。"
        : "Development scores aren't available because the planning zone could not be confirmed. The verified property facts below are still available.";
    case "unit_or_apartment_typology":
      return isZh
        ? "该房产属于单元房或公寓，系统不会将其作为独立土地分割项目计算开发评分。"
        : "Development scores aren't produced for unit or apartment properties because they are not assessed as standalone subdivision sites.";
    case "unit_or_crosslease_signal":
      return isZh
        ? "该房产的单元房或交叉租赁产权信号不符合独立土地分割评分模型，因此未生成开发评分。"
        : "Development scores aren't produced because unit or cross-lease title signals do not fit the standalone subdivision model.";
    case "no_comparable_sales":
    case "missing_comparable_sales":
      return isZh
        ? "由于附近没有足够的近期可比成交来可靠测算回报，暂时无法生成开发评分。"
        : "Development scores aren't available because there are not enough recent comparable sales nearby to model the return reliably.";
    default:
      return isZh
        ? "由于缺少计算所需的已核实房产或规划资料，暂时无法生成开发评分。下方已确认的资料仍可供参考。"
        : "Development scores aren't available because one or more required property or planning inputs could not be verified. The confirmed facts below are still available.";
  }
}

function ScoreSummaryRow({ report, colors, hideOverall }: { report: Report; colors: ReturnType<typeof useColors>; hideOverall?: boolean }) {
  const { t, locale } = useT();
  const raw = report.scores ?? {};
  const ease = safeNum(raw.ease);
  const cost = safeNum(raw.cost);
  const roi = safeNum(raw.roi);
  const composite = safeNum(raw.composite);
  const ease_reasons = filterScoreReasonStrings(raw.ease_reasons).map((reason) => localizeScoreReason(reason, locale));
  const roi_reasons = filterScoreReasonStrings(raw.roi_reasons).map((reason) => localizeScoreReason(reason, locale));
  // cost_reasons feeds the integrated verdict but is not rendered as a separate
  // bullet list; the detailed scenario cards already carry the numeric cost context.
  const cost_reasons = filterScoreReasonStrings(raw.cost_reasons).map((reason) => localizeScoreReason(reason, locale));
  const overallColor = scoreColor(composite, colors);
  const overallDisplay = formatCompositeScoreForDisplay(composite);
  const showReasons = ease_reasons.length > 0 || roi_reasons.length > 0;
  // Real scores are on a 0.5–5.0 scale, so an explicit backend reason or the
  // legacy all-zero shape means the score was suppressed, not genuinely low.
  const unavailableReason = report.score_unavailable_reason;
  const scoresUnavailable = unavailableReason != null || (ease === 0 && cost === 0 && roi === 0);
  const verdict = scoresUnavailable
    ? scoreUnavailableVerdict(unavailableReason, locale)
    : buildInvestmentVerdict(ease, cost, roi, composite, locale, {
        ease: ease_reasons,
        cost: cost_reasons,
        roi: roi_reasons,
      });

  return (
    <View style={[styles.scoresSection, { backgroundColor: (colors as any).scoreCardBg }]}>
      {/* Overall score badge — top right (skipped when overlaid on hero photo) */}
      {!hideOverall && (
        <View style={styles.overallRow}>
          <Text style={[styles.overallLabel, { color: "rgba(250,250,249,0.45)" }]}>{t("report.composite")}</Text>
          <View style={[styles.overallBadge, { backgroundColor: overallColor + "25", borderColor: overallColor + "55" }]}>
            <Text style={[styles.overallNumber, { color: overallColor }]}>{overallDisplay}</Text>
            <Text style={[styles.overallSubLabel, { color: overallColor + "99" }]}>/ 5</Text>
          </View>
        </View>
      )}

      {/* Sub-scores: Ease · Cost · ROI */}
      <View style={[styles.scoresRow, { borderTopColor: "rgba(250,250,249,0.1)" }]}>
        <ScoreStarBlock score={ease} label={t("report.ease")} colors={colors} />
        <View style={[styles.scoreDivider, { backgroundColor: "rgba(250,250,249,0.1)" }]} />
        <ScoreStarBlock score={cost} label={t("report.cost")} colors={colors} />
        <View style={[styles.scoreDivider, { backgroundColor: "rgba(250,250,249,0.1)" }]} />
        <ScoreStarBlock score={roi} label={t("report.roi")} colors={colors} />
      </View>

      {/* AI verdict — succinct worthwhile-to-pursue summary explaining the scores. */}
      {verdict ? (
        <View style={[styles.verdictRow, { borderTopColor: "rgba(250,250,249,0.1)" }]}>
          <Text style={styles.verdictText}>{verdict}</Text>
        </View>
      ) : null}

      {/* Reasons — omit data-source / comparables disclaimer lines (server also sanitizes). */}
      {showReasons && (
        <View style={[styles.reasonsRow, { borderTopColor: "rgba(250,250,249,0.1)" }]}>
          {ease_reasons.length > 0 && (
            <View style={styles.reasonBlock}>
              <Text style={[styles.reasonTitle, { color: "rgba(250,250,249,0.45)" }]}>{t("report.ease").toUpperCase()}</Text>
              {ease_reasons.slice(0, 2).map((r, i) => (
                <Text key={i} style={[styles.reasonText, { color: "rgba(250,250,249,0.75)" }]}>· {r}</Text>
              ))}
            </View>
          )}
          {roi_reasons.length > 0 && (
            <View style={styles.reasonBlock}>
              <Text style={[styles.reasonTitle, { color: "rgba(250,250,249,0.45)" }]}>{t("report.roi").toUpperCase()}</Text>
              {roi_reasons.slice(0, 2).map((r, i) => (
                <Text key={i} style={[styles.reasonText, { color: "rgba(250,250,249,0.75)" }]}>· {r}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** Shown in place of the score row when land area is unknown — the score would
 *  be unreliable, so we prompt the user to confirm it with the listing agent. */
function ScoreHiddenNotice({ colors }: { colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  return (
    <View style={[styles.scoresSection, { backgroundColor: (colors as any).scoreCardBg }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 4 }}>
        <Feather name="alert-circle" size={18} color="#FDE68A" style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#FDE68A", fontFamily: "DM_Sans_600SemiBold", fontSize: 13, marginBottom: 4 }}>
            {t("report.score_hidden_title")}
          </Text>
          <Text style={{ color: "rgba(250,250,249,0.75)", fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 18 }}>
            {t("report.score_hidden_body")}
          </Text>
        </View>
      </View>
    </View>
  );
}

const AnimatedImage = Animated.createAnimatedComponent(Image);

function FullscreenPhotoViewer({
  visible,
  urls,
  initialIndex,
  onClose,
}: {
  visible: boolean;
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const displayUrls = urls.filter(Boolean);

  React.useEffect(() => {
    if (!visible) return;
    setIndex(Math.min(Math.max(initialIndex, 0), Math.max(urls.length - 1, 0)));
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [initialIndex, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, urls.length, visible]);

  const resetZoom = useCallback(() => {
    scale.value = withTiming(1, { duration: 160 });
    savedScale.value = 1;
    translateX.value = withTiming(0, { duration: 160 });
    translateY.value = withTiming(0, { duration: 160 });
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY]);

  const handleSwipePhoto = useCallback((direction: 1 | -1) => {
    setIndex((current) => {
      const next = Math.min(Math.max(current + direction, 0), Math.max(displayUrls.length - 1, 0));
      return next;
    });
    resetZoom();
  }, [displayUrls.length, resetZoom]);

  const goToPhoto = useCallback((nextIndex: number) => {
    setIndex(Math.min(Math.max(nextIndex, 0), Math.max(displayUrls.length - 1, 0)));
    resetZoom();
  }, [displayUrls.length, resetZoom]);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(savedScale.value * event.scale, 1), 5);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1, { duration: 160 });
        savedScale.value = 1;
        translateX.value = withTiming(0, { duration: 160 });
        translateY.value = withTiming(0, { duration: 160 });
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      if (scale.value <= 1.05) return;
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd((event) => {
      if (scale.value <= 1.05) {
        const horizontalDistance = Math.abs(event.translationX);
        const verticalDistance = Math.abs(event.translationY);
        const swipeThreshold = Math.max(48, width * 0.14);
        const velocityThreshold = 650;
        const isHorizontalSwipe =
          horizontalDistance > verticalDistance * 1.25 &&
          (horizontalDistance >= swipeThreshold || Math.abs(event.velocityX) >= velocityThreshold);

        translateX.value = withTiming(0, { duration: 120 });
        translateY.value = withTiming(0, { duration: 120 });
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;

        if (isHorizontalSwipe) {
          runOnJS(handleSwipePhoto)(event.translationX < 0 ? 1 : -1);
        }
        return;
      }
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const tap = Gesture.Tap()
    .maxDuration(220)
    .maxDistance(10)
    .onEnd(() => {
      runOnJS(onClose)();
    });

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const currentUrl = displayUrls[index] ?? displayUrls[0];
  if (!currentUrl) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.fullscreenPhotoRoot}>
        <GestureDetector gesture={Gesture.Simultaneous(pinch, pan, tap)}>
          <Animated.View style={styles.fullscreenPhotoStage}>
            <AnimatedImage
              source={{ uri: currentUrl }}
              style={[
                styles.fullscreenPhotoImage,
                { width, height: Math.min(height, Math.round(width * 1.35)) },
                imageStyle,
              ]}
              resizeMode="contain"
            />
          </Animated.View>
        </GestureDetector>

        <View style={styles.fullscreenPhotoTopBar} pointerEvents="box-none">
          <TouchableOpacity style={styles.fullscreenPhotoClose} onPress={onClose} activeOpacity={0.8}>
            <Feather name="x" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {displayUrls.length > 1 && (
          <View style={styles.fullscreenPhotoFooter} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.fullscreenPhotoNav, index <= 0 && styles.fullscreenPhotoNavDisabled]}
              onPress={() => {
                goToPhoto(index - 1);
              }}
              activeOpacity={0.8}
              disabled={index <= 0}
            >
              <Feather name="chevron-left" size={20} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.fullscreenPhotoCounter}>{index + 1} / {displayUrls.length}</Text>
            <TouchableOpacity
              style={[styles.fullscreenPhotoNav, index >= displayUrls.length - 1 && styles.fullscreenPhotoNavDisabled]}
              onPress={() => {
                goToPhoto(index + 1);
              }}
              activeOpacity={0.8}
              disabled={index >= displayUrls.length - 1}
            >
              <Feather name="chevron-right" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

function ReportPhotoCarousel({
  report,
  photoUrls,
  colors,
  onRefreshPhotos,
  isRefreshingPhotos,
  hideScore,
}: {
  report: Report;
  photoUrls: string[];
  colors: ReturnType<typeof useColors>;
  onRefreshPhotos?: () => void;
  isRefreshingPhotos?: boolean;
  /** Suppress the hero score badge when the score is unreliable (e.g. land area unknown). */
  hideScore?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const composite = safeNum(report.scores?.composite);
  const overallColor = scoreColor(composite, colors);
  const overallDisplay = formatCompositeScoreForDisplay(composite);
  const address = (report.address ?? "").trim();

  const handleError = useCallback((url: string) => {
    setFailed((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const visibleUrls = photoUrls.filter((u) => !failed.has(u));

  // Emergency recovery: if every photo URL in the list failed, add Street View
  const streetviewUri = address ? streetViewUrlFor(address) : null;
  const staticMapUri = address ? staticMapUrlFor(address) : null;
  const streetviewRecovery = visibleUrls.length === 0 && streetviewUri != null && !failed.has(streetviewUri);
  const staticMapRecovery = visibleUrls.length === 0 && !streetviewRecovery && staticMapUri != null && !failed.has(staticMapUri);
  const recoveryUrl = streetviewRecovery ? streetviewUri : staticMapRecovery ? staticMapUri : null;

  const displayUrls = visibleUrls.length > 0 ? visibleUrls : (recoveryUrl ? [recoveryUrl] : []);
  const total = displayUrls.length;

  // Show refresh pill only when there are zero real listing photos (i.e. the
  // user is staring at a Street View / Satellite fallback, or the placeholder).
  // Hides itself when we have ANY real listing photo so we don't pollute the
  // UI for healthy reports.
  const showRefreshPill =
    !!onRefreshPhotos && visibleUrls.length === 0;

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    if (width <= 0) return;
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex(Math.min(Math.max(newIndex, 0), total - 1));
  }, [width, total]);

  const openViewer = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerOpen(true);
  }, []);

  return (
    <View
      style={styles.reportPhotoWrapper}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <FullscreenPhotoViewer
        visible={viewerOpen}
        urls={displayUrls}
        initialIndex={viewerIndex}
        onClose={() => setViewerOpen(false)}
      />

      {displayUrls.length > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={styles.reportPhotoScroller}
          onMomentumScrollEnd={handleScroll}
          scrollEventThrottle={16}
        >
          {displayUrls.map((url, index) => (
            <TouchableOpacity
              key={`${url}-${index}`}
              style={[styles.reportPhoto, width > 0 ? { width } : undefined]}
              activeOpacity={0.92}
              onPress={() => openViewer(index)}
            >
              <Image
                source={{ uri: url }}
                style={styles.reportPhoto}
                resizeMode="cover"
                onError={() => handleError(url)}
              />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.reportPhotoFallback}>
          <Feather name="image" size={28} color="rgba(255,255,255,0.4)" />
          <Text style={styles.reportPhotoFallbackText} numberOfLines={2}>
            {report.address || translate("report.photo_unavailable")}
          </Text>
        </View>
      )}

      <LinearGradient
        colors={["rgba(0,0,0,0.65)", "rgba(0,0,0,0.08)", "rgba(0,0,0,0.45)"]}
        style={styles.reportPhotoScrim}
        pointerEvents="none"
      />

      {/* Overall score badge — hidden when the score is unreliable (e.g. land area unknown). */}
      {!hideScore && (
        <View style={styles.heroOverallBadge}>
          <Text style={styles.heroOverallLabel}>{translate("report.score_overall")}</Text>
          <View style={[styles.heroOverallPill, { backgroundColor: overallColor + "EE", borderColor: "rgba(255,255,255,0.35)" }]}>
            <Text style={styles.heroOverallNumber}>{overallDisplay}</Text>
            <Text style={styles.heroOverallSub}>/ 5</Text>
          </View>
        </View>
      )}

      {/* Page-indicator dots — visible only when there are multiple photos */}
      {total > 1 && (
        <View style={styles.photoDotRow} pointerEvents="none">
          {displayUrls.map((_, i) => (
            <View
              key={i}
              style={[
                styles.photoDot,
                i === currentIndex ? styles.photoDotActive : styles.photoDotInactive,
              ]}
            />
          ))}
        </View>
      )}

      {/* Refresh-photos pill — appears only when carousel is showing fallback */}
      {showRefreshPill && (
        <TouchableOpacity
          style={styles.refreshPhotosPill}
          onPress={onRefreshPhotos}
          activeOpacity={0.8}
          disabled={!!isRefreshingPhotos}
        >
          {isRefreshingPhotos ? (
            <>
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.refreshPhotosPillText}>{translate("report.photos.refreshing")}</Text>
            </>
          ) : (
            <>
              <Feather name="refresh-cw" size={12} color="#fff" />
              <Text style={styles.refreshPhotosPillText}>{translate("report.photos.refresh")}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

function SubdivisionPathwayCallout({ note, colors }: { note: string; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  return (
    <View style={{ backgroundColor: colors.amber + "12", borderColor: colors.amber + "30", borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10, gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="info" size={13} color={colors.amber} />
        <Text style={{ color: colors.amber, fontFamily: "DM_Sans_700Bold", fontSize: 13 }}>
          {t("report.subdivision_pathway_title")}
        </Text>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 18 }}>
        {note}
      </Text>
    </View>
  );
}

function SubdivisionPathwayComparison({ planning, colors }: { planning?: PlanningInfo; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  if (!planning) return null;
  const standardLots = planning.standardVacantLots ?? planning.potentialLots;
  const designRange = planning.designLedYieldRange;
  if (standardLots == null && !designRange) return null;

  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
      <View style={{ flex: 1, backgroundColor: colors.success + "10", borderColor: colors.success + "35", borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }}>
        <Text style={{ color: colors.success, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
          {t("report.standard_vacant_pathway")}
        </Text>
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
          {standardLots != null ? t("report.standard_lots_value", { lots: standardLots }) : t("report.na")}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 15 }}>
          {planning.standardMinLotSize ? t("report.minimum_lot_size_test", { sqm: planning.standardMinLotSize }) : t("report.na")}
        </Text>
      </View>
      {planning.designLedEligible && designRange ? (
        <View style={{ flex: 1, backgroundColor: colors.amber + "12", borderColor: colors.amber + "35", borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }}>
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
            {t("report.design_led_pathway")}
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
            {t("report.design_led_range_value", { min: designRange.min, max: designRange.max })}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 15 }}>
            {t("search.subdivision_design_led_note")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function OverlayChecklist({ overlays, colors }: { overlays: PlanningOverlay[]; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  if (!overlays || overlays.length === 0) {
    return <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>{t("report.no_overlays")}</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {overlays.map((o, i) => {
        const indicator = o.status === "restricted" ? "🔴" : o.status === "moderate" ? "🟡" : o.status === "control" ? "🔵" : "🟢";
        const textColor = o.status === "restricted" ? colors.red : o.status === "moderate" ? colors.amber : o.status === "control" ? colors.mutedForeground : colors.success;
        return (
          <View key={i} style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
            <Text style={{ fontSize: 15 }}>{indicator}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: textColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{o.name}</Text>
              {o.detail?.trim() ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>{o.detail}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function easementIcon(type: EasementEntry["type"]): string {
  switch (type) {
    case "right_of_way": return "🚗";
    case "drainage":     return "💧";
    case "power":        return "⚡";
    case "services":     return "🔧";
    case "covenant":     return "📜";
    case "encroachment": return "🏗";
    default:             return "⚠️";
  }
}

function EasementList({
  easements, appurtenant, summary, lotImpact, grossArea, netArea, easementArea, dataStatus, colors,
}: {
  easements?: EasementEntry[];
  appurtenant?: { type: string; description: string }[];
  summary?: string;
  lotImpact?: string | null;
  grossArea?: number;
  netArea?: number;
  easementArea?: number;
  dataStatus?: "retrieved" | "no_memorials" | "api_error" | "no_title";
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const hasBurdening = easements && easements.length > 0;
  const hasAppurtenant = appurtenant && appurtenant.length > 0;

  if (!hasBurdening && !hasAppurtenant) {
    const isUnconfirmed = !dataStatus || dataStatus === "api_error" || dataStatus === "no_title";
    return (
      <View style={{ gap: 8 }}>
        <View style={[{
          flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1,
          backgroundColor: isUnconfirmed ? colors.amber + "12" : colors.muted,
          borderColor: isUnconfirmed ? colors.amber + "40" : colors.border,
        }]}>
          <Feather name={isUnconfirmed ? "alert-circle" : "check-circle"} size={14} color={isUnconfirmed ? colors.amber : colors.success} style={{ marginTop: 1 }} />
          <Text style={{ color: isUnconfirmed ? colors.amber : colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13, flex: 1, lineHeight: 18 }}>
            {isUnconfirmed
              ? t("report.easement_title_inconclusive")
              : dataStatus === "no_memorials"
                ? t("report.easement_no_memorials")
                : t("report.easement_none_detected")}
          </Text>
        </View>
        {!!summary?.trim() && (
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17 }}>
            {summary}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {/* Area impact banner when easements reduce subdivisable area */}
      {easementArea != null && easementArea > 0 && grossArea != null && netArea != null && (
        <View style={[{ backgroundColor: colors.amber + "18", borderColor: colors.amber + "35", borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }]}>
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>{t("report.easement_area_title")}</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 2 }}>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              {t("report.easement_gross")} <Text style={{ fontFamily: "DM_Sans_600SemiBold" }}>{grossArea.toLocaleString()}m²</Text>
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              {t("report.easement_label")} <Text style={{ fontFamily: "DM_Sans_600SemiBold", color: colors.red }}>−{easementArea.toLocaleString()}m²</Text>
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              {t("report.easement_net")} <Text style={{ fontFamily: "DM_Sans_600SemiBold", color: colors.success }}>{netArea.toLocaleString()}m²</Text>
            </Text>
          </View>
        </View>
      )}

      {/* Lot impact note */}
      {!!lotImpact?.trim() && (
        <View style={[{ backgroundColor: colors.red + "10", borderColor: colors.red + "30", borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", gap: 8, alignItems: "flex-start" }]}>
          <Feather name="alert-triangle" size={13} color={colors.red} style={{ marginTop: 1 }} />
          <Text style={{ color: colors.red, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>{lotImpact}</Text>
        </View>
      )}

      {/* Burdening easements */}
      {hasBurdening && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {t("report.easement_burdening")}
          </Text>
          {easements!.map((e, i) => {
            const sevColor = e.severity === "significant" ? colors.red : e.severity === "moderate" ? colors.amber : colors.mutedForeground;
            const sevLabel = e.severity === "significant"
              ? t("report.easement_severity_significant")
              : e.severity === "moderate"
                ? t("report.easement_severity_moderate")
                : e.severity === "minor"
                  ? t("report.easement_severity_minor")
                  : (e.severity ?? "?");
            return (
              <View key={i} style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
                <Text style={{ fontSize: 15 }}>{easementIcon(e.type)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: sevColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{e.description}</Text>
                  {e.estimated_area_sqm != null && (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, marginTop: 2 }}>
                      {t("report.easement_est_affected", { n: e.estimated_area_sqm })}
                      {e.estimated_width_m != null ? ` ${t("report.easement_width", { n: e.estimated_width_m })}` : ""}
                    </Text>
                  )}
                </View>
                <View style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: sevColor + "20" }]}>
                  <Text style={{ color: sevColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 10, textTransform: "uppercase" }}>{sevLabel}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Appurtenant easements */}
      {hasAppurtenant && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {t("report.easement_benefiting")}
          </Text>
          {appurtenant!.map((e, i) => (
            <View key={i} style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
              <Text style={{ fontSize: 15 }}>✅</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.success, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{e.description}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function AsbestosPanel({ asbestos, colors }: { asbestos: AsbestosInfo; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  const risk = getAsbestosRisk(asbestos);
  const riskColor = risk === "high" ? colors.red : risk === "moderate" ? colors.amber : risk === "unknown" ? colors.amber : colors.success;
  // Guard against LLM emitting the string "null" instead of JSON null
  const buildYearRaw = asbestos.buildYear;
  const buildYearStr =
    buildYearRaw != null && String(buildYearRaw) !== "null" && String(buildYearRaw).trim() !== ""
      ? String(buildYearRaw).trim()
      : null;
  const buildYearNum = buildYearStr ? parseInt(buildYearStr, 10) : null;
  const demoCostLow = asbestos.demoCostLow ?? 0;
  const demoCostHigh = asbestos.demoCostHigh ?? 0;
  const isVacant = demoCostLow === 0 && demoCostHigh === 0;
  const effectiveRiskColor = isVacant ? colors.success : riskColor;
  const riskLabel =
    isVacant
      ? t("report.asbestos_not_applicable")
      : risk === "high"
      ? t("report.asbestos_risk_high")
      : risk === "low"
        ? buildYearNum && buildYearNum < 1940
          ? t("report.asbestos_risk_low_pre1940")
          : t("report.asbestos_risk_low_post1990")
        : t("report.asbestos_risk_unknown");

  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.riskBanner, { backgroundColor: effectiveRiskColor + "15", borderColor: effectiveRiskColor + "30", borderRadius: 10 }]}>
        <Text style={{ fontSize: 18 }}>{risk === "high" ? "⚠️" : risk === "low" ? "✅" : "❓"}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: effectiveRiskColor, fontFamily: "DM_Sans_700Bold", fontSize: 13 }}>{t("report.asbestos_risk_prefix")}: {riskLabel}</Text>
          {buildYearStr && (
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>
              {t("report.build_year")}: {buildYearStr}
            </Text>
          )}
        </View>
      </View>
      {isVacant ? (
        <View style={[styles.warningBox, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}>
          <Feather name="check-circle" size={13} color={colors.success} />
          <Text style={{ color: colors.success, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {t("report.no_demolition_required")}
          </Text>
        </View>
      ) : (
        <InfoRow
          label={t("report.demo_cost_estimate")}
          value={`${formatNZD(demoCostLow)} – ${formatNZD(demoCostHigh)}`}
          colors={colors}
        />
      )}
      {asbestos.notes?.trim() ? (
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20 }}>
          {asbestos.notes}
        </Text>
      ) : null}
      {asbestos.worksafeNote?.trim() && !asbestos.notes?.trim() ? (
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20 }}>
          {asbestos.worksafeNote}
        </Text>
      ) : null}
      {!isVacant && (asbestos.worksafe_required || asbestos.flagged) && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
          <Feather name="alert-triangle" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_500Medium", fontSize: 13, flex: 1, lineHeight: 18 }}>
            {t("report.worksafe_asbestos_warning")}
          </Text>
        </View>
      )}
    </View>
  );
}

const TERRAIN_CLS_KEY: Record<string, string> = {
  flat:     "report.terrain_cls_flat",
  subtle:   "report.terrain_cls_subtle",
  gentle:   "report.terrain_cls_gentle",
  moderate: "report.terrain_cls_moderate",
  steep:    "report.terrain_cls_steep",
  very_steep: "report.terrain_cls_very_steep",
};

const TERRAIN_SLOPE_EXPLAIN_KEY: Record<NonNullable<NonNullable<Report["terrain"]>["classification"]>, string> = {
  flat: "report.terrain_slope_explain_flat",
  subtle: "report.terrain_slope_explain_subtle",
  gentle: "report.terrain_slope_explain_gentle",
  moderate: "report.terrain_slope_explain_moderate",
  steep: "report.terrain_slope_explain_steep",
  very_steep: "report.terrain_slope_explain_very_steep",
};

function terrainSlopeDegPhrase(deg: number | null | undefined, osChinese: boolean): string {
  if (deg == null) return "";
  return osChinese ? `（~${deg} 度）` : ` (~${deg} degrees)`;
}

function ContourCard({ terrain, colors }: { report: Report; terrain: NonNullable<Report["terrain"]>; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  const cls = terrain.classification;
  if (!cls) {
    return (
      <View style={{ gap: 8 }}>
        <View style={[styles.warningBox, { backgroundColor: colors.mutedForeground + "12", borderColor: colors.mutedForeground + "30" }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {t("report.terrain_no_data")}
          </Text>
        </View>
      </View>
    );
  }

  const steepness = cls === "very_steep" ? 50 : cls === "steep" ? 36 : cls === "moderate" ? 22 : (cls === "subtle" || cls === "gentle") ? 10 : 3;
  const W = 120, H = 70;
  const slopeY = Math.max(4, H - (steepness / 50) * H);
  const terrainColor = cls === "very_steep" || cls === "steep" ? colors.red : cls === "moderate" ? colors.amber : colors.success;
  const stripSlopeSourceSuffix = (text: string) =>
    text
      .replace(/(?:数据来源|來源|source)\s*[:：].*/giu, "")
      .replace(/\s*[—-]\s*(?:based on|calculated|estimate|derived|from|via).*/giu, "")
      .trim();

  const slopeSummary = (() => {
    if (isOSChineseLocale() && cls) {
      const explainKey = TERRAIN_SLOPE_EXPLAIN_KEY[cls];
      if (explainKey) {
        return translateForOS(explainKey, { deg: terrainSlopeDegPhrase(terrain.slope_degrees, true) });
      }
    }
    const raw = terrain.slope?.trim();
    if (!raw) return null;
    if (isOSChineseLocale() && /[\u3400-\u9FFF\uF900-\uFAFF]/.test(raw)) {
      return stripSlopeSourceSuffix(raw);
    }
    return stripSlopeSourceSuffix(raw) || null;
  })();

  const clsLabel = t(TERRAIN_CLS_KEY[cls] ?? "report.terrain_cls_subtle");

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Svg width={W} height={H}>
          <Polygon
            points={`0,${H} ${W},${slopeY} ${W},${H}`}
            fill={terrainColor + "30"}
            stroke={terrainColor}
            strokeWidth={2}
          />
        </Svg>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: terrainColor, fontFamily: "DM_Sans_700Bold", fontSize: 15 }}>
            {clsLabel}
          </Text>
          {terrain.slope_degrees != null && (
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              {t("report.terrain_slope_degrees", { deg: String(terrain.slope_degrees) })}
            </Text>
          )}
          {!!slopeSummary && (
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 18 }}>
              {slopeSummary}
            </Text>
          )}
        </View>
      </View>
      {((terrain.retainingCostLow ?? 0) > 0 || (terrain.retainingCostHigh ?? 0) > 0) && (
        <InfoRow
          label={t("report.retaining_wall_cost")}
          value={`${formatNZD(terrain.retainingCostLow)} – ${formatNZD(terrain.retainingCostHigh)}`}
          valueColor={terrainColor}
          colors={colors}
        />
      )}
      {terrain.large_site_terrain_adjusted && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
          <Feather name="info" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {t("report.terrain_large_site_note")}
          </Text>
        </View>
      )}
      {(cls === "very_steep" || cls === "steep" || cls === "moderate") && (
        <View style={[styles.warningBox, { backgroundColor: terrainColor + "12", borderColor: terrainColor + "30" }]}>
          <Feather name="alert-triangle" size={13} color={terrainColor} />
          <Text style={{ color: terrainColor, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {cls === "very_steep"
              ? t("report.terrain_warning_very_steep")
              : cls === "steep"
              ? t("report.terrain_warning_steep")
              : t("report.terrain_warning_moderate")}
          </Text>
        </View>
      )}
    </View>
  );
}

function InfrastructureTable({ infrastructure, colors }: { infrastructure: InfrastructureService[]; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  const hasNeighbour = infrastructure.some((s) => s.location === "neighbour");
  const hasUnknown = infrastructure.some((s) => s.location === "unknown");

  return (
    <View style={{ gap: 0 }}>
      {infrastructure.map((svc, i) => {
        const locLabel = getInfraLabel(svc.location, t);
        const isUnknown = svc.location === "unknown";
        const locColor =
          svc.location === "on-parcel" ? colors.success
          : svc.location === "boundary" ? "#3B82F6"
          : svc.location === "neighbour" ? colors.amber
          : isUnknown ? colors.mutedForeground
          : colors.mutedForeground;
        const riskAssessment = svc.location === "neighbour" ? t("report.easement_may_required")
          : isUnknown ? t("report.location_unverified")
          : t("report.standard_connection");
        const costLow = svc.estimatedCostLow ?? svc.estimated_cost_low;
        const costHigh = svc.estimatedCostHigh ?? svc.estimated_cost_high;

        return (
          <View
            key={i}
            style={[
              styles.infraRow,
              i < infrastructure.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
          >
            <View style={{ flex: 2 }}>
              <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{svc.name}</Text>
              {svc.note?.trim() ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>
                  {cleanInfrastructureNote(svc.note)}
                </Text>
              ) : null}
            </View>
            <View style={{ flex: 2, alignItems: "flex-start" }}>
              <View style={[styles.locationChip, { backgroundColor: locColor + "18", borderColor: locColor + "40" }]}>
                <Text style={{ color: locColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 11 }}>{locLabel}</Text>
              </View>
            </View>
            <View style={{ flex: 2, alignItems: "flex-end" }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, textAlign: "right" }}>
                {riskAssessment}
              </Text>
              {costLow != null && costHigh != null && (
                <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_500Medium", fontSize: 12, marginTop: 2 }}>
                  {formatNZD(costLow)}–{formatNZD(costHigh)}
                </Text>
              )}
            </View>
          </View>
        );
      })}
      {hasNeighbour && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30", marginTop: 10 }]}>
          <Feather name="alert-triangle" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {t("report.warning_neighbour_services")}
          </Text>
        </View>
      )}
      {hasUnknown && (
        <View style={[styles.warningBox, { backgroundColor: colors.mutedForeground + "12", borderColor: colors.mutedForeground + "30", marginTop: 10 }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {t("report.infrastructure_unavailable_warning")}
          </Text>
        </View>
      )}
    </View>
  );
}

const COST_COLORS = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#F97316", "#6B7280"];

// Maps the English label strings produced by the backend to i18n keys so they
// can be translated when the user's OS language is Chinese.
const COST_LABEL_KEY_MAP: Record<string, string> = {
  "land (cv)":                  "report.cost_label.land_cv",
  "demolition":                  "report.cost_label.demolition",
  "construction":                "report.cost_label.construction",
  "retaining walls":             "report.cost_label.retaining_walls",
  "retaining wall":              "report.cost_label.retaining_walls",
  "tdr/ttr transfer right":       "report.cost_label.tdr_ttr_transfer_right",
  "services & infrastructure":   "report.cost_label.services_infrastructure",
  "services and infrastructure": "report.cost_label.services_infrastructure",
  "consents & professionals":    "report.cost_label.consents_professionals",
  "consents and professionals":  "report.cost_label.consents_professionals",
  // Legacy / LLM-mistranslated ZH labels — normalize to i18n key
  "同意与专业人士": "report.cost_label.consents_professionals",
  "同意于专业人士": "report.cost_label.consents_professionals",
  "审批与专业费": "report.cost_label.consents_professionals",
  "finance (holding)":           "report.cost_label.finance_holding",
  "finance holding":             "report.cost_label.finance_holding",
  "contingency":                 "report.cost_label.contingency",
};

function CostBreakdownChart({ costItems, totalCostLow, totalCostHigh, costPerUnitAvg, colors }: {
  costItems: CostItem[];
  totalCostLow?: number;
  totalCostHigh?: number;
  costPerUnitAvg?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const totalMid = costItems.reduce((s, i) => s + (getCostLow(i) + getCostHigh(i)) / 2, 0);

  const translateLabel = (label: string): string => {
    const key = COST_LABEL_KEY_MAP[label.toLowerCase().trim()];
    return key ? t(key) : label;
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.costBar, { backgroundColor: colors.muted }]}>
        {costItems.map((item, idx) => {
          const mid = (getCostLow(item) + getCostHigh(item)) / 2;
          const pct = totalMid > 0 ? (mid / totalMid) * 100 : 0;
          return (
            <View
              key={item.label}
              style={[styles.costBarSegment, { width: `${pct}%`, backgroundColor: COST_COLORS[idx % COST_COLORS.length] }]}
            />
          );
        })}
      </View>
      <View style={styles.costLegend}>
        {costItems.map((item, idx) => (
          <View key={item.label} style={styles.costLegendItem}>
            <View style={[styles.costLegendDot, { backgroundColor: COST_COLORS[idx % COST_COLORS.length] }]} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11 }}>{translateLabel(item.label)}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: 0 }}>
        {costItems.map((item, i) => (
          <View
            key={item.label}
            style={[styles.infoRow, { borderBottomColor: colors.border, borderBottomWidth: i < costItems.length - 1 ? StyleSheet.hairlineWidth : 0 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <View style={[styles.costLegendDot, { backgroundColor: COST_COLORS[i % COST_COLORS.length] }]} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>{translateLabel(item.label)}</Text>
            </View>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
              {formatNZD(getCostLow(item))} – {formatNZD(getCostHigh(item))}
            </Text>
          </View>
        ))}
        <View style={[styles.totalRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
          <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 14 }}>{t("report.cost_total")}</Text>
          <Text style={{ color: colors.accent, fontFamily: "DM_Sans_700Bold", fontSize: 14 }}>
            {formatNZD(totalCostLow ?? totalMid * 0.9)} – {formatNZD(totalCostHigh ?? totalMid * 1.1)}
          </Text>
        </View>
      </View>
      {costPerUnitAvg != null && (
        <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>
          {t("report.cost_per_unit_avg", { value: formatNZD(costPerUnitAvg) })}
        </Text>
      )}
    </View>
  );
}

function InterestRateBanner({ outlook, colors }: {
  outlook?: "falling" | "stable" | "rising";
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  if (!outlook) return null;
  const configs = {
    falling: { text: t("report.interest_banner_falling"), color: "#10B981", bg: "#10B98115" },
    stable:  { text: t("report.interest_banner_stable"), color: "#F59E0B", bg: "#F59E0B12" },
    rising:  { text: t("report.interest_banner_rising"), color: "#EF4444", bg: "#EF444415" },
  };
  const c = configs[outlook];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: c.color + "40" }}>
      <Text style={{ color: c.color, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>{c.text}</Text>
    </View>
  );
}

function ROIScenarioCards({ scenarios, interestRateOutlook, comparablesQuality, colors }: {
  scenarios: ROIScenario[];
  interestRateOutlook?: "falling" | "stable" | "rising";
  comparablesQuality?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const caseConfigs: Record<"bear" | "base" | "bull", {
    label: string; emoji: string; color: string; bgKey: string; description: string;
  }> = {
    bear: { label: t("report.case_bear"), emoji: "🔻", color: "#EF4444", bgKey: "#EF444415", description: t("report.case_bear_desc") },
    base: { label: t("report.case_base"), emoji: "📊", color: "#F59E0B", bgKey: "#F59E0B12", description: t("report.case_base_desc") },
    bull: { label: t("report.case_bull"), emoji: "📈", color: "#10B981", bgKey: "#10B98115", description: t("report.case_bull_desc") },
  };
  const outlook = interestRateOutlook ?? scenarios[0]?.interest_rate_outlook ?? "stable";
  const hasBull = outlook === "falling";

  const availableCases = (["bear", "base", ...(hasBull ? ["bull"] : [])] as Array<"bear" | "base" | "bull">);
  const [selectedCase, setSelectedCase] = useState<"bear" | "base" | "bull">("base");

  return (
    <View style={{ gap: 10 }}>
      {selectedCase === "bull" && (
        <InterestRateBanner outlook={outlook} colors={colors} />
      )}

      <View style={{ flexDirection: "row", gap: 6 }}>
        {availableCases.map((c) => {
          const cfg = caseConfigs[c];
          const active = selectedCase === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => setSelectedCase(c)}
              style={{
                flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8,
                backgroundColor: active ? cfg.color + "20" : colors.card,
                borderWidth: active ? 2 : 1,
                borderColor: active ? cfg.color : colors.border,
                alignItems: "center", gap: 2,
              }}
            >
              <Text style={{ fontSize: 16 }}>{cfg.emoji}</Text>
              <Text style={{ color: active ? cfg.color : colors.mutedForeground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
                {cfg.label}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10 }}>
                {cfg.description}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 10, paddingBottom: 4 }}>
          {scenarios.map((s, i) => {
            const caseData: ROICaseResult | undefined = (s.cases ?? []).find((c) => c.case === selectedCase);
            const cfg = caseConfigs[selectedCase];

            // If cases array is missing/incomplete, compute fallback using known multipliers
            const multipliers: Record<"bear" | "base" | "bull", number> = { bear: 0.80, base: 1.00, bull: 1.20 };
            const multiplier = multipliers[selectedCase];
            const baseGdv = safeNum(s.gdv);
            const fallbackGdv = Math.round(baseGdv * multiplier);
            const fallbackTotalCost = getScenarioTotalCost(s);
            const fallbackProfit = fallbackGdv - fallbackTotalCost;
            const fallbackRoi = fallbackTotalCost > 0 ? parseFloat(((fallbackProfit / fallbackTotalCost) * 100).toFixed(1)) : 0;
            const fallbackAnnualised = fallbackTotalCost > 0 ? parseFloat(((Math.pow(1 + fallbackRoi / 100, 1 / s.years) - 1) * 100).toFixed(1)) : 0;

            const roi = caseData ? caseData.roi_percent : fallbackRoi;
            const annualised = caseData ? caseData.annualised_roi_percent : fallbackAnnualised;
            const profit = caseData ? caseData.gross_profit : fallbackProfit;
            const gdv = caseData ? caseData.gdv : fallbackGdv;
            const viable = caseData ? caseData.viable : (profit > 0);
            const totalCost = getScenarioTotalCost(s);

            return (
              <View
                key={i}
                style={[
                  styles.roiCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: viable ? cfg.color + "60" : colors.red,
                    borderWidth: 1.5,
                  },
                ]}
              >
                {!viable && (
                  <View style={[styles.bestBadge, { backgroundColor: colors.red }]}>
                    <Text style={{ color: "#fff", fontFamily: "DM_Sans_700Bold", fontSize: 9 }}>{t("report.roi_badge_risk")}</Text>
                  </View>
                )}
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
                  {t("report.year_exit", { years: s.years })}
                </Text>
                <Text style={{ color: viable ? cfg.color : colors.red, fontFamily: "DM_Sans_700Bold", fontSize: 26, letterSpacing: -0.5, marginTop: 4 }}>
                  {isNaN(roi) ? "—" : roi.toFixed(1)}%
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, marginBottom: 8 }}>
                  {t("report.roi_annual_line", { annual: isNaN(annualised) ? "—" : annualised.toFixed(1) })}
                </Text>
                <View style={[styles.roiDivider, { backgroundColor: colors.border }]} />
                <View style={{ gap: 4, marginTop: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>{t("report.gdv")}</Text>
                    <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>{formatNZD(gdv)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>{t("report.cost")}</Text>
                    <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>{formatNZD(totalCost)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>{t("report.profit")}</Text>
                    <Text style={{ color: profit >= 0 ? colors.success : colors.red, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
                      {formatSignedNZD(profit)}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

    </View>
  );
}

function strategyTitle(id: DevelopmentStrategyId, fallback: string, t: (key: string) => string, potentialLots?: number): string {
  switch (id) {
    case "hold_existing": return t("report.strategy_hold");
    case "refurbish": return t("report.strategy_refurbish");
    case "demolish_rebuild": return (potentialLots ?? 0) > 1 ? t("report.strategy_subdivide_rebuild") : t("report.strategy_rebuild");
    case "integrated_consent": return t("report.strategy_integrated_consent");
    default: return fallback;
  }
}

function strategyStatus(strategies: DevelopmentStrategyScenario[] | undefined): "good" | "warning" | "risk" | "neutral" {
  const recommended = strategies?.find((strategy) => strategy.recommendation === "recommended");
  if (!recommended) return "neutral";
  if (recommended.id === "hold_existing") return "warning";
  if (recommended.id === "refurbish") return "good";
  return recommended.roiScenarios.some((scenario) => scenario.viable) ? "good" : "risk";
}

function NeighbourhoodContextNote({ context, colors }: { context?: NeighbourhoodContext | null; colors: ReturnType<typeof useColors> }) {
  if (!context || context.assessedLots <= 0) return null;
  const marketReason = context.marketAdjustment?.reason;
  const lines = [
    marketReason,
  ].filter((line): line is string => typeof line === "string" && line.trim().length > 0);
  if (lines.length === 0) return null;

  return (
    <View style={[styles.warningBox, { backgroundColor: colors.muted + "35", borderColor: colors.border }]}>
      <Feather name="map-pin" size={13} color={colors.mutedForeground} />
      <View style={{ flex: 1, gap: 3 }}>
        {lines.map((line, i) => (
          <Text key={i} style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16 }}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function TransportContextNote({ context, colors }: { context?: TransportContext | null; colors: ReturnType<typeof useColors> }) {
  if (!context) return null;
  const reasons = context.roiInfluence?.reasons
    ?.filter((line) => line.trim().length > 0)
    .map(stripGoogleRoutesAttribution) ?? [];
  if (reasons.length === 0) return null;

  return (
    <View style={[styles.warningBox, { backgroundColor: colors.muted + "35", borderColor: colors.border }]}>
      <Feather name="navigation" size={13} color={colors.mutedForeground} />
      <View style={{ flex: 1, gap: 3 }}>
        {reasons.map((line, i) => (
          <Text key={i} style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16 }}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

function signalSummary(signal: NeighbourhoodContext["publicHousingSignal"]): string {
  if (signal.confidence === "unknown" || signal.level === "unknown") {
    return `Unknown (${signal.confidence} confidence)`;
  }
  if (signal.count <= 0 || signal.level === "none") {
    return `None detected across ${signal.assessedLots} nearby lots`;
  }
  return `${signal.count} of ${signal.assessedLots} nearby lots (${signal.level}, ${signal.confidence} confidence)`;
}

function publicHousingSummary(
  signal: NeighbourhoodContext["publicHousingSignal"] | undefined,
  radiusM: number | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { text: string; tone: "good" | "warning" | "muted" } | null {
  const radius = Math.round(radiusM ?? 100);
  if (!signal || signal.confidence === "unknown" || signal.level === "unknown" || signal.assessedLots <= 0) {
    return { text: t("report.public_housing_unavailable"), tone: "muted" };
  }
  if (signal.count <= 0 || signal.level === "none") {
    return {
      text: t("report.public_housing_none", { radius, count: signal.assessedLots }),
      tone: "good",
    };
  }
  return {
    text: t("report.public_housing_detected", { radius, count: signal.count, confidence: signal.confidence }),
    tone: "warning",
  };
}

function transitModeLabel(mode: string, t: (key: string) => string): string {
  if (mode === "train") return t("report.mode_train");
  if (mode === "ferry") return t("report.mode_ferry");
  return mode;
}

function transitServiceIntensityLabel(intensity: string, t: (key: string) => string): string {
  if (intensity === "frequent") return t("report.service_intensity_frequent");
  if (intensity === "regular") return t("report.service_intensity_regular");
  if (intensity === "limited") return t("report.service_intensity_limited");
  return t("report.service_intensity_unknown");
}

function formatTransitServiceSummary(
  routeCount: number,
  serviceIntensity: string,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const intensity = transitServiceIntensityLabel(serviceIntensity, t);
  const key = routeCount === 1 ? "report.transit_routes_one" : "report.transit_routes_other";
  return t(key, { n: routeCount, intensity });
}

function MarketAccessContextPanel({ neighbourhoodContext, transportContext, colors }: {
  neighbourhoodContext?: NeighbourhoodContext | null;
  transportContext?: TransportContext | null;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const publicHousing = neighbourhoodContext?.publicHousingSignal;
  const publicHousingDisplay = publicHousingSummary(publicHousing, neighbourhoodContext?.radiusM, t);
  const rapidStop = transportContext?.publicTransport.nearestStop;
  const hasRapidTransitContext = Boolean(transportContext && transportContext.publicTransport.confidence !== "unknown");
  const commute = transportContext?.cityCommute;
  const hasCommuteContext = Boolean(
    commute?.confidence !== "unknown" &&
    commute?.centreName &&
    commute.distanceKm != null &&
    commute.durationMinutes != null,
  );
  const hasAnyRows = Boolean(publicHousingDisplay || hasRapidTransitContext || hasCommuteContext);

  return (
    <View style={{ gap: 8 }}>
      {publicHousingDisplay ? (
          <InfoRow
            label={t("report.nearby_public_housing")}
            value={publicHousingDisplay.text}
            valueColor={
              publicHousingDisplay.tone === "warning"
                ? colors.amber
                : publicHousingDisplay.tone === "good"
                  ? colors.success
                  : colors.mutedForeground
            }
            colors={colors}
          />
      ) : null}

      {hasRapidTransitContext ? (
        <>
          <InfoRow
            label={t("report.rapid_transit")}
            value={
              rapidStop
                ? t("report.rapid_transit_found", {
                    mode: transitModeLabel(rapidStop.mode, t),
                    name: rapidStop.name,
                    distance: formatDistanceM(rapidStop.distanceM),
                  })
                : t("report.rapid_transit_none")
            }
            colors={colors}
          />
          {rapidStop ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16 }}>
              {formatTransitServiceSummary(rapidStop.routeCount, rapidStop.serviceIntensity, t)}
            </Text>
          ) : null}
        </>
      ) : null}

      {hasCommuteContext ? (
          <InfoRow
            label={t("report.cbd_commute")}
            value={t("report.cbd_commute_value", {
              distance: commute!.distanceKm!.toFixed(1),
              minutes: commute!.durationMinutes!,
              centre: commute!.centreName!,
            })}
            colors={colors}
          />
      ) : null}

      {!hasAnyRows ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17 }}>
          Market and transport context is not available on this saved report. Re-run the analysis to add it.
        </Text>
      ) : null}
    </View>
  );
}

function marketAccessStatus(report: Report): "good" | "warning" | "risk" | "neutral" {
  if (report.neighbourhoodContext?.marketAdjustment.applied) return "warning";
  if (report.transportContext || report.neighbourhoodContext) return "good";
  return "neutral";
}

type BuiltEnvironmentStatusValue = "old" | "modern" | "new" | "unknown";

function builtEnvironmentStatusFromYear(year: number | null | undefined): BuiltEnvironmentStatusValue {
  if (year == null) return "unknown";
  if (year < 1990) return "old";
  if (year < 2020) return "modern";
  return "new";
}

function builtEnvironmentStatusLabel(status: BuiltEnvironmentStatusValue, t: (key: string) => string): string {
  if (status === "old") return t("report.built_env_status_old");
  if (status === "modern") return t("report.built_env_status_modern");
  if (status === "new") return t("report.built_env_status_new");
  return t("report.built_env_status_unknown");
}

function builtEnvironmentStatusColor(status: BuiltEnvironmentStatusValue, colors: ReturnType<typeof useColors>): string {
  if (status === "new") return colors.success;
  if (status === "modern") return colors.accent;
  if (status === "old") return colors.amber;
  return colors.mutedForeground;
}

function BuiltEnvironmentPanel({ context, colors, onAnalyseProperty }: {
  context: BuiltEnvironmentContext;
  colors: ReturnType<typeof useColors>;
  onAnalyseProperty?: (address: string) => void;
}) {
  const { t } = useT();
  const rows = (context.nearbyStatus && context.nearbyStatus.length > 0
    ? context.nearbyStatus
    : context.nearbyExamples.map((example) => ({
        address: example.address,
        buildYear: example.buildYear,
        buildYearRange: example.buildYearRange,
        distanceM: example.distanceM,
        status: example.status ?? builtEnvironmentStatusFromYear(example.buildYear),
      }))
  ).slice(0, 15);

  const handleRowPress = useCallback((address: string | null | undefined) => {
    if (!address || !onAnalyseProperty) return;
    Alert.alert(
      t("report.built_env_analyse_title"),
      t("report.built_env_analyse_body"),
      [
        { text: t("history.cancel"), style: "cancel" },
        { text: t("report.built_env_analyse_confirm"), onPress: () => onAnalyseProperty(address) },
      ],
    );
  }, [t, onAnalyseProperty]);

  return (
    <View style={{ gap: 10 }}>
      {context.reasons.slice(0, 2).map((reason, index) => (
        <Text key={`${reason}-${index}`} style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17 }}>
          {reason}
        </Text>
      ))}
      {rows.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_700Bold", fontSize: 11 }}>
            {t("report.built_env_nearby_status")}
          </Text>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.tableHeaderCell, { color: colors.mutedForeground, flex: 1 }]}>
              {t("report.built_env_address")}
            </Text>
            <Text style={[styles.tableHeaderCell, { color: colors.mutedForeground, width: 86, textAlign: "right" }]}>
              {t("report.built_env_status")}
            </Text>
          </View>
          {rows.map((row, index) => {
            const status = (row.status ?? "unknown") as BuiltEnvironmentStatusValue;
            const statusColor = builtEnvironmentStatusColor(status, colors);
            const rowContent = (
              <>
                <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1 }} numberOfLines={1}>
                  {row.address ?? t("report.nearby_property")}
                </Text>
                <Text style={{ color: statusColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 12, width: 86, textAlign: "right" }}>
                  {builtEnvironmentStatusLabel(status, t)}
                </Text>
              </>
            );
            return onAnalyseProperty ? (
              <TouchableOpacity
                key={`${row.address ?? "nearby"}-${index}`}
                style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
                onPress={() => handleRowPress(row.address)}
                activeOpacity={0.6}
              >
                {rowContent}
              </TouchableOpacity>
            ) : (
              <View key={`${row.address ?? "nearby"}-${index}`} style={[styles.tableRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                {rowContent}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17 }}>
          {t("report.built_env_unavailable")}
        </Text>
      )}
    </View>
  );
}

function builtEnvironmentStatus(context?: BuiltEnvironmentContext | null): "good" | "warning" | "risk" | "neutral" {
  if (!context) return "neutral";
  if (context.signal === "last_missing_piece" || context.signal === "mixed_renewal") return "good";
  if (context.signal === "older_environment") return "warning";
  return "neutral";
}

function hasUsableBuiltEnvironmentContext(context?: BuiltEnvironmentContext | null): boolean {
  if (!context || (context.knownBuildYearCount ?? 0) <= 0) return false;
  const rows = context.nearbyStatus?.length
    ? context.nearbyStatus
    : context.nearbyExamples ?? [];
  return rows.some((row) =>
    row.status !== "unknown" || row.buildYear != null || row.buildYearRange != null,
  );
}

function DevelopmentStrategyPanel({ strategies, interestRateOutlook, comparablesQuality, neighbourhoodContext, transportContext, potentialLots, colors }: {
  strategies: DevelopmentStrategyScenario[];
  interestRateOutlook?: "falling" | "stable" | "rising";
  comparablesQuality?: string;
  neighbourhoodContext?: NeighbourhoodContext | null;
  transportContext?: TransportContext | null;
  potentialLots?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const { t, locale } = useT();
  const isZh = locale === "zh";
  const recommended = strategies.find((strategy) => strategy.recommendation === "recommended") ?? strategies[0];
  const [selectedId, setSelectedId] = useState<DevelopmentStrategyId>(recommended.id);
  const selected = strategies.find((strategy) => strategy.id === selectedId) ?? recommended;
  const hasRoi = selected.roiScenarios.length > 0;

  // Pick localised rationale — rationale_zh filled by analyse + /translate-report for zh users
  const zhRationale = typeof selected.rationale_zh === "string" ? selected.rationale_zh.trim() : "";
  const displayRationale = isZh && zhRationale.length > 0 ? selected.rationale_zh! : selected.rationale;

  // Only show assumptions that are user-facing (exclude internal references, source notes, build-year tech notes)
  const visibleAssumptions = (selected.assumptions ?? []).filter(
    (a) => !/realestate\.co\.nz|oneroof|build year|asking price|exit value/i.test(a),
  );

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {strategies.map((strategy) => {
          const active = strategy.id === selected.id;
          const isRecommended = strategy.recommendation === "recommended";
          return (
            <TouchableOpacity
              key={strategy.id}
              onPress={() => setSelectedId(strategy.id)}
              style={{
                flex: 1,
                padding: 9,
                borderRadius: 10,
                borderWidth: active ? 1.5 : 1,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.accent + "12" : colors.card,
                gap: 4,
              }}
            >
              <Text style={{ color: active ? colors.accent : colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 11 }}>
                {strategyTitle(strategy.id, strategy.title, t, potentialLots)}
              </Text>
              {isRecommended && (
                <Text style={{ color: colors.success, fontFamily: "DM_Sans_600SemiBold", fontSize: 10 }}>
                  {t("report.strategy_recommended")}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.warningBox, { backgroundColor: colors.accent + "10", borderColor: colors.accent + "30" }]}>
        <Feather name={selected.recommendation === "recommended" ? "check-circle" : "info"} size={13} color={colors.accent} />
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
          <Text style={{ fontFamily: "DM_Sans_700Bold" }}>{strategyTitle(selected.id, selected.title, t, potentialLots)}: </Text>
          {displayRationale}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={[styles.strategyMetric, { backgroundColor: colors.muted + "40" }]}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11 }}>{t("report.total_cost")}</Text>
          <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 13 }}>
            {formatNZD(selected.totalCostLow)} – {formatNZD(selected.totalCostHigh)}
          </Text>
        </View>
        <View style={[styles.strategyMetric, { backgroundColor: colors.muted + "40" }]}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11 }}>{t("report.confidence")}</Text>
          <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 13 }}>
            {Math.round(safeNum(selected.confidence) * 100)}%
          </Text>
        </View>
      </View>

      {visibleAssumptions.length > 0 && (
        <View style={{ gap: 4 }}>
          {visibleAssumptions.map((assumption, i) => (
            <Text key={i} style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16 }}>
              • {assumption}
            </Text>
          ))}
        </View>
      )}

      <NeighbourhoodContextNote context={neighbourhoodContext} colors={colors} />
      <TransportContextNote context={transportContext} colors={colors} />

      {hasRoi ? (
        <ROIScenarioCards
          scenarios={selected.roiScenarios}
          interestRateOutlook={interestRateOutlook ?? selected.roiScenarios[0]?.interest_rate_outlook}
          comparablesQuality={comparablesQuality}
          colors={colors}
        />
      ) : (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
          <Feather name="alert-triangle" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {t("report.strategy_roi_unavailable")}
          </Text>
        </View>
      )}
    </View>
  );
}

function ComparableSalesTable({ comparables, quality, colors }: {
  comparables: ComparableSale[];
  quality?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const displayed = comparables.slice(0, 3);

  const getLand  = (c: ComparableSale) => (c.land_sqm ?? (c as any).size ?? 0) as number;
  const getFloor = (c: ComparableSale) => (c.floor_sqm ?? 0) as number;
  const getCv    = (c: ComparableSale): number | null => {
    const v = c.cv_nzd as number | null | undefined;
    return v != null && v > 0 ? v : null;
  };
  const getBuildYear = (c: ComparableSale): number | null => {
    const v = c.build_year as number | null | undefined;
    return v != null && v > 1800 ? v : null;
  };

  const hasCv    = displayed.some((c) => getCv(c) != null);
  const hasYear  = displayed.some((c) => getBuildYear(c) != null);

  return (
    <View style={{ gap: 8 }}>
      {quality === "estimated" && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
          <Feather name="info" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1 }}>
            {t("report.comparable_data_estimated_box")}
          </Text>
        </View>
      )}
      {/* Each comparable as a compact card */}
      {displayed.map((c, i) => {
        const land  = getLand(c);
        const floor = getFloor(c);
        const cv    = getCv(c);
        const year  = getBuildYear(c);
        const date  = getSaleDate(c);
        return (
          <View
            key={i}
            style={{
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 10,
              gap: 6,
              backgroundColor: colors.card,
            }}
          >
            {/* Address line */}
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }} numberOfLines={2}>
              {c.address}
            </Text>
            {date ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10, marginTop: -4 }}>
                {date}
              </Text>
            ) : null}
            {/* Stats row */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
              {land > 0 && (
                <View style={{ gap: 1 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10 }}>{t("report.comparable_land")}</Text>
                  <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>{land.toLocaleString()}m²</Text>
                </View>
              )}
              {floor > 0 && (
                <View style={{ gap: 1 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10 }}>{t("report.comparable_floor")}</Text>
                  <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>{floor.toLocaleString()}m²</Text>
                </View>
              )}
              {year != null && (
                <View style={{ gap: 1 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10 }}>{t("report.build_year")}</Text>
                  <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>{year}</Text>
                </View>
              )}
              {cv != null && (
                <View style={{ gap: 1 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10 }}>{t("report.comparable_cv")}</Text>
                  <Text style={{ color: colors.success, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>{formatNZD(cv)}</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function RiskSummaryPanel({ riskSummary, colors }: { riskSummary: string[]; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  const osChinese = isOSChineseLocale();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 8 }}>
        {riskSummary.map((r, i) => {
          const item = localizeRiskSummaryItem(r, osChinese);
          return (
            <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Text style={{ fontSize: 14, marginTop: 1 }}>⚠️</Text>
              <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20, flex: 1 }}>{item}</Text>
            </View>
          );
        })}
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, fontStyle: "italic", lineHeight: 16, marginTop: 4 }}>
        {t("report.risk_section_disclaimer")}
      </Text>
    </View>
  );
}

/** Quiet legal / data-staleness note at end of report—not a full section card. */
function ReportAnalysisFootnote({ colors }: {
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        marginTop: 4,
        paddingTop: 12,
        paddingHorizontal: 2,
        paddingBottom: 2,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Feather name="info" size={12} color={colors.mutedForeground} style={{ marginTop: 1, opacity: 0.65 }} />
        <Text
          style={{
            flex: 1,
            color: colors.mutedForeground,
            fontFamily: "DM_Sans_400Regular",
            fontSize: 10,
            lineHeight: 15,
            opacity: 0.9,
          }}
        >
          {translateForOS("report.analysis_legal_footnote")}
        </Text>
      </View>
    </View>
  );
}

function shuffleFollowUpChips(chips: string[]): string[] {
  const shuffled = [...chips];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function FollowUpChips({ report, onChipClick, colors }: {
  report: Report;
  onChipClick: (msg: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const zone = report.zone_label || report.planning?.zone || report.propertyOverview?.zone || "this zone";
  const lots = report.potential_lots || report.planning?.potentialLots || 0;

  const asbestosRisk = report.asbestos ? getAsbestosRisk(report.asbestos) : "unknown";
  const hasFloodOverlay = hasOverlay(report, "flood");
  const hasHeritageOverlay = hasOverlay(report, "heritage");
  const lowRoi = safeNum(report.scores?.roi) < 2.5;
  const chips = useMemo(() => {
    const randomisedChips: string[] = [
      t("report.followup_recommend_architect"),
      t("report.followup_main_risks"),
      t("report.followup_building_typology"),
    ];

    if (report.asbestos && asbestosRisk === "high") {
      randomisedChips.push(t("report.followup_asbestos_process"));
    }
    if (hasFloodOverlay) {
      randomisedChips.push(t("report.followup_flood_overlay"));
    }
    if (hasHeritageOverlay) {
      randomisedChips.push(t("report.followup_heritage_overlay"));
    }
    if (lowRoi) {
      randomisedChips.push(t("report.followup_improve_roi"));
    }
    if (lots >= 3) {
      randomisedChips.push(t("report.followup_consent_steps", { lots }));
    }
    randomisedChips.push(t("report.followup_explain_zone", { zone }));

    return [
      t("report.followup_contact_sales_agent"),
      ...shuffleFollowUpChips(randomisedChips),
    ];
  }, [
    asbestosRisk,
    hasFloodOverlay,
    hasHeritageOverlay,
    lots,
    lowRoi,
    report.address,
    report.asbestos,
    report.historyCreatedAt,
    report.historyId,
    t,
    zone,
  ]);

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {t("report.ask_follow_up")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8, paddingBottom: 4 }}>
          {chips.map((chip, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.chip, { backgroundColor: "#F0FDF4", borderColor: "#10B981" }]}
              onPress={() => onChipClick(chip)}
              activeOpacity={0.7}
            >
              <Text style={{ color: "#065F46", fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function OverlayMapSnippet({ base64, caption, colors }: {
  base64: string | undefined | null;
  caption?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  if (!base64) return null;
  return (
    <View style={{ marginTop: 12, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <Image
        source={{ uri: `data:image/png;base64,${base64}` }}
        style={{ width: "100%", height: 180 }}
        resizeMode="cover"
      />
      <View style={{ backgroundColor: colors.muted + "CC", paddingHorizontal: 10, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="layers" size={11} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11 }}>
          {caption ?? t("report.planning_overlay_map")}
        </Text>
      </View>
    </View>
  );
}

function authorityCategoryLabel(cat: SchoolZoneDetail["authorityCategory"]): string {
  switch (cat) {
    case "public":
      return translateForOS("report.school_authority.public");
    case "state_integrated":
      return translateForOS("report.school_authority.state_integrated");
    case "private":
      return translateForOS("report.school_authority.private");
    default:
      return translateForOS("report.school_authority.unknown");
  }
}

/** Map listing/MoE enrolment-scheme text to a simple in-zone signal for the UI. */
function inZoneDisplayFromEnrolmentScheme(
  scheme: string | null | undefined,
): "yes" | "no" | "unknown" {
  const s = scheme?.trim();
  if (!s) return "unknown";
  const lower = s.toLowerCase();
  if (/^(no|n|false|0)$/i.test(lower)) return "no";
  if (/不是|^否/.test(s) || s === "否" || s === "无") return "no";
  if (/^(yes|y|true|1)$/i.test(lower)) return "yes";
  if (s === "是" || s === "是的" || /^是的/.test(s)) return "yes";
  if (s === "有" || s === "适用") return "yes";
  return "unknown";
}

function SchoolZonesPanel({ zones, colors }: { zones: SchoolZoneDetail[]; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ gap: 12 }}>
      {zones.map((z, i) => {
        const showAuthorityBadge = z.authorityCategory !== "unknown";
        return (
          <View
            key={`${z.orgName ?? z.sourceLabel}-${i}`}
            style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10, flexDirection: "column", alignItems: "stretch", gap: 8 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 14, lineHeight: 20 }}>
                  {z.matched && z.orgName ? z.orgName : z.sourceLabel}
                </Text>
                {z.yearLevels ? (
                  <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 16 }}>
                    {z.yearLevels}
                  </Text>
                ) : null}
              </View>
              {showAuthorityBadge ? (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, backgroundColor: colors.accent + "18" }}>
                  <Text style={{ color: colors.accent, fontFamily: "DM_Sans_600SemiBold", fontSize: 10 }}>
                    {authorityCategoryLabel(z.authorityCategory)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16, fontStyle: "italic" }}>
        {translateForOS("report.school_zones_footnote")}
      </Text>
    </View>
  );
}

export function FeasibilityReportCard({ report, onFollowUp, onAnalyseProperty }: Props) {
  const colors = useColors();
  const { t, locale } = useT();
  const { getApiHeaders, user } = useAuth();
  const { isWatched, toggle } = useWatchlist();
  const router = useRouter();
  const queryClient = useQueryClient();

  const planningSection = overlayStatus(report);
  const asbestosStatus: "good" | "warning" | "risk" | "neutral" = report.asbestos
    ? (getAsbestosRisk(report.asbestos) === "high" ? "risk" : "good")
    : "neutral";

  // Local override for refreshed photos — server persists into resultJson so
  // history view will see them on next fetch; this state keeps the in-memory
  // carousel showing the new photos immediately.
  const [refreshedPhotoUrls, setRefreshedPhotoUrls] = useState<string[] | null>(null);
  const [isRefreshingPhotos, setIsRefreshingPhotos] = useState(false);
  const [activeReportTab, setActiveReportTab] = useState<"info" | "plan">("info");
  const [hasOpenedPlanTab, setHasOpenedPlanTab] = useState(false);

  const effectiveReport = useMemo<Report>(() => {
    if (!refreshedPhotoUrls || refreshedPhotoUrls.length === 0) return report;
    return { ...report, photoUrls: refreshedPhotoUrls, photoUrl: refreshedPhotoUrls[0] ?? report.photoUrl };
  }, [report, refreshedPhotoUrls]);

  const photoUrls = getReportPhotoUrls(effectiveReport);
  const visibleBuiltEnvironmentContext = hasUsableBuiltEnvironmentContext(report.builtEnvironmentContext)
    ? report.builtEnvironmentContext
    : null;

  const handleShare = useCallback(async () => {
    try {
      await shareReport(effectiveReport, getApiHeaders());
    } catch {
      // Best-effort: sharing should not interrupt report reading.
    }
  }, [effectiveReport, getApiHeaders]);

  // Build a watchlist candidate from the report so a heart here saves the same
  // property a result card would (same listingUrl||address key).
  const watchCandidate = useMemo<WatchlistCandidate>(() => {
    const ctx = report.selectedListingContext;
    return {
      address: (report.address ?? "").trim(),
      listingUrl: ctx?.listingUrl ?? undefined,
      photoUrl: effectiveReport.photoUrl ?? effectiveReport.photoUrls?.[0] ?? undefined,
      propertyType: report.propertyOverview?.propertyType ?? ctx?.propertyType ?? undefined,
      zone: report.propertyOverview?.zone ?? report.zone_label ?? undefined,
      bedrooms: report.propertyOverview?.bedrooms ?? ctx?.bedrooms ?? undefined,
      bathrooms: report.propertyOverview?.bathrooms ?? ctx?.bathrooms ?? undefined,
      scores: report.scores,
    };
  }, [report, effectiveReport]);
  const watched = isWatched(watchCandidate);

  const promptSignInForWatchlist = useCallback(() => {
    const goLogin = () => router.push("/(auth)/login" as never);
    const goSignup = () => router.push("/(auth)/signup" as never);
    if (Platform.OS === "web") {
      goSignup();
      return;
    }
    Alert.alert(t("watchlist.signin_title"), t("watchlist.signin_body"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("login.submit"), onPress: goLogin },
      { text: t("signup.create_account"), onPress: goSignup },
    ]);
  }, [router, t]);

  const handleToggleWatch = useCallback(async () => {
    if (!user) {
      promptSignInForWatchlist();
      return;
    }
    // Removing a saved property asks for confirmation; saving stays instant.
    if (watched && !(await confirmRemoveFromWatchlist(t))) return;
    const result = await toggle(watchCandidate);
    if (result.error) notifyWatchlistError(t);
  }, [user, watched, t, toggle, watchCandidate, promptSignInForWatchlist]);

  const handleRefreshPhotos = useCallback(async () => {
    const searchId = report.historyId ?? null;
    if (!searchId || isRefreshingPhotos) return;
    setIsRefreshingPhotos(true);
    try {
      const headers = getApiHeaders();
      const resp = await fetch(`${getApiBase()}/analyse/${encodeURIComponent(searchId)}/refresh-photos`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        // Silent failure — the pill returns to its idle state. Don't pop alerts
        // for what is essentially a best-effort retry.
        return;
      }
      const data = await resp.json() as { photoUrls?: string[] };
      if (Array.isArray(data.photoUrls) && data.photoUrls.length > 0) {
        setRefreshedPhotoUrls(data.photoUrls);
      }
    } catch {
      // Network failure — silent. User can retry.
    } finally {
      setIsRefreshingPhotos(false);
    }
  }, [report.historyId, isRefreshingPhotos, getApiHeaders]);

  useEffect(() => {
    if (!report.historyId) return;
    void prefetchSitePlanAssets(queryClient, report.historyId, report.address, getApiHeaders()).catch(() => {
      // The Plan tab still owns visible error and retry UI.
    });
  }, [queryClient, report.historyId, report.address, getApiHeaders]);

  const bedrooms = report.propertyOverview?.bedrooms;
  const bathrooms = report.propertyOverview?.bathrooms;
  const realComparableSales = (report.comparableSales ?? []).filter(isSourceBackedComparable);
  // Show comparables whenever we have any — "estimated" (active listings) is still real market data
  const hasLiveComparableSales = realComparableSales.length > 0;
  const developmentStrategies = report.developmentStrategies ?? [];
  const hasDevelopmentStrategies = developmentStrategies.length > 0;
  const osChinese = isOSChineseLocale();
  const titleTypeRaw = formatTitleTypeForDisplay(report.propertyOverview?.titleType);
  const titleResolutionSource = report.propertyOverview?.titleResolutionSource ?? "unknown";
  const titleNeedsAgentCheck =
    !!titleTypeRaw && titleResolutionSource !== "lrs" && titleResolutionSource !== "lrs_cache";
  // Defence in depth: when the backend translation step didn't run (e.g. cached
  // legacy reports), localise the title token on the client for zh users so
  // the pill never shows untranslated "Freehold"/"Leasehold". The
  // /freehold/i check below still works because the English word remains in
  // the parens, e.g. "永久产权 (Freehold)".
  const titleTypeDisplayBase =
    osChinese && titleTypeRaw ? localiseTitleTypeZh(titleTypeRaw) ?? titleTypeRaw : titleTypeRaw;
  const titleTypeDisplay =
    titleTypeDisplayBase && titleNeedsAgentCheck
      ? `${titleTypeDisplayBase} ${translateForOS("report.title_check_with_agent")}`
      : titleTypeDisplayBase;
  const titleInsightForDisplay =
    osChinese ? localiseTitleInsightZh(report.titleInsight) : report.titleInsight;
  // Freehold renders neutral; Cross Lease / Leasehold / Stratum get a warning accent.
  const isNonFreeholdTenure = !!titleTypeDisplay && !/free\s*hold/i.test(titleTypeDisplay);
  const landAreaUnavailableContact =
    !report.propertyOverview?.landArea &&
    (report.propertyOverview?.typology === "unit_apartment" ||
      report.propertyOverview?.subdivisionRejectReason === "unit_or_crosslease_signal");
  // Land area is the single most critical input for development feasibility:
  // without it, ease / cost / ROI scores are guesses. When it's missing we hide
  // the score displays entirely and prompt the user to confirm it with the
  // listing agent, rather than showing a misleadingly confident rating.
  const landAreaMissing =
    !report.propertyOverview?.landArea || !String(report.propertyOverview.landArea).trim();
  const riskSummaryForDisplay = useMemo(() => {
    const scrubbed = filterRiskSummaryRemoveIncompleteDataDisclaimerBullets(report.riskSummary ?? []);
    return ensureRiskSummaryMinForReport(report, scrubbed, 3);
  }, [report]);

  return (
    <View style={styles.container}>
      <View style={styles.reportBookmarkStack}>
        <View style={[styles.reportTabs, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          {(["info", "plan"] as const).map((tab) => {
            const selected = activeReportTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[
                  styles.reportTabButton,
                  selected
                    ? [styles.reportTabButtonActive, { backgroundColor: colors.card, borderColor: colors.border }]
                    : null,
                ]}
                onPress={() => {
                  setActiveReportTab(tab);
                  if (tab === "plan") setHasOpenedPlanTab(true);
                }}
                activeOpacity={0.85}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.reportTabText,
                    { color: selected ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {tab === "info" ? t("report.tab_info") : t("report.tab_plan")}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View
          style={[
            styles.reportHeader,
            { backgroundColor: colors.headerBg },
            activeReportTab === "info" ? null : styles.hiddenReportTopCard,
          ]}
        >
        {/* Always render the carousel — when no photo URLs resolve it shows
            a labelled placeholder rather than collapsing the hero entirely. */}
        <ReportPhotoCarousel
          report={effectiveReport}
          photoUrls={photoUrls}
          colors={colors}
          onRefreshPhotos={report.historyId ? handleRefreshPhotos : undefined}
          isRefreshingPhotos={isRefreshingPhotos}
          hideScore={landAreaMissing}
        />

        <View style={[styles.reportHeaderTop, { paddingTop: 12 }]}>
          <View style={[styles.reportIcon, { backgroundColor: colors.accent }]}>
            <Feather name="map-pin" size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.address, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
              {report.address}
            </Text>
            <View style={styles.headerMeta}>
              {(report.zone_label || report.propertyOverview?.zone)?.trim() ? (
                <View style={[styles.zoneBadge, { backgroundColor: "rgba(250,250,249,0.15)" }]}>
                  <Text style={{ color: "rgba(250,250,249,0.85)", fontFamily: "DM_Sans_500Medium", fontSize: 11 }}>
                    {(report.zone_label || report.propertyOverview?.zone || "").split("–")[0].trim().split(" ").slice(0, 3).join(" ")}
                  </Text>
                </View>
              ) : null}
              {typeof bedrooms === "number" && bedrooms > 0 && (
                <View style={styles.headerStatChip}>
                  <Feather name="moon" size={10} color="rgba(250,250,249,0.85)" />
                  <Text style={styles.headerStatText}>{t("report.header_bd", { n: bedrooms })}</Text>
                </View>
              )}
              {typeof bathrooms === "number" && bathrooms > 0 && (
                <View style={styles.headerStatChip}>
                  <Feather name="droplet" size={10} color="rgba(250,250,249,0.85)" />
                  <Text style={styles.headerStatText}>{t("report.header_ba", { n: bathrooms })}</Text>
                </View>
              )}
              {titleTypeDisplay ? (
                <View
                  style={[
                    styles.zoneBadge,
                    { backgroundColor: isNonFreeholdTenure ? "rgba(202,138,4,0.30)" : "rgba(250,250,249,0.15)" },
                  ]}
                >
                  <Text
                    style={{
                      color: isNonFreeholdTenure ? "#FDE68A" : "rgba(250,250,249,0.85)",
                      fontFamily: "DM_Sans_500Medium",
                      fontSize: 11,
                    }}
                  >
                    {titleTypeDisplay}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <TouchableOpacity
            style={[styles.reportShareBtn, { backgroundColor: "rgba(250,250,249,0.15)", borderColor: "rgba(250,250,249,0.24)" }]}
            onPress={handleToggleWatch}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={watched ? t("watchlist.remove") : t("watchlist.add")}
          >
            <Ionicons name={watched ? "heart" : "heart-outline"} size={17} color={watched ? "#ef4444" : "rgba(250,250,249,0.92)"} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.reportShareBtn, { backgroundColor: "rgba(250,250,249,0.15)", borderColor: "rgba(250,250,249,0.24)" }]}
            onPress={handleShare}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Share report"
          >
            <Feather name="log-out" size={16} color="rgba(250,250,249,0.92)" />
          </TouchableOpacity>
        </View>

        {report.overlay_map_image_base64 && (
          <View style={styles.overlayMapWrapper}>
            <Image
              source={{ uri: `data:image/png;base64,${report.overlay_map_image_base64}` }}
              style={styles.overlayMapImage}
              resizeMode="cover"
            />
            <View style={styles.overlayMapFooter}>
              <View style={styles.overlayMapLabelRow}>
                <Feather name="layers" size={11} color="rgba(250,249,246,0.7)" />
                <Text style={styles.overlayMapLabel}>{t("report.overlay_map_hougarden")}</Text>
              </View>
            </View>
          </View>
        )}

        {landAreaMissing ? (
          <ScoreHiddenNotice colors={colors} />
        ) : (
          <ScoreSummaryRow report={report} colors={colors} hideOverall />
        )}
        </View>
        {hasOpenedPlanTab && activeReportTab === "plan" ? (
          <SitePlanCard key={`${report.historyId ?? report.address ?? "report"}-site-plan`} report={report} />
        ) : null}
      </View>

      {(report.cv_unavailable || (report.missing_critical_fields && report.missing_critical_fields.length > 0)) && (
        <View style={[styles.warningBox, { backgroundColor: "#FEF08A20", borderColor: "#CA8A0450", borderRadius: 12, padding: 12 }]}>
          <Feather name="alert-triangle" size={14} color="#CA8A04" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#92400E", fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
              {t("report.warning_property_data_title")}
            </Text>
            <Text style={{ color: "#92400E", fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 }}>
              {t("report.warning_property_data_subtitle")}
            </Text>
          </View>
        </View>
      )}

      {/* Combined-listing disclaimer + "analyse full package" button intentionally
          hidden: a packaged listing is already expanded into one report per child
          address automatically, so the per-report disclaimer and re-analyse button
          are redundant. See runCombinedFeasibilityGroupCore on the API. */}

      {report.redevelopmentWarning?.suspected && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "45", borderRadius: 12, padding: 12 }]}>
          <Feather name="alert-triangle" size={14} color={colors.amber} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.amber, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
              {t("report.redevelopment_warning_title")}
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 }}>
              {report.redevelopmentWarning.message || t("report.redevelopment_warning_subtitle")}
            </Text>
          </View>
        </View>
      )}

      {report.propertyOverview && (
        <SectionCard title={t("report.overview")} icon="📍" defaultOpen={false} colors={colors}>
          <InfoRow
            label={t("report.cv")}
            value={report.propertyOverview.cv || t("report.unavailable")}
            valueColor={!report.propertyOverview.cv ? colors.amber : undefined}
            colors={colors}
          />
          <InfoRow
            label={t("report.land_area")}
            value={report.propertyOverview.landArea || (landAreaUnavailableContact ? t("report.land_unavailable_contact") : t("report.unavailable"))}
            valueColor={!report.propertyOverview.landArea ? colors.amber : undefined}
            colors={colors}
          />
          {report.propertyOverview.floorArea?.trim() ? (
            <View>
              <InfoRow label={t("report.floor_area")} value={report.propertyOverview.floorArea} colors={colors} />
            </View>
          ) : null}
          <InfoRow
            label={t("report.bedrooms")}
            value={typeof bedrooms === "number" && bedrooms > 0 ? String(bedrooms) : t("report.na")}
            valueColor={!(typeof bedrooms === "number" && bedrooms > 0) ? colors.amber : undefined}
            colors={colors}
          />
          <InfoRow
            label={t("report.bathrooms")}
            value={typeof bathrooms === "number" && bathrooms > 0 ? String(bathrooms) : t("report.na")}
            valueColor={!(typeof bathrooms === "number" && bathrooms > 0) ? colors.amber : undefined}
            colors={colors}
          />
          <InfoRow label={t("report.build_year")} value={report.propertyOverview.buildYear || t("report.na")} colors={colors} />
          {report.propertyOverview.propertyType?.trim() ? (
            <InfoRow label={t("report.property_type")} value={localisePropertyType(report.propertyOverview.propertyType, t)} colors={colors} />
          ) : null}
          {report.propertyOverview.siteStatus || report.propertyOverview.siteStatusLabel?.trim() ? (
            <InfoRow
              label={t("report.site_status")}
              value={localiseSiteStatusLabel(
                report.propertyOverview.siteStatus,
                report.propertyOverview.siteStatusLabel ?? undefined,
                t,
              )}
              valueColor={report.propertyOverview.siteStatus === "vacant_land" ? colors.success : undefined}
              colors={colors}
            />
          ) : null}
          {titleTypeDisplay ? (
            <InfoRow
              label={translateForOS("report.title_type")}
              value={titleTypeDisplay}
              valueColor={isNonFreeholdTenure ? colors.amber : undefined}
              colors={colors}
            />
          ) : null}
          <InfoRow label={t("report.zone")} value={report.propertyOverview.zone || t("report.na")} colors={colors} />
          {report.planning?.potentialLots != null && (
            <InfoRow
              label={t("report.standard_lots")}
              value={String(report.planning.standardVacantLots ?? report.planning.potentialLots)}
              valueColor={colors.success}
              colors={colors}
            />
          )}
          {report.planning?.designLedEligible && report.planning.designLedYieldRange ? (
            <InfoRow
              label={t("report.design_led_upside")}
              value={t("report.design_led_range_value", {
                min: report.planning.designLedYieldRange.min,
                max: report.planning.designLedYieldRange.max,
              })}
              valueColor={colors.amber}
              colors={colors}
            />
          ) : null}
          {report.propertyOverview.isOnMarket && report.propertyOverview.listingPrice && (
            <InfoRow label={t("report.listing_price")} value={report.propertyOverview.listingPrice} valueColor={colors.success} colors={colors} />
          )}
        </SectionCard>
      )}

      {titleInsightForDisplay?.isCrossLease && (
        <SectionCard title={translateForOS("report.title_insight_title")} icon="📜" status="warning" colors={colors}>
          {!!titleInsightForDisplay.opportunity?.trim() && (
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "DM_Sans_400Regular",
                fontSize: 13,
                lineHeight: 20,
                marginBottom: (titleInsightForDisplay.risks?.length ?? 0) > 0 ? 12 : 0,
              }}
            >
              {titleInsightForDisplay.opportunity}
            </Text>
          )}
          {(titleInsightForDisplay.risks ?? []).map((risk, idx) => (
            <View key={idx} style={{ flexDirection: "row", marginBottom: 8 }}>
              <Text style={{ color: colors.amber, fontFamily: "DM_Sans_600SemiBold", fontSize: 13, marginRight: 8 }}>•</Text>
              <Text style={{ flex: 1, color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20 }}>
                {risk}
              </Text>
            </View>
          ))}
        </SectionCard>
      )}

      {report.schoolZones && report.schoolZones.length > 0 && (
        <SectionCard title={translateForOS("report.school_zones")} icon="🎓" status="neutral" colors={colors}>
          <SchoolZonesPanel zones={report.schoolZones} colors={colors} />
        </SectionCard>
      )}

      {report.planning?.overlays && (
        <SectionCard title={t("report.planning_overlays")} icon="🏛" status={planningSection} alert={safeNum(report.scores?.ease) < 2.5} colors={colors}>
          <SubdivisionPathwayComparison planning={report.planning} colors={colors} />
          {!!report.planning.subdivisionSummary?.trim() && (
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20, marginBottom: 10 }}>
              {report.planning.subdivisionSummary}
            </Text>
          )}
          {!!report.planning.subdivisionPathwayNote?.trim() && (
            <SubdivisionPathwayCallout note={report.planning.subdivisionPathwayNote!} colors={colors} />
          )}
          <OverlayChecklist overlays={report.planning.overlays} colors={colors} />
          <OverlayMapSnippet
            base64={report.overlay_map_image_base64}
            caption={t("report.planning_overlay_map")}
            colors={colors}
          />
        </SectionCard>
      )}

      {report.asbestos && (
        <SectionCard title={t("report.asbestos_demolition")} icon="⚠" status={asbestosStatus as any} colors={colors}>
          <AsbestosPanel asbestos={report.asbestos} colors={colors} />
        </SectionCard>
      )}

      {report.terrain && (
        <SectionCard title={t("report.terrain_contour")} icon="⛰" status={contourStatus(report.terrain)} colors={colors}>
          <ContourCard report={report} terrain={report.terrain} colors={colors} />
          <OverlayMapSnippet
            base64={report.overlay_map_image_base64}
            caption={t("report.planning_overlay_map")}
            colors={colors}
          />
        </SectionCard>
      )}

      {report.infrastructure && report.infrastructure.length > 0 && (
        <SectionCard title={t("report.infrastructure_services")} icon="🔧" status={infraStatus(report.infrastructure)} colors={colors}>
          <InfrastructureTable infrastructure={report.infrastructure} colors={colors} />
        </SectionCard>
      )}

      {report.costItems && report.costItems.length > 0 && !landAreaMissing && (
        <SectionCard title={t("report.dev_cost_estimate")} icon="💰" status="neutral" alert={safeNum(report.scores?.cost) < 2.5} colors={colors}>
          <CostBreakdownChart
            costItems={report.costItems}
            totalCostLow={report.totalCostLow}
            totalCostHigh={report.totalCostHigh}
            costPerUnitAvg={report.cost_per_unit_avg}
            colors={colors}
          />
        </SectionCard>
      )}

      <SectionCard
        title={t("report.market_access_context")}
        icon=""
        status={marketAccessStatus(report)}
        colors={colors}
      >
        <MarketAccessContextPanel
          neighbourhoodContext={report.neighbourhoodContext}
          transportContext={report.transportContext}
          colors={colors}
        />
      </SectionCard>

      {visibleBuiltEnvironmentContext ? (
        <SectionCard
          title={t("report.built_environment")}
          icon="🏢"
          status={builtEnvironmentStatus(visibleBuiltEnvironmentContext)}
          colors={colors}
        >
          <BuiltEnvironmentPanel
            context={visibleBuiltEnvironmentContext}
            colors={colors}
            onAnalyseProperty={onAnalyseProperty}
          />
        </SectionCard>
      ) : null}

      {hasDevelopmentStrategies && !landAreaMissing && (
        <SectionCard title={t("report.development_strategy_scenarios")} icon="🧭" status={strategyStatus(developmentStrategies)} alert={safeNum(report.scores?.roi) < 2.5} colors={colors}>
          <DevelopmentStrategyPanel
            strategies={developmentStrategies}
            interestRateOutlook={report.interest_rate_outlook}
            comparablesQuality={report.comparables_quality}
            neighbourhoodContext={report.neighbourhoodContext}
            transportContext={report.transportContext}
            potentialLots={report.potential_lots || report.planning?.potentialLots}
            colors={colors}
          />
          {SHOW_COMPARABLE_SALES_IN_UI && hasLiveComparableSales && (
            <View style={{ marginTop: 14, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="home" size={13} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
                  {t("report.comparable_sales")}
                </Text>
              </View>
              <ComparableSalesTable
                comparables={realComparableSales}
                quality={report.comparables_quality}
                colors={colors}
              />
            </View>
          )}
        </SectionCard>
      )}

      {!hasDevelopmentStrategies && report.roiScenarios && report.roiScenarios.length > 0 && (
        <SectionCard title={t("report.roi_scenarios")} icon="📈" status={roiStatus(safeNum(report.scores?.roi))} alert={safeNum(report.scores?.roi) < 2.5} colors={colors}>
          {(report.cv_unavailable || report.roiScenarios[0]?.cv_unavailable) && (
            <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30", marginBottom: 10 }]}>
              <Feather name="alert-triangle" size={13} color={colors.amber} />
              <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
                {t("report.cv_unavailable_roi_banner")}
              </Text>
            </View>
          )}
          <NeighbourhoodContextNote context={report.neighbourhoodContext} colors={colors} />
          <TransportContextNote context={report.transportContext} colors={colors} />
          <ROIScenarioCards
            scenarios={report.roiScenarios}
            interestRateOutlook={report.interest_rate_outlook ?? report.roiScenarios[0]?.interest_rate_outlook}
            comparablesQuality={report.comparables_quality}
            colors={colors}
          />
          {SHOW_COMPARABLE_SALES_IN_UI && hasLiveComparableSales && (
            <View style={{ marginTop: 14, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Feather name="home" size={13} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
                  {t("report.comparable_sales")}
                </Text>
              </View>
              <ComparableSalesTable
                comparables={realComparableSales}
                quality={report.comparables_quality}
                colors={colors}
              />
            </View>
          )}
        </SectionCard>
      )}

      {riskSummaryForDisplay.length > 0 && (
        <SectionCard title={t("report.risk_assessment")} icon="🔍" status="neutral" colors={colors}>
          <RiskSummaryPanel riskSummary={riskSummaryForDisplay} colors={colors} />
        </SectionCard>
      )}

      <FollowUpChips report={report} onChipClick={onFollowUp} colors={colors} />
      <ReportAnalysisFootnote colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  reportBookmarkStack: { gap: 0 },
  // Segmented control sitting above the content card (no overlap with the hero photo).
  reportTabs: {
    flexDirection: "row",
    alignSelf: "center",
    gap: 4,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 12,
    marginBottom: 12,
  },
  reportTabButton: {
    minWidth: 112,
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  reportTabButtonActive: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  reportTabText: { fontFamily: "DM_Sans_700Bold", fontSize: 13, lineHeight: 18 },
  hiddenReportTopCard: { display: "none" },
  reportHeader: { borderRadius: 16, overflow: "hidden" },
  reportHeaderTop: { flexDirection: "row", gap: 12, padding: 16, alignItems: "flex-start" },
  reportPhotoWrapper: { width: "100%", height: 190, position: "relative", backgroundColor: "#1C1917" },
  reportPhotoScroller: { width: "100%", height: 190 },
  reportPhoto: { width: "100%", height: 190 },
  reportPhotoFallback: { width: "100%", height: 190, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24, backgroundColor: "#1C1917" },
  reportPhotoFallbackText: { color: "rgba(255,255,255,0.65)", fontFamily: "DM_Sans_500Medium", fontSize: 12, textAlign: "center" },
  reportPhotoOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, height: 80, backgroundColor: "transparent" },
  reportPhotoScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroOverallBadge: { position: "absolute", top: 12, right: 12, alignItems: "flex-end", gap: 4 },
  heroOverallLabel: { fontFamily: "DM_Sans_600SemiBold", fontSize: 9, textTransform: "uppercase", letterSpacing: 1.2, color: "rgba(255,255,255,0.92)", backgroundColor: "rgba(0,0,0,0.38)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, overflow: "hidden", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 2 },
  heroOverallPill: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 5 },
  heroOverallNumber: { fontFamily: "DM_Sans_700Bold", fontSize: 28, lineHeight: 32, color: "#FFFFFF" },
  heroOverallSub: { fontFamily: "DM_Sans_500Medium", fontSize: 12, lineHeight: 16, color: "rgba(255,255,255,0.85)" },
  reportIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center", flexShrink: 0, marginTop: 2 },
  reportShareBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  address: { fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" },
  zoneBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },
  headerStatChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 100, backgroundColor: "rgba(250,250,249,0.15)" },
  headerStatText: { color: "rgba(250,250,249,0.85)", fontFamily: "DM_Sans_500Medium", fontSize: 11 },
  photoCountPill: { position: "absolute", bottom: 10, left: 12, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 100, backgroundColor: "rgba(0,0,0,0.55)" },
  photoCountText: { color: "rgba(255,255,255,0.9)", fontFamily: "DM_Sans_500Medium", fontSize: 11 },
  photoDotRow: { position: "absolute", bottom: 12, left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  photoDot: { borderRadius: 5 },
  photoDotActive: { width: 20, height: 4, backgroundColor: "rgba(255,255,255,0.95)" },
  photoDotInactive: { width: 6, height: 4, backgroundColor: "rgba(255,255,255,0.40)" },
  refreshPhotosPill: { position: "absolute", bottom: 10, right: 12, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 100, backgroundColor: "rgba(0,0,0,0.65)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)" },
  refreshPhotosPillText: { color: "#fff", fontFamily: "DM_Sans_500Medium", fontSize: 11 },
  fullscreenPhotoRoot: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)", alignItems: "center", justifyContent: "center" },
  fullscreenPhotoStage: { flex: 1, width: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  fullscreenPhotoImage: { alignSelf: "center" },
  fullscreenPhotoTopBar: { position: "absolute", top: 0, left: 0, right: 0, paddingTop: 54, paddingHorizontal: 18, alignItems: "flex-end" },
  fullscreenPhotoClose: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)" },
  fullscreenPhotoFooter: { position: "absolute", bottom: 34, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18 },
  fullscreenPhotoNav: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.16)", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.25)" },
  fullscreenPhotoNavDisabled: { opacity: 0.35 },
  fullscreenPhotoCounter: { minWidth: 52, textAlign: "center", color: "rgba(255,255,255,0.9)", fontFamily: "DM_Sans_600SemiBold", fontSize: 12, fontVariant: ["tabular-nums"] },
  scoresSection: { paddingBottom: 16 },
  overallRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, gap: 8 },
  overallLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2 },
  overallBadge: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8 },
  overallNumber: { fontFamily: "DM_Sans_700Bold", fontSize: 44, lineHeight: 48 },
  overallSubLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 16, lineHeight: 22, marginBottom: 2 },
  scoresRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, paddingHorizontal: 12 },
  scoreDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  verdictRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingHorizontal: 16 },
  verdictText: { fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 18, color: "rgba(250,250,249,0.82)" },
  reasonsRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingHorizontal: 16, gap: 16 },
  reasonBlock: { flex: 1, gap: 3 },
  reasonTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7 },
  reasonText: { fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16 },
  sectionCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden", shadowColor: "rgba(28,25,23,0.04)", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  sectionIcon: { fontSize: 15 },
  sectionTitle: { fontSize: 14 },
  sectionBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 13, textAlign: "right", flex: 1 },
  overlayRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10 },
  riskBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderWidth: 1 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  combinedAction: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, flexDirection: "row", gap: 6, alignItems: "center" },
  strategyMetric: { flex: 1, borderRadius: 10, padding: 10, gap: 3 },
  infraRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, gap: 6 },
  locationChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, borderWidth: 1 },
  costBar: { height: 14, flexDirection: "row", borderRadius: 7, overflow: "hidden" },
  costBarSegment: { height: 14 },
  costLegend: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  costLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  costLegendDot: { width: 8, height: 8, borderRadius: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 12, marginTop: 6 },
  roiCard: { width: 168, borderRadius: 14, padding: 14, position: "relative" },
  bestBadge: { position: "absolute", top: 10, right: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  roiDivider: { height: 1, marginVertical: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  tableHeader: { flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1 },
  tableHeaderCell: { fontFamily: "DM_Sans_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 4 },
  overlayMapWrapper: { width: "100%", height: 200 },
  overlayMapImage: { width: "100%", height: 200 },
  overlayMapFooter: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(0,0,0,0.45)" },
  overlayMapLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  overlayMapLabel: { color: "rgba(250,249,246,0.85)", fontFamily: "DM_Sans_500Medium", fontSize: 11 },
  overlayMapSource: { color: "rgba(250,249,246,0.45)", fontFamily: "DM_Sans_400Regular", fontSize: 10 },
});
