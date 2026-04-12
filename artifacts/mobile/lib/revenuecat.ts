import { Platform } from "react-native";

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

export async function getSubscriptionStatus(): Promise<boolean> {
  const rc = getPurchases();
  if (!rc) return false;
  try {
    const info = await rc.getCustomerInfo();
    return typeof info.entitlements.active["pro_access"] !== "undefined";
  } catch {
    return false;
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
    return typeof customerInfo.entitlements.active["pro_access"] !== "undefined";
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
    return typeof info.entitlements.active["pro_access"] !== "undefined";
  } catch {
    return false;
  }
}
