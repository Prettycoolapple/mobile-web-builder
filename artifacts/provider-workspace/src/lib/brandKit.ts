import { apiGet, api } from "@/lib/api";
import type { BrandKit } from "@/lib/pdfStyles";

export type { BrandKit } from "@/lib/pdfStyles";

export const EMPTY_BRAND_KIT: BrandKit = {
  logoUrl: null,
  brandColor: "#173f2e",
  companyName: null,
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  website: null,
  licenceNumber: null,
  footerText: null,
  extraImageUrls: [],
};

export async function loadBrandKit(): Promise<BrandKit> {
  try {
    const { brandKit } = await apiGet<{ brandKit: BrandKit | null }>("/provider/brand-kit", {
      redirectOn401: false,
    });
    return { ...EMPTY_BRAND_KIT, ...(brandKit ?? {}) };
  } catch {
    return { ...EMPTY_BRAND_KIT };
  }
}

export async function saveBrandKit(kit: BrandKit): Promise<BrandKit> {
  const { brandKit } = await api<{ brandKit: BrandKit | null }>("/provider/brand-kit", {
    method: "PUT",
    body: JSON.stringify(kit),
    redirectOn401: false,
  });
  return { ...EMPTY_BRAND_KIT, ...(brandKit ?? kit) };
}

/** Read a chosen image File as a data URL (embeds directly in the PDF, no CORS). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}
