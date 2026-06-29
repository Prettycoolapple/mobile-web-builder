export interface FeasibilityReportPlanningSnapshot {
  planning?: {
    overlays?: Array<{
      name?: unknown;
      status?: unknown;
      detail?: unknown;
    }>;
  };
}

function isPlanningOverlayOrControl(overlay: { name?: unknown; status?: unknown; detail?: unknown }): boolean {
  const status = typeof overlay.status === "string" ? overlay.status.trim().toLowerCase() : "";
  if (status === "clear") return false;
  if (status === "moderate" || status === "restricted" || status === "control") return true;
  if (status && status !== "unknown") return true;

  // Legacy or partially-translated reports may carry a planning item without a
  // status. Count named overlay/control entries, but ignore explicit empty text.
  const text = [overlay.name, overlay.detail]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim()
    .toLowerCase();
  return text.length > 0 && !/\b(no overlays?|none detected|clear)\b/.test(text);
}

export function reportHasPlanningOverlayOrControl(report: FeasibilityReportPlanningSnapshot): boolean {
  return (report.planning?.overlays ?? []).some(isPlanningOverlayOrControl);
}
