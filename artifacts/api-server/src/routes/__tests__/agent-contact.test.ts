import { describe, expect, it } from "vitest";
import { hasExplicitAgentContactSignal } from "../../lib/agent-contact-intent";

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
});
