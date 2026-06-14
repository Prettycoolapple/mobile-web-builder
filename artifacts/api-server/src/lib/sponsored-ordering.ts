import type { PropertyCandidate } from "./pre-screen";

const FAKE_SPONSORED_RATE = 0.18;

function stableHashFraction(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

function genericListingId(candidate: Pick<PropertyCandidate, "address" | "listingUrl">): string {
  const seed = candidate.listingUrl || candidate.address;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `generic_${Math.abs(hash)}`;
}

export function isGenericCandidateSponsoredForOrdering(
  candidate: Pick<PropertyCandidate, "address" | "listingUrl" | "source" | "internalListingId" | "isSponsored" | "sponsoredLabel">,
): boolean {
  if (candidate.isSponsored || candidate.sponsoredLabel?.trim()) return true;
  if (candidate.source === "internal" || candidate.internalListingId) return true;
  const seed = candidate.listingUrl || genericListingId(candidate);
  return stableHashFraction(`sponsored:${seed}`) < FAKE_SPONSORED_RATE;
}

export function prioritizeSponsoredGenericCandidates<T extends Pick<PropertyCandidate, "address" | "listingUrl" | "source" | "internalListingId" | "isSponsored" | "sponsoredLabel">>(
  candidates: T[],
): T[] {
  const sponsored: T[] = [];
  const standard: T[] = [];
  for (const candidate of candidates) {
    if (isGenericCandidateSponsoredForOrdering(candidate)) sponsored.push(candidate);
    else standard.push(candidate);
  }
  return [...sponsored, ...standard];
}
