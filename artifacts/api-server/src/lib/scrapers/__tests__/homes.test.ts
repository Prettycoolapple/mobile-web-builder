import { describe, expect, it } from "vitest";
import { buildHomesPropertyUrls, extractHomesDataFromHtml, extractHashUrlsFromMapPage } from "../homes";

describe("Homes scraper", () => {
  it("extracts exact bed/bath from Homes map profile state when opaque property URL is unavailable", () => {
    const html = `
      <html>
        <head><title>All homes near 8 Hampton Drive, St Heliers, Auckland - homes.co.nz</title></head>
        <body>
          <script>
            window.__STATE__ = {
              "cards":[{
                "property_details":{
                  "address":"8 Hampton Drive, St Heliers, Auckland",
                  "display_address":"8 Hampton Drive, St Heliers, Auckland",
                  "num_bathrooms":1,
                  "num_bedrooms":3,
                  "latest_bedrooms":"3",
                  "latest_bathrooms":"1"
                }
              }]
            };
          </script>
        </body>
      </html>
    `;

    const data = extractHomesDataFromHtml(html, "8 Hampton Drive, St Heliers, Auckland");

    expect(data.bedrooms).toBe(3);
    expect(data.bathrooms).toBe(1);
  });

  it("does not extract a neighbouring suffix address from embedded Homes state", () => {
    const html = `
      <script>
        {"property_details":{"address":"8A Hampton Drive, St Heliers, Auckland","num_bathrooms":2,"num_bedrooms":5}}
      </script>
    `;

    const data = extractHomesDataFromHtml(html, "8 Hampton Drive, St Heliers, Auckland");

    expect(data.bedrooms).toBeUndefined();
    expect(data.bathrooms).toBeUndefined();
  });

  it("extracts bed/bath from bare 'bedrooms'/'bathrooms' JSON keys (wider net for alternate __STATE__ schemas)", () => {
    const html = `
      <script>
        {"property_details":{"address":"8 Hampton Drive, St Heliers, Auckland","bedrooms":3,"bathrooms":1}}
      </script>
    `;
    const data = extractHomesDataFromHtml(html, "8 Hampton Drive, St Heliers, Auckland");
    expect(data.bedrooms).toBe(3);
    expect(data.bathrooms).toBe(1);
  });
});

describe("extractHashUrlsFromMapPage", () => {
  const ADDRESS = "8 Hampton Drive, Saint Heliers, Auckland 1071, New Zealand";

  it("extracts the canonical hash URL from an anchor href in the map page", () => {
    const html = `
      <a href="/address/auckland/saint-heliers/8-hampton-drive/r9aag">8 Hampton Drive</a>
    `;
    const urls = extractHashUrlsFromMapPage(html, ADDRESS);
    expect(urls).toContain("https://homes.co.nz/address/auckland/saint-heliers/8-hampton-drive/r9aag");
  });

  it("extracts hash URL when it appears inside inline JSON (not just hrefs)", () => {
    const html = `
      <script>
        {"url":"/address/auckland/saint-heliers/8-hampton-drive/r9aag","beds":3}
      </script>
    `;
    const urls = extractHashUrlsFromMapPage(html, ADDRESS);
    expect(urls).toContain("https://homes.co.nz/address/auckland/saint-heliers/8-hampton-drive/r9aag");
  });

  it("does NOT return a URL for a neighbouring property (8A vs 8)", () => {
    const html = `
      <a href="/address/auckland/saint-heliers/8a-hampton-drive/BDABY">8A Hampton Drive</a>
    `;
    const urls = extractHashUrlsFromMapPage(html, ADDRESS);
    expect(urls).toHaveLength(0);
  });

  it("deduplicates URLs when the same hash path appears multiple times", () => {
    const html = `
      <a href="/address/auckland/saint-heliers/8-hampton-drive/r9aag">first</a>
      <a href="/address/auckland/saint-heliers/8-hampton-drive/r9aag">second</a>
    `;
    const urls = extractHashUrlsFromMapPage(html, ADDRESS);
    expect(urls).toHaveLength(1);
  });

  it("rejects paths without a hash suffix (no-hash /address/ URLs always 404)", () => {
    const html = `
      <a href="/address/auckland/saint-heliers/8-hampton-drive">no hash</a>
    `;
    const urls = extractHashUrlsFromMapPage(html, ADDRESS);
    expect(urls).toHaveLength(0);
  });
});

describe("buildHomesPropertyUrls", () => {
  it("builds direct Homes address URLs with the full street type for multi-word street names", () => {
    const urls = buildHomesPropertyUrls(
      "38 Te Arawa Street, Orakei, Auckland",
      "Orakei",
      "38 Te Arawa Street, Orakei, Auckland 1071, New Zealand",
    );

    expect(urls).toContain("https://homes.co.nz/address/auckland/orakei/38-te-arawa-street");
    expect(urls).not.toContain("https://homes.co.nz/address/auckland/orakei/38-te-arawa");
  });
});
