/**
 * Validates RevenueCat project config against artifacts/mobile/lib/revenuecat.ts
 * and App Store product IDs (standard: monthly, provider: provider_monthly).
 *
 * Requires: REVENUECAT_PROJECT_ID, REVENUECAT_SECRET_API_KEY (from .env.local at repo root).
 *
 * Run: pnpm verify:revenuecat   (from scripts/)
 */
import "./loadEnv";
import {
  getRevenueCatProjectId,
  revenueCatRequest,
  type RevenueCatListResponse,
} from "./revenueCatClient";

const PROJECT_ID = getRevenueCatProjectId();

const APP_ENTITLEMENT_ID = "Pro";
const EXPECTED_APP_STORE_IDS = new Set(["monthly", "provider_monthly"]);

const OFFERING_DEFAULT = "default";
const OFFERING_PROVIDER = "provider";
const MONTHLY_PACKAGE_KEY = "$rc_monthly";

type RcApp = { id: string; type: string; name?: string };
type RcPackage = {
  id?: string;
  lookup_key?: string | null;
  display_name?: string | null;
  products?: { items?: unknown[] } | null;
};
type RcOfferingDetail = {
  id: string;
  lookup_key?: string | null;
  display_name?: string | null;
  is_current?: boolean | null;
  packages?: { items?: RcPackage[] } | null;
};
type RcProductListItem = {
  id?: string;
  store_identifier?: string | null;
  app_id?: string | null;
  app?: { type?: string | null; id?: string } | null;
};

async function listProjectProducts(): Promise<RcProductListItem[]> {
  const res = await revenueCatRequest<RevenueCatListResponse<RcProductListItem>>(
    `/projects/${PROJECT_ID}/products?limit=200`,
  );
  return res.items ?? [];
}

type RcEntitlement = { id: string; lookup_key?: string | null; display_name?: string | null };

/** For VERIFY_RC_DEBUG: describe attached rows regardless of app type. */
function describeProductRowsForDebug(items: unknown[] | undefined): string {
  const parts: string[] = [];
  for (const row of items ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const p = (r.product ?? r) as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    const app = p.app as Record<string, unknown> | undefined;
    const type = typeof app?.type === "string" ? app.type : "?";
    const sid = typeof p.store_identifier === "string" ? p.store_identifier : "?";
    parts.push(`${type}:${sid}`);
  }
  return parts.length ? parts.join(", ") : "no rows";
}

function appStoreStoreIdsFromRows(items: unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const row of items ?? []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const p = (r.product ?? r) as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    const app = p.app as Record<string, unknown> | undefined;
    const type = app?.type;
    const sid = typeof p.store_identifier === "string" ? p.store_identifier.trim() : "";
    if (!sid) continue;
    // RC v2 sometimes omits `app` on package product rows; Play composite IDs use ":" (e.g. base plans).
    if (type === "app_store" || ((type == null || type === "") && !sid.includes(":"))) {
      out.push(sid);
    }
  }
  return out;
}

async function listApps(): Promise<RcApp[]> {
  const res = await revenueCatRequest<RevenueCatListResponse<RcApp>>(
    `/projects/${PROJECT_ID}/apps?limit=50`,
  );
  return res.items ?? [];
}

async function listEntitlements(): Promise<RcEntitlement[]> {
  const res = await revenueCatRequest<RevenueCatListResponse<RcEntitlement>>(
    `/projects/${PROJECT_ID}/entitlements?limit=50`,
  );
  return res.items ?? [];
}

async function getOffering(offeringId: string): Promise<RcOfferingDetail> {
  return revenueCatRequest<RcOfferingDetail>(`/projects/${PROJECT_ID}/offerings/${offeringId}`);
}

async function listOfferingPackages(offeringId: string): Promise<RcPackage[]> {
  const res = await revenueCatRequest<RevenueCatListResponse<RcPackage>>(
    `/projects/${PROJECT_ID}/offerings/${offeringId}/packages?limit=50`,
  );
  return res.items ?? [];
}

