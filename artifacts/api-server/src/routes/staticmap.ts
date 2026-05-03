import { Router, type IRouter, type Request, type Response } from "express";

/**
 * Maps Static API (satellite) — last-resort imagery when listing photos and
 * Street View are unavailable or fail. Uses the same GOOGLE_MAPS_API_KEY as
 * /streetview and geocoding.
 */
const router: IRouter = Router();

const cache = new Map<string, { buf: Buffer; contentType: string; fetchedAt: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_CACHE_ENTRIES = 500;

function pruneCache() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

router.get("/staticmap", async (req: Request, res: Response) => {
  const address = String(req.query["address"] ?? "").trim();
  const sizeRaw = String(req.query["size"] ?? "800x450").trim();
  const size = /^\d{2,4}x\d{2,4}$/.test(sizeRaw) ? sizeRaw : "800x450";

  if (!address) {
    res.status(400).json({ error: "address is required" });
    return;
  }

  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Google Maps not configured" });
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
    const marker = encodeURIComponent(address);
    const url =
      `https://maps.googleapis.com/maps/api/staticmap?` +
      `size=${size}&maptype=satellite&zoom=19&scale=2&markers=color:0xea580c|size:mid|${marker}&key=${apiKey}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      res.status(502).json({ error: "Upstream Static Maps error" });
      return;
    }

    const contentType = resp.headers.get("content-type") ?? "image/png";
    const buf = Buffer.from(await resp.arrayBuffer());

    if (contentType.includes("json") || buf.length < 400) {
      res.status(502).json({ error: "Static map generation failed" });
      return;
    }

    cache.set(cacheKey, { buf, contentType, fetchedAt: Date.now() });
    pruneCache();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "GET /staticmap failed");
    res.status(500).json({ error: "Static map fetch failed" });
  }
});

export default router;
