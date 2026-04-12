import { Platform } from "react-native";

const ENTITLEMENT_ID = "Pro";

let Purchases: any = null;

function getPurchases(): any | null {
  if (Purchases) return Purchases;
  try {
    Purchases = require("react-native-purchases").default;
    return Purchases;
  } catch {
    return null;
  }
}

export async function initRevenueCat(userId: string): Promise<void> {
  const rc = getPurchases();
  if (!rc) return;

  const appleKey = process.env["EXPO_PUBLIC_REVENUECAT_APPLE_KEY"];
  const googleKey = process.env["EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY"];
  const apiKey = Platform.OS === "ios" ? appleKey : googleKey;

  if (!apiKey) return;

  try {
    await rc.configure({ apiKey, appUserID: userId });
  } catch {
  }
}

export type PlanType = "monthly" | "yearly" | "lifetime";

export interface PlanInfo {
  type: PlanType;
  label: string;
  priceString: string;
  description: string;
  pkg: any | null;
}

const PLAN_FALLBACKS: Record<PlanType, { label: string; priceString: string; description: string }> = {
  monthly: { label: "Monthly", priceString: "—/mo", description: "Billed monthly" },
  yearly:  { label: "Yearly",  priceString: "—/yr", description: "Best value · Save ~40%" },
  lifetime:{ label: "Lifetime",priceString: "Once", description: "Pay once, access forever" },
};

export async function getOfferings(): Promise<PlanInfo[]> {
  const rc = getPurchases();

  const buildFallbacks = (): PlanInfo[] =>
    (["monthly", "yearly", "lifetime"] as PlanType[]).map((type) => ({
      type,
      ...PLAN_FALLBACKS[type],
      pkg: null,
    }));

  if (!rc) return buildFallbacks();

  try {
    const offerings = await rc.getOfferings();
    const current = offerings.current;
    if (!current) return buildFallbacks();

    const map: Record<PlanType, any> = {
      monthly:  current.monthly  ?? null,
      yearly:   current.annual   ?? null,
      lifetime: current.lifetime ?? null,
    };

    return (["monthly", "yearly", "lifetime"] as PlanType[]).map((type) => {
      const pkg = map[type];
      const fb = PLAN_FALLBACKS[type];
      return {
        type,
        label: fb.label,
        priceString: pkg?.product?.localizedPrice ?? pkg?.product?.priceString ?? fb.priceString,
        description: fb.description,
        pkg,
      };
    });
  } catch {
    return buildFallbacks();
  }
}

export async function getSubscriptionStatus(): Promise<boolean> {
  const rc = getPurchases();
  if (!rc) return false;
  try {
    const info = await rc.getCustomerInfo();
    return typeof info.entitlements.active[ENTITLEMENT_ID] !== "undefined";
  } catch {
    return false;
  }
}

export async function purchasePlan(pkg: any): Promise<boolean> {
  const rc = getPurchases();
  if (!rc) {
    throw new Error("In-app purchases are not available in this build. Please install the app from the App Store or Google Play.");
  }
  try {
    const { customerInfo } = await rc.purchasePackage(pkg);
    return typeof customerInfo.entitlements.active[ENTITLEMENT_ID] !== "undefined";
  } catch (err: any) {
    if (err.userCancelled) return false;
    throw err;
  }
}

export async function purchasePro(): Promise<boolean> {
  const rc = getPurchases();
  if (!rc) {
    throw new Error("In-app purchases are not available in this build. Please install the app from the App Store or Google Play.");
  }
  try {
    const offerings = await rc.getOfferings();
    const pkg = offerings.current?.monthly;
    if (!pkg) throw new Error("No subscription package found. Please try again later.");
    const { customerInfo } = await rc.purchasePackage(pkg);
    return typeof customerInfo.entitlements.active[ENTITLEMENT_ID] !== "undefined";
  } catch (err: any) {
    if (err.userCancelled) return false;
    throw err;
  }
}

export async function restorePurchases(): Promise<boolean> {
  const rc = getPurchases();
  if (!rc) return false;
  try {
    const info = await rc.restorePurchases();
    return typeof info.entitlements.active[ENTITLEMENT_ID] !== "undefined";
  } catch {
    return false;
  }
}
