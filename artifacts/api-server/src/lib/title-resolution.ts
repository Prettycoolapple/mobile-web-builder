import { sanitizeTenureField } from "./titleDisplay";
import type { LinzLrsTitlePreviewStatus } from "./linz";

export type TitleResolutionSource = "lrs" | "lrs_cache" | "listing" | "scraped_page" | "ai_snippet" | "unknown";

export interface TitleResolutionInput {
  lrsTenure?: string | null;
  lrsPreviewSource?: "live" | "cache" | null;
  lrsStatus?: LinzLrsTitlePreviewStatus | null;
  listingTenures?: Array<string | null | undefined>;
  scrapedTenures?: Array<string | null | undefined>;
  aiSnippetTenure?: string | null;
  titleEstate?: string | null;
  parcelEstate?: string | null;
}

export interface TitleResolution {
  titleType: string | null;
  titleResolutionSource: TitleResolutionSource;
  lrsStatus: LinzLrsTitlePreviewStatus | "unknown";
}

const NON_FREEHOLD_RE = /\b(cross\s*lease|crosslease|unit\s+title|leasehold|lease\s*hold|stratum)\b/i;

function firstTenure(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = sanitizeTenureField(value);
    if (cleaned) return normaliseTitle(cleaned);
  }
  return null;
}

function firstNonFreehold(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const cleaned = sanitizeTenureField(value);
    if (cleaned && NON_FREEHOLD_RE.test(cleaned)) return normaliseTitle(cleaned);
  }
  return null;
}

function normaliseTitle(value: string): string {
  if (/\bcross\s*lease\b|\bcrosslease\b/i.test(value)) return "Cross Lease";
  if (/\bunit\s+title\b/i.test(value)) return "Unit Title";
  if (/\bstratum\b/i.test(value)) return "Stratum";
  if (/\bleasehold\b|\blease\s*hold\b/i.test(value)) return "Leasehold";
  if (/\bfee\s*simple\b|\bfree\s*hold\b/i.test(value)) return "Fee Simple";
  return value.trim();
}

export function resolveTitleStatus(input: TitleResolutionInput): TitleResolution {
  const lrsStatus = input.lrsStatus ?? "unknown";
  const lrsTenure = sanitizeTenureField(input.lrsTenure);
  if (lrsTenure) {
    return {
      titleType: normaliseTitle(lrsTenure),
      titleResolutionSource: input.lrsPreviewSource === "cache" ? "lrs_cache" : "lrs",
      lrsStatus,
    };
  }

  const explicitNonFreehold = firstNonFreehold([
    ...(input.listingTenures ?? []),
    ...(input.scrapedTenures ?? []),
    input.aiSnippetTenure,
    input.titleEstate,
    input.parcelEstate,
  ]);
  if (explicitNonFreehold) {
    const listingNonFreehold = firstNonFreehold(input.listingTenures ?? []);
    if (listingNonFreehold) return { titleType: listingNonFreehold, titleResolutionSource: "listing", lrsStatus };
    const scrapedNonFreehold = firstNonFreehold(input.scrapedTenures ?? []);
    if (scrapedNonFreehold) return { titleType: scrapedNonFreehold, titleResolutionSource: "scraped_page", lrsStatus };
    const aiNonFreehold = firstNonFreehold([input.aiSnippetTenure]);
    if (aiNonFreehold) return { titleType: aiNonFreehold, titleResolutionSource: "ai_snippet", lrsStatus };
    return { titleType: explicitNonFreehold, titleResolutionSource: "unknown", lrsStatus };
  }

  const listingTenure = firstTenure(input.listingTenures ?? []);
  if (listingTenure) return { titleType: listingTenure, titleResolutionSource: "listing", lrsStatus };

  const scrapedTenure = firstTenure(input.scrapedTenures ?? []);
  if (scrapedTenure) return { titleType: scrapedTenure, titleResolutionSource: "scraped_page", lrsStatus };

  const aiTenure = firstTenure([input.aiSnippetTenure]);
  if (aiTenure) return { titleType: aiTenure, titleResolutionSource: "ai_snippet", lrsStatus };

  // Critical guard: generic Fee Simple from parcel/title fallback can describe
  // the parent estate for cross-lease flats. Do not show it as Freehold unless
  // LRS or an exact external source explicitly provided that tenure.
  return { titleType: null, titleResolutionSource: "unknown", lrsStatus };
}
