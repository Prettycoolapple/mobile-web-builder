import {
  getRevenueCatProjectId,
  revenueCatRequest,
  type RevenueCatApp,
  type RevenueCatEntitlement,
  type RevenueCatListResponse,
  type RevenueCatOffering,
  type RevenueCatPackage,
  type RevenueCatProduct,
  type RevenueCatPublicApiKey,
} from "./revenueCatClient";

const PROJECT_ID = getRevenueCatProjectId();

const APP_STORE_APP_NAME = "Project Alpha iOS";
const APP_STORE_BUNDLE_ID = "nz.devfeasible.app";
const PLAY_STORE_APP_NAME = "Project Alpha Android";
const PLAY_STORE_PACKAGE_NAME = "nz.devfeasible.app";

const ENTITLEMENT_IDENTIFIER = "Pro";
const ENTITLEMENT_DISPLAY_NAME = "Pro Access";

const PLANS = [
  {
    offeringKey: "default",
    offeringName: "Standard Plan",
    productIdentifier: "standard_monthly",
    playStoreIdentifier: "standard_monthly:monthly",
    displayName: "Standard Monthly",
    title: "Standard Plan — $24.99/mo",
    priceNzd: 24990000,
    packageKey: "$rc_monthly",
    packageName: "Standard Monthly",
  },
  {
    offeringKey: "agent",
    offeringName: "Agent Pro Plan",
    productIdentifier: "agent_monthly",
    playStoreIdentifier: "agent_monthly:monthly",
    displayName: "Agent Pro Monthly",
    title: "Agent Pro — $99/mo",
    priceNzd: 99000000,
    packageKey: "$rc_monthly",
    packageName: "Agent Pro Monthly",
  },
  {
    offeringKey: "provider",
    offeringName: "Provider Pro Plan",
    productIdentifier: "provider_monthly",
    playStoreIdentifier: "provider_monthly:monthly",
    displayName: "Provider Pro Monthly",
    title: "Provider Pro — $149/mo",
    priceNzd: 149000000,
    packageKey: "$rc_monthly",
    packageName: "Provider Pro Monthly",
  },
] as const;

