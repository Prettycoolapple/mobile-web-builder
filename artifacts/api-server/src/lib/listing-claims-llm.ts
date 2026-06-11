import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import type { ListingClaims, ListingClaimsInput } from "./listing-claims";

/**
 * LLM tie-breaker for ambiguous listing marketing copy. The deterministic
 * extractor in listing-claims.ts handles the bulk-screening path for free;
 * this is invoked ONLY when `hasAmbiguousListingSignals` is true — i.e. the
 * copy mentions townhouse/terrace/duplex but the regex layer could classify
 * it neither as "the dwelling IS one" nor as "could build some" — and only
 * for listings that otherwise PASSED screening (final-acceptance check) or
 * are in the full-analysis pipeline. Never call it per-listing in the bulk
 * prefilter.
 *
 * Safety direction: results may only ADD risk flags via `mergeClaimsSafer`;
 * they never clear a deterministic verdict.
 */
export async function extractListingClaimsLLM(input: ListingClaimsInput): Promise<ListingClaims | null> {
  const title = (input.listingTitle ?? "").trim();
  const description = (input.description ?? "").trim();
  if (!title && !description) return null;

  const prompt = `You are a NZ real-estate listing analyst. Read this listing's marketing copy and decide what it claims about the dwelling BEING SOLD.

Listing title: ${title || "(none)"}
Property type field: ${(input.propertyType ?? "").trim() || "(none)"}
Description: ${description.slice(0, 1800)}

Distinctions that matter (be strict):
- "dwellingIsTownhouse" is true ONLY if the dwelling being sold IS a townhouse/terrace/duplex (e.g. "this stunning townhouse", "10 brand new townhouses"). It is FALSE when townhouses are only development POTENTIAL ("potential to build townhouses STCA", "site for terraces", "consent for 4 townhouses").
- "isNewBuild" is true ONLY if the dwelling itself is marketed as new/near-new/under construction/off the plans. "Brand new kitchen/bathroom/carpet" is a RENOVATION, not a new build — false.
- "multiUnitDevelopment" is true ONLY if the offering is one unit of (or all of) an already-built or under-construction multi-unit development — not a site where units COULD be built.
- "completionYear": the stated completion/build year (2000+) or null.
- "unitCount": number of units in the development, or null.
- "evidence": short verbatim quotes (max 3) from the copy supporting any true flag.

Reply with ONLY valid JSON, no markdown:
{"dwellingIsTownhouse": bool, "isNewBuild": bool, "multiUnitDevelopment": bool, "completionYear": number|null, "unitCount": number|null, "evidence": ["..."]}`;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: { maxOutputTokens: 300, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const completionYear =
      typeof parsed.completionYear === "number" && parsed.completionYear >= 2000 && parsed.completionYear <= new Date().getFullYear() + 2
        ? Math.round(parsed.completionYear)
        : null;
    const unitCount =
      typeof parsed.unitCount === "number" && parsed.unitCount >= 2 && parsed.unitCount <= 99
        ? Math.round(parsed.unitCount)
        : null;
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((e): e is string => typeof e === "string" && e.trim().length > 0).slice(0, 3)
      : [];

    return {
      dwellingIsTownhouse: parsed.dwellingIsTownhouse === true,
      townhousePotentialOnly: false,
      isNewBuild: parsed.isNewBuild === true,
      completionYear,
      multiUnitDevelopment: parsed.multiUnitDevelopment === true,
      unitCount,
      evidence,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "extractListingClaimsLLM: LLM call failed");
    return null;
  }
}

/**
 * Merge LLM claims into deterministic ones in the SAFER direction only:
 * the LLM may add risk flags (townhouse / new build / multi-unit) but can
 * never clear a flag the deterministic extractor already set.
 */
export function mergeClaimsSafer(deterministic: ListingClaims, llm: ListingClaims | null): ListingClaims {
  if (!llm) return deterministic;
  const dwellingIsTownhouse = deterministic.dwellingIsTownhouse || llm.dwellingIsTownhouse;
  return {
    dwellingIsTownhouse,
    townhousePotentialOnly: deterministic.townhousePotentialOnly && !dwellingIsTownhouse,
    isNewBuild: deterministic.isNewBuild || llm.isNewBuild,
    completionYear: deterministic.completionYear ?? llm.completionYear,
    multiUnitDevelopment: deterministic.multiUnitDevelopment || llm.multiUnitDevelopment,
    unitCount: deterministic.unitCount ?? llm.unitCount,
    evidence: [...deterministic.evidence, ...llm.evidence.map((e) => `LLM: ${e}`)],
  };
}
