import { afterEach, describe, expect, it, vi } from "vitest";
import { getScreenVerdict, setScreenVerdict, clearScreenVerdictCache } from "../listing-cache";
import type { ScreenVerdict } from "../pre-screen";

const baseListing = {
  listingUrl: "https://www.realestate.co.nz/example/12345",
  address: "12 Example Road, St Heliers, Auckland City, Auckland",
};

afterEach(() => {
  clearScreenVerdictCache();
  vi.useRealTimers();
});

describe("screen verdict cache", () => {
  it("returns null when nothing is cached", () => {
    expect(getScreenVerdict(baseListing)).toBeNull();
  });

  it("round-trips a candidate verdict", () => {
    const verdict: ScreenVerdict = {
      kind: "candidate",
      candidate: {
        address: baseListing.address,
        price: 1_500_000,
        landArea: 800,
        zone: "MHU",
        scores: { ease: 4, cost: 3, roi: 3.5, composite: 3.5 },
        potentialLots: 2,
      },
    };
    setScreenVerdict(baseListing, verdict);
    expect(getScreenVerdict(baseListing)).toEqual(verdict);
  });

  it("round-trips a rejected verdict", () => {
    setScreenVerdict(baseListing, { kind: "rejected", reason: "verified_typology:unit_apartment" });
    const got = getScreenVerdict(baseListing);
    expect(got?.kind).toBe("rejected");
  });

  it("caches indeterminate with a shorter TTL than candidate/rejected", () => {
    vi.useFakeTimers();
    setScreenVerdict(baseListing, { kind: "indeterminate", reason: "build_year_missing" });
    expect(getScreenVerdict(baseListing)?.kind).toBe("indeterminate");
    // Just past 5 minutes — indeterminate expires.
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getScreenVerdict(baseListing)).toBeNull();

    // Candidate survives the same elapsed time.
    setScreenVerdict(baseListing, {
      kind: "candidate",
      candidate: {
        address: baseListing.address,
        price: 1_500_000,
        scores: { ease: 4, cost: 3, roi: 3.5, composite: 3.5 },
      },
    });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(getScreenVerdict(baseListing)?.kind).toBe("candidate");
    // But not 60 minutes.
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(getScreenVerdict(baseListing)).toBeNull();
  });

  it("falls back to normalised address when no listingUrl is provided", () => {
    setScreenVerdict({ address: baseListing.address }, { kind: "rejected", reason: "no_price" });
    // Same normalised address, different/missing URL — still a hit.
    expect(getScreenVerdict({ listingUrl: null, address: "12 Example Road, ST HELIERS, Auckland City, Auckland" })?.kind).toBe("rejected");
  });
});
