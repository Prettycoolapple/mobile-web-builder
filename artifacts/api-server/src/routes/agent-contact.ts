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
  // Fast keyword pre-check — skip LLM call if no signal at all
  const recentText = messages
    .slice(-4)
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();

  const keywords = [
    "call", "contact", "phone", "number", "agent", "reach", "speak",
    "get in touch", "seller", "vendor", "realtor", "salesperson",
    "ring", "talk to", "who is selling", "who listed",
  ];
  const hasKeyword = keywords.some((kw) => recentText.includes(kw));
  if (!hasKeyword) return false;

  // Gemini semantic confirmation
  try {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMessage) return false;

    const prompt = `A user has just asked the following question about a NZ property they are researching:

"${lastUserMessage.content}"

Does this message indicate the user wants to contact or get in touch with the real estate agent (or salesperson) who is listing or selling this property?

Answer with ONLY valid JSON (no markdown):
{"wantsAgentContact": true, "reason": "one sentence"}

Answer false if the user is asking about something unrelated to contacting the agent.`;

    const result = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 80, temperature: 0 },
    });

    const raw = result.text?.trim() ?? "";
    const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Boolean(parsed.wantsAgentContact);
  } catch {
    // If Gemini fails, fall back to keyword result
    return hasKeyword;
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
      listingUrl: agentInfo.listingUrl,
      source: agentInfo.source,
    });
  } catch (err) {
    req.log.error({ err }, "POST /agent-contact/lookup failed");
    res.status(500).json({ error: "Agent contact lookup failed" });
  }
});

export default router;
