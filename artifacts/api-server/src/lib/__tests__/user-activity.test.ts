import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const profiles = { id: "profiles.id" };
  return { profiles, set, update, where };
});

vi.mock("@workspace/db", () => ({
  db: { update: mocks.update },
  profiles: mocks.profiles,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("user activity", () => {
  beforeEach(() => {
    mocks.update.mockClear();
    mocks.set.mockClear();
    mocks.where.mockReset().mockResolvedValue(undefined);
  });

  it("updates the profile last active timestamp", async () => {
    const { touchUserLastActive } = await import("../user-activity");
    const now = new Date("2026-06-21T01:02:03.000Z");

    await expect(touchUserLastActive("user-1", now)).resolves.toBe(now);

    expect(mocks.update).toHaveBeenCalledWith(mocks.profiles);
    expect(mocks.set).toHaveBeenCalledWith({ lastLoginAt: now });
    expect(mocks.where).toHaveBeenCalledWith({ left: "profiles.id", right: "user-1" });
  });

  it("logs background update failures without throwing", async () => {
    const { noteUserActivity } = await import("../user-activity");
    const error = new Error("database unavailable");
    const log = { warn: vi.fn() };
    mocks.where.mockRejectedValueOnce(error);

    expect(() => noteUserActivity("user-2", log as any)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log.warn).toHaveBeenCalledWith(
      { error, userId: "user-2" },
      "Failed to update user last activity",
    );
  });
});
