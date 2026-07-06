import type { RawPropertyData } from "./pipeline";

type DerivedScores = RawPropertyData["derived_scores"];

/**
 * Cache-serve recomputes derived scores from raw data. Persist the recomputed
 * value whenever it repairs or materially improves the stored derived_scores
 * payload without refreshing the raw-data freshness clock.
 */
export function shouldBackfillDerivedScores(
  current: DerivedScores | null | undefined,
  next: DerivedScores | null | undefined,
): next is NonNullable<DerivedScores> {
  if (!next) return false;
  if (!current) return true;
  if (current.scoringVersion !== next.scoringVersion) return true;
  if (current.scores == null && next.scores != null) return true;
  if (current.roiPercentBest == null && next.roiPercentBest != null) return true;
  if (current.dwellingCondition == null && next.dwellingCondition != null) return true;
  if (
    current.dwellingCondition != null &&
    next.dwellingCondition != null &&
    (
      current.dwellingCondition.assessmentVersion !== next.dwellingCondition.assessmentVersion ||
      current.dwellingCondition.sourceFingerprint !== next.dwellingCondition.sourceFingerprint ||
      current.dwellingCondition.condition !== next.dwellingCondition.condition ||
      current.dwellingCondition.recentImprovement !== next.dwellingCondition.recentImprovement ||
      current.dwellingCondition.costPenalty !== next.dwellingCondition.costPenalty
    )
  ) {
    return true;
  }
  if (current.scores == null && current.scoreUnavailableReason !== next.scoreUnavailableReason) return true;
  return false;
}
