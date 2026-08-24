import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useRubinHost } from "@/context/RubinHostContext";

/**
 * `/rubin` — the deep-link door to the Rubin canvas.
 *
 * The canvas itself no longer lives here. It is held by `RubinHostProvider`
 * above the navigator, because a warmed WebView has to survive navigation and a
 * screen cannot promise that (see that file). What is left is the address
 * translation: read the target out of the URL, hand it to the host, and get out
 * of the way.
 *
 * This screen therefore never draws anything. It pops itself in the same frame
 * it presents, so Back from Rubin lands wherever the user actually came from
 * rather than on a blank route — and the canvas colour underneath means the
 * single frame it does occupy is indistinguishable from Rubin's own background.
 */
export default function RubinScreen() {
  const router = useRouter();
  const { present } = useRubinHost();
  const handedOffRef = useRef(false);

  const params = useLocalSearchParams<{ address?: string; lat?: string; lng?: string }>();

  const target = useMemo(() => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    return {
      address: typeof params.address === "string" ? params.address : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  }, [params.address, params.lat, params.lng]);

  useEffect(() => {
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    present(target);
    // A cold deep link has nothing behind it; anything else has the screen the
    // user was on. Either way this route must not stay on the stack, or Back
    // from the canvas would land on it and immediately re-present.
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [present, router, target]);

  return <View style={styles.screen} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // Rubin's own canvas colour, so the handover frame shows no seam.
    backgroundColor: "#111827",
  },
});
