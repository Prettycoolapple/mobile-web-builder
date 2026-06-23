import { StyleSheet } from "@react-pdf/renderer";

/** White-label brand kit (mirrors the server `provider_brand_kits` row). */
export interface BrandKit {
  logoUrl?: string | null;
  brandColor?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  licenceNumber?: string | null;
  footerText?: string | null;
  extraImageUrls?: string[];
}

export const DEFAULT_BRAND_COLOR = "#173f2e";
export const INK = "#1c1917";
export const MUTED = "#6b625b";
export const LINE = "#e5ded4";
export const SURFACE_SUNKEN = "#f4f0ea";

/** Score → hex (PDF can't use CSS vars). Matches the web thresholds. */
export function scoreHex(score: number): string {
  if (score >= 4) return "#2e9e72";
  if (score >= 2.5) return "#c98a1e";
  return "#c4453d";
}

/** Normalise a user-entered brand colour to a safe hex, else the default. */
export function safeBrandColor(value: string | null | undefined): string {
  if (typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) {
    return value.trim();
  }
  return DEFAULT_BRAND_COLOR;
}

export const styles = StyleSheet.create({
  page: {
    paddingTop: 64,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
    lineHeight: 1.5,
  },
  // Running header / footer (fixed on every body page)
  runningHeader: {
    position: "absolute",
    top: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  runningHeaderText: { fontSize: 9, color: MUTED },
  runningHeaderLogo: { height: 18, objectFit: "contain" },
  runningFooter: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  runningFooterText: { fontSize: 8, color: MUTED },

  // Cover
  coverPage: { fontFamily: "Helvetica", color: INK },
  coverBand: { height: 150, paddingHorizontal: 40, paddingTop: 40, justifyContent: "center" },
  coverBandTitle: { color: "#ffffff", fontSize: 26, fontFamily: "Helvetica-Bold" },
  coverBandSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 6 },
  coverBody: { paddingHorizontal: 40, paddingTop: 20 },
  coverPhoto: { width: "100%", height: 175, objectFit: "cover", borderRadius: 6, marginBottom: 14 },
  coverSectionLabel: {
    fontSize: 9,
    color: MUTED,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
  },
  coverSummary: { fontSize: 10.5, lineHeight: 1.45, color: INK, marginBottom: 14 },
  preparedBy: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  preparedByDetails: { flex: 1, maxWidth: 380 },
  preparedByName: { fontSize: 11.5, fontFamily: "Helvetica-Bold", lineHeight: 1.25 },
  preparedByLine: { fontSize: 8.7, color: MUTED, marginTop: 2, lineHeight: 1.25 },
  preparedByDate: { fontSize: 8.7, color: MUTED, marginTop: 22, textAlign: "right", minWidth: 80 },

  // Section blocks
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 8, color: INK },
  sectionTitleBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1.5,
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2.5,
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
  },
  kvKey: { color: MUTED, fontSize: 10 },
  kvVal: { fontFamily: "Helvetica-Bold", fontSize: 10, textAlign: "right" },
  listItem: { flexDirection: "row", marginBottom: 3 },
  listBullet: { width: 10, fontSize: 10, color: MUTED },
  listText: { flex: 1, fontSize: 10 },
  note: { backgroundColor: SURFACE_SUNKEN, borderRadius: 5, padding: 8, marginTop: 6, fontSize: 9.5 },
  paragraph: { fontSize: 10, marginBottom: 6, lineHeight: 1.55 },

  // Scorecard
  scorecard: { flexDirection: "row", marginBottom: 18, gap: 16 },
  scoreBig: {
    width: 96,
    height: 96,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  scoreBigNum: { color: "#ffffff", fontSize: 22, fontFamily: "Helvetica-Bold", lineHeight: 1.05, textAlign: "center" },
  scoreBigLabel: { color: "rgba(255,255,255,0.85)", fontSize: 8, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 5 },
  scoreBars: { flex: 1, justifyContent: "center", gap: 8 },
  scoreBarRow: { marginBottom: 2 },
  scoreBarTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  scoreBarLabel: { fontSize: 9.5, color: MUTED },
  scoreBarTrack: { height: 6, backgroundColor: SURFACE_SUNKEN, borderRadius: 3 },
  scoreBarFill: { height: 6, borderRadius: 3 },

  overlayMap: { width: "100%", height: 220, objectFit: "contain", marginTop: 8 },
  chip: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
    marginRight: 5,
    marginBottom: 4,
    backgroundColor: SURFACE_SUNKEN,
    color: MUTED,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  disclaimer: { marginTop: 18, fontSize: 8, color: MUTED, lineHeight: 1.5 },
});
