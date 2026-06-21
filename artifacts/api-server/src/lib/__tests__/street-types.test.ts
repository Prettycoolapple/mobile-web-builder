import { describe, expect, it } from "vitest";
import {
  STREET_TYPE_WORDS,
  canonicalStreetType,
  canonicaliseStreetTypesInText,
  canonicaliseTrailingStreetType,
} from "../street-types";

describe("street-types canonicalisation", () => {
  it("maps short forms to one canonical full word", () => {
    expect(canonicalStreetType("cres")).toBe("crescent");
    expect(canonicalStreetType("Crescent")).toBe("crescent");
    expect(canonicalStreetType("dr")).toBe("drive");
    expect(canonicalStreetType("tce")).toBe("terrace");
    expect(canonicalStreetType("pl")).toBe("place");
    expect(canonicalStreetType("ave")).toBe("avenue");
    expect(canonicalStreetType("rd")).toBe("road");
    expect(canonicalStreetType("not-a-type")).toBeNull();
  });

  it("canonicalises the trailing type token of a parsed street name", () => {
    expect(canonicaliseTrailingStreetType("Chatsworth Cres")).toBe("chatsworth crescent");
    expect(canonicaliseTrailingStreetType("Chatsworth Crescent")).toBe("chatsworth crescent");
    expect(canonicaliseTrailingStreetType("Hampton Dr")).toBe("hampton drive");
    expect(canonicaliseTrailingStreetType("Marine Pde")).toBe("marine parade");
    // a trailing "st" in a parsed street name unambiguously means Street
    expect(canonicaliseTrailingStreetType("Queen St")).toBe("queen street");
    // streets without a type token are passed through unchanged
    expect(canonicaliseTrailingStreetType("The Strand")).toBe("the strand");
  });

  it("canonicalises types in free text but never expands the ambiguous bare 'st'", () => {
    expect(canonicaliseStreetTypesInText("19 chatsworth cres, pakuranga heights")).toBe(
      "19 chatsworth crescent, pakuranga heights",
    );
    // "st heliers" suburb must NOT become "street heliers"
    expect(canonicaliseStreetTypesInText("8 hampton dr, st heliers")).toBe("8 hampton drive, st heliers");
  });

  it("exposes canonical full words for type-token filtering", () => {
    expect(STREET_TYPE_WORDS.has("crescent")).toBe(true);
    expect(STREET_TYPE_WORDS.has("drive")).toBe(true);
    expect(STREET_TYPE_WORDS.has("terrace")).toBe(true);
    expect(STREET_TYPE_WORDS.has("chatsworth")).toBe(false);
  });
});
