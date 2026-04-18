import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const cache = new Map<string, { buf: Buffer; contentType: string; fetchedAt: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_CACHE_ENTRIES = 500;

function pruneCache() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

let streetViewAvailable: boolean | null = null;
let streetViewProbePromise: Promise<boolean> | null = null;

export async function isStreetViewAvailable(): Promise<boolean> {
  if (streetViewAvailable !== null) return streetViewAvailable;
  if (streetViewProbePromise) return streetViewProbePromise;
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) {
    streetViewAvailable = false;
    return false;
  }
  streetViewProbePromise = (async () => {
    try {
      const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=Auckland&key=${apiKey}`;
      const resp = await fetch(url);
      const json = (await resp.json()) as { status?: string };
      const ok = resp.ok && json.status !== "REQUEST_DENIED";
      streetViewAvailable = ok;
      return ok;
    } catch {
      streetViewAvailable = false;
      return false;
    } finally {
      streetViewProbePromise = null;
    }
  })();
  return streetViewProbePromise;
}

router.get("/streetview", async (req: Request, res: Response) => {
  const address = String(req.query["address"] ?? "").trim();
  const sizeRaw = String(req.query["size"] ?? "640x400").trim();
  const size = /^\d{2,4}x\d{2,4}$/.test(sizeRaw) ? sizeRaw : "640x400";

  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }

  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Street View not configured" });
    return;
  }
  const available = await isStreetViewAvailable();
  if (!available) {
    res.status(404).json({ error: "Street View not available" });
    return;
  }

  const cacheKey = `${size}|${address}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.send(cached.buf);
    return;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/streetview?size=${size}&location=${encodeURIComponent(address)}&fov=80&pitch=0&source=outdoor&key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      res.status(502).json({ error: "Upstream Street View error" });
      return;
    }
    const contentType = resp.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await resp.arrayBuffer());
    cache.set(cacheKey, { buf, contentType, fetchedAt: Date.now() });
    pruneCache();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "GET /streetview failed");
    res.status(500).json({ error: "Street View fetch failed" });
  }
});

export default router;
