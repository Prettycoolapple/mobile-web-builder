import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { StarRating } from "@/components/StarRating";
import { useColors } from "@/hooks/useColors";
import { useT, translate, translateForOS } from "@/lib/i18n";
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";
import {
  filterRiskSummaryRemoveIncompleteDataDisclaimerBullets,
  filterScoreReasonStrings,
} from "@/lib/riskSummaryIncompleteDataFilter";
import { ensureRiskSummaryMinForReport } from "@/lib/reportRiskBackfill";
import { formatTitleTypeForDisplay } from "@/lib/titleDisplay";
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
  EasementEntry,
  DevelopmentStrategyScenario,
  DevelopmentStrategyId,
  SchoolZoneDetail,
  NeighbourhoodContext,
  TransportContext,
} from "@/context/ChatContext";

/** Comparable sale address cards are hidden for now; `comparableSales` remains on the report for ROI logic. Set to true to show cards again. */
const SHOW_COMPARABLE_SALES_IN_UI = false;

interface Props {
  report: Report;
  onFollowUp: (question: string) => void;
}

function formatNZD(n: number | string | undefined | null): string {
  const num = n == null ? NaN : Number(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${Math.round(num / 1_000).toLocaleString()}k`;
  return `$${Math.round(num).toLocaleString()}`;
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
  if (terrain.classification === "steep") return "risk";
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
const CAROUSEL_TARGET = 4;

function getReportPhotoUrls(report: Report): string[] {
  const address = (report.address ?? "").trim();
  const streetview = address ? streetViewUrlFor(address) : null;
  const staticMap = address ? staticMapUrlFor(address) : null;

  /** Pad `urls` up to CAROUSEL_TARGET using Street View then Satellite. */
  const padToTarget = (urls: string[]): string[] => {
    let out = [...urls];
    if (streetview && out.length < CAROUSEL_TARGET && !out.includes(streetview))
      out.push(streetview);
    if (staticMap && out.length < CAROUSEL_TARGET && !out.includes(staticMap))
      out.push(staticMap);
    return out.slice(0, CAROUSEL_TARGET);
  };

  const cached = (report.cachedPhotoUris ?? []).filter(
    (uri): uri is string => typeof uri === "string" && uri.length > 0,
  );
  if (cached.length > 0) return padToTarget(cached);

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
    return padToTarget(proxied);
  }

  if (!address) return [];
  return padToTarget([]);
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
  children,
  colors,
}: {
  title: string;
  icon?: string;
  status?: "good" | "warning" | "risk" | "neutral";
  defaultOpen?: boolean;
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
  "land area limits subdivision to single dwelling": "土地面积限制分割 — 可能仅适合单一住宅",
  "excellent cost efficiency per unit": "单元成本效率优秀",
  "good cost per unit for nz market": "单元成本在新西兰市场中较好",
  "moderate cost - market viable": "成本中等 — 市场上仍具可行性",
  "high cost per unit - margin is thin": "单元成本较高 — 利润空间偏薄",
  "very high cost - roi challenging": "成本很高 — 投资回报具挑战",
  "extreme cost - feasibility doubtful": "成本极高 — 可行性存疑",
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
  if (locale !== "zh" || CJK_TEXT_RE.test(reason)) return reason;

  const normalized = normalizeScoreReason(reason);
  const translated = SCORE_REASON_ZH[normalized];
  if (translated) return translated;

  const costPerUnit = reason.match(/^Cost per unit:\s*(.+)$/i);
  if (costPerUnit) return `单元成本：${costPerUnit[1]}`;

  const bestCase = reason.match(/^Best case:\s*(.+?)\s+ROI over\s+(.+?)\s+years?$/i);
  if (bestCase) return `最佳情况：${bestCase[1]} ROI，周期 ${bestCase[2]} 年`;

  const baseCase = reason.match(/^Base case:\s*(.+?)\s+ROI over\s+(.+?)\s+years?$/i);
  if (baseCase) return `基准情况：${baseCase[1]} ROI，周期 ${baseCase[2]} 年`;

  return reason;
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
  const overallColor = scoreColor(composite, colors);
  const overallDisplay = formatCompositeScoreForDisplay(composite);
  const showReasons = ease_reasons.length > 0 || roi_reasons.length > 0;

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

function ReportPhotoCarousel({
  report,
  photoUrls,
  colors,
}: {
  report: Report;
  photoUrls: string[];
  colors: ReturnType<typeof useColors>;
}) {
  const [width, setWidth] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
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

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    if (width <= 0) return;
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    setCurrentIndex(Math.min(Math.max(newIndex, 0), total - 1));
  }, [width, total]);

  return (
    <View
      style={styles.reportPhotoWrapper}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
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
            <Image
              key={`${url}-${index}`}
              source={{ uri: url }}
              style={[styles.reportPhoto, width > 0 ? { width } : undefined]}
              resizeMode="cover"
              onError={() => handleError(url)}
            />
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

      {/* Overall score badge */}
      <View style={styles.heroOverallBadge}>
        <Text style={[styles.heroOverallLabel, { color: "rgba(255,255,255,0.85)" }]}>{translate("report.score_overall")}</Text>
        <View style={[styles.heroOverallPill, { backgroundColor: overallColor + "EE", borderColor: "rgba(255,255,255,0.35)" }]}>
          <Text style={styles.heroOverallNumber}>{overallDisplay}</Text>
          <Text style={styles.heroOverallSub}>/ 5</Text>
        </View>
      </View>

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

function OverlayChecklist({ overlays, colors }: { overlays: PlanningOverlay[]; colors: ReturnType<typeof useColors> }) {
  const { t } = useT();
  if (!overlays || overlays.length === 0) {
    return <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>{t("report.no_overlays")}</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {overlays.map((o, i) => {
        const indicator = o.status === "restricted" ? "🔴" : o.status === "moderate" ? "🟡" : "🟢";
        const textColor = o.status === "restricted" ? colors.red : o.status === "moderate" ? colors.amber : colors.success;
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
  const riskLabel =
    risk === "high"
      ? t("report.asbestos_risk_high")
      : risk === "low"
        ? buildYearNum && buildYearNum < 1940
          ? t("report.asbestos_risk_low_pre1940")
          : t("report.asbestos_risk_low_post1990")
        : t("report.asbestos_risk_unknown");

  const demoCostLow = asbestos.demoCostLow ?? 0;
  const demoCostHigh = asbestos.demoCostHigh ?? 0;
  const isVacant = demoCostLow === 0 && demoCostHigh === 0;

  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.riskBanner, { backgroundColor: riskColor + "15", borderColor: riskColor + "30", borderRadius: 10 }]}>
        <Text style={{ fontSize: 18 }}>{risk === "high" ? "⚠️" : risk === "low" ? "✅" : "❓"}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: riskColor, fontFamily: "DM_Sans_700Bold", fontSize: 13 }}>{t("report.asbestos_risk_prefix")}: {riskLabel}</Text>
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
      {(asbestos.worksafe_required || asbestos.flagged) && (
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
  gentle:   "report.terrain_cls_gentle",
  moderate: "report.terrain_cls_moderate",
  steep:    "report.terrain_cls_steep",
};

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

  const steepness = cls === "steep" ? 40 : cls === "moderate" ? 22 : cls === "gentle" ? 10 : 3;
  const W = 120, H = 70;
  const slopeY = H - (steepness / 45) * H;
  const terrainColor = cls === "steep" ? colors.red : cls === "moderate" ? colors.amber : colors.success;
  const slopeSummary = terrain.slope
    ?.replace(/(?:数据来源|來源|source)\s*[:：].*/giu, "")
    ?.replace(/\s*[—-]\s*(?:based on|calculated|estimate|derived|from|via).*/giu, "")
    ?.trim();

  const clsLabel = t(TERRAIN_CLS_KEY[cls] ?? "report.terrain_cls_gentle");

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
      {(cls === "steep" || cls === "moderate") && (
        <View style={[styles.warningBox, { backgroundColor: terrainColor + "12", borderColor: terrainColor + "30" }]}>
          <Feather name="alert-triangle" size={13} color={terrainColor} />
          <Text style={{ color: terrainColor, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {cls === "steep"
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
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>{svc.note}</Text>
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
            Infrastructure location could not be determined automatically. Verify service locations at geomapspublic.aucklandcouncil.govt.nz or engage a civil engineer.
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
      <InterestRateBanner outlook={outlook} colors={colors} />

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
                      {profit >= 0 ? "+" : ""}{formatNZD(Math.abs(profit))}
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
  const reasons = context.roiInfluence?.reasons?.filter((line) => line.trim().length > 0) ?? [];
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
              {rapidStop.routeCount} route{rapidStop.routeCount === 1 ? "" : "s"}; {rapidStop.serviceIntensity} service.
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
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 8 }}>
        {riskSummary.map((r, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Text style={{ fontSize: 14, marginTop: 1 }}>⚠️</Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20, flex: 1 }}>{r}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, fontStyle: "italic", lineHeight: 16, marginTop: 4 }}>
        {t("report.risk_section_disclaimer")}
      </Text>
    </View>
  );
}

/** Quiet legal / data-staleness note at end of report—not a full section card. */
function ReportAnalysisFootnote({ colors }: { colors: ReturnType<typeof useColors> }) {
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

function FollowUpChips({ report, onChipClick, colors }: {
  report: Report;
  onChipClick: (msg: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const { t } = useT();
  const zone = report.zone_label || report.planning?.zone || report.propertyOverview?.zone || "this zone";
  const lots = report.potential_lots || report.planning?.potentialLots || 0;

  const chips: string[] = [
    t("report.followup_main_risks"),
    t("report.followup_building_typology"),
  ];

  const asbestosRisk = report.asbestos ? getAsbestosRisk(report.asbestos) : "unknown";
  if (report.asbestos && asbestosRisk === "high") {
    chips.push(t("report.followup_asbestos_process"));
  }
  if (hasOverlay(report, "flood")) {
    chips.push(t("report.followup_flood_overlay"));
  }
  if (hasOverlay(report, "heritage")) {
    chips.push(t("report.followup_heritage_overlay"));
  }
  if (safeNum(report.scores?.roi) < 2.5) {
    chips.push(t("report.followup_improve_roi"));
  }
  if (lots >= 3) {
    chips.push(t("report.followup_consent_steps", { lots }));
  }
  chips.push(t("report.followup_explain_zone", { zone }));

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
              <Text style={{ flex: 1, color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 14, lineHeight: 20 }}>
                {z.matched && z.orgName ? z.orgName : z.sourceLabel}
              </Text>
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

export function FeasibilityReportCard({ report, onFollowUp }: Props) {
  const colors = useColors();
  const { t } = useT();

  const planningSection = overlayStatus(report);
  const asbestosStatus: "good" | "warning" | "risk" | "neutral" = report.asbestos
    ? (getAsbestosRisk(report.asbestos) === "high" ? "risk" : "good")
    : "neutral";
  const photoUrls = getReportPhotoUrls(report);
  const bedrooms = report.propertyOverview?.bedrooms;
  const bathrooms = report.propertyOverview?.bathrooms;
  const realComparableSales = (report.comparableSales ?? []).filter(isSourceBackedComparable);
  // Show comparables whenever we have any — "estimated" (active listings) is still real market data
  const hasLiveComparableSales = realComparableSales.length > 0;
  const developmentStrategies = report.developmentStrategies ?? [];
  const hasDevelopmentStrategies = developmentStrategies.length > 0;
  const hasMarketAccessContext = Boolean(report.neighbourhoodContext || report.transportContext);
  const titleTypeDisplay = formatTitleTypeForDisplay(report.propertyOverview?.titleType);
  const riskSummaryForDisplay = useMemo(() => {
    const scrubbed = filterRiskSummaryRemoveIncompleteDataDisclaimerBullets(report.riskSummary ?? []);
    return ensureRiskSummaryMinForReport(report, scrubbed, 3);
  }, [report]);

  return (
    <View style={styles.container}>
      <View style={[styles.reportHeader, { backgroundColor: colors.headerBg }]}>
        {/* Always render the carousel — when no photo URLs resolve it shows
            a labelled placeholder rather than collapsing the hero entirely. */}
        <ReportPhotoCarousel report={report} photoUrls={photoUrls} colors={colors} />

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
              {titleTypeDisplay ? (
                <View style={[styles.zoneBadge, { backgroundColor: "rgba(250,250,249,0.12)" }]}>
                  <Text
                    style={{ color: "rgba(250,250,249,0.85)", fontFamily: "DM_Sans_500Medium", fontSize: 11 }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {titleTypeDisplay}
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
            </View>
          </View>
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

        <ScoreSummaryRow report={report} colors={colors} hideOverall />
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
            value={report.propertyOverview.landArea || t("report.unavailable")}
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
          <InfoRow label={t("report.zone")} value={report.propertyOverview.zone || t("report.na")} colors={colors} />
          {titleTypeDisplay ? (
            <InfoRow label={translateForOS("report.title_type")} value={titleTypeDisplay} colors={colors} />
          ) : null}
          {report.planning?.potentialLots != null && (
            <InfoRow label={t("report.potential_lots")} value={String(report.planning.potentialLots)} valueColor={colors.success} colors={colors} />
          )}
          {report.propertyOverview.isOnMarket && report.propertyOverview.listingPrice && (
            <InfoRow label={t("report.listing_price")} value={report.propertyOverview.listingPrice} valueColor={colors.success} colors={colors} />
          )}
        </SectionCard>
      )}

      {report.schoolZones && report.schoolZones.length > 0 && (
        <SectionCard title={translateForOS("report.school_zones")} icon="🎓" status="neutral" colors={colors}>
          <SchoolZonesPanel zones={report.schoolZones} colors={colors} />
        </SectionCard>
      )}

      {report.planning?.overlays && (
        <SectionCard title={t("report.planning_overlays")} icon="🏛" status={planningSection} colors={colors}>
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

      {report.costItems && report.costItems.length > 0 && (
        <SectionCard title={t("report.dev_cost_estimate")} icon="💰" status="neutral" colors={colors}>
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
        defaultOpen={hasMarketAccessContext}
        colors={colors}
      >
        <MarketAccessContextPanel
          neighbourhoodContext={report.neighbourhoodContext}
          transportContext={report.transportContext}
          colors={colors}
        />
      </SectionCard>

      {hasDevelopmentStrategies && (
        <SectionCard title={t("report.development_strategy_scenarios")} icon="🧭" status={strategyStatus(developmentStrategies)} colors={colors}>
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
        <SectionCard title={t("report.roi_scenarios")} icon="📈" status={roiStatus(safeNum(report.scores?.roi))} colors={colors}>
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
  heroOverallLabel: { fontFamily: "DM_Sans_600SemiBold", fontSize: 9, textTransform: "uppercase", letterSpacing: 1.2, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 3 },
  heroOverallPill: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 5 },
  heroOverallNumber: { fontFamily: "DM_Sans_700Bold", fontSize: 28, lineHeight: 32, color: "#FFFFFF" },
  heroOverallSub: { fontFamily: "DM_Sans_500Medium", fontSize: 12, lineHeight: 16, color: "rgba(255,255,255,0.85)" },
  reportIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center", flexShrink: 0, marginTop: 2 },
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
  scoresSection: { paddingBottom: 16 },
  overallRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, gap: 8 },
  overallLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2 },
  overallBadge: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8 },
  overallNumber: { fontFamily: "DM_Sans_700Bold", fontSize: 44, lineHeight: 48 },
  overallSubLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 16, lineHeight: 22, marginBottom: 2 },
  scoresRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, paddingHorizontal: 12 },
  scoreDivider: { width: StyleSheet.hairlineWidth, height: 36 },
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
