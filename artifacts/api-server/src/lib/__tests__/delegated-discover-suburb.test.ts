import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  findSuburbId: vi.fn(),
}));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: mocks.generateContent } },
}));

vi.mock("../scrapers/realestate-api", () => ({
  findSuburbId: mocks.findSuburbId,
  findSuburbInTextViaIndex: vi.fn(),
}));

import { resolveDelegatedDiscoverSuburb, type Message } from "../claude";

function suburbTitle(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

describe("resolveDelegatedDiscoverSuburb", () => {
  beforeEach(() => {
    mocks.generateContent.mockReset();
    mocks.findSuburbId.mockReset();
    mocks.findSuburbId.mockImplementation(async (name: string) => {
      const key = name.toLowerCase().trim();
      return ["albany", "glenfield", "birkenhead"].includes(key)
        ? { title: suburbTitle(key) }
        : null;
    });
  });

  it("uses semantic LLM understanding to pick a concrete suburb when the user delegates", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        acceptsChoice: true,
        candidates: ["Albany", "Glenfield", "Not A Suburb"],
        reasoning: "The user said any area is fine after asking about North Shore.",
      }),
    });
    const messages: Message[] = [
      { role: "user", content: "any subdividable properties in North shore" },
      { role: "assistant", content: "Which North Shore suburb? For example Albany, Glenfield, or Birkenhead." },
      { role: "user", content: "any" },
    ];

    const result = await resolveDelegatedDiscoverSuburb(messages, "any");

    expect(result?.source).toBe("llm");
    expect(result?.candidates).toEqual(["albany", "glenfield"]);
    expect(["albany", "glenfield"]).toContain(result?.suburb);
  });

  it("falls back to prior assistant suburb suggestions when the LLM is unavailable", async () => {
    mocks.generateContent.mockRejectedValue(new Error("offline"));
    const messages: Message[] = [
      { role: "assistant", content: "请问您说的是北岸哪个区呢？比如 Albany、Glenfield、Birkenhead 还是其他地方？" },
      { role: "user", content: "都可以" },
    ];

    const result = await resolveDelegatedDiscoverSuburb(messages, "都可以");

    expect(result?.source).toBe("history_suggestions");
    expect(result?.candidates).toEqual(["albany", "glenfield", "birkenhead"]);
    expect(result?.suburb).toBeTruthy();
  });
});
