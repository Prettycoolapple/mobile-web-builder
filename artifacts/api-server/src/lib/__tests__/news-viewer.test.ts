import { beforeEach, describe, expect, it, vi } from "vitest";

const poolMocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: poolMocks }));

import { canAccessNewsSql, canPermanentlyDeleteNewsPost, lockActiveGuestNewsViewer, mergeGuestNewsActivity } from "../news-viewer";

describe("guest news identity", () => {
  beforeEach(() => { poolMocks.connect.mockReset(); poolMocks.query.mockReset(); });

  it("merges engagement, sessions, unread state, and push ownership under one lock", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        statements.push(text.replace(/\s+/g, " ").trim());
        if (text.includes("returning claimed_by_user_id")) return { rows: [{ claimed_by_user_id: null }] };
        return { rows: [] };
      }),
    };

    await mergeGuestNewsActivity(client as never, "ng_1234567890_abcdefgh", "a".repeat(64), "user-1");

    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements.some((sql) => sql.includes("insert into news_post_engagements"))).toBe(true);
    expect(statements.some((sql) => sql.includes("update news_post_read_sessions"))).toBe(true);
    expect(statements.some((sql) => sql.includes("greatest(news_viewer_states.last_seen_sequence"))).toBe(true);
    expect(statements.some((sql) => sql.includes("update push_tokens set user_id"))).toBe(true);
    expect(statements.at(-1)).toContain("update news_guest_sessions set claimed_by_user_id");
  });

  it("refuses to merge a guest session claimed by another account", async () => {
    const client = {
      query: vi.fn(async (text: string) => text.includes("returning claimed_by_user_id")
        ? { rows: [{ claimed_by_user_id: "other-user" }] }
        : { rows: [] }),
    };
    await expect(mergeGuestNewsActivity(client as never, "ng_1234567890_abcdefgh", "b".repeat(64), "user-1"))
      .rejects.toThrow("already been claimed");
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it("serializes guest writes against sign-in merging", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        statements.push(text.replace(/\s+/g, " ").trim());
        return text.includes("select 1 from news_guest_sessions") ? { rows: [{ exists: 1 }] } : { rows: [] };
      }),
    };
    await lockActiveGuestNewsViewer(client as never, {
      key: "guest:ng_1234567890_abcdefgh",
      userId: null,
      guestSessionId: "ng_1234567890_abcdefgh",
      installationHash: "c".repeat(64),
      isAdmin: false,
    });
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[1]).toContain("claimed_by_user_id is null");
    expect(statements[1]).toContain("for update");
  });

  it("keeps guest access limited to Everyone posts in the SQL policy", () => {
    const policy = canAccessNewsSql("article");
    expect(policy).toContain("article.audience='everyone'");
    expect(policy).toContain("news_post_recipients");
    expect(policy).not.toContain("paid_general");
    const firstParameterPolicy = canAccessNewsSql("article", 1);
    expect(firstParameterPolicy).toContain("$1::boolean");
    expect(firstParameterPolicy).toContain("$2::text");
    expect(firstParameterPolicy).toContain("$3::text");
  });

  it("allows deleting drafts and specific-user tests but protects sent bulk posts", () => {
    expect(canPermanentlyDeleteNewsPost("draft", "everyone")).toBe(true);
    expect(canPermanentlyDeleteNewsPost("sent", "specific_user")).toBe(true);
    expect(canPermanentlyDeleteNewsPost("sent", "everyone")).toBe(false);
    expect(canPermanentlyDeleteNewsPost("archived", "paid_general")).toBe(false);
  });
});
