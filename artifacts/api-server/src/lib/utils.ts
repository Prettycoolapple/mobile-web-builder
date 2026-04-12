export function formatNZD(amount: number): string {
  return new Intl.NumberFormat("en-NZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

export function roundToNearest(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function extractSuburb(formattedAddress: string): string {
  const parts = formattedAddress.split(",").map((p) => p.trim());
  if (parts.length >= 2) {
    const candidate = parts[1].toLowerCase().trim();
    if (candidate && !candidate.match(/^\d/)) return candidate;
  }
  return "default";
}
