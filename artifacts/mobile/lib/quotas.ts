// Mobile mirror of the authoritative quota table in the API.
// IMPORTANT: keep values in sync with
// artifacts/api-server/src/lib/quotas.ts. The API enforces these numbers;
// the mobile UI uses them only to gate the input and render usage/warning
// bars so users see accurate feedback before the server rejects a request.

export type ChatLimitKey = "service_provider" | "general_standard" | "general_free";

export interface QuotaTier {
  limit: number;
  warnAt: number;
}

export const CHAT_LIMITS: Record<ChatLimitKey, QuotaTier> = {
  service_provider: { limit: 900, warnAt: 840 },
  general_standard: { limit: 150, warnAt: 135 },
  general_free: { limit: 30, warnAt: 24 },
};

export const FREE_REPORT_LIMIT = 6;
export const STANDARD_REPORT_LIMIT = 60;
export const SERVICE_PROVIDER_FREE_REPORT_LIMIT = 0;

export function resolveChatLimitKey(
  role: string | null | undefined,
  tier: string | null | undefined,
): ChatLimitKey {
  if (role === "service_provider") return "service_provider";
  if (role === "general" && (tier === "standard" || tier === "pro")) return "general_standard";
  return "general_free";
}

export function resolveChatQuota(
  role: string | null | undefined,
  tier: string | null | undefined,
): QuotaTier & { key: ChatLimitKey; isFree: boolean } {
  const key = resolveChatLimitKey(role, tier);
  const quota = CHAT_LIMITS[key];
  return { ...quota, key, isFree: key === "general_free" };
}

export function resolveReportLimit(
  tier: string | null | undefined,
  role?: string | null | undefined,
): number {
  if (role === "service_provider" && tier !== "standard" && tier !== "pro") {
    return SERVICE_PROVIDER_FREE_REPORT_LIMIT;
  }
  return tier === "standard" || tier === "pro" ? STANDARD_REPORT_LIMIT : FREE_REPORT_LIMIT;
}
