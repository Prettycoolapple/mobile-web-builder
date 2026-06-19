import { describe, expect, it } from "vitest";

describe("phone line-type signup gate", () => {
  it("normalizes missing line type as unknown", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { normalizeLineType } = await import("../phone-line-type");
    expect(normalizeLineType(null)).toBe("unknown");
    expect(normalizeLineType("")).toBe("unknown");
    expect(normalizeLineType("mobile")).toBe("mobile");
  });

  it("blocks VoIP and other non-mobile line types with the public signup error", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { buildPhoneLineTypeBlock } = await import("../phone-line-type");
    expect(buildPhoneLineTypeBlock("nonFixedVoip")).toMatchObject({
      allowed: false,
      status: 400,
      code: "PHONE_TYPE_NOT_ALLOWED",
      lineType: "nonFixedVoip",
    });
    expect(buildPhoneLineTypeBlock("landline").message).toContain("Please use a real mobile number");
  });
});
