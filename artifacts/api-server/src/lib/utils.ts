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
  const streetType = /\b(road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i;
  const adminArea = /^(auckland|auckland city|rodney|rodney district|new zealand|aotearoa)$/i;
  const parts = formattedAddress
    .replace(/\b\d{4}\b/g, "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (/^\d/.test(part)) continue;
    if (streetType.test(part)) continue;
    if (adminArea.test(part)) continue;
    return part.toLowerCase().trim();
  }

  return "default";
}
