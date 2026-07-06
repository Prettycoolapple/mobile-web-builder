import crypto from "node:crypto";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export const DWELLING_CONDITION_ASSESSMENT_VERSION = 1;
export const RECENT_IMPROVEMENT_AGE_YEARS = 20;
export const DWELLING_CONDITION_COST_REASON =
  "Recent build/renovation premium: existing improvements may be priced into acquisition but partly lost if the site is demolished or reconfigured.";

export type DwellingCondition =
  | "new_build"
  | "near_new"
  | "renovated"
  | "extended"
  | "maintained"
  | "original"
  | "dated"
  | "unknown";

export type DwellingConditionConfidence = "low" | "medium" | "high";
export type DwellingConditionSource = "build_year" | "listing_text" | "text_llm" | "vision" | "combined";
export type DwellingConditionCostPenalty = 0 | 0.5 | 1.0;

export interface DwellingConditionAssessment {
  assessmentVersion: number;
  sourceFingerprint: string;
  assessedAt: string;
  condition: DwellingCondition;
  recentImprovement: boolean;
  additionOrExtension: boolean;
  confidence: DwellingConditionConfidence;
  source: DwellingConditionSource;
  evidence: string[];
  costPenalty: DwellingConditionCostPenalty;
}

export interface DwellingConditionInput {
  address: string;
  buildYear?: number | null;
  buildYearRange?: string | null;
  listingTitle?: string | null;
  description?: string | null;
  features?: string[] | null;
  propertyType?: string | null;
  listingUrl?: string | null;
  photoUrls?: string[] | null;
  cachedAssessment?: DwellingConditionAssessment | null;
  currentYear?: number;
}

