import { describe, expect, it } from "vitest";
import { extractOneRoofDataFromHtml, extractOneRoofPropertyUrlsFromSearchHtml } from "../oneroof";

describe("OneRoof photo extraction", () => {
  it("keeps gallery photos even when the page has no valuation fields", async () => {
    const data = await extractOneRoofDataFromHtml(
      `
        <html>
          <head>
            <meta property="og:image" content="https://s.oneroof.co.nz/image/aa/bb/hero.jpg?x-oss-process=image/quality,q_80/resize,w_1080/format,webp" />
            <link rel="preload" as="image" imagesrcset="https://s.oneroof.co.nz/image/cc/dd/one.jpg?x-oss-process=image/quality,q_80/resize,w_384/format,webp 1x, https://s.oneroof.co.nz/image/cc/dd/one.jpg?x-oss-process=image/quality,q_100/resize,w_1200 2x" />
          </head>
          <body>
            <img src="https://s.oneroof.co.nz/image/ee/ff/two.jpg?x-oss-process=image/quality,q_100/resize,w_1200" />
            <img src="https://www.oneroof.co.nz/logo.svg" />
          </body>
        </html>
      `,
      "https://www.oneroof.co.nz/property/auckland/coatesville/70-screen-road/GfkeQ",
    );

    expect(data.found).toBe(true);
    expect(data.photo_urls).toHaveLength(3);
    expect(data.photo_urls[0]).toContain("/image/aa/bb/hero.jpg");
    expect(data.photo_urls[1]).toContain("/image/cc/dd/one.jpg");
    expect(data.photo_urls[1]).toContain("w_1200");
    expect(data.photo_urls[2]).toContain("/image/ee/ff/two.jpg");
    expect(data.main_photo_url).toBe(data.photo_urls[0]);
  });

  it("discovers a matching OneRoof property URL from public search markup", () => {
    const html = `
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.oneroof.co.nz%2Fproperty%2Fauckland%2Fcoatesville%2F70%2Dscreen%2Droad%2FGfkeQ&amp;rut=abc">
        70 Screen Road | Coatesville | OneRoof
      </a>
      <a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.oneroof.co.nz%2Fproperty%2Fauckland%2Fcoatesville%2F72%2Dscreen%2Droad%2Fabc">
        Wrong property
      </a>
    `;

    expect(extractOneRoofPropertyUrlsFromSearchHtml(html, "70 Screen Road, Coatesville 0793, New Zealand")).toEqual([
      "https://www.oneroof.co.nz/property/auckland/coatesville/70-screen-road/GfkeQ",
    ]);
  });
});
