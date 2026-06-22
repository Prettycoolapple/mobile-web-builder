import type { PropertyCandidate } from "@/state/chat-model";

/** Score → semantic colour, matching mobile ScoreBadge thresholds. */
export function scoreColor(score: number): string {
  if (score >= 4) return "var(--green)";
  if (score >= 2.5) return "var(--amber)";
  return "var(--red)";
}

/** Composite (1–5) one-decimal, em-dash when unscored. Mirrors formatCompositeScoreForDisplay. */
export function formatComposite(composite: number | undefined | null): string {
  if (!(typeof composite === "number" && composite > 0)) return "—";
  return composite.toFixed(1);
}

export function formatScore(score: number | undefined | null): string {
  if (typeof score !== "number" || !(score > 0)) return "—";
  return score.toFixed(1);
}

/** "$1.25M" style price (millions, 2dp), with ~ prefix for approximate. */
export function formatMillions(price: number, approx?: boolean): string {
  return `${approx ? "~" : ""}$${(price / 1_000_000).toFixed(2)}M`;
}

/** Card price line: respects placeholder / by-negotiation listings. */
export function candidatePriceText(c: PropertyCandidate): string | null {
  if (c.priceIsPlaceholder) return c.priceDisplay?.trim() || "Price by negotiation";
  if (c.price > 0) return formatMillions(c.price, c.priceApprox);
  if (c.priceDisplay?.trim()) return c.priceDisplay.trim();
  return null;
}

export function formatArea(area: number | undefined | null, approx?: boolean): string | null {
  if (typeof area !== "number" || area <= 0) return null;
  return `${approx ? "~" : ""}${Math.round(area)}m²`;
}

/** "$1.2M" / "$850k" / "$12,500" — compact NZD for cost & ROI figures. */
export function formatMoney(value: number | undefined | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value).toLocaleString()}`;
}

export function formatRange(low?: number | null, high?: number | null): string {
  if (typeof low === "number" && typeof high === "number") {
    if (low === high) return formatMoney(low);
    return `${formatMoney(low)} – ${formatMoney(high)}`;
  }
  if (typeof low === "number") return formatMoney(low);
  if (typeof high === "number") return formatMoney(high);
  return "—";
}

export function formatPercent(value: number | undefined | null, dp = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toFixed(dp)}%`;
}

export function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Strip JSON blocks out of assistant prose so raw payloads never show as text. */
export function sanitizeForDisplay(text: string, fallback: string): string {
  if (!text) return fallback;
  const stripped = text
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*\}/g, "")
    .replace(/\[[\s\S]*\]/g, "")
    .trim();
  return stripped.length >= 4 ? stripped : fallback;
}

export function extractJSON(text: string): unknown | null {
  try {
    const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    /* ignore */
  }
  return null;
}
