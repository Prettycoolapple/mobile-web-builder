import React, { createContext, useContext, useCallback } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_ID = "Pro";

/** ISO 8601 end of the current App Store / Play subscription period (RevenueCat). */
export function getActiveEntitlementExpirationIso(customerInfo: object | null | undefined): string | undefined {
  if (!customerInfo || typeof customerInfo !== "object") return undefined;
  const info = customerInfo as {
    entitlements?: { active?: Record<string, { expirationDate?: string | null }> };
  };
  const exp = info.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID]?.expirationDate;
  return typeof exp === "string" && exp.length > 0 ? exp : undefined;
}

export function buildSubscriptionSyncBody(
  tier: "pro" | "free",
  customerInfo: object | null | undefined,
): { tier: "pro" | "free"; subscriptionPeriodEndISO?: string } {
  if (tier === "free") return { tier };
  const iso = getActiveEntitlementExpirationIso(customerInfo);
  return iso ? { tier, subscriptionPeriodEndISO: iso } : { tier };
}

/** Fresh CustomerInfo for /subscription/sync so quotas align with IAP renewal dates. */
export async function getSubscriptionSyncBody(tier: "pro" | "free"): Promise<{ tier: "pro" | "free"; subscriptionPeriodEndISO?: string }> {
  if (tier === "free") return { tier };
  if (IS_TEST_PAYMENT_MODE) return { tier };
  try {
    const info = await Purchases.getCustomerInfo();
    return buildSubscriptionSyncBody(tier, info);
  } catch {
    return { tier };
  }
}

export const OFFERING_BY_ROLE: Record<string, string> = {
  general: "default",
  sales_agent: "agent",
  service_provider: "provider",
};

const PRODUCT_ID_BY_ROLE: Record<string, string> = {
  general: "standard_monthly",
  sales_agent: "agent_monthly",
  service_provider: "provider_monthly",
};

type OfferingPackage = object;
type OfferingLike = {
  monthly?: OfferingPackage | null;
  availablePackages?: OfferingPackage[] | null;
};
type OfferingsLike = {
  all?: Record<string, OfferingLike | null | undefined> | null;
  current?: OfferingLike | null;
};

type StoreProductLike = {
  identifier?: string;
  productIdentifier?: string;
  priceString?: string;
};

function pickStorePackageFromOfferings(role: string, offerings: OfferingsLike | null | undefined): object | null {
  const offeringKey = OFFERING_BY_ROLE[role] ?? "default";
  const offering = offerings?.all?.[offeringKey] ?? offerings?.current ?? null;
  return (offering?.monthly ?? offering?.availablePackages?.[0] ?? null) as object | null;
}

function pickDirectStoreProduct(
  role: string,
  products: StoreProductLike[] | null | undefined,
): StoreProductLike | null {
  const productId = PRODUCT_ID_BY_ROLE[role] ?? PRODUCT_ID_BY_ROLE.general;
  return products?.find(
    (product) => product.identifier === productId || product.productIdentifier === productId,
  ) ?? null;
}

// Test payment mode is active when we cannot reach native StoreKit / Billing
// (Expo Go, web, or any dev build without configured store products).
// In this mode, "purchases" are simulated and only the backend DB is updated.
// Production native builds (storeClient !== "storeClient") will use real RC.
export const IS_TEST_PAYMENT_MODE: boolean =
  Platform.OS === "web" ||
  Constants.executionEnvironment === "storeClient" ||
  process.env.EXPO_PUBLIC_USE_TEST_PAYMENT === "true";

function getRevenueCatApiKey(): string | null {
  if (IS_TEST_PAYMENT_MODE) {
    return REVENUECAT_TEST_API_KEY ?? null;
  }
  if (Platform.OS === "ios") return REVENUECAT_IOS_API_KEY ?? null;
  if (Platform.OS === "android") return REVENUECAT_ANDROID_API_KEY ?? null;
  return null;
}

export function initializeRevenueCat(): void {
  // In test payment mode we deliberately make zero native RC calls so the app
  // can run cleanly in Expo Go / web while iOS & Android are still being set
  // up. Real native builds will skip this branch.
  if (IS_TEST_PAYMENT_MODE) return;
  try {
    const apiKey = getRevenueCatApiKey();
    if (!apiKey) return;
    Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey });
  } catch {
  }
}

