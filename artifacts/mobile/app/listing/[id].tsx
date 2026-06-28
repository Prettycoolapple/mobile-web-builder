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
import { Feather, Ionicons } from "@expo/vector-icons";
import Markdown from "react-native-markdown-display";
import { useAuth } from "@/context/AuthContext";
import { useWatchlist } from "@/context/WatchlistContext";
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
  normaliseBrowseListingAgent,
  resolveListingImageUrl,
  selectedListingContextFromBrowse,
  watchlistCandidateFromBrowse,
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
  const { getApiHeaders, user } = useAuth();
  const { isWatched, toggle } = useWatchlist();
  const { t } = useT();
  const initial = useMemo(() => parsePreview(preview), [preview]);
  const [listing, setListing] = useState<BrowseListing | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [enriching, setEnriching] = useState(false);
  const [resolvingAgent, setResolvingAgent] = useState(false);
  const agentLookupKeyRef = useRef<string | null>(null);
  const agentLookupSeqRef = useRef(0);
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
          const currentAgent = normaliseBrowseListingAgent(current.agent);
          const mergedAgent = normaliseBrowseListingAgent({
            ...(currentAgent ?? {}),
            fullName: details.agentName ?? currentAgent?.fullName ?? null,
            agencyName: details.agencyName ?? currentAgent?.agencyName ?? null,
            avatarUrl: details.agentAvatarUrl ?? currentAgent?.avatarUrl ?? null,
            isVerified: currentAgent?.isVerified ?? false,
          });
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
            agent: mergedAgent,
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
  // didn't already arrive with a number. Keep this passive lookup short and
  // keyed to the current listing so stale responses never update another card.
  useEffect(() => {
    if (!listing || listing.source !== "curated") return;
    const lookupKey = listing.externalUrl ?? listing.id;
    const agent = normaliseBrowseListingAgent(listing.agent);
    if (agent?.phone || !listing.address || !listing.externalUrl || agentLookupKeyRef.current === lookupKey) return;
    agentLookupKeyRef.current = lookupKey;
    const lookupSeq = agentLookupSeqRef.current + 1;
    agentLookupSeqRef.current = lookupSeq;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let mounted = true;
    setResolvingAgent(true);
    fetchListingAgentContact(getApiHeaders(), {
      address: listing.address,
      listingUrl: listing.externalUrl ?? null,
      selectedListingContext: selectedListingContextFromBrowse(listing),
    }, controller.signal)
      .then((contact) => {
        if (!mounted || lookupSeq !== agentLookupSeqRef.current || !contact) return;
        setListing((current) => {
          if (!current) return current;
          const currentKey = current.externalUrl ?? current.id;
          if (currentKey !== lookupKey) return current;
          const currentAgent = normaliseBrowseListingAgent(current.agent);
          const mergedAgent = normaliseBrowseListingAgent({
            ...(currentAgent ?? {}),
            fullName: contact.agentName ?? currentAgent?.fullName ?? null,
            agencyName: contact.agencyName ?? currentAgent?.agencyName ?? null,
            avatarUrl: contact.agentAvatarUrl ?? currentAgent?.avatarUrl ?? null,
            phone: contact.agentPhone ?? currentAgent?.phone ?? null,
            isVerified: currentAgent?.isVerified ?? false,
          });
          return {
            ...current,
            agent: mergedAgent,
          };
        });
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        if (mounted && lookupSeq === agentLookupSeqRef.current) setResolvingAgent(false);
      });
    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [getApiHeaders, listing?.address, listing?.agent?.phone, listing?.externalUrl, listing?.id, listing?.source]);

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

  const watchCandidate = useMemo(() => (listing ? watchlistCandidateFromBrowse(listing) : null), [listing]);
  const watched = watchCandidate ? isWatched(watchCandidate) : false;

  const promptSignInForWatchlist = useCallback(() => {
    const goLogin = () => router.push("/(auth)/login" as never);
    const goSignup = () => router.push("/(auth)/signup" as never);
    if (Platform.OS === "web") {
      goSignup();
      return;
    }
    Alert.alert(t("watchlist.signin_title"), t("watchlist.signin_body"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("login.submit"), onPress: goLogin },
      { text: t("signup.create_account"), onPress: goSignup },
    ]);
  }, [router, t]);

  const handleToggleWatch = useCallback(async () => {
    if (!watchCandidate) return;
    if (!user) {
      promptSignInForWatchlist();
      return;
    }
    await toggle(watchCandidate);
  }, [user, promptSignInForWatchlist, toggle, watchCandidate]);

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
  const agent = normaliseBrowseListingAgent(listing.agent);
  const agentName = agent?.fullName?.trim() || t("lcard.agent_fallback");
  const agency = agent?.agencyName ?? (listing.source === "internal" ? t("lcard.agency_internal") : null);
  const agentAvatar = resolveListingImageUrl(agent?.avatarUrl);
  const agentPhone = agent?.phone?.trim() || null;
  const showSourceDescription = hasSourceDescription(listing);

  const logAgentCallEvent = () => {
    try {
      void fetch(`${getApiBase()}/agent-call-event`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ agentPhone, agentName, agencyName: agency ?? null, propertyAddress: listing.address }),
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

  const descriptionMarkdownStyles = {
    body: {
      color: colors.mutedForeground,
      fontFamily: "DM_Sans_400Regular",
      fontSize: 15,
      lineHeight: 22,
    },
    strong: { fontFamily: "DM_Sans_700Bold", color: colors.foreground },
    em: { fontFamily: "DM_Sans_400Regular", fontStyle: "italic" as const },
    paragraph: { marginTop: 0, marginBottom: 8 },
    bullet_list: { marginBottom: 8 },
    ordered_list: { marginBottom: 8 },
    bullet_list_icon: { color: colors.accent, marginTop: 8 },
    heading1: { fontFamily: "DM_Sans_700Bold", fontSize: 17, color: colors.foreground, marginBottom: 6, marginTop: 4 },
    heading2: { fontFamily: "DM_Sans_700Bold", fontSize: 16, color: colors.foreground, marginBottom: 6, marginTop: 4 },
    heading3: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, color: colors.foreground, marginBottom: 4, marginTop: 4 },
    link: { color: colors.accent },
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}>
        <View style={styles.headerSide}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Feather name="arrow-left" size={22} color="#FAFAF9" />
          </TouchableOpacity>
        </View>
        <Text style={styles.headerTitle}>{t("pdp.header")}</Text>
        <View style={[styles.headerSide, styles.headerActions]}>
          <TouchableOpacity
            onPress={handleToggleWatch}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={watched ? t("watchlist.remove") : t("watchlist.add")}
          >
            <Ionicons name={watched ? "heart" : "heart-outline"} size={21} color={watched ? "#ef4444" : "#FAFAF9"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={t("pdp.share")}>
            <Feather name="log-out" size={20} color="#FAFAF9" />
          </TouchableOpacity>
        </View>
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
              <Markdown style={descriptionMarkdownStyles as any}>{translatedDescription}</Markdown>
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
            {agent ? (
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
                  {agency ? (
                    <Text style={[styles.agency, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{agency}</Text>
                  ) : null}
                </View>
              </View>
            ) : null}

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
  headerSide: { width: 84, flexDirection: "row", alignItems: "center" },
  headerActions: { justifyContent: "flex-end" },
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
