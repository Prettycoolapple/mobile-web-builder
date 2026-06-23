/**
 * One-shot script: apply a CORS policy to the configured S3/R2 bucket(s) so the
 * web portals can upload files DIRECTLY to a presigned URL (PUT) from the
 * browser. Without this, the cross-origin PUT is blocked and large uploads fall
 * back to the multipart endpoint, which hits the serverless request-body cap
 * (Vercel 413 FUNCTION_PAYLOAD_TOO_LARGE). Native mobile apps don't enforce
 * CORS, so they're unaffected either way.
 *
 * Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/set-bucket-cors.ts
 *
 * Allowed origins default to getAllowedOrigins() (public app URL + ADMIN_ORIGIN
 * + CORS_ALLOWED_ORIGINS). Pass extra origins as CLI args to include them too:
 *   ... scripts/set-bucket-cors.ts https://staging.example.com
 *
 * Requires S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME.
 * Idempotent — re-running overwrites the bucket's CORS config with this policy.
 */
import "../src/lib/loadEnv";
import { s3StorageService } from "../src/lib/objectStorage";
import { getAllowedOrigins } from "../src/lib/env";

async function main(): Promise<void> {
  if (!s3StorageService.isConfigured) {
    console.error(
      "[set-bucket-cors] S3 storage is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET_NAME.",
    );
    process.exit(1);
  }

  const extraOrigins = process.argv.slice(2).map((o) => o.replace(/\/+$/, "")).filter(Boolean);
  const origins = Array.from(new Set([...getAllowedOrigins(), ...extraOrigins]));

  console.log(`[set-bucket-cors] Applying CORS for origins:\n  ${origins.join("\n  ")}`);
  const buckets = await s3StorageService.configureCors(origins);
  console.log(`[set-bucket-cors] Done. Configured bucket(s): ${buckets.join(", ")}`);
}

main().catch((err) => {
  console.error("[set-bucket-cors] Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