// Always log out the previous identity before logging in a new one. This
// prevents the (very rare) case where RC could alias a previous anonymous
// user with the new account, which would leak entitlements between accounts.
export async function loginRevenueCat(userId: string): Promise<void> {
  if (IS_TEST_PAYMENT_MODE) return;
  try {
    await Purchases.logOut().catch(() => {});
    await Purchases.logIn(userId);
  } catch {
  }
}

export async function logoutRevenueCat(): Promise<void> {
  if (IS_TEST_PAYMENT_MODE) return;
  try {
    await Purchases.logOut();
  } catch {
  }
}

const TEST_PRICE_BY_ROLE: Record<string, string> = {
  general: "$24.99",
  sales_agent: "$99.00",
  service_provider: "$149.00",
};

interface TestPackage {
  __testMode: true;
  role: string;
  product: { priceString: string };
}

interface DirectStoreProductPurchase {
  __storeProduct: true;
  role: string;
  storeProduct: StoreProductLike & object;
}

function isTestPackage(pkg: unknown): pkg is TestPackage {
  return typeof pkg === "object" && pkg !== null && (pkg as { __testMode?: boolean }).__testMode === true;
}

function isDirectStoreProductPurchase(pkg: unknown): pkg is DirectStoreProductPurchase {
  return typeof pkg === "object" && pkg !== null && (pkg as { __storeProduct?: boolean }).__storeProduct === true;
}

