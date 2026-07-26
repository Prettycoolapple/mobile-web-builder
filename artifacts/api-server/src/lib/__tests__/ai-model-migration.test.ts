import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DeepSeek hard-retired the `deepseek-chat` / `deepseek-reasoner` aliases at
 * 2026-07-24 15:59 UTC. Callsites across the app still pass those names as tier
 * hints, so the rewrite in the shared client is the only thing keeping every
 * LLM feature alive — these tests pin it.
 */

beforeAll(() => {
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.AI_PROVIDER = "deepseek";
});

const { ai } = await import("@workspace/integrations-gemini-ai");

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>) {
  return JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body) as {
    model: string;
    thinking?: { type: string };
  };
}

const request = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };

describe("retired DeepSeek model aliases", () => {
  beforeEach(() => {
    delete process.env.AI_OPENAI_COMPAT_MODEL_FAST;
    delete process.env.AI_OPENAI_COMPAT_MODEL_PRO;
    delete process.env.AI_OPENAI_COMPAT_MODEL_DEFAULT;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the v4 flash model for fast-tier callsites still naming deepseek-chat", async () => {
    const fetchMock = stubFetch();
    await ai.models.generateContent({ model: "deepseek-chat", ...request });
    expect(sentBody(fetchMock).model).toBe("deepseek-v4-flash");
  });

  it("sends the v4 pro model for reasoning callsites still naming deepseek-reasoner", async () => {
    const fetchMock = stubFetch();
    await ai.models.generateContent({ model: "deepseek-reasoner", ...request });
    expect(sentBody(fetchMock).model).toBe("deepseek-v4-pro");
  });

  it("rewrites a retired name pinned by a stale deployment env var", async () => {
    process.env.AI_OPENAI_COMPAT_MODEL_FAST = "deepseek-chat";
    const fetchMock = stubFetch();
    await ai.models.generateContent({ model: "deepseek-chat", ...request });
    expect(sentBody(fetchMock).model).toBe("deepseek-v4-flash");
  });
});

describe("thinking mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("disables thinking for fast-tier calls, matching the non-thinking model they replace", async () => {
    const fetchMock = stubFetch();
    await ai.models.generateContent({ model: "deepseek-chat", ...request });
    expect(sentBody(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("disables thinking whenever a caller asks for a zero budget", async () => {
    const fetchMock = stubFetch();
    await ai.models.generateContent({
      model: "deepseek-reasoner",
      ...request,
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(sentBody(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("leaves thinking on for reasoning-tier calls that did not opt out", async () => {
    const fetchMock = stubFetch();
    await ai.models.generateContent({ model: "deepseek-reasoner", ...request });
    expect(sentBody(fetchMock).thinking).toBeUndefined();
  });
});
