import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
  Keyboard,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { getApiBase as resolveApiBase, hasExplicitApiConfiguration } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

const PROPERTY_TYPES = [
  { key: "house", label: "House" },
  { key: "apartment", label: "Apartment" },
  { key: "townhouse", label: "Townhouse" },
  { key: "unit", label: "Unit" },
  { key: "section", label: "Section" },
  { key: "commercial", label: "Commercial" },
  { key: "rural", label: "Rural" },
  { key: "other", label: "Other" },
];

const AMENITIES = [
  "Heat pump", "Air conditioning", "Swimming pool", "Spa",
  "Double glazing", "Deck / Patio", "Ensuite", "Open plan living",
  "Sea / Water views", "Mountain views", "Modern kitchen",
  "Dishwasher", "Garden", "Solar panels", "EV charging",
  "Alarm system", "Double garage", "Off-street parking",
];

type PickedImage = {
  uri: string;
  mimeType?: string;
};

type Prediction = {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
};

export default function AddListingScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEditMode = !!editId;
  const { t } = useT();

  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [address, setAddress] = useState("");
  const [addressMeta, setAddressMeta] = useState<{
    street?: string; suburb?: string; city?: string; postcode?: string; lat?: string; lng?: string;
  }>({});
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [showPredictions, setShowPredictions] = useState(false);
  const [loadingPredictions, setLoadingPredictions] = useState(false);

  const [listingType, setListingType] = useState<"for_sale" | "for_rent">("for_sale");
  const [propertyType, setPropertyType] = useState("house");
  const [bedrooms, setBedrooms] = useState(0);
  const [bathrooms, setBathrooms] = useState(0);
  const [garages, setGarages] = useState(0);
  const [landArea, setLandArea] = useState("");
  const [floorArea, setFloorArea] = useState("");

  const [priceMode, setPriceMode] = useState<"set" | "negotiation" | "poa">("set");
  const [priceInput, setPriceInput] = useState("");

  const [description, setDescription] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getApiBase = useCallback(() => resolveApiBase(), []);

  useEffect(() => {
    if (!editId) return;
    const load = async () => {
      try {
        const resp = await fetch(`${getApiBase()}/listings/${editId}`, {
          headers: getApiHeaders(),
        });
        if (!resp.ok) return;
        const { listing } = (await resp.json()) as { listing: any };
        setAddress(listing.address ?? "");
        setAddressMeta({
          street: listing.addressStreet ?? "",
          suburb: listing.addressSuburb ?? "",
          city: listing.addressCity ?? "",
          postcode: listing.addressPostcode ?? "",
          lat: listing.lat ?? "",
          lng: listing.lng ?? "",
        });
        setListingType(listing.listingType ?? "for_sale");
        setPropertyType(listing.propertyType ?? "house");
        setBedrooms(listing.bedrooms ?? 0);
        setBathrooms(listing.bathrooms ?? 0);
        setGarages(listing.garages ?? 0);
        setLandArea(listing.landAreaSqm ? String(listing.landAreaSqm) : "");
        setFloorArea(listing.floorAreaSqm ? String(listing.floorAreaSqm) : "");
        if (listing.priceDisplay === "By Negotiation") {
          setPriceMode("negotiation");
        } else if (listing.priceDisplay === "Price on Application") {
          setPriceMode("poa");
        } else if (listing.priceNzd) {
          setPriceMode("set");
          setPriceInput(String(listing.priceNzd));
        }
        setDescription(listing.description ?? "");
        setExistingImageUrls(listing.imageUrls ?? []);
        setSelectedAmenities(listing.features ?? []);
      } catch {
        // silent
      } finally {
        setLoadingEdit(false);
      }
    };
    load();
  }, [editId, getApiBase, getApiHeaders]);

  const fetchPredictions = useCallback(
    async (q: string) => {
      if (q.trim().length < 3) {
        setPredictions([]);
        setShowPredictions(false);
        return;
      }
      setLoadingPredictions(true);
      try {
        const resp = await fetch(
          `${getApiBase()}/listings/address-autocomplete?q=${encodeURIComponent(q)}`,
          { headers: getApiHeaders() }
        );
        const data = (await resp.json()) as { predictions?: Prediction[] };
        setPredictions(data.predictions ?? []);
        setShowPredictions((data.predictions ?? []).length > 0);
      } catch {
        setPredictions([]);
      } finally {
        setLoadingPredictions(false);
      }
    },
    [getApiBase, getApiHeaders]
  );

  const handleAddressChange = useCallback(
    (text: string) => {
      setAddress(text);
      setAddressMeta({});
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchPredictions(text), 320);
    },
    [fetchPredictions]
  );

  const handleSelectPrediction = useCallback(
    async (prediction: Prediction) => {
      setAddress(prediction.description);
      setShowPredictions(false);
      setPredictions([]);
      Keyboard.dismiss();
      try {
        const resp = await fetch(
          `${getApiBase()}/listings/place-details/${prediction.place_id}`,
          { headers: getApiHeaders() }
        );
        const data = (await resp.json()) as { result?: { geometry?: { location?: { lat: number; lng: number } }; address_components?: { types: string[]; long_name: string }[] } };
        if (data.result) {
          const comps = data.result.address_components ?? [];
          const get = (type: string) => comps.find((c) => c.types.includes(type))?.long_name ?? "";
          setAddressMeta({
            street: `${get("street_number")} ${get("route")}`.trim(),
            suburb: get("sublocality") || get("locality"),
            city: get("administrative_area_level_1"),
            postcode: get("postal_code"),
            lat: String(data.result.geometry?.location?.lat ?? ""),
            lng: String(data.result.geometry?.location?.lng ?? ""),
          });
        }
      } catch {}
    },
    [getApiBase, getApiHeaders]
  );

  const handlePickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: 15,
    });
    if (!result.canceled) {
      const newImages: PickedImage[] = result.assets.map((a) => ({
        uri: a.uri,
        mimeType: a.mimeType ?? "image/jpeg",
      }));
      setImages((prev) => [...prev, ...newImages].slice(0, 15));
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const toggleAmenity = useCallback((item: string) => {
    Haptics.selectionAsync();
    setSelectedAmenities((prev) =>
      prev.includes(item) ? prev.filter((a) => a !== item) : [...prev, item]
    );
  }, []);

  const uploadImage = useCallback(
    async (img: PickedImage): Promise<string | null> => {
      try {
        const filename = img.uri.split("/").pop() ?? `listing-${Date.now()}.jpg`;
        const formData = new FormData();
        formData.append("file", { uri: img.uri, type: img.mimeType ?? "image/jpeg", name: filename } as any);
        const resp = await fetch(`${getApiBase()}/upload/listing-image`, {
          method: "POST",
          headers: getApiHeaders(),
          body: formData,
        });
        if (!resp.ok) return null;
        const data = (await resp.json()) as { fileUrl?: string };
        return data.fileUrl ?? null;
      } catch {
        return null;
      }
    },
    [getApiBase, getApiHeaders]
  );

  const handleSubmit = useCallback(async () => {
    if (!address.trim()) {
      Alert.alert(t("add_listing.address_required_title"), t("add_listing.address_required_body"));
      return;
    }
    setSubmitting(true);
    try {
      const newlyUploadedUrls: string[] = [];
      for (const img of images) {
        const url = await uploadImage(img);
        if (url) newlyUploadedUrls.push(url);
      }
      const allImageUrls = [...existingImageUrls, ...newlyUploadedUrls];

      let priceNzd: number | undefined;
      let priceDisplay: string | undefined;
      if (priceMode === "set" && priceInput.trim()) {
        const raw = priceInput.replace(/[^0-9]/g, "");
        priceNzd = parseInt(raw, 10) || undefined;
        priceDisplay = priceNzd ? `$${priceNzd.toLocaleString("en-NZ")}` : undefined;
      } else if (priceMode === "negotiation") {
        priceDisplay = "By Negotiation";
      } else if (priceMode === "poa") {
        priceDisplay = "Price on Application";
      }

      const payload = {
        address: address.trim(),
        addressStreet: addressMeta.street,
        addressSuburb: addressMeta.suburb,
        addressCity: addressMeta.city,
        addressPostcode: addressMeta.postcode,
        lat: addressMeta.lat,
        lng: addressMeta.lng,
        listingType,
        propertyType,
        bedrooms: bedrooms || undefined,
        bathrooms: bathrooms || undefined,
        garages: garages || undefined,
        landAreaSqm: landArea ? parseInt(landArea.replace(/[^0-9]/g, ""), 10) || undefined : undefined,
        floorAreaSqm: floorArea ? parseInt(floorArea.replace(/[^0-9]/g, ""), 10) || undefined : undefined,
        priceNzd,
        priceDisplay,
        description: description.trim() || undefined,
        imageUrls: allImageUrls,
        features: selectedAmenities,
      };

      const url = isEditMode ? `${getApiBase()}/listings/${editId}` : `${getApiBase()}/listings`;
      const method = isEditMode ? "PATCH" : "POST";

      const resp = await fetch(url, {
        method,
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const err = (await resp.json()) as { error?: string };
        Alert.alert(t("common.error"), err.error ?? t("add_listing.submit_error"));
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessVisible(true);
    } catch {
      Alert.alert(t("common.error"), t("common.try_again_later"));
    } finally {
      setSubmitting(false);
    }
  }, [
    address, addressMeta, listingType, propertyType,
    bedrooms, bathrooms, garages, landArea, floorArea,
    priceMode, priceInput, description, images, existingImageUrls, selectedAmenities,
    uploadImage, getApiBase, getApiHeaders, isEditMode, editId,
  ]);

  const handleSuccessDismiss = useCallback(() => {
    setSuccessVisible(false);
    router.back();
  }, [router]);

  if (loadingEdit) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg, borderBottomColor: colors.accent + "22" }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} activeOpacity={0.7}>
            <Feather name="x" size={22} color="rgba(250,249,246,0.8)" />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { fontFamily: "DM_Sans_700Bold", color: "#FAFAF9" }]}>{t("add_listing.edit")}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg, borderBottomColor: colors.accent + "22" }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} activeOpacity={0.7}>
          <Feather name="x" size={22} color="rgba(250,249,246,0.8)" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { fontFamily: "DM_Sans_700Bold", color: "#FAFAF9" }]}>
          {isEditMode ? t("add_listing.edit") : t("add_listing.new")}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* — ADDRESS — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>{t("add_listing.address")}</Text>
          <View style={[styles.addressInputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="map-pin" size={16} color={colors.accent} style={{ marginLeft: 12 }} />
            <TextInput
              style={[styles.addressInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
              placeholder={t("add_listing.address_placeholder")}
              placeholderTextColor={colors.mutedForeground}
              value={address}
              onChangeText={handleAddressChange}
              autoCorrect={false}
              autoCapitalize="words"
            />
            {loadingPredictions && <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 12 }} />}
          </View>

          {showPredictions && predictions.length > 0 && (
            <View style={[styles.predictionsBox, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}>
              {predictions.slice(0, 5).map((p, i) => (
                <TouchableOpacity
                  key={p.place_id}
                  style={[styles.predictionRow, i < predictions.slice(0, 5).length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                  onPress={() => handleSelectPrediction(p)}
                  activeOpacity={0.7}
                >
                  <Feather name="navigation" size={13} color={colors.mutedForeground} style={{ marginRight: 8, marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.predMainText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
                      {p.structured_formatting?.main_text ?? p.description.split(",")[0]}
                    </Text>
                    <Text style={[styles.predSubText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
                      {p.structured_formatting?.secondary_text ?? p.description}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {!hasExplicitApiConfiguration() && (
            <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              If address suggestions fail on a physical device, set `EXPO_PUBLIC_API_URL` in `artifacts/mobile/.env.local`.
            </Text>
          )}
        </View>

        {/* — LISTING TYPE — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Listing type</Text>
          <View style={styles.toggleRow}>
            {(["for_sale", "for_rent"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.togglePill,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  listingType === t && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                onPress={() => setListingType(t)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.togglePillText,
                  { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" },
                  listingType === t && { color: "#fff" },
                ]}>
                  {t === "for_sale" ? "For Sale" : "For Rent"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* — PROPERTY TYPE — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Property type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {PROPERTY_TYPES.map((pt) => (
              <TouchableOpacity
                key={pt.key}
                style={[
                  styles.typeChip,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  propertyType === pt.key && { backgroundColor: colors.accent + "18", borderColor: colors.accent },
                ]}
                onPress={() => setPropertyType(pt.key)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.typeChipText,
                  { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" },
                  propertyType === pt.key && { color: colors.accent },
                ]}>
                  {pt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* — KEY DETAILS — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Property details</Text>
          <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <StepperRow
              icon="home"
              label="Bedrooms"
              value={bedrooms}
              onChange={setBedrooms}
              colors={colors}
            />
            <View style={[styles.stepperDivider, { backgroundColor: colors.border }]} />
            <StepperRow
              icon="droplet"
              label="Bathrooms"
              value={bathrooms}
              onChange={setBathrooms}
              colors={colors}
            />
            <View style={[styles.stepperDivider, { backgroundColor: colors.border }]} />
            <StepperRow
              icon="truck"
              label="Garages"
              value={garages}
              onChange={setGarages}
              colors={colors}
            />
          </View>

          <View style={styles.areaRow}>
            <View style={[styles.areaField, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.areaLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Land area</Text>
              <View style={styles.areaInputRow}>
                <TextInput
                  style={[styles.areaInput, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}
                  placeholder="—"
                  placeholderTextColor={colors.mutedForeground}
                  value={landArea}
                  onChangeText={setLandArea}
                  keyboardType="numeric"
                />
                <Text style={[styles.areaUnit, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>m²</Text>
              </View>
            </View>
            <View style={[styles.areaField, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.areaLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Floor area</Text>
              <View style={styles.areaInputRow}>
                <TextInput
                  style={[styles.areaInput, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}
                  placeholder="—"
                  placeholderTextColor={colors.mutedForeground}
                  value={floorArea}
                  onChangeText={setFloorArea}
                  keyboardType="numeric"
                />
                <Text style={[styles.areaUnit, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>m²</Text>
              </View>
            </View>
          </View>
        </View>

        {/* — PRICE — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Price</Text>
          <View style={styles.priceOptions}>
            {([
              { key: "set", label: "Set price" },
              { key: "negotiation", label: "By negotiation" },
              { key: "poa", label: "Price on application" },
            ] as const).map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.priceOptionPill,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  priceMode === opt.key && { backgroundColor: colors.accent + "18", borderColor: colors.accent },
                ]}
                onPress={() => setPriceMode(opt.key)}
                activeOpacity={0.8}
              >
                <View style={[styles.radioOuter, { borderColor: priceMode === opt.key ? colors.accent : colors.mutedForeground }]}>
                  {priceMode === opt.key && <View style={[styles.radioInner, { backgroundColor: colors.accent }]} />}
                </View>
                <Text style={[
                  styles.priceOptionText,
                  { color: colors.foreground, fontFamily: "DM_Sans_400Regular" },
                  priceMode === opt.key && { color: colors.accent, fontFamily: "DM_Sans_500Medium" },
                ]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {priceMode === "set" && (
            <View style={[styles.priceInputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.currencySign, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>NZD $</Text>
              <TextInput
                style={[styles.priceInput, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}
                placeholder="e.g. 850000"
                placeholderTextColor={colors.mutedForeground}
                value={priceInput}
                onChangeText={setPriceInput}
                keyboardType="numeric"
              />
            </View>
          )}
        </View>

        {/* — DESCRIPTION — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Description</Text>
          <View style={[styles.descWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.descInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
              placeholder={"Describe the property, its highlights, and what makes it special — neighbourhood, views, recent renovations..."}
              placeholderTextColor={colors.mutedForeground}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={2000}
              textAlignVertical="top"
            />
            <Text style={[styles.charCount, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {description.length}/2000
            </Text>
          </View>
        </View>

        {/* — PHOTOS — */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Photos</Text>
            <Text style={[styles.sectionHint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Up to 15 images</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoScroll}>
            <TouchableOpacity
              style={[styles.addPhotoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handlePickImages}
              activeOpacity={0.8}
            >
              <Feather name="camera" size={22} color={colors.accent} />
              <Text style={[styles.addPhotoText, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]}>Add photos</Text>
            </TouchableOpacity>
            {existingImageUrls.map((url, i) => (
              <View key={`existing-${i}`} style={styles.photoThumbWrapper}>
                <Image source={{ uri: url.startsWith("/api/") ? `${getApiBase().replace("/api", "")}${url}` : url }} style={styles.photoThumb} />
                <TouchableOpacity
                  style={[styles.removePhotoBtn, { backgroundColor: "rgba(0,0,0,0.55)" }]}
                  onPress={() => setExistingImageUrls((prev) => prev.filter((_, idx) => idx !== i))}
                  activeOpacity={0.8}
                >
                  <Feather name="x" size={12} color="#fff" />
                </TouchableOpacity>
                {i === 0 && existingImageUrls.length > 0 && (
                  <View style={[styles.coverBadge, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.coverBadgeText, { fontFamily: "DM_Sans_600SemiBold" }]}>Cover</Text>
                  </View>
                )}
              </View>
            ))}
            {images.map((img, i) => (
              <View key={`${img.uri}-${i}`} style={styles.photoThumbWrapper}>
                <Image source={{ uri: img.uri }} style={styles.photoThumb} />
                <TouchableOpacity
                  style={[styles.removePhotoBtn, { backgroundColor: "rgba(0,0,0,0.55)" }]}
                  onPress={() => removeImage(i)}
                  activeOpacity={0.8}
                >
                  <Feather name="x" size={12} color="#fff" />
                </TouchableOpacity>
                {i === 0 && existingImageUrls.length === 0 && (
                  <View style={[styles.coverBadge, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.coverBadgeText, { fontFamily: "DM_Sans_600SemiBold" }]}>Cover</Text>
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        </View>

        {/* — AMENITIES — */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>Amenities & features</Text>
          <View style={styles.amenitiesGrid}>
            {AMENITIES.map((item) => {
              const active = selectedAmenities.includes(item);
              return (
                <TouchableOpacity
                  key={item}
                  style={[
                    styles.amenityChip,
                    { borderColor: colors.border, backgroundColor: colors.card },
                    active && { backgroundColor: colors.accent + "18", borderColor: colors.accent },
                  ]}
                  onPress={() => toggleAmenity(item)}
                  activeOpacity={0.8}
                >
                  {active && <Feather name="check" size={12} color={colors.accent} style={{ marginRight: 4 }} />}
                  <Text style={[
                    styles.amenityChipText,
                    { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" },
                    active && { color: colors.accent, fontFamily: "DM_Sans_500Medium" },
                  ]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* — SUBMIT — */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: colors.accent }, submitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Feather name="check-circle" size={18} color="#fff" />
              <Text style={[styles.submitBtnText, { fontFamily: "DM_Sans_700Bold" }]}>
                {isEditMode ? t("add_listing.save_changes") : t("add_listing.submit")}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* Success Modal */}
      <Modal visible={successVisible} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.successCard, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <View style={[styles.successIconCircle, { backgroundColor: colors.accent + "18" }]}>
              <Feather name="check-circle" size={38} color={colors.accent} />
            </View>
            <Text style={[styles.successTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
              {isEditMode ? t("add_listing.success_updated_title") : t("add_listing.success_created_title")}
            </Text>
            <Text style={[styles.successBody, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {isEditMode
                ? t("add_listing.success_updated_body")
                : t("add_listing.success_created_body")}
            </Text>
            <TouchableOpacity
              style={[styles.successBtn, { backgroundColor: colors.accent }]}
              onPress={handleSuccessDismiss}
              activeOpacity={0.85}
            >
              <Text style={[styles.successBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("common.done")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StepperRow({
  icon, label, value, onChange, colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number;
  onChange: (v: number) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.stepperRow}>
      <View style={styles.stepperLabelRow}>
        <Feather name={icon} size={16} color={colors.mutedForeground} />
        <Text style={[styles.stepperLabel, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>{label}</Text>
      </View>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          style={[styles.stepperBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
          onPress={() => { if (value > 0) { onChange(value - 1); Haptics.selectionAsync(); } }}
          activeOpacity={0.7}
        >
          <Feather name="minus" size={16} color={value > 0 ? colors.foreground : colors.mutedForeground} />
        </TouchableOpacity>
        <Text style={[styles.stepperValue, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
          {value === 0 ? "—" : value}
        </Text>
        <TouchableOpacity
          style={[styles.stepperBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
          onPress={() => { onChange(value + 1); Haptics.selectionAsync(); }}
          activeOpacity={0.7}
        >
          <Feather name="plus" size={16} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 17, flex: 1, textAlign: "center" },
  headerSpacer: { width: 34 },

  scroll: { flex: 1 },
  scrollContent: { paddingTop: 8 },

  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  sectionTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionHint: { fontSize: 12 },
  hint: { fontSize: 12, marginTop: 6, fontStyle: "italic" },

  addressInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "visible",
  },
  addressInput: { flex: 1, paddingVertical: 13, paddingHorizontal: 10, fontSize: 15 },

  predictionsBox: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 99,
  },
  predictionRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 11 },
  predMainText: { fontSize: 14 },
  predSubText: { fontSize: 12, marginTop: 1 },

  toggleRow: { flexDirection: "row", gap: 10 },
  togglePill: {
    flex: 1,
    borderRadius: 25,
    borderWidth: 1.5,
    paddingVertical: 11,
    alignItems: "center",
  },
  togglePillText: { fontSize: 14 },

  typeChip: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typeChipText: { fontSize: 13 },

  detailsCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 14,
  },
  stepperDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  stepperLabelRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepperLabel: { fontSize: 15 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: { fontSize: 17, minWidth: 22, textAlign: "center" },

  areaRow: { flexDirection: "row", gap: 12 },
  areaField: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  areaLabel: { fontSize: 11, marginBottom: 4 },
  areaInputRow: { flexDirection: "row", alignItems: "center" },
  areaInput: { flex: 1, fontSize: 18, paddingVertical: 0 },
  areaUnit: { fontSize: 13, marginLeft: 4 },

  priceOptions: { gap: 10, marginBottom: 12 },
  priceOptionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 8, height: 8, borderRadius: 4 },
  priceOptionText: { fontSize: 14 },
  priceInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  currencySign: { fontSize: 15, marginRight: 4 },
  priceInput: { flex: 1, fontSize: 17, paddingVertical: 10 },

  descWrapper: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  descInput: { fontSize: 15, minHeight: 120, lineHeight: 22 },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 8 },

  photoScroll: { gap: 10, paddingVertical: 4 },
  addPhotoBtn: {
    width: 90,
    height: 90,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addPhotoText: { fontSize: 11, textAlign: "center" },
  photoThumbWrapper: { position: "relative" },
  photoThumb: { width: 90, height: 90, borderRadius: 12 },
  removePhotoBtn: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  coverBadge: {
    position: "absolute",
    bottom: 5,
    left: 5,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  coverBadgeText: { fontSize: 10, color: "#fff" },

  amenitiesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  amenityChip: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  amenityChipText: { fontSize: 13 },

  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 32,
    borderRadius: 16,
    paddingVertical: 17,
  },
  submitBtnText: { fontSize: 17, color: "#fff" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  successCard: {
    width: "100%",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  successIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  successTitle: { fontSize: 22, marginBottom: 10, textAlign: "center" },
  successBody: { fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: 28 },
  successBtn: {
    width: "100%",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  successBtnText: { fontSize: 16, color: "#fff" },
});
