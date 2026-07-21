import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";

const state = vi.hoisted(() => ({
  userId: "viewer",
  profileQueue: [] as Array<Record<string, unknown> | null>,
  recommendationExists: false,
  recommendationCount: 0,
  providerRecommendationCount: 0,
  salesAgentProfile: null as Record<string, unknown> | null,
  hasDmThread: false,
  dmThread: null as Record<string, unknown> | null,
  dmMessage: null as Record<string, unknown> | null,
  insertedMessage: null as Record<string, unknown> | null,
  lastRecommendationAction: null as "insert" | "delete" | null,
}));

const sendPushToUserMock = vi.hoisted(() => vi.fn());
const getUnreadAppBadgeCountMock = vi.hoisted(() => vi.fn(async () => 1));

function table(name: string): Record<string, unknown> {
  return new Proxy({ __name: name }, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      return { table: name, column: String(prop) };
    },
  });
}

const profiles = table("profiles");
const salesAgentProfiles = table("salesAgentProfiles");
const serviceProviderProfiles = table("serviceProviderProfiles");
const recommendations = table("recommendations");
const dmThreads = table("dmThreads");
const dmMessages = table("dmMessages");
const pushTokens = table("pushTokens");
const userBlocks = table("userBlocks");
const userReports = table("userReports");

function tableName(t: unknown): string {
  return String((t as { __name?: string }).__name);
}

function selectedKeys(selection: unknown): string[] {
  return Object.keys((selection as Record<string, unknown>) ?? {});
}

function resolveSelect(t: unknown, selection: unknown): unknown[] {
  const name = tableName(t);
  const keys = selectedKeys(selection);

  if (name === "profiles") {
    const next = state.profileQueue.shift();
    return next ? [next] : [];
  }

  if (name === "recommendations") {
    if (keys.includes("count")) {
      return [{ count: state.recommendationCount }];
    }
    return state.recommendationExists ? [{ id: "recommendation-1" }] : [];
  }

  if (name === "salesAgentProfiles") {
    return state.salesAgentProfile ? [state.salesAgentProfile] : [];
  }

  if (name === "dmThreads") {
    if (keys.length === 1 && keys[0] === "id") {
      return state.hasDmThread ? [{ id: "thread-1" }] : [];
    }
    return state.dmThread ? [state.dmThread] : [];
  }

  if (name === "dmMessages") {
    return state.dmMessage ? [state.dmMessage] : [];
  }

  if (name === "userBlocks") return [];
  return [];
}

function selectChain(selection?: unknown) {
  let fromTable: unknown;
  const chain = {
    from(t: unknown) {
      fromTable = t;
      return chain;
    },
    leftJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return Promise.resolve(resolveSelect(fromTable, selection));
    },
    then(resolve: (value: unknown[]) => void, reject: (reason?: unknown) => void) {
      return Promise.resolve(resolveSelect(fromTable, selection)).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: (selection?: unknown) => selectChain(selection),
    insert: (t: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (tableName(t) === "recommendations") {
          state.recommendationExists = true;
          state.recommendationCount += 1;
          state.lastRecommendationAction = "insert";
        }
        if (tableName(t) === "dmMessages") {
          state.insertedMessage = {
            id: "message-1",
            createdAt: new Date("2026-06-18T00:00:00.000Z"),
            readAt: null,
            ...values,
          };
        }
        return {
          returning: () => Promise.resolve(state.insertedMessage ? [state.insertedMessage] : []),
        };
      },
    }),
    delete: (t: unknown) => ({
      where: () => {
        if (tableName(t) === "recommendations") {
          state.recommendationExists = false;
          state.recommendationCount = Math.max(0, state.recommendationCount - 1);
          state.lastRecommendationAction = "delete";
        }
        return Promise.resolve([]);
      },
    }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            if (tableName(t) === "serviceProviderProfiles") {
              state.providerRecommendationCount = state.lastRecommendationAction === "insert"
                ? state.providerRecommendationCount + 1
                : Math.max(0, state.providerRecommendationCount - 1);
              return Promise.resolve([{ recommendationCount: state.providerRecommendationCount }]);
            }
            if (tableName(t) === "dmMessages") {
              state.dmMessage = {
                ...(state.dmMessage ?? { id: "message-1" }),
                ...values,
              };
              return Promise.resolve([state.dmMessage]);
            }
            return Promise.resolve([]);
          },
          then: (resolve: (value: unknown[]) => void, reject: (reason?: unknown) => void) =>
            Promise.resolve([]).then(resolve, reject),
        }),
      }),
    }),
  },
  profiles,
  salesAgentProfiles,
  serviceProviderProfiles,
  recommendations,
  dmThreads,
  dmMessages,
  pushTokens,
  userBlocks,
  userReports,
}));

