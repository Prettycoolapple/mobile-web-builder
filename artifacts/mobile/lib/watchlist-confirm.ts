import { Alert } from "react-native";

/**
 * Confirmation prompt shown before removing a property from the watchlist.
 * Resolves true only when the user explicitly confirms removal; Cancel or
 * dismissing resolves false. Adding (saving) stays instant and never calls this.
 *
 * Mirrors the app's existing destructive-confirm pattern (history delete,
 * profile sign-out).
 */
export function confirmRemoveFromWatchlist(t: (key: string) => string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      t("watchlist.confirm_remove_title"),
      t("watchlist.confirm_remove_body"),
      [
        { text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
        { text: t("watchlist.remove"), style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
