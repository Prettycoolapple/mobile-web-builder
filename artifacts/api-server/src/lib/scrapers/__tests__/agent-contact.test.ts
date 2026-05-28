import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractAgentContactFromListingHtml, scrapeListingAgent } from "../agent-contact";
import { fetchRealestateAgentContactForAddress } from "../realestate-api";
import { fetchWithScrapingBee } from "../scrapingbee";
import { resolveActiveListingContext } from "../../active-listing-context";

vi.mock("../realestate-api", () => ({
  fetchRealestateAgentContactForAddress: vi.fn(),
}));
vi.mock("../scrapingbee", () => ({
  fetchWithScrapingBee: vi.fn(),
}));
vi.mock("../../active-listing-context", () => ({
  resolveActiveListingContext: vi.fn(),
}));

const mockedFetchAgent = vi.mocked(fetchRealestateAgentContactForAddress);
const mockedFetchWithScrapingBee = vi.mocked(fetchWithScrapingBee);
const mockedResolveActiveListingContext = vi.mocked(resolveActiveListingContext);

describe("scrapeListingAgent", () => {
  beforeEach(() => {
    mockedFetchAgent.mockReset();
    mockedFetchWithScrapingBee.mockReset();
    mockedResolveActiveListingContext.mockReset();
    mockedResolveActiveListingContext.mockResolvedValue({ context: null, realestateListing: null });
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

  it("returns active Homes/OneRoof listing context before saying a property is not listed", async () => {
    mockedFetchAgent.mockResolvedValue(null);
    mockedResolveActiveListingContext.mockResolvedValue({
      realestateListing: null,
      context: {
        address: "10 Allen Road, Grey Lynn",
        listingUrl: "https://homes.co.nz/address/auckland/grey-lynn/10-allen-road/RXZ7y",
        source: "homes",
        agentName: "Jane Agent",
        agencyName: "Ray White",
        isActiveListing: true,
      },
    });
    mockedFetchWithScrapingBee.mockResolvedValue("");

    const result = await scrapeListingAgent("10 Allen Road, Grey Lynn");

    expect(result).toMatchObject({
      found: true,
      isListed: true,
      matchType: "subject",
      agentName: "Jane Agent",
      agencyName: "Ray White",
      agentPhone: null,
      listingUrl: "https://homes.co.nz/address/auckland/grey-lynn/10-allen-road/RXZ7y",
      source: "homes",
    });
  });

  it("uses package address context when child address is not separately listed", async () => {
    mockedFetchAgent.mockResolvedValue(null);
    mockedResolveActiveListingContext.mockResolvedValue({
      realestateListing: null,
      context: {
        address: "3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei",
        listingUrl: "https://www.realestate.co.nz/package-rukutai",
        source: "realestate.co.nz",
        agentName: "Package Agent",
        agencyName: "Example Realty",
        isActiveListing: true,
        isCombinedListing: true,
      },
    });

    const result = await scrapeListingAgent("11 Rukutai Street, Orakei", {
      selectedListingContext: {
        isCombinedListing: true,
        packageAddress: "3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei",
        childAddresses: ["11 Rukutai Street, Orakei", "12 Godden Crescent, Orakei"],
        aggregateFactsExcluded: true,
      },
    });

    expect(mockedFetchAgent).toHaveBeenCalledWith("3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei");
    expect(result).toMatchObject({
      found: true,
      isListed: true,
      matchType: "subject",
      agentName: "Package Agent",
      agencyName: "Example Realty",
      listingUrl: "https://www.realestate.co.nz/package-rukutai",
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
