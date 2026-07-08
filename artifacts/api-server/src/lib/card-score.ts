import type { ScoringResult } from "./scoring";
import type { DesignLedConfidence, DesignLedYieldRange } from "./lot-calculator";
import type { BuiltEnvironmentContext } from "./built-environment-context";
import type { DwellingConditionAssessment } from "./dwelling-condition";

// Bump whenever the scoring inputs/formula change (scoring.ts, cost-estimator,
// roi-calculator, lot-calculator) so that real report scores persisted into the
// global property cache under an OLD version are ignored by the screening cards
// and recomputed/re-persisted on the next full analysis. This keeps the card and
// the report consistent across a scoring change.
export const SCORING_VERSION = 9;

/**
 * The real, report-grade scores computed by the full pipeline, persisted into the
 * global property cache (rawData.derived_scores) so a screening card can show the
 * exact same numbers a later feasibility report will — for any user, once any user
 * has analysed the property. Carries the same metadata the card already renders.
 */
export interface DerivedCardScores {
  scoringVersion: number;
  scores: ScoringResult | null;
  scoreUnavailableReason?: string | null;
  /** Best ROI % across the exposed exit scenarios; null when no scored ROI.
   * Persisted so the feature index can answer "return over X%" reverse queries. */
  roiPercentBest: number | null;
  landArea: number | null;
  zone: string | null;
  potentialLots: number;
  minLotSize: number | null;
  standardVacantLots: number;
  standardPathViable: boolean;
  standardMinLotSize: number | null;
  designLedEligible: boolean;
  designLedYieldRange: DesignLedYieldRange | null;
  designLedConfidence: DesignLedConfidence;
  designLedReasons: string[];
  designLedBlockers: string[];
  designLedSummary: string | null;
  designLedDetail: string | null;
  builtEnvironmentContext?: BuiltEnvironmentContext | null;
  dwellingCondition?: DwellingConditionAssessment | null;
}
