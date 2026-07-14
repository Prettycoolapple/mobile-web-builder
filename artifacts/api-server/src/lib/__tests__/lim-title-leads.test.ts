import { beforeEach, describe, expect, it, vi } from "vitest";
import { scrapeListingAgent } from "../scrapers/agent-contact";
import {
  buildLimTitleFacilitatorMessage,
  resolveLeadListingAgent,
} from "../lim-title-leads";

vi.mock("../scrapers/agent-contact", () => ({
  scrapeListingAgent: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {},
  dmMessages: {},
  dmThreads: {},
  limTitleRequests: {},
  listingAgentTargets: {},
  profiles: {},
}));

const mockedScrapeListingAgent = vi.mocked(scrapeListingAgent);

describe("LIM/title listing-agent resolution", () => {
  beforeEach(() => {
    mockedScrapeListingAgent.mockReset();
  });

  it("never trusts an agent phone echoed by the client", async () => {
    mockedScrapeListingAgent.mockResolvedValue({
      found: true,
      isListed: true,
      matchType: "subject",
      listingAddress: "1 Test Road, Auckland",
      agentName: "Test Agent",
      agentPhone: null,
      agencyName: "Test Realty",
      agentAvatarUrl: null,
      listingUrl: "https://example.test/listing/1",
      source: "listing-page",
    });

    const result = await resolveLeadListingAgent({
      address: "1 Test Road, Auckland",
      selectedListingContext: {
        address: "1 Test Road, Auckland",
        listingUrl: "https://example.test/listing/1",
        photoUrl: "https://example.test/photo.jpg",
        agentPhone: "+64210000000",
        matchConfidence: "verified",
        isActiveListing: true,
      },
    });

    expect(result).toBeNull();
    expect(mockedScrapeListingAgent).toHaveBeenCalledWith(
      "1 Test Road, Auckland",
      expect.objectContaining({
        listingUrl: null,
        selectedListingContext: expect.objectContaining({
          agentPhone: null,
          listingUrl: null,
        }),
      }),
    );
  });

  it("accepts an SMS-capable phone returned by the server lookup", async () => {
    mockedScrapeListingAgent.mockResolvedValue({
      found: true,
      isListed: true,
      matchType: "subject",
      listingAddress: "1 Test Road, Auckland",
      agentName: "Test Agent",
      agentPhone: "021 123 4567",
      agencyName: "Test Realty",
      agentAvatarUrl: null,
      listingUrl: "https://example.test/listing/1",
      source: "listing-page",
    });

    await expect(
      resolveLeadListingAgent({ address: "1 Test Road, Auckland" }),
    ).resolves.toMatchObject({
      agentPhone: "+64211234567",
      matchType: "subject",
    });
  });
});

describe("LIM/title facilitator message", () => {
  it("uses the buyer-authored request wording with the analyzed property", () => {
    expect(buildLimTitleFacilitatorMessage("1 Test Road, Auckland")).toBe(
      "Hi, I'd like to know more about 1 Test Road, Auckland. Could you please send me the LIM report and title? Thanks.",
    );
  });
});
