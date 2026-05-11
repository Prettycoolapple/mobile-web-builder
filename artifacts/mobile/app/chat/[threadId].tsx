import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useDm, DmMessage, type DmBlockStatus } from "@/context/DmContext";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { getApiBase, resolveAppUrl } from "@/lib/api";
import { avatarImageSource, sanitizeHeadersForImageRequest } from "@/lib/avatar";
import { useT, type Locale } from "@/lib/i18n";

function formatDiscipline(
  discipline: string | null,
  otherDiscipline: string | null,
  t: (key: string) => string,
): string {
  if (discipline === "other" && otherDiscipline) return otherDiscipline;
  const map: Record<string, string> = {
    architect_designer: t("dm.discipline.architect_designer"),
    planner: t("dm.discipline.planner"),
    engineer: t("dm.discipline.engineer"),
    quantity_surveyor: t("dm.discipline.quantity_surveyor"),
    other: t("dm.discipline.other"),
  };
  return discipline ? (map[discipline] ?? discipline) : t("dm.header.service_provider");
}

function formatTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-NZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "zh",
  });
}

function formatDateSep(iso: string, locale: Locale, t: (key: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("dm.date.today");
  if (d.toDateString() === yesterday.toDateString()) return t("dm.date.yesterday");
  return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Absolute URL for API storage images (authenticated); pass through http(s) unchanged. */
function resolveDmStoredImageUri(imageUrl: string): string {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return resolveAppUrl(path);
}

interface MessageItem {
  type: "message";
  data: DmMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}
interface DateSepItem {
  type: "date";
  label: string;
}
type ListItem = MessageItem | DateSepItem;

function buildListItems(
  messages: DmMessage[],
  locale: Locale,
  t: (key: string) => string,
): ListItem[] {
  const items: ListItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    if (!prev || !isSameDay(prev.createdAt, msg.createdAt)) {
      items.push({ type: "date", label: formatDateSep(msg.createdAt, locale, t) });
    }
    const isFirstInGroup =
      !prev || prev.senderId !== msg.senderId || !isSameDay(prev.createdAt, msg.createdAt);
    const isLastInGroup =
      !next || next.senderId !== msg.senderId || !isSameDay(msg.createdAt, next.createdAt);
    items.push({ type: "message", data: msg, isFirstInGroup, isLastInGroup });
  }
  return items;
}

function Avatar({
  name,
  avatarUrl,
  size = 32,
  authHeaders,
}: {
  name: string | null;
  avatarUrl?: string | null;
  size?: number;
  authHeaders: Record<string, string>;
}) {
  const colors = useColors();
  const source = avatarImageSource(avatarUrl ?? null, authHeaders);
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (source) {
    return (
      <Image
        source={source}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={120}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent + "22",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.38, color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }}>
        {initials}
      </Text>
    </View>
  );
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { user, token, getApiHeaders } = useAuth();
  const { socket, fetchThreads, threads } = useDm();
  const { t, locale } = useT();

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [otherName, setOtherName] = useState<string | null>(null);
  const [otherRole, setOtherRole] = useState<string>("general");
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [otherPhone, setOtherPhone] = useState<string | null>(null);
  const [otherDiscipline, setOtherDiscipline] = useState<string | null>(null);
  const [otherOtherDiscipline, setOtherOtherDiscipline] = useState<string | null>(null);
  const [otherPrimaryLanguage, setOtherPrimaryLanguage] = useState<string | null>(null);
  const [otherSecondaryLanguage, setOtherSecondaryLanguage] = useState<string | null>(null);
  const [otherAvatarUrl, setOtherAvatarUrl] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportComment, setReportComment] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [blockStatus, setBlockStatus] = useState<DmBlockStatus>({
    messagingBlocked: false,
    iBlockedThem: false,
    theyBlockedMe: false,
  });

  const flatListRef = useRef<FlatList>(null);
  const joinedRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);

  const threadFromContext = threads.find((t) => t.id === threadId);

  useEffect(() => {
    if (threadFromContext?.otherParticipant) {
      setOtherName(threadFromContext.otherParticipant.fullName ?? null);
      setOtherRole(threadFromContext.otherParticipant.role ?? "general");
      setOtherUserId(threadFromContext.otherParticipant.id);
      setOtherAvatarUrl(threadFromContext.otherParticipant.avatarUrl ?? null);
    }
    if (threadFromContext?.blockStatus) {
      setBlockStatus(threadFromContext.blockStatus);
    }
  }, [threadFromContext]);

  useEffect(() => {
    if (!otherUserId || !token) return;
    fetch(`${getApiBase()}/users/${otherUserId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data: {
        fullName?: string | null;
        avatarUrl?: string | null;
        roleData?: { contactNumber?: string; discipline?: string | null; otherDiscipline?: string | null; primaryLanguage?: string | null; secondaryLanguage?: string | null };
      } | null) => {
        if (!data) return;
        if (data.fullName) setOtherName(data.fullName);
        setOtherAvatarUrl(data.avatarUrl ?? null);
        setOtherPhone(data.roleData?.contactNumber ?? null);
        setOtherDiscipline(data.roleData?.discipline ?? null);
        setOtherOtherDiscipline(data.roleData?.otherDiscipline ?? null);
        setOtherPrimaryLanguage(data.roleData?.primaryLanguage ?? null);
        setOtherSecondaryLanguage(data.roleData?.secondaryLanguage ?? null);
      })
      .catch(() => {});
  }, [otherUserId, token]);

  const fetchMessages = useCallback(async (fromCursor?: string | null) => {
    if (!threadId || !token) return;
    const url = fromCursor
      ? `${getApiBase()}/dm/threads/${threadId}/messages?cursor=${fromCursor}&limit=30`
      : `${getApiBase()}/dm/threads/${threadId}/messages?limit=30`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) return;
    const data = await resp.json() as {
      messages: DmMessage[];
      nextCursor: string | null;
      blockStatus?: DmBlockStatus;
    };
    const msgs = [...(data.messages ?? [])].reverse();
    if (data.blockStatus) {
      setBlockStatus(data.blockStatus);
    }
    if (!fromCursor) {
      setMessages(msgs);
    } else {
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
        return [...newMsgs, ...prev];
      });
    }
    setNextCursor(data.nextCursor ?? null);
  }, [threadId, token]);

  useEffect(() => {
    async function init() {
      initialScrollDoneRef.current = false;
      isAtBottomRef.current = true;
      setLoadingInitial(true);
      await fetchMessages(null);
      setLoadingInitial(false);
      if (threadId && token) {
        await fetch(`${getApiBase()}/dm/threads/${threadId}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        });
        fetchThreads();
      }
    }
    init();
  }, [threadId]);

  useEffect(() => {
    if (!socket || !threadId || joinedRef.current) return;
    socket.emit("join_thread", threadId, (err: string | null) => {
      if (!err) joinedRef.current = true;
    });

    const onNewMessage = ({ threadId: tid, message }: { threadId: string; message: DmMessage }) => {
      if (tid !== threadId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (isAtBottomRef.current) {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
      }
      if (threadId && token) {
        fetch(`${getApiBase()}/dm/threads/${threadId}/read`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        }).then(() => fetchThreads());
      }
    };

    socket.on("new_message", onNewMessage);

    return () => {
      socket.emit("leave_thread", threadId);
      socket.off("new_message", onNewMessage);
      joinedRef.current = false;
    };
  }, [socket, threadId, token]);

  const sendMessage = useCallback(async (msgBody?: string, imageUrl?: string) => {
    if (!threadId || !token) return;
    if (blockStatus.messagingBlocked) {
      Alert.alert(t("dm.block.title"), t("dm.block.cannot_send"));
      return;
    }
    if (!msgBody && !imageUrl) return;
    setSending(true);
    try {
      const resp = await fetch(`${getApiBase()}/dm/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body: msgBody ?? null, imageUrl: imageUrl ?? null }),
      });
      if (!resp.ok) {
        let code: string | undefined;
        try {
          const errJson = (await resp.json()) as { code?: string; error?: string };
          code = errJson.code;
        } catch {
        }
        if (code === "BLOCKED") {
          Alert.alert(t("dm.block.title"), t("dm.block.cannot_send"));
          setBlockStatus((s) => ({ ...s, messagingBlocked: true }));
        }
        return;
      }
      setBody("");
      fetchThreads();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
    } finally {
      setSending(false);
    }
  }, [threadId, token, fetchThreads, t, blockStatus.messagingBlocked]);

  const pickImage = useCallback(async (useCamera: boolean) => {
    if (uploadingImage || blockStatus.messagingBlocked) return;
    let result: ImagePicker.ImagePickerResult;
    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return;
      result = await ImagePicker.launchCameraAsync({ quality: 0.75, allowsEditing: true });
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        quality: 0.75,
        allowsEditing: false,
      });
    }
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setUploadingImage(true);
    try {
      const form = new FormData();
      const filename = asset.fileName ?? `photo_${Date.now()}.jpg`;
      const mimeType = asset.mimeType ?? "image/jpeg";
      if (Platform.OS === "web") {
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        form.append("file", blob, filename);
      } else {
        const rnFile: { uri: string; name: string; type: string } = { uri: asset.uri, name: filename, type: mimeType };
        (form as unknown as { append(k: string, v: { uri: string; name: string; type: string }): void }).append("file", rnFile);
      }
      const uploadResp = await fetch(`${getApiBase()}/upload/dm-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (uploadResp.ok) {
        const { fileUrl } = await uploadResp.json() as { fileUrl: string };
        await sendMessage(undefined, fileUrl);
      }
    } catch {
    } finally {
      setUploadingImage(false);
    }
  }, [token, uploadingImage, sendMessage, blockStatus.messagingBlocked]);

  const submitBlock = useCallback(async () => {
    if (!token || !otherUserId) return;
    const resp = await fetch(`${getApiBase()}/dm/block`, {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({ blockedUserId: otherUserId }),
    });
    if (!resp.ok) {
      Alert.alert(t("common.error"), t("dm.block.failed"));
      return;
    }
    setBlockStatus((s) => ({
      messagingBlocked: true,
      iBlockedThem: true,
      theyBlockedMe: s.theyBlockedMe,
    }));
    fetchThreads();
    setActionMenuVisible(false);
    Alert.alert(t("dm.block.title"), t("dm.block.done"), [
      { text: t("dm.block.go_back"), onPress: () => router.back() },
      { text: t("dm.block.stay"), style: "cancel" },
    ]);
  }, [token, otherUserId, getApiHeaders, fetchThreads, router, t]);

  const submitUnblock = useCallback(async () => {
    if (!token || !otherUserId) return;
    const resp = await fetch(`${getApiBase()}/dm/block/${otherUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      Alert.alert(t("common.error"), t("dm.block.failed"));
      return;
    }
    setBlockStatus((s) => ({
      messagingBlocked: s.theyBlockedMe,
      iBlockedThem: false,
      theyBlockedMe: s.theyBlockedMe,
    }));
    fetchThreads();
    setActionMenuVisible(false);
  }, [token, otherUserId, fetchThreads, t]);

  const confirmBlock = useCallback(() => {
    setActionMenuVisible(false);
    Alert.alert(t("dm.menu.block_confirm_title"), t("dm.menu.block_confirm_body"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("dm.menu.block"), style: "destructive", onPress: () => void submitBlock() },
    ]);
  }, [t, submitBlock]);

  const submitReport = useCallback(async () => {
    if (!token || !otherUserId || reportComment.trim().length < 10) return;
    setReportSubmitting(true);
    try {
      const resp = await fetch(`${getApiBase()}/dm/report`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          reportedUserId: otherUserId,
          threadId,
          comment: reportComment.trim(),
        }),
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        Alert.alert(t("common.error"), j.error ?? t("dm.report.failed"));
        return;
      }
      setReportModalVisible(false);
      setReportComment("");
      setActionMenuVisible(false);
      Alert.alert(t("dm.report.sent_title"), t("dm.report.sent_body"));
    } finally {
      setReportSubmitting(false);
    }
  }, [token, otherUserId, threadId, reportComment, getApiHeaders, t]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchMessages(nextCursor);
    setLoadingMore(false);
  }, [nextCursor, loadingMore, fetchMessages]);

  const inputLocked = blockStatus.messagingBlocked;
  const sendDisabled = !body.trim() || sending || blockStatus.messagingBlocked;
  const mediaDisabled = blockStatus.messagingBlocked || uploadingImage || sending;

  const items: ListItem[] = buildListItems(messages, locale, t);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === "date") {
      return (
        <View style={styles.dateSepRow}>
          <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dateSepText, { color: colors.mutedForeground }]}>{item.label}</Text>
          <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
        </View>
      );
    }
    const { data: msg, isFirstInGroup, isLastInGroup } = item;
    const isMine = msg.senderId === user?.id;
    const showAvatar = !isMine && isLastInGroup;
    const showSenderName = !isMine && isFirstInGroup && !!otherName;
    return (
      <View
        style={[
          styles.msgRow,
          isMine ? styles.msgRowRight : styles.msgRowLeft,
          { marginBottom: isLastInGroup ? 6 : 1 },
        ]}
      >
        {!isMine && (
          <View style={{ width: 28, alignSelf: "flex-end" }}>
            {showAvatar ? (
              <Avatar
                name={otherName}
                avatarUrl={otherAvatarUrl}
                size={28}
                authHeaders={getApiHeaders()}
              />
            ) : null}
          </View>
        )}
        <View style={{ maxWidth: "75%" }}>
          {showSenderName ? (
            <Text style={[styles.senderName, { color: colors.mutedForeground }]}>{otherName}</Text>
          ) : null}
          {msg.imageUrl ? (
            <TouchableOpacity
              activeOpacity={0.92}
              accessibilityRole="imagebutton"
              accessibilityLabel={t("dm.image.open_full_screen")}
              onPress={() => {
                const u = msg.imageUrl;
                if (!u) return;
                setViewerUri(resolveDmStoredImageUri(u));
              }}
              style={[
                styles.imgBubble,
                isMine ? styles.myBubble : styles.theirBubble,
                {
                  backgroundColor: isMine ? colors.accent + "33" : colors.card,
                  borderColor: isMine ? colors.accent : colors.border,
                },
              ]}
            >
              <Image
                pointerEvents="none"
                recyclingKey={msg.id}
                source={{
                  uri: resolveDmStoredImageUri(msg.imageUrl),
                  headers: token ? sanitizeHeadersForImageRequest(getApiHeaders()) : undefined,
                }}
                style={styles.msgImage}
                contentFit="cover"
                transition={120}
              />
            </TouchableOpacity>
          ) : (
            <View
              style={[
                styles.bubble,
                isMine
                  ? [styles.myBubble, { backgroundColor: colors.accent }]
                  : [styles.theirBubble, { backgroundColor: colors.card, borderColor: colors.border }],
              ]}
            >
              <Text style={[styles.bubbleText, { color: isMine ? "#fff" : colors.foreground }]}>
                {msg.body}
              </Text>
            </View>
          )}
          {isLastInGroup ? (
            <Text
              style={[
                styles.msgTime,
                { color: colors.mutedForeground, textAlign: isMine ? "right" : "left" },
              ]}
            >
              {formatTime(msg.createdAt, locale)}
            </Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: "#2C1F16" }]}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.push("/(tabs)/messages")} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color="rgba(250,249,246,0.85)" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => otherUserId && router.push(`/profile/${otherUserId}`)}
          disabled={!otherUserId}
          activeOpacity={0.75}
        >
          <Avatar
            name={otherName}
            avatarUrl={otherAvatarUrl}
            size={34}
            authHeaders={getApiHeaders()}
          />
          <View>
            <Text style={styles.headerName} numberOfLines={1}>{otherName ?? "…"}</Text>
            <Text style={styles.headerRole}>
              {otherRole === "sales_agent"
                ? t("dm.header.sales_agent")
                : otherRole === "service_provider"
                ? formatDiscipline(otherDiscipline, otherOtherDiscipline, t)
                : t("dm.header.user")}
            </Text>
            {otherRole === "service_provider" && (() => {
              const langs = [otherPrimaryLanguage, otherSecondaryLanguage]
                .filter((l): l is string => !!l && l.trim().length > 0);
              if (langs.length === 0) return null;
              return (
                <Text style={styles.headerLanguages} numberOfLines={1}>
                  {langs.join(" · ")}
                </Text>
              );
            })()}
          </View>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            onPress={() => setActionMenuVisible(true)}
            disabled={!otherUserId}
            accessibilityRole="button"
            accessibilityLabel={t("dm.menu.a11y")}
          >
            <Feather name="more-vertical" size={22} color="rgba(250,249,246,0.85)" />
          </TouchableOpacity>
          {otherPhone ? (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => Linking.openURL(`tel:${otherPhone}`)}
              activeOpacity={0.75}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="phone" size={18} color="#4ADE80" />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
      </View>

      {loadingInitial ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={items}
          keyExtractor={(item, i) =>
            item.type === "date" ? `date-${i}` : item.data.id
          }
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, { paddingBottom: 16 }]}
          onContentSizeChange={() => {
            if (!initialScrollDoneRef.current) {
              flatListRef.current?.scrollToEnd({ animated: false });
              initialScrollDoneRef.current = true;
            }
          }}
          onScroll={(e) => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            const distFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
            isAtBottomRef.current = distFromBottom < 80;
          }}
          scrollEventThrottle={100}
          onStartReachedThreshold={0.2}
          onStartReached={loadMore}
          ListHeaderComponent={
            <>
              {blockStatus.messagingBlocked ? (
                <View
                  style={[
                    styles.blockBanner,
                    { backgroundColor: "rgba(0,0,0,0.2)", borderColor: "rgba(250,249,246,0.15)" },
                  ]}
                >
                  <Feather name="slash" size={16} color="rgba(250,249,246,0.7)" />
                  <Text style={styles.blockBannerText}>
                    {blockStatus.iBlockedThem && blockStatus.theyBlockedMe
                      ? t("dm.block.banner_both")
                      : blockStatus.iBlockedThem
                        ? t("dm.block.banner_you")
                        : t("dm.block.banner_them")}
                  </Text>
                </View>
              ) : null}
              {loadingMore ? (
                <View style={{ paddingVertical: 12, alignItems: "center" }}>
                  <ActivityIndicator color={colors.accent} size="small" />
                </View>
              ) : null}
            </>
          }
        />
      )}

      <View
        style={[
          styles.inputArea,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.mediaBtn}
          onPress={() => pickImage(false)}
          disabled={mediaDisabled}
        >
          {uploadingImage ? (
            <ActivityIndicator color={colors.mutedForeground} size="small" />
          ) : (
            <Feather
              name="image"
              size={22}
              color={mediaDisabled ? colors.mutedForeground : colors.mutedForeground}
            />
          )}
        </TouchableOpacity>
        {Platform.OS !== "web" && (
          <TouchableOpacity
            style={styles.mediaBtn}
            onPress={() => pickImage(true)}
            disabled={mediaDisabled}
          >
            <Feather
              name="camera"
              size={22}
              color={mediaDisabled ? colors.mutedForeground : colors.mutedForeground}
            />
          </TouchableOpacity>
        )}
        <View
          style={[
            styles.inputWrapper,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.shadow,
              opacity: inputLocked ? 0.65 : 1,
            },
          ]}
        >
          <TextInput
            style={[styles.input, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
            placeholder={inputLocked ? t("dm.block.placeholder") : t("dm.placeholder.message")}
            placeholderTextColor={colors.mutedForeground}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={2000}
            returnKeyType="default"
            editable={!inputLocked}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              { backgroundColor: body.trim() && !sendDisabled ? colors.accent : colors.muted },
            ]}
            onPress={() => {
              const trimmed = body.trim();
              if (!trimmed || sendDisabled) return;
              sendMessage(trimmed);
            }}
            disabled={sendDisabled}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Feather
                name="send"
                size={16}
                color={body.trim() && !sendDisabled ? "#fff" : colors.mutedForeground}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={actionMenuVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setActionMenuVisible(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.actionMenuBackdrop}
            onPress={() => setActionMenuVisible(false)}
          />
          <View
            style={[
              styles.actionSheetCard,
              { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <Text style={[styles.actionSheetTitle, { color: colors.foreground }]}>{t("dm.menu.title")}</Text>
            <TouchableOpacity
              style={[styles.actionSheetRow, { borderTopColor: colors.border }]}
              onPress={() => {
                setActionMenuVisible(false);
                setReportModalVisible(true);
              }}
            >
              <Feather name="flag" size={20} color={colors.foreground} />
              <Text style={[styles.actionSheetLabel, { color: colors.foreground }]}>{t("dm.menu.report")}</Text>
            </TouchableOpacity>
            {blockStatus.iBlockedThem ? (
              <TouchableOpacity
                style={[styles.actionSheetRow, { borderTopColor: colors.border }]}
                onPress={() => void submitUnblock()}
              >
                <Feather name="user-check" size={20} color={colors.foreground} />
                <Text style={[styles.actionSheetLabel, { color: colors.foreground }]}>{t("dm.menu.unblock")}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionSheetRow, { borderTopColor: colors.border }]}
                onPress={() => void confirmBlock()}
              >
                <Feather name="user-x" size={20} color="#DC2626" />
                <Text style={[styles.actionSheetLabel, styles.actionSheetDanger]}>{t("dm.menu.block")}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionSheetRow, { borderTopColor: colors.border }]}
              onPress={() => setActionMenuVisible(false)}
            >
              <Text style={[styles.actionSheetLabel, { color: colors.mutedForeground, textAlign: "center", flex: 1 }]}>
                {t("common.cancel")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={reportModalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => !reportSubmitting && setReportModalVisible(false)}
      >
        <View style={styles.reportModalRoot}>
          <Pressable
            style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
            onPress={() => !reportSubmitting && setReportModalVisible(false)}
          />
          <View style={styles.reportModalCenter} pointerEvents="box-none">
            <View style={[styles.reportModalCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.reportModalTitle, { color: colors.foreground }]}>{t("dm.report.title")}</Text>
              <Text style={[styles.reportModalSubtitle, { color: colors.mutedForeground }]}>{t("dm.report.subtitle")}</Text>
              <TextInput
                style={[
                  styles.reportInput,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    color: colors.foreground,
                  },
                ]}
                placeholder={t("dm.report.comment_placeholder")}
                placeholderTextColor={colors.mutedForeground}
                value={reportComment}
                onChangeText={setReportComment}
                multiline
                maxLength={2000}
                editable={!reportSubmitting}
              />
              <Text style={[styles.reportHint, { color: colors.mutedForeground }]}>{t("dm.report.min_hint")}</Text>
              <View style={styles.reportActions}>
                <TouchableOpacity
                  style={[styles.reportBtnSecondary, { borderColor: colors.border }]}
                  onPress={() => !reportSubmitting && setReportModalVisible(false)}
                  disabled={reportSubmitting}
                >
                  <Text style={{ color: colors.foreground }}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.reportBtnPrimary,
                    {
                      backgroundColor:
                        reportComment.trim().length >= 10 && !reportSubmitting ? colors.accent : colors.muted,
                    },
                  ]}
                  onPress={() => void submitReport()}
                  disabled={reportComment.trim().length < 10 || reportSubmitting}
                >
                  {reportSubmitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.reportBtnPrimaryText}>{t("dm.report.submit")}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <ImageViewerModal
        visible={!!viewerUri}
        uri={viewerUri}
        authToken={token}
        onClose={() => setViewerUri(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerName: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
    color: "#FAFAF9",
    letterSpacing: -0.2,
  },
  headerRole: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
    color: "rgba(250,249,246,0.55)",
    marginTop: 1,
  },
  headerLanguages: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    color: "rgba(250,249,246,0.45)",
    marginTop: 1,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 2,
  },
  dateSepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 12,
  },
  dateLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dateSepText: { fontFamily: "DM_Sans_400Regular", fontSize: 12 },
  senderName: { fontFamily: "DM_Sans_500Medium", fontSize: 11, marginBottom: 2, marginLeft: 2 },
  msgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginVertical: 2,
  },
  msgRowRight: { justifyContent: "flex-end" },
  msgRowLeft: { justifyContent: "flex-start" },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  myBubble: { borderRadius: 18, borderBottomRightRadius: 4 },
  theirBubble: { borderRadius: 18, borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontFamily: "DM_Sans_400Regular", fontSize: 15, lineHeight: 22 },
  imgBubble: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
  },
  msgImage: { width: 220, height: 180 },
  msgTime: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 10,
    marginTop: 3,
    marginHorizontal: 4,
    color: "#999",
  },
  inputArea: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    gap: 8,
  },
  mediaBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: 1,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 6,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    maxHeight: 120,
    paddingVertical: 4,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  callBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(74,222,128,0.15)",
    borderWidth: 1,
    borderColor: "rgba(74,222,128,0.3)",
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 2 },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  blockBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  blockBannerText: {
    flex: 1,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    lineHeight: 18,
    color: "rgba(250,249,246,0.85)",
  },
  modalRoot: { flex: 1 },
  actionMenuBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  actionSheetCard: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.06)",
  },
  actionSheetTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
    paddingVertical: 10,
    textAlign: "center",
  },
  actionSheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionSheetLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 16, flex: 1 },
  actionSheetDanger: { color: "#DC2626" },
  reportModalRoot: { flex: 1 },
  reportModalCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  reportModalCard: {
    borderRadius: 14,
    padding: 20,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  reportModalTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 18,
    marginBottom: 6,
  },
  reportModalSubtitle: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 14,
  },
  reportInput: {
    minHeight: 120,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    fontFamily: "DM_Sans_400Regular",
    textAlignVertical: "top",
  },
  reportHint: { fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 8 },
  reportActions: { flexDirection: "row", gap: 12, marginTop: 18, justifyContent: "flex-end" },
  reportBtnSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    borderWidth: 1,
  },
  reportBtnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 10,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  reportBtnPrimaryText: { color: "#fff", fontFamily: "DM_Sans_600SemiBold", fontSize: 15 },
});
