import { Document, Page, View, Text, Image } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { FeasibilityReport } from "@/state/chat-model";
import {
  formatArea,
  formatComposite,
  formatMoney,
  formatPercent,
  formatRange,
  formatScore,
} from "@/lib/format";
import { styles, scoreHex, safeBrandColor, type BrandKit } from "@/lib/pdfStyles";

export type SectionKey =
  | "overview"
  | "title"
  | "schools"
  | "planning"
  | "asbestos"
  | "terrain"
  | "infrastructure"
  | "cost"
  | "market"
  | "builtEnv"
  | "strategies"
  | "roi"
  | "comparables"
  | "risk";

export const SECTION_LABELS: Record<SectionKey, string> = {
  overview: "Property overview",
  title: "Land title",
  schools: "School zones",
  planning: "Planning & subdivision",
  asbestos: "Asbestos & demolition",
  terrain: "Terrain & contour",
  infrastructure: "Infrastructure & services",
  cost: "Development cost estimate",
  market: "Market access & context",
  builtEnv: "Built environment",
  strategies: "Development strategy scenarios",
  roi: "ROI scenarios",
  comparables: "Comparable sales",
  risk: "Risk assessment",
};

export const ALL_SECTION_KEYS: SectionKey[] = [
  "overview",
  "title",
  "schools",
  "planning",
  "asbestos",
  "terrain",
  "infrastructure",
  "cost",
  "market",
  "builtEnv",
  "strategies",
  "roi",
  "comparables",
  "risk",
];

export interface PdfLayout {
  coverTitle: string;
  coverSubtitle: string;
  executiveSummary: string;
  includeSections: Record<SectionKey, boolean>;
  sectionOrder: SectionKey[];
  /** Cover logo placement in PDF points (A4 page is ~595 wide). */
  logoBox: { x: number; y: number; width: number };
  showCoverPhoto: boolean;
}

export interface PdfContentEdits {
  fields: Record<string, string>;
  sectionNotes: Partial<Record<SectionKey, string>>;
}

export const EMPTY_PDF_CONTENT_EDITS: PdfContentEdits = {
  fields: {},
  sectionNotes: {},
};

export function defaultLayout(report: FeasibilityReport): PdfLayout {
  return {
    coverTitle: "Feasibility Report",
    coverSubtitle: report.address ?? "",
    executiveSummary: "",
    includeSections: ALL_SECTION_KEYS.reduce(
      (acc, k) => ({ ...acc, [k]: true }),
      {} as Record<SectionKey, boolean>,
    ),
    sectionOrder: [...ALL_SECTION_KEYS],
    logoBox: { x: 400, y: 40, width: 150 },
    showCoverPhoto: true,
  };
}

