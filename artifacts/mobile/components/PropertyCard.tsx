import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { PropertyCandidate, SelectedListingContext } from "@/context/ChatContext";
import { StarRating } from "@/components/StarRating";
import { useT } from "@/lib/i18n";
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";

interface Props {
  candidate: PropertyCandidate;
  onAnalyse: (address: string, photoUrl?: string | null, listingUrl?: string | null, selectedListingContext?: SelectedListingContext | null) => void;
}

function inferListingSourceFromUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("trademe.co.nz")) return "trademe";
    if (host.includes("homes.co.nz")) return "homes";
    if (host.includes("oneroof.co.nz")) return "oneroof";
    if (host.includes("realestate.co.nz")) return "realestate.co.nz";
    if (host.includes("hougarden.com")) return "hougarden";
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function selectedListingContextFromCandidate(candidate: PropertyCandidate): SelectedListingContext {
  return {
    address: candidate.address,
    listingUrl: candidate.listingUrl ?? null,
    photoUrl: candidate.photoUrl ?? null,
    photoUrls: candidate.photoUrl ? [candidate.photoUrl] : [],
    price: candidate.price > 0 ? candidate.price : null,
    landArea: candidate.landArea ?? null,
    floorArea: candidate.floorArea ?? null,
    bedrooms: candidate.bedrooms ?? null,
    bathrooms: candidate.bathrooms ?? null,
    bedroomsApprox: candidate.bedroomsApprox ?? null,
    bathroomsApprox: candidate.bathroomsApprox ?? null,
    landAreaApprox: candidate.landAreaApprox ?? null,
    floorAreaApprox: candidate.floorAreaApprox ?? null,
    priceApprox: candidate.priceApprox ?? null,
    source: inferListingSourceFromUrl(candidate.listingUrl),
  };
}

function scoreColor(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 4) return colors.success;
  if (score >= 2.5) return "#F59E0B";
  return colors.red;
}

