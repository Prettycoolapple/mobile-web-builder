import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { buildShare, sharePreviewHtml } from "../shares";

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
      url: "https://www.projectalpha.app/share/abc123",
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
      url: "https://www.projectalpha.app/share/abc123",
      facts: [],
    }, request());

    expect(html).toContain('href="https://www.projectalpha.app/share/abc123"');
    expect(html).toContain('data-app-url="devfeasible://share/abc123"');
    expect(html).toContain('data-android-intent-url="intent://share/abc123#Intent;scheme=devfeasible;package=nz.devfeasible.app;');
    expect(html).toContain("isMobileSafari");
    expect(html).toContain("window.location.assign(fallback)");
  });
});