vi.mock("../../lib/auth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { userId: string }).userId = state.userId;
    next();
  },
}));

vi.mock("../../lib/socket", () => ({ getIo: () => null }));
vi.mock("../../lib/expo-push", () => ({
  getUnreadAppBadgeCount: getUnreadAppBadgeCountMock,
  sendPushToUser: sendPushToUserMock,
}));
vi.mock("../../lib/mailer", () => ({ sendOwnerNotification: vi.fn() }));

async function withServer(routerPath: "../users" | "../dm", run: (baseUrl: string) => Promise<void>) {
  const router = (await import(routerPath)).default;
  const app = express();
  app.use(express.json());
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

beforeEach(() => {
  state.userId = "viewer";
  state.profileQueue = [];
  state.recommendationExists = false;
  state.recommendationCount = 0;
  state.providerRecommendationCount = 0;
  state.salesAgentProfile = null;
  state.hasDmThread = false;
  state.dmThread = null;
  state.dmMessage = null;
  state.insertedMessage = null;
  state.lastRecommendationAction = null;
  getUnreadAppBadgeCountMock.mockClear();
  getUnreadAppBadgeCountMock.mockResolvedValue(1);
  sendPushToUserMock.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

describe("public profile recommendation and contact UX", () => {
  it("returns the live recommendation row count for general users", async () => {
    state.profileQueue = [{ id: "general-1", role: "general" }];
    state.recommendationCount = 3;

    await withServer("../users", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/users/general-1/recommend`, { method: "POST" });
      expect(resp.status).toBe(200);
      await expect(resp.json()).resolves.toEqual({
        hasRecommended: true,
        recommendationCount: 4,
      });
    });
  });

  it("keeps service provider denormalized recommendation counts working", async () => {
    state.profileQueue = [{ id: "provider-1", role: "service_provider" }];
    state.providerRecommendationCount = 8;

    await withServer("../users", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/users/provider-1/recommend`, { method: "POST" });
      expect(resp.status).toBe(200);
      await expect(resp.json()).resolves.toEqual({
        hasRecommended: true,
        recommendationCount: 9,
      });
    });
  });

  it("only exposes a general user's call number when a DM relationship exists", async () => {
    state.profileQueue = [{
      id: "general-1",
      fullName: "General User",
      role: "general",
      avatarUrl: null,
      isVerified: false,
      phoneNumber: "+6421000000",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    state.hasDmThread = true;

    await withServer("../users", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/users/general-1`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { roleData?: { contactNumber?: string } };
      expect(body.roleData?.contactNumber).toBe("+6421000000");
    });
  });

  it("does not expose a general user's call number without a DM relationship", async () => {
    state.profileQueue = [{
      id: "general-1",
      fullName: "General User",
      role: "general",
      avatarUrl: null,
      isVerified: false,
      phoneNumber: "+6421000000",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    state.hasDmThread = false;

    await withServer("../users", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/users/general-1`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { roleData?: { contactNumber?: string } | null };
      expect(body.roleData?.contactNumber).toBeUndefined();
    });
  });

  it("exposes a sales agent's call number to an existing DM participant", async () => {
    state.userId = "general-1";
    state.profileQueue = [{
      id: "agent-1",
      fullName: "Sales Agent",
      role: "sales_agent",
      avatarUrl: null,
      isVerified: true,
      phoneNumber: "+64211112222",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    state.salesAgentProfile = { userId: "agent-1", agencyName: "Alpha Realty" };
    state.hasDmThread = true;

    await withServer("../users", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/users/agent-1`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { roleData?: { contactNumber?: string } };
      expect(body.roleData?.contactNumber).toBe("+64211112222");
    });
  });

  it("does not expose a sales agent's call number without a DM relationship", async () => {
    state.userId = "general-1";
    state.profileQueue = [{
      id: "agent-1",
      fullName: "Sales Agent",
      role: "sales_agent",
      avatarUrl: null,
      isVerified: true,
      phoneNumber: "+64211112222",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    }];
    state.salesAgentProfile = { userId: "agent-1", agencyName: "Alpha Realty" };
    state.hasDmThread = false;

    await withServer("../users", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/users/agent-1`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { roleData?: { contactNumber?: string } };
      expect(body.roleData?.contactNumber).toBeUndefined();
    });
  });
});

describe("DM push direction", () => {
  it("pushes general-user messages to the service provider recipient", async () => {
    state.userId = "general-1";
    state.dmThread = { id: "thread-1", participantA: "general-1", participantB: "provider-1" };
    state.profileQueue = [{ fullName: "General User" }];

    await withServer("../dm", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/dm/threads/thread-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Hello" }),
      });
      expect(resp.status).toBe(201);
    });

    expect(sendPushToUserMock).toHaveBeenCalledWith("provider-1", "General User", "Hello", {
      type: "dm",
      threadId: "thread-1",
    }, {
      badgeCount: 1,
    });
  });

  it("pushes service-provider messages to the general user recipient", async () => {
    state.userId = "provider-1";
    state.dmThread = { id: "thread-1", participantA: "general-1", participantB: "provider-1" };
    state.profileQueue = [{ fullName: "Provider User" }];

    await withServer("../dm", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/dm/threads/thread-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Hi back" }),
      });
      expect(resp.status).toBe(201);
    });

    expect(sendPushToUserMock).toHaveBeenCalledWith("general-1", "Provider User", "Hi back", {
      type: "dm",
      threadId: "thread-1",
    }, {
      badgeCount: 1,
    });
  });

  it("pushes a notification to the other participant when a message is liked", async () => {
    state.userId = "provider-1";
    state.dmThread = { id: "thread-1", participantA: "general-1", participantB: "provider-1" };
    state.dmMessage = {
      id: "message-1",
      threadId: "thread-1",
      senderId: "general-1",
      body: "Can you review this?",
      likedAt: null,
      likedBy: null,
    };
    state.profileQueue = [{ fullName: "Provider User" }];

    await withServer("../dm", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/dm/threads/thread-1/messages/message-1/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liked: true }),
      });
      expect(resp.status).toBe(200);
    });

    expect(sendPushToUserMock).toHaveBeenCalledWith("general-1", "Provider User", "Liked a message", {
      type: "dm_like",
      threadId: "thread-1",
      messageId: "message-1",
    }, {
      badgeCount: 1,
    });
  });

  it("allows only the like owner to remove a like", async () => {
    state.userId = "provider-1";
    state.dmThread = { id: "thread-1", participantA: "general-1", participantB: "provider-1" };
    state.dmMessage = {
      id: "message-1",
      threadId: "thread-1",
      senderId: "general-1",
      likedAt: new Date("2026-07-01T00:00:00.000Z"),
      likedBy: "provider-1",
    };

    await withServer("../dm", async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/dm/threads/thread-1/messages/message-1/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liked: false }),
      });
      expect(resp.status).toBe(200);
    });

    expect(state.dmMessage?.likedAt).toBeNull();
    expect(state.dmMessage?.likedBy).toBeNull();
  });

  it("rejects removing or replacing the other participant's like", async () => {
    state.userId = "provider-1";
    state.dmThread = { id: "thread-1", participantA: "general-1", participantB: "provider-1" };
    state.dmMessage = {
      id: "message-1",
      threadId: "thread-1",
      senderId: "provider-1",
      likedAt: new Date("2026-07-01T00:00:00.000Z"),
      likedBy: "general-1",
    };

    await withServer("../dm", async (baseUrl) => {
      for (const liked of [false, true]) {
        const resp = await fetch(`${baseUrl}/dm/threads/thread-1/messages/message-1/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ liked }),
        });
        expect(resp.status).toBe(409);
      }
    });

    expect(state.dmMessage?.likedBy).toBe("general-1");
  });
});

describe("DM file-open receipts", () => {
  it("records the first recipient file open", async () => {
    state.userId = "general-1";
    state.dmThread = {
      id: "thread-1",
      participantA: "general-1",
      participantB: "agent-1",
    };
    state.dmMessage = {
      id: "message-1",
      threadId: "thread-1",
      senderId: "agent-1",
      fileUrl: "/api/storage/lim.pdf",
      fileViewedAt: null,
    };

    await withServer("../dm", async (baseUrl) => {
      const resp = await fetch(
        `${baseUrl}/dm/threads/thread-1/messages/message-1/file-viewed`,
        { method: "POST" },
      );
      expect(resp.status).toBe(200);
      await expect(resp.json()).resolves.toEqual({ ok: true });
    });

    expect(state.dmMessage?.fileViewedAt).toBeInstanceOf(Date);
  });

  it("does not count the sender opening their own file", async () => {
    state.userId = "agent-1";
    state.dmThread = {
      id: "thread-1",
      participantA: "general-1",
      participantB: "agent-1",
    };
    state.dmMessage = {
      id: "message-1",
      threadId: "thread-1",
      senderId: "agent-1",
      fileUrl: "/api/storage/lim.pdf",
      fileViewedAt: null,
    };

    await withServer("../dm", async (baseUrl) => {
      const resp = await fetch(
        `${baseUrl}/dm/threads/thread-1/messages/message-1/file-viewed`,
        { method: "POST" },
      );
      expect(resp.status).toBe(200);
    });

    expect(state.dmMessage?.fileViewedAt).toBeNull();
  });
});
