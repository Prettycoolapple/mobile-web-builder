import type { ScoringResult } from "./scoring";
import type { DesignLedConfidence, DesignLedYieldRange } from "./lot-calculator";
import type { BuiltEnvironmentContext } from "./built-environment-context";

// Bump whenever the scoring inputs/formula change (scoring.ts, cost-estimator,
// roi-calculator, lot-calculator) so that real report scores persisted into the
// global property cache under an OLD version are ignored by the screening cards
// and recomputed/re-persisted on the next full analysis. This keeps the card and
// the report consistent across a scoring change.
export const SCORING_VERSION = 3;

/**
 * The real, report-grade scores computed by the full pipeline, persisted into the
 * global property cache (rawData.derived_scores) so a screening card can show the
 * exact same numbers a later feasibility report will — for any user, once any user
 * has analysed the property. Carries the same metadata the card already renders.
 */
export interface DerivedCardScores {
  scoringVersion: number;
  scores: ScoringResult;
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
}
