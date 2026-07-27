import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { ai } from "@workspace/integrations-gemini-ai";
import { ipRateLimit, minutes } from "../lib/rateLimit";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = {
    ...HealthCheckResponse.parse({ status: "ok" }),
    deploymentSha: process.env["VERCEL_GIT_COMMIT_SHA"] ?? process.env["GIT_COMMIT_SHA"] ?? null,
  };
  res.json(data);
});

/**
 * Liveness probe for the AI provider. Chat, intent detection and follow-up
 * answers all fail the same way when the provider is down (quota, balance,
 * outage), so this makes the difference between "our service is broken" and
 * "the model provider is refusing calls" a one-request check. Deliberately
 * tiny: one short completion on the fast model.
 */
router.get(
  "/healthz/ai",
  ipRateLimit({ name: "healthz-ai", windowMs: minutes(1), max: 6 }),
  async (_req, res) => {
    const startedAt = Date.now();
    try {
      const result = await ai.models.generateContent({
        model: "deepseek-chat",
        contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }],
        config: { maxOutputTokens: 8, temperature: 0, timeoutMs: 20_000 },
      });
      const text = (result.text ?? "").trim();
      res.json({
        status: text ? "ok" : "empty_response",
        latencyMs: Date.now() - startedAt,
        sample: text.slice(0, 40),
      });
    } catch (err) {
      // The provider's own error text (rate limit, insufficient balance, bad
      // key) is the useful part — truncated so nothing large leaks into logs.
      res.status(503).json({
        status: "unavailable",
        latencyMs: Date.now() - startedAt,
        error: (err as Error)?.message?.slice(0, 300) ?? "unknown error",
      });
    }
  },
);

export default router;
