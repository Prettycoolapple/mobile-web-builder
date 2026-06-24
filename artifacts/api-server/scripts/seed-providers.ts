/**
 * Seed / fix fake service providers.
 *
 * 1. Fixes kyuan@heima.nz — she has a profiles row but no service_provider_profiles row,
 *    so she is invisible to the recommendation engine. This script inserts that row.
 * 2. Inserts Hao Li (jobs@modernresidential.co.nz) as a new service provider.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/seed-providers.ts
 *
 * Idempotent — skips rows that already exist.
 */
import "../src/lib/loadEnv";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, profiles, serviceProviderProfiles } from "@workspace/db";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

async function main(): Promise<void> {
  // ── 1. Fix kyuan@heima.nz ─────────────────────────────────────────────────
  const kyuan = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, "kyuan@heima.nz"))
    .limit(1);

  if (kyuan.length === 0) {
    console.log("kyuan@heima.nz: profile not found — skipping.");
  } else {
    const kyuanId = kyuan[0].id;
    const kyuanSp = await db
      .select({ id: serviceProviderProfiles.id })
      .from(serviceProviderProfiles)
      .where(eq(serviceProviderProfiles.userId, kyuanId))
      .limit(1);

    if (kyuanSp.length > 0) {
      console.log("kyuan@heima.nz: service_provider_profiles row already exists — skipping.");
    } else {
      await db.insert(serviceProviderProfiles).values({
        userId: kyuanId,
        companyName: "Heima Design",
        discipline: "architect_designer",
        addressSuburb: "Auckland CBD",
        addressCity: "Auckland",
        primaryLanguage: "English",
        secondaryLanguage: "Chinese (Simplified)",
        recommendationCount: 0,
        bio: "Heima Design is an Auckland-based architecture and design studio focused on residential and light commercial projects across New Zealand.",
      });
      console.log(`kyuan@heima.nz: service_provider_profiles row created (userId=${kyuanId})`);
    }
  }

  // ── 2. Add Hao Li / Modern Residential Design ─────────────────────────────
  const haoEmail = "jobs@modernresidential.co.nz";
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.email, haoEmail))
    .limit(1);

  if (existing.length > 0) {
    console.log(`${haoEmail}: profile already exists — skipping.`);
  } else {
    const passwordHash = await hashPassword("ProviderSeed2025!");

    const [inserted] = await db
      .insert(profiles)
      .values({
        email: haoEmail,
        fullName: "Hao Li",
        passwordHash,
        role: "service_provider",
        isVerified: true,
        subscriptionTier: "pro",
        subscriptionStatus: "active",
      })
      .returning({ id: profiles.id });

    await db.insert(serviceProviderProfiles).values({
      userId: inserted.id,
      companyName: "MODERN RESIDENTIAL DESIGN LIMITED",
      discipline: "architect_designer",
      addressSuburb: "East Tamaki",
      addressCity: "Auckland",
      contactNumber: "+642102944127",
      primaryLanguage: "English",
      secondaryLanguage: "Chinese (Simplified)",
      recommendationCount: 4,
      bio: "At Modern Residential Design (MRD), we design the homes you love to live in. Based in Auckland since 2013, our team offers expert architectural services focused on clean, modern, and innovative residential solutions—specializing as your trusted experts in property subdivision.",
    });

    console.log(`${haoEmail}: profile + service_provider_profiles created (id=${inserted.id})`);
  }

  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-providers failed:", err);
    process.exit(1);
  });
