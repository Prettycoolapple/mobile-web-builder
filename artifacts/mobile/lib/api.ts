import Constants from "expo-constants";
import { Platform } from "react-native";

function trim(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeOrigin(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return stripTrailingSlash(new URL(withProtocol).toString());
}

function normalizeApiBase(value: string): string {
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/api") ? pathname : `${pathname}/api`;
  return stripTrailingSlash(url.toString());
}

function getExpoHost(): string | null {
  const candidates = [
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri,
    (Constants as typeof Constants & { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig
      ?.debuggerHost,
    (Constants as typeof Constants & { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } })
      .manifest2?.extra?.expoClient?.hostUri,
    (Constants as typeof Constants & { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost,
  ];

  for (const candidate of candidates) {
    const host = trim(candidate)?.split(":")[0];
    if (host) return host;
  }

  return null;
}

function getConfiguredApiPort(): string {
  return trim(process.env.EXPO_PUBLIC_API_PORT) ?? "8080";
}

function getLanOrigin(): string | null {
  const host = getExpoHost();
  if (!host) return null;
  return `http://${host}:${getConfiguredApiPort()}`;
}

function getSimulatorOrigin(): string {
  if (Platform.OS === "android") {
    return `http://10.0.2.2:${getConfiguredApiPort()}`;
  }
  return `http://127.0.0.1:${getConfiguredApiPort()}`;
}

export function hasExplicitApiConfiguration(): boolean {
  return Boolean(
    trim(process.env.EXPO_PUBLIC_API_URL) ||
      trim(process.env.EXPO_PUBLIC_APP_URL) ||
      trim(process.env.EXPO_PUBLIC_DOMAIN),
  );
}

export function getApiOrigin(): string {
  const explicitApiUrl = trim(process.env.EXPO_PUBLIC_API_URL);
  if (explicitApiUrl) {
    const url = new URL(normalizeApiBase(explicitApiUrl));
    url.pathname = "";
    return stripTrailingSlash(url.toString());
  }

  const explicitAppUrl = trim(process.env.EXPO_PUBLIC_APP_URL);
  if (explicitAppUrl) return normalizeOrigin(explicitAppUrl);

  const legacyDomain = trim(process.env.EXPO_PUBLIC_DOMAIN);
  if (legacyDomain) return normalizeOrigin(legacyDomain);

  if (Platform.OS === "web") return "";
  return getLanOrigin() ?? getSimulatorOrigin();
}

export function getApiBase(): string {
  const explicitApiUrl = trim(process.env.EXPO_PUBLIC_API_URL);
  if (explicitApiUrl) return normalizeApiBase(explicitApiUrl);

  const explicitAppUrl = trim(process.env.EXPO_PUBLIC_APP_URL);
  if (explicitAppUrl) return `${normalizeOrigin(explicitAppUrl)}/api`;

  const legacyDomain = trim(process.env.EXPO_PUBLIC_DOMAIN);
  if (legacyDomain) return `${normalizeOrigin(legacyDomain)}/api`;

  if (Platform.OS === "web") return "/api";
  return `${getLanOrigin() ?? getSimulatorOrigin()}/api`;
}

export function resolveAppUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith("/")) return path;

  const origin = getApiOrigin();
  return origin ? `${origin}${path}` : path;
}