/** Package → App Store store_identifiers (handles truncated offering responses). */
async function packageAppStoreIds(pkg: RcPackage): Promise<string[]> {
  const inline = appStoreStoreIdsFromRows(pkg.products?.items);
  if (inline.length > 0 || !pkg.id) return inline;
  const res = await revenueCatRequest<RevenueCatListResponse<unknown>>(
    `/projects/${PROJECT_ID}/packages/${pkg.id}/products?limit=50`,
  );
  if (process.env.VERIFY_RC_DEBUG === "1") {
    console.error("  [debug] package", pkg.id, "products:", describeProductRowsForDebug(res.items));
  }
  return appStoreStoreIdsFromRows(res.items);
}

async function listEntitlementProducts(entitlementId: string): Promise<unknown[]> {
  const res = await revenueCatRequest<RevenueCatListResponse<unknown>>(
    `/projects/${PROJECT_ID}/entitlements/${entitlementId}/products?limit=100`,
  );
  return res.items ?? [];
}

async function summarizeOfferingLines(off: RcOfferingDetail, pkgs: RcPackage[]): Promise<string[]> {
  const lines: string[] = [`  offering "${off.lookup_key}" id=${off.id} current=${Boolean(off.is_current)}`];
  for (const p of pkgs) {
    const keys = await packageAppStoreIds(p);
    lines.push(
      `    package ${p.lookup_key ?? "?"} (${p.display_name ?? ""}) → App Store: [${keys.join(", ") || "none"}]`,
    );
  }
  return lines;
}

function fail(msg: string): never {
  console.error("\n✖ " + msg);
  process.exitCode = 1;
  process.exit(1);
}

