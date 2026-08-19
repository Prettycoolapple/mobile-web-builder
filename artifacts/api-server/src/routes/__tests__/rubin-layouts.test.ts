import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dedup contract, exercised against an in-memory store that enforces the
 * same unique constraint the real table does.
 *
 * The thing worth testing here is not "does a row get written" — it is that the
 * corpus keeps *one* row per distinct geometry while attribution keeps *every*
 * generation, and that a lookup still finds a layout when the caller has
 * coordinates but the save had a parcel id. Both are invisible until the corpus
 * is either full of duplicates or a user's layout has silently disappeared.
 */

interface LayoutRow {
  id: string;
  siteKey: string;
  geoKey: string;
  fingerprint: string;
  canonical: string;
  layout: unknown;
  parcelId: string | null;
  address: string | null;
  zone: string | null;
  typology: string | null;
  intensity: string | null;
  solverVersion: string | null;
  lotCount: number | null;
  createdBy: string | null;
}

interface GenerationRow {
  layoutId: string;
  userId: string;
  source: string;
}

interface UserLayoutRow {
  userId: string;
  siteKey: string;
  geoKey: string;
  layoutId: string;
  updatedAt: Date;
}

const state = vi.hoisted(() => ({
  userId: "user-1",
  layouts: [] as LayoutRow[],
  generations: [] as GenerationRow[],
  userLayouts: [] as UserLayoutRow[],
  nextId: 1,
  /** Captured `where` predicates, since the fake builder cannot evaluate SQL. */
  filters: [] as Record<string, unknown>[],
}));

/**
 * Drizzle column references are opaque objects. The route only ever compares
 * them by identity, so a proxy that reports its own table and column name is
 * enough for the fake `eq`/`and` to reconstruct the predicate.
 */
function table(name: string): Record<string, unknown> {
  return new Proxy({ __name: name }, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      return { __table: name, __column: String(prop) };
    },
  });
}

const rubinLayouts = table("rubinLayouts");
const rubinLayoutGenerations = table("rubinLayoutGenerations");
const rubinUserLayouts = table("rubinUserLayouts");

function tableName(t: unknown): string {
  return String((t as { __name?: string }).__name);
}

type Predicate = { column: string; value: unknown }[];

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown): Predicate => [
    { column: (column as { __column: string }).__column, value },
  ],
  and: (...parts: Predicate[]): Predicate => parts.flat(),
  desc: (column: unknown) => column,
}));

function matches(row: Record<string, unknown>, predicate: Predicate): boolean {
  return predicate.every((clause) => row[clause.column] === clause.value);
}