type TestStorePricesResponse = {
  object: string;
  prices: { amount_micros: number; currency: string }[];
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function listApps(): Promise<RevenueCatApp[]> {
  const response = await revenueCatRequest<RevenueCatListResponse<RevenueCatApp>>(
    `/projects/${PROJECT_ID}/apps?limit=50`,
  );
  return response.items ?? [];
}

async function listEntitlements(): Promise<RevenueCatEntitlement[]> {
  const response = await revenueCatRequest<RevenueCatListResponse<RevenueCatEntitlement>>(
    `/projects/${PROJECT_ID}/entitlements?limit=50`,
  );
  return response.items ?? [];
}

async function listProducts(): Promise<RevenueCatProduct[]> {
  const response = await revenueCatRequest<RevenueCatListResponse<RevenueCatProduct>>(
    `/projects/${PROJECT_ID}/products?limit=100`,
  );
  return response.items ?? [];
}

async function listOfferings(): Promise<RevenueCatOffering[]> {
  const response = await revenueCatRequest<RevenueCatListResponse<RevenueCatOffering>>(
    `/projects/${PROJECT_ID}/offerings?limit=50`,
  );
  return response.items ?? [];
}

async function listPackages(offeringId: string): Promise<RevenueCatPackage[]> {
  const response = await revenueCatRequest<RevenueCatListResponse<RevenueCatPackage>>(
    `/projects/${PROJECT_ID}/offerings/${offeringId}/packages?limit=50`,
  );
  return response.items ?? [];
}

async function listAppPublicApiKeys(appId: string): Promise<RevenueCatPublicApiKey[]> {
  const response = await revenueCatRequest<RevenueCatListResponse<RevenueCatPublicApiKey>>(
    `/projects/${PROJECT_ID}/apps/${appId}/public_api_keys`,
  );
  return response.items ?? [];
}

async function createApp(body: Record<string, unknown>): Promise<RevenueCatApp> {
  return revenueCatRequest<RevenueCatApp>(`/projects/${PROJECT_ID}/apps`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function createEntitlement(body: Record<string, unknown>): Promise<RevenueCatEntitlement> {
  return revenueCatRequest<RevenueCatEntitlement>(`/projects/${PROJECT_ID}/entitlements`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function createOffering(body: Record<string, unknown>): Promise<RevenueCatOffering> {
  return revenueCatRequest<RevenueCatOffering>(`/projects/${PROJECT_ID}/offerings`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function updateOffering(offeringId: string, body: Record<string, unknown>): Promise<RevenueCatOffering> {
  return revenueCatRequest<RevenueCatOffering>(`/projects/${PROJECT_ID}/offerings/${offeringId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function createPackage(offeringId: string, body: Record<string, unknown>): Promise<RevenueCatPackage> {
  return revenueCatRequest<RevenueCatPackage>(`/projects/${PROJECT_ID}/offerings/${offeringId}/packages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function createProduct(body: Record<string, unknown>): Promise<RevenueCatProduct> {
  return revenueCatRequest<RevenueCatProduct>(`/projects/${PROJECT_ID}/products`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function attachProductsToEntitlement(entitlementId: string, productIds: string[]): Promise<void> {
  await revenueCatRequest(`/projects/${PROJECT_ID}/entitlements/${entitlementId}/actions/attach_products`, {
    method: "POST",
    body: JSON.stringify({ product_ids: productIds }),
  });
}

async function attachProductsToPackage(
  packageId: string,
  products: Array<{ product_id: string; eligibility_criteria: "all" }>,
): Promise<void> {
  await revenueCatRequest(`/projects/${PROJECT_ID}/packages/${packageId}/actions/attach_products`, {
    method: "POST",
    body: JSON.stringify({ products }),
  });
}

async function setTestStorePrices(productId: string, amountMicros: number): Promise<TestStorePricesResponse> {
  return revenueCatRequest<TestStorePricesResponse>(
    `/projects/${PROJECT_ID}/products/${productId}/test_store_prices`,
    {
      method: "POST",
      body: JSON.stringify({ prices: [{ amount_micros: amountMicros, currency: "NZD" }] }),
    },
  );
}

async function seedRevenueCat() {
  console.log("Using RevenueCat project:", PROJECT_ID);
  const apps = await listApps();

  let testApp = apps.find((a) => a.id === env("REVENUECAT_TEST_STORE_APP_ID"))
    ?? apps.find((a) => a.type === "test_store");
  let appStoreApp = apps.find((a) => a.id === env("REVENUECAT_APPLE_APP_STORE_APP_ID"))
    ?? apps.find((a) => a.type === "app_store");
  let playStoreApp = apps.find((a) => a.id === env("REVENUECAT_GOOGLE_PLAY_STORE_APP_ID"))
    ?? apps.find((a) => a.type === "play_store");

  if (!testApp) throw new Error("No test store app found");
  console.log("Test store app:", testApp.id);

  if (!appStoreApp) {
    const newApp = await createApp({
      name: APP_STORE_APP_NAME,
      type: "app_store",
      app_store: { bundle_id: APP_STORE_BUNDLE_ID },
    });
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const newApp = await createApp({
      name: PLAY_STORE_APP_NAME,
      type: "play_store",
      play_store: { package_name: PLAY_STORE_PACKAGE_NAME },
    });
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app:", playStoreApp.id);
  }

  // ── Entitlement ───────────────────────────────────────────────────────────
  const existingEntitlements = await listEntitlements();
  let entitlement = existingEntitlements.find(
    (e) => e.lookup_key === ENTITLEMENT_IDENTIFIER,
  );
  if (entitlement) {
    console.log("Entitlement already exists:", entitlement.id);
  } else {
    const newEnt = await createEntitlement({
      lookup_key: ENTITLEMENT_IDENTIFIER,
      display_name: ENTITLEMENT_DISPLAY_NAME,
    });
    entitlement = newEnt;
    console.log("Created entitlement:", entitlement.id);
  }

  // ── Products + Offerings + Packages (one per plan) ───────────────────────
  const existingProducts = await listProducts();

  const ensureProduct = async (
    targetApp: RevenueCatApp,
    label: string,
    storeIdentifier: string,
    displayName: string,
    title: string,
    isTest: boolean,
  ): Promise<RevenueCatProduct> => {
    const existing = existingProducts.find(
      (p) => p.store_identifier === storeIdentifier && p.app_id === targetApp.id,
    );
    if (existing) {
      console.log(`${label} product already exists:`, existing.id);
      return existing;
    }
    const body: Record<string, unknown> = {
      store_identifier: storeIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: displayName,
    };
    if (isTest) {
      body.subscription = { duration: "P1M" };
      body.title = title;
    }
    const created = await createProduct(body);
    console.log(`Created ${label} product:`, created.id);
    existingProducts.push(created);
    return created;
  };

  const existingOfferings = await listOfferings();

  for (const plan of PLANS) {
    console.log(`\n── Setting up plan: ${plan.offeringKey} ──`);

    const testProduct = await ensureProduct(testApp, `${plan.offeringKey} test`, plan.productIdentifier, plan.displayName, plan.title, true);
    const iosProduct = await ensureProduct(appStoreApp, `${plan.offeringKey} iOS`, plan.productIdentifier, plan.displayName, plan.title, false);
    const androidProduct = await ensureProduct(playStoreApp, `${plan.offeringKey} Android`, plan.playStoreIdentifier, plan.displayName, plan.title, false);

    // Set test store price
    try {
      await setTestStorePrices(testProduct.id, plan.priceNzd);
      console.log(`Set NZD price for ${plan.offeringKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("409") || message.includes("422")) {
        console.log("Price already set for", plan.offeringKey);
      } else {
        throw error;
      }
    }

    // Attach all 3 products to the single entitlement
    try {
      await attachProductsToEntitlement(entitlement!.id, [testProduct.id, iosProduct.id, androidProduct.id]);
      console.log(`Attached products to entitlement for ${plan.offeringKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("409") || message.includes("422")) {
        console.log("Products already attached to entitlement for", plan.offeringKey);
      } else {
        throw error;
      }
    }

    // Create or find offering
    let offering = existingOfferings.find(
      (o) => o.lookup_key === plan.offeringKey,
    );
    if (offering) {
      console.log(`Offering ${plan.offeringKey} already exists:`, offering.id);
    } else {
      const newOffering = await createOffering({
        lookup_key: plan.offeringKey,
        display_name: plan.offeringName,
      });
      offering = newOffering;
      existingOfferings.push(newOffering);
      console.log(`Created offering ${plan.offeringKey}:`, offering.id);
    }

    // Set "default" offering as current
    if (plan.offeringKey === "default" && !offering.is_current) {
      await updateOffering(offering.id, { is_current: true });
      console.log("Set default offering as current");
    }

    // Create or find package in this offering
    const existingPackages = await listPackages(offering.id);

    let pkg = existingPackages.find(
      (p) => p.lookup_key === plan.packageKey,
    );
    if (pkg) {
      console.log(`Package already exists in ${plan.offeringKey}:`, pkg.id);
    } else {
      const newPkg = await createPackage(offering.id, {
        lookup_key: plan.packageKey,
        display_name: plan.packageName,
      });
      pkg = newPkg;
      console.log(`Created package in ${plan.offeringKey}:`, pkg.id);
    }

    // Attach products to package
    try {
      await attachProductsToPackage(pkg.id, [
        { product_id: testProduct.id, eligibility_criteria: "all" },
        { product_id: iosProduct.id, eligibility_criteria: "all" },
        { product_id: androidProduct.id, eligibility_criteria: "all" },
      ]);
      console.log(`Attached products to package for ${plan.offeringKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("409") || message.includes("422")) {
        console.log(`Products already attached to package for ${plan.offeringKey}`);
      } else {
        throw new Error(`Failed to attach products to package: ${message}`);
      }
    }
  }

  // ── Print API Keys ───────────────────────────────────────────────────────
  const [testKeys, iosKeys, androidKeys] = await Promise.all([
    listAppPublicApiKeys(testApp.id),
    listAppPublicApiKeys(appStoreApp.id),
    listAppPublicApiKeys(playStoreApp.id),
  ]);

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", PROJECT_ID);
  console.log("Test Store App ID:", testApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Entitlement:", ENTITLEMENT_IDENTIFIER);
  console.log("Public API Key - Test Store:", testKeys.map((k) => k.key).join(", ") || "N/A");
  console.log("Public API Key - App Store (iOS):", iosKeys.map((k) => k.key).join(", ") || "N/A");
  console.log("Public API Key - Play Store (Android):", androidKeys.map((k) => k.key).join(", ") || "N/A");
  console.log("====================\n");
}

seedRevenueCat().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
