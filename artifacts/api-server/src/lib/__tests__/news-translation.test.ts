import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@workspace/integrations-gemini-ai", () => ({
  ai: { models: { generateContent: aiMocks.generateContent } },
}));

import { translateNewsPost } from "../news-translation";

describe("news translation", () => {
  beforeEach(() => aiMocks.generateContent.mockReset());

  it("returns editable bilingual fields and asks the model to preserve Markdown", async () => {
    aiMocks.generateContent.mockResolvedValue({
      text: '```json\n{"title":"热门消息 ✨","body":"## 标题\\n\\n- 保留 **Markdown**"}\n```',
    });

    await expect(translateNewsPost({
      sourceLanguage: "en",
      title: "Hot news ✨",
      body: "## Heading\n\n- Keep **Markdown**",
    })).resolves.toEqual({ title: "热门消息 ✨", body: "## 标题\n\n- 保留 **Markdown**" });

    const request = aiMocks.generateContent.mock.calls[0]?.[0] as { config?: { systemInstruction?: string } };
    expect(request.config?.systemInstruction).toContain("Preserve Markdown structure");
    expect(request.config?.systemInstruction).toContain("Simplified Chinese");
  });

  it("rejects incomplete output instead of silently copying source text", async () => {
    aiMocks.generateContent.mockResolvedValue({ text: '{"title":"Only a title"}' });
    await expect(translateNewsPost({ sourceLanguage: "zh", title: "标题", body: "正文" }))
      .rejects.toThrow("Translation returned incomplete content");
  });
});
