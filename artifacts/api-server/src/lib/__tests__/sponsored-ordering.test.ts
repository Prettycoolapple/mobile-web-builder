import { describe, expect, it } from "vitest";
import {
  isGenericCandidateSponsoredForOrdering,
  prioritizeSponsoredGenericCandidates,
} from "../sponsored-ordering";
import type { PropertyCandidate } from "../pre-screen";

function candidate(address: string, extra: Partial<PropertyCandidate> = {}): PropertyCandidate {
  return {
    address,
    price: 0,
    scores: { ease: 0, cost: 0, roi: 0, composite: 0 },
    source: "curated",
    ...extra,
  };
}

describe("sponsored generic ordering", () => {
  it("promotes internal sponsored listings while preserving standard relative order", () => {
    const cards = [
      candidate("4 Example Road"),
      candidate("5 Example Road", { source: "internal", internalListingId: "agent-1", isSponsored: true }),
      candidate("6 Example Road"),
    ];

    expect(prioritizeSponsoredGenericCandidates(cards).map((card) => card.address)).toEqual([
      "5 Example Road",
      "4 Example Road",
      "6 Example Road",
    ]);
  });

  it("promotes curated listings that match the deterministic fake-sponsored badge", () => {
    const standard = candidate("4 Example Road", { listingUrl: "https://example.test/listing/standard" });
    const fakeSponsored = candidate("5 Example Road", { listingUrl: "https://example.test/listing/100" });
    const tail = candidate("6 Example Road", { listingUrl: "https://example.test/listing/tail" });

    expect(isGenericCandidateSponsoredForOrdering(fakeSponsored)).toBe(true);
    expect(prioritizeSponsoredGenericCandidates([standard, fakeSponsored, tail]).map((card) => card.address)).toEqual([
      "5 Example Road",
      "4 Example Road",
      "6 Example Road",
    ]);
  });

  it("keeps non-sponsored cards stable when a later card is sponsored", () => {
    const cards = [
      candidate("4 Example Road", { listingUrl: "https://example.test/listing/a" }),
      candidate("5 Example Road", { listingUrl: "https://example.test/listing/b" }),
      candidate("6 Example Road", { sponsoredLabel: "Sponsored" }),
      candidate("7 Example Road", { listingUrl: "https://example.test/listing/c" }),
    ];

    expect(prioritizeSponsoredGenericCandidates(cards).map((card) => card.address)).toEqual([
      "6 Example Road",
      "4 Example Road",
      "5 Example Road",
      "7 Example Road",
    ]);
  });
});
