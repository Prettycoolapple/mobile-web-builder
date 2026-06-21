import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { db, profiles } from "@workspace/db";

type ActivityLogger = Pick<Logger, "warn">;

export async function touchUserLastActive(userId: string, now = new Date()): Promise<Date> {
  await db.update(profiles).set({ lastLoginAt: now }).where(eq(profiles.id, userId));
  return now;
}

export function noteUserActivity(userId: string, log?: ActivityLogger | null): void {
  void touchUserLastActive(userId).catch((error) => {
    log?.warn({ error, userId }, "Failed to update user last activity");
  });
}