function ScorePip({ score, label, loading }: { score: number; label: string; loading?: boolean }) {
  const colors = useColors();
  const color = scoreColor(score, colors);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!loading) {
      opacity.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [loading]);

  return (
    <Animated.View style={[styles.pip, { opacity }]}>
      <StarRating score={score} maxStars={3} size={13} gap={2} color={loading ? colors.border : color} emptyColor={colors.border} />
      <Text style={[styles.pipLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
        {label}
      </Text>
    </Animated.View>
  );
}

function OverallCompositeBadge({
  composite,
  plain,
}: {
  composite: number;
  plain: boolean;
}) {
  const colors = useColors();
  const c = scoreColor(composite, colors);
  const onPhoto = !plain;
  return (
    <View
      style={[
        plain ? styles.overallBadgePlain : styles.overallBadge,
        onPhoto
          ? {
              borderColor: c,
              backgroundColor: "rgba(255,255,255,0.88)",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.22,
              shadowRadius: 4,
              elevation: 3,
            }
          : { borderColor: c + "88", backgroundColor: c + "33" },
      ]}
    >
      <Text style={[styles.overallBadgeNumber, { color: c, fontFamily: "DM_Sans_700Bold" }]}>
        {formatCompositeScoreForDisplay(composite)}
      </Text>
      <Text style={[styles.overallBadgeOutOf, { color: c, fontFamily: "DM_Sans_500Medium", opacity: 0.85 }]}>/5</Text>
    </View>
  );
}

export function PropertyCard({ candidate, onAnalyse }: Props) {
  const colors = useColors();
  const { t } = useT();
  const compositeRaw = candidate.scores.composite;
  const isPreliminarySubdivisionScreen = candidate.screeningStatus === "preliminary";
  const showOverall =
    !candidate.scoresLoading && typeof compositeRaw === "number" && compositeRaw > 0;
  const composite = showOverall ? compositeRaw : 0;
  const potentialLots = candidate.potentialLots ?? 0;
  const minLotSize = candidate.minLotSize ?? null;
  const passesCoreSubdivisionCardScreen =
    potentialLots >= 2 &&
    minLotSize != null &&
    minLotSize > 0 &&
    candidate.titleConfidence === "verified" &&
    candidate.typology === "standalone" &&
    candidate.landAreaConfidence === "verified" &&
    candidate.landAreaApprox !== true &&
    candidate.isParentParcelSuspect !== true &&
    candidate.isAlreadySubdividedChild !== true;
  const showVerifiedSubdivisionRecommendation =
    candidate.subdivisionEligible === true &&
    passesCoreSubdivisionCardScreen &&
    typeof candidate.buildYear === "number" &&
    candidate.buildYear < 2000;
  const showPreliminarySubdivisionRecommendation =
    isPreliminarySubdivisionScreen &&
    passesCoreSubdivisionCardScreen &&
    (candidate.buildYear == null || candidate.buildYear < 2000);
  const showSubdivisionRecommendation =
    showVerifiedSubdivisionRecommendation || showPreliminarySubdivisionRecommendation;
  const subdivisionRuleText = minLotSize ? t("search.subdivision_rule", { min: minLotSize }) : null;
  const subdivisionScreeningText = showPreliminarySubdivisionRecommendation
    ? t("search.subdivision_prescreen_preliminary")
    : t("search.subdivision_prescreen");
  const showLandUnavailable =
    candidate.landArea == null &&
    (candidate.typology === "unit_apartment" ||
      candidate.subdivisionRejectReason === "unit_or_crosslease_signal" ||
      candidate.isParentParcelSuspect === true);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {candidate.photoUrl ? (
        <View style={styles.photoWrapper}>
          <Image
            source={{ uri: candidate.photoUrl }}
            style={styles.photo}
            resizeMode="cover"
          />
          {showOverall ? <OverallCompositeBadge composite={composite} plain={false} /> : null}
        </View>
      ) : (
        <View style={[styles.photoPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="home" size={28} color={colors.mutedForeground} style={{ opacity: 0.4 }} />
          {showOverall ? <OverallCompositeBadge composite={composite} plain /> : null}
        </View>
      )}

      <View style={styles.body}>
        <Text
          style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}
          numberOfLines={2}
        >
          {candidate.address}
        </Text>

        <View style={styles.tagRow}>
          {candidate.price > 0 && (
            <View style={[styles.tag, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                {candidate.priceApprox ? "~" : ""}${(candidate.price / 1_000_000).toFixed(2)}M
              </Text>
            </View>
          )}
          {candidate.landArea != null && candidate.landArea > 0 && (
            <View style={[styles.tag, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                {candidate.landAreaApprox ? "~" : ""}{candidate.landArea}m²
              </Text>
            </View>
          )}
          {showLandUnavailable && (
            <View style={[styles.tag, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
                {t("search.land_unavailable_contact")}
              </Text>
            </View>
          )}
          {typeof candidate.floorArea === "number" && candidate.floorArea > 0 && (
            <View style={[styles.tag, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                {candidate.floorAreaApprox ? "~" : ""}{candidate.floorArea}m² floor
              </Text>
            </View>
          )}
          {typeof candidate.bedrooms === "number" && candidate.bedrooms > 0 && (
            <View style={[styles.tag, { backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", gap: 3 }]}>
              <Feather name="moon" size={10} color={colors.foreground} />
              <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                {candidate.bedroomsApprox ? "~" : ""}{candidate.bedrooms} bd
              </Text>
            </View>
          )}
          {typeof candidate.bathrooms === "number" && candidate.bathrooms > 0 && (
            <View style={[styles.tag, { backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", gap: 3 }]}>
              <Feather name="droplet" size={10} color={colors.foreground} />
              <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                {candidate.bathroomsApprox ? "~" : ""}{candidate.bathrooms} ba
              </Text>
            </View>
          )}
          {!!candidate.zone?.trim() && (
            <View style={[styles.tag, { backgroundColor: colors.muted }]}>
              <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                {candidate.zone}
              </Text>
            </View>
          )}
        </View>

        {showSubdivisionRecommendation && !isPreliminarySubdivisionScreen ? (
          <View style={[styles.subdivisionBox, { backgroundColor: colors.success + "12", borderColor: colors.success + "44" }]}>
            <Feather name="check-circle" size={13} color={colors.success} />
            <Text style={[styles.subdivisionText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
              <Text style={{ color: colors.success, fontFamily: "DM_Sans_700Bold" }}>
                {t("search.subdivision_candidate", { lots: potentialLots })}
              </Text>
              {subdivisionRuleText ? ` - ${subdivisionRuleText}` : ""}
              {` - ${subdivisionScreeningText}`}
            </Text>
          </View>
        ) : null}

        <View style={[styles.scoresRow, { borderTopColor: colors.border }]}>
          <ScorePip score={candidate.scores.ease} label={t("report.ease")} loading={candidate.scoresLoading} />
          <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
          <ScorePip score={candidate.scores.cost} label={t("report.cost")} loading={candidate.scoresLoading} />
          <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
          <ScorePip score={candidate.scores.roi} label={t("report.roi")} loading={candidate.scoresLoading} />
        </View>

        {isPreliminarySubdivisionScreen ? (
          <View style={[styles.preliminaryNote, { borderTopColor: colors.border }]}>
            <Feather name="info" size={12} color={colors.mutedForeground} />
            <Text style={[styles.preliminaryNoteText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("search.preliminary_subdivision_note")}
            </Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.analyseBtn, { backgroundColor: colors.accent }]}
        onPress={() => onAnalyse(
          candidate.address,
          candidate.photoUrl ?? null,
          candidate.listingUrl ?? null,
          selectedListingContextFromCandidate(candidate),
        )}
        activeOpacity={0.8}
      >
        <Text style={[styles.analyseBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
          {t("search.full_analysis")}
        </Text>
        <Feather name="arrow-right" size={14} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(28,25,23,0.06)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  photoWrapper: {
    position: "relative",
    height: 140,
  },
  photo: {
    width: "100%",
    height: 140,
  },
  overallBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  photoPlaceholder: {
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  overallBadgePlain: {
    position: "absolute",
    top: 8,
    right: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  overallBadgeNumber: {
    fontSize: 15,
    lineHeight: 18,
  },
  overallBadgeOutOf: {
    fontSize: 11,
    lineHeight: 14,
  },
  body: {
    padding: 14,
    gap: 10,
  },
  address: {
    fontSize: 14,
    lineHeight: 20,
  },
  tagRow: {
    flexDirection: "row",
    gap: 5,
    flexWrap: "wrap",
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    maxWidth: "100%",
  },
  tagText: {
    fontSize: 11,
    flexShrink: 1,
  },
  subdivisionBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  subdivisionText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  scoresRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 11,
    justifyContent: "space-around",
    alignItems: "center",
  },
  preliminaryNote: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 9,
    flexDirection: "row",
    gap: 6,
    alignItems: "flex-start",
  },
  preliminaryNoteText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  pip: {
    alignItems: "center",
    flex: 1,
    gap: 5,
  },
  pipLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  scoreDivider: {
    width: 1,
    height: 28,
  },
  analyseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
  },
  analyseBtnText: {
    color: "#fff",
    fontSize: 14,
  },
});