// ── small primitives ─────────────────────────────────────────────────────────
function KV({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  const visible = rows.filter(([, v]) => v && v !== "—");
  if (visible.length === 0) return null;
  return (
    <View style={styles.kvTable}>
      {visible.map(([k, v], i) => (
        <View style={styles.kvRow} key={`${k}-${i}`} wrap={false}>
          <Text style={styles.kvKey}>{k}</Text>
          <Text style={styles.kvVal}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function Bullets({ items }: { items: (string | null | undefined)[] }) {
  const visible = items.filter((x): x is string => !!x && x.trim().length > 0);
  if (visible.length === 0) return null;
  return (
    <View style={{ marginTop: 4 }}>
      {visible.map((t, i) => (
        <View style={styles.listItem} key={i}>
          <Text style={styles.listBullet}>•</Text>
          <Text style={styles.listText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

function Section({
  title,
  brand,
  note,
  children,
}: {
  title: string;
  brand: string;
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={[styles.sectionTitleBar, { borderBottomColor: brand }]} wrap={false}>
        <Text style={[styles.sectionTitle, { marginBottom: 0, color: brand }]}>{title}</Text>
      </View>
      {children}
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function cap(s?: string | null): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function shouldHideMarketReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("linz title-owner data was unavailable") && normalized.includes("no public-housing conclusion");
}

function visibleMarketReasons(items: (string | null | undefined)[]): string[] {
  return items.filter((item): item is string => !!item && item.trim().length > 0 && !shouldHideMarketReason(item));
}

function strategyRecommendationLabel(recommendation?: string | null, recommended?: boolean): string {
  if (recommended || recommendation === "recommended") return "Recommended";
  return cap(recommendation);
}

function editText(edits: PdfContentEdits | undefined, key: string, fallback?: string | null): string | null {
  const edited = edits?.fields?.[key];
  if (typeof edited === "string") return edited.trim() ? edited : null;
  return fallback && fallback.trim() ? fallback : null;
}

function editLines(
  edits: PdfContentEdits | undefined,
  key: string,
  fallback: (string | null | undefined)[] = [],
): string[] {
  const edited = edits?.fields?.[key];
  if (typeof edited === "string") {
    return edited
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return fallback.filter((line): line is string => !!line && line.trim().length > 0);
}

function sectionNote(edits: PdfContentEdits | undefined, key: SectionKey): string | null {
  const note = edits?.sectionNotes?.[key];
  return note && note.trim() ? note : null;
}

// ── editable data tables ─────────────────────────────────────────────────────
// Every key/value data row in the report is exposed here as an editable field so
// the PDF editor can override it. This is the SINGLE SOURCE OF TRUTH for both the
// renderer (below) and the editor's "Report data" panel — keys must match, so
// both read rows from this list rather than computing values independently.
export type EditableDataField = { section: SectionKey; key: string; label: string; value: string };

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function dataFieldKey(section: SectionKey, label: string, keyPart?: string): string {
  return `data.${section}.${keyPart ?? slug(label)}`;
}

// Per-item KV specs (stable keyPart → sub-label) shared between editableDataFields
// and the nested strategy/ROI renderers.
const STRATEGY_ROW_SPEC: Array<[string, string]> = [
  ["total_cost", "Total cost"],
  ["cost_per_unit", "Cost per unit"],
  ["confidence", "Confidence"],
  ["best_gdv", "Best-case GDV"],
  ["best_roi", "Best-case ROI"],
];
const ROI_ROW_SPEC: Array<[string, string]> = [
  ["gdv", "GDV"],
  ["total_cost", "Total cost"],
  ["gross_profit", "Gross profit"],
  ["roi", "ROI"],
  ["annualised_roi", "Annualised ROI"],
];

export function editableDataFields(report: FeasibilityReport): EditableDataField[] {
  const ov = report.propertyOverview;
  const planning = report.planning;
  const out: EditableDataField[] = [];
  const push = (section: SectionKey, label: string, value: string | null | undefined, keyPart?: string) => {
    if (value == null) return;
    const v = String(value).trim();
    if (!v || v === "—") return;
    out.push({ section, key: dataFieldKey(section, label, keyPart), label, value: v });
  };

  if (ov) {
    push("overview", "Capital value", ov.cv);
    push("overview", "Land area", ov.landArea);
    push("overview", "Floor area", ov.floorArea);
    push("overview", "Bedrooms", typeof ov.bedrooms === "number" && ov.bedrooms > 0 ? String(ov.bedrooms) : null);
    push("overview", "Bathrooms", typeof ov.bathrooms === "number" && ov.bathrooms > 0 ? String(ov.bathrooms) : null);
    push("overview", "Build year", ov.buildYear);
    push("overview", "Property type", ov.propertyType);
    push("overview", "Site status", ov.siteStatusLabel);
    push("overview", "Title type", ov.titleType);
    push("overview", "Zone", ov.zone);
    push("overview", "Standard lots", planning?.potentialLots != null ? String(planning.standardVacantLots ?? planning.potentialLots) : null);
    push("overview", "Listing price", ov.isOnMarket ? ov.listingPrice : null);
  }

  if (planning) {
    push("planning", "Zone", planning.zone ?? ov?.zone);
    push("planning", "Minimum lot size", planning.minLotSize ?? (planning.standardMinLotSize ? `${planning.standardMinLotSize} m²` : null));
    push("planning", "Standard pathway lots", planning.standardVacantLots != null ? String(planning.standardVacantLots) : null);
    push(
      "planning",
      "Design-led yield",
      planning.designLedEligible && planning.designLedYieldRange
        ? `${planning.designLedYieldRange.min}–${planning.designLedYieldRange.max} units (${planning.designLedConfidence ?? "low"})`
        : null,
    );
    push("planning", "Net developable area", planning.netAreaSqm ? `${Math.round(planning.netAreaSqm)} m²` : null);
  }

  if (report.asbestos) {
    push("asbestos", "Build year", report.asbestos.buildYear ?? ov?.buildYear);
    push("asbestos", "Risk level", cap(report.asbestos.riskLevel));
    push("asbestos", "WorkSafe notification", report.asbestos.worksafe_required ? "Likely required" : "Not flagged");
    push("asbestos", "Estimated demolition", formatRange(report.asbestos.demoCostLow, report.asbestos.demoCostHigh));
  }

  if (report.terrain) {
    push("terrain", "Classification", cap(report.terrain.classification ?? ""));
    push("terrain", "Slope", report.terrain.slope ?? (report.terrain.slope_degrees != null ? `${report.terrain.slope_degrees}°` : null));
    push("terrain", "Retaining estimate", formatRange(report.terrain.retainingCostLow, report.terrain.retainingCostHigh));
  }

  (report.infrastructure ?? []).forEach((svc, i) => {
    const label = `${svc.name} · ${(svc.location ?? "").replace(/-/g, " ")}`;
    push("infrastructure", label, formatRange(svc.estimatedCostLow ?? svc.estimated_cost_low, svc.estimatedCostHigh ?? svc.estimated_cost_high), String(i));
  });

  (report.costItems ?? []).forEach((ci, i) => {
    push("cost", ci.label, formatRange(ci.low, ci.high), String(i));
  });

  const tr = report.transportContext;
  if (tr) {
    push("market", "Public transport", cap(tr.publicTransport.accessTier));
    push("market", "Nearest stop", tr.publicTransport.nearestStop ? `${tr.publicTransport.nearestStop.name} · ${tr.publicTransport.nearestStop.distanceM}m` : null);
    push("market", "City commute", tr.cityCommute.centreName ? `${tr.cityCommute.centreName}${tr.cityCommute.distanceKm != null ? ` · ${tr.cityCommute.distanceKm}km` : ""}` : null);
  }

  const ctx = report.builtEnvironmentContext;
  if (ctx && ctx.assessedProperties !== 0) {
    push("builtEnv", "Assessed properties", String(ctx.assessedProperties));
    push("builtEnv", "Modern share", formatPercent(ctx.modernShare * 100));
    push("builtEnv", "Median build year", ctx.medianBuildYear != null ? String(ctx.medianBuildYear) : null);
  }

  for (const s of report.developmentStrategies ?? []) {
    const best = s.roiScenarios.find((x) => x.isBest) ?? s.roiScenarios[0];
    const values: Record<string, string | null | undefined> = {
      total_cost: formatRange(s.totalCostLow, s.totalCostHigh),
      cost_per_unit: formatMoney(s.costPerUnitAvg),
      confidence: formatPercent(s.confidence * 100),
      best_gdv: best ? formatMoney(best.gdv) : null,
      best_roi: best ? formatPercent(best.roi ?? best.roi_percent) : null,
    };
    for (const [keyPart, sub] of STRATEGY_ROW_SPEC) {
      push("strategies", `${s.title} — ${sub}`, values[keyPart], `${s.id}.${keyPart}`);
    }
  }

  if ((report.developmentStrategies?.length ?? 0) === 0) {
    (report.roiScenarios ?? []).forEach((sc, i) => {
      const head = `${sc.lots ? `${sc.lots} lots` : "Scenario"} · ${sc.years}yr`;
      const values: Record<string, string | null | undefined> = {
        gdv: formatMoney(sc.gdv),
        total_cost: formatMoney(sc.totalCost ?? sc.total_cost_mid),
        gross_profit: formatMoney(sc.grossProfit ?? sc.gross_profit),
        roi: formatPercent(sc.roi ?? sc.roi_percent),
        annualised_roi: formatPercent(sc.annualisedRoi ?? sc.annualised_roi_percent),
      };
      for (const [keyPart, sub] of ROI_ROW_SPEC) {
        push("roi", `${head} — ${sub}`, values[keyPart], `${i}.${keyPart}`);
      }
    });
  }

  if (report.comparables_quality === "live") {
    (report.comparableSales ?? [])
      .filter((c) => (c.price ?? c.price_nzd ?? 0) > 0)
      .slice(0, 8)
      .forEach((c, i) => {
        const label = `${c.address}${(c.saleDate ?? c.sale_date) ? ` · ${c.saleDate ?? c.sale_date}` : ""}`;
        push("comparables", label, formatMoney(c.price ?? c.price_nzd), String(i));
      });
  }

  return out;
}

// Resolve the final (possibly edited) value for a single data field by key.
function dataVal(edits: PdfContentEdits | undefined, byKey: Map<string, EditableDataField>, key: string): string | null {
  return editText(edits, key, byKey.get(key)?.value);
}

// ── section renderers ────────────────────────────────────────────────────────
function renderSection(
  key: SectionKey,
  report: FeasibilityReport,
  brand: string,
  edits: PdfContentEdits | undefined,
  byKey: Map<string, EditableDataField>,
): ReactNode {
  const ov = report.propertyOverview;
  const planning = report.planning;
  // KV rows for a flat section, in declaration order, with edits applied.
  const flatRows = (section: SectionKey): Array<[string, string | null]> =>
    [...byKey.values()]
      .filter((f) => f.section === section)
      .map((f) => [f.label, dataVal(edits, byKey, f.key)] as [string, string | null]);
  switch (key) {
    case "overview":
      if (!ov) return null;
      return (
        <Section key={key} title={SECTION_LABELS.overview} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("overview")} />
        </Section>
      );
    case "title":
      if (!report.titleInsight?.isCrossLease) return null;
      return (
        <Section key={key} title={SECTION_LABELS.title} brand={brand} note={sectionNote(edits, key)}>
          {editText(edits, "title.opportunity", report.titleInsight.opportunity) ? (
            <Text style={styles.paragraph}>{editText(edits, "title.opportunity", report.titleInsight.opportunity)}</Text>
          ) : null}
          <Bullets items={editLines(edits, "title.risks", report.titleInsight.risks ?? [])} />
        </Section>
      );
    case "schools":
      if (!report.schoolZones || report.schoolZones.length === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.schools} brand={brand} note={sectionNote(edits, key)}>
          {report.schoolZones.map((z, i) => (
            <View key={i} style={{ marginBottom: 6 }}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>{z.orgName ?? z.sourceLabel}</Text>
              <Text style={{ fontSize: 9, color: "#6b625b" }}>
                {[cap(z.level), z.yearLevels, z.enrolmentScheme, z.roll ? `${z.roll} roll` : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ))}
        </Section>
      );
    case "planning":
      if (!planning || !(planning.overlays || planning.subdivisionSummary || planning.potentialLots != null)) return null;
      return (
        <Section key={key} title={SECTION_LABELS.planning} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("planning")} />
          {editText(edits, "planning.subdivisionSummary", planning.subdivisionSummary) ? (
            <Text style={styles.note}>{editText(edits, "planning.subdivisionSummary", planning.subdivisionSummary)}</Text>
          ) : null}
          {editText(edits, "planning.subdivisionPathwayNote", planning.subdivisionPathwayNote) ? (
            <Text style={styles.note}>{editText(edits, "planning.subdivisionPathwayNote", planning.subdivisionPathwayNote)}</Text>
          ) : null}
          {planning.overlays && planning.overlays.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {planning.overlays.map((o, i) => (
                <View key={i} style={{ marginBottom: 4 }}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 9.5 }}>
                    {o.name} {o.status ? `(${o.status})` : ""}
                  </Text>
                  {o.detail ? <Text style={{ fontSize: 9, color: "#6b625b" }}>{o.detail}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
          {planning.easements && planning.easements.length > 0 ? (
            <Bullets
              items={editLines(
                edits,
                "planning.easements",
                planning.easements.map((e) => `${e.description}${e.severity ? ` (${e.severity})` : ""}`),
              )}
            />
          ) : null}
          {report.overlay_map_image_base64 ? (
            <Image style={styles.overlayMap} src={ensureDataUri(report.overlay_map_image_base64)} />
          ) : null}
        </Section>
      );
    case "asbestos":
      if (!report.asbestos) return null;
      return (
        <Section key={key} title={SECTION_LABELS.asbestos} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("asbestos")} />
          {editText(edits, "asbestos.notes", report.asbestos.notes) ? (
            <Text style={styles.note}>{editText(edits, "asbestos.notes", report.asbestos.notes)}</Text>
          ) : null}
        </Section>
      );
    case "terrain":
      if (!report.terrain) return null;
      return (
        <Section key={key} title={SECTION_LABELS.terrain} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("terrain")} />
        </Section>
      );
    case "infrastructure":
      if (!report.infrastructure || report.infrastructure.length === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.infrastructure} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("infrastructure")} />
        </Section>
      );
    case "cost":
      if (!report.costItems || report.costItems.length === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.cost} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("cost")} />
          <View style={[styles.kvRow, { borderBottomWidth: 0, marginTop: 4 }]} wrap={false}>
            <Text style={styles.kvTotalKey}>
              Total{report.total_excludes_land ? " (excl. land)" : ""}
            </Text>
            <Text style={styles.kvTotalVal}>{formatRange(report.totalCostLow, report.totalCostHigh)}</Text>
          </View>
        </Section>
      );
    case "market": {
      const tr = report.transportContext;
      const nb = report.neighbourhoodContext;
      if (!tr && !nb) return null;
      return (
        <Section key={key} title={SECTION_LABELS.market} brand={brand} note={sectionNote(edits, key)}>
          {tr ? <KV rows={flatRows("market")} /> : null}
          {tr?.roiInfluence?.reasons?.length ? (
            <Bullets items={editLines(edits, "market.transportReasons", tr.roiInfluence.reasons)} />
          ) : null}
          {nb ? <Bullets items={editLines(edits, "market.reasons", visibleMarketReasons(nb.reasons))} /> : null}
        </Section>
      );
    }
    case "builtEnv": {
      const ctx = report.builtEnvironmentContext;
      if (!ctx || ctx.assessedProperties === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.builtEnv} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("builtEnv")} />
          <Bullets items={editLines(edits, "builtEnv.reasons", ctx.reasons)} />
        </Section>
      );
    }
    case "strategies": {
      const strategies = report.developmentStrategies ?? [];
      if (strategies.length === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.strategies} brand={brand} note={sectionNote(edits, key)}>
          {strategies.map((s) => {
            const best = s.roiScenarios.find((x) => x.isBest) ?? s.roiScenarios[0];
            const recommended = report.recommendedDevelopmentStrategy === s.id;
            const rationale = editText(edits, `strategies.${s.id}.rationale`, s.rationale);
            return (
              <View key={s.id} style={{ marginBottom: 10 }}>
                <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10.5 }}>
                  {s.title} - {strategyRecommendationLabel(s.recommendation, recommended)}
                </Text>
                {rationale ? <Text style={styles.paragraph}>{rationale}</Text> : null}
                <Bullets items={editLines(edits, `strategies.${s.id}.assumptions`, s.assumptions)} />
                <KV
                  rows={STRATEGY_ROW_SPEC.map(([keyPart, sub]) => [
                    sub,
                    dataVal(edits, byKey, `data.strategies.${s.id}.${keyPart}`),
                  ])}
                />
              </View>
            );
          })}
        </Section>
      );
    }
    case "roi": {
      const roi = report.roiScenarios ?? [];
      if (roi.length === 0 || (report.developmentStrategies?.length ?? 0) > 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.roi} brand={brand} note={sectionNote(edits, key)}>
          {roi.map((sc, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>
                {sc.lots ? `${sc.lots} lots` : "Scenario"} · {sc.years}yr{sc.isBest ? "  ★ Best" : ""}
              </Text>
              <KV
                rows={ROI_ROW_SPEC.map(([keyPart, sub]) => [
                  sub,
                  dataVal(edits, byKey, `data.roi.${i}.${keyPart}`),
                ])}
              />
            </View>
          ))}
        </Section>
      );
    }
    case "comparables": {
      const comps = (report.comparableSales ?? []).filter((c) => (c.price ?? c.price_nzd ?? 0) > 0);
      if (report.comparables_quality !== "live" || comps.length === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.comparables} brand={brand} note={sectionNote(edits, key)}>
          <KV rows={flatRows("comparables")} />
        </Section>
      );
    }
    case "risk":
      if (!report.riskSummary || report.riskSummary.length === 0) return null;
      return (
        <Section key={key} title={SECTION_LABELS.risk} brand={brand} note={sectionNote(edits, key)}>
          <Bullets items={editLines(edits, "risk.summary", report.riskSummary)} />
        </Section>
      );
    default:
      return null;
  }
}

function ensureDataUri(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  return `data:image/png;base64,${b64}`;
}

function RunningHeader({ brandKit }: { brandKit: BrandKit }) {
  return (
    <View style={styles.runningHeader} fixed>
      <Text style={styles.runningHeaderText}>{brandKit.companyName ?? ""}</Text>
      {brandKit.logoUrl ? <Image style={styles.runningHeaderLogo} src={brandKit.logoUrl} /> : <Text> </Text>}
    </View>
  );
}

function RunningFooter({ brandKit }: { brandKit: BrandKit }) {
  const contact = [brandKit.contactPhone, brandKit.contactEmail, brandKit.website].filter(Boolean).join("  ·  ");
  return (
    <View style={styles.runningFooter} fixed>
      <Text style={styles.runningFooterText}>{brandKit.footerText ?? contact}</Text>
      <Text style={styles.runningFooterText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

export function ReportPdfDocument({
  report,
  brandKit,
  layout,
  contentEdits = EMPTY_PDF_CONTENT_EDITS,
}: {
  report: FeasibilityReport;
  brandKit: BrandKit;
  layout: PdfLayout;
  contentEdits?: PdfContentEdits;
}) {
  const brand = safeBrandColor(brandKit.brandColor);
  const scores = report.scores ?? { ease: 0, cost: 0, roi: 0, composite: 0 };
  const photo = report.photoUrl ?? report.photoUrls?.[0];
  const orderedSections = layout.sectionOrder.filter((k) => layout.includeSections[k]);
  const dataByKey = new Map(editableDataFields(report).map((f) => [f.key, f]));

  return (
    <Document title={`${layout.coverTitle} — ${report.address}`} author={brandKit.companyName ?? "Project Alpha"}>
      {/* ── Cover ── */}
      <Page size="A4" style={styles.coverPage}>
        <RunningFooter brandKit={brandKit} />
        <View style={[styles.coverBand, { backgroundColor: brand }]}>
          <Text style={styles.coverBandTitle}>{layout.coverTitle}</Text>
          {layout.coverSubtitle ? <Text style={styles.coverBandSub}>{layout.coverSubtitle}</Text> : null}
        </View>
        {brandKit.logoUrl ? (
          <Image
            src={brandKit.logoUrl}
            style={{
              position: "absolute",
              left: layout.logoBox.x,
              top: layout.logoBox.y,
              width: layout.logoBox.width,
              maxHeight: 56,
              objectFit: "contain",
            }}
          />
        ) : null}

        <View style={styles.coverBody}>
          {layout.showCoverPhoto && photo ? <Image style={styles.coverPhoto} src={photo} /> : null}

          {layout.executiveSummary ? (
            <View>
              <Text style={styles.coverSectionLabel}>Executive summary</Text>
              <Text style={styles.coverSummary}>{layout.executiveSummary}</Text>
            </View>
          ) : null}

          <View style={styles.preparedBy}>
            <View style={styles.preparedByDetails}>
              <Text style={styles.coverSectionLabel}>Prepared by</Text>
              <Text style={styles.preparedByName}>{brandKit.companyName ?? brandKit.contactName ?? ""}</Text>
              {brandKit.contactName && brandKit.companyName ? <Text style={styles.preparedByLine}>{brandKit.contactName}</Text> : null}
              {brandKit.contactPhone ? <Text style={styles.preparedByLine}>{brandKit.contactPhone}</Text> : null}
              {brandKit.contactEmail ? <Text style={styles.preparedByLine}>{brandKit.contactEmail}</Text> : null}
              {brandKit.website ? <Text style={styles.preparedByLine}>{brandKit.website}</Text> : null}
              {brandKit.licenceNumber ? <Text style={styles.preparedByLine}>Licence: {brandKit.licenceNumber}</Text> : null}
            </View>
            <Text style={styles.preparedByDate}>{new Date().toLocaleDateString()}</Text>
          </View>
        </View>
      </Page>

      {/* ── Body ── */}
      <Page size="A4" style={styles.page}>
        <RunningHeader brandKit={brandKit} />
        <RunningFooter brandKit={brandKit} />

        {/* Scorecard */}
        <View style={styles.scorecard}>
          <View style={[styles.scoreBig, { backgroundColor: scoreHex(scores.composite) }]}>
            <Text style={styles.scoreBigNum}>{formatComposite(scores.composite)} / 5</Text>
            <Text style={styles.scoreBigLabel}>Overall</Text>
          </View>
          <View style={styles.scoreBars}>
            {([["Ease", scores.ease], ["Cost", scores.cost], ["ROI", scores.roi]] as const).map(([label, val]) => (
              <View style={styles.scoreBarRow} key={label}>
                <View style={styles.scoreBarTop}>
                  <Text style={styles.scoreBarLabel}>{label}</Text>
                  <Text style={styles.scoreBarLabel}>{formatScore(val)} / 5</Text>
                </View>
                <View style={styles.scoreBarTrack}>
                  <View style={[styles.scoreBarFill, { width: `${Math.max(0, Math.min(1, val / 5)) * 100}%`, backgroundColor: scoreHex(val) }]} />
                </View>
              </View>
            ))}
          </View>
        </View>

        {report.redevelopmentWarning?.suspected ? (
          <Text style={[styles.note, { backgroundColor: "#fbe7e7", color: "#8a2d2d" }]}>{report.redevelopmentWarning.message}</Text>
        ) : null}

        {orderedSections.map((k) => renderSection(k, report, brand, contentEdits, dataByKey))}

        {editText(contentEdits, "disclaimer", report.disclaimer) ? (
          <Text style={styles.disclaimer}>{editText(contentEdits, "disclaimer", report.disclaimer)}</Text>
        ) : null}
      </Page>
    </Document>
  );
}
