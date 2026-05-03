/**
 * Canonical composite (1–5) display: one decimal, aligned with API/storage and history.
 */
export function formatCompositeScoreForDisplay(composite: number): string {
  if (!(composite > 0)) return "—";
  return composite.toFixed(1);
}
