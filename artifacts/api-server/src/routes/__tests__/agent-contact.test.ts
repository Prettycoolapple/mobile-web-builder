import { describe, expect, it } from "vitest";
import {
  hasExplicitAgentContactSignal,
  isCombinedPackageAnalyseRequest,
  isReportFollowUpQuestion,
} from "../../lib/agent-contact-intent";

describe("agent contact intent signals", () => {
  it("catches mixed Chinese and English requests before LLM intent detection", () => {
    expect(hasExplicitAgentContactSignal("谁是 agent")).toBe(true);
    expect(hasExplicitAgentContactSignal("agent 是谁")).toBe(true);
    expect(hasExplicitAgentContactSignal("联系销售中介")).toBe(true);
    expect(hasExplicitAgentContactSignal("聯繫銷售中介")).toBe(true);
    expect(hasExplicitAgentContactSignal("Contact Sales agent")).toBe(true);
  });

  it("does not treat development professional requests as listing-agent requests", () => {
    expect(hasExplicitAgentContactSignal("Recommend me an architect or designer")).toBe(false);
    expect(hasExplicitAgentContactSignal("这个地块 ROI 可以如何提升?")).toBe(false);
  });

  it("never classifies '分析完整组合' / 'Analyse full package' prompts as agent-contact", () => {
    expect(
      hasExplicitAgentContactSignal(
        "分析组合挂牌 15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland City, Auckland",
      ),
    ).toBe(false);
    expect(
      hasExplicitAgentContactSignal(
        "Analyse the combined listing package 15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      ),
    ).toBe(false);
    // Even when the Chinese text contains 中介-style tokens, a real package
    // analyse prompt is still hard-negative.
    expect(
      hasExplicitAgentContactSignal(
        "分析组合挂牌 12 Smith Road and 14 Smith Road — 中介后续再问",
      ),
    ).toBe(false);
  });
});

describe("isReportFollowUpQuestion", () => {
  it("treats post-report questions as hard-negative for agent contact", () => {
    // The exact questions that were being answered with a repeat of the agent
    // card instead of an answer.
    expect(isReportFollowUpQuestion("Can you explain the cost estimate you factored in?")).toBe(true);
    expect(isReportFollowUpQuestion("What are the key risks")).toBe(true);
    expect(isReportFollowUpQuestion("5 个地块的审批流程是什么？")).toBe(true);
    expect(isReportFollowUpQuestion("这个项目的回报率如何?")).toBe(true);
    expect(isReportFollowUpQuestion("How long does resource consent take?")).toBe(true);
    expect(isReportFollowUpQuestion("What's the zoning here?")).toBe(true);
  });

  it("does not classify agent requests or greetings as report follow-ups", () => {
    expect(isReportFollowUpQuestion("Contact Sales agent")).toBe(false);
    expect(isReportFollowUpQuestion("Who is selling this?")).toBe(false);
    expect(isReportFollowUpQuestion("联系中介")).toBe(false);
    expect(isReportFollowUpQuestion("thanks!")).toBe(false);
    expect(isReportFollowUpQuestion("")).toBe(false);
  });

  it("keeps explicit agent asks winning over the report-topic guard", () => {
    // Callers run hasExplicitAgentContactSignal first, so a message that
    // mentions both still resolves to the agent.
    const mixed = "Can you get the agent to explain the consent process?";
    expect(hasExplicitAgentContactSignal(mixed)).toBe(true);
  });
});

describe("isCombinedPackageAnalyseRequest", () => {
  it("matches the button's Chinese prompt", () => {
    expect(
      isCombinedPackageAnalyseRequest(
        "分析组合挂牌 15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland City, Auckland",
      ),
    ).toBe(true);
  });

  it("matches the button's English prompt", () => {
    expect(
      isCombinedPackageAnalyseRequest(
        "Analyse the combined listing package 15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      ),
    ).toBe(true);
  });

  it("rejects a normal single-address analyse prompt", () => {
    expect(isCombinedPackageAnalyseRequest("Analyse 15 Fisherton Street, Grey Lynn")).toBe(false);
    expect(isCombinedPackageAnalyseRequest("分析 15 Fisherton Street, Grey Lynn")).toBe(false);
  });

  it("rejects empty or whitespace-only input", () => {
    expect(isCombinedPackageAnalyseRequest("")).toBe(false);
    expect(isCombinedPackageAnalyseRequest("   ")).toBe(false);
  });
});