interface AssessmentDeps {
  textLlm?: (input: DwellingConditionInput) => Promise<Partial<DwellingConditionAssessment> | null>;
  vision?: (input: DwellingConditionInput, photoUrls: string[]) => Promise<Partial<DwellingConditionAssessment> | null>;
  now?: Date;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function evidenceSnippet(text: string, pattern: RegExp): string | null {
  const m = pattern.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - 35);
  const end = Math.min(text.length, m.index + m[0].length + 45);
  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${end < text.length ? "..." : ""}`;
}

function uniq(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((v) => cleanText(v)).filter(Boolean))];
}

export function currentNzYear(now = new Date()): number {
  const year = new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", year: "numeric" }).format(now);
  return Number(year);
}

export function selectedDwellingConditionPhotoUrls(photoUrls: string[] | null | undefined): string[] {
  return uniq(photoUrls ?? []).slice(0, 5);
}

export function buildDwellingConditionFingerprint(input: DwellingConditionInput): string {
  const photos = selectedDwellingConditionPhotoUrls(input.photoUrls);
  const payload = JSON.stringify({
    address: cleanText(input.address).toLowerCase(),
    buildYear: input.buildYear ?? null,
    buildYearRange: cleanText(input.buildYearRange),
    listingUrl: cleanText(input.listingUrl).toLowerCase(),
    title: cleanText(input.listingTitle).toLowerCase(),
    description: cleanText(input.description).toLowerCase(),
    features: uniq(input.features ?? []).map((f) => f.toLowerCase()),
    propertyType: cleanText(input.propertyType).toLowerCase(),
    photos,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function emptyAssessment(sourceFingerprint: string, now: Date): DwellingConditionAssessment {
  return {
    assessmentVersion: DWELLING_CONDITION_ASSESSMENT_VERSION,
    sourceFingerprint,
    assessedAt: now.toISOString(),
    condition: "unknown",
    recentImprovement: false,
    additionOrExtension: false,
    confidence: "low",
    source: "build_year",
    evidence: [],
    costPenalty: 0,
  };
}

function assessmentFromBuildYear(
  input: DwellingConditionInput,
  sourceFingerprint: string,
  now: Date,
): DwellingConditionAssessment | null {
  const buildYear = input.buildYear ?? null;
  const year = input.currentYear ?? currentNzYear(now);
  if (buildYear == null || buildYear <= 0 || buildYear > year + 2) return null;
  const age = year - buildYear;
  if (age < 0 || age >= RECENT_IMPROVEMENT_AGE_YEARS) return null;

  return {
    assessmentVersion: DWELLING_CONDITION_ASSESSMENT_VERSION,
    sourceFingerprint,
    assessedAt: now.toISOString(),
    condition: age <= 2 ? "new_build" : "near_new",
    recentImprovement: true,
    additionOrExtension: false,
    confidence: "high",
    source: "build_year",
    evidence: [`Built ${buildYear}; dwelling age is ${age} year${age === 1 ? "" : "s"}.`],
    costPenalty: age <= 9 ? 1.0 : 0.5,
  };
}

const NEGATIVE_RENOVATION_RE =
  /\b(?:renovat(?:e|ion|ions?)\s+(?:potential|project|opportunity|vision)|awaiting\s+(?:your\s+)?renovation|needs?\s+(?:a\s+)?renovat|bring\s+your\s+(?:tools|builder)|do[-\s]?up|blank\s+canvas|original\s+[^.]{0,80}\b(?:renovat|restore|upgrade))\b/i;
const ORIGINAL_RE = /\b(?:original|mostly\s+original|dated|tired|deferred\s+maintenance|as-is|as\s+is)\b/i;
const STRONG_RENOVATION_RE =
  /\b(?:fully|completely|extensively|recently|newly)\s+renovat(?:ed|ion)|\brenovated\s+throughout\b|\bfull\s+renovation\b|\bturn[-\s]?key\s+renovation\b/i;
const EXTENSION_RE =
  /\b(?:(?:architectural|major|substantial|consented|modern)\s+(?:extension|addition)|new\s+(?:extension|addition)|(?:extended|added)\s+[^.]{0,80}\b(?:bedroom|living|space|wing|level|storey|story|floor|master))\b/i;
const MEDIUM_RENOVATION_RE =
  /\b(?:moderni[sz]ed|refurbished|re[-\s]?wired|re[-\s]?plumbed|new\s+roof\s+[^.]{0,80}\b(?:kitchen|bathroom|interior|wiring|plumbing)|updated\s+(?:kitchen|bathroom|bathrooms)\s+[^.]{0,80}\b(?:kitchen|bathroom|bathrooms))\b/i;
const SINGLE_CHATTEL_RE = /\b(?:brand\s+new|new|updated)\s+(?:kitchen|bathroom|carpet|paint|flooring|deck|appliance|benchtop)s?\b/i;
const AMBIGUOUS_MODERN_RE =
  /\b(?:modern|contemporary|immaculate|as[-\s]?new|designer\s+finish|high[-\s]?spec|show\s*home|beautifully\s+presented)\b/i;

function countFixedUpgradeTerms(text: string): number {
  const matches = text.match(/\b(?:new|updated|upgraded|renovated)\s+(?:kitchen|bathroom|bathrooms|roof|wiring|plumbing|flooring|joinery|insulation|cladding|windows)\b/gi);
  return new Set((matches ?? []).map((m) => m.toLowerCase().replace(/\s+/g, " "))).size;
}

function textForAssessment(input: DwellingConditionInput): string {
  return [
    cleanText(input.listingTitle),
    cleanText(input.description),
    ...(input.features ?? []).map(cleanText),
    cleanText(input.propertyType),
  ].filter(Boolean).join(" | ");
}

function assessmentFromListingText(
  input: DwellingConditionInput,
  sourceFingerprint: string,
  now: Date,
): DwellingConditionAssessment | null {
  const text = textForAssessment(input);
  if (!text) return null;
  if (NEGATIVE_RENOVATION_RE.test(text)) {
    return {
      ...emptyAssessment(sourceFingerprint, now),
      condition: ORIGINAL_RE.test(text) ? "original" : "dated",
      confidence: "medium",
      source: "listing_text",
      evidence: uniq([evidenceSnippet(text, NEGATIVE_RENOVATION_RE)]),
    };
  }

  const extension = evidenceSnippet(text, EXTENSION_RE);
  if (extension) {
    return {
      ...emptyAssessment(sourceFingerprint, now),
      condition: "extended",
      recentImprovement: true,
      additionOrExtension: true,
      confidence: "high",
      source: "listing_text",
      evidence: [extension],
      costPenalty: 1.0,
    };
  }

  const strong = evidenceSnippet(text, STRONG_RENOVATION_RE);
  if (strong) {
    return {
      ...emptyAssessment(sourceFingerprint, now),
      condition: "renovated",
      recentImprovement: true,
      additionOrExtension: false,
      confidence: "high",
      source: "listing_text",
      evidence: [strong],
      costPenalty: 1.0,
    };
  }

  const medium = evidenceSnippet(text, MEDIUM_RENOVATION_RE);
  const fixedUpgradeCount = countFixedUpgradeTerms(text);
  if (medium || fixedUpgradeCount >= 2) {
    return {
      ...emptyAssessment(sourceFingerprint, now),
      condition: "renovated",
      recentImprovement: true,
      additionOrExtension: false,
      confidence: "medium",
      source: "listing_text",
      evidence: uniq([medium, fixedUpgradeCount >= 2 ? "Multiple fixed improvements mentioned in listing copy." : null]),
      costPenalty: 0.5,
    };
  }

  if (SINGLE_CHATTEL_RE.test(text) || ORIGINAL_RE.test(text)) {
    return {
      ...emptyAssessment(sourceFingerprint, now),
      condition: ORIGINAL_RE.test(text) ? "original" : "maintained",
      confidence: "medium",
      source: "listing_text",
      evidence: uniq([evidenceSnippet(text, ORIGINAL_RE) ?? evidenceSnippet(text, SINGLE_CHATTEL_RE)]),
    };
  }

  return null;
}

function hasAmbiguousConditionSignals(input: DwellingConditionInput): boolean {
  const text = textForAssessment(input);
  return AMBIGUOUS_MODERN_RE.test(text) && !NEGATIVE_RENOVATION_RE.test(text);
}

function mergeAssessment(
  base: DwellingConditionAssessment,
  incoming: Partial<DwellingConditionAssessment> | null,
  source: DwellingConditionSource,
): DwellingConditionAssessment {
  if (!incoming) return base;
  const costPenalty = normalizePenalty(incoming.costPenalty ?? base.costPenalty);
  const recentImprovement = incoming.recentImprovement === true || base.recentImprovement || costPenalty > 0;
  const additionOrExtension = incoming.additionOrExtension === true || base.additionOrExtension;
  const evidence = uniq([...(base.evidence ?? []), ...(incoming.evidence ?? [])]).slice(0, 5);
  return {
    ...base,
    condition: incoming.condition ?? base.condition,
    recentImprovement,
    additionOrExtension,
    confidence: incoming.confidence ?? base.confidence,
    source: base.source === source ? source : "combined",
    evidence,
    costPenalty,
  };
}

function normalizePenalty(value: unknown): DwellingConditionCostPenalty {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1.0;
  return 0.5;
}

function validCachedAssessment(value: DwellingConditionAssessment | null | undefined, fingerprint: string): DwellingConditionAssessment | null {
  if (!value) return null;
  if (value.assessmentVersion !== DWELLING_CONDITION_ASSESSMENT_VERSION) return null;
  if (value.sourceFingerprint !== fingerprint) return null;
  return value;
}

const inFlight = new Map<string, Promise<DwellingConditionAssessment>>();

async function withInFlight(key: string, fn: () => Promise<DwellingConditionAssessment>): Promise<DwellingConditionAssessment> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function defaultTextLlm(input: DwellingConditionInput): Promise<Partial<DwellingConditionAssessment> | null> {
  const text = textForAssessment(input);
  if (!text) return null;
  try {
    const resp = await ai.models.generateContent({
      model: "deepseek-chat",
      config: { maxOutputTokens: 320, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      contents: [{
        role: "user",
        parts: [{
          text: `Classify whether this NZ property listing says the existing dwelling has recent fixed improvements that would be priced into the purchase but may be lost in subdivision/redevelopment.

Return ONLY JSON:
{"condition":"new_build|near_new|renovated|extended|maintained|original|dated|unknown","recentImprovement":boolean,"additionOrExtension":boolean,"confidence":"low|medium|high","costPenalty":0|0.5|1,"evidence":["short quote"]}

Rules:
- Count recent build, full renovation, modernisation, rewire/replumb, new roof plus interiors, or additions/extensions.
- Do NOT count furniture, staging, landscaping, "renovation potential", "needs renovation", or a single new kitchen/bathroom by itself.
- Be conservative. If unsure, set recentImprovement=false and costPenalty=0.

Listing:
${text.slice(0, 2200)}`,
        }],
      }],
    });
    return parseAssessmentJson(resp.text ?? "");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dwelling-condition text LLM failed");
    return null;
  }
}

async function defaultVision(input: DwellingConditionInput, photoUrls: string[]): Promise<Partial<DwellingConditionAssessment> | null> {
  if (process.env.RENOVATION_VISION_ENABLED?.trim().toLowerCase() !== "true") return null;
  const apiKey = process.env.RENOVATION_VISION_API_KEY?.trim();
  const baseUrl = process.env.RENOVATION_VISION_BASE_URL?.trim();
  const model = process.env.RENOVATION_VISION_MODEL?.trim();
  if (!apiKey || !baseUrl || !model || photoUrls.length === 0) return null;

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 360,
        temperature: 0,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Classify fixed dwelling condition from these real-estate photos. Ignore furniture, staging, lighting, and photography style. Focus on fixed finishes: kitchen, bathrooms, flooring, joinery, roof/exterior, additions/extensions. Return ONLY JSON with condition, recentImprovement, additionOrExtension, confidence, costPenalty, evidence. Be conservative.",
            },
            ...photoUrls.map((url) => ({ type: "image_url", image_url: { url } })),
          ],
        }],
      }),
    });
    if (!response.ok) throw new Error(`vision provider error ${response.status}: ${await response.text().catch(() => "")}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return parseAssessmentJson(data.choices?.[0]?.message?.content ?? "");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "dwelling-condition vision failed");
    return null;
  }
}

