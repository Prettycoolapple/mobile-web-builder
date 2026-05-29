/// <reference lib="dom" />
/**
 * OneRoof photo enrichment placeholder.
 *
 * Historically this module ran a DuckDuckGo-backed public-search fallback to
 * recover photos when `scrapeOneRoof` landed on a snippet/estimate page with
 * no photos. DuckDuckGo has been removed from the codebase (it polluted
 * results with marketing/promo images and unrelated thumbnails), so this
 * module is currently a no-op — the pipeline still calls it for parallel
 * photo enrichment but receives an empty result.
 *
 * OneRoof photos that are discoverable come from `scrapeOneRoof`'s
 * ScrapingBee path, which extracts photos from the same listing page used
 * for CV/bed/bath data.
 */
import { logger } from "../logger";

export interface OneRoofPhotoData {
  photo_urls: string[];
  listing_url: string | null;
  data_source: "oneroof_photos";
  scraped_at: string;
}

export function emptyOneRoofPhotoData(): OneRoofPhotoData {
  return {
    photo_urls: [],
    listing_url: null,
    data_source: "oneroof_photos",
    scraped_at: new Date().toISOString(),
  };
}

export async function scrapeOneRoofPhotos(address: string): Promise<OneRoofPhotoData> {
  logger.debug({ address }, "OneRoof photos: no-op (DDG removed)");
  return emptyOneRoofPhotoData();
}
