import { GoogleGenAI } from "@google/genai";

type ContentPart = { text?: string };
type ChatContent = { role: string; parts: ContentPart[] };
type GenerateContentArgs = {
  model: string;
  contents: ChatContent[];
  config?: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    // Kept for compatibility with existing call sites.
    thinkingConfig?: { thinkingBudget?: number };
  };
};
type GenerateContentResult = { text?: string };

type AiLike = {
  models: {
    generateContent: (args: GenerateContentArgs) => Promise<GenerateContentResult>;
  };
};

type ProviderMode = "gemini" | "openai_compat";

function normalizeProvider(raw: string | undefined): ProviderMode {
  const provider = (raw ?? "gemini").trim().toLowerCase();
  if (provider === "gemini") return "gemini";
  if (provider === "deepseek" || provider === "grok" || provider === "openai_compat") return "openai_compat";
  throw new Error(
    `Unsupported AI provider "${provider}". Use one of: gemini, deepseek, grok, openai_compat.`,
  );
}

function mapRequestedModel(inputModel: string): string {
  const model = inputModel.trim().toLowerCase();
  const fastFallback = process.env.AI_OPENAI_COMPAT_MODEL_FAST?.trim();
  const proFallback = process.env.AI_OPENAI_COMPAT_MODEL_PRO?.trim();
  const defaultFallback = process.env.AI_OPENAI_COMPAT_MODEL_DEFAULT?.trim();

  // Gemini callsites generally use "flash" for fast ops and "pro" for heavier reasoning.
  if (model.includes("flash")) {
    return fastFallback ?? defaultFallback ?? proFallback ?? inputModel;
  }
  return proFallback ?? defaultFallback ?? fastFallback ?? inputModel;
}

function isTruthy(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null) return defaultValue;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function mapRole(role: string): "user" | "assistant" {
  return role === "model" || role === "assistant" ? "assistant" : "user";
}

function flattenParts(parts: ContentPart[] | undefined): string {
  if (!parts || parts.length === 0) return "";
  return parts.map((p) => p?.text ?? "").join("").trim();
}

function createGeminiClient(): AiLike {
  const geminiApiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim();
  if (!geminiApiKey) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set when AI_PROVIDER=gemini.",
    );
  }

  const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL?.trim();
  const aiOptions: ConstructorParameters<typeof GoogleGenAI>[0] = { apiKey: geminiApiKey };
  if (geminiBaseUrl) {
    aiOptions.httpOptions = { apiVersion: "", baseUrl: geminiBaseUrl };
  }

  return new GoogleGenAI(aiOptions) as unknown as AiLike;
}

function createOpenAICompatClient(): AiLike {
  const apiKey = process.env.AI_OPENAI_COMPAT_API_KEY?.trim();
  const baseUrl = process.env.AI_OPENAI_COMPAT_BASE_URL?.trim();
  if (!apiKey || !baseUrl) {
    throw new Error(
      "AI_OPENAI_COMPAT_API_KEY and AI_OPENAI_COMPAT_BASE_URL must be set when AI_PROVIDER is deepseek, grok, or openai_compat.",
    );
  }

  const client: AiLike = {
    models: {
      generateContent: async (args: GenerateContentArgs): Promise<GenerateContentResult> => {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
        if (args.config?.systemInstruction) {
          messages.push({ role: "system", content: args.config.systemInstruction });
        }
        for (const item of args.contents ?? []) {
          const content = flattenParts(item.parts);
          if (!content) continue;
          messages.push({ role: mapRole(item.role), content });
        }

        const model = mapRequestedModel(args.model);
        const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: args.config?.maxOutputTokens,
            temperature: args.config?.temperature,
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new Error(`OpenAI-compatible provider error ${response.status}: ${body}`);
        }

        const data = (await response.json()) as {
          choices?: Array<{
            message?: { content?: string | Array<{ type?: string; text?: string }> };
            finish_reason?: string;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        const choice = data.choices?.[0];
        const finishReason = choice?.finish_reason;
        const usage = data.usage;

        // Detect truncated responses: finish_reason "length" means the model
        // hit the max_tokens limit and the output is incomplete.
        if (finishReason === "length") {
          console.warn(
            `[ai] OpenAI-compat response TRUNCATED (finish_reason=length). ` +
              `model=${model}, prompt_tokens=${usage?.prompt_tokens ?? "?"}, ` +
              `completion_tokens=${usage?.completion_tokens ?? "?"}, ` +
              `max_tokens=${args.config?.maxOutputTokens ?? "default"}. ` +
              `The output is likely incomplete — increase maxOutputTokens or reduce prompt size.`,
          );
        }

        // Log empty/no-content responses
        if (!choice?.message?.content) {
          console.warn(
            `[ai] OpenAI-compat returned empty content. model=${model}, ` +
              `finish_reason=${finishReason ?? "?"}, ` +
              `prompt_tokens=${usage?.prompt_tokens ?? "?"}`,
          );
        }

        const content = choice?.message?.content;
        if (typeof content === "string") return { text: content };
        if (Array.isArray(content)) {
          const merged = content
            .map((chunk) => (chunk?.type === "text" ? chunk.text ?? "" : ""))
            .join("")
            .trim();
          return { text: merged };
        }
        return { text: "" };
      },
    },
  };

  return client;
}

function maybeCreateOpenAICompatClient(): AiLike | null {
  const apiKey = process.env.AI_OPENAI_COMPAT_API_KEY?.trim();
  const baseUrl = process.env.AI_OPENAI_COMPAT_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  return createOpenAICompatClient();
}

function shouldFailoverFromGemini(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (!message) return false;

  // Typical transient/provider-side failures and quota/rate limits.
  const patterns = [
    "429",
    "500",
    "502",
    "503",
    "504",
    "rate limit",
    "quota",
    "resource exhausted",
    "unavailable",
    "deadline exceeded",
    "timed out",
    "timeout",
    "network",
    "fetch failed",
    "econn",
    "enotfound",
    "socket hang up",
  ];
  return patterns.some((p) => message.includes(p));
}

const provider = normalizeProvider(process.env.AI_PROVIDER);
const failoverEnabled = isTruthy(process.env.AI_FAILOVER_ENABLED, true);

function createGeminiWithFailoverClient(): AiLike {
  const primary = createGeminiClient();
  const fallback = maybeCreateOpenAICompatClient();

  return {
    models: {
      generateContent: async (args: GenerateContentArgs): Promise<GenerateContentResult> => {
        try {
          return await primary.models.generateContent(args);
        } catch (primaryErr) {
          const canFailover = failoverEnabled && fallback && shouldFailoverFromGemini(primaryErr);
          if (!canFailover) throw primaryErr;

          try {
            console.warn(
              "[ai] Gemini call failed; attempting failover to OpenAI-compatible provider.",
            );
            return await fallback.models.generateContent(args);
          } catch {
            // Preserve the original Gemini error for easier debugging.
            throw primaryErr;
          }
        }
      },
    },
  };
}

export const ai: AiLike = provider === "gemini"
  ? createGeminiWithFailoverClient()
  : createOpenAICompatClient();
