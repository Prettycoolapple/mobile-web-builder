import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

interface Props {
  visible: boolean;
  uri: string | null;
  authToken: string | null;
  onClose: () => void;
}

function extFromUri(uri: string): string {
  const clean = uri.split("?")[0];
  const dot = clean.lastIndexOf(".");
  if (dot > 0 && dot > clean.length - 6) {
    return clean.slice(dot);
  }
  return ".jpg";
}

async function downloadToCache(uri: string, authToken: string | null): Promise<string> {
  const ext = extFromUri(uri);
  const dest = `${FileSystem.cacheDirectory}groundup_${Date.now()}${ext}`;
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const result = await FileSystem.downloadAsync(uri, dest, { headers });
  if (result.status >= 400) {
    throw new Error(`Download failed (${result.status})`);
  }
  return result.uri;
}

export function ImageViewerModal({ visible, uri, authToken, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<"save" | "share" | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;

  const handleSave = useCallback(async () => {
    if (!uri || busy) return;
    setBusy("save");
    try {
      if (Platform.OS !== "android") {
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Allow access to your photo library to save images.");
          return;
        }
      }
      const localUri = await downloadToCache(uri, authToken);
      await MediaLibrary.saveToLibraryAsync(localUri);
      Alert.alert("Saved", "Image saved to your photo library.");
    } catch (err: any) {
      Alert.alert("Couldn't save", err?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  }, [uri, authToken, busy]);

  const handleShare = useCallback(async () => {
    if (!uri || busy) return;
    setBusy("share");
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert("Sharing unavailable", "Sharing isn't supported on this device.");
        return;
      }
      const localUri = await downloadToCache(uri, authToken);
      await Sharing.shareAsync(localUri, {
        mimeType: "image/jpeg",
        UTI: "public.jpeg",
        dialogTitle: "Share image",
      });
    } catch (err: any) {
      Alert.alert("Couldn't share", err?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  }, [uri, authToken, busy]);

  return (
    <Modal
      visible={visible && !!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={styles.iconBtn} hitSlop={12}>
            <Feather name="x" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={handleSave}
            style={styles.iconBtn}
            disabled={!!busy}
            hitSlop={12}
          >
            {busy === "save" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name="download" size={22} color="#fff" />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            style={styles.iconBtn}
            disabled={!!busy}
            hitSlop={12}
          >
            {busy === "share" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather name={Platform.OS === "ios" ? "share" : "share-2"} size={22} color="#fff" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.imageWrap} pointerEvents="box-none">
          {uri ? (
            <Image
              source={{ uri, headers }}
              style={styles.image}
              contentFit="contain"
              transition={150}
              onLoadStart={() => setImageLoading(true)}
              onLoadEnd={() => setImageLoading(false)}
              onError={() => setImageLoading(false)}
            />
          ) : null}
          {imageLoading ? (
            <View style={styles.loaderOverlay} pointerEvents="none">
              <ActivityIndicator color="#fff" size="large" />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
    zIndex: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  imageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
