import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { ai } from "@workspace/integrations-gemini-ai";
import { scrapeListingAgent } from "../lib/scrapers/agent-contact";
import { hasExplicitAgentContactSignal, isCombinedPackageAnalyseRequest, isReportFollowUpQuestion } from "../lib/agent-contact-intent";
import { normaliseSelectedListingContext, type SelectedListingContext } from "../lib/selected-listing-context";

const router: IRouter = Router();

interface Message {
  role: string;
  content: string;
}

async function detectAgentContactIntent(messages: Message[]): Promise<boolean> {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage?.content?.trim()) return false;
  // Hard-negative: '分析完整组合' / 'Analyse full package' prompts must never be
  // classified as agent-contact, even if upstream heuristics or the LLM say
  // otherwise. The button depends on this guarantee.
  if (isCombinedPackageAnalyseRequest(lastUserMessage.content)) return false;
  if (hasExplicitAgentContactSignal(lastUserMessage.content)) return true;
  // Hard-negative: a question about the report itself ("what are the key
  // risks", "explain the cost estimate", "5 个地块的审批流程是什么") is never an
  // agent-contact request, no matter what was asked earlier in the thread.
  if (isReportFollowUpQuestion(lastUserMessage.content)) return false;

  const conversationText = messages
    .slice(-8)
    .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 500)}`)
    .join("\n");
  const alreadyShown = messages.some(
    (m) => m.role === "assistant" && /^\[Listing agent contact card shown/i.test((m.content ?? "").trim()),
  );

  // Primary path: semantic intent detection. Do not keyword-gate this call;
  // users ask for agent contact in many natural ways.
  try {
    const prompt = `You are an intent analyser for a New Zealand property app.

The user has completed or is discussing a feasibility report for a specific property.

RECENT CONVERSATION (context only — do NOT classify these turns):
${conversationText}

AGENT CONTACT CARD ALREADY SHOWN IN THIS THREAD: ${alreadyShown ? "yes" : "no"}

LATEST USER MESSAGE (classify ONLY this one):
"${lastUserMessage.content}"

TASK:
Determine whether the LATEST user message is a NEW request for the sales/listing agent's contact card for this property.

Return true when the latest message expresses the same intent as any of these, even if worded differently:
- wants to call, phone, ring, text, message, email, or speak with the listing/sales agent
- asks who is selling, who listed it, who handles viewings, or who can show them the property
- asks for the agent, agency, salesperson, vendor contact path, or contact details
- asks to arrange a viewing, inspection, walkthrough, or open home with the selling side
- uses Chinese or other multilingual phrasing for contacting the agent/listing side

Return false when:
- the latest message asks about the report itself — risks, costs, ROI, zoning, consents, approval process, timelines, lots, infrastructure, comparables, scores, or any other analysis detail
- the latest message asks about development professionals (planners, architects, engineers, builders) or general property advice
- the agent was requested in an EARLIER turn and the latest message has moved on to something else. An already-shown agent card must NOT be repeated unless the latest message asks for it again.

