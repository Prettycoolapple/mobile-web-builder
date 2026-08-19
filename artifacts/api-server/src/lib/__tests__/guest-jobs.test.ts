import { describe, expect, it } from "vitest";
import { canReadFeasibilityJob } from "../guest-jobs";

const USER = "user-1";
const OTHER_USER = "user-2";
const INSTALL = "install-hash-1";
const OTHER_INSTALL = "install-hash-2";

describe("background feasibility job ownership", () => {
  it("lets a signed-in user read their own job and nobody else's", () => {
    const viewer = { userId: USER, guestHash: null };
    expect(canReadFeasibilityJob({ userId: USER, guestHash: null }, viewer)).toBe(true);
    expect(canReadFeasibilityJob({ userId: OTHER_USER, guestHash: null }, viewer)).toBe(false);
  });

  it("lets a guest read the job queued under their install hash", () => {
    const viewer = { userId: null, guestHash: INSTALL };
    expect(canReadFeasibilityJob({ userId: null, guestHash: INSTALL }, viewer)).toBe(true);
    expect(canReadFeasibilityJob({ userId: null, guestHash: OTHER_INSTALL }, viewer)).toBe(false);
  });

  it("never lets a job id alone authorise a read", () => {
    // The whole point of the guest column: an unowned poller gets nothing, so
    // guessing or leaking a job id cannot expose someone's report.
    expect(canReadFeasibilityJob({ userId: USER, guestHash: null }, { userId: null, guestHash: null })).toBe(false);
    expect(canReadFeasibilityJob({ userId: null, guestHash: INSTALL }, { userId: null, guestHash: null })).toBe(false);
    expect(canReadFeasibilityJob(null, { userId: null, guestHash: INSTALL })).toBe(false);
    expect(canReadFeasibilityJob(undefined, { userId: USER, guestHash: null })).toBe(false);
  });

  it("keeps guest jobs and account jobs on separate sides of the fence", () => {
    // A guest cannot reach a signed-in job by sending an install header...
    expect(canReadFeasibilityJob({ userId: USER, guestHash: null }, { userId: null, guestHash: INSTALL })).toBe(false);
    // ...and signing in does not hand someone the guest jobs from that install.
    expect(canReadFeasibilityJob({ userId: null, guestHash: INSTALL }, { userId: USER, guestHash: INSTALL })).toBe(false);
  });

  it("treats an ownerless job as readable by nobody", () => {
    expect(canReadFeasibilityJob({ userId: null, guestHash: null }, { userId: USER, guestHash: null })).toBe(false);
    expect(canReadFeasibilityJob({ userId: null, guestHash: null }, { userId: null, guestHash: INSTALL })).toBe(false);
  });
});
