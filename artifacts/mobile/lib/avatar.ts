import { getApiOrigin, resolveAppUrl } from "@/lib/api";

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
    return { uri: resolved, headers: authHeaders };
  }
  return { uri: resolved };
}
