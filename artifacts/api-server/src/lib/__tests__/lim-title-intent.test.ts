import { describe, expect, it, vi } from "vitest";
import { ai } from "@workspace/integrations-gemini-ai";

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: vi.fn() } },
}));

import { detectLimTitleIntent, deterministicLimTitleIntent } from "../lim-title-intent";

describe("deterministic LIM/title intent", () => {
  it.each([
    "Please send me the LIM and title",
    "I want to get the record of title",
    "Can I obtain the land information memorandum?",
    "I need the property title documents",
  ])("guarantees common explicit request wording: %s", (message) => {
    expect(deterministicLimTitleIntent(message, false)?.intent).toBe("positive");
  });

  it("understands a short affirmative only while an offer is active", () => {
    expect(deterministicLimTitleIntent("yes", true)?.intent).toBe("positive");
    expect(deterministicLimTitleIntent("yes", false)).toBeNull();
  });

  it("honours an explicit decline", () => {
    expect(deterministicLimTitleIntent("No thanks", true)?.intent).toBe("negative");
    expect(deterministicLimTitleIntent("I don't need the LIM", false)?.intent).toBe("negative");
  });

  it("does not turn a bare document question into a request when the LLM is unavailable", async () => {
    vi.mocked(ai.models.generateContent).mockRejectedValueOnce(new Error("offline"));
    await expect(detectLimTitleIntent({
      messages: [{ role: "user", content: "What information is in a LIM report?" }],
      hasActiveOffer: false,
      propertyAddress: "1 Test Road, Auckland",
    })).resolves.toMatchObject({ intent: "unclear", source: "fallback" });
  });
});
