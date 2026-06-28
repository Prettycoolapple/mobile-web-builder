import { Router } from "express";
import { listByScore } from "../lib/property-cache";
import { SCORING_VERSION } from "../lib/card-score";
import { ipRateLimit, minutes } from "../lib/rateLimit";
import { resolveActiveListingContext } from "../lib/active-listing-context";
import { selectedListingPhotoUrls } from "../lib/selected-listing-context";

const router = Router();

// Fixed small page so a scraper can't pull the whole ranked cache in one call,
// and an absolute ceiling on how deep anyone (incl. guests) may page. The Explore
// page hands off to suburb screening once exhausted, so a deep tail isn't needed.
const PAGE_SIZE = 5;
const MAX_OFFSET = 500;
const PHOTO_BATCH_SIZE = 10;

interface ExplorePropertyDTO {
  address: string;
  suburb: string | null;
  composite: number | null;
  ease: number | null;
  cost: number | null;
  roi: number | null;
  zone: string | null;
  landArea: number | null;
  potentialLots: number | null;
  photoUrl?: string | null;
}

interface ExplorePhotoDTO {
  address: string;
  photoUrl: string | null;
  source: "listing" | "none";
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/**
 * Public, guest-accessible ranked view of the global feasibility cache. Returns
 * only card-grade headline data (address + derived scores), never the full report
 * prose or the raw bundle — the full analysis stays login-gated client-side. IP
 * rate-limited as defence-in-depth against bulk harvesting of address→score pairs.
 */
router.get(
  "/explore",
  ipRateLimit({ name: "explore", windowMs: minutes(1), max: 60 }),
  async (req, res) => {
    const rawOffset = Number(req.query.offset ?? "0");
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.min(Math.floor(rawOffset), MAX_OFFSET) : 0;

    try {
      const rows = await listByScore(PAGE_SIZE, offset, SCORING_VERSION);
      const properties: ExplorePropertyDTO[] = rows
        .map((row) => {
          const derived = (row.rawData as Record<string, any> | null)?.derived_scores ?? null;
          const scores = derived?.scores ?? null;
          return {
            address: row.formattedAddress ?? "",
            suburb: row.suburb ?? null,
            composite: numOrNull(scores?.composite),
            ease: numOrNull(scores?.ease),
            cost: numOrNull(scores?.cost),
            roi: numOrNull(scores?.roi),
            zone: typeof derived?.zone === "string" ? derived.zone : null,
            landArea: numOrNull(derived?.landArea),
            potentialLots: numOrNull(derived?.potentialLots),
          };
        })
        .filter((p) => p.address);

      const nextOffset = offset + PAGE_SIZE;
      const exhausted = rows.length < PAGE_SIZE || nextOffset >= MAX_OFFSET;

      res.json({ properties, nextOffset, exhausted });
    } catch (error) {
      req.log.error({ err: error }, "Failed to list explore properties");
      res.status(500).json({ error: "Failed to load explore properties", code: "EXPLORE_FAILED" });
    }
  },
);

function uniqueAddresses(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const address = value.trim();
    if (!address) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
    if (out.length >= PHOTO_BATCH_SIZE) break;
  }
  return out;
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]).catch(() => fallback);
}

async function resolveExplorePhoto(address: string): Promise<ExplorePhotoDTO> {
  const resolved = await withTimeout(
    resolveActiveListingContext(address, { purpose: "feasibility" }),
    { context: null, realestateListing: null },
    12_000,
  );
  const photoUrl = selectedListingPhotoUrls(resolved.context)[0] ?? null;
  return {
    address,
    photoUrl,
    source: photoUrl ? "listing" : "none",
  };
}

async function resolveExplorePhotos(addresses: string[]): Promise<ExplorePhotoDTO[]> {
  const results: ExplorePhotoDTO[] = [];
  for (let i = 0; i < addresses.length; i += 3) {
    const chunk = addresses.slice(i, i + 3);
    results.push(...await Promise.all(chunk.map(resolveExplorePhoto)));
  }
  return results;
}

router.post(
  "/explore/photos",
  ipRateLimit({ name: "explore-photos", windowMs: minutes(1), max: 30 }),
  async (req, res) => {
    const addresses = uniqueAddresses((req.body as { addresses?: unknown } | undefined)?.addresses);
    if (addresses.length === 0) {
      res.status(400).json({ error: "addresses are required", code: "MISSING_ADDRESSES" });
      return;
    }

    try {
      const photos = await resolveExplorePhotos(addresses);
      res.json({ photos });
    } catch (error) {
      req.log.error({ err: error }, "Failed to resolve explore photos");
      res.status(500).json({ error: "Failed to load explore photos", code: "EXPLORE_PHOTOS_FAILED" });
    }
  },
);

export default router;
