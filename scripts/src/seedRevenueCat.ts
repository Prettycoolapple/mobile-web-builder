import { getUncachableRevenueCatClient } from "./revenueCatClient";

import {
  listProjects,
  createProject,
  listApps,
  createApp,
  listAppPublicApiKeys,
  listProducts,
  createProduct,
  listEntitlements,
  createEntitlement,
  attachProductsToEntitlement,
  listOfferings,
  createOffering,
  updateOffering,
  listPackages,
  createPackages,
  attachProductsToPackage,
  type App,
  type Product,
  type Project,
  type Entitlement,
  type Offering,
  type Package,
  type CreateProductData,
} from "@replit/revenuecat-sdk";

const PROJECT_NAME = "Groundup";

const APP_STORE_APP_NAME = "Groundup iOS";
const APP_STORE_BUNDLE_ID = "nz.devfeasible.app";
const PLAY_STORE_APP_NAME = "Groundup Android";
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

async function seedRevenueCat() {
  const client = await getUncachableRevenueCatClient();

  // ── Project ──────────────────────────────────────────────────────────────
  let project: Project;
  const { data: existingProjects, error: listProjectsError } = await listProjects({
    client,
    query: { limit: 20 },
  });
  if (listProjectsError) throw new Error("Failed to list projects");

  const existingProject = existingProjects.items?.find((p) => p.name === PROJECT_NAME);
  if (existingProject) {
    console.log("Project already exists:", existingProject.id);
    project = existingProject;
  } else {
    const { data: newProject, error } = await createProject({ client, body: { name: PROJECT_NAME } });
    if (error) throw new Error("Failed to create project");
    console.log("Created project:", newProject.id);
    project = newProject;
  }

  // ── Apps ─────────────────────────────────────────────────────────────────
  const { data: apps, error: listAppsError } = await listApps({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listAppsError || !apps) throw new Error("Failed to list apps");

  let testApp: App | undefined = apps.items.find((a) => a.type === "test_store");
  let appStoreApp: App | undefined = apps.items.find((a) => a.type === "app_store");
  let playStoreApp: App | undefined = apps.items.find((a) => a.type === "play_store");

  if (!testApp) throw new Error("No test store app found");
  console.log("Test store app:", testApp.id);

  if (!appStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: APP_STORE_APP_NAME, type: "app_store", app_store: { bundle_id: APP_STORE_BUNDLE_ID } },
    });
    if (error) throw new Error("Failed to create App Store app");
    appStoreApp = newApp;
    console.log("Created App Store app:", appStoreApp.id);
  } else {
    console.log("App Store app:", appStoreApp.id);
  }

  if (!playStoreApp) {
    const { data: newApp, error } = await createApp({
      client,
      path: { project_id: project.id },
      body: { name: PLAY_STORE_APP_NAME, type: "play_store", play_store: { package_name: PLAY_STORE_PACKAGE_NAME } },
    });
    if (error) throw new Error("Failed to create Play Store app");
    playStoreApp = newApp;
    console.log("Created Play Store app:", playStoreApp.id);
  } else {
    console.log("Play Store app:", playStoreApp.id);
  }

  // ── Entitlement ───────────────────────────────────────────────────────────
  const { data: existingEntitlements, error: listEntitlementsError } = await listEntitlements({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listEntitlementsError) throw new Error("Failed to list entitlements");

  let entitlement: Entitlement | undefined = existingEntitlements.items?.find(
    (e) => e.lookup_key === ENTITLEMENT_IDENTIFIER,
  );
  if (entitlement) {
    console.log("Entitlement already exists:", entitlement.id);
  } else {
    const { data: newEnt, error } = await createEntitlement({
      client,
      path: { project_id: project.id },
      body: { lookup_key: ENTITLEMENT_IDENTIFIER, display_name: ENTITLEMENT_DISPLAY_NAME },
    });
    if (error) throw new Error("Failed to create entitlement");
    entitlement = newEnt;
    console.log("Created entitlement:", entitlement.id);
  }

  // ── Products + Offerings + Packages (one per plan) ───────────────────────
  const { data: existingProducts, error: listProductsError } = await listProducts({
    client,
    path: { project_id: project.id },
    query: { limit: 100 },
  });
  if (listProductsError) throw new Error("Failed to list products");

  const ensureProduct = async (
    targetApp: App,
    label: string,
    storeIdentifier: string,
    displayName: string,
    title: string,
    isTest: boolean,
  ): Promise<Product> => {
    const existing = existingProducts.items?.find(
      (p) => p.store_identifier === storeIdentifier && p.app_id === targetApp.id,
    );
    if (existing) {
      console.log(`${label} product already exists:`, existing.id);
      return existing;
    }
    const body: CreateProductData["body"] = {
      store_identifier: storeIdentifier,
      app_id: targetApp.id,
      type: "subscription",
      display_name: displayName,
    };
    if (isTest) {
      body.subscription = { duration: "P1M" };
      body.title = title;
    }
    const { data: created, error } = await createProduct({
      client,
      path: { project_id: project.id },
      body,
    });
    if (error) throw new Error(`Failed to create ${label} product`);
    console.log(`Created ${label} product:`, created.id);
    return created;
  };

  const { data: existingOfferings, error: listOfferingsError } = await listOfferings({
    client,
    path: { project_id: project.id },
    query: { limit: 20 },
  });
  if (listOfferingsError) throw new Error("Failed to list offerings");

  for (const plan of PLANS) {
    console.log(`\n── Setting up plan: ${plan.offeringKey} ──`);

    const testProduct = await ensureProduct(testApp, `${plan.offeringKey} test`, plan.productIdentifier, plan.displayName, plan.title, true);
    const iosProduct = await ensureProduct(appStoreApp, `${plan.offeringKey} iOS`, plan.productIdentifier, plan.displayName, plan.title, false);
    const androidProduct = await ensureProduct(playStoreApp, `${plan.offeringKey} Android`, plan.playStoreIdentifier, plan.displayName, plan.title, false);

    // Set test store price
    const { error: priceError } = await client.post<TestStorePricesResponse>({
      url: "/projects/{project_id}/products/{product_id}/test_store_prices",
      path: { project_id: project.id, product_id: testProduct.id },
      body: { prices: [{ amount_micros: plan.priceNzd, currency: "NZD" }] },
    });
    if (priceError) {
      if (typeof priceError === "object" && "type" in priceError && priceError["type"] === "resource_already_exists") {
        console.log("Price already set for", plan.offeringKey);
      } else {
        throw new Error(`Failed to set price for ${plan.offeringKey}`);
      }
    } else {
      console.log(`Set NZD price for ${plan.offeringKey}`);
    }

    // Attach all 3 products to the single entitlement
    const { error: attachEntErr } = await attachProductsToEntitlement({
      client,
      path: { project_id: project.id, entitlement_id: entitlement!.id },
      body: { product_ids: [testProduct.id, iosProduct.id, androidProduct.id] },
    });
    if (attachEntErr) {
      if (attachEntErr.type === "unprocessable_entity_error") {
        console.log("Products already attached to entitlement for", plan.offeringKey);
      } else {
        throw new Error(`Failed to attach products to entitlement for ${plan.offeringKey}`);
      }
    } else {
      console.log(`Attached products to entitlement for ${plan.offeringKey}`);
    }

    // Create or find offering
    let offering: Offering | undefined = existingOfferings.items?.find(
      (o) => o.lookup_key === plan.offeringKey,
    );
    if (offering) {
      console.log(`Offering ${plan.offeringKey} already exists:`, offering.id);
    } else {
      const { data: newOffering, error } = await createOffering({
        client,
        path: { project_id: project.id },
        body: { lookup_key: plan.offeringKey, display_name: plan.offeringName },
      });
      if (error) throw new Error(`Failed to create offering ${plan.offeringKey}`);
      offering = newOffering;
      console.log(`Created offering ${plan.offeringKey}:`, offering.id);
    }

    // Set "default" offering as current
    if (plan.offeringKey === "default" && !offering.is_current) {
      const { error } = await updateOffering({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: { is_current: true },
      });
      if (error) throw new Error("Failed to set default offering as current");
      console.log("Set default offering as current");
    }

    // Create or find package in this offering
    const { data: existingPackages, error: listPkgError } = await listPackages({
      client,
      path: { project_id: project.id, offering_id: offering.id },
      query: { limit: 20 },
    });
    if (listPkgError) throw new Error("Failed to list packages");

    let pkg: Package | undefined = existingPackages.items?.find(
      (p) => p.lookup_key === plan.packageKey,
    );
    if (pkg) {
      console.log(`Package already exists in ${plan.offeringKey}:`, pkg.id);
    } else {
      const { data: newPkg, error } = await createPackages({
        client,
        path: { project_id: project.id, offering_id: offering.id },
        body: { lookup_key: plan.packageKey, display_name: plan.packageName },
      });
      if (error) throw new Error(`Failed to create package in ${plan.offeringKey}`);
      pkg = newPkg;
      console.log(`Created package in ${plan.offeringKey}:`, pkg.id);
    }

    // Attach products to package
    const { error: attachPkgErr } = await attachProductsToPackage({
      client,
      path: { project_id: project.id, package_id: pkg.id },
      body: {
        products: [
          { product_id: testProduct.id, eligibility_criteria: "all" },
          { product_id: iosProduct.id, eligibility_criteria: "all" },
          { product_id: androidProduct.id, eligibility_criteria: "all" },
        ],
      },
    });
    if (attachPkgErr) {
      if (attachPkgErr.type === "unprocessable_entity_error") {
        console.log(`Products already attached to package for ${plan.offeringKey}`);
      } else {
        throw new Error(`Failed to attach products to package: ${JSON.stringify(attachPkgErr)}`);
      }
    } else {
      console.log(`Attached products to package for ${plan.offeringKey}`);
    }
  }

  // ── Print API Keys ───────────────────────────────────────────────────────
  const { data: testKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: testApp.id } });
  const { data: iosKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: appStoreApp.id } });
  const { data: androidKeys } = await listAppPublicApiKeys({ client, path: { project_id: project.id, app_id: playStoreApp.id } });

  console.log("\n====================");
  console.log("RevenueCat setup complete!");
  console.log("Project ID:", project.id);
  console.log("Test Store App ID:", testApp.id);
  console.log("App Store App ID:", appStoreApp.id);
  console.log("Play Store App ID:", playStoreApp.id);
  console.log("Entitlement:", ENTITLEMENT_IDENTIFIER);
  console.log("Public API Key - Test Store:", testKeys?.items?.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Public API Key - App Store (iOS):", iosKeys?.items?.map((k) => k.key).join(", ") ?? "N/A");
  console.log("Public API Key - Play Store (Android):", androidKeys?.items?.map((k) => k.key).join(", ") ?? "N/A");
  console.log("====================\n");
}

seedRevenueCat().catch(console.error);
