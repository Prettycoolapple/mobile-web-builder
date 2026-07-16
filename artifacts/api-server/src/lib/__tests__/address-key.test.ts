import { describe, it, expect } from "vitest";
import { normaliseAddressKey, normaliseDiscoveryAddressKey } from "../address-key";

describe("normaliseAddressKey", () => {
  it("collapses street-type abbreviation variants to the same key", () => {
    expect(normaliseAddressKey("12 King St")).toBe(normaliseAddressKey("12 King Street"));
    expect(normaliseAddressKey("5 Marine Pde")).toBe(normaliseAddressKey("5 Marine Parade"));
    expect(normaliseAddressKey("9 State Hwy")).toBe(normaliseAddressKey("9 State Highway"));
    expect(normaliseAddressKey("3 Oak Rd")).toBe(normaliseAddressKey("3 Oak Road"));
  });

  it("ignores postcode, country and city noise", () => {
    expect(normaliseAddressKey("12 King Street, Auckland 1010")).toBe(
      normaliseAddressKey("12 King Street"),
    );
    expect(normaliseAddressKey("12 King Street, New Zealand")).toBe(
      normaliseAddressKey("12 King Street"),
    );
  });

  it("collapses diacritics and case", () => {
    expect(normaliseAddressKey("66A Mārine Parade")).toBe(normaliseAddressKey("66a marine parade"));
  });

  it("distinguishes genuinely different addresses", () => {
    expect(normaliseAddressKey("12 King Street")).not.toBe(normaliseAddressKey("14 King Street"));
    expect(normaliseAddressKey("12 King Street")).not.toBe(normaliseAddressKey("12 Queen Street"));
  });

  it("preserves four-digit street numbers while removing a trailing postcode", () => {
    expect(normaliseAddressKey("1134 Braemar Road, Rotomā 3192, New Zealand")).toBe(
      normaliseAddressKey("1134 Braemar Rd, Rotoma"),
    );
    expect(normaliseAddressKey("1134 Braemar Road, Rotoma")).not.toBe(
      normaliseAddressKey("1140 Braemar Road, Rotoma"),
    );
    expect(normaliseAddressKey("1140 Braemar Rd, Rotoma, 3192")).toContain("1140braemarroad");
  });

  it("returns empty string for blank input", () => {
    expect(normaliseAddressKey("")).toBe("");
    expect(normaliseAddressKey(null)).toBe("");
    expect(normaliseAddressKey(undefined)).toBe("");
  });

  it("exposes the legacy discovery alias", () => {
    expect(normaliseDiscoveryAddressKey).toBe(normaliseAddressKey);
  });
});
