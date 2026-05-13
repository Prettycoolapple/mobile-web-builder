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

type ProviderMode = "openai_compat";

function normalizeProvider(raw: string | undefined): ProviderMode {
  const provider = (raw ?? "deepseek").trim().toLowerCase();
  if (provider === "deepseek" || provider === "grok" || provider === "openai_compat") return "openai_compat";
  throw new Error(
    `Unsupported AI provider "${provider}". Use one of: deepseek, grok, openai_compat.`,
  );
}

function mapRequestedModel(inputModel: string): string {
  const model = inputModel.trim().toLowerCase();
  const fastFallback = process.env.AI_OPENAI_COMPAT_MODEL_FAST?.trim();
  const proFallback = process.env.AI_OPENAI_COMPAT_MODEL_PRO?.trim();
  const defaultFallback = process.env.AI_OPENAI_COMPAT_MODEL_DEFAULT?.trim();
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || "deepseek";
  const providerFastDefault = provider === "deepseek" ? "deepseek-chat" : inputModel;
  const providerProDefault = provider === "deepseek" ? "deepseek-reasoner" : providerFastDefault;

  // Legacy callsites use "flash" for fast ops and "pro" for heavier reasoning.
  if (model.includes("flash") || model.includes("chat")) {
    return fastFallback ?? defaultFallback ?? proFallback ?? providerFastDefault;
  }
  return proFallback ?? defaultFallback ?? fastFallback ?? providerProDefault;
}

function mapRole(role: string): "user" | "assistant" {
  return role === "model" || role === "assistant" ? "assistant" : "user";
}

function flattenParts(parts: ContentPart[] | undefined): string {
  if (!parts || parts.length === 0) return "";
  return parts.map((p) => p?.text ?? "").join("").trim();
}

function readOpenAICompatConfig(): { apiKey: string; baseUrl: string } {
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || "deepseek";
  const apiKey =
    process.env.AI_OPENAI_COMPAT_API_KEY?.trim() ||
    process.env.DEEPSEEK_API_KEY?.trim();
  const baseUrl =
    process.env.AI_OPENAI_COMPAT_BASE_URL?.trim() ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    (provider === "deepseek" ? "https://api.deepseek.com/v1" : "");

  if (!apiKey || !baseUrl) {
    throw new Error(
      "AI provider is not configured. Set AI_OPENAI_COMPAT_API_KEY and AI_OPENAI_COMPAT_BASE_URL, or set DEEPSEEK_API_KEY for the default DeepSeek provider.",
    );
  }

  return { apiKey, baseUrl };
}

function createOpenAICompatClient(): AiLike {
  normalizeProvider(process.env.AI_PROVIDER);
  const { apiKey, baseUrl } = readOpenAICompatConfig();

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

let cachedClient: AiLike | null = null;

function getOpenAICompatClient(): AiLike {
  cachedClient ??= createOpenAICompatClient();
  return cachedClient;
}

export const ai: AiLike = {
  models: {
    generateContent: async (args) => getOpenAICompatClient().models.generateContent(args),
  },
};
