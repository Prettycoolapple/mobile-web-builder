import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const MAX_BADGE_COUNT = 99;

function normaliseBadgeCount(count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(MAX_BADGE_COUNT, Math.floor(count)));
}

export async function configureAppIconBadgesAsync(): Promise<void> {
  if (Platform.OS === "web") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.DEFAULT,
      showBadge: true,
    });
  }
}

export async function setAppIconBadgeCountAsync(count: number): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await Notifications.setBadgeCountAsync(normaliseBadgeCount(count));
  } catch {
  }
}

export async function incrementAppIconBadgeCountAsync(amount = 1): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const current = await Notifications.getBadgeCountAsync();
    await setAppIconBadgeCountAsync(current + amount);
  } catch {
  }
}
