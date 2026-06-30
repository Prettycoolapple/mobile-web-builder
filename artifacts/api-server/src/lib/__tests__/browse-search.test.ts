import { describe, expect, it } from "vitest";
import { browseSearchVariants, compactBrowseSearchText } from "../browse-search";

describe("browse search helpers", () => {
  it("adds spaced suburb variants for compact user input", () => {
    expect(browseSearchVariants("Flatbush")).toEqual(["flatbush", "flat bush"]);
    expect(browseSearchVariants("  Flat   Bush  ")).toEqual(["flat bush"]);
  });

  it("compacts punctuation, spacing and case for DB matching", () => {
    expect(compactBrowseSearchText("Flat Bush")).toBe("flatbush");
    expect(compactBrowseSearchText("St. Heliers")).toBe("stheliers");
  });
});
