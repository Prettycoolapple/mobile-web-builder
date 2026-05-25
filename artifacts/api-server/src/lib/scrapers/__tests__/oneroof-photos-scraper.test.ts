import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wiring test for `scrapeOneRoofPhotos`. The underlying helpers
 * (`extractOneRoofPropertyUrlsFromSearchHtml` + `extractOneRoofDataFromHtml`)
 * are already covered by `oneroof-photos.test.ts` — this test only exercises
 * the discovery flow (DDG → candidate URL → property page → photo extraction)
 * by stubbing the network layer.
 */

const SEARCH_HTML = `
  <html><body>
    <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.oneroof.co.nz%2Fproperty%2Fauckland%2Fcoatesville%2F70%2Dscreen%2Droad%2FGfkeQ&amp;rut=abc">
      70 Screen Road | Coatesville | OneRoof
    </a>
  </body></html>
`.padEnd(600, " ");

const PROPERTY_HTML = `
  <html>
    <head>
      <meta property="og:image" content="https://s.oneroof.co.nz/image/aa/bb/hero.jpg?x-oss-process=image/quality,q_80/resize,w_1080/format,webp" />
    </head>
    <body>
      <img src="https://s.oneroof.co.nz/image/cc/dd/two.jpg?x-oss-process=image/quality,q_100/resize,w_1200" />
      <img src="https://s.oneroof.co.nz/image/ee/ff/three.jpg?x-oss-process=image/quality,q_100/resize,w_1200" />
    </body>
  </html>
`.padEnd(600, " ");

// Stub ScrapingBee so the test never hits the real API.
vi.mock("../scrapingbee", () => ({
  fetchWithScrapingBee: vi.fn(async (url: string) => {
    if (url.includes("oneroof.co.nz/property/")) return PROPERTY_HTML;
    return null;
  }),
}));

describe("scrapeOneRoofPhotos", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("discovers a OneRoof sold-listing via DuckDuckGo and returns its photos", async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.startsWith("https://duckduckgo.com/")) {
        return new Response(SEARCH_HTML, { status: 200 });
      }
      // Plain-fetch fallback for the listing page (in case ScrapingBee path
      // is unreachable). We mocked ScrapingBee above so this is just safety.
      if (url.includes("oneroof.co.nz/property/")) {
        return new Response(PROPERTY_HTML, { status: 200 });
      }
      return new Response("", { status: 404 });
    });

    const { scrapeOneRoofPhotos } = await import("../oneroof-photos");
    const data = await scrapeOneRoofPhotos("70 Screen Road, Coatesville 0793, New Zealand");

    expect(data.data_source).toBe("oneroof_photos");
    expect(data.listing_url).toBe(
      "https://www.oneroof.co.nz/property/auckland/coatesville/70-screen-road/GfkeQ",
    );
    expect(data.photo_urls.length).toBeGreaterThan(0);
    expect(data.photo_urls[0]).toContain("s.oneroof.co.nz/image/");
  });

  it("returns empty data when DuckDuckGo yields no OneRoof property URL", async () => {
    fetchSpy.mockImplementation(async () => new Response("<html><body>no results</body></html>".padEnd(600, " "), { status: 200 }));

    const { scrapeOneRoofPhotos } = await import("../oneroof-photos");
    const data = await scrapeOneRoofPhotos("nowhere-real 0000, New Zealand");

    expect(data.photo_urls).toEqual([]);
    expect(data.listing_url).toBeNull();
    expect(data.data_source).toBe("oneroof_photos");
  });
});
