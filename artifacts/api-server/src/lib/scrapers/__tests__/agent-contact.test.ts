import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractAgentContactFromListingHtml, scrapeListingAgent } from "../agent-contact";
import { fetchRealestateAgentContactForAddress } from "../realestate-api";
import { fetchWithScrapingBee } from "../scrapingbee";

vi.mock("../realestate-api", () => ({
  fetchRealestateAgentContactForAddress: vi.fn(),
}));
vi.mock("../scrapingbee", () => ({
  fetchWithScrapingBee: vi.fn(),
}));

const mockedFetchAgent = vi.mocked(fetchRealestateAgentContactForAddress);
const mockedFetchWithScrapingBee = vi.mocked(fetchWithScrapingBee);

describe("scrapeListingAgent", () => {
  beforeEach(() => {
    mockedFetchAgent.mockReset();
    mockedFetchWithScrapingBee.mockReset();
  });

  it("returns exact active listing agent data from realestate.co.nz", async () => {
    mockedFetchAgent.mockResolvedValue({
      agentName: "Jane Agent",
      agentPhone: "+64211234567",
      agencyName: "Example Realty",
      agentAvatarUrl: "https://example.test/agent.jpg",
      listingUrl: "https://www.realestate.co.nz/123/residential/sale/1-test-road",
      listingAddress: "1 Test Road, St Heliers",
    });

    const result = await scrapeListingAgent("1 Test Road, St Heliers");

    expect(result).toMatchObject({
      found: true,
      isListed: true,
      matchType: "subject",
      agentName: "Jane Agent",
      agentPhone: "+64211234567",
      source: "realestate-api",
    });
  });

  it("does not fall back to suburb-wide agent scanning when no exact active listing exists", async () => {
    mockedFetchAgent.mockResolvedValue(null);

    const result = await scrapeListingAgent("1 Test Road, St Heliers", { allowSuburbFallback: true });

    expect(mockedFetchAgent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      found: true,
      isListed: false,
      matchType: null,
      agentPhone: null,
    });
  });

  it("returns active selected Trade Me listing context when realestate.co.nz has no match", async () => {
    mockedFetchAgent.mockResolvedValue(null);
    mockedFetchWithScrapingBee.mockResolvedValue(`
      <h1>30 Dingle Road, Saint Heliers</h1>
      <p>Asking price $5,750,000</p>
      <h3>Terry King</h3>
      <h3>Diana King</h3>
      <p>The Kings Of Real Estate, Licensed REAA 2008</p>
      <button>Contact details</button>
      <p>${"Significant family home and environment. ".repeat(20)}</p>
    `);

    const result = await scrapeListingAgent("30 Dingle Road, St Heliers", {
      selectedListingContext: {
        address: "30 Dingle Road, St Heliers",
        listingUrl: "https://www.trademe.co.nz/a/property/residential/sale/listing/5850075796",
        source: "trademe",
      },
    });

    expect(result).toMatchObject({
      found: true,
      isListed: true,
      matchType: "subject",
      agentName: "Terry King",
      agencyName: "The Kings Of Real Estate",
      agentPhone: null,
      source: "trademe",
    });
  });
});

describe("extractAgentContactFromListingHtml", () => {
  it("parses Homes listing agent context without requiring a phone number", () => {
    const result = extractAgentContactFromListingHtml(
      `
      <h1>30 Dingle Road, Saint Heliers</h1>
      <p>Listed: 25 Mar 2026</p>
      <p>Asking price $5,750,000</p>
      <p>Premium</p><a>Terry King</a><a>The Kings Of Real Estate</a>
      <p>Call Make an enquiry</p>
      `,
      "https://homes.co.nz/address/auckland/st-heliers/30-dingle-road/kYBNaw",
    );

    expect(result).toMatchObject({
      found: true,
      isListed: true,
      agentName: "Terry King",
      agencyName: "The Kings Of Real Estate",
      agentPhone: null,
      source: "homes",
    });
  });
});
