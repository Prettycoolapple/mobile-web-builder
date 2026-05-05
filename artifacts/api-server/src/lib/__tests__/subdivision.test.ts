import { describe, expect, it } from "vitest";
import { detectSubdivision, parseStreetNumberSuffix } from "../subdivision";

describe("subdivision detection", () => {
  it("parses parent and child street-number suffixes", () => {
    expect(parseStreetNumberSuffix("66 Marine Parade, Mellons Bay")).toEqual({
      number: "66",
      letter: "",
      rest: "Marine Parade, Mellons Bay",
    });
    expect(parseStreetNumberSuffix("66A Marine Parade, Mellons Bay")).toEqual({
      number: "66",
      letter: "A",
      rest: "Marine Parade, Mellons Bay",
    });
  });

  it("blocks confirmed parent addresses and asks for child lots only", async () => {
    const result = await detectSubdivision("66 Marine Parade, Mellons Bay");

    expect(result.isSubdivided).toBe(true);
    expect(result.subLots).toEqual([
      "66A Marine Parade, Mellons Bay, Auckland 2014",
      "66B Marine Parade, Mellons Bay, Auckland 2014",
      "66C Marine Parade, Mellons Bay, Auckland 2014",
    ]);
    expect(result.subLots).not.toContain("66 Marine Parade, Mellons Bay");
  });

  it("does not block an explicitly selected child lot", async () => {
    await expect(detectSubdivision("66A Marine Parade, Mellons Bay")).resolves.toEqual({
      isSubdivided: false,
      parentAddress: "66A Marine Parade, Mellons Bay",
      subLots: [],
    });
  });
});
