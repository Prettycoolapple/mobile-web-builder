import { describe, expect, it, vi } from "vitest";
import { resolvePostReportPromptClaim } from "../post-report-prompt-allocation";

vi.mock("@workspace/db", () => ({
  db: {},
  postReportPromptAllocations: {},
  searches: {},
}));

describe("post-report proactive prompt arbitration", () => {
  it("allows the first channel and idempotent retries", () => {
    expect(resolvePostReportPromptClaim(null, "lim_title")).toBe("claimed");
    expect(resolvePostReportPromptClaim("lim_title", "lim_title")).toBe(
      "claimed",
    );
    expect(
      resolvePostReportPromptClaim("service_provider", "service_provider"),
    ).toBe("claimed");
  });

  it("suppresses the opposite proactive channel", () => {
    expect(resolvePostReportPromptClaim("lim_title", "service_provider")).toBe(
      "conflict",
    );
    expect(resolvePostReportPromptClaim("service_provider", "lim_title")).toBe(
      "conflict",
    );
  });
});
