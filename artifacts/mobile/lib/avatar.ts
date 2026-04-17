/**
 * Resolves a relative or absolute avatar URL to a full HTTPS URL.
 * Returns null when no URL is provided.
 */
export function resolveAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  if (domain) return `https://${domain}${url}`;
  return url;
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
  const domain = process.env["EXPO_PUBLIC_DOMAIN"];
  // Only attach auth headers for our own API host.
  if (domain && resolved.startsWith(`https://${domain}`)) {
    return { uri: resolved, headers: authHeaders };
  }
  return { uri: resolved };
}
