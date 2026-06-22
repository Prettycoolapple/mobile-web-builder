import { clearSession, getToken, redirectToLogin } from "./auth";

export interface ApiError extends Error {
  status: number;
  code?: string;
  /** Present for subscription gating (402) so callers can show an upgrade gate. */
  subscriptionRequired?: boolean;
  payload?: unknown;
}

export interface ApiOptions extends RequestInit {
  /** When true, a 401 will clear the session and bounce to the portal login. */
  redirectOn401?: boolean;
  /** Abort signal timeout in ms. */
  timeoutMs?: number;
}

/**
 * Single fetch helper for the Work Space. Mirrors the vanilla portal's `api()`
 * (provider-portal/portal.js): JSON in/out, Bearer auth, structured errors with
 * `status`/`code`. The API is same-origin in production and dev-proxied to :8080.
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { redirectOn401 = true, timeoutMs, ...init } = opts;
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  let signal = init.signal ?? undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs && !signal) {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    signal = controller.signal;
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, signal });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    if (res.status === 401 && redirectOn401) {
      clearSession();
      redirectToLogin();
    }
    const message =
      (isJson && payload && (payload.message || payload.error)) || `Request failed (${res.status})`;
    const err = new Error(message) as ApiError;
    err.status = res.status;
    err.payload = payload;
    if (isJson && payload?.code) err.code = payload.code;
    if (isJson && (payload?.code === "subscription_required" || payload?.error === "subscription_required")) {
      err.subscriptionRequired = true;
    }
    throw err;
  }

  return payload as T;
}

export function apiGet<T>(path: string, opts?: ApiOptions): Promise<T> {
  return api<T>(path, { ...opts, method: "GET" });
}

export function apiPost<T>(path: string, body?: unknown, opts?: ApiOptions): Promise<T> {
  return api<T>(path, {
    ...opts,
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T>(path: string, opts?: ApiOptions): Promise<T> {
  return api<T>(path, { ...opts, method: "DELETE" });
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && typeof (e as ApiError).status === "number";
}