Reply with ONLY valid JSON (no markdown):
{"wantsAgentContact": <true|false>, "reason": "one sentence"}`;

    const result = await ai.models.generateContent({
      model: "deepseek-chat",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 120, temperature: 0, timeoutMs: 15_000 },
    });

    const raw = result.text?.trim() ?? "";
    const cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Boolean(parsed.wantsAgentContact);
  } catch {
    // Conservative fallback only when AI is unavailable. It reads the LATEST
    // user message alone — scanning the whole recent conversation made the
    // classifier sticky: one earlier "Contact Sales agent" turn matched on
    // every later question and re-served the agent card instead of an answer.
    const latestText = lastUserMessage.content.toLowerCase();
    const fallbackSignals = [
      "call", "contact", "phone", "number", "agent", "reach", "speak",
      "get in touch", "seller", "vendor", "realtor", "salesperson",
      "ring", "talk to", "who is selling", "who listed", "listing agent",
      "sales agent", "viewing", "inspection", "open home", "walkthrough",
      "kan fang", "zhong jie", "jing ji", "lian xi", "dian hua", "xiao shou",
      "\u4e2d\u4ecb", "\u7ecf\u7eaa", "\u7d93\u7d00", "\u8054\u7cfb", "\u806f\u7e6b",
      "\u7535\u8bdd", "\u96fb\u8a71", "\u8c01\u5728\u5356", "\u8ab0\u5728\u8ce3",
      "\u8c01\u5356", "\u8ab0\u8ce3", "\u770b\u623f", "\u9500\u552e", "\u92b7\u552e",
    ];
    return fallbackSignals.some((kw) => latestText.includes(kw));
  }
}

function allowsSameSuburbAgentFallback(messages: Message[]): boolean {
  const latestUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const recentAssistantText = messages
    .slice(-8)
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join(" ")
    .toLowerCase();
  const latestLower = latestUser.toLowerCase();

  const wasToldSubjectHasNoAgent =
    /not currently on market|not on the market|not actively listed|no active listing|couldn't find a direct listing agent|could not find a direct listing agent/i.test(recentAssistantText) ||
    /未挂牌|未掛牌|没有活跃|沒有活躍|没有找到.*中介|沒有找到.*中介|没有.*挂牌中介|沒有.*掛牌中介/i.test(recentAssistantText);

  const asksForFallback =
    /still|any agent|another agent|other agent|nearby|same suburb|same area|local agent|someone else/i.test(latestLower) ||
    /还是|仍然|也行|可以|随便|其他|别的|附近|同区|同一.*区|当地|本地.*中介|中介.*也可以/i.test(latestUser);

  return wasToldSubjectHasNoAgent && asksForFallback;
}

function agentLookupTimeoutResult() {
  return {
    found: false,
    isListed: false,
    matchType: null,
    listingAddress: null,
    agentName: null,
    agentPhone: null,
    agencyName: null,
    agentAvatarUrl: null,
    listingUrl: null,
    source: "timeout",
  };
}

router.post("/agent-contact/lookup", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;

  try {
    const [currentUser] = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!currentUser || (currentUser.role !== "general" && currentUser.role !== "service_provider")) {
      res.json({ wantsAgentContact: false });
      return;
    }

    const { address, messages, listingUrl, selectedListingContext } = req.body as {
      address?: string;
      messages?: Message[];
      listingUrl?: string | null;
      selectedListingContext?: SelectedListingContext | null;
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

    const normalisedSelectedListingContext = normaliseSelectedListingContext(selectedListingContext);
    const agentInfo = await Promise.race([
      scrapeListingAgent(address, {
        listingUrl: normalisedSelectedListingContext?.listingUrl ?? listingUrl ?? null,
        selectedListingContext: normalisedSelectedListingContext,
      }),
      new Promise<ReturnType<typeof agentLookupTimeoutResult>>((resolve) =>
        setTimeout(() => resolve(agentLookupTimeoutResult()), 25_000),
      ),
    ]);

    res.json({
      wantsAgentContact: true,
      found: agentInfo.found,
      isListed: agentInfo.isListed,
      matchType: agentInfo.matchType,
      listingAddress: agentInfo.listingAddress,
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

/**
 * Direct agent-contact resolver for the listing detail screen. Unlike
 * /agent-contact/lookup, there is no chat-intent gate or role restriction — the
 * user has explicitly opened a property card and we always try to resolve a
 * callable agent. Reuses the same multi-source scrape chain (realestate.co.nz
 * API → reveal-button page scrape → OneRoof portal) so the phone number is
 * unmasked wherever possible.
 */
router.post("/agent-contact/for-listing", requireAuth, async (req: Request, res: Response) => {
  try {
    const { address, listingUrl, selectedListingContext } = req.body as {
      address?: string;
      listingUrl?: string | null;
      selectedListingContext?: SelectedListingContext | null;
    };

    if (!address?.trim()) {
      res.status(400).json({ error: "address is required" });
      return;
    }

    const normalisedSelectedListingContext = normaliseSelectedListingContext(selectedListingContext);
    const agentInfo = await Promise.race([
      scrapeListingAgent(address, {
        listingUrl: normalisedSelectedListingContext?.listingUrl ?? listingUrl ?? null,
        selectedListingContext: normalisedSelectedListingContext,
      }),
      new Promise<ReturnType<typeof agentLookupTimeoutResult>>((resolve) =>
        setTimeout(() => resolve(agentLookupTimeoutResult()), 25_000),
      ),
    ]);

    res.json({
      found: agentInfo.found,
      isListed: agentInfo.isListed,
      matchType: agentInfo.matchType,
      listingAddress: agentInfo.listingAddress,
      agentName: agentInfo.agentName,
      agentPhone: agentInfo.agentPhone,
      agencyName: agentInfo.agencyName,
      agentAvatarUrl: agentInfo.agentAvatarUrl,
      listingUrl: agentInfo.listingUrl,
      source: agentInfo.source,
    });
  } catch (err) {
    req.log.error({ err }, "POST /agent-contact/for-listing failed");
    res.status(500).json({ error: "Agent contact lookup failed" });
  }
});

export default router;
