import { describe, expect, it } from "vitest";
import {
  buildRecentSalesQuery,
  detectRecentSalesIntent,
  isRecentSalesContinuationText,
  parseRealestateSoldHtml,
  parseRecentSalesFilters,
  renderRecentSalesTable,
  type RecentSalesLocation,
} from "../recent-sales";

const flatBush: RecentSalesLocation = {
  title: "Flat Bush",
  path: "auckland/manukau-city/flat-bush",
  kind: "suburb",
};

describe("recent sales intent", () => {
  it("detects sold-record requests and corrections, not active listing browse", () => {
    expect(detectRecentSalesIntent("\u67e5\u4e00\u4e0b flatbush 6\uff5e7\u623f\uff0c\u5730\u5757\u9762\u79ef400\u4ee5\u4e0a\u3002\u8fd1\u671f\u552e\u4ef7")).toBe(true);
    expect(detectRecentSalesIntent("\u6211\u8981\u770b\u7684\u662f\u6210\u4ea4\u4ef7\u683c\u4e0d\u662f\u5728\u552e\u623f\u6e90")).toBe(true);
    expect(detectRecentSalesIntent("show recently sold 4 bed homes in Flat Bush")).toBe(true);
    expect(detectRecentSalesIntent("show homes for sale in Flat Bush")).toBe(false);
  });

  it("allows direct sold-search continuations but not unrelated follow-ups", () => {
    expect(isRecentSalesContinuationText("\u8fc7\u53bb\u4e09\u4e2a\u6708")).toBe(true);
    expect(isRecentSalesContinuationText("Flat Bush")).toBe(true);
    expect(isRecentSalesContinuationText("thanks")).toBe(false);
    expect(isRecentSalesContinuationText("what about schools")).toBe(false);
  });
});

describe("recent sales filter parsing", () => {
  it("defaults to the last 3 months and parses bed/land filters", () => {
    const filters = parseRecentSalesFilters("\u67e5\u4e00\u4e0b flatbush 6\uff5e7\u623f\uff0c\u5730\u5757\u9762\u79ef400\u4ee5\u4e0a\u3002\u8fd1\u671f\u552e\u4ef7", new Date("2026-07-07T12:00:00Z"));
    expect(filters.months).toBe(3);
    expect(filters.bedroomsMin).toBe(6);
    expect(filters.bedroomsMax).toBe(7);
    expect(filters.landAreaMin).toBe(400);
    expect(filters.fromDate).toBe("2026-04-07");
    expect(filters.toDate).toBe("2026-07-07");
  });

  it("uses a user-specified time window", () => {
    const filters = parseRecentSalesFilters("Flat Bush sold records over the past 6 months");
    expect(filters.months).toBe(6);
  });
});

describe("realestate sold page parsing", () => {
  const html = `
    <html><body>
      <div data-test="tile">
        <a data-test="link-to" href="/property/5-vittoria-terrace-flat-bush-manukau-city-auckland/123">
          <div data-test="standard-tile__search-result__address">5 Vittoria Terrace, Flat Bush</div>
        </a>
        <div data-test="price-display__price-method">Price is not yet confirmed</div>
        <div data-test="tile__search-result__content__date-property">Recently sold</div>
        <span data-test="bedroom"><svg></svg>6</span>
        <span data-test="bathroom">4</span>
        <span data-test="land-area">500m²</span>
      </div>
      <div data-test="tile">
        <a data-test="link-to" href="/property/1-small-place-flat-bush-manukau-city-auckland/456">
          <div data-test="standard-tile__search-result__address">1 Small Place, Flat Bush</div>
        </a>
        <div data-test="price-display__price-method">$1,234,000</div>
        <div data-test="tile__search-result__content__date-property">12/06/2026</div>
        <span data-test="bedroom">4</span>
        <span data-test="bathroom">2</span>
        <span data-test="land-area">300m²</span>
      </div>
    </body></html>
  `;

  it("parses cards and applies requested filters", () => {
    const query = buildRecentSalesQuery(flatBush, "Flat Bush 6-7 bedrooms land area 400+ recent sold prices", new Date("2026-07-07T12:00:00Z"));
    const records = parseRealestateSoldHtml(html, query, "https://www.realestate.co.nz/residential/sold/auckland/manukau-city/flat-bush");
    expect(records).toHaveLength(1);
    expect(records[0].address).toBe("5 Vittoria Terrace, Flat Bush");
    expect(records[0].bedrooms).toBe(6);
    expect(records[0].bathrooms).toBe(4);
    expect(records[0].landAreaSqm).toBe(500);
    expect(records[0].salePriceNzd).toBeNull();
    expect(records[0].dateText).toBe("Recently sold");
  });

  it("renders a markdown table response, not listing-card JSON", () => {
    const query = buildRecentSalesQuery(flatBush, "Flat Bush recent sales", new Date("2026-07-07T12:00:00Z"));
    const records = parseRealestateSoldHtml(html, query, "https://www.realestate.co.nz/residential/sold/auckland/manukau-city/flat-bush");
    const output = renderRecentSalesTable({
      query,
      records,
      source: "realestate_sold",
      sourceUrl: "https://www.realestate.co.nz/residential/sold/auckland/manukau-city/flat-bush",
      fallbackUsed: false,
      warning: null,
    });
    expect(output).toContain("| Address | Sale price | Date | Beds/Baths | Land | Floor | Title | CV |");
    expect(output).toContain("5 Vittoria Terrace, Flat Bush");
    expect(output).not.toContain('"candidates"');
    expect(output).not.toContain("listingUrl");
  });
});
