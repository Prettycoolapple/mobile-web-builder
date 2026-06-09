import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
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
import { useT } from "@/lib/i18n";
import { useMaybeTranslated } from "@/hooks/useMaybeTranslated";
import { getApiBase } from "@/lib/api";
import { shareListing } from "@/lib/propertyShares";
import {
  BrowseListing,
  fetchListingAgentContact,
  fetchListingEnrichment,
  fetchPublicListing,
  isListingSponsored,
  resolveListingImageUrl,
  selectedListingContextFromBrowse,
} from "@/lib/browseListings";

const GENERIC_LISTING_DESCRIPTION = "Curated from live NZ marketplace listings. Analyse this property in Project Alpha for feasibility context.";

function needsDescriptionEnrichment(listing: BrowseListing | null): boolean {
  if (!listing || listing.source !== "curated" || !listing.externalUrl) return false;
  const description = listing.description?.trim();
  return !description || description === GENERIC_LISTING_DESCRIPTION;
}

function hasSourceDescription(listing: BrowseListing): boolean {
  const description = listing.description?.trim();
  return !!description && description !== GENERIC_LISTING_DESCRIPTION;
}

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
  const { t } = useT();
  const initial = useMemo(() => parsePreview(preview), [preview]);
  const [listing, setListing] = useState<BrowseListing | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [enriching, setEnriching] = useState(false);
  const [resolvingAgent, setResolvingAgent] = useState(false);
  const agentLookupDoneRef = useRef(false);
  // Translate the agent/marketplace prose to the user's OS locale (no-op for EN
  // or already-Chinese text). Called unconditionally before any early return.
  const translatedDescription = useMaybeTranslated(listing?.description ?? "");

  useEffect(() => {
    if (!id) return;
    // Curated discovery / shared cards have no backing DB row — they rely on the
    // preview payload (plus the curated enrichment effect below). Internal
    // Project Alpha listings DO have a row, so we always refetch the authoritative
    // record to surface every agent-entered field (garages, toilets, floor area,
    // features, etc.) even if the card preview carried only a subset.
    if (initial && (id.startsWith("generic_") || id.startsWith("shared_"))) {
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

  useEffect(() => {
    if (!listing || !needsDescriptionEnrichment(listing)) return;
    const enrichmentUrl = listing.externalUrl;
    if (!enrichmentUrl) return;
    let mounted = true;
    setEnriching(true);
    fetchListingEnrichment(getApiHeaders(), enrichmentUrl)
      .then((details) => {
        if (!mounted || !details) return;
        setListing((current) => {
          if (!current) return current;
          return {
            ...current,
            listingTitle: details.listingTitle ?? current.listingTitle,
            description: details.description ?? current.description,
            features: Array.isArray(details.features) && details.features.length ? details.features : current.features,
            imageUrls: Array.isArray(details.imageUrls) && details.imageUrls.length ? details.imageUrls : current.imageUrls,
            propertyType: details.propertyType ?? current.propertyType,
            bedrooms: details.bedrooms ?? current.bedrooms,
            bathrooms: details.bathrooms ?? current.bathrooms,
            landAreaSqm: details.landAreaSqm ?? current.landAreaSqm,
            floorAreaSqm: details.floorAreaSqm ?? current.floorAreaSqm,
            priceNzd: details.priceNzd ?? current.priceNzd,
            priceDisplay: details.priceDisplay ?? current.priceDisplay,
            agent: {
              ...(current.agent ?? {}),
              fullName: details.agentName ?? current.agent?.fullName ?? "Listing agent",
              agencyName: details.agencyName ?? current.agent?.agencyName ?? null,
              avatarUrl: details.agentAvatarUrl ?? current.agent?.avatarUrl ?? null,
              isVerified: current.agent?.isVerified ?? false,
            },
          };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setEnriching(false);
      });
    return () => {
      mounted = false;
    };
  }, [getApiHeaders, listing]);

  // Resolve a callable agent (incl. phone) for curated/external listings that
  // didn't already arrive with a number. Internal Project Alpha listings carry
  // the agent's phone in their payload, so we never scrape for those. The ref
  // guard ensures we only attempt the lookup once per screen (the merge below
  // mutates `listing`, which would otherwise re-trigger this effect).
  useEffect(() => {
    if (!listing || listing.source !== "curated") return;
    if (listing.agent?.phone || !listing.address) return;
    if (agentLookupDoneRef.current) return;
    agentLookupDoneRef.current = true;

    let mounted = true;
    setResolvingAgent(true);
    fetchListingAgentContact(getApiHeaders(), {
      address: listing.address,
      listingUrl: listing.externalUrl ?? null,
      selectedListingContext: selectedListingContextFromBrowse(listing),
    })
      .then((contact) => {
        if (!mounted || !contact) return;
        setListing((current) => {
          if (!current) return current;
          return {
            ...current,
            agent: {
              ...(current.agent ?? {}),
              fullName: contact.agentName ?? current.agent?.fullName ?? "Listing agent",
              agencyName: contact.agencyName ?? current.agent?.agencyName ?? null,
              avatarUrl: contact.agentAvatarUrl ?? current.agent?.avatarUrl ?? null,
              phone: contact.agentPhone ?? current.agent?.phone ?? null,
              isVerified: current.agent?.isVerified ?? false,
            },
          };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setResolvingAgent(false);
      });
    return () => {
      mounted = false;
    };
  }, [getApiHeaders, listing]);

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
        <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.unavailable")}</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{t("pdp.back")}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const images = listing.imageUrls.map(resolveListingImageUrl).filter(Boolean) as string[];
  const agentName = listing.agent?.fullName?.trim() || t("lcard.agent_fallback");
  const agency = listing.agent?.agencyName ?? (listing.source === "internal" ? t("lcard.agency_internal") : t("pdp.agency_external"));
  const agentAvatar = resolveListingImageUrl(listing.agent?.avatarUrl);
  const agentPhone = listing.agent?.phone?.trim() || null;
  const showSourceDescription = hasSourceDescription(listing);

  const logAgentCallEvent = () => {
    try {
      void fetch(`${getApiBase()}/agent-call-event`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ agentPhone, agentName, agencyName: agency, propertyAddress: listing.address }),
      }).catch(() => {});
    } catch {
      // swallow — logging failure must not affect the call
    }
  };

  const handleCall = async () => {
    if (!agentPhone) return;
    logAgentCallEvent();
    const telUrl = `tel:${agentPhone.replace(/[^\d+]/g, "")}`;
    const canOpen = await Linking.canOpenURL(telUrl).catch(() => false);
    if (canOpen) await Linking.openURL(telUrl);
    else Alert.alert(t("pdp.cant_call_title"), t("pdp.cant_call_body"));
  };

  const handleMessage = async () => {
    if (!agentPhone) return;
    const digits = agentPhone.replace(/[^\d+]/g, "");
    const body = `Hi, I saw ${listing.address} on Project Alpha app, I would like to know more about it. Can you send me the LIM report and property title? Thanks`;
    // The SMS body separator differs by platform: iOS uses "&body=", Android "?body=".
    const smsUrl = Platform.OS === "ios"
      ? `sms:${digits}&body=${encodeURIComponent(body)}`
      : `sms:${digits}?body=${encodeURIComponent(body)}`;
    const canOpen = await Linking.canOpenURL(smsUrl).catch(() => false);
    if (canOpen) await Linking.openURL(smsUrl);
    else Alert.alert(t("pdp.cant_message_title"), t("pdp.cant_message_body"));
  };

  const handleViewListing = async () => {
    if (!listing.externalUrl) return;
    const canOpen = await Linking.canOpenURL(listing.externalUrl).catch(() => false);
    if (canOpen) await Linking.openURL(listing.externalUrl);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color="#FAFAF9" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("pdp.header")}</Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t("pdp.share")}>
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
          {isListingSponsored(listing) ? (
            <View style={[styles.sponsoredBadge, { backgroundColor: colors.accent + "16", borderColor: colors.accent + "44" }]}>
              <Text style={[styles.sponsoredBadgeText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>{t("lcard.sponsored")}</Text>
            </View>
          ) : null}
          <Text style={[styles.price, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            {listing.priceDisplay || (listing.priceNzd ? `$${listing.priceNzd.toLocaleString("en-NZ")}` : t("common.price_on_application"))}
          </Text>
          <Text style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{listing.address}</Text>

          <View style={styles.statsRow}>
            {(listing.bedrooms ?? 0) > 0 ? <Stat icon="home" text={t("pdp.bedrooms", { n: listing.bedrooms ?? 0 })} /> : null}
            {(listing.bathrooms ?? 0) > 0 ? <Stat icon="droplet" text={t("pdp.bathrooms", { n: listing.bathrooms ?? 0 })} /> : null}
            {(listing.toilets ?? 0) > 0 ? <Stat icon="circle" text={t("pdp.toilets", { n: listing.toilets ?? 0 })} /> : null}
            {(listing.garages ?? 0) > 0 ? <Stat icon="truck" text={t("pdp.garages", { n: listing.garages ?? 0 })} /> : null}
            {(listing.landAreaSqm ?? 0) > 0 ? <Stat icon="maximize-2" text={t("pdp.land", { n: listing.landAreaSqm?.toLocaleString() ?? "" })} /> : null}
            {(listing.floorAreaSqm ?? 0) > 0 ? <Stat icon="move" text={t("pdp.floor", { n: listing.floorAreaSqm?.toLocaleString() ?? "" })} /> : null}
          </View>

          {showSourceDescription ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.about")}</Text>
              <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{translatedDescription}</Text>
            </View>
          ) : enriching ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.about")}</Text>
              <ActivityIndicator size="small" color={colors.accent} style={{ alignSelf: "flex-start", marginTop: 4 }} />
            </View>
          ) : null}

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
              <Text style={[styles.analysisTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.full_analysis")}</Text>
              <Text style={[styles.analysisCopy, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("pdp.analysis_copy")}
              </Text>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.accent }]} onPress={handleAnalyse} activeOpacity={0.86}>
              <Feather name="cpu" size={17} color="#fff" />
              <Text style={[styles.primaryText, { fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.full_analysis")}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.agentSection}>
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

            {agentPhone ? (
              <View style={styles.agentActions}>
                <TouchableOpacity style={[styles.callBtn, { backgroundColor: colors.accent }]} onPress={handleCall} activeOpacity={0.85}>
                  <Feather name="phone" size={16} color="#fff" />
                  <Text style={[styles.callBtnText, { fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.call_agent")}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.messageBtn, { borderColor: colors.accent }]} onPress={handleMessage} activeOpacity={0.85}>
                  <Feather name="message-circle" size={16} color={colors.accent} />
                  <Text style={[styles.messageBtnText, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.send_message")}</Text>
                </TouchableOpacity>
              </View>
            ) : resolvingAgent ? (
              <View style={styles.agentResolving}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.agentResolvingText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  {t("pdp.finding_number")}
                </Text>
              </View>
            ) : listing.externalUrl ? (
              <TouchableOpacity style={[styles.messageBtn, { borderColor: colors.accent }]} onPress={handleViewListing} activeOpacity={0.85}>
                <Feather name="external-link" size={16} color={colors.accent} />
                <Text style={[styles.messageBtnText, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{t("pdp.view_listing")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity style={[styles.secondaryBtn, { borderColor: colors.border }]} onPress={() => router.back()}>
            <Feather name="arrow-left" size={17} color={colors.accent} />
            <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{t("pdp.back_to_results")}</Text>
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
  sponsoredBadge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginBottom: -4 },
  sponsoredBadgeText: { fontSize: 12 },
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
  agentSection: { gap: 10 },
  agentCard: { flexDirection: "row", alignItems: "center", gap: 11, borderWidth: 1, borderRadius: 14, padding: 13 },
  agentAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  agentAvatarImage: { width: 42, height: 42, borderRadius: 21 },
  agentInitial: { fontSize: 17 },
  agentName: { fontSize: 15 },
  agency: { fontSize: 12, marginTop: 2 },
  agentActions: { gap: 10 },
  callBtn: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  callBtnText: { color: "#fff", fontSize: 15 },
  messageBtn: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  messageBtnText: { fontSize: 15 },
  agentResolving: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  agentResolvingText: { fontSize: 13 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  primaryBtn: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  primaryText: { color: "#fff", fontSize: 15 },
  secondaryBtn: { minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  secondaryText: { fontSize: 14 },
  emptyTitle: { fontSize: 18 },
});
