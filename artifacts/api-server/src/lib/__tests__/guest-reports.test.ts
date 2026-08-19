import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  /** Queue of counts returned by successive select() chains, in call order. */
  counts: [] as number[],
  selectCalls: 0,
  inserted: [] as Array<Record<string, unknown>>,
  failSelect: false,
}));

vi.mock("@workspace/db", () => ({
  withDbRetry: <T>(fn: () => Promise<T> | T) => fn(),
  anonymousUsageEvents: {
    installHash: { name: "install_hash" },
    ipHash: { name: "ip_hash" },
    eventType: { name: "event_type" },
    createdAt: { name: "created_at" },
  },
  db: {
    select: () => {
      if (dbMocks.failSelect) throw new Error("db down");
      const total = dbMocks.counts[dbMocks.selectCalls] ?? 0;
      dbMocks.selectCalls += 1;
      return { from: () => ({ where: async () => [{ total }] }) };
    },
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        dbMocks.inserted.push(row);
      },
    }),
  },
}));

import {
  GUEST_REPORT_EVENT_TYPE,
  checkGuestReportQuota,
  guestIdentityFromHashes,
  guestIdentityFromRequest,
  guestMonthlyReportLimit,
  recordGuestReport,
} from "../guest-reports";

const INSTALL = "install-hash";
const IP = "ip-hash";

beforeEach(() => {
  dbMocks.counts = [];
  dbMocks.selectCalls = 0;
  dbMocks.inserted = [];
  dbMocks.failSelect = false;
});

afterEach(() => {
  delete process.env.GUEST_REPORT_MONTHLY_LIMIT;
  delete process.env.GUEST_REPORT_MONTHLY_IP_LIMIT;
});

describe("guest report allowance", () => {
  it("defaults to five reports and lets every one of them through", async () => {
    expect(guestMonthlyReportLimit()).toBe(5);
    for (let used = 0; used < 5; used++) {
      dbMocks.counts = [used, 0];
      dbMocks.selectCalls = 0;
      const quota = await checkGuestReportQuota({ installHash: INSTALL, ipHash: IP });
      expect(quota).toMatchObject({ allowed: true, used, limit: 5 });
    }
  });

  it("refuses the sixth report so the client can prompt for registration", async () => {
    dbMocks.counts = [5, 0];
    const quota = await checkGuestReportQuota({ installHash: INSTALL, ipHash: IP });
    expect(quota).toEqual({ allowed: false, used: 5, limit: 5, reason: "install" });
  });

  it("honours GUEST_REPORT_MONTHLY_LIMIT", async () => {
    process.env.GUEST_REPORT_MONTHLY_LIMIT = "2";
    dbMocks.counts = [2, 0];
    const quota = await checkGuestReportQuota({ installHash: INSTALL, ipHash: IP });
    expect(quota).toMatchObject({ allowed: false, limit: 2, reason: "install" });
  });

  it("stops a rotated install id from farming reports off one IP", async () => {
    // Fresh install id (0 used) but the IP is already at its looser ceiling.
    dbMocks.counts = [0, 20];
    const quota = await checkGuestReportQuota({ installHash: "brand-new-install", ipHash: IP });
    expect(quota).toMatchObject({ allowed: false, reason: "ip" });
  });

  it("does not double-count when the IP hash is the identity", async () => {
    dbMocks.counts = [1];
    const quota = await checkGuestReportQuota({ installHash: IP, ipHash: IP });
    expect(quota).toMatchObject({ allowed: true, used: 1 });
    expect(dbMocks.selectCalls).toBe(1);
  });

  it("fails open when the database is unreachable", async () => {
    dbMocks.failSelect = true;
    const quota = await checkGuestReportQuota({ installHash: INSTALL, ipHash: IP });
    expect(quota).toMatchObject({ allowed: true, used: 0, limit: 5 });
  });

  it("does not meter a request with no identity at all", async () => {
    const quota = await checkGuestReportQuota(null);
    expect(quota.allowed).toBe(true);
    expect(dbMocks.selectCalls).toBe(0);
  });
});

describe("recording a generated guest report", () => {
  it("writes one event under its own event type", async () => {
    await recordGuestReport({ installHash: INSTALL, ipHash: IP });
    expect(dbMocks.inserted).toEqual([
      { installHash: INSTALL, ipHash: IP, eventType: GUEST_REPORT_EVENT_TYPE },
    ]);
    // Must not share the browse/discovery bucket, which has its own daily cap.
    expect(GUEST_REPORT_EVENT_TYPE).not.toBe("chat");
  });

  it("writes nothing for a signed-in caller", async () => {
    await recordGuestReport(null);
    expect(dbMocks.inserted).toEqual([]);
  });
});

describe("resolving who a guest request belongs to", () => {
  it("prefers the install id and keeps the IP as the secondary key", () => {
    const identity = guestIdentityFromRequest({
      ip: "203.0.113.7",
      headers: { "x-anonymous-install-id": "device-1" },
    });
    expect(identity?.installHash).toHaveLength(64);
    expect(identity?.ipHash).toHaveLength(64);
    expect(identity?.installHash).not.toBe(identity?.ipHash);
  });

  it("falls back to the IP when the client sends no install id", () => {
    const identity = guestIdentityFromRequest({ ip: "203.0.113.7", headers: {} });
    expect(identity?.installHash).toBe(identity?.ipHash);
  });

  it("returns null when there is nothing to meter against", () => {
    expect(guestIdentityFromRequest({ headers: {} })).toBeNull();
    expect(guestIdentityFromHashes(null, null)).toBeNull();
  });

  it("accepts hashes a caller already resolved", () => {
    expect(guestIdentityFromHashes(INSTALL, IP)).toEqual({ installHash: INSTALL, ipHash: IP });
    expect(guestIdentityFromHashes(null, IP)).toEqual({ installHash: IP, ipHash: IP });
  });
});
