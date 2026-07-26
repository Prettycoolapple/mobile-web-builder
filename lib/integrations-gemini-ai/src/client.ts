type ContentPart = { text?: string };
type ChatContent = { role: string; parts: ContentPart[] };
type GenerateContentArgs = {
  model: string;
  contents: ChatContent[];
  config?: {
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    /**
     * Abort the upstream request after this many milliseconds. Without it a
     * stalled provider call keeps the caller (and the mobile client waiting on
     * it) hanging until the platform kills the whole function. Callers that
     * have a fallback path should always set this.
     */
    timeoutMs?: number;
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

/**
 * DeepSeek retired the `deepseek-chat` and `deepseek-reasoner` aliases at
 * 2026-07-24 15:59 UTC; calls using them now fail outright. Callsites across
 * the app still pass the old names as tier hints, and a deployment env var may
 * still pin one, so the dead names are rewritten here — the single point every
 * request funnels through — rather than at ~30 callsites.
 */
const RETIRED_MODEL_ALIASES: Record<string, string> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro",
};

function replaceRetiredAlias(model: string): string {
  return RETIRED_MODEL_ALIASES[model.trim().toLowerCase()] ?? model;
}

type ModelTier = "fast" | "pro";

function mapRequestedModel(inputModel: string): { model: string; tier: ModelTier } {
  const model = inputModel.trim().toLowerCase();
  const fastFallback = process.env.AI_OPENAI_COMPAT_MODEL_FAST?.trim();
  const proFallback = process.env.AI_OPENAI_COMPAT_MODEL_PRO?.trim();
  const defaultFallback = process.env.AI_OPENAI_COMPAT_MODEL_DEFAULT?.trim();
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || "deepseek";
  const providerFastDefault = provider === "deepseek" ? "deepseek-v4-flash" : inputModel;
  const providerProDefault = provider === "deepseek" ? "deepseek-v4-pro" : providerFastDefault;

  // Legacy callsites use "flash" for fast ops and "pro" for heavier reasoning.
  if (model.includes("flash") || model.includes("chat")) {
    return { model: replaceRetiredAlias(fastFallback ?? defaultFallback ?? proFallback ?? providerFastDefault), tier: "fast" };
  }
  return { model: replaceRetiredAlias(proFallback ?? defaultFallback ?? fastFallback ?? providerProDefault), tier: "pro" };
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

        const { model, tier } = mapRequestedModel(args.model);
        // Both v4 models think by default, but the retired `deepseek-chat` this
        // replaces did not. Fast-tier callers are latency- and cost-sensitive,
        // so they keep non-thinking behaviour unless they ask for a budget.
        const thinkingBudget = args.config?.thinkingConfig?.thinkingBudget;
        const disableThinking = thinkingBudget === 0 || (tier === "fast" && thinkingBudget === undefined);
        const timeoutMs = args.config?.timeoutMs;
        const abortController = timeoutMs && timeoutMs > 0 ? new AbortController() : null;
        const timeoutHandle = abortController
          ? setTimeout(() => abortController.abort(), timeoutMs)
          : null;
        let response: Awaited<ReturnType<typeof fetch>>;
        try {
          response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
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
              ...(disableThinking ? { thinking: { type: "disabled" } } : {}),
            }),
            signal: abortController?.signal,
          });
        } catch (err) {
          if (abortController?.signal.aborted) {
            throw new Error(`OpenAI-compatible provider timed out after ${timeoutMs}ms (model=${model})`);
          }
          throw err;
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }

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
