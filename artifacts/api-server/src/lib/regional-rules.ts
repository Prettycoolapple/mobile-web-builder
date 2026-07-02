import type { ZoneResult } from "./auckland-council";
import type { PlanningProviderMetadata } from "./regional-planning";

export interface RegionalPlanningRuleStatus {
  subdivisionRules: "auckland_legacy" | "verified_guidance" | "not_modelled";
  automaticYieldClaimsAllowed: boolean;
  verifiedMinimumLotSqm: number | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  note: string | null;
}

interface RegionalRulePackEntry {
  providerId: PlanningProviderMetadata["providerId"];
  zonePattern: RegExp;
  zoneLabel: string;
  minimumLotSqm: number;
  sourceLabel: string;
  sourceUrl: string;
  caveat: string;
}

const REGIONAL_RULE_PACKS: RegionalRulePackEntry[] = [
  {
    providerId: "whangarei",
    zonePattern: /\bgeneral residential\b/i,
    zoneLabel: "General Residential Zone",
    minimumLotSqm: 400,
    sourceLabel: "Whangarei District Plan SUB-R5",
    sourceUrl: "https://eplan.wdc.govt.nz/plan/?chapter=subdivision",
    caveat:
      "Whangarei SUB-R5 also requires shape/frontage/building-area and other district-plan checks; this is minimum-lot guidance, not an approval prediction.",
  },
  {
    providerId: "whangarei",
    zonePattern: /\bmedium density residential\b/i,
    zoneLabel: "Medium Density Residential Zone",
    minimumLotSqm: 300,
    sourceLabel: "Whangarei District Plan SUB-R6",
    sourceUrl: "https://eplan.wdc.govt.nz/plan/?chapter=subdivision",
    caveat:
      "Whangarei SUB-R6 also has unit-title, shape/building-area and other district-plan checks; this is minimum-lot guidance, not an approval prediction.",
  },
];

function zoneText(zone: ZoneResult | null | undefined): string {
  return [zone?.zone_code, zone?.zone_description, zone?.raw_zone]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function findRegionalRulePack(
  provider: Pick<PlanningProviderMetadata, "providerId">,
  zone: ZoneResult | null | undefined,
): RegionalRulePackEntry | null {
  const text = zoneText(zone);
  if (!text) return null;
  return REGIONAL_RULE_PACKS.find(
    (entry) => entry.providerId === provider.providerId && entry.zonePattern.test(text),
  ) ?? null;
}

export function regionalPlanningRuleStatus(
  provider: Pick<PlanningProviderMetadata, "providerId" | "providerName"> | null | undefined,
  zone?: ZoneResult | null,
): RegionalPlanningRuleStatus {
  if (!provider || provider.providerId === "auckland-legacy") {
    return {
      subdivisionRules: "auckland_legacy",
      automaticYieldClaimsAllowed: true,
      verifiedMinimumLotSqm: null,
      sourceLabel: null,
      sourceUrl: null,
      note: null,
    };
  }

  const rulePack = findRegionalRulePack(provider, zone);
  if (rulePack) {
    return {
      subdivisionRules: "verified_guidance",
      automaticYieldClaimsAllowed: false,
      verifiedMinimumLotSqm: rulePack.minimumLotSqm,
      sourceLabel: rulePack.sourceLabel,
      sourceUrl: rulePack.sourceUrl,
      note:
        `${provider.providerName} ${rulePack.zoneLabel} minimum-lot guidance is available: ${rulePack.minimumLotSqm}sqm per vacant site (${rulePack.sourceLabel}). ${rulePack.caveat} Automated yield/ROI modelling remains disabled until the full local rule pack is implemented.`,
    };
  }

  return {
    subdivisionRules: "not_modelled",
    automaticYieldClaimsAllowed: false,
    verifiedMinimumLotSqm: null,
    sourceLabel: null,
    sourceUrl: null,
    note: `${provider.providerName} zone facts are available, but local subdivision/minimum-lot rules are not modelled yet. The report should not infer multi-lot yield automatically for this region.`,
  };
}

export function regionalZoneDescriptionWithRuleStatus(
  zone: ZoneResult | null | undefined,
  provider: Pick<PlanningProviderMetadata, "providerId" | "providerName" | "coverageStatus"> | null | undefined,
): string | null {
  const base = zone?.zone_description?.trim() || null;
  if (!provider || provider.providerId === "auckland-legacy") return base;

  const ruleStatus = regionalPlanningRuleStatus(provider, zone);
  const suffix = ruleStatus.subdivisionRules === "verified_guidance" && ruleStatus.verifiedMinimumLotSqm
    ? `${provider.providerName} selected (${provider.coverageStatus} coverage). Minimum-lot guidance: ${ruleStatus.verifiedMinimumLotSqm}sqm per vacant site from ${ruleStatus.sourceLabel}; automated yield modelling is not enabled for this region yet.`
    : `${provider.providerName} selected (${provider.coverageStatus} coverage). Local subdivision/minimum-lot rules are not modelled yet.`;
  return base ? `${base} - ${suffix}` : suffix;
}
