import { describe, expect, it } from "vitest";

describe("phone registration limits", () => {
  it("normalizes phone numbers the same way signup does", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { normalizeRegistrationPhone } = await import("../phone-registration");
    expect(normalizeRegistrationPhone("+64 21-123 (4567)")).toBe("+64211234567");
    expect(normalizeRegistrationPhone("021 123 4567")).toBe("+64211234567");
    expect(normalizeRegistrationPhone("64 21 123 4567")).toBe("+64211234567");
    expect(normalizeRegistrationPhone("+64+64 21 123 4567")).toBe("+64211234567");
  });

  it("uses the deletion cooldown ladder before permanent ban", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { deletionCooldownMs } = await import("../phone-registration");
    expect(deletionCooldownMs(1)).toBe(60 * 60 * 1000);
    expect(deletionCooldownMs(2)).toBe(24 * 60 * 60 * 1000);
    expect(deletionCooldownMs(3)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(deletionCooldownMs(4)).toBeNull();
    expect(deletionCooldownMs(5)).toBeNull();
  });

  it("blocks duplicate active accounts per role with a friendly message", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { buildPhoneRegistrationBlock } = await import("../phone-registration");
    const block = buildPhoneRegistrationBlock({
      phoneNumber: "+64211234567",
      role: "service_provider",
      existingRoleTaken: true,
    });

    expect(block).toMatchObject({
      allowed: false,
      code: "PHONE_ROLE_TAKEN",
      status: 409,
      message: "This phone number already has a service provider account.",
    });
  });

  it("blocks registration globally during cooldown", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { buildPhoneRegistrationBlock } = await import("../phone-registration");
    const now = new Date("2026-06-19T00:00:00.000Z");
    const blockedUntil = new Date("2026-06-19T01:00:00.000Z");
    const block = buildPhoneRegistrationBlock({
      phoneNumber: "+64211234567",
      role: "general",
      blockedUntil,
      now,
    });

    expect(block).toMatchObject({
      allowed: false,
      code: "PHONE_REGISTRATION_BLOCKED",
      status: 429,
      retryAfterSeconds: 3600,
      blockedUntil,
    });
  });

  it("blocks registration permanently after repeated deletions", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { buildPhoneRegistrationBlock } = await import("../phone-registration");
    const block = buildPhoneRegistrationBlock({
      phoneNumber: "+64211234567",
      role: "sales_agent",
      permanentlyBanned: true,
    });

    expect(block).toMatchObject({
      allowed: false,
      code: "PHONE_PERMANENTLY_BANNED",
      status: 429,
    });
  });
});
