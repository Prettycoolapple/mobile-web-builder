import { beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeListingAgent } from "../agent-contact";
import { fetchRealestateAgentContactForAddress } from "../realestate-api";

vi.mock("../realestate-api", () => ({
  fetchRealestateAgentContactForAddress: vi.fn(),
}));

const mockedFetchAgent = vi.mocked(fetchRealestateAgentContactForAddress);

describe("scrapeListingAgent", () => {
  beforeEach(() => {
    mockedFetchAgent.mockReset();
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
});
