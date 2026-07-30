/**
 * Rubin — the subdivision/site engine the "AI Subdivision" button opens.
 *
 * Rubin renders the site itself, in a full-screen WebView, rather than the app
 * re-drawing Rubin's output natively. That means every layer Rubin learns to
 * draw — and eventually the subdivision generation itself — reaches users the
 * moment Rubin deploys, with no App Store build.
 *
 * The app still gates the button through its own API (`/api/subdivision/site`),
 * because Rubin covers **Auckland only** and a user must never open a
 * full-screen view onto a broken canvas.
 */

function trim(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Overridable so a staging Rubin can be pointed at from an EAS profile without
 * a code change. Kept separate from `getApiBase()` — Rubin is a different
 * deployment, and conflating them would send subdivision traffic to our API.
 */
export function getRubinOrigin(): string {
  const configured = trim(process.env.EXPO_PUBLIC_RUBIN_URL) ?? "https://rubin-one.vercel.app";
  const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  return withProtocol.replace(/\/+$/, "");
}

export interface RubinSiteTarget {
  address?: string | null;
  /** Preferred when known: re-geocoding an address can land on a neighbour. */
  lat?: number | null;
  lng?: number | null;
}

/**
 * Build the embed URL. `embed=1` is what strips Rubin's professional chrome
 * (toolbar, AI chat, layers panel, compass, calculation table) — the canvas and
 * every layer it draws are identical either way.
 */
export function buildRubinEmbedUrl(target: RubinSiteTarget): string {
  const params = new URLSearchParams({ embed: "1" });
  if (target.address?.trim()) params.set("address", target.address.trim());
  if (typeof target.lat === "number" && typeof target.lng === "number") {
    params.set("lat", String(target.lat));
    params.set("lng", String(target.lng));
  }
  return `${getRubinOrigin()}/?${params.toString()}`;
}

/** True when there is enough to identify a site; the screen needs one or the other. */
export function hasRubinTarget(target: RubinSiteTarget): boolean {
  if (target.address?.trim()) return true;
  return typeof target.lat === "number" && typeof target.lng === "number";
}
