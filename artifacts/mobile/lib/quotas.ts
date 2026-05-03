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
  service_provider: { limit: 300, warnAt: 280 },
  general_standard: { limit: 50, warnAt: 45 },
  general_free: { limit: 10, warnAt: 8 },
};

export const FREE_REPORT_LIMIT = 2;
export const STANDARD_REPORT_LIMIT = 20;

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

export function resolveReportLimit(tier: string | null | undefined): number {
  return tier === "standard" || tier === "pro" ? STANDARD_REPORT_LIMIT : FREE_REPORT_LIMIT;
}
