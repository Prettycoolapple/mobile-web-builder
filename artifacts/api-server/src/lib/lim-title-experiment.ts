import crypto from "node:crypto";

export const LIM_TITLE_EXPERIMENT_VERSION = "lim-title-v1";
export const LIM_TITLE_PROACTIVE_RATE = 0.3;

/** Stable assignment prevents refresh/reopen from rerolling the experiment. */
export function isProactiveLimTitleSample(userId: string, reportKey: string): boolean {
  const digest = crypto
    .createHash("sha256")
    .update(`${LIM_TITLE_EXPERIMENT_VERSION}:${userId}:${reportKey}`)
    .digest();
  const bucket = digest.readUInt32BE(0) / 0x1_0000_0000;
  return bucket < LIM_TITLE_PROACTIVE_RATE;
}
