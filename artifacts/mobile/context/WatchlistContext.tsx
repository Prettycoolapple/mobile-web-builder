import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "./AuthContext";
import { getApiBase } from "@/lib/api";
import type { PropertyCandidate } from "./ChatContext";

/** Anything we can save: a full candidate, or a lighter shape built from a report. */
export type WatchlistCandidate = Partial<PropertyCandidate> & { address: string };

export interface WatchlistItem {
  id: string;
  propertyKey: string;
  address: string;
  listingUrl?: string | null;
  photoUrl?: string | null;
  priceDisplay?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  landAreaSqm?: number | null;
  zone?: string | null;
  compositeScore?: number | null;
  snapshot?: PropertyCandidate | null;
  createdAt?: string;
}

interface ToggleResult {
  /** Set when a guest tried to save — the caller should route to login/signup. */
  requiresAuth?: boolean;
  /** New watched state when the toggle was applied. */
  watched?: boolean;
}

interface WatchlistContextValue {
  items: WatchlistItem[];
  loading: boolean;
  isWatched: (candidate: WatchlistCandidate) => boolean;
  isKeyWatched: (key: string) => boolean;
  toggle: (candidate: WatchlistCandidate) => Promise<ToggleResult>;
  refresh: () => Promise<void>;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

/** Normalised dedup key — mirrors the analysis-key logic used on cards. */
function normalizeWatchKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function watchlistKeyOf(candidate: WatchlistCandidate): string {
  return normalizeWatchKey(candidate.listingUrl || candidate.address);
}

function watchlistAddressKeyOf(candidate: Pick<WatchlistCandidate, "address">): string {
  return normalizeWatchKey(candidate.address);
}

function watchlistKeysOf(candidate: WatchlistCandidate): string[] {
  return Array.from(new Set([
    normalizeWatchKey(candidate.listingUrl),
    watchlistAddressKeyOf(candidate),
  ].filter(Boolean)));
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { user, getApiHeaders } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());
  const [watchedAddressKeys, setWatchedAddressKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // Guards against a stale GET (from a previous user) overwriting newer state.
  const requestSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setWatchedKeys(new Set());
      setWatchedAddressKeys(new Set());
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const resp = await fetch(`${getApiBase()}/watchlist`, { headers: getApiHeaders() });
      if (!resp.ok) return;
      const data = (await resp.json()) as { items?: WatchlistItem[] };
      if (seq !== requestSeqRef.current) return; // superseded
      const rows = data.items ?? [];
      setItems(rows);
      setWatchedKeys(new Set(rows.map((r) => normalizeWatchKey(r.propertyKey)).filter(Boolean)));
      setWatchedAddressKeys(new Set(rows.map((r) => normalizeWatchKey(r.address)).filter(Boolean)));
    } catch {
      // Best-effort: leave existing state untouched on failure.
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  }, [user, getApiHeaders]);

  // Hydrate on login; clear on logout. Keyed on user id so a different account
  // never inherits the previous user's list.
  useEffect(() => {
    void refresh();
  }, [user?.id, refresh]);

  const isKeyWatched = useCallback((key: string) => watchedKeys.has(normalizeWatchKey(key)), [watchedKeys]);
  const isWatched = useCallback(
    (candidate: WatchlistCandidate) =>
      watchlistKeysOf(candidate).some((key) => watchedKeys.has(key)) ||
      watchedAddressKeys.has(watchlistAddressKeyOf(candidate)),
    [watchedAddressKeys, watchedKeys],
  );

  const toggle = useCallback(
    async (candidate: WatchlistCandidate): Promise<ToggleResult> => {
      if (!user) return { requiresAuth: true };

      const aliases = watchlistKeysOf(candidate);
      const addressKey = watchlistAddressKeyOf(candidate);
      const existingItem = items.find((item) =>
        aliases.includes(normalizeWatchKey(item.propertyKey)) ||
        normalizeWatchKey(item.address) === addressKey,
      );
      const key = existingItem?.propertyKey ?? watchlistKeyOf(candidate);
      if (!key) return {};
      const wasWatched = !!existingItem || aliases.some((alias) => watchedKeys.has(alias)) || watchedAddressKeys.has(addressKey);
      const nextWatched = !wasWatched;

      // Optimistic update.
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        if (nextWatched) next.add(key);
        else next.delete(key);
        return next;
      });
      setWatchedAddressKeys((prev) => {
        const next = new Set(prev);
        const existingAddressKey = existingItem ? normalizeWatchKey(existingItem.address) : addressKey;
        if (nextWatched) next.add(addressKey);
        else next.delete(existingAddressKey);
        return next;
      });
      setItems((prev) => {
        if (nextWatched) {
          if (prev.some((it) => it.propertyKey === key)) return prev;
          const optimistic: WatchlistItem = {
            id: `pending:${key}`,
            propertyKey: key,
            address: candidate.address,
            listingUrl: candidate.listingUrl ?? null,
            photoUrl: candidate.photoUrl ?? candidate.photoUrls?.[0] ?? null,
            priceDisplay: candidate.priceDisplay ?? null,
            propertyType: candidate.propertyType ?? null,
            bedrooms: candidate.bedrooms ?? null,
            bathrooms: candidate.bathrooms ?? null,
            landAreaSqm: candidate.landArea ?? null,
            zone: candidate.zone ?? null,
            compositeScore: candidate.scores?.composite ?? null,
            snapshot: candidate as PropertyCandidate,
            createdAt: new Date().toISOString(),
          };
          return [optimistic, ...prev];
        }
        return prev.filter((it) => it.propertyKey !== key);
      });

      try {
        const resp = await fetch(`${getApiBase()}/watchlist/toggle`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ ...candidate, propertyKey: key }),
        });
        if (!resp.ok) throw new Error(`toggle failed: ${resp.status}`);
        const data = (await resp.json()) as { watched?: boolean };
        // If the server's authoritative state diverged from our optimistic
        // guess (rare — e.g. another device changed it), re-sync from server.
        if (typeof data.watched === "boolean" && data.watched !== nextWatched) {
          void refresh();
        }
        return { watched: data.watched ?? nextWatched };
      } catch {
        // Revert on failure.
        setWatchedKeys((prev) => {
          const next = new Set(prev);
          if (wasWatched) next.add(key);
          else next.delete(key);
          return next;
        });
        setWatchedAddressKeys((prev) => {
          const next = new Set(prev);
          const existingAddressKey = existingItem ? normalizeWatchKey(existingItem.address) : addressKey;
          if (wasWatched) next.add(existingAddressKey);
          else next.delete(addressKey);
          return next;
        });
        void refresh();
        return { watched: wasWatched };
      }
    },
    [user, items, watchedAddressKeys, watchedKeys, getApiHeaders, refresh],
  );

  const value = useMemo<WatchlistContextValue>(
    () => ({ items, loading, isWatched, isKeyWatched, toggle, refresh }),
    [items, loading, isWatched, isKeyWatched, toggle, refresh],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist(): WatchlistContextValue {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used within a WatchlistProvider");
  return ctx;
}
