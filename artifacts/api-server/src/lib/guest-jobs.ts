/**
 * Ownership rules for background feasibility jobs.
 *
 * A signed-in user owns a job through `user_id`. A logged-out visitor owns one
 * through `guest_hash` — the hashed anonymous install id they sent when they
 * queued it — because they have no bearer token to authorise the status poll
 * with. That makes the install hash the entire credential, so the matching is
 * kept deliberately narrow and lives here where it can be tested directly.
 */

export interface FeasibilityJobOwner {
  userId: string | null;
  guestHash: string | null;
}

/**
 * Whether `viewer` may read `job` back.
 *
 * A signed-in viewer only ever matches on user id: they never inherit a guest
 * job, not even one queued from the same install before they registered.
 * A guest viewer only ever matches on install hash, and an ownerless job (which
 * the table's CHECK constraint should already prevent) matches nobody.
 */
export function canReadFeasibilityJob(
  job: FeasibilityJobOwner | null | undefined,
  viewer: FeasibilityJobOwner,
): boolean {
  if (!job) return false;
  if (viewer.userId) return job.userId === viewer.userId;
  if (viewer.guestHash) return Boolean(job.guestHash) && job.guestHash === viewer.guestHash;
  return false;
}
