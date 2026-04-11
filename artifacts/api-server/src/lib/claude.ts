import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import { SYSTEM_PROMPT, ANALYSE_AUGMENTATION, DISCOVER_AUGMENTATION } from "./prompts";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type ChatMode = "analyse" | "discover" | "followup";

export function detectMode(lastMessage: string): ChatMode {
  const lower = lastMessage.toLowerCase().trim();

  const searchKeywords = ["find me", "find properties", "search for", "show me properties", "discover", "looking for properties", "what properties", "properties in", "sections in", "land in"];
  if (searchKeywords.some((k) => lower.includes(k))) return "discover";

  const analyseKeywords = ["analyse", "analyze", "analysis", "feasibility", "check", "look at", "assess", "evaluate", "review"];
  const hasAddress = /\d+\s+\w+\s+(road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill)/i.test(lastMessage);
  const hasAddressComma = /,\s*(auckland|wellington|christchurch|hamilton|tauranga|dunedin|napier|hastings|palmerston|rotorua|new zealand|nz)/i.test(lastMessage);

  if (hasAddress || hasAddressComma) return "analyse";
  if (analyseKeywords.some((k) => lower.includes(k)) && lower.match(/\d+/)) return "analyse";

  return "followup";
}

function buildGeminiHistory(conversationHistory: Message[]) {
  return conversationHistory.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
}

export async function generateUnifiedResponse(
  messages: Message[],
  currentReport?: object,
): Promise<{ content: string; mode: ChatMode }> {
  if (messages.length === 0) {
    return { content: "How can I help you with NZ property development today?", mode: "followup" };
  }

  const lastMessage = messages[messages.length - 1];
  const conversationHistory = messages.slice(0, -1);
  const mode = detectMode(lastMessage.content);

  const systemWithContext = currentReport
    ? `${SYSTEM_PROMPT}\n\nCURRENT PROPERTY CONTEXT (the user is discussing this report):\n${JSON.stringify(currentReport, null, 2)}`
    : SYSTEM_PROMPT;

  let userContent = lastMessage.content;
  if (mode === "analyse") {
    userContent = `${lastMessage.content}\n\n${ANALYSE_AUGMENTATION}`;
  } else if (mode === "discover") {
    userContent = `${lastMessage.content}\n\n${DISCOVER_AUGMENTATION}`;
  }

  const history = buildGeminiHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: systemWithContext,
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: userContent }] },
      ],
    });
    const content = response.text ?? "";
    return { content, mode };
  } catch (error) {
    logger.error({ error }, "Failed to generate unified response");
    throw error;
  }
}

export async function generateFeasibilityReport(
  address: string,
  conversationHistory: Message[] = [],
): Promise<string> {
  const prompt = `Analyse this NZ property for development feasibility: ${address}\n\n${ANALYSE_AUGMENTATION}`;
  const history = buildGeminiHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: prompt }] },
      ],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate feasibility report");
    throw error;
  }
}

export async function generateSearchResults(
  query: string,
  suburb?: string,
  minPrice?: number,
  maxPrice?: number,
): Promise<string> {
  const prompt = `Search query: "${query}"
${suburb ? `Target suburb: ${suburb}` : ""}
${minPrice ? `Min price: NZD ${minPrice.toLocaleString()}` : ""}
${maxPrice ? `Max price: NZD ${maxPrice.toLocaleString()}` : ""}

${DISCOVER_AUGMENTATION}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8192,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate search results");
    throw error;
  }
}

export async function generateChatReply(
  message: string,
  conversationHistory: Message[] = [],
  reportContext?: string,
): Promise<string> {
  const systemWithContext = reportContext
    ? `${SYSTEM_PROMPT}\n\nCURRENT PROPERTY CONTEXT:\n${reportContext}`
    : SYSTEM_PROMPT;

  const history = buildGeminiHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: systemWithContext,
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: message }] },
      ],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate chat reply");
    throw error;
  }
}
