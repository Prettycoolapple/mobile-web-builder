import React, { createContext, useContext } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { useMutation, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";

const REVENUECAT_TEST_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY;
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;

export const REVENUECAT_ENTITLEMENT_ID = "Pro";

export const OFFERING_BY_ROLE: Record<string, string> = {
  general: "default",
  sales_agent: "agent",
  service_provider: "provider",
};

function getRevenueCatApiKey(): string {
  if (!REVENUECAT_TEST_API_KEY || !REVENUECAT_IOS_API_KEY || !REVENUECAT_ANDROID_API_KEY) {
    throw new Error("RevenueCat API keys not configured");
  }
  if (__DEV__ || Platform.OS === "web" || Constants.executionEnvironment === "storeClient") {
    return REVENUECAT_TEST_API_KEY;
  }
  if (Platform.OS === "ios") return REVENUECAT_IOS_API_KEY;
  if (Platform.OS === "android") return REVENUECAT_ANDROID_API_KEY;
  return REVENUECAT_TEST_API_KEY;
}

export function initializeRevenueCat(): void {
  try {
    const apiKey = getRevenueCatApiKey();
    Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR);
    Purchases.configure({ apiKey });
  } catch {
  }
}

export async function loginRevenueCat(userId: string): Promise<void> {
  try {
    await Purchases.logIn(userId);
  } catch {
  }
}

export async function logoutRevenueCat(): Promise<void> {
  try {
    await Purchases.logOut();
  } catch {
  }
}

function useSubscriptionContext() {
  const customerInfoQuery = useQuery({
    queryKey: ["revenuecat", "customer-info"],
    queryFn: () => Purchases.getCustomerInfo(),
    staleTime: 60_000,
    retry: false,
  });

  const offeringsQuery = useQuery({
    queryKey: ["revenuecat", "offerings"],
    queryFn: () => Purchases.getOfferings(),
    staleTime: 300_000,
    retry: false,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (pkg: object) => {
      const { customerInfo } = await Purchases.purchasePackage(pkg as never);
      return customerInfo;
    },
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const restoreMutation = useMutation({
    mutationFn: () => Purchases.restorePurchases(),
    onSuccess: () => customerInfoQuery.refetch(),
  });

  const isSubscribed =
    customerInfoQuery.data?.entitlements.active?.[REVENUECAT_ENTITLEMENT_ID] !== undefined;

  function getPackageForRole(role: string): object | null {
    const offeringKey = OFFERING_BY_ROLE[role] ?? "default";
    const offering =
      offeringsQuery.data?.all?.[offeringKey] ?? offeringsQuery.data?.current ?? null;
    return (offering?.monthly ?? offering?.availablePackages?.[0] ?? null) as object | null;
  }

  function getPriceForRole(role: string): string {
    const pkg = getPackageForRole(role) as { product?: { priceString?: string } } | null;
    if (pkg?.product?.priceString) return pkg.product.priceString;
    if (role === "sales_agent") return "$99.00";
    if (role === "service_provider") return "$149.00";
    return "$24.99";
  }

  return {
    customerInfo: customerInfoQuery.data,
    offerings: offeringsQuery.data,
    isSubscribed,
    // True once RC has definitively loaded (not loading, not error) — use to safely downgrade
    customerInfoLoaded: !customerInfoQuery.isLoading && !customerInfoQuery.isError && customerInfoQuery.data !== undefined,
    isLoading: customerInfoQuery.isLoading || offeringsQuery.isLoading,
    purchase: purchaseMutation.mutateAsync,
    restore: restoreMutation.mutateAsync,
    isPurchasing: purchaseMutation.isPending,
    isRestoring: restoreMutation.isPending,
    refetchCustomerInfo: customerInfoQuery.refetch,
    getPackageForRole,
    getPriceForRole,
  };
}

type SubscriptionContextValue = ReturnType<typeof useSubscriptionContext>;
const Context = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const value = useSubscriptionContext();
  return React.createElement(Context.Provider, { value }, children);
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useSubscription must be used within a SubscriptionProvider");
  return ctx;
}
