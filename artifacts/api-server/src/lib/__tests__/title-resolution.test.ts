import { describe, expect, it } from "vitest";
import { resolveTitleStatus } from "../title-resolution";

describe("resolveTitleStatus", () => {
  it("uses live LRS title preview as the verified source", () => {
    const result = resolveTitleStatus({
      lrsTenure: "Cross lease",
      lrsPreviewSource: "live",
      lrsStatus: "resolved",
      titleEstate: "Fee Simple",
      parcelEstate: "Fee Simple",
    });

    expect(result.titleType).toBe("Cross Lease");
    expect(result.titleResolutionSource).toBe("lrs");
  });

  it("uses cached LRS title preview as normal LRS-backed display", () => {
    const result = resolveTitleStatus({
      lrsTenure: "Cross lease",
      lrsPreviewSource: "cache",
      lrsStatus: "unavailable",
    });

    expect(result.titleType).toBe("Cross Lease");
    expect(result.titleResolutionSource).toBe("lrs_cache");
  });

  it("does not fall back to parcel Fee Simple when LRS is unavailable", () => {
    const result = resolveTitleStatus({
      lrsTenure: null,
      lrsStatus: "unavailable",
      titleEstate: "Fee Simple",
      parcelEstate: "Fee Simple",
    });

    expect(result.titleType).toBeNull();
    expect(result.titleResolutionSource).toBe("unknown");
  });

  it("uses exact listing tenure as a non-LRS fallback", () => {
    const result = resolveTitleStatus({
      lrsTenure: null,
      lrsStatus: "unavailable",
      listingTenures: ["Freehold"],
      titleEstate: "Fee Simple",
      parcelEstate: "Fee Simple",
    });

    expect(result.titleType).toBe("Fee Simple");
    expect(result.titleResolutionSource).toBe("listing");
  });

  it("uses exact scraped page non-freehold evidence before generic Fee Simple", () => {
    const result = resolveTitleStatus({
      lrsTenure: null,
      lrsStatus: "unavailable",
      scrapedTenures: ["Cross Lease"],
      titleEstate: "Fee Simple",
      parcelEstate: "Fee Simple",
    });

    expect(result.titleType).toBe("Cross Lease");
    expect(result.titleResolutionSource).toBe("scraped_page");
  });

  it("rejects weak non-tenure snippets", () => {
    const result = resolveTitleStatus({
      lrsTenure: null,
      lrsStatus: "unavailable",
      aiSnippetTenure: "freestanding home on a flat section",
      titleEstate: null,
      parcelEstate: "Fee Simple",
    });

    expect(result.titleType).toBeNull();
  });
});
