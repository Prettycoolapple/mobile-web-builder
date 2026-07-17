import crypto from "node:crypto";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  db,
  dmMessages,
  dmThreads,
  limTitleRequests,
  listingAgentTargets,
  profiles,
  type LimTitleRequest,
} from "@workspace/db";
import { normalizeRegistrationPhone } from "./phone-registration";
import {
  scrapeListingAgent,
  type AgentContactResult,
} from "./scrapers/agent-contact";
import {
  normaliseSelectedListingContext,
  type SelectedListingContext,
} from "./selected-listing-context";
import { normaliseAddressKey } from "./address-key";
import { getIo } from "./socket";
export {
  LIM_TITLE_EXPERIMENT_VERSION,
  LIM_TITLE_PROACTIVE_RATE,
  isProactiveLimTitleSample,
} from "./lim-title-experiment";

export type LimTitleOfferSource = "proactive_15_percent" | "organic_intent";

export type LimTitleDeliveryState = {
  lim_report: boolean;
  title: boolean;
  complete: boolean;
};

function deliveredTypesFromMessages(rows: Array<{ metadataJson: Record<string, unknown> | null }>): Set<string> {
  const delivered = new Set<string>();
  for (const row of rows) {
    const docType = row.metadataJson?.docType;
    if (docType === "combined") {
      delivered.add("lim_report");
      delivered.add("title");
    } else if (docType === "lim_report" || docType === "title") {
      delivered.add(docType);
    }
  }
  return delivered;
}

/** Per-request delivery is derived from tagged DM messages, not library dedup rows. */
export async function getLimTitleDeliveryState(requestId: string): Promise<LimTitleDeliveryState> {
  const [request, messages] = await Promise.all([
    db.select({ requestedDocuments: limTitleRequests.requestedDocuments })
      .from(limTitleRequests).where(eq(limTitleRequests.id, requestId)).limit(1),
    db.select({ metadataJson: dmMessages.metadataJson })
      .from(dmMessages)
      .where(and(
        eq(dmMessages.leadRequestId, requestId),
        eq(dmMessages.messageKind, "lim_title_document"),
      )),
  ]);
  const delivered = deliveredTypesFromMessages(messages);
  const requested = request[0]?.requestedDocuments ?? [];
  return {
    lim_report: delivered.has("lim_report"),
    title: delivered.has("title"),
    complete: requested.length > 0 && requested.every((docType) => delivered.has(docType)),
  };
}

/** Stamp delivery once all requested document types have a linked message. */
export async function deriveLimTitleDeliveryStatus(requestId: string): Promise<LimTitleDeliveryState> {
  const state = await getLimTitleDeliveryState(requestId);
  if (state.complete) {
    const now = new Date();
    await db.update(limTitleRequests)
      .set({
        documentsDeliveredAt: sql`coalesce(${limTitleRequests.documentsDeliveredAt}, ${now})`,
        updatedAt: now,
      })
      .where(eq(limTitleRequests.id, requestId));
  }
  return state;
}

export type ResolvedLeadAgent = AgentContactResult & {
  agentPhone: string;
  matchType: "subject";
};

export function buildLimTitleFacilitatorMessage(
  propertyAddress: string,
): string {
  return `Hi, I'd like to know more about ${propertyAddress}. Could you please send me the LIM report and title? Thanks.`;
}

export function isNzSmsMobile(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const normalized = normalizeRegistrationPhone(raw);
  return /^\+642\d{7,9}$/.test(normalized);
}

function isTrustedLeadListingUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return [
      "realestate.co.nz",
      "oneroof.co.nz",
      "trademe.co.nz",
      "homes.co.nz",
      "hougarden.com",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export async function resolveLeadListingAgent(args: {
  address: string;
  listingUrl?: string | null;
  selectedListingContext?: SelectedListingContext | null;
}): Promise<ResolvedLeadAgent | null> {
  const selectedListingContext = normaliseSelectedListingContext(
    args.selectedListingContext,
  );
  // selectedListingContext is useful for locating the exact listing, but it is
  // echoed by the client and therefore cannot be authoritative for an SMS
  // recipient. Strip its phone before the server-side lookup so a modified app
  // cannot cause Project Alpha to text an arbitrary NZ mobile number.
  const trustedListingUrl = isTrustedLeadListingUrl(
    selectedListingContext?.listingUrl,
  )
    ? selectedListingContext!.listingUrl!
    : isTrustedLeadListingUrl(args.listingUrl)
      ? args.listingUrl!
      : null;
  const lookupContext = selectedListingContext
    ? {
        ...selectedListingContext,
        listingUrl: trustedListingUrl,
        agentPhone: null,
      }
    : null;
  const result = await Promise.race([
    scrapeListingAgent(args.address, {
      allowSuburbFallback: false,
      listingUrl: trustedListingUrl,
      selectedListingContext: lookupContext,
    }),
    new Promise<AgentContactResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
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
          }),
        25_000,
      ),
    ),
  ]);
  if (
    !result.found ||
    !result.isListed ||
    result.matchType !== "subject" ||
    !isNzSmsMobile(result.agentPhone)
  ) {
    return null;
  }
  return {
    ...result,
    agentPhone: normalizeRegistrationPhone(result.agentPhone!),
    matchType: "subject",
  };
}

async function findVerifiedAgentByPhone(
  phoneNumber: string,
): Promise<string | null> {
  const [agent] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.role, "sales_agent"),
        eq(profiles.phoneNumber, phoneNumber),
        isNotNull(profiles.phoneVerifiedAt),
      ),
    )
    .limit(1);
  return agent?.id ?? null;
}

export async function upsertListingAgentTarget(agent: ResolvedLeadAgent) {
  const phoneNumber = normalizeRegistrationPhone(agent.agentPhone);
  const matchedAgentUserId = await findVerifiedAgentByPhone(phoneNumber);
  const [target] = await db
    .insert(listingAgentTargets)
    .values({
      phoneNumber,
      agentName: agent.agentName,
      agencyName: agent.agencyName,
      source: agent.source,
      sourceListingUrl: agent.listingUrl,
      matchedAgentUserId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: listingAgentTargets.phoneNumber,
      set: {
        agentName: agent.agentName,
        agencyName: agent.agencyName,
        source: agent.source,
        sourceListingUrl: agent.listingUrl,
        updatedAt: new Date(),
        // Never replace an already claimed owner. This expression only fills
        // an unclaimed target when a verified account already exists.
        matchedAgentUserId: sql`coalesce(${listingAgentTargets.matchedAgentUserId}, ${matchedAgentUserId})`,
      },
    })
    .returning();
  return target;
}

function newClaimToken(): string {
  return crypto.randomBytes(6).toString("base64url");
}

