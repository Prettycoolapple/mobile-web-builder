export const PENDING_NEWS_NAVIGATION_KEY = "@devfeasible/pending_news_navigation";

export interface PendingNewsNavigation {
  postId: string;
  notificationId: string | null;
  queuedAt: number;
}

function validPostId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128;
}

export function pendingNewsNavigationFromData(
  data: Record<string, unknown> | undefined,
  notificationId?: string,
  now = Date.now(),
): PendingNewsNavigation | null {
  if (!data || data.type !== "news_post" || !validPostId(data.postId)) return null;
  return {
    postId: data.postId.trim(),
    notificationId: typeof notificationId === "string" && notificationId.length <= 256 ? notificationId : null,
    queuedAt: now,
  };
}

export function parsePendingNewsNavigation(raw: string | null): PendingNewsNavigation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingNewsNavigation>;
    if (!validPostId(value.postId) || !Number.isFinite(value.queuedAt) || Number(value.queuedAt) <= 0) return null;
    return {
      postId: value.postId.trim(),
      notificationId: typeof value.notificationId === "string" && value.notificationId.length <= 256
        ? value.notificationId
        : null,
      queuedAt: Number(value.queuedAt),
    };
  } catch {
    return null;
  }
}

export function isPendingNewsDestination(pathname: string, postId: string): boolean {
  const normalizedPath = pathname.replace(/\/+$/, "");
  return normalizedPath === `/news/${postId}`;
}

export function isInitialBootstrapRoute(segments: readonly string[]): boolean {
  return segments.length === 0 || (segments.length === 1 && segments[0] === "index");
}
