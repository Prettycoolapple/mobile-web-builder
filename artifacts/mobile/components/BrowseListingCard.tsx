import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";
import { useMaybeTranslated } from "@/hooks/useMaybeTranslated";
import { BrowseListing, isListingSponsored, resolveListingImageUrl } from "@/lib/browseListings";

const PROPERTY_TYPE_KEYS = new Set([
  "house", "apartment", "townhouse", "unit", "section", "commercial", "industrial", "rural", "other",
]);

function propertyTypeLabel(t: (k: string) => string, value: string | null | undefined): string {
  const key = value?.trim().toLowerCase();
  if (key && PROPERTY_TYPE_KEYS.has(key)) return t(`ptype.${key}`);
  return t("ptype.property");
}

export function BrowseListingCard({ listing, onPress, onShare }: { listing: BrowseListing; onPress: () => void; onShare?: () => void }) {
  const colors = useColors();
  const { t } = useT();
  const cover = resolveListingImageUrl(listing.imageUrls?.[0]);
  const hasAgent = !!(listing.agent?.fullName || listing.agent?.agencyName || listing.agent?.avatarUrl);
  const agentName = listing.agent?.fullName ?? t("lcard.agent_fallback");
  const agency = listing.agent?.agencyName ?? (listing.source === "internal" ? t("lcard.agency_internal") : t("lcard.agency_curated"));
  const agentAvatar = resolveListingImageUrl(listing.agent?.avatarUrl);
  const description = useMaybeTranslated(listing.description);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}
      onPress={onPress}
      activeOpacity={0.84}
    >
      {cover ? (
        <View>
          <Image source={{ uri: cover }} style={styles.cover} />
          {onShare ? <ShareButton onPress={onShare} /> : null}
        </View>
      ) : (
        <View style={[styles.coverPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="home" size={30} color={colors.mutedForeground} />
          {onShare ? <ShareButton onPress={onShare} /> : null}
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.priceRow}>
          <Text style={[styles.price, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]} numberOfLines={1}>
            {listing.priceDisplay || (listing.priceNzd ? `$${listing.priceNzd.toLocaleString("en-NZ")}` : t("common.price_on_application"))}
          </Text>
          {isListingSponsored(listing) ? (
            <View style={[styles.badge, { backgroundColor: colors.accent + "16", borderColor: colors.accent + "44" }]}>
              <Text style={[styles.badgeText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>{t("lcard.sponsored")}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
          {listing.address}
        </Text>
        {description ? (
          <Text style={[styles.sub, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={2}>
            {description}
          </Text>
        ) : (
          <Text style={[styles.sub, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
            {listing.listingType === "for_sale" ? t("lcard.for_sale") : t("lcard.for_rent")} · {propertyTypeLabel(t, listing.propertyType)}
          </Text>
        )}
        <View style={styles.stats}>
          {(listing.bedrooms ?? 0) > 0 ? <Stat icon="home" text={t("lcard.stat_bd", { n: listing.bedrooms ?? 0 })} /> : null}
          {(listing.bathrooms ?? 0) > 0 ? <Stat icon="droplet" text={t("lcard.stat_ba", { n: listing.bathrooms ?? 0 })} /> : null}
          {(listing.toilets ?? 0) > 0 ? <Stat icon="circle" text={t("lcard.stat_wc", { n: listing.toilets ?? 0 })} /> : null}
          {(listing.garages ?? 0) > 0 ? <Stat icon="truck" text={t("lcard.stat_gar", { n: listing.garages ?? 0 })} /> : null}
          {(listing.landAreaSqm ?? 0) > 0 ? <Stat icon="maximize-2" text={t("lcard.stat_sqm", { n: listing.landAreaSqm?.toLocaleString() ?? "" })} /> : null}
        </View>
        {hasAgent ? (
          <View style={[styles.agentRow, { borderTopColor: colors.border }]}>
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
              <Text style={[styles.agentName, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
                {agentName}
              </Text>
              <Text style={[styles.agency, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
                {agency}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </View>
        ) : (
          <View style={[styles.agentRow, { borderTopColor: colors.border }]}>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginLeft: "auto" }} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

function ShareButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[styles.shareBtn, { backgroundColor: "rgba(255,255,255,0.92)", borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel="Share listing"
    >
      <Feather name="log-out" size={15} color={colors.foreground} />
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
  coverPlaceholder: { width: "100%", height: 150, alignItems: "center", justifyContent: "center", position: "relative" },
  shareBtn: { position: "absolute", top: 10, left: 10, width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
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
  agentAvatarImage: { width: 30, height: 30, borderRadius: 15 },
  agentInitial: { fontSize: 13 },
  agentName: { fontSize: 13 },
  agency: { fontSize: 11, marginTop: 1 },
});
