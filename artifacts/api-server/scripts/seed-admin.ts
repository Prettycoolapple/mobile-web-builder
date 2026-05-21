/**
 * One-shot script: ensure the admin@projectalpha.app account exists with the admin role.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-admin.ts
 *
 * Idempotent — if the row already exists, password and role are updated in place.
 * Requires DATABASE_URL in the environment.
 */
import "../src/lib/loadEnv";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { hashPassword } from "../src/lib/auth";

const ADMIN_EMAIL = "admin@projectalpha.app";
const ADMIN_PASSWORD = "AlphaAdmin2025!";
const ADMIN_FULL_NAME = "Project Alpha Admin";

async function main(): Promise<void> {
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(profiles)
      .set({
        passwordHash,
        role: "admin",
        fullName: ADMIN_FULL_NAME,
        isVerified: true,
        subscriptionTier: "pro",
      })
      .where(eq(profiles.id, existing[0].id));
    // eslint-disable-next-line no-console
    console.log(`Updated existing admin account: ${ADMIN_EMAIL} (id=${existing[0].id})`);
    return;
  }

  const [inserted] = await db
    .insert(profiles)
    .values({
      email: ADMIN_EMAIL,
      fullName: ADMIN_FULL_NAME,
      passwordHash,
      role: "admin",
      isVerified: true,
      subscriptionTier: "pro",
    })
    .returning({ id: profiles.id });

  // eslint-disable-next-line no-console
  console.log(`Created admin account: ${ADMIN_EMAIL} (id=${inserted.id})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("seed-admin failed:", err);
    process.exit(1);
  });
