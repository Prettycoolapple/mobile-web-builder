import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { shareListing } from "@/lib/propertyShares";
import {
  BrowseListing,
  fetchPublicListing,
  resolveListingImageUrl,
  selectedListingContextFromBrowse,
} from "@/lib/browseListings";

function parsePreview(value: string | string[] | undefined): BrowseListing | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BrowseListing;
  } catch {
    return null;
  }
}

export default function ListingDetailScreen() {
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const initial = useMemo(() => parsePreview(preview), [preview]);
  const [listing, setListing] = useState<BrowseListing | null>(initial);
  const [loading, setLoading] = useState(!initial);

  useEffect(() => {
    if (!id) return;
    if (initial && (initial.source === "internal" || id.startsWith("generic_") || id.startsWith("shared_"))) {
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(!initial);
    fetchPublicListing(getApiHeaders(), id)
      .then((item) => {
        if (mounted) setListing(item);
      })
      .catch(() => {
        if (!initial && mounted) setListing(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [id, initial, getApiHeaders]);

  const handleAnalyse = useCallback(() => {
    if (!listing) return;
    const context = selectedListingContextFromBrowse(listing);
    router.replace({
      pathname: "/(tabs)",
      params: {
        analyseListingId: listing.id,
        analyseAddress: listing.address,
        analysePhotoUrl: context.photoUrl ?? "",
        analyseListingUrl: context.listingUrl ?? "",
        analyseListingContext: JSON.stringify(context),
      },
    } as never);
  }, [listing, router]);

  const openExternal = useCallback(() => {
    if (listing?.externalUrl) void Linking.openURL(listing.externalUrl);
  }, [listing?.externalUrl]);

  const handleShare = useCallback(() => {
    if (!listing) return;
    void shareListing(listing, getApiHeaders()).catch(() => {});
  }, [getApiHeaders, listing]);

  if (loading && !listing) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (!listing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, padding: 24 }]}>
        <Feather name="home" size={38} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>Listing unavailable</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const images = listing.imageUrls.map(resolveListingImageUrl).filter(Boolean) as string[];
  const agentName = "Listing agent";
  const agency = listing.agent?.agencyName ?? (listing.source === "internal" ? "Project Alpha agent" : "External marketplace");
  const agentAvatar = resolveListingImageUrl(listing.agent?.avatarUrl);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color="#FAFAF9" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Listing</Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Share listing">
          <Feather name="log-out" size={20} color="#FAFAF9" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {images.length ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {images.map((uri) => <Image key={uri} source={{ uri }} style={[styles.heroImage, { width }]} />)}
          </ScrollView>
        ) : (
          <View style={[styles.heroPlaceholder, { backgroundColor: colors.muted }]}>
            <Feather name="home" size={42} color={colors.mutedForeground} />
          </View>
        )}

        <View style={styles.content}>
          <Text style={[styles.price, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            {listing.priceDisplay || (listing.priceNzd ? `$${listing.priceNzd.toLocaleString("en-NZ")}` : "Price on application")}
          </Text>
          <Text style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{listing.address}</Text>

          <View style={styles.statsRow}>
            {(listing.bedrooms ?? 0) > 0 ? <Stat icon="home" text={`${listing.bedrooms} bedrooms`} /> : null}
            {(listing.bathrooms ?? 0) > 0 ? <Stat icon="droplet" text={`${listing.bathrooms} bathrooms`} /> : null}
            {(listing.garages ?? 0) > 0 ? <Stat icon="truck" text={`${listing.garages} garages`} /> : null}
            {(listing.landAreaSqm ?? 0) > 0 ? <Stat icon="maximize-2" text={`${listing.landAreaSqm?.toLocaleString()} sqm land`} /> : null}
            {(listing.floorAreaSqm ?? 0) > 0 ? <Stat icon="move" text={`${listing.floorAreaSqm?.toLocaleString()} sqm floor`} /> : null}
          </View>

          {!!listing.description && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>About this property</Text>
              <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{listing.description}</Text>
            </View>
          )}

          {listing.features.length ? (
            <View style={styles.featureWrap}>
              {listing.features.map((feature) => (
                <View key={feature} style={[styles.feature, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.featureText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>{feature}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.analysisCta, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.analysisTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>Full analysis</Text>
              <Text style={[styles.analysisCopy, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                Check whether this property is suitable for development, feasibility, costs, and ways to maximise return on investment.
              </Text>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={handleAnalyse} activeOpacity={0.86}>
              <Feather name="cpu" size={17} color="#fff" />
              <Text style={[styles.primaryText, { fontFamily: "DM_Sans_700Bold" }]}>Full analysis</Text>
            </TouchableOpacity>
          </View>

          {listing.externalUrl ? (
            <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={openExternal}>
              <Feather name="external-link" size={17} color={colors.accent} />
              <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>View source listing</Text>
            </TouchableOpacity>
          ) : null}

          <View style={[styles.agentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {agentAvatar ? (
              <Image source={{ uri: agentAvatar }} style={styles.agentAvatarImage} />
            ) : (
              <View style={[styles.agentAvatar, { backgroundColor: colors.accent + "18" }]}>
                <Text style={[styles.agentInitial, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
                  {agentName.trim().slice(0, 1).toUpperCase() || "A"}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.agentName, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{agentName}</Text>
              <Text style={[styles.agency, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{agency}</Text>
            </View>
          </View>

          <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={17} color={colors.accent} />
            <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>Back to results</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon} size={13} color={colors.mutedForeground} />
      <Text style={[styles.statText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12 },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: "#FAFAF9", fontFamily: "DM_Sans_700Bold", fontSize: 16 },
  heroImage: { height: 260 },
  heroPlaceholder: { height: 220, alignItems: "center", justifyContent: "center" },
  content: { padding: 18, gap: 14 },
  price: { fontSize: 26, lineHeight: 32 },
  address: { fontSize: 17, lineHeight: 24 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  statText: { fontSize: 12 },
  section: { gap: 7, marginTop: 4 },
  sectionTitle: { fontSize: 16 },
  body: { fontSize: 14, lineHeight: 22 },
  featureWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  feature: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  featureText: { fontSize: 12 },
  analysisCta: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  analysisTitle: { fontSize: 16 },
  analysisCopy: { fontSize: 13, lineHeight: 19 },
  agentCard: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderRadius: 14, padding: 13 },
  agentAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  agentAvatarImage: { width: 42, height: 42, borderRadius: 21 },
  agentInitial: { fontSize: 17 },
  agentName: { fontSize: 15 },
  agency: { fontSize: 12, marginTop: 2 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  primaryBtn: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  primaryText: { color: "#fff", fontSize: 15 },
  secondaryBtn: { minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  secondaryText: { fontSize: 14 },
  emptyTitle: { fontSize: 18 },
});
