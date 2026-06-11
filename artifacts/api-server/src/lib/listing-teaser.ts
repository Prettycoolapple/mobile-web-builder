type ListingTeaserFacts = {
  address?: string | null;
  listingTitle?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  toilets?: number | null;
  garages?: number | null;
  landAreaSqm?: number | null;
  floorAreaSqm?: number | null;
  priceDisplay?: string | null;
};

const MAX_TEASER_LENGTH = 170;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}

function cleanMarketingText(value: string): string {
  return decodeEntities(value)
    .replace(/<br\s*\/?>/gi, ". ")
    .replace(/<\/p\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?]){2,}/g, "$1")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+[|]\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);
}

function normalize(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() ?? "";
}

function addressFragments(address: string | null | undefined, listingTitle: string | null | undefined): string[] {
  const fragments = new Set<string>();
  for (const value of [address, listingTitle]) {
    const normalized = normalize(value);
    if (!normalized) continue;
    fragments.add(normalized);
    const firstComma = normalized.split(" auckland ")[0]?.trim();
    if (firstComma && firstComma.length >= 8) fragments.add(firstComma);
    const firstPart = normalized.split(" ").slice(0, 4).join(" ").trim();
    if (firstPart.length >= 8) fragments.add(firstPart);
  }
  return Array.from(fragments);
}

function isTemplatedFallback(text: string): boolean {
  return /^(house|section|apartment|unit|townhouse|property|residential|lifestyle|rural|commercial)\s+for\s+(sale|rent)\s+at\b/i.test(text.trim());
}

function containsListingFact(sentence: string, facts: ListingTeaserFacts): boolean {
  const lower = sentence.toLowerCase();
  const numberWord = "(one|two|three|four|five|six|seven|eight|nine|ten)";
  if (/\b\d+\s*[- ]?(bed|beds|bedroom|bedrooms|bath|baths|bathroom|bathrooms|toilet|toilets|wc|garage|garages|car|cars)\b/i.test(sentence)) {
    return true;
  }
  if (new RegExp(`\\b${numberWord}\\s*[- ]?(bed|beds|bedroom|bedrooms|bath|baths|bathroom|bathrooms|toilet|toilets|wc|garage|garages|car|cars)\\b`, "i").test(sentence)) {
    return true;
  }
  if (/\b(bedroom|bedrooms|bathroom|bathrooms|toilet|toilets|garage|garages)\b/i.test(sentence)) {
    return true;
  }
  if (/\b\d[\d,.\s]*\s*(sqm|sq m|m2|m²|ha|hectare|hectares)\b/i.test(sentence)) return true;
  if (/\$\s?\d|price by negotiation|auction|deadline sale|asking price|enquiries over/i.test(sentence)) return true;
  if (facts.priceDisplay && normalize(sentence).includes(normalize(facts.priceDisplay))) return true;

  const numericFacts = [
    facts.bedrooms,
    facts.bathrooms,
    facts.toilets,
    facts.garages,
    facts.landAreaSqm,
    facts.floorAreaSqm,
  ].filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (numericFacts.some((n) => lower.includes(String(n)))) {
    return /\b(bed|bath|toilet|garage|car|sqm|m2|m²|land|floor|area)\b/i.test(sentence);
  }
  return false;
}

function containsAddress(sentence: string, facts: ListingTeaserFacts): boolean {
  const normalized = normalize(sentence);
  if (!normalized) return false;
  return addressFragments(facts.address, facts.listingTitle).some((fragment) => normalized.includes(fragment));
}

function trimToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength - 3).trim();
  const lastSpace = truncated.lastIndexOf(" ");
  return `${(lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated).trim()}...`;
}

export function buildListingTeaser(description: string | null | undefined, facts: ListingTeaserFacts = {}): string | null {
  if (!description?.trim()) return null;
  const clean = cleanMarketingText(description);
  if (clean.length < 24) return null;

  const picked: string[] = [];
  for (const sentence of splitSentences(clean)) {
    const candidate = sentence.replace(/\s+/g, " ").trim();
    if (!candidate || isTemplatedFallback(candidate)) continue;
    if (containsAddress(candidate, facts)) continue;
    if (containsListingFact(candidate, facts)) continue;
    picked.push(candidate);
    break;
  }

  if (picked.length === 0) return null;
  return trimToLength(picked.join(" "), MAX_TEASER_LENGTH);
}
