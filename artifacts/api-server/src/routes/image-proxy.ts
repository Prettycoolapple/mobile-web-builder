import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";

const router: IRouter = Router();

interface CacheEntry {
  buf: Buffer;
  contentType: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const MAX_CACHE_ENTRIES = 1000;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const FETCH_TIMEOUT_MS = 12_000;

// Real-estate / mapping image hosts we proxy. Subdomains of these are also
// allowed. Anything not in this list is rejected — the proxy should never
// become an open relay.
const ALLOWED_HOST_SUFFIXES = [
  "oneroof.co.nz",
  "realestate.co.nz",
  "trademe.co.nz",
  "tmcdn.co.nz",
  "homes.co.nz",
  "qv.co.nz",
  "hougarden.com",
  "hgimg.com",
  "amazonaws.com",
  "cloudfront.net",
  "akamaized.net",
  "akamaihd.net",
  "fastly.net",
  "cdninstagram.com",
  "googleusercontent.com",
  "ggpht.com",
  "googleapis.com",
];

function pruneCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

function isAllowedHost(host: string): boolean {
  const lower = host.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`),
  );
}

function deriveReferer(target: URL): string {
  return `${target.protocol}//${target.host}/`;
}

router.get("/image-proxy", async (req: Request, res: Response) => {
  const target = String(req.query["url"] ?? "").trim();
  if (!target) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ error: "invalid url" });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "unsupported protocol" });
    return;
  }
  if (!isAllowedHost(parsed.hostname)) {
    res.status(400).json({ error: "host not allowed" });
    return;
  }

  const cacheKey = createHash("sha1").update(target).digest("hex");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.send(cached.buf);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      // A modern desktop UA bypasses most basic hot-link gates without
      // tripping bot heuristics that block headless agents.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      Accept: "image/avif,image/webp,image/apng,image/*;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-NZ,en;q=0.9",
      // Set Referer to the same origin as the image — most hot-link guards
      // (oneroof, realestate.co.nz CDNs) accept any same-host referrer.
      Referer: deriveReferer(parsed),
    };

    const upstream = await fetch(target, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!upstream.ok) {
      res.status(upstream.status === 404 ? 404 : 502).json({
        error: `upstream ${upstream.status}`,
      });
      return;
    }
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      res.status(415).json({ error: "not an image" });
      return;
    }
    const lengthHeader = upstream.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_DOWNLOAD_BYTES) {
      res.status(413).json({ error: "image too large" });
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD_BYTES) {
      res.status(413).json({ error: "image too large" });
      return;
    }
    if (buf.length < 256) {
      res.status(502).json({ error: "image too small" });
      return;
    }

    cache.set(cacheKey, { buf, contentType, fetchedAt: Date.now() });
    pruneCache();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    res.send(buf);
  } catch (err) {
    req.log?.error?.({ err, target }, "GET /image-proxy failed");
    res.status(502).json({ error: "fetch failed" });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
