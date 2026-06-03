import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The module reads its config from env at load time, so each test sets env then
// imports a fresh copy via vi.resetModules().
function setEnv() {
  process.env["SCRAPINGBEE_API_KEY"] = "test-key";
  process.env["SCRAPINGBEE_MAX_CONCURRENCY"] = "2";
  process.env["SCRAPINGBEE_MAX_RETRIES"] = "3";
  process.env["SCRAPINGBEE_RETRY_BASE_MS"] = "10"; // keep retries fast in tests
  process.env["SCRAPINGBEE_MAX_QUEUE_WAIT_MS"] = "5000";
}

describe("ScrapingBee concurrency queue", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never exceeds max concurrency and still serves every request (FIFO queue)", async () => {
    let current = 0;
    let maxObserved = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        current++;
        maxObserved = Math.max(maxObserved, current);
        await new Promise((r) => setTimeout(r, 25));
        current--;
        return new Response("<html>ok</html>", { status: 200 });
      }),
    );

    const { fetchWithScrapingBee } = await import("../scrapingbee");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => fetchWithScrapingBee(`https://example.com/${i}`)),
    );

    expect(results).toHaveLength(10);
    expect(results.every((r) => r === "<html>ok</html>")).toBe(true); // everyone gets a result
    expect(maxObserved).toBe(2); // used both slots, never more
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls < 3) return new Response("rate limited", { status: 429 });
        return new Response("<html>recovered</html>", { status: 200 });
      }),
    );

    const { fetchWithScrapingBee } = await import("../scrapingbee");
    const r = await fetchWithScrapingBee("https://example.com");
    expect(r).toBe("<html>recovered</html>");
    expect(calls).toBe(3); // two 429s + one success
  });

  it("retries on transient 5xx", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("boom", { status: 503 });
        return new Response("<html>ok</html>", { status: 200 });
      }),
    );
    const { fetchWithScrapingBee } = await import("../scrapingbee");
    expect(await fetchWithScrapingBee("https://example.com")).toBe("<html>ok</html>");
    expect(calls).toBe(2);
  });

  it("does NOT retry on 402 (billing/quota) — fails fast", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("quota exceeded", { status: 402 });
      }),
    );
    const { fetchWithScrapingBee } = await import("../scrapingbee");
    expect(await fetchWithScrapingBee("https://example.com")).toBeNull();
    expect(calls).toBe(1);
  });

  it("does NOT retry on 401 (auth)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        return new Response("unauthorized", { status: 401 });
      }),
    );
    const { fetchWithScrapingBee } = await import("../scrapingbee");
    expect(await fetchWithScrapingBee("https://example.com")).toBeNull();
    expect(calls).toBe(1);
  });

  it("gives up null after exhausting retries (still releases the slot)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate", { status: 429 })));
    const { fetchWithScrapingBee, getScrapingBeeQueueStats } = await import("../scrapingbee");
    expect(await fetchWithScrapingBee("https://example.com")).toBeNull();
    // Slot must be released even on total failure, otherwise the queue leaks.
    expect(getScrapingBeeQueueStats().active).toBe(0);
  });

  it("returns null immediately when no API key is configured", async () => {
    delete process.env["SCRAPINGBEE_API_KEY"];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchWithScrapingBee } = await import("../scrapingbee");
    expect(await fetchWithScrapingBee("https://example.com")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