vi.mock("@workspace/db", () => {
  const selectBuilder = () => {
    let source = "";
    let predicate: Predicate = [];
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        source = tableName(t);
        return chain;
      },
      innerJoin() {
        return chain;
      },
      where(p: Predicate) {
        predicate = p ?? [];
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return Promise.resolve(rows());
      },
      then(resolve: (v: unknown[]) => void, reject: (e?: unknown) => void) {
        return Promise.resolve(rows()).then(resolve, reject);
      },
    };

    function rows(): unknown[] {
      if (source === "rubinLayouts") {
        return state.layouts.filter((row) => matches(row as unknown as Record<string, unknown>, predicate));
      }
      if (source === "rubinUserLayouts") {
        // The route selects across the join, so return the flattened shape it
        // reads: user-layout columns plus the joined layout's.
        return state.userLayouts
          .filter((row) => matches(row as unknown as Record<string, unknown>, predicate))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map((row) => {
            const layout = state.layouts.find((l) => l.id === row.layoutId)!;
            return {
              updatedAt: row.updatedAt,
              lotCount: layout.lotCount,
              intensity: layout.intensity,
              typology: layout.typology,
              solverVersion: layout.solverVersion,
              layoutId: layout.id,
              layout: layout.layout,
            };
          });
      }
      return [];
    }

    return chain;
  };

  const insert = (t: unknown) => ({
    values(values: Record<string, unknown>) {
      const name = tableName(t);
      let conflicted = false;

      const builder = {
        onConflictDoNothing() {
          if (name === "rubinLayouts") {
            conflicted = state.layouts.some(
              (row) => row.siteKey === values.siteKey && row.fingerprint === values.fingerprint,
            );
          }
          return builder;
        },
        onConflictDoUpdate({ set }: { set: Record<string, unknown> }) {
          if (name === "rubinUserLayouts") {
            const existing = state.userLayouts.find(
              (row) => row.userId === values.userId && row.siteKey === values.siteKey,
            );
            if (existing) {
              Object.assign(existing, set);
              conflicted = true;
            }
          }
          return builder;
        },
        returning() {
          return Promise.resolve(commit());
        },
        then(resolve: (v: unknown[]) => void, reject: (e?: unknown) => void) {
          return Promise.resolve(commit()).then(resolve, reject);
        },
      };

      function commit(): unknown[] {
        if (conflicted) return [];
        if (name === "rubinLayouts") {
          const row = { id: `layout-${state.nextId++}`, ...values } as unknown as LayoutRow;
          state.layouts.push(row);
          return [{ id: row.id }];
        }
        if (name === "rubinLayoutGenerations") {
          state.generations.push(values as unknown as GenerationRow);
          return [];
        }
        if (name === "rubinUserLayouts") {
          state.userLayouts.push(values as unknown as UserLayoutRow);
          return [];
        }
        return [];
      }

      return builder;
    },
  });

  const db = {
    select: () => selectBuilder(),
    insert,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select: () => selectBuilder(), insert }),
  };

  return { db, rubinLayouts, rubinLayoutGenerations, rubinUserLayouts };
});

const authed = vi.hoisted(() => ({ value: true }));

vi.mock("../../lib/auth", () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authed.value) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as unknown as { userId: string }).userId = state.userId;
    next();
  },
  // Signed out is a valid caller on the guest-accessible routes: no `userId` is
  // attached and the handler decides what an anonymous caller may do.
  optionalAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (authed.value) {
      (req as unknown as { userId: string }).userId = state.userId;
    }
    next();
  },
}));

/**
 * The velocity middlewares are pass-throughs here — they are durable, DB-backed
 * and separately tested. `hitRateLimit` is *not* stubbed out, though: the
 * per-hour generation allowance is the behaviour under test, so it gets a fake
 * that counts exactly like the real fixed-window one.
 */
const quota = vi.hoisted(() => ({ counts: new Map<string, number>() }));

vi.mock("../../lib/rateLimit", () => ({
  ipRateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  userRateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  minutes: (n: number) => n * 60_000,
  hours: (n: number) => n * 3_600_000,
  hitRateLimit: async (key: string, max: number) => {
    const count = (quota.counts.get(key) ?? 0) + 1;
    quota.counts.set(key, count);
    return { allowed: count <= max, count, retryAfterSeconds: count > max ? 1200 : 0 };
  },
}));

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const router = (await import("../rubin-layouts")).default;
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: () => {}, warn: () => {} };
    next();
  });
  app.use(router);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server port");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const SITE = { parcelId: "P-123", address: "14 Lawndale Place", zone: "MHS", lat: -36.8645, lng: 174.8484 };
const CANONICAL = '[{"kind":"lot","lotId":"Lot 1","ring":[[1764760,5918598],[1764780,5918598],[1764780,5918618],[1764760,5918598]]}]';

function savePayload(overrides: Record<string, unknown> = {}) {
  return {
    site: SITE,
    canonical: CANONICAL,
    layout: { version: 1, crs: "EPSG:2193", elements: [] },
    meta: { typology: "standalone", intensity: "low", solverVersion: "1.0.0", lotCount: 2 },
    ...overrides,
  };
}

