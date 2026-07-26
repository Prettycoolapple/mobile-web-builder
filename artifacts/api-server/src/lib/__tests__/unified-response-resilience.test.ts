import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: {
    models: {
      generateContent: vi.fn(),
    },
  },
}));

import { ai } from "@workspace/integrations-gemini-ai";
import { generateUnifiedResponse } from "../claude";

const generateContent = ai.models.generateContent as unknown as ReturnType<typeof vi.fn>;

const messages = [{ role: "user" as const, content: "What are the key risks?" }];

const report = {
  address: "202 West Tamaki Road, Glendowie",
  scores: { ease: 3, cost: 2, roi: 3, composite: 2.8 },
  riskSummary: ["Overland flow path crosses the rear of the site."],
  // The fields that used to blow the prompt past the provider's context window.
  overlay_map_image_base64: "A".repeat(50_000),
  photoUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
  cachedPhotoUris: ["file:///var/mobile/a.jpg"],
};

describe("generateUnifiedResponse resilience", () => {
  beforeEach(() => {
    generateContent.mockReset();
  });

  it("keeps base64 blobs and photo lists out of the prompt", async () => {
    generateContent.mockResolvedValue({ text: "The main risk is the overland flow path." });

    await generateUnifiedResponse(messages, report, "followup");

    const systemInstruction = generateContent.mock.calls[0][0].config.systemInstruction as string;
    expect(systemInstruction).not.toContain("A".repeat(1_000));
    expect(systemInstruction).not.toContain("cdn.example.com");
    expect(systemInstruction).not.toContain("file:///var/mobile/a.jpg");
    // The pinned figures the answer rules depend on survive.
    expect(systemInstruction).toContain("202 West Tamaki Road, Glendowie");
    expect(systemInstruction).toContain("Overland flow path crosses the rear of the site.");
  });

  it("falls back to the fast model when the reasoning model fails", async () => {
    generateContent
      .mockRejectedValueOnce(new Error("OpenAI-compatible provider error 400: context length exceeded"))
      .mockResolvedValueOnce({ text: "Key risk: the overland flow path." });

    const result = await generateUnifiedResponse(messages, report, "followup");

    expect(result.content).toBe("Key risk: the overland flow path.");
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[0][0].model).toBe("deepseek-reasoner");
    expect(generateContent.mock.calls[1][0].model).toBe("deepseek-chat");
    // The retry drops the raw report JSON so a context overflow can't repeat.
    const fallbackSystem = generateContent.mock.calls[1][0].config.systemInstruction as string;
    expect(fallbackSystem).not.toContain("FULL REPORT JSON");
    expect(fallbackSystem).toContain("Overland flow path crosses the rear of the site.");
  });

  it("retries on the fast model when the reasoning model returns nothing", async () => {
    generateContent
      .mockResolvedValueOnce({ text: "   " })
      .mockResolvedValueOnce({ text: "Here are the risks." });

    const result = await generateUnifiedResponse(messages, report, "followup");

    expect(result.content).toBe("Here are the risks.");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("surfaces the failure only when both models fail", async () => {
    generateContent.mockRejectedValue(new Error("provider down"));

    await expect(generateUnifiedResponse(messages, report, "followup")).rejects.toThrow("provider down");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("bounds the primary call with a timeout so a stalled provider can fall back", async () => {
    generateContent.mockResolvedValue({ text: "ok" });

    await generateUnifiedResponse(messages, report, "followup");

    const timeoutMs = generateContent.mock.calls[0][0].config.timeoutMs as number;
    expect(timeoutMs).toBeGreaterThan(0);
    // Must leave room under the mobile client's 200s abort for the fallback.
    expect(timeoutMs).toBeLessThan(200_000);
  });
});
