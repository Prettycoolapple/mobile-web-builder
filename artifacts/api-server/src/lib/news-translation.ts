import { ai } from "@workspace/integrations-gemini-ai";

export type NewsLanguage = "en" | "zh";

const LANGUAGE_NAME: Record<NewsLanguage, string> = {
  en: "English",
  zh: "Simplified Chinese",
};

export async function translateNewsPost(input: {
  sourceLanguage: NewsLanguage;
  title: string;
  body: string;
}): Promise<{ title: string; body: string }> {
  const targetLanguage: NewsLanguage = input.sourceLanguage === "en" ? "zh" : "en";
  const response = await ai.models.generateContent({
    model: "deepseek-chat",
    config: {
      systemInstruction: `Translate a Project Alpha news post from ${LANGUAGE_NAME[input.sourceLanguage]} to ${LANGUAGE_NAME[targetLanguage]}.
Preserve Markdown structure, emojis, URLs, numbers, NZ place names, company names, and proper nouns.
Return ONLY valid JSON with exactly two string fields: {"title":"...","body":"..."}. Do not add commentary.`,
      temperature: 0.1,
      maxOutputTokens: Math.min(8192, Math.max(512, input.body.length * 3)),
      thinkingConfig: { thinkingBudget: 0 },
    },
    contents: [{
      role: "user",
      parts: [{ text: JSON.stringify({ title: input.title, body: input.body }) }],
    }],
  });

  const raw = (response.text ?? "").trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(raw) as { title?: unknown; body?: unknown };
  if (typeof parsed.title !== "string" || typeof parsed.body !== "string" || !parsed.title.trim() || !parsed.body.trim()) {
    throw new Error("Translation returned incomplete content");
  }
  return { title: parsed.title.trim(), body: parsed.body.trim() };
}
