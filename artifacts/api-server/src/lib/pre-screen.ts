import { logger } from "./logger";
import { geocodeAddress } from "./geocode";
import { scrapeHougarden } from "./scrapers/hougarden";
import { fetchUnitaryPlanZone, fetchOverlays } from "./auckland-council";
import type { ListingResult } from "./scrapers/oneroof";

export interface PropertyCandidate {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  scores: { ease: number; cost: number; roi: number; composite: number };
  briefSummary?: string;
  listingUrl?: string;
  photoUrl?: string;
}

const ZONE_EASE_SCORE: Record<string, number> = {
  THAB: 4.5, "MHU-H": 4.5, "MHU-S": 4.5, MHU: 4.0,
  TBC: 4.0, TC: 4.0, LC: 4.0, MHS: 3.5,
  SHZ: 2.0, LSZ: 1.5, LLRZ: 1.5, RUR: 1.0,
};

function zoneEase(zone: string | null): number {
  if (!zone) return 3.0;
  const upper = zone.toUpperCase().trim();
  return ZONE_EASE_SCORE[upper] ?? 3.0;
}

function overlayPenalty(overlays: Array<{ status: string }>): number {
  return overlays.reduce((sum, o) => {
    if (o.status === "restricted") return sum + 0.5;
    if (o.status === "moderate") return sum + 0.25;
    return sum;
  }, 0);
}

function estimateLots(zone: string | null, land: number | null): number {
  if (!land || land < 200) return 1;
  const zUpper = (zone ?? "").toUpperCase();
  if (zUpper === "THAB" || zUpper === "MHU-H" || zUpper === "MHU-S") return Math.min(20, Math.max(1, Math.floor(land / 60)));
  if (zUpper === "MHU") return Math.min(10, Math.max(1, Math.floor(land / 300)));
  if (zUpper === "MHS") return Math.min(5, Math.max(1, Math.floor(land / 600)));
  if (zUpper === "SHZ") return land >= 800 ? 2 : 1;
  return 1;
}

function quickScore(
  zone: string | null,
  overlays: Array<{ status: string }>,
  land: number | null,
  price: number,
): { ease: number; cost: number; roi: number; composite: number } {
  const lots = estimateLots(zone, land);
  const ease = Math.max(0.5, Math.min(5.0, zoneEase(zone) - overlayPenalty(overlays)));

  const costPerLot = lots > 0 ? price / lots : price;
  const costScore =
    costPerLot < 400_000 ? 5.0
    : costPerLot < 600_000 ? 4.0
    : costPerLot < 800_000 ? 3.0
    : costPerLot < 1_100_000 ? 2.0
    : costPerLot < 1_400_000 ? 1.5
    : 1.0;

  const roiScore = lots >= 4 ? 4.5 : lots >= 3 ? 4.0 : lots >= 2 ? 3.5 : 2.0;

  const composite = parseFloat(((ease * 0.3) + (costScore * 0.3) + (roiScore * 0.4)).toFixed(1));
  return { ease: Math.round(ease * 2) / 2, cost: costScore, roi: roiScore, composite };
}

function makeSummary(
  zone: string | null,
  lots: number,
  overlays: Array<{ status: string; name: string }>,
  land: number | null,
): string {
  const zonePart = zone ? `${zone} zoned` : "Zoning TBC";
  const lotPart = lots > 1 ? `${lots} lots potentially feasible` : "Single dwelling only";
  const overlayNames = overlays.filter(o => o.status !== "clear").map(o => o.name).slice(0, 2);
  const overlayPart = overlayNames.length > 0 ? `Overlays: ${overlayNames.join(", ")}.` : "No major overlays.";
  const sizePart = land ? `${land}m² site.` : "";
  return [zonePart, sizePart, lotPart + ".", overlayPart, "Pre-screen estimate only."].filter(Boolean).join(" ");
}

function isApartmentAddress(address: string): boolean {
  const a = address.trim();
  return /^[\dA-Za-z]+\/[\dA-Za-z]+/i.test(a) ||
    /^[\d&, ]+\/\d+/i.test(a) ||
    /^(unit|apt|apartment|level|flat|suite)\s+[\dA-Za-z]/i.test(a) ||
    /^\d+[A-Za-z]+\/\d+/i.test(a);
}

async function screenOneFast(listing: ListingResult): Promise<PropertyCandidate | null> {
  try {
    if (isApartmentAddress(listing.address)) {
      logger.debug({ address: listing.address }, "Pre-screen: skipping apartment/unit address");
      return null;
    }

    const geo = await geocodeAddress(listing.address);
    const [zoneResult, overlays] = await Promise.allSettled([
      fetchUnitaryPlanZone(geo.lat, geo.lng),
      fetchOverlays(geo.lat, geo.lng),
    ]);

    const zone = zoneResult.status === "fulfilled" ? zoneResult.value?.zone_code : null;
    const resolvedOverlays = overlays.status === "fulfilled" ? overlays.value : [];

    const land = listing.landArea;
    const price = listing.price;

    if (!price) return null;

    const lots = estimateLots(zone, land ?? null);
    const scores = quickScore(zone, resolvedOverlays, land ?? null, price);

    return {
      address: listing.address,
      price,
      landArea: land ?? undefined,
      zone: zone ?? undefined,
      scores,
      briefSummary: makeSummary(zone, lots, resolvedOverlays, land ?? null),
      listingUrl: listing.listingUrl,
      photoUrl: listing.photoUrl ?? undefined,
    };
  } catch (err) {
    logger.warn({ err, address: listing.address }, "Pre-screen fast: failed for listing");
    return null;
  }
}

export async function preScreenListingsFast(
  listings: ListingResult[],
  maxConcurrent = 5,
): Promise<PropertyCandidate[]> {
  const nonApartments = listings.filter((l) => !isApartmentAddress(l.address));
  const results: PropertyCandidate[] = [];
  const queue = [...nonApartments];

  while (queue.length > 0) {
    const batch = queue.splice(0, maxConcurrent);
    const batchResults = await Promise.all(batch.map(screenOneFast));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  return results
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, 6);
}

async function screenOne(listing: ListingResult): Promise<PropertyCandidate | null> {
  try {
    const geo = await geocodeAddress(listing.address);

    const hougarden = await scrapeHougarden(geo.lat, geo.lng, listing.address).catch(() => null);

    const zone = hougarden?.zone_code ?? listing.zone;
    const overlays = hougarden?.overlays ?? [];
    const land = hougarden?.land_area_sqm ?? listing.landArea;
    const price = listing.price ?? hougarden?.cv_nzd ?? 0;

    if (!price) return null;

    const lots = estimateLots(zone, land);
    const scores = quickScore(zone, overlays, land, price);

    return {
      address: listing.address,
      price,
      landArea: land ?? undefined,
      zone: zone ?? undefined,
      scores,
      briefSummary: makeSummary(zone, lots, overlays, land),
      photoUrl: listing.photoUrl ?? undefined,
    };
  } catch (err) {
    logger.warn({ err, address: listing.address }, "Pre-screen: failed for listing");
    return null;
  }
}

export async function preScreenListings(
  listings: ListingResult[],
  maxConcurrent = 3,
): Promise<PropertyCandidate[]> {
  const results: PropertyCandidate[] = [];
  const queue = [...listings];

  while (queue.length > 0) {
    const batch = queue.splice(0, maxConcurrent);
    const batchResults = await Promise.all(batch.map(screenOne));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  return results
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, 5);
}
