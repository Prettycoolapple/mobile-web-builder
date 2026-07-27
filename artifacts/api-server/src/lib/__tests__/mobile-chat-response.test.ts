import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../prompts";

describe("mobile conversational response policy", () => {
  it("keeps complex chat answers compact and supports progressive disclosure", () => {
    expect(SYSTEM_PROMPT).toContain("Optimise for a phone screen");
    expect(SYSTEM_PROMPT).toContain("60–140 words");
    expect(SYSTEM_PROMPT).toContain("2–4 most useful points");
    expect(SYSTEM_PROMPT).toContain("exactly one brief, context-specific question");
  });

  it("does not force a follow-up question onto every response type", () => {
    expect(SYSTEM_PROMPT).toContain(
      "Do not append a follow-up question to a simple factual confirmation",
    );
  });
});
