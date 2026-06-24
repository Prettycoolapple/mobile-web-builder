/**
 * List all service providers in the DB.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/list-providers.ts
 */
import "../src/lib/loadEnv";
import { eq } from "drizzle-orm";
import { db, profiles, serviceProviderProfiles } from "@workspace/db";

async function main(): Promise<void> {
  const rows = await db
    .select({
      profileId: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      isVerified: profiles.isVerified,
      subscriptionTier: profiles.subscriptionTier,
      subscriptionStatus: profiles.subscriptionStatus,
      providerTrialEndsAt: profiles.providerTrialEndsAt,
      companyName: serviceProviderProfiles.companyName,
      discipline: serviceProviderProfiles.discipline,
      otherDiscipline: serviceProviderProfiles.otherDiscipline,
      addressSuburb: serviceProviderProfiles.addressSuburb,
      addressCity: serviceProviderProfiles.addressCity,
      contactNumber: serviceProviderProfiles.contactNumber,
      bio: serviceProviderProfiles.bio,
      recommendationCount: serviceProviderProfiles.recommendationCount,
      primaryLanguage: serviceProviderProfiles.primaryLanguage,
      secondaryLanguage: serviceProviderProfiles.secondaryLanguage,
      createdAt: serviceProviderProfiles.createdAt,
    })
    .from(profiles)
    .innerJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
    .orderBy(serviceProviderProfiles.createdAt);

  if (rows.length === 0) {
    console.log("No service providers found.");
    return;
  }

  console.log(`Found ${rows.length} service provider(s):\n`);
  for (const r of rows) {
    console.log(`--- ${r.email} ---`);
    console.log(`  Profile ID:       ${r.profileId}`);
    console.log(`  Full name:        ${r.fullName ?? "(none)"}`);
    console.log(`  Company:          ${r.companyName ?? "(none)"}`);
    console.log(`  Discipline:       ${r.discipline ?? "(none)"}${r.otherDiscipline ? ` (${r.otherDiscipline})` : ""}`);
    console.log(`  Location:         ${[r.addressSuburb, r.addressCity].filter(Boolean).join(", ") || "(none)"}`);
    console.log(`  Contact:          ${r.contactNumber ?? "(none)"}`);
    console.log(`  Languages:        ${[r.primaryLanguage, r.secondaryLanguage].filter(Boolean).join(", ") || "(none)"}`);
    console.log(`  Recommendations:  ${r.recommendationCount}`);
    console.log(`  Verified:         ${r.isVerified}`);
    console.log(`  Subscription:     ${r.subscriptionTier} / ${r.subscriptionStatus ?? "n/a"}`);
    console.log(`  Trial ends:       ${r.providerTrialEndsAt?.toISOString() ?? "(none)"}`);
    console.log(`  Created:          ${r.createdAt.toISOString()}`);
    console.log(`  Bio:              ${r.bio ? r.bio.slice(0, 80) + (r.bio.length > 80 ? "…" : "") : "(none)"}`);
    console.log();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("list-providers failed:", err);
    process.exit(1);
  });
