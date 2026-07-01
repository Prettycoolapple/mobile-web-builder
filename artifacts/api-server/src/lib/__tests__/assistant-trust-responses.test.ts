import { describe, expect, it } from "vitest";
import { assistantTrustResponseFor, classifyAssistantTrustResponse } from "../assistant-trust-responses";

describe("assistant trust response guard", () => {
  it("answers credibility questions with high-level live-data reassurance", () => {
    const response = assistantTrustResponseFor(
      "\u4f60\u7684\u8fd9\u4e2a\u53ef\u4fe1\u5ea6\u6709\u591a\u9ad8\uff1f\u6211\u80fd\u76f8\u4fe1\u4f60\u5417\uff1f",
      "zh",
    );

    expect(response?.kind).toBe("trust");
    expect(response?.content).toContain("REINZ");
    expect(response?.content).toContain("Government");
    expect(response?.content).toContain("Project Alpha");
  });

  it("does not list detailed sources when the user asks for all references", () => {
    const response = assistantTrustResponseFor(
      "\u4f60\u90fd\u53c2\u8003\u4e86\u54ea\u4e9b\u4fe1\u606f\uff1f\u6211\u62c5\u5fc3\u4f60\u7684\u8fd9\u4e2a\u51c6\u786e\u5ea6\u3002\u4f60\u628a\u4f60\u6240\u6709\u53c2\u8003\u7684\u4fe1\u606f\u90fd\u5217\u51fa\u6765\u7ed9\u6211",
      "zh",
    );

    expect(response?.kind).toBe("source_list");
    expect(response?.content).toContain("REINZ");
    expect(response?.content).toContain("Government");
    expect(response?.content).not.toMatch(/http|www|OneRoof|Trade Me|realestate\.co\.nz|LINZ|Auckland Council/i);
  });

  it("explains consultant recommendation authority without claiming web search", () => {
    const response = assistantTrustResponseFor(
      "\u4f60\u7684\u987e\u95ee\u63a8\u8350\u662f\u600e\u4e48\u6765\u7684\uff1f\u662f\u5168\u7f51\u641c\u7d22\u5417\uff1f\u6211\u5f88\u62c5\u5fc3\u8fd9\u4e2a\u6743\u5a01\u6027.",
      "zh",
    );

    expect(response?.kind).toBe("provider_authority");
    expect(response?.content).toContain("Project Alpha");
    expect(response?.content).toContain("\u5408\u4f5c\u987e\u95ee");
    expect(response?.content).toContain("\u672c\u5730\u7ecf\u9a8c");
  });

  it("handles requests for additional planners with the wait-list response", () => {
    const response = assistantTrustResponseFor(
      "\u4f60\u628a\u5176\u4ed6\u7684\u89c4\u5212\u5e08\u4e5f\u63a8\u8350\u7ed9\u6211\uff0c\u4f60\u80af\u5b9a\u4e0d\u53ea\u6709\u4e00\u4e2a\u5440\u3002",
      "zh",
    );

    expect(response?.kind).toBe("more_providers");
    expect(response?.content).toContain("\u66f4\u591a\u987e\u95ee\u4e0a\u7ebf");
    expect(response?.content).toContain("\u7a0d\u540e\u518d\u8bd5");
  });

  it("answers Chinese prompts in Chinese even when locale headers are missing", () => {
    const response = assistantTrustResponseFor("\u6211\u80fd\u76f8\u4fe1\u4f60\u5417\uff1f", "en");

    expect(response?.kind).toBe("trust");
    expect(response?.content).toContain("\u53ef\u884c\u6027\u53c2\u8003");
  });

  it("classifies equivalent English prompts", () => {
    expect(classifyAssistantTrustResponse("How accurate is this, can I trust you?")).toBe("trust");
    expect(classifyAssistantTrustResponse("List all the sources and references you used.")).toBe("source_list");
    expect(classifyAssistantTrustResponse("Are your planner recommendations from a whole web search?")).toBe("provider_authority");
    expect(classifyAssistantTrustResponse("Recommend another planner, surely you have more than one.")).toBe("more_providers");
  });
});
