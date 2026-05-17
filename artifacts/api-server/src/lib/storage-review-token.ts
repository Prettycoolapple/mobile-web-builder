import crypto from "node:crypto";

type ReviewTokenPayload = {
  path: string;
  exp: number;
};

function secret(): string {
  return (
    process.env.FILE_REVIEW_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "devfeasible-dev-secret-change-in-prod"
  );
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createStorageReviewToken(objectPath: string, ttlMs = 30 * 24 * 60 * 60 * 1000): string {
  const payload: ReviewTokenPayload = {
    path: objectPath,
    exp: Date.now() + ttlMs,
  };
  const body = base64Url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyStorageReviewToken(token: string | undefined, objectPath: string): boolean {
  if (!token || !token.includes(".")) return false;
  const [body, sig] = token.split(".", 2);
  if (!body || !sig) return false;

  const expected = sign(body);
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ReviewTokenPayload>;
    return payload.path === objectPath && typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}
