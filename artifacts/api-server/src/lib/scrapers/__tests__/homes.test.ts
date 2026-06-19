import { describe, expect, it } from "vitest";
import { buildHomesPropertyUrls, extractHomesDataFromGatewayPayload, extractHomesDataFromHtml, extractHashUrlsFromMapPage } from "../homes";

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

  it("extracts exact facts from Homes gateway property cards for 8 Hampton Drive", () => {
    const payload = {
      cards: [{
        property_id: "9feefcc9-8275-4ff0-bce8-2f7ef185e689",
        url: "/auckland/st-heliers/8-hampton-drive/r9aag",
        property_details: {
          address: "8 Hampton Drive, St Heliers, Auckland",
          display_address: "8 Hampton Drive, St Heliers, Auckland",
          num_bathrooms: 1,
          num_bedrooms: 3,
          latest_bedrooms: "3",
          latest_bathrooms: "1",
          capital_value: 1900000,
          current_revision_date: "2024-05-01",
          floor_area: 178,
          land_area: 1082,
          decade_built: "1960",
        },
      }],
    };

    const data = extractHomesDataFromGatewayPayload(payload, "8 Hampton Drive, St Heliers, Auckland 1071, New Zealand");

    expect(data?.bedrooms).toBe(3);
    expect(data?.bathrooms).toBe(1);
    expect(data?.cv_nzd).toBe(1900000);
    expect(data?.land_area_sqm).toBe(1082);
    expect(data?.build_year).toBeNull();
    expect(data?.build_year_range).toBe("1960-1969");
    expect(data?.address_confirmed).toBe("8 Hampton Drive, St Heliers, Auckland");
  });

  it("keeps Homes decade_built as an approximate range, not an exact build year", () => {
    const payload = {
      cards: [{
        property_id: "rosebank-38a",
        url: "/auckland/papatoetoe/38a-rosebank-road/O0v58N",
        property_details: {
          address: "38A Rosebank Road, Papatoetoe, Auckland",
          display_address: "38A Rosebank Road, Papatoetoe, Auckland",
          floor_area: 136,
          land_area: 150,
          decade_built: "2020s",
        },
      }],
    };

    const data = extractHomesDataFromGatewayPayload(payload, "38A Rosebank Road, Papatoetoe, Auckland");

    expect(data?.build_year).toBeNull();
    expect(data?.build_year_range).toBe("2020-2029");
  });

  it("extracts exact facts from Homes gateway property cards for 38 Te Arawa Street", () => {
    const payload = {
      cards: [{
        property_id: "f40662e7-2e36-46be-b7a8-0662a500acb6",
        url: "/auckland/orakei/38-te-arawa-street/yPZ5e",
        property_details: {
          address: "38 Te Arawa Street, Orakei, Auckland City, Auckland",
          num_bathrooms: 1,
          num_bedrooms: 2,
          latest_bedrooms: "2",
          latest_bathrooms: "1",
          capital_value: 1350000,
          current_revision_date: "2024-05-01",
          floor_area: 84,
          land_area: 437,
          decade_built: "1930",
        },
      }],
    };

    const data = extractHomesDataFromGatewayPayload(payload, "38 Te Arawa Street, Orakei, Auckland 1071, New Zealand");

    expect(data?.bedrooms).toBe(2);
    expect(data?.bathrooms).toBe(1);
    expect(data?.floor_area_sqm).toBe(84);
    expect(data?.land_area_sqm).toBe(437);
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

  it("does not accept a Homes gateway card for 8A when the subject is 8 Hampton Drive", () => {
    const payload = {
      cards: [{
        url: "/auckland/st-heliers/8a-hampton-drive/BDABY",
        property_details: {
          address: "8A Hampton Drive, St Heliers, Auckland",
          num_bathrooms: 2,
          num_bedrooms: 5,
        },
      }],
    };

    const data = extractHomesDataFromGatewayPayload(payload, "8 Hampton Drive, St Heliers, Auckland");

    expect(data).toBeNull();
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

  it("extracts hash URL from short Homes app-state paths without /address", () => {
    const html = `
      <script>
        {"url":"/auckland/saint-heliers/8-hampton-drive/r9aag","beds":3}
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
