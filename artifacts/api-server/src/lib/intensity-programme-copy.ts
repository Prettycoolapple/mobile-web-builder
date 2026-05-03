/**
 * English phrases for multi-lot / programme-risk copy produced by the pipeline.
 * Used to OS-gate translation: Chinese OS → translate with the rest of zh narrative;
 * non-Chinese OS → keep English even when app locale is Chinese (see translateReportNarrative).
 */
export const INTENSITY_PROGRAMME_EN_MARKERS = [
  "Phased construction and staged unit sales are likely",
  "Exit pricing uses listing-ask comparables",
  "High lot count — long construction and phased sales",
  "Several potential lots increase programme length and absorption",
  "Intensive scheme (",
  "potential lots imply major capital, long programme, and staged sales",
] as const;

export function isIntensityProgrammeCopyEn(s: string): boolean {
  const t = s.trim();
  return INTENSITY_PROGRAMME_EN_MARKERS.some((m) => t.includes(m));
}
