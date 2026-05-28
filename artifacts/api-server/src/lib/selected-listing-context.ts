export interface SelectedListingContext {
  address?: string | null;
  listingUrl?: string | null;
  photoUrl?: string | null;
  photoUrls?: string[] | null;
  price?: number | null;
  landArea?: number | null;
  floorArea?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  bedroomsApprox?: boolean | null;
  bathroomsApprox?: boolean | null;
  landAreaApprox?: boolean | null;
  floorAreaApprox?: boolean | null;
  priceApprox?: boolean | null;
  source?: string | null;
}

const MARKER_PREFIX = "[Selected listing context for analysis:";

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function cleanBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function inferListingSourceFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("trademe.co.nz")) return "trademe";
    if (host.includes("homes.co.nz")) return "homes";
    if (host.includes("oneroof.co.nz")) return "oneroof";
    if (host.includes("realestate.co.nz")) return "realestate.co.nz";
    if (host.includes("hougarden.com")) return "hougarden";
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normaliseSelectedListingContext(raw: unknown): SelectedListingContext | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const listingUrl = cleanString(input.listingUrl);
  const photoUrl = cleanString(input.photoUrl);
  const photoUrls = Array.isArray(input.photoUrls)
    ? Array.from(new Set(input.photoUrls.map(cleanString).filter((u): u is string => !!u)))
    : [];
  const ctx: SelectedListingContext = {
    address: cleanString(input.address),
    listingUrl,
    photoUrl,
    photoUrls,
    price: cleanNumber(input.price),
    landArea: cleanNumber(input.landArea),
    floorArea: cleanNumber(input.floorArea),
    bedrooms: cleanNumber(input.bedrooms),
    bathrooms: cleanNumber(input.bathrooms),
    bedroomsApprox: cleanBool(input.bedroomsApprox),
    bathroomsApprox: cleanBool(input.bathroomsApprox),
    landAreaApprox: cleanBool(input.landAreaApprox),
    floorAreaApprox: cleanBool(input.floorAreaApprox),
    priceApprox: cleanBool(input.priceApprox),
    source: cleanString(input.source) ?? inferListingSourceFromUrl(listingUrl),
  };

  if (!ctx.listingUrl && !ctx.photoUrl && photoUrls.length === 0) return null;
  return ctx;
}

export function selectedListingContextToHistoryMarker(ctx: SelectedListingContext): string {
  return `${MARKER_PREFIX} ${JSON.stringify(ctx)}]`;
}

export function selectedListingContextFromHistory(
  history: Array<{ role: "user" | "assistant"; content: string }> | null | undefined,
): SelectedListingContext | null {
  for (const item of [...(history ?? [])].reverse()) {
    const content = item.content ?? "";
    const idx = content.indexOf(MARKER_PREFIX);
    if (idx < 0) continue;
    const jsonStart = content.indexOf("{", idx);
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
    try {
      return normaliseSelectedListingContext(JSON.parse(content.slice(jsonStart, jsonEnd + 1)));
    } catch {
      // Ignore malformed historical markers.
    }
  }
  return null;
}

export function selectedListingPhotoUrls(ctx: SelectedListingContext | null | undefined): string[] {
  if (!ctx) return [];
  return Array.from(new Set([
    ...(ctx.photoUrls ?? []),
    ...(ctx.photoUrl ? [ctx.photoUrl] : []),
  ].filter((u): u is string => typeof u === "string" && u.length > 0)));
}

export function applySelectedListingContextToReport(
  parsed: Record<string, unknown>,
  selectedListingContext: SelectedListingContext | null | undefined,
): void {
  if (!selectedListingContext) return;
  const fmt = (n: number) => `$${n.toLocaleString("en-NZ")}`;
  const area = (n: number) => `${n}m²`;
  const photos = selectedListingPhotoUrls(selectedListingContext);
  const existingOverview = (parsed.propertyOverview as Record<string, unknown> | undefined) ?? {};
  const existingSources = (parsed.data_sources as Record<string, string> | undefined) ?? {};
  const sourceLabel = selectedListingContext.source ?? "selected active listing";

  const overview: Record<string, unknown> = {
    ...existingOverview,
    selectedListingContext,
    listingSource: sourceLabel,
    listingUrl: selectedListingContext.listingUrl ?? existingOverview.listingUrl ?? null,
    isOnMarket: true,
  };

  if (selectedListingContext.price != null) {
    overview.listingPrice = fmt(selectedListingContext.price);
    overview.listing_price_nzd = selectedListingContext.price;
    existingSources.listing_price = sourceLabel;
  }
  if (selectedListingContext.landArea != null) {
    overview.landArea = area(selectedListingContext.landArea);
    overview.land_area_sqm = selectedListingContext.landArea;
    existingSources.landArea_display = sourceLabel;
  }
  if (selectedListingContext.floorArea != null) {
    overview.floorArea = area(selectedListingContext.floorArea);
    overview.floor_area_sqm = selectedListingContext.floorArea;
    existingSources.floorArea_display = sourceLabel;
  }
  if (selectedListingContext.bedrooms != null) {
    overview.bedrooms = selectedListingContext.bedrooms;
    existingSources.bedrooms_display = sourceLabel;
  }
  if (selectedListingContext.bathrooms != null) {
    overview.bathrooms = selectedListingContext.bathrooms;
    existingSources.bathrooms_display = sourceLabel;
  }

  if (selectedListingContext.bedroomsApprox != null) overview.bedroomsApprox = selectedListingContext.bedroomsApprox;
  if (selectedListingContext.bathroomsApprox != null) overview.bathroomsApprox = selectedListingContext.bathroomsApprox;
  if (selectedListingContext.landAreaApprox != null) overview.landAreaApprox = selectedListingContext.landAreaApprox;
  if (selectedListingContext.floorAreaApprox != null) overview.floorAreaApprox = selectedListingContext.floorAreaApprox;
  if (selectedListingContext.priceApprox != null) overview.priceApprox = selectedListingContext.priceApprox;

  parsed.propertyOverview = overview;
  parsed.selectedListingContext = selectedListingContext;
  parsed.data_sources = existingSources;

  if (photos.length > 0) {
    const existingPhotos = Array.isArray(parsed.photoUrls)
      ? (parsed.photoUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.length > 0)
      : [];
    const combined = Array.from(new Set([...photos, ...existingPhotos]));
    parsed.photoUrls = combined;
    parsed.photoUrl = combined[0] ?? parsed.photoUrl ?? null;
  }
}