export async function createOrReuseLimTitleOffer(args: {
  requesterUserId: string;
  agent: ResolvedLeadAgent;
  reportKey: string;
  reportHistoryId?: string | null;
  chatSessionId: string;
  propertyAddress: string;
  listingUrl?: string | null;
  listingSource?: string | null;
  offerSource: LimTitleOfferSource;
  selectedListingContext?: SelectedListingContext | null;
  intentReason?: string | null;
}): Promise<LimTitleRequest> {
  const target = await upsertListingAgentTarget(args.agent);
  const address =
    args.agent.listingAddress?.trim() || args.propertyAddress.trim();
  const propertyKey =
    normaliseAddressKey(address) || normaliseAddressKey(args.propertyAddress);
  const now = new Date();
  const [inserted] = await db
    .insert(limTitleRequests)
    .values({
      requesterUserId: args.requesterUserId,
      agentTargetId: target.id,
      matchedAgentUserId: target.matchedAgentUserId,
      claimToken: newClaimToken(),
      reportKey: args.reportKey,
      reportHistoryId: args.reportHistoryId ?? null,
      chatSessionId: args.chatSessionId,
      propertyKey,
      propertyAddress: address,
      listingUrl: args.agent.listingUrl ?? args.listingUrl ?? null,
      listingSource: args.agent.source ?? args.listingSource ?? null,
      offerSource: args.offerSource,
      status: "offered",
      offerShownAt: now,
      metadataJson: {
        agentMatchType: "subject",
        selectedListingContext:
          (args.selectedListingContext as
            | Record<string, unknown>
            | null
            | undefined) ?? null,
        intentReason: args.intentReason ?? null,
      },
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        limTitleRequests.requesterUserId,
        limTitleRequests.agentTargetId,
        limTitleRequests.propertyKey,
      ],
    })
    .returning();
  if (inserted) return inserted;

  const [existing] = await db
    .select()
    .from(limTitleRequests)
    .where(
      and(
        eq(limTitleRequests.requesterUserId, args.requesterUserId),
        eq(limTitleRequests.agentTargetId, target.id),
        eq(limTitleRequests.propertyKey, propertyKey),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("LIM_TITLE_OFFER_UPSERT_FAILED");

  // A prior "No thanks" must not permanently block the offer: if the buyer
  // explicitly asks again in chat (organic intent), resurrect the declined
  // row back to "offered" so the message reappears with fresh Yes/No
  // buttons. Proactive (chance) offers never reach this branch a second time
  // — the mobile client already skips re-evaluating once any lim_title_offer
  // message exists for the address, and the /offers/evaluate route only
  // reuses rows still in "offered" status.
  if (existing.status === "declined" && args.offerSource === "organic_intent") {
    const [revived] = await db
      .update(limTitleRequests)
      .set({
        status: "offered",
        declinedAt: null,
        offerShownAt: now,
        metadataJson: {
          agentMatchType: "subject",
          selectedListingContext:
            (args.selectedListingContext as
              | Record<string, unknown>
              | null
              | undefined) ?? null,
          intentReason: args.intentReason ?? null,
        },
        updatedAt: now,
      })
      .where(eq(limTitleRequests.id, existing.id))
      .returning();
    if (revived) return revived;
  }
  return existing;
}

export async function declineLimTitleOffer(
  requestId: string,
  requesterUserId: string,
): Promise<boolean> {
  const rows = await db
    .update(limTitleRequests)
    .set({ status: "declined", declinedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(limTitleRequests.id, requestId),
        eq(limTitleRequests.requesterUserId, requesterUserId),
        eq(limTitleRequests.status, "offered"),
      ),
    )
    .returning({ id: limTitleRequests.id });
  return rows.length > 0;
}

/**
 * Connect one consented request to its verified phone owner. Idempotent under
 * retries and concurrent signup/request races.
 */
export async function connectLimTitleRequest(requestId: string): Promise<{
  connected: boolean;
  threadId: string | null;
}> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`,
    );
    const [request] = await tx
      .select()
      .from(limTitleRequests)
      .where(eq(limTitleRequests.id, requestId))
      .limit(1);
    if (!request?.consentedAt)
      return { connected: false, threadId: null, message: null, agentId: null };

    const [target] = await tx
      .select()
      .from(listingAgentTargets)
      .where(eq(listingAgentTargets.id, request.agentTargetId))
      .limit(1);
    const agentId = target?.matchedAgentUserId ?? request.matchedAgentUserId;
    if (!target || !agentId)
      return { connected: false, threadId: null, message: null, agentId: null };

    const [verifiedAgent] = await tx
      .select({ id: profiles.id, phoneNumber: profiles.phoneNumber })
      .from(profiles)
      .where(
        and(
          eq(profiles.id, agentId),
          eq(profiles.role, "sales_agent"),
          eq(profiles.phoneNumber, target.phoneNumber),
          isNotNull(profiles.phoneVerifiedAt),
        ),
      )
      .limit(1);
    if (!verifiedAgent)
      return { connected: false, threadId: null, message: null, agentId: null };

    const [participantA, participantB] = [
      request.requesterUserId,
      agentId,
    ].sort();
    let [thread] = await tx
      .insert(dmThreads)
      .values({ participantA, participantB })
      .onConflictDoNothing()
      .returning();
    if (!thread) {
      [thread] = await tx
        .select()
        .from(dmThreads)
        .where(
          and(
            eq(dmThreads.participantA, participantA),
            eq(dmThreads.participantB, participantB),
          ),
        )
        .limit(1);
    }
    if (!thread) throw new Error("LIM_TITLE_DM_THREAD_FAILED");

    let [message] = await tx
      .select()
      .from(dmMessages)
      .where(eq(dmMessages.leadRequestId, request.id))
      .limit(1);
    if (!message) {
      [message] = await tx
        .insert(dmMessages)
        .values({
          threadId: thread.id,
          senderId: request.requesterUserId,
          body: buildLimTitleFacilitatorMessage(request.propertyAddress),
          messageKind: "lim_title_request",
          leadRequestId: request.id,
          metadataJson: {
            requestId: request.id,
            propertyAddress: request.propertyAddress,
            listingUrl: request.listingUrl,
            requestedDocuments: request.requestedDocuments,
          },
        })
        .returning();
    }

    const now = new Date();
    await tx
      .update(dmThreads)
      .set({ lastMessageAt: message.createdAt ?? now })
      .where(eq(dmThreads.id, thread.id));
    await tx
      .update(limTitleRequests)
      .set({
        matchedAgentUserId: agentId,
        dmThreadId: thread.id,
        status: "connected",
        connectedAt: request.connectedAt ?? now,
        updatedAt: now,
      })
      .where(eq(limTitleRequests.id, request.id));
    return { connected: true, threadId: thread.id, message, agentId };
  });

  if (result.connected && result.message && result.agentId) {
    const io = getIo();
    io?.to(`user:${result.agentId}`).emit("new_message", {
      threadId: result.threadId,
      message: result.message,
    });
    io?.to(`user:${result.message.senderId}`).emit("new_message", {
      threadId: result.threadId,
      message: result.message,
    });
  }
  return { connected: result.connected, threadId: result.threadId };
}

/** How long a buyer must wait before re-requesting the same LIM/title lead
 * once already consented — lets a genuinely-still-interested buyer nudge the
 * agent again without letting the flow be spammed. */
export const LIM_TITLE_REREQUEST_COOLDOWN_HOURS = 6;

function nextRequestAvailableAt(lastRequestedAt: Date): Date {
  return new Date(
    lastRequestedAt.getTime() +
      LIM_TITLE_REREQUEST_COOLDOWN_HOURS * 60 * 60 * 1000,
  );
}

/** Posts a short "still interested" nudge into the existing DM thread and
 * notifies both parties over the socket, mirroring connectLimTitleRequest's
 * notification shape. Silently no-ops if the thread isn't connected yet. */
async function sendLimTitleReminderPing(
  request: LimTitleRequest,
): Promise<void> {
  if (!request.dmThreadId || !request.matchedAgentUserId) return;
  const [message] = await db
    .insert(dmMessages)
    .values({
      threadId: request.dmThreadId,
      senderId: request.requesterUserId,
      body: `Reminder: I'm still hoping to get the LIM report and title for ${request.propertyAddress}. Thanks!`,
      messageKind: "lim_title_reminder",
      leadRequestId: request.id,
      metadataJson: {
        requestId: request.id,
        propertyAddress: request.propertyAddress,
        requestedDocuments: request.requestedDocuments,
      },
    })
    .returning();
  if (!message) return;
  await db
    .update(dmThreads)
    .set({ lastMessageAt: message.createdAt })
    .where(eq(dmThreads.id, request.dmThreadId));
  const io = getIo();
  io?.to(`user:${request.matchedAgentUserId}`).emit("new_message", {
    threadId: request.dmThreadId,
    message,
  });
  io?.to(`user:${request.requesterUserId}`).emit("new_message", {
    threadId: request.dmThreadId,
    message,
  });
}

