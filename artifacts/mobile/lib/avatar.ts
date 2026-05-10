import { getApiOrigin, resolveAppUrl } from "@/lib/api";

/**
 * React Native image loaders can mis-handle GETs that carry `Content-Type: application/json`
 * (from shared API headers). Only forward headers that are safe for binary media.
 */
const IMAGE_REQUEST_HEADER_ALLOWLIST = new Set([
  "Authorization",
  "Accept-Language",
  "X-Locale",
  "X-OS-Chinese",
]);

export function sanitizeHeadersForImageRequest(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (IMAGE_REQUEST_HEADER_ALLOWLIST.has(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Resolves a relative or absolute avatar URL to a full HTTPS URL.
 * Returns null when no URL is provided.
 */
export function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return resolveAppUrl(url);
}

/**
 * Builds an Image source object that includes the auth header for our private
 * storage routes. Required because React Native's <Image> does not send any
 * cookies/headers by default, and `/api/storage/objects/...` requires auth.
 *
 * Pass-through for fully external URLs (http://...) so we don't leak tokens.
 */
export function avatarImageSource(
  url: string | null | undefined,
  authHeaders: Record<string, string>,
): { uri: string; headers?: Record<string, string> } | null {
  const resolved = resolveAvatarUrl(url);
  if (!resolved) return null;
  const origin = getApiOrigin();
  // Only attach auth headers for our own API host.
  if (origin && resolved.startsWith(origin)) {
    return { uri: resolved, headers: sanitizeHeadersForImageRequest(authHeaders) };
  }
  return { uri: resolved };
}
