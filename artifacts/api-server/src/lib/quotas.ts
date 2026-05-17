// Central quota table for chat messages and feasibility reports.
//
// IMPORTANT: Keep these numbers in sync with the mobile mirror at
// artifacts/mobile/lib/quotas.ts. The mobile UI uses these numbers to
// gate input and render the usage/warning bars; the API enforces them
// authoritatively. If they drift, free users either see the wrong copy
// or can send messages the server will reject.

export type ChatLimitKey = "service_provider" | "general_standard" | "general_free";

export interface QuotaTier {
  limit: number;
  warnAt: number;
}

export const CHAT_LIMITS: Record<ChatLimitKey, QuotaTier> & { default: QuotaTier } = {
  service_provider: { limit: 900, warnAt: 840 },
  general_standard: { limit: 150, warnAt: 135 },
  general_free: { limit: 30, warnAt: 24 },
  default: { limit: 150, warnAt: 135 },
};

export const FREE_REPORT_LIMIT = 6;
export const STANDARD_REPORT_LIMIT = 60;
export const SERVICE_PROVIDER_FREE_REPORT_LIMIT = 0;

export function resolveChatLimitKey(role: string | null | undefined, tier: string | null | undefined): ChatLimitKey {
  if (role === "service_provider") return "service_provider";
  if (role === "general" && (tier === "standard" || tier === "pro")) return "general_standard";
  return "general_free";
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
