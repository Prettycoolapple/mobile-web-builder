import { describe, expect, it } from "vitest";
import {
  CHAT_LIMITS,
  FREE_REPORT_LIMIT,
  SERVICE_PROVIDER_FREE_REPORT_LIMIT,
  STANDARD_REPORT_LIMIT,
  resolveChatLimitKey,
  resolveReportLimit,
} from "../quotas";

describe("usage quotas", () => {
  it("triples feasibility report limits", () => {
    expect(FREE_REPORT_LIMIT).toBe(6);
    expect(STANDARD_REPORT_LIMIT).toBe(60);
    expect(resolveReportLimit("free", "general")).toBe(6);
    expect(resolveReportLimit("standard", "general")).toBe(60);
    expect(resolveReportLimit("pro", "service_provider")).toBe(60);
  });

  it("requires service providers to subscribe before generating reports", () => {
    expect(SERVICE_PROVIDER_FREE_REPORT_LIMIT).toBe(0);
    expect(resolveReportLimit("free", "service_provider")).toBe(0);
  });

  it("triples AI chat response limits", () => {
    expect(CHAT_LIMITS.general_free).toEqual({ limit: 30, warnAt: 24 });
    expect(CHAT_LIMITS.general_standard).toEqual({ limit: 150, warnAt: 135 });
    expect(CHAT_LIMITS.service_provider).toEqual({ limit: 900, warnAt: 840 });
    expect(resolveChatLimitKey("general", "free")).toBe("general_free");
    expect(resolveChatLimitKey("general", "standard")).toBe("general_standard");
    expect(resolveChatLimitKey("service_provider", "pro")).toBe("service_provider");
  });
});
