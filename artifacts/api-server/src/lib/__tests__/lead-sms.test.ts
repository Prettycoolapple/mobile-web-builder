import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  leadSmsDeliveries: {},
  limTitleRequests: {},
  listingAgentTargets: {},
}));
vi.mock("../env", () => ({
  getLeadShortBaseUrl: () => "https://projectalpha.nz/l",
  getTwilioLeadStatusCallbackUrl: () => "https://projectalpha.nz/api/webhooks/twilio/sms-status",
  isLimTitleSmsEnabled: () => false,
}));
vi.mock("../twilio", () => ({ sendSms: vi.fn() }));
vi.mock("../logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import {
  buildLeadSms,
  gsm7SeptetLength,
  isNzSmsDaytime,
  sanitizeSmsText,
  SINGLE_SMS_SEPTETS,
} from "../lead-sms";

describe("lead SMS formatting", () => {
  beforeEach(() => vi.clearAllMocks());

  it("produces the approved one-segment template", () => {
    const body = buildLeadSms({
      address: "12 Queen Street, Auckland Central, Auckland 1010",
      claimToken: "Ab3K9x2Q",
      agentName: "Alex Agent",
      shortBase: "projectalpha.nz/l",
    });
    expect(body).toContain("Project Alpha: Hi Alex, buyer wants LIM/title: 12 Queen Street");
    expect(body).toContain("https://projectalpha.nz/l/Ab3K9x2Q");
    expect(body).toContain("STOP=opt out");
    expect(body).toContain("Reply to this SMS will be charged");
    expect(gsm7SeptetLength(body)).toBeLessThanOrEqual(SINGLE_SMS_SEPTETS);
  });

  it("normalizes and truncates long Unicode addresses without creating UCS-2", () => {
    const body = buildLeadSms({
      address: "12345 Te Tino Roa o te Huarahi ā-Motu — Extremely Long Property Address, Tāmaki Makaurau",
      claimToken: "123456789012",
      agentName: "Alexandria-Very-Long-Agent-Name",
      shortBase: "projectalpha.nz/l",
    });
    expect(gsm7SeptetLength(body)).not.toBeNull();
    expect(gsm7SeptetLength(body)).toBeLessThanOrEqual(160);
    expect(body).toContain("...");
  });

  it("rejects a link base that cannot leave a useful address budget", () => {
    expect(() => buildLeadSms({
      address: "12 Queen Street",
      claimToken: "12345678",
      shortBase: `example.com/${"x".repeat(80)}`,
    })).toThrow(/too long/i);
  });

  it("sanitizes non-GSM punctuation and diacritics", () => {
    expect(sanitizeSmsText("Tāmaki — buyer’s request")).toBe("Tamaki buyer s request");
  });

  it("uses Auckland local time for the daytime gate", () => {
    expect(isNzSmsDaytime(new Date("2026-07-13T00:00:00.000Z"))).toBe(true); // noon NZST
    expect(isNzSmsDaytime(new Date("2026-07-13T12:00:00.000Z"))).toBe(false); // midnight NZST
  });
});
