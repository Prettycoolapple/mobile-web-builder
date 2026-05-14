import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ai } from "@workspace/integrations-gemini-ai";
import { scrapeListingAgent } from "../lib/scrapers/agent-contact";

const router: IRouter = Router();

interface Message {
  role: string;
  content: string;
}

async function detectAgentContactIntent(messages: Message[]): Promise<boolean> {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage?.content?.trim()) return false;

  const recentText = messages
    .slice(-8)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  const conversationText = messages
    .slice(-8)
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 500)}`)
    .join("\n");

  // Primary path: semantic intent detection. Do not keyword-gate this call;
  // users ask for agent contact in many natural ways.
  try {
    const prompt = `You are an intent analyser for a New Zealand property app.

The user has completed or is discussing a feasibility report for a specific property.

RECENT CONVERSATION:
${conversationText}

LATEST USER MESSAGE:
"${lastUserMessage.content}"

TASK:
Determine whether the latest user message means they want the sales/listing agent's contact card for this property.

Return true when the user expresses the same intent as any of these, even if worded differently:
- wants to call, phone, ring, text, message, email, or speak with the listing/sales agent
- asks who is selling, who listed it, who handles viewings, or who can show them the property
- asks for the agent, agency, salesperson, vendor contact path, or contact details
- asks to arrange a viewing, inspection, walkthrough, open home, or next step with the selling side
- uses Chinese or other multilingual phrasing for contacting the agent/listing side

Return false when they are asking about development professionals, planners, architects, builders, feasibility, ROI, zoning, risks, or general property advice without wanting the listing/sales agent.

Reply with ONLY valid JSON (no markdown):
{"wantsAgentContact": <true|false>, "reason": "one sentence"}`;

    const result = await ai.models.generateContent({
      model: "deepseek-chat",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 120, temperature: 0 },
    });

    const raw = result.text?.trim() ?? "";
    const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Boolean(parsed.wantsAgentContact);
  } catch {
    // Conservative fallback only when AI is unavailable.
    const fallbackSignals = [
      "call", "contact", "phone", "number", "agent", "reach", "speak",
      "get in touch", "seller", "vendor", "realtor", "salesperson",
      "ring", "talk to", "who is selling", "who listed", "listing agent",
      "sales agent", "viewing", "inspection", "open home", "walkthrough",
      "kan fang", "zhong jie", "jing ji", "lian xi", "dian hua", "xiao shou",
    ];
    return fallbackSignals.some((kw) => recentText.includes(kw));
  }
}

router.post("/agent-contact/lookup", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const [currentUser] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!currentUser || currentUser.role !== "general") {
      res.json({ wantsAgentContact: false });
      return;
    }

    const { address, messages } = req.body as {
      address?: string;
      messages?: Message[];
    };

    if (!address) {
      res.status(400).json({ error: "address is required" });
      return;
    }

    const wantsContact = await detectAgentContactIntent(messages ?? []);
    if (!wantsContact) {
      res.json({ wantsAgentContact: false });
      return;
    }

    const agentInfo = await scrapeListingAgent(address);

    res.json({
      wantsAgentContact: true,
      found: agentInfo.found,
      isListed: agentInfo.isListed,
      agentName: agentInfo.agentName,
      agentPhone: agentInfo.agentPhone,
      agencyName: agentInfo.agencyName,
      agentAvatarUrl: agentInfo.agentAvatarUrl,
      listingUrl: agentInfo.listingUrl,
      source: agentInfo.source,
    });
  } catch (err) {
    req.log.error({ err }, "POST /agent-contact/lookup failed");
    res.status(500).json({ error: "Agent contact lookup failed" });
  }
});

export default router;
