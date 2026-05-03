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
  service_provider: { limit: 300, warnAt: 280 },
  general_standard: { limit: 50, warnAt: 45 },
  general_free: { limit: 10, warnAt: 8 },
  default: { limit: 50, warnAt: 45 },
};

export const FREE_REPORT_LIMIT = 2;
export const STANDARD_REPORT_LIMIT = 20;

export function resolveChatLimitKey(role: string | null | undefined, tier: string | null | undefined): ChatLimitKey {
  if (role === "service_provider") return "service_provider";
  if (role === "general" && (tier === "standard" || tier === "pro")) return "general_standard";
  return "general_free";
}

export function resolveReportLimit(tier: string | null | undefined): number {
  return tier === "standard" || tier === "pro" ? STANDARD_REPORT_LIMIT : FREE_REPORT_LIMIT;
}
