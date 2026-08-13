import { beforeAll, describe, expect, it } from "vitest";
import type { Message } from "../../lib/claude";

/**
 * `threadHasRecentAreaDiscovery` gates the chat route's "subdivision intent
 * correction" override. It must describe the thread BEFORE the current turn —
 * if the message being routed can vouch for itself, the gate is always open and
 * a lone report question gets re-routed into a property search.
 */
describe("threadHasRecentAreaDiscovery", () => {
  let threadHasRecentAreaDiscovery: (messages: Message[] | undefined) => boolean;

  // Importing the route module pulls in the whole analyse pipeline, which does
  // real startup work (browser resolution, suburb index) — well past the
  // default per-test timeout, so pay it once here.
  beforeAll(async () => {
    process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
    ({ threadHasRecentAreaDiscovery } = await import("../analyse"));
  }, 120_000);

  it("does not let the message being routed count as prior discovery", () => {
    expect(
      threadHasRecentAreaDiscovery([
        { role: "user", content: "Analyse 36 Old Mill Road, Grey Lynn, Auckland City" },
        { role: "assistant", content: "[Feasibility report for 36 Old Mill Road, Grey Lynn, Auckland City]" },
        { role: "user", content: "What are the main development risks here?" },
      ]),
    ).toBe(false);
  });

  it("still sees genuine area discovery earlier in the thread", () => {
    expect(
      threadHasRecentAreaDiscovery([
        { role: "user", content: "show me subdividable properties in Grey Lynn" },
        { role: "assistant", content: "[Search results shown: 20 Williamson Avenue||https://example.test/1]" },
        { role: "user", content: "I mean ones that are actually subdividable" },
      ]),
    ).toBe(true);
  });

  it("is false for an empty or report-only thread", () => {
    expect(threadHasRecentAreaDiscovery([])).toBe(false);
    expect(threadHasRecentAreaDiscovery(undefined)).toBe(false);
  });
});
