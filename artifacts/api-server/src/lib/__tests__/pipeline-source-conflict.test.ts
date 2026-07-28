import { describe, expect, it } from "vitest";
import { hasRoomCountConflict } from "../pipeline";

describe("pipeline source-conflict detection", () => {
  it("requests an exact property profile when address-matched bedroom sources disagree", () => {
    expect(hasRoomCountConflict([2, null, 3, null])).toBe(true);
  });

  it("does not request an extra tie-breaker for matching or unavailable values", () => {
    expect(hasRoomCountConflict([2, 2, null, undefined])).toBe(false);
    expect(hasRoomCountConflict([null, undefined, 0])).toBe(false);
  });
});
