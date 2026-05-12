import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export type InferredSchoolZones = {
  primary: string | null;
  intermediate: string | null;
  secondary: string | null;
};

const cache = new Map<string, { value: InferredSchoolZones | null; expiresAt: number }>();
const OK_TTL_MS = 6 * 60 * 60 * 1000; // 6h — zones rarely change; saves tokens on re-runs
const NEG_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;

function cacheKey(address: string, suburb: string): string {
  return `${suburb.toLowerCase().trim()}::${address.toLowerCase().trim().slice(0, 160)}`;
}

function parseTriple(text: string): InferredSchoolZones | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const pick = (k: string): string | null => {
      const v = o[k];
      if (v == null) return null;
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > 0 ? t.slice(0, 80) : null;
    };
    return {
      primary: pick("primary"),
      intermediate: pick("intermediate"),
      secondary: pick("secondary"),
    };
  } catch {
    return null;
  }
}

function hasAnyZone(z: InferredSchoolZones | null): z is InferredSchoolZones {
  if (!z) return false;
  return !!(z.primary || z.intermediate || z.secondary);
}

/**
 * When Hougarden / listing scrape has no school zone lines, infer likely NZ state
 * zone schools from address + suburb via the LLM. Names are then matched against
 * the MoE directory in {@link enrichSchoolZonesDetail} like listing-sourced names.
 */
export async function inferSchoolZonesFromLocation(
  address: string,
  suburb: string,
): Promise<InferredSchoolZones | null> {
  const addr = address?.trim() ?? "";
  const sub = suburb?.trim() ?? "";
  if (!addr && !sub) return null;

  const key = cacheKey(addr || sub, sub || "nz");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const prompt = `New Zealand property due diligence. For students living at this property, what are the most likely **state (public) school zone** schools?

Full address: ${addr || "(not provided)"}
Suburb / area: ${sub || "(not provided)"}

Rules:
- Suggest real NZ state schools whose names could appear in the Ministry of Education Schools Directory.
- One school name per level: primary (Years 1–6 or full primary 1–8), intermediate (only if that area uses a separate intermediate — otherwise null), secondary (Years 9–13).
- Many areas have year 7–8 at intermediate or at full primary — use null for intermediate when unsure or not applicable.
- Use official names (e.g. "Remuera School", "Baradene College").
- If you cannot name a plausible school for a level, use null — do not invent.
- Return ONLY this JSON shape, no markdown or explanation:
{"primary":string|null,"intermediate":string|null,"secondary":string|null}`;

  try {
    const llmCall = ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        maxOutputTokens: 512,
        temperature: 0.15,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const response = await Promise.race([
      llmCall,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("school-zones LLM timeout")), TIMEOUT_MS),
      ),
    ]);
    const parsed = parseTriple(response.text ?? "");
    if (!hasAnyZone(parsed)) {
      cache.set(key, { value: null, expiresAt: now + NEG_TTL_MS });
      logger.info({ suburb: sub }, "school-zones LLM: no schools returned");
      return null;
    }
    cache.set(key, { value: parsed, expiresAt: now + OK_TTL_MS });
    logger.info({ suburb: sub, zones: parsed }, "school-zones LLM inferred");
    return parsed;
  } catch (err) {
    cache.set(key, { value: null, expiresAt: now + NEG_TTL_MS });
    logger.warn({ err: (err as Error).message, suburb: sub }, "school-zones LLM failed");
    return null;
  }
}
