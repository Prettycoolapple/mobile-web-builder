import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are DevFeasible AI — a senior New Zealand real estate development feasibility analyst with deep expertise in Auckland Council planning rules, LINZ land data, NZ construction costs, and property finance.

Your primary job is to analyse residential properties for development feasibility. You must:
1. Be highly specific to New Zealand context (NZD, NZ law, Auckland Unitary Plan, LINZ, Watercare, etc.)
2. Always present cost estimates in NZD
3. Always include the disclaimer: "These are indicative estimates only. Engage a quantity surveyor for accurate figures."
4. Be direct and commercially-minded — developers want actionable intel, not watered-down advice
5. Flag risks clearly and prominently

When a user asks to analyse a specific address (TYPE A):
- Respond with a structured JSON feasibility report
- Include scores (ease/cost/roi each out of 5), property overview, planning info, terrain, infrastructure, cost breakdown, ROI scenarios, comparable sales, and risk summary
- The JSON must strictly match the FeasibilityReport schema

When a user asks to discover/search for properties (TYPE B):
- Parse suburb, price range, and criteria from the query
- Return a JSON array of up to 5 property candidates with quick scores

For all other questions (follow-ups, clarifications, risk discussions):
- Respond in plain conversational English
- Reference the property context if available
- Be specific and actionable

NZ-specific knowledge to apply:
- Auckland Unitary Plan zones: SHZ (Single House), MHS (Mixed Housing Suburban), MHU (Mixed Housing Urban), THAB (Terrace Housing & Apartment Buildings)
- MHS minimum lot size: 400m² (or 60% of parent lot), 2-storey limit
- MHU minimum lot size: 320m², 3-storey
- THAB: no lot size minimum, 6+ storeys possible
- Flood overlays: serious risk, can block consent
- Heritage overlays: severe restriction, demolition consent required
- Build costs NZ 2024: $2,800-$3,500/m² for spec residential
- Demo cost: $15k-$40k standard, $30k-$80k if asbestos suspected
- Asbestos common in homes built 1940-1990
- Infrastructure: Watercare connections typically $15k-$40k per lot for water/sewer
- Finance: Construction finance at 7-9% p.a.
- Consent & professional fees: 12-15% of construction cost`;

function buildGeminiHistory(conversationHistory: Message[]) {
  return conversationHistory.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
}

export async function generateFeasibilityReport(
  address: string,
  conversationHistory: Message[] = [],
): Promise<string> {
  const prompt = `Analyse this NZ property for development feasibility: ${address}

Please return a comprehensive feasibility report as a JSON object. The JSON must follow this exact structure:

{
  "address": "full address string",
  "scores": {
    "ease": <number 1-5>,
    "cost": <number 1-5, 5=low cost>,
    "roi": <number 1-5>,
    "composite": <weighted average>
  },
  "propertyOverview": {
    "address": "...",
    "cv": "NZD amount",
    "landArea": "m² value",
    "floorArea": "m² value or estimated",
    "buildYear": "year or estimated",
    "zone": "zone code and name",
    "listingPrice": "NZD amount or null",
    "isOnMarket": boolean
  },
  "planning": {
    "zone": "zone description",
    "minLotSize": "m² requirement",
    "potentialLots": <number>,
    "overlays": [
      {"name": "overlay name", "status": "clear|moderate|restricted", "detail": "description"}
    ],
    "subdivisionSummary": "plain English summary"
  },
  "asbestos": {
    "buildYear": "year",
    "riskLevel": "low|moderate|high",
    "flagged": boolean,
    "demoCostLow": <number in NZD>,
    "demoCostHigh": <number in NZD>,
    "worksafeNote": "string or null"
  },
  "terrain": {
    "classification": "flat|gentle|moderate|steep",
    "slope": "description",
    "retainingCostLow": <number in NZD>,
    "retainingCostHigh": <number in NZD>
  },
  "infrastructure": [
    {
      "name": "Stormwater|Wastewater|Water Supply",
      "location": "on-parcel|boundary|off-parcel",
      "estimatedCostLow": <NZD>,
      "estimatedCostHigh": <NZD>,
      "risk": "low|moderate|high",
      "note": "string"
    }
  ],
  "costItems": [
    {"label": "Land (CV)", "low": <NZD>, "high": <NZD>},
    {"label": "Demolition", "low": <NZD>, "high": <NZD>},
    {"label": "Construction", "low": <NZD>, "high": <NZD>},
    {"label": "Retaining Walls", "low": <NZD>, "high": <NZD>},
    {"label": "Services & Infrastructure", "low": <NZD>, "high": <NZD>},
    {"label": "Consents & Professionals", "low": <NZD>, "high": <NZD>},
    {"label": "Finance (Holding)", "low": <NZD>, "high": <NZD>}
  ],
  "totalCostLow": <NZD>,
  "totalCostHigh": <NZD>,
  "roiScenarios": [
    {"years": 2, "gdv": <NZD>, "totalCost": <NZD>, "grossProfit": <NZD>, "roi": <percent>, "annualisedRoi": <percent>, "isBest": boolean},
    {"years": 3, "gdv": <NZD>, "totalCost": <NZD>, "grossProfit": <NZD>, "roi": <percent>, "annualisedRoi": <percent>, "isBest": boolean},
    {"years": 4, "gdv": <NZD>, "totalCost": <NZD>, "grossProfit": <NZD>, "roi": <percent>, "annualisedRoi": <percent>, "isBest": boolean}
  ],
  "comparableSales": [
    {"address": "...", "saleDate": "MMM YYYY", "price": <NZD>, "size": <m²>, "pricePerSqm": <NZD/m²>}
  ],
  "avgPricePerSqm": <NZD/m²>,
  "riskSummary": ["risk bullet 1", "risk bullet 2", "risk bullet 3"],
  "disclaimer": "These are indicative estimates only. Engage a quantity surveyor for accurate figures."
}

Use your deep NZ real estate knowledge to estimate all values realistically based on the suburb and property type. Return ONLY the JSON object, no other text.`;

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
  const prompt = `I'm looking for NZ property development opportunities. My query: "${query}"

${suburb ? `Suburb: ${suburb}` : ""}
${minPrice ? `Min price: NZD ${minPrice.toLocaleString()}` : ""}
${maxPrice ? `Max price: NZD ${maxPrice.toLocaleString()}` : ""}

Based on your knowledge of Auckland and NZ real estate, generate 5 realistic property candidates that would match this search. These should be realistic fictional addresses in the requested suburb/area that represent typical properties a developer would find.

Return a JSON object with this structure:
{
  "suburb": "suburb name",
  "candidates": [
    {
      "address": "full address",
      "price": <NZD asking price>,
      "landArea": <m²>,
      "zone": "zone code",
      "scores": {
        "ease": <1-5>,
        "cost": <1-5, 5=low cost>,
        "roi": <1-5>,
        "composite": <weighted avg>
      },
      "briefSummary": "2 sentence development opportunity summary"
    }
  ]
}

Return ONLY the JSON, no other text.`;

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