async function main() {
  if (!process.env.REVENUECAT_SECRET_API_KEY?.trim()) {
    console.error(`Missing REVENUECAT_SECRET_API_KEY.

Add it to the repo root .env.local (same file as other secrets):
  RevenueCat dashboard → Project settings → API keys → Secret API key

Then run:
  cd scripts
  pnpm verify:revenuecat
`);
    process.exit(1);
    return;
  }

  console.log("RevenueCat verify — project:", PROJECT_ID, "\n");

  const apps = await listApps();
  const ios = apps.find((a) => a.type === "app_store");
  if (!ios) {
    fail('No iOS "app_store" app in this RevenueCat project. Add an iOS app with bundle nz.devfeasible.app.');
  }
  console.log("iOS app:", ios.name ?? ios.id, `(${ios.id})\n`);

  const entitlements = await listEntitlements();
  const entByKey = new Map(entitlements.map((e) => [e.lookup_key ?? "", e]));

  const proEnt = entByKey.get(APP_ENTITLEMENT_ID);
  if (!proEnt) {
    fail(
      `Missing entitlement lookup_key "${APP_ENTITLEMENT_ID}". Create entitlement "Pro" and attach both store products.`,
    );
  }

  const extraProviderEnt = entByKey.get("provider");
  if (extraProviderEnt) {
    console.warn(
      `⚠ Found a separate entitlement lookup_key "provider" (id ${extraProviderEnt.id}). The app only reads "${APP_ENTITLEMENT_ID}". ` +
        `If purchases unlock "provider" but not "${APP_ENTITLEMENT_ID}", the app will not see an active subscription.\n`,
    );
  }

  const proProductRows = await listEntitlementProducts(proEnt.id);
  const proAppStoreIds = new Set(appStoreStoreIdsFromRows(proProductRows));
  console.log(`Entitlement "${APP_ENTITLEMENT_ID}" — App Store products attached:`);
  console.log(
    proAppStoreIds.size
      ? `  [${[...proAppStoreIds].sort().join(", ")}]`
      : "  (none — attach monthly + provider_monthly for iOS)",
  );

  for (const need of EXPECTED_APP_STORE_IDS) {
    if (!proAppStoreIds.has(need)) {
      console.error(`\n✖ Entitlement "${APP_ENTITLEMENT_ID}" is missing App Store product "${need}".`);
      process.exitCode = 1;
    } else {
      console.log(`  ✓ includes "${need}"`);
    }
  }

  const offeringsRes = await revenueCatRequest<RevenueCatListResponse<{ id: string; lookup_key?: string | null }>>(
    `/projects/${PROJECT_ID}/offerings?limit=50`,
  );
  const offeringItems = offeringsRes.items ?? [];
  const offeringIds = new Map(offeringItems.map((o) => [o.lookup_key ?? "", o.id]));

  const needOfferings = [OFFERING_DEFAULT, OFFERING_PROVIDER] as const;
  for (const key of needOfferings) {
    const oid = offeringIds.get(key);
    if (!oid) {
      console.error(`\n✖ Missing offering with identifier "${key}".`);
      process.exitCode = 1;
      continue;
    }
    const detail = await getOffering(oid);
    const pkgs =
      (detail.packages?.items?.length ? detail.packages.items : null) ?? (await listOfferingPackages(oid));
    console.log("\n" + (await summarizeOfferingLines(detail, pkgs)).join("\n"));

    const monthlyPkg = pkgs.find((p) => p.lookup_key === MONTHLY_PACKAGE_KEY);
    if (!monthlyPkg) {
      const keysFound = pkgs.map((p) => p.lookup_key ?? "?").join(", ") || "(no packages)";
      console.error(
        `✖ Offering "${key}" has no package with lookup_key "${MONTHLY_PACKAGE_KEY}" (required for Purchases offering.monthly). Found: [${keysFound}]`,
      );
      process.exitCode = 1;
      continue;
    }

    const storeIds = await packageAppStoreIds(monthlyPkg);
    if (key === OFFERING_DEFAULT) {
      if (!storeIds.includes("monthly")) {
        console.error(
          `✖ Offering "${key}" / ${MONTHLY_PACKAGE_KEY} must include App Store product "monthly". Got: [${storeIds.join(", ") || "none"}]`,
        );
        process.exitCode = 1;
      } else {
        console.log(`  ✓ "${key}" monthly package → App Store monthly`);
      }
    }
    if (key === OFFERING_PROVIDER) {
      if (!storeIds.includes("provider_monthly")) {
        console.error(
          `✖ Offering "${key}" / ${MONTHLY_PACKAGE_KEY} must include App Store product "provider_monthly". Got: [${storeIds.join(", ") || "none"}]`,
        );
        process.exitCode = 1;
      } else {
        console.log(`  ✓ "${key}" monthly package → App Store provider_monthly`);
      }
    }

    if (key === OFFERING_DEFAULT && !detail.is_current) {
      console.warn(`⚠ Offering "${key}" is not marked as current/default in RevenueCat (recommended).`);
    }
  }

  const exit = process.exitCode ?? 0;
  if (exit !== 0) {
    console.log("\n--- RevenueCat: App Store products on this iOS app ---");
    const all = await listProjectProducts();
    const iosProds = all.filter((p) => p.app_id === ios.id);
    if (iosProds.length === 0) {
      console.log("  (none — add subscriptions with store identifiers monthly, provider_monthly)");
    } else {
      for (const p of iosProds) {
        console.log(`  - ${p.store_identifier ?? p.id}`);
      }
    }
    console.log(`
--- App Store Connect (verify in browser; this script does not call Apple) ---
  Bundle ID must be: nz.devfeasible.app
  Subscription product IDs must be exactly:
    - monthly            (standard plan)
    - provider_monthly   (service provider plan)
  Fix the RevenueCat errors above by:
    1. Product catalog → Products: import/create those App Store subscriptions for the iOS app
    2. Entitlement "Pro": attach both App Store products so purchases unlock Pro
    3. Offering "default" → package $rc_monthly: attach App Store product "monthly"
    4. Offering "provider" → package $rc_monthly: attach App Store product "provider_monthly"
  Optional: remove $rc_annual / $rc_lifetime from offering "default" if you only sell monthly.
`);
  }

  console.log("\nDone. Exit code:", exit);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
