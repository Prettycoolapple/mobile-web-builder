import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

function getApiBase(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "/api";
}

interface Contact {
  id: string;
  fullName: string | null;
  role: string;
  subtitle: string | null;
  bio: string | null;
  avatarUrl: string | null;
}

function roleBadge(role: string): { label: string; color: string } {
  if (role === "sales_agent") return { label: "Sales Agent", color: "#D97757" };
  if (role === "service_provider") return { label: "Service Provider", color: "#5B8EAD" };
  return { label: "User", color: "#8B7355" };
}

function Avatar({ name, size = 46 }: { name: string | null; size?: number }) {
  const colors = useColors();
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent + "20",
        borderWidth: 1.5,
        borderColor: colors.accent + "40",
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

export default function ContactsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`${getApiBase()}/dm/contacts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { contacts: Contact[] };
          setContacts(data.contacts ?? []);
        } else {
          setError("Failed to load contacts");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const startChat = useCallback(
    async (contactId: string) => {
      if (starting) return;
      setStarting(contactId);
      try {
        const resp = await fetch(`${getApiBase()}/dm/threads`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ targetUserId: contactId }),
        });
        if (resp.ok) {
          const data = await resp.json() as { thread: { id: string } };
          router.replace(`/chat/${data.thread.id}`);
        }
      } catch {
      } finally {
        setStarting(null);
      }
    },
    [token, starting, router]
  );

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      (c.fullName ?? "").toLowerCase().includes(q) ||
      (c.subtitle ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: "#2C1F16" }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="x" size={22} color="rgba(250,249,246,0.75)" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New Message</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
          placeholder="Search agents & providers…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoFocus
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x-circle" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => {
            const badge = roleBadge(item.role);
            const isLoading = starting === item.id;
            return (
              <Pressable
                onPress={() => startChat(item.id)}
                disabled={!!starting}
                style={({ pressed }) => [
                  styles.contactRow,
                  { backgroundColor: pressed ? colors.muted : colors.card },
                ]}
              >
                <Avatar name={item.fullName} />
                <View style={styles.contactMid}>
                  <Text style={[styles.contactName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.fullName ?? "Unknown"}
                  </Text>
                  {item.subtitle ? (
                    <Text style={[styles.contactSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                  <View style={[styles.rolePill, { backgroundColor: badge.color + "18" }]}>
                    <Text style={[styles.rolePillText, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                </View>
                {isLoading ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                )}
              </Pressable>
            );
          }}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
          )}
          ListEmptyComponent={() => (
            <View style={styles.center}>
              <Feather name="users" size={40} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search ? "No contacts found" : "No contacts available"}
              </Text>
            </View>
          )}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 17,
    color: "#FAFAF9",
    letterSpacing: -0.2,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  searchInput: { flex: 1, fontSize: 15, lineHeight: 22 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  contactMid: { flex: 1, gap: 3 },
  contactName: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15 },
  contactSub: { fontFamily: "DM_Sans_400Regular", fontSize: 12 },
  rolePill: {
    alignSelf: "flex-start",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 2,
  },
  rolePillText: { fontFamily: "DM_Sans_500Medium", fontSize: 10 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 74 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    paddingTop: 60,
  },
  errorText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, textAlign: "center" },
  emptyText: { fontFamily: "DM_Sans_400Regular", fontSize: 14, textAlign: "center" },
});
