import { describe, expect, it } from "vitest";

describe("auth session tokens", () => {
  it("embeds a per-login session id in new auth tokens", async () => {
    process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
    const { createSessionId, signToken, verifyToken } = await import("../auth");
    const sessionId = createSessionId();
    const token = signToken("user-1", "user@example.com", "service_provider", sessionId);
    const payload = verifyToken(token);

    expect(payload?.sub).toBe("user-1");
    expect(payload?.role).toBe("service_provider");
    expect(payload?.sid).toBe(sessionId);
  });
});
