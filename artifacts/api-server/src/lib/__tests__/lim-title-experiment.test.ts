import { describe, expect, it } from "vitest";
import {
  LIM_TITLE_PROACTIVE_RATE,
  isProactiveLimTitleSample,
} from "../lim-title-experiment";

describe("LIM/title proactive assignment", () => {
  it("is stable for the same user and report", () => {
    const first = isProactiveLimTitleSample("user-123", "report-456");
    for (let i = 0; i < 20; i += 1) {
      expect(isProactiveLimTitleSample("user-123", "report-456")).toBe(first);
    }
  });

  it("tracks the configured 30 percent rate over a large deterministic sample", () => {
    let selected = 0;
    const total = 10_000;
    for (let i = 0; i < total; i += 1) {
      if (isProactiveLimTitleSample(`user-${i}`, `report-${i}`)) selected += 1;
    }
    const observed = selected / total;
    expect(LIM_TITLE_PROACTIVE_RATE).toBe(0.3);
    expect(observed).toBeGreaterThan(0.285);
    expect(observed).toBeLessThan(0.315);
  });
});