const post = (baseUrl: string, body: unknown) =>
  fetch(`${baseUrl}/rubin-layouts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  state.userId = "user-1";
  state.layouts = [];
  state.generations = [];
  state.userLayouts = [];
  state.nextId = 1;
  authed.value = true;
  quota.counts.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe("POST /rubin-layouts", () => {
  it("stores one layout per distinct geometry and a generation row per run", async () => {
    await withServer(async (baseUrl) => {
      const first = await post(baseUrl, savePayload());
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ ok: true, deduped: false });

      // A different user arriving at the same arrangement is the expected case.
      state.userId = "user-2";
      const second = await post(baseUrl, savePayload());
      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody).toMatchObject({ ok: true, deduped: true });
      expect(secondBody.layoutId).toBe(state.layouts[0].id);

      expect(state.layouts).toHaveLength(1);
      expect(state.generations).toHaveLength(2);
      expect(state.generations.map((row) => row.userId)).toEqual(["user-1", "user-2"]);
    });
  });

  it("keeps a genuinely different layout as its own corpus row", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      await post(baseUrl, savePayload({ canonical: `${CANONICAL} ` }));
      expect(state.layouts).toHaveLength(2);
    });
  });

  it("computes the fingerprint itself rather than trusting the client", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload({ fingerprint: "0".repeat(64) }));
      expect(state.layouts[0].fingerprint).not.toBe("0".repeat(64));
      expect(state.layouts[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("keys on the parcel when there is one, and always records the geo key", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      expect(state.layouts[0].siteKey).toBe("parcel:P-123");
      expect(state.layouts[0].geoKey).toBe("-36.8645:174.8484");
    });
  });

  it("falls back to the geo key when the cadastral lookup found nothing", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload({ site: { ...SITE, parcelId: null } }));
      expect(state.layouts[0].siteKey).toBe("-36.8645:174.8484");
    });
  });

  it("overwrites the user's current layout instead of accumulating rows", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      await post(baseUrl, savePayload({ canonical: `${CANONICAL} ` }));
      expect(state.userLayouts).toHaveLength(1);
      expect(state.userLayouts[0].layoutId).toBe(state.layouts[1].id);
    });
  });

  it("rejects a save with no coordinates", async () => {
    await withServer(async (baseUrl) => {
      const res = await post(baseUrl, savePayload({ site: { parcelId: "P-123" } }));
      expect(res.status).toBe(400);
      expect(state.layouts).toHaveLength(0);
    });
  });

  it("rejects a layout larger than the cap", async () => {
    await withServer(async (baseUrl) => {
      const res = await post(baseUrl, savePayload({ canonical: "x".repeat(1_000_001) }));
      expect(res.status).toBe(413);
    });
  });

  // AI Subdivision is open to guests, and a layout is worth the same to the
  // corpus whoever produced it. The per-account rows are the part they miss.
  it("keeps a guest's layout in the corpus but writes no per-account rows", async () => {
    authed.value = false;
    await withServer(async (baseUrl) => {
      const res = await post(baseUrl, savePayload());
      expect(res.status).toBe(200);
      expect(state.layouts).toHaveLength(1);
      expect(state.layouts[0]?.createdBy ?? null).toBeNull();
      expect(state.generations).toHaveLength(0);
      expect(state.userLayouts).toHaveLength(0);
    });
  });
});

describe("POST /rubin-layouts/quota", () => {
  const claim = (baseUrl: string) =>
    fetch(`${baseUrl}/rubin-layouts/quota`, { method: "POST" });

  it("allows five generations an hour and refuses the sixth", async () => {
    await withServer(async (baseUrl) => {
      for (let i = 1; i <= 5; i += 1) {
        const body = await (await claim(baseUrl)).json();
        expect(body).toMatchObject({ allowed: true, limit: 5, used: i, remaining: 5 - i });
      }
      const sixth = await claim(baseUrl);
      // A refusal is a normal answer about the allowance, not a transport
      // error — a 429 here would be indistinguishable from the velocity limiter.
      expect(sixth.status).toBe(200);
      const body = await sixth.json();
      expect(body.allowed).toBe(false);
      expect(body.remaining).toBe(0);
      expect(body.resetInSeconds).toBeGreaterThan(0);
      expect(body.resetInSeconds).toBeLessThanOrEqual(3600);
    });
  });

  it("counts each user separately", async () => {
    await withServer(async (baseUrl) => {
      for (let i = 0; i < 5; i += 1) await claim(baseUrl);
      expect((await (await claim(baseUrl)).json()).allowed).toBe(false);

      state.userId = "user-2";
      expect((await (await claim(baseUrl)).json())).toMatchObject({ allowed: true, remaining: 4 });
    });
  });

  // The client treats a failed allowance check as "allowed" so a blip cannot
  // break the feature. That makes refusing guests here actively harmful: it
  // would hand every one of them unlimited solver time. They get metered on
  // their install hash instead, in the same 5/hour window as an account.
  it("meters a guest on their install id", async () => {
    authed.value = false;
    await withServer(async (baseUrl) => {
      const guestClaim = () =>
        fetch(`${baseUrl}/rubin-layouts/quota`, {
          method: "POST",
          headers: { "x-anonymous-install-id": "install-abc" },
        });

      for (let i = 1; i <= 5; i += 1) {
        expect(await (await guestClaim()).json()).toMatchObject({ allowed: true, used: i });
      }
      expect((await (await guestClaim()).json()).allowed).toBe(false);

      // A different install is a different guest, not the same bucket.
      const other = await fetch(`${baseUrl}/rubin-layouts/quota`, {
        method: "POST",
        headers: { "x-anonymous-install-id": "install-xyz" },
      });
      expect((await other.json())).toMatchObject({ allowed: true, remaining: 4 });
    });
  });

  it("refuses a caller with no identity at all", async () => {
    authed.value = false;
    await withServer(async (baseUrl) => {
      // No token and no install header: nothing to meter against, so this must
      // not fall through to an uncounted generation.
      expect((await claim(baseUrl)).status).toBe(401);
      expect(quota.counts.size).toBe(0);
    });
  });
});

describe("GET /rubin-layouts/latest", () => {
  const latest = (baseUrl: string, query: string) =>
    fetch(`${baseUrl}/rubin-layouts/latest?${query}`);

  it("returns the caller's layout for a site, keyed by parcel", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      const res = await latest(baseUrl, `lat=${SITE.lat}&lng=${SITE.lng}&parcelId=P-123`);
      const body = await res.json();
      expect(body).toMatchObject({ exists: true, lotCount: 2, intensity: "low" });
      expect(body.layout).toBeDefined();
    });
  });

  it("finds a parcel-keyed layout from coordinates alone", async () => {
    // The app asks before its own site load has resolved a parcel id.
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      const res = await latest(baseUrl, `lat=${SITE.lat}&lng=${SITE.lng}`);
      expect(await res.json()).toMatchObject({ exists: true });
    });
  });

  it("omits the geometry in summary form", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      const res = await latest(baseUrl, `lat=${SITE.lat}&lng=${SITE.lng}&parcelId=P-123&summary=1`);
      const body = await res.json();
      expect(body).toMatchObject({ exists: true, lotCount: 2 });
      expect(body.layout).toBeUndefined();
    });
  });

  it("does not return another user's layout", async () => {
    await withServer(async (baseUrl) => {
      await post(baseUrl, savePayload());
      state.userId = "someone-else";
      const res = await latest(baseUrl, `lat=${SITE.lat}&lng=${SITE.lng}&parcelId=P-123`);
      expect(await res.json()).toEqual({ exists: false });
    });
  });

  it("reports no layout for an untouched site", async () => {
    await withServer(async (baseUrl) => {
      const res = await latest(baseUrl, "lat=-36.9&lng=174.9");
      expect(await res.json()).toEqual({ exists: false });
    });
  });

  it("rejects a lookup with no coordinates", async () => {
    await withServer(async (baseUrl) => {
      const res = await latest(baseUrl, "parcelId=P-123");
      expect(res.status).toBe(400);
    });
  });

  // Guests keep no per-account current layout, so "nothing to restore" is the
  // honest answer — and it has to arrive in the same shape a miss uses, or the
  // Rubin screen's restore fetch takes an error path on every guest open.
  it("reports no layout for a guest rather than refusing the lookup", async () => {
    authed.value = false;
    await withServer(async (baseUrl) => {
      const res = await latest(baseUrl, `lat=${SITE.lat}&lng=${SITE.lng}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ exists: false });
    });
  });
});