function parseAssessmentJson(raw: string): Partial<DwellingConditionAssessment> | null {
  const match = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const condition = typeof parsed.condition === "string" && isCondition(parsed.condition) ? parsed.condition : "unknown";
    const confidence = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low" ? parsed.confidence : "low";
    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence.filter((v): v is string => typeof v === "string" && cleanText(v).length > 0).map(cleanText).slice(0, 3)
      : [];
    return {
      condition,
      recentImprovement: parsed.recentImprovement === true,
      additionOrExtension: parsed.additionOrExtension === true,
      confidence,
      evidence,
      costPenalty: normalizePenalty(parsed.costPenalty),
    };
  } catch {
    return null;
  }
}

function isCondition(value: string): value is DwellingCondition {
  return [
    "new_build",
    "near_new",
    "renovated",
    "extended",
    "maintained",
    "original",
    "dated",
    "unknown",
  ].includes(value);
}

export async function assessDwellingCondition(
  input: DwellingConditionInput,
  deps: AssessmentDeps = {},
): Promise<DwellingConditionAssessment> {
  const now = deps.now ?? new Date();
  const sourceFingerprint = buildDwellingConditionFingerprint(input);
  const cached = validCachedAssessment(input.cachedAssessment, sourceFingerprint);
  if (cached) return cached;

  const baseFromYear = assessmentFromBuildYear(input, sourceFingerprint, now);
  const baseFromText = assessmentFromListingText(input, sourceFingerprint, now);
  let assessment = baseFromYear ?? baseFromText ?? emptyAssessment(sourceFingerprint, now);

  if (baseFromYear && baseFromText?.recentImprovement) {
    assessment = mergeAssessment(baseFromYear, baseFromText, "listing_text");
  }

  const expensiveKey = `${cleanText(input.address).toLowerCase()}::${sourceFingerprint}`;
  const shouldUseTextLlm = !assessment.recentImprovement && hasAmbiguousConditionSignals(input);
  const photos = selectedDwellingConditionPhotoUrls(input.photoUrls);
  const shouldUseVision =
    !assessment.recentImprovement &&
    photos.length > 0 &&
    (shouldUseTextLlm || cleanText(input.description).length < 80);

  if (!shouldUseTextLlm && !shouldUseVision) return assessment;

  return withInFlight(expensiveKey, async () => {
    let next = assessment;
    if (shouldUseTextLlm) {
      next = mergeAssessment(next, await (deps.textLlm ?? defaultTextLlm)(input), "text_llm");
    }
    if (!next.recentImprovement && shouldUseVision) {
      next = mergeAssessment(next, await (deps.vision ?? defaultVision)(input, photos), "vision");
    }
    return next;
  });
}

export function dwellingConditionCostPenalty(
  assessment: DwellingConditionAssessment | null | undefined,
  lots: number,
): DwellingConditionCostPenalty {
  if (!assessment || lots < 2) return 0;
  return normalizePenalty(assessment.costPenalty);
}

export function dwellingConditionRiskBullet(
  assessment: DwellingConditionAssessment | null | undefined,
  lots: number,
  zh = false,
): string | null {
  if (dwellingConditionCostPenalty(assessment, lots) <= 0) return null;
  if (zh) {
    return "Recent build/renovation premium: existing improvements may already be priced into the purchase, but subdivision or redevelopment could remove some of that value.";
  }
  return "Recent build/renovation premium: the existing dwelling appears recently built, renovated, or extended, so subdivision or redevelopment may remove improvements already priced into the purchase.";
}
