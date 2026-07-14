import { and, eq } from "drizzle-orm";
import {
  db,
  postReportPromptAllocations,
  searches,
  type PostReportPromptChannel,
} from "@workspace/db";

export type PostReportPromptClaimResult =
  | "claimed"
  | "conflict"
  | "uncoordinated";

export function resolvePostReportPromptClaim(
  existingChannel: PostReportPromptChannel | null,
  requestedChannel: PostReportPromptChannel,
): "claimed" | "conflict" {
  return !existingChannel || existingChannel === requestedChannel
    ? "claimed"
    : "conflict";
}

/**
 * Atomically reserves one saved report for one proactive prompt channel.
 * Missing/legacy report ids fail open so unrelated recommendation behavior is
 * not broken. Explicit user requests must bypass this helper entirely.
 */
export async function claimPostReportPrompt(args: {
  requesterUserId: string;
  reportHistoryId?: string | null;
  channel: PostReportPromptChannel;
}): Promise<PostReportPromptClaimResult> {
  const reportHistoryId = args.reportHistoryId?.trim();
  if (!reportHistoryId) return "uncoordinated";

  const [ownedReport] = await db
    .select({ id: searches.id })
    .from(searches)
    .where(
      and(
        eq(searches.id, reportHistoryId),
        eq(searches.userId, args.requesterUserId),
      ),
    )
    .limit(1);
  if (!ownedReport) return "uncoordinated";

  const [inserted] = await db
    .insert(postReportPromptAllocations)
    .values({
      requesterUserId: args.requesterUserId,
      reportHistoryId,
      channel: args.channel,
    })
    .onConflictDoNothing({
      target: [
        postReportPromptAllocations.requesterUserId,
        postReportPromptAllocations.reportHistoryId,
      ],
    })
    .returning({ channel: postReportPromptAllocations.channel });
  if (inserted) return "claimed";

  const [existing] = await db
    .select({ channel: postReportPromptAllocations.channel })
    .from(postReportPromptAllocations)
    .where(
      and(
        eq(postReportPromptAllocations.requesterUserId, args.requesterUserId),
        eq(postReportPromptAllocations.reportHistoryId, reportHistoryId),
      ),
    )
    .limit(1);

  return resolvePostReportPromptClaim(existing?.channel ?? null, args.channel);
}