export async function consentToLimTitleRequest(
  requestId: string,
  requesterUserId: string,
): Promise<{
  request: LimTitleRequest;
  alreadyConsented: boolean;
  connected: boolean;
  threadId: string | null;
  /** True when a repeat request landed inside the cooldown window — nothing
   * was changed and the caller should tell the buyer to wait. */
  cooldownActive: boolean;
  nextRequestAvailableAt: Date;
}> {
  const now = new Date();
  const [current] = await db
    .select()
    .from(limTitleRequests)
    .where(
      and(
        eq(limTitleRequests.id, requestId),
        eq(limTitleRequests.requesterUserId, requesterUserId),
      ),
    )
    .limit(1);
  if (!current)
    throw Object.assign(new Error("Request not found"), { statusCode: 404 });
  const alreadyConsented = Boolean(current.consentedAt);

  if (alreadyConsented) {
    const lastRequested = current.lastRequestedAt ?? current.consentedAt!;
    const availableAt = nextRequestAvailableAt(lastRequested);
    if (now < availableAt) {
      return {
        request: current,
        alreadyConsented: true,
        connected: Boolean(current.dmThreadId),
        threadId: current.dmThreadId,
        cooldownActive: true,
        nextRequestAvailableAt: availableAt,
      };
    }
    const [bumped] = await db
      .update(limTitleRequests)
      .set({
        lastRequestedAt: now,
        requestCount: sql`${limTitleRequests.requestCount} + 1`,
        updatedAt: now,
      })
      .where(eq(limTitleRequests.id, requestId))
      .returning();
    const request = bumped ?? current;
    const connected = await connectLimTitleRequest(requestId);
    if (connected.connected) await sendLimTitleReminderPing(request);
    return {
      request,
      alreadyConsented: true,
      connected: connected.connected,
      threadId: connected.threadId,
      cooldownActive: false,
      nextRequestAvailableAt: nextRequestAvailableAt(now),
    };
  }

  const [updated] = await db
    .update(limTitleRequests)
    .set({
      status: current.matchedAgentUserId
        ? "pending_connection"
        : "pending_agent_claim",
      consentedAt: now,
      lastRequestedAt: now,
      requestCount: 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(limTitleRequests.id, requestId),
        eq(limTitleRequests.requesterUserId, requesterUserId),
        isNull(limTitleRequests.consentedAt),
      ),
    )
    .returning();
  const request = updated ?? current;
  const connected = await connectLimTitleRequest(requestId);
  const [fresh] = await db
    .select()
    .from(limTitleRequests)
    .where(eq(limTitleRequests.id, requestId))
    .limit(1);
  return {
    request: fresh ?? request,
    alreadyConsented: false,
    connected: connected.connected,
    threadId: connected.threadId,
    cooldownActive: false,
    nextRequestAvailableAt: nextRequestAvailableAt(now),
  };
}