function useSubscriptionContext(identityReady: boolean) {
  const queryClient = useQueryClient();

  // Gate every native RC read on (a) not being in test payment mode and (b)
  // the auth context having confirmed the RC identity is the current user's.
  // This eliminates any race where a stale previous-user customer-info could
  // be read or written during a sign-in/sign-out transition.
  const queriesEnabled = !IS_TEST_PAYMENT_MODE && identityReady;

  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: () => Purchases.getCustomerInfo(),
    staleTime: 60_000,
    retry: false,
    enabled: queriesEnabled,
  });

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    queryFn: () => Purchases.getOfferings(),
    staleTime: 300_000,
    retry: 2,
    retryDelay: (n) => 800 * (n + 1),
    enabled: queriesEnabled,
  });

  const storeProductsQuery = useQuery({
    queryKey: ["revenuecat", "store-products"],
    queryFn: async () =>
      (await Purchases.getProducts(Object.values(PRODUCT_ID_BY_ROLE))) as unknown as StoreProductLike[],
    staleTime: 300_000,
    retry: 2,
    retryDelay: (n) => 800 * (n + 1),
    enabled: queriesEnabled,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: object) => {
      if (isTestPackage(pkg)) {
        // Simulated test purchase — no real charge. The caller is responsible
        // for syncing the new tier to the backend (POST /subscription/sync).
        await new Promise((r) => setTimeout(r, 600));
        return null;
      }
      if (isDirectStoreProductPurchase(pkg)) {
        const { customerInfo } = await Purchases.purchaseStoreProduct(pkg.storeProduct as never);
        return customerInfo;
      }
      const { customerInfo } = await Purchases.purchasePackage(pkg as never);
      return customerInfo;
    },
    onSuccess: () => {
      if (!IS_TEST_PAYMENT_MODE) customerInfoQuery.refetch();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (IS_TEST_PAYMENT_MODE) return null;
      return await Purchases.restorePurchases();
    },
    onSuccess: () => {
      if (!IS_TEST_PAYMENT_MODE) customerInfoQuery.refetch();
    },
  });

  const isSubscribed = IS_TEST_PAYMENT_MODE
    ? false
    : customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_ID] !== undefined;

  // True once RC has definitively loaded for the CURRENT user. In test payment
  // mode this is always false so the profile auto-sync never overwrites the
  // DB tier with "free" based on a missing RC subscription.
  const customerInfoLoaded = IS_TEST_PAYMENT_MODE
    ? false
    : !customerInfoQuery.isLoading && !customerInfoQuery.isError && customerInfoQuery.data !== undefined;

  function pickStorePackageForRole(role: string): object | null {
    return pickStorePackageFromOfferings(role, offeringsQuery.data as OfferingsLike | null | undefined);
  }

  function getDirectStoreProductForRole(role: string): DirectStoreProductPurchase | null {
    const product = pickDirectStoreProduct(
      role,
      storeProductsQuery.data as StoreProductLike[] | null | undefined,
    );
    if (!product) return null;
    return {
      __storeProduct: true,
      role,
      storeProduct: product as StoreProductLike & object,
    };
  }

  function getPackageForRole(role: string): object | null {
    const realPkg = pickStorePackageForRole(role);
    if (realPkg) return realPkg;
    const directProduct = getDirectStoreProductForRole(role);
    if (directProduct) return directProduct;
    if (IS_TEST_PAYMENT_MODE) {
      return {
        __testMode: true,
        role,
        product: { priceString: TEST_PRICE_BY_ROLE[role] ?? TEST_PRICE_BY_ROLE.general },
      } as TestPackage;
    }
    return null;
  }

  function getPriceForRole(role: string): string {
    const realPkg = pickStorePackageForRole(role) as { product?: { priceString?: string } } | null;
    if (realPkg?.product?.priceString) return realPkg.product.priceString;
    const directProduct = pickDirectStoreProduct(
      role,
      storeProductsQuery.data as StoreProductLike[] | null | undefined,
    );
    if (directProduct?.priceString) return directProduct.priceString;
    return TEST_PRICE_BY_ROLE[role] ?? TEST_PRICE_BY_ROLE.general;
  }

  // Allow auth context to wipe the cached identity-bound RC data when a
  // different user signs in or out, so we never show user A's entitlements
  // to user B.
  function resetSubscriptionCache() {
    queryClient.removeQueries({ queryKey: ["revenuecat"] });
  }

  const refetchOfferings = useCallback(() => offeringsQuery.refetch(), [offeringsQuery.refetch]);
  const refetchStoreProducts = useCallback(() => storeProductsQuery.refetch(), [storeProductsQuery.refetch]);

  const getFreshPackageForRole = useCallback(async (role: string): Promise<object | null> => {
    if (IS_TEST_PAYMENT_MODE) {
      return {
        __testMode: true,
        role,
        product: { priceString: TEST_PRICE_BY_ROLE[role] ?? TEST_PRICE_BY_ROLE.general },
      } as TestPackage;
    }
    if (!queriesEnabled) return null;
    const result = await offeringsQuery.refetch();
    const pkg = pickStorePackageFromOfferings(role, result.data as OfferingsLike | null | undefined)
      ?? pickStorePackageFromOfferings(role, offeringsQuery.data as OfferingsLike | null | undefined);
    if (pkg) return pkg;

    const productsResult = await storeProductsQuery.refetch();
    const directProduct = pickDirectStoreProduct(
      role,
      (productsResult.data as StoreProductLike[] | null | undefined)
        ?? (storeProductsQuery.data as StoreProductLike[] | null | undefined),
    );
    if (!directProduct) return null;
    return {
      __storeProduct: true,
      role,
      storeProduct: directProduct as StoreProductLike & object,
    } as DirectStoreProductPurchase;
  }, [queriesEnabled, offeringsQuery.refetch, offeringsQuery.data, storeProductsQuery.refetch, storeProductsQuery.data]);

  const offeringsLoading = Boolean(queriesEnabled && offeringsQuery.isPending);
  const offeringsError = queriesEnabled ? offeringsQuery.error : null;

  const purchaseReadyForRole = useCallback(
    (role: string): boolean => {
      if (IS_TEST_PAYMENT_MODE) return true;
      if (!queriesEnabled) return false;
      return pickStorePackageForRole(role) !== null || getDirectStoreProductForRole(role) !== null;
    },
    [queriesEnabled, offeringsQuery.data, storeProductsQuery.data],
  );

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    customerInfoLoaded,
    isTestPaymentMode: IS_TEST_PAYMENT_MODE,
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
    refetchCustomerInfo: customerInfoQuery.refetch,
    refetchOfferings,
    refetchStoreProducts,
    offeringsLoading,
    offeringsError,
    purchaseReadyForRole,
    getFreshPackageForRole,
    resetSubscriptionCache,
    getPackageForRole,
    getPriceForRole,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({
  identityReady,
  children,
}: {
  identityReady: boolean;
  children: React.ReactNode;
}) {
  const value = useSubscriptionContext(identityReady);
  return React.createElement(Context.Provider, { value }, children);
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}
