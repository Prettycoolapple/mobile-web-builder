import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { BrowseListing, resolveListingImageUrl } from "@/lib/browseListings";

function formatPropertyType(value: string | null | undefined): string {
  if (!value) return "Property";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function BrowseListingCard({ listing, onPress }: { listing: BrowseListing; onPress: () => void }) {
  const colors = useColors();
  const cover = resolveListingImageUrl(listing.imageUrls?.[0]);
  const agentName = listing.agent?.fullName ?? "Listing agent";
  const agency = listing.agent?.agencyName ?? (listing.source === "internal" ? "Project Alpha agent" : "Curated listing");

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}
      onPress={onPress}
      activeOpacity={0.84}
    >
      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} />
      ) : (
        <View style={[styles.coverPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="home" size={30} color={colors.mutedForeground} />
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.priceRow}>
          <Text style={[styles.price, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]} numberOfLines={1}>
            {listing.priceDisplay || (listing.priceNzd ? `$${listing.priceNzd.toLocaleString("en-NZ")}` : "Price on application")}
          </Text>
          {listing.source === "internal" ? (
            <View style={[styles.badge, { backgroundColor: colors.accent + "16", borderColor: colors.accent + "44" }]}>
              <Text style={[styles.badgeText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>Alpha</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
          {listing.address}
        </Text>
        <Text style={[styles.sub, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
          {listing.listingType === "for_sale" ? "For sale" : "For rent"} · {formatPropertyType(listing.propertyType)}
        </Text>
        <View style={styles.stats}>
          {(listing.bedrooms ?? 0) > 0 ? <Stat icon="home" text={`${listing.bedrooms} bd`} /> : null}
          {(listing.bathrooms ?? 0) > 0 ? <Stat icon="droplet" text={`${listing.bathrooms} ba`} /> : null}
          {(listing.garages ?? 0) > 0 ? <Stat icon="truck" text={`${listing.garages} gar`} /> : null}
          {(listing.landAreaSqm ?? 0) > 0 ? <Stat icon="maximize-2" text={`${listing.landAreaSqm?.toLocaleString()} sqm`} /> : null}
        </View>
        <View style={[styles.agentRow, { borderTopColor: colors.border }]}>
          <View style={[styles.agentAvatar, { backgroundColor: colors.accent + "18" }]}>
            <Text style={[styles.agentInitial, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
              {agentName.trim().slice(0, 1).toUpperCase() || "A"}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.agentName, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
              {agentName}
            </Text>
            <Text style={[styles.agency, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
              {agency}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function Stat({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.stat}>
      <Feather name={icon} size={12} color={colors.mutedForeground} />
      <Text style={[styles.statText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  cover: { width: "100%", height: 176 },
  coverPlaceholder: { width: "100%", height: 150, alignItems: "center", justifyContent: "center" },
  body: { padding: 13, gap: 6 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  price: { flex: 1, fontSize: 18 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11 },
  address: { fontSize: 15, lineHeight: 20 },
  sub: { fontSize: 12 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 2 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 12 },
  agentRow: { flexDirection: "row", alignItems: "center", gap: 9, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 4 },
  agentAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  agentInitial: { fontSize: 13 },
  agentName: { fontSize: 13 },
  agency: { fontSize: 11, marginTop: 1 },
});
