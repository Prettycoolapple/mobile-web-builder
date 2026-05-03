import "./loadEnv";

const REVENUECAT_API_BASE = "https://api.revenuecat.com/v2";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function getRevenueCatProjectId(): string {
  return readRequiredEnv("REVENUECAT_PROJECT_ID");
}

export function getRevenueCatSecretApiKey(): string {
  return readRequiredEnv("REVENUECAT_SECRET_API_KEY");
}

export interface RevenueCatListResponse<T> {
  object: "list";
  items: T[];
  next_page?: string;
  url?: string;
}

export interface RevenueCatApp {
  id: string;
  name: string;
  type: string;
  project_id: string;
  app_store?: { bundle_id?: string };
  play_store?: { package_name?: string };
}

export interface RevenueCatEntitlement {
  id: string;
  lookup_key: string;
  display_name: string;
}

export interface RevenueCatProduct {
  id: string;
  app_id: string;
  store_identifier: string;
  display_name?: string;
}

export interface RevenueCatOffering {
  id: string;
  lookup_key: string;
  display_name: string;
  is_current?: boolean;
}

export interface RevenueCatPackage {
  id: string;
  lookup_key: string;
  display_name: string;
}

export interface RevenueCatPublicApiKey {
  id: string;
  key: string;
  environment: string;
}

export async function revenueCatRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getRevenueCatSecretApiKey()}`);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${REVENUECAT_API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`RevenueCat ${init.method ?? "GET"} ${path} failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}
