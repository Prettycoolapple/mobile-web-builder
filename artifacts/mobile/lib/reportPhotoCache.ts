import * as FileSystem from "expo-file-system/legacy";
import { getApiBase } from "@/lib/api";

// Photos for each feasibility report are stored on-device under
// `${documentDirectory}report-photos/<sessionId>/<hash>.<ext>`. The directory
// outlives the app process, so previously-downloaded photos remain available
// when the user reopens a saved report — even if the original CDN URL has
// rotated or been hot-link-blocked. The directory is removed only when the
// user deletes the chat session that owns the report.
const ROOT = `${FileSystem.documentDirectory ?? ""}report-photos`;
const MIN_VALID_BYTES = 1024;

async function ensureDir(path: string): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(path, { intermediates: true });
    }
  } catch {
    // ignore — write attempts surface the real error later
  }
}

function hashUrl(url: string): string {
  // Stable, dependency-free hash. Two 32-bit lanes give plenty of room to
  // avoid collisions between the small number of photos one report holds.
  let h1 = 0x12345678;
  let h2 = 0x9abcdef0;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  const left = (h1 >>> 0).toString(16).padStart(8, "0");
  const right = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${left}${right}`;
}

function inferExtension(url: string): string {
  const m = url.match(/\.(jpe?g|png|webp|gif)(?:[?#]|$)/i);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  return "jpg";
}

/** Google Street View Static image via our API (requires GOOGLE_MAPS_API_KEY on server). */
export function streetViewUrlFor(address: string): string {
  return `${getApiBase()}/streetview?address=${encodeURIComponent(address)}&size=800x450`;
}

/** Maps Static API (satellite) — last Google fallback when Street View is missing or fails. */
export function staticMapUrlFor(address: string): string {
  return `${getApiBase()}/staticmap?address=${encodeURIComponent(address)}&size=800x450`;
}

/**
 * Wrap a third-party image URL in our server-side proxy so the download
 * succeeds even when the CDN refuses requests without a matching Referer.
 * URLs that already point at our API (e.g. /streetview, /staticmap, /image-proxy) are
 * returned unchanged.
 */
export function viaImageProxy(remoteUrl: string): string {
  const apiBase = getApiBase();
  if (!apiBase) return remoteUrl;
  if (remoteUrl.startsWith(apiBase)) return remoteUrl;
  return `${apiBase}/image-proxy?url=${encodeURIComponent(remoteUrl)}`;
}

async function downloadOne(remoteUrl: string, destDir: string): Promise<string | null> {
  if (!remoteUrl) return null;
  try {
    await ensureDir(destDir);
    const filename = `${hashUrl(remoteUrl)}.${inferExtension(remoteUrl)}`;
    const destPath = `${destDir}/${filename}`;

    const existing = await FileSystem.getInfoAsync(destPath);
    if (existing.exists && existing.size != null && existing.size > MIN_VALID_BYTES) {
      return destPath;
    }

    const fetchUrl = viaImageProxy(remoteUrl);
    const result = await FileSystem.downloadAsync(fetchUrl, destPath, {
      headers: { Accept: "image/*" },
    });
    if (result.status >= 200 && result.status < 300) {
      const got = await FileSystem.getInfoAsync(destPath);
      if (got.exists && got.size != null && got.size > MIN_VALID_BYTES) {
        return destPath;
      }
    }
    await FileSystem.deleteAsync(destPath, { idempotent: true }).catch(() => {});
    return null;
  } catch {
    return null;
  }
}

export interface ReportPhotoSource {
  address?: string | null;
  photoUrl?: string | null;
  photoUrls?: string[] | null;
}

const TARGET_PHOTO_COUNT = 4;

/**
 * Download up to TARGET_PHOTO_COUNT (4) property photos for the given report.
 *
 * Priority order:
 *  1. Scraped listing photos (OneRoof gallery + realestate.co.nz)
 *  2. Google Street View  — fills slot 3 when fewer than 4 listing photos exist
 *  3. Maps Static (satellite) — fills slot 4 when still under the target
 *
 * Returns the local file URIs of every successfully cached image, in display order.
 */
export async function cacheReportPhotos(
  sessionId: string,
  report: ReportPhotoSource,
): Promise<string[]> {
  if (!FileSystem.documentDirectory || !sessionId) return [];
  const dir = `${ROOT}/${sessionId}`;
  await ensureDir(dir);

  const remoteUrls = Array.from(
    new Set(
      [
        ...(report.photoUrls ?? []),
        ...(report.photoUrl ? [report.photoUrl] : []),
      ].filter((u): u is string => typeof u === "string" && u.length > 0),
    ),
  );

  const localUris: string[] = [];
  for (const url of remoteUrls) {
    if (localUris.length >= TARGET_PHOTO_COUNT) break;
    const local = await downloadOne(url, dir);
    if (local) localUris.push(local);
  }

  // Pad with Google Street View then Satellite so users always see 4 images.
  if (report.address && localUris.length < TARGET_PHOTO_COUNT) {
    const svUrl = streetViewUrlFor(report.address);
    if (!remoteUrls.includes(svUrl)) {
      const sv = await downloadOne(svUrl, dir);
      if (sv && localUris.length < TARGET_PHOTO_COUNT) localUris.push(sv);
    }
  }
  if (report.address && localUris.length < TARGET_PHOTO_COUNT) {
    const smUrl = staticMapUrlFor(report.address);
    if (!remoteUrls.includes(smUrl)) {
      const sm = await downloadOne(smUrl, dir);
      if (sm && localUris.length < TARGET_PHOTO_COUNT) localUris.push(sm);
    }
  }

  return localUris;
}

export async function deleteReportPhotos(sessionId: string): Promise<void> {
  if (!FileSystem.documentDirectory || !sessionId) return;
  try {
    const dir = `${ROOT}/${sessionId}`;
    await FileSystem.deleteAsync(dir, { idempotent: true });
  } catch {
    // ignore — orphaned photos are harmless
  }
}

/**
 * Build a photo-source signature so the cache layer can skip work when a
 * report has not changed. This is intentionally lightweight: we hash the set
 * of remote URLs plus the address fallback target.
 */
export function reportPhotoSignature(report: ReportPhotoSource): string {
  const urls = [
    ...(report.photoUrls ?? []),
    ...(report.photoUrl ? [report.photoUrl] : []),
  ]
    .filter((u): u is string => typeof u === "string" && u.length > 0)
    .sort();
  return urls.length > 0 ? urls.join("|") : `addr::${report.address ?? ""}`;
}
