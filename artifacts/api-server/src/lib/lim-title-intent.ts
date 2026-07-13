import { ai } from "@workspace/integrations-gemini-ai";

export type LimTitleIntent = "positive" | "negative" | "unclear";

export interface LimTitleIntentResult {
  intent: LimTitleIntent;
  reason: string;
  source: "deterministic" | "llm" | "fallback";
}

const SIMPLE_POSITIVE = /^(?:yes|yep|yeah|sure|ok(?:ay)?|please|go ahead|do it|sounds good|i do|i would|send it|send them|that would be great)[.!\s]*$/i;
const SIMPLE_NEGATIVE = /^(?:no|nope|not now|no thanks|don't|do not|cancel|never mind|nevermind)[.!\s]*$/i;
const DOCUMENT_SIGNAL = /\b(?:lim|land information memorandum|title|record of title|certificate of title|property title|title document|title documents|property documents?)\b|åœŸåœ°ä¿¡æ¯å¤‡å¿˜å½•|åœŸåœ°ä¿¡æ¯å‚™å¿˜éŒ„|äº§æƒè¯|ç”¢æ¬Šè­‰|æˆ¿äº§è¯|æˆ¿ç”¢è­‰|åœ°å¥‘|æˆ¿å¥‘/i;
const ACQUISITION_SIGNAL = /\b(?:want|need|like|request|order|get|obtain|receive|send|email|provide|have|access|buy|purchase|please|can i|could i|would like|where can i)\b|æƒ³è¦|éœ€è¦|èŽ·å–|ç²å–|å‘ç»™|ç™¼çµ¦|è¯·ç»™|è«‹çµ¦|ç”³è¯·|è´­ä¹°|è³¼è²·/i;
const NEGATED_ACQUISITION = /\b(?:do not|don't|dont|not interested|no need|without|decline|cancel)\b|ä¸éœ€è¦|ä¸æƒ³|ä¸è¦|å–æ¶ˆ|å–æ¶ˆ/i;

export function deterministicLimTitleIntent(latestMessage: string, hasActiveOffer: boolean): LimTitleIntentResult | null {
  const text = latestMessage.trim();
  if (!text) return { intent: "unclear", reason: "Empty message", source: "deterministic" };
  if (hasActiveOffer && SIMPLE_POSITIVE.test(text)) {
    return { intent: "positive", reason: "Affirmative reply to the active LIM/title offer", source: "deterministic" };
  }
  if (hasActiveOffer && SIMPLE_NEGATIVE.test(text)) {
    return { intent: "negative", reason: "Negative reply to the active LIM/title offer", source: "deterministic" };
  }
  if (DOCUMENT_SIGNAL.test(text) && NEGATED_ACQUISITION.test(text)) {
    return { intent: "negative", reason: "The user declined the documents", source: "deterministic" };
  }
  if (DOCUMENT_SIGNAL.test(text) && ACQUISITION_SIGNAL.test(text)) {
    return { intent: "positive", reason: "The user explicitly requested LIM/title documents", source: "deterministic" };
  }
  return null;
}

export async function detectLimTitleIntent(args: {
  messages: Array<{ role: string; content: string }>;
  hasActiveOffer: boolean;
  propertyAddress: string;
}): Promise<LimTitleIntentResult> {
  const latest = [...args.messages].reverse().find((message) => message.role === "user")?.content?.trim() ?? "";
  const deterministic = deterministicLimTitleIntent(latest, args.hasActiveOffer);
  if (deterministic) return deterministic;

  const conversation = args.messages
    .slice(-8)
    .map((message) => `[${message.role.toUpperCase()}] ${message.content.slice(0, 600)}`)
    .join("\n");
  try {
    const prompt = `You classify the latest message in a New Zealand property feasibility chat.

PROPERTY: ${args.propertyAddress}
AN ACTIVE LIM/TITLE OFFER IS WAITING FOR A REPLY: ${args.hasActiveOffer ? "yes" : "no"}

RECENT CONVERSATION:
${conversation}

Classify only NEW intent in the latest user message:
- positive: they want the listing agent to provide, send, obtain, order, or help them get the property's LIM report, record of title, certificate of title, land title, or equivalent property documents. An affirmative answer counts only when an active offer is waiting.
- negative: they explicitly decline that offer or say they do not want the documents.
- unclear: they merely discuss what a LIM/title is, analyse title risks, ask an unrelated question, or the meaning is uncertain.

Understand paraphrases and any language. Be conservative: never treat a generic "yes" as positive without an active offer.
Return ONLY JSON: {"intent":"positive|negative|unclear","reason":"short explanation"}`;
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0, maxOutputTokens: 120 },
    });
    const raw = response.text?.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim() ?? "";
    const parsed = JSON.parse(raw) as { intent?: string; reason?: string };
    if (parsed.intent === "positive" || parsed.intent === "negative" || parsed.intent === "unclear") {
      return { intent: parsed.intent, reason: String(parsed.reason ?? "Semantic classification"), source: "llm" };
    }
  } catch {
    // Consent prompts should favour precision. Deterministic explicit requests
    // were already handled above; a bare mention of a LIM/title is not enough.
  }
  return { intent: "unclear", reason: "No reliable request intent detected", source: "fallback" };
}
