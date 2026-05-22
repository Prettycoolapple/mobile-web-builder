import type { GeoResult } from "./geocode";
import { findSuburbId, findSuburbInTextViaIndex } from "./scrapers/realestate-api";
import { extractSuburb } from "./utils";

function compactAddressText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\b(?:New Zealand|Aotearoa)\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolvePipelineSuburb(address: string, geocode: GeoResult | null): Promise<string> {
  const geocodeSuburb = geocode?.suburb?.trim();
  if (geocodeSuburb) {
    const hit = await findSuburbId(geocodeSuburb);
    if (hit) return hit.title;
  }

  const candidates = Array.from(new Set([
    compactAddressText(geocode?.formatted),
    compactAddressText(address),
    compactAddressText(`${geocode?.formatted ?? ""} ${address}`),
  ].filter(Boolean)));

  for (const candidate of candidates) {
    const hit = await findSuburbInTextViaIndex(candidate);
    if (hit) return hit.title;
  }

  return extractSuburb(geocode?.formatted ?? address);
}