/** Claim every unclaimed target for an OTP-verified sales-agent phone. */
export async function claimOutstandingLimTitleLeads(
  agentUserId: string,
  rawPhone: string,
): Promise<{
  claimedTargets: number;
  connectedRequests: number;
}> {
  const phoneNumber = normalizeRegistrationPhone(rawPhone);
  if (!isNzSmsMobile(phoneNumber))
    return { claimedTargets: 0, connectedRequests: 0 };
  const [agent] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, agentUserId),
        eq(profiles.role, "sales_agent"),
        eq(profiles.phoneNumber, phoneNumber),
        isNotNull(profiles.phoneVerifiedAt),
      ),
    )
    .limit(1);
  if (!agent) return { claimedTargets: 0, connectedRequests: 0 };

  const targets = await db
    .update(listingAgentTargets)
    .set({ matchedAgentUserId: agentUserId, updatedAt: new Date() })
    .where(
      and(
        eq(listingAgentTargets.phoneNumber, phoneNumber),
        or(
          isNull(listingAgentTargets.matchedAgentUserId),
          eq(listingAgentTargets.matchedAgentUserId, agentUserId),
        ),
      ),
    )
    .returning({ id: listingAgentTargets.id });
  if (!targets.length) return { claimedTargets: 0, connectedRequests: 0 };

  const targetIds = targets.map((target) => target.id);
  await db
    .update(limTitleRequests)
    .set({ matchedAgentUserId: agentUserId, updatedAt: new Date() })
    .where(sql`${limTitleRequests.agentTargetId} = ANY(${targetIds}::text[])`);
  const requests = await db
    .select({ id: limTitleRequests.id })
    .from(limTitleRequests)
    .where(
      and(
        sql`${limTitleRequests.agentTargetId} = ANY(${targetIds}::text[])`,
        isNotNull(limTitleRequests.consentedAt),
        isNull(limTitleRequests.dmThreadId),
      ),
    );
  let connectedRequests = 0;
  for (const request of requests) {
    if ((await connectLimTitleRequest(request.id)).connected)
      connectedRequests += 1;
  }
  return { claimedTargets: targets.length, connectedRequests };
}
