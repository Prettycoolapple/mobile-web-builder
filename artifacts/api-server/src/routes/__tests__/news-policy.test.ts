import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
import { clampNewsSeenSequence } from "../../lib/news-viewer";

describe("news unread cursor policy", () => {
  it("never clears a concurrently newer publication", () => {
    expect(clampNewsSeenSequence(12, 10)).toBe(10);
    expect(clampNewsSeenSequence(8, 10)).toBe(8);
    expect(clampNewsSeenSequence(-5, 10)).toBe(0);
    expect(clampNewsSeenSequence("invalid", 10)).toBe(0);
  });
});
