/**
 * Auth is shared with the existing vanilla provider portal: it writes the token
 * and user under these exact localStorage keys (see provider-portal/portal.js).
 * Reading the same keys means logging in once on /provider-portal/ also signs the
 * user into the Work Space — one account, one session.
 */
const TOKEN_KEY = "projectAlphaProviderPortalToken";
const USER_KEY = "projectAlphaProviderPortalUser";

/** Where the existing portal hosts its login screen. */
export const PORTAL_LOGIN_URL = "/provider-portal/";

export interface PortalUser {
  id: string;
  email?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  role?: string | null;
  avatarUrl?: string | null;
  [key: string]: unknown;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): PortalUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalUser;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken() && !!getUser();
}

/** Send the user back to the portal login (preserving intent to return here). */
export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  window.location.assign(PORTAL_LOGIN_URL);
}

export function displayName(user: PortalUser | null): string {
  if (!user) return "Provider";
  return (
    (typeof user.fullName === "string" && user.fullName.trim()) ||
    (typeof user.companyName === "string" && user.companyName.trim()) ||
    (typeof user.email === "string" && user.email.trim()) ||
    "Provider"
  );
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "P";
}
