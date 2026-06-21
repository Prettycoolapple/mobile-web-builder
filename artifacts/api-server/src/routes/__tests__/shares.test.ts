import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { buildShare, shareOpenFallbackHtml, sharePreviewHtml, shareUrl } from "../shares";

vi.mock("@workspace/db", () => ({
  db: {},
  propertyShares: {},
}));

function request(origin = "https://www.projectalpha.app"): Request {
  const url = new URL(origin);
  return {
    headers: {
      host: url.host,
      "x-forwarded-proto": url.protocol.replace(":", ""),
    },
    protocol: url.protocol.replace(":", ""),
  } as unknown as Request;
}

describe("property share previews", () => {
  it("generates public preview-first property-share URLs", () => {
    expect(shareUrl("abc123", request())).toBe("https://www.projectalpha.app/property-share/abc123");
  });

  it("uses listing teaser text for the social description", () => {
    const share = buildShare({
      kind: "listing",
      address: "10 Example Road, Auckland",
      listing: {
        teaser: "Sunny freehold home with a wide frontage and development upside.",
        imageUrls: ["https://mediaserver.realestate.co.nz/listing.jpg"],
      },
    });

    expect(share.previewDescription).toBe(
      "Sunny freehold home with a wide frontage and development upside.",
    );
  });

  it("uses the first listing photo array item and proxies it in Open Graph HTML", () => {
    const share = buildShare({
      kind: "listing",
      address: "10 Example Road, Auckland",
      listing: {
        description: "A strong development site near transport.",
        imageUrls: ["https://mediaserver.realestate.co.nz/listing.jpg"],
      },
    });

    const html = sharePreviewHtml({
      token: "abc123",
      kind: "listing",
      address: share.address,
      title: share.previewTitle,
      description: share.previewDescription,
      imageUrl: share.previewImageUrl,
      url: "https://www.projectalpha.app/share/abc123",
      facts: [],
    }, request());

    expect(html).toContain('meta property="og:image"');
    expect(html).toContain("https://www.projectalpha.app/api/image-proxy?url=");
    expect(html).toContain(encodeURIComponent("https://mediaserver.realestate.co.nz/listing.jpg"));
    expect(html).toContain("<img src=");
    expect(html).not.toContain('<div class="hero-fallback">PA</div>');
  });

  it("uses candidate photoUrl for the preview image", () => {
    const share = buildShare({
      kind: "candidate",
      address: "10 Example Road, Auckland",
      candidate: {
        briefSummary: "A strong development site near transport.",
        photoUrl: "https://photos.trademe.co.nz/property/hero.jpg",
      },
    });

    expect(share.previewImageUrl).toBe("https://photos.trademe.co.nz/property/hero.jpg");
  });

  it("uses common thumbnail and cover image fields instead of falling back to PA", () => {
    const share = buildShare({
      kind: "candidate",
      address: "10 Example Road, Auckland",
      candidate: {
        briefSummary: "A strong development site near transport.",
        thumbnailPhotoUrl: "https://photos.trademe.co.nz/property/thumb.jpg",
      },
    });

    const html = sharePreviewHtml({
      token: "abc123",
      kind: "candidate",
      address: share.address,
      title: share.previewTitle,
      description: share.previewDescription,
      imageUrl: share.previewImageUrl,
      url: "https://www.projectalpha.app/property-share/abc123",
      facts: [],
    }, request());

    expect(share.previewImageUrl).toBe("https://photos.trademe.co.nz/property/thumb.jpg");
    expect(html).toContain("<img src=");
    expect(html).not.toContain('<div class="hero-fallback">PA</div>');
  });

  it("accepts safe relative image-proxy URLs for preview images", () => {
    const share = buildShare({
      kind: "listing",
      address: "10 Example Road, Auckland",
      listing: {
        teaser: "A listing with an already proxied cover image.",
        coverImageUrl: "/api/image-proxy?url=https%3A%2F%2Fmediaserver.realestate.co.nz%2Flisting.jpg",
      },
    });

    const html = sharePreviewHtml({
      token: "abc123",
      kind: "listing",
      address: share.address,
      title: share.previewTitle,
      description: share.previewDescription,
      imageUrl: share.previewImageUrl,
      url: "https://www.projectalpha.app/property-share/abc123",
      facts: [],
    }, request());

    expect(share.previewImageUrl).toBe("/api/image-proxy?url=https%3A%2F%2Fmediaserver.realestate.co.nz%2Flisting.jpg");
    expect(html).toContain('meta property="og:image" content="https://www.projectalpha.app/api/image-proxy?url=');
    expect(html).toContain("<img src=");
    expect(html).not.toContain('<div class="hero-fallback">PA</div>');
  });

  it("falls back to selected listing context photos for report shares", () => {
    const share = buildShare({
      kind: "report",
      address: "10 Example Road, Auckland",
      selectedListingContext: {
        photoUrls: ["https://s.oneroof.co.nz/image/example/hero.jpg"],
      },
      summary: {
        score: 4.1,
      },
    });

    expect(share.previewImageUrl).toBe("https://s.oneroof.co.nz/image/example/hero.jpg");
  });

  it("uses the app icon when a share has no image", () => {
    const html = sharePreviewHtml({
      token: "abc123",
      kind: "candidate",
      address: "10 Example Road, Auckland",
      title: "10 Example Road - Project Alpha property opportunity",
      description: "Open Project Alpha to view this property opportunity.",
      imageUrl: null,
      url: "https://www.projectalpha.app/property-share/abc123",
      facts: [],
    }, request());

    expect(html).toContain('meta property="og:image" content="https://www.projectalpha.app/favicon.png"');
  });

  it("renders channel-safe app open fallbacks", () => {
    const html = sharePreviewHtml({
      token: "abc123",
      kind: "candidate",
      address: "10 Example Road, Auckland",
      title: "10 Example Road - Project Alpha property opportunity",
      description: "Open Project Alpha to view this property opportunity.",
      imageUrl: null,
      url: "https://www.projectalpha.app/property-share/abc123",
      facts: [],
    }, request());

    expect(html).toContain('href="https://projectalpha.app/share/abc123"');
    expect(html).not.toContain("devfeasible://share/abc123");
    expect(html).toContain('data-ios-app-url="https://projectalpha.app/share/abc123"');
    expect(html).toContain('data-android-intent-url="intent://share/abc123#Intent;scheme=devfeasible;package=nz.devfeasible.app;');
    expect(html).toContain('button.textContent = prefersZh ? "正在打开..." : "Opening..."');
    expect(html).toContain("window.location.assign(fallback)");
  });

  it("toggles the iOS app-open host when preview is already on the apex domain", () => {
    const html = sharePreviewHtml({
      token: "abc123",
      kind: "candidate",
      address: "10 Example Road, Auckland",
      title: "10 Example Road - Project Alpha property opportunity",
      description: "Open Project Alpha to view this property opportunity.",
      imageUrl: null,
      url: "https://projectalpha.app/property-share/abc123",
      facts: [],
    }, request("https://projectalpha.app"));

    expect(html).toContain('href="https://www.projectalpha.app/share/abc123"');
  });

  it("renders a store fallback page for /share links that reach the browser", () => {
    const html = shareOpenFallbackHtml({
      token: "abc123",
      kind: "candidate",
      address: "10 Example Road, Auckland",
      title: "10 Example Road - Project Alpha property opportunity",
      description: "Open Project Alpha to view this property opportunity.",
      imageUrl: null,
      url: "https://www.projectalpha.app/property-share/abc123",
      facts: [],
    }, request());

    expect(html).toContain("Download on the App Store");
    expect(html).toContain("Get it on Google Play");
    expect(html).toContain('href="https://www.projectalpha.app/property-share/abc123"');
    expect(html).toContain("window.location.replace(target)");
  });
});
