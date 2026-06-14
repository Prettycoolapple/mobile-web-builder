import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import { getApiBase } from "@/lib/api";
import { normaliseAddressKey } from "@/lib/address-key";
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
  /** Set when the server call failed and the optimistic change was rolled back. */
  error?: boolean;
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

/** Exact dedup key for stable identifiers (listing URL, internal id, propertyKey). */
function normalizeWatchKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function watchlistKeyOf(candidate: WatchlistCandidate): string {
  return normalizeWatchKey(
    candidate.listingUrl ||
    candidate.internalListingId ||
    candidate.address,
  );
}

/**
 * Address-derived match key. Uses the canonical normaliser so the same property
 * typed differently — abbreviated street type, postcode present/absent, case —
 * still matches a saved item (e.g. "12 Marine Pde" ≡ "12 Marine Parade, …").
 * This is what pre-lights the heart on result cards via {@link isWatched}.
 */
function watchlistAddressKeyOf(candidate: Pick<WatchlistCandidate, "address">): string {
  return normaliseAddressKey(candidate.address);
}

function watchlistKeysOf(candidate: WatchlistCandidate): string[] {
  return Array.from(new Set([
    normalizeWatchKey(candidate.listingUrl),
    normalizeWatchKey(candidate.internalListingId),
    watchlistAddressKeyOf(candidate),
  ].filter(Boolean)));
}

function itemKeysOf(item: WatchlistItem): string[] {
  const snapshot = item.snapshot as WatchlistCandidate | null | undefined;
  return Array.from(new Set([
    normalizeWatchKey(item.propertyKey),
    normalizeWatchKey(item.listingUrl),
    normalizeWatchKey(snapshot?.listingUrl),
    normalizeWatchKey(snapshot?.internalListingId),
    watchlistAddressKeyOf(item),
    snapshot?.address ? watchlistAddressKeyOf({ address: snapshot.address }) : "",
  ].filter(Boolean)));
}

function buildWatchedKeySet(rows: WatchlistItem[]): Set<string> {
  return new Set(rows.flatMap(itemKeysOf));
}

function buildWatchedAddressSet(rows: WatchlistItem[]): Set<string> {
  return new Set(rows.map((r) => watchlistAddressKeyOf(r)).filter(Boolean));
}

function mergePendingRows(rows: WatchlistItem[], pending: Map<string, { watched: boolean; item?: WatchlistItem }>): WatchlistItem[] {
  let next = [...rows];
  for (const [key, change] of pending) {
    const aliases = change.item ? itemKeysOf(change.item) : [key];
    next = next.filter((item) => !itemKeysOf(item).some((alias) => aliases.includes(alias)));
    if (change.watched && change.item) next.unshift(change.item);
  }
  return next;
}

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { user, getApiHeaders } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());
  const [watchedAddressKeys, setWatchedAddressKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // Guards against a stale GET (from a previous user) overwriting newer state.
  const requestSeqRef = useRef(0);
  const pendingToggleRef = useRef<Map<string, { watched: boolean; item?: WatchlistItem }>>(new Map());

  const refresh = useCallback(async () => {
    if (!user) {
      pendingToggleRef.current.clear();
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
      const rows = mergePendingRows(data.items ?? [], pendingToggleRef.current);
      setItems(rows);
      setWatchedKeys(buildWatchedKeySet(rows));
      setWatchedAddressKeys(buildWatchedAddressSet(rows));
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

  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [user, refresh]);

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
        itemKeysOf(item).some((key) => aliases.includes(key)) ||
        watchlistAddressKeyOf(item) === addressKey,
      );
      const key = existingItem?.propertyKey ?? watchlistKeyOf(candidate);
      if (!key) return {};
      const wasWatched = !!existingItem || aliases.some((alias) => watchedKeys.has(alias)) || watchedAddressKeys.has(addressKey);
      const nextWatched = !wasWatched;
      const affectedAliases = Array.from(new Set([...(existingItem ? itemKeysOf(existingItem) : []), ...aliases, key].filter(Boolean)));
      const existingAddressKey = existingItem ? watchlistAddressKeyOf(existingItem) : addressKey;
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
      pendingToggleRef.current.set(key, nextWatched ? { watched: true, item: optimistic } : { watched: false });

      // Optimistic update.
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        for (const alias of affectedAliases) {
          if (nextWatched) next.add(alias);
          else next.delete(alias);
        }
        return next;
      });
      setWatchedAddressKeys((prev) => {
        const next = new Set(prev);
        if (nextWatched) next.add(addressKey);
        else next.delete(existingAddressKey);
        return next;
      });
      setItems((prev) => {
        if (nextWatched) {
          return [optimistic, ...prev.filter((it) => !itemKeysOf(it).some((alias) => affectedAliases.includes(alias)))];
        }
        return prev.filter((it) => !itemKeysOf(it).some((alias) => affectedAliases.includes(alias)));
      });

      try {
        const resp = await fetch(`${getApiBase()}/watchlist/toggle`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ ...candidate, propertyKey: key }),
        });
        if (!resp.ok) throw new Error(`toggle failed: ${resp.status}`);
        const data = (await resp.json()) as { watched?: boolean; item?: WatchlistItem | null };
        pendingToggleRef.current.delete(key);
        const serverWatched = data.watched ?? nextWatched;
        // If the server's authoritative state diverged from our optimistic
        // guess (rare — e.g. another device changed it), re-sync from server.
        if (serverWatched && data.item) {
          const serverAliases = itemKeysOf(data.item);
          setItems((prev) => [data.item!, ...prev.filter((it) => !itemKeysOf(it).some((alias) => serverAliases.includes(alias)))]);
          setWatchedKeys((prev) => new Set([...prev, ...serverAliases]));
          setWatchedAddressKeys((prev) => {
            const next = new Set(prev);
            next.add(watchlistAddressKeyOf(data.item!));
            return next;
          });
        } else if (!serverWatched) {
          setItems((prev) => prev.filter((it) => !itemKeysOf(it).some((alias) => affectedAliases.includes(alias))));
          setWatchedKeys((prev) => {
            const next = new Set(prev);
            for (const alias of affectedAliases) next.delete(alias);
            return next;
          });
          setWatchedAddressKeys((prev) => {
            const next = new Set(prev);
            next.delete(existingAddressKey);
            next.delete(addressKey);
            return next;
          });
        }
        if (serverWatched !== nextWatched) void refresh();
        return { watched: serverWatched };
      } catch {
        pendingToggleRef.current.delete(key);
        // Revert on failure — including `items`, so a save that never reached the
        // server doesn't keep masquerading as saved in the Watchlist tab.
        setWatchedKeys((prev) => {
          const next = new Set(prev);
          for (const alias of affectedAliases) {
            if (wasWatched) next.add(alias);
            else next.delete(alias);
          }
          return next;
        });
        setWatchedAddressKeys((prev) => {
          const next = new Set(prev);
          if (wasWatched) next.add(existingAddressKey);
          else next.delete(addressKey);
          return next;
        });
        setItems((prev) => {
          const withoutOptimistic = prev.filter(
            (it) => !itemKeysOf(it).some((alias) => affectedAliases.includes(alias)),
          );
          // If we had been removing, restore the row we optimistically dropped.
          return wasWatched && existingItem ? [existingItem, ...withoutOptimistic] : withoutOptimistic;
        });
        void refresh();
        return { watched: wasWatched, error: true };
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
