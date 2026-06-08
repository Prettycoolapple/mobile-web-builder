import { afterEach, describe, expect, it } from "vitest";
import {
  agentAiUnlimited,
  agentCanList,
  isValidInvitationCode,
  type EntitlementAgentProfile,
  type EntitlementProfile,
} from "../agent-entitlements";

const DAY_MS = 24 * 60 * 60 * 1000;

function profile(overrides: Partial<EntitlementProfile> = {}): EntitlementProfile {
  return {
    subscriptionStatus: null,
    subscriptionPeriodEndAt: null,
    ...overrides,
  };
}

function agentProfile(overrides: Partial<EntitlementAgentProfile> = {}): EntitlementAgentProfile {
  return {
    listingPlan: "lifetime",
    aiBoostExpiresAt: null,
    ...overrides,
  };
}

describe("agent entitlement helpers", () => {
  afterEach(() => {
    delete process.env.AGENT_INVITATION_CODE;
  });

  it("treats lifetime and legacy null listing plans as allowed to list", () => {
    expect(agentCanList(profile(), agentProfile({ listingPlan: "lifetime" }))).toBe(true);
    expect(agentCanList(profile(), agentProfile({ listingPlan: null }))).toBe(true);
  });

  it("allows active and trialing subscriptions while the paid period has not elapsed", () => {
    const future = new Date(Date.now() + DAY_MS);

    expect(
      agentCanList(
        profile({ subscriptionStatus: "active", subscriptionPeriodEndAt: future }),
        agentProfile({ listingPlan: "subscription" }),
      ),
    ).toBe(true);
    expect(
      agentCanList(
        profile({ subscriptionStatus: "trialing", subscriptionPeriodEndAt: future }),
        agentProfile({ listingPlan: "subscription" }),
      ),
    ).toBe(true);
  });

  it("blocks lapsed subscriptions from creating or publishing listings", () => {
    const future = new Date(Date.now() + DAY_MS);
    const past = new Date(Date.now() - DAY_MS);
    const subscriptionAgent = agentProfile({ listingPlan: "subscription" });

    expect(agentCanList(profile({ subscriptionStatus: "past_due", subscriptionPeriodEndAt: future }), subscriptionAgent)).toBe(false);
    expect(agentCanList(profile({ subscriptionStatus: "canceled", subscriptionPeriodEndAt: future }), subscriptionAgent)).toBe(false);
    expect(agentCanList(profile({ subscriptionStatus: "active", subscriptionPeriodEndAt: past }), subscriptionAgent)).toBe(false);
  });

  it("gives invite agents temporary AI quota bypass only inside the boost window", () => {
    const future = new Date(Date.now() + 90 * DAY_MS);
    const past = new Date(Date.now() - DAY_MS);

    expect(agentAiUnlimited(profile(), agentProfile({ listingPlan: "lifetime", aiBoostExpiresAt: future }))).toBe(true);
    expect(agentAiUnlimited(profile(), agentProfile({ listingPlan: "lifetime", aiBoostExpiresAt: past }))).toBe(false);
  });

  it("gives active subscribers AI quota bypass and lapsed subscribers normal quota", () => {
    const future = new Date(Date.now() + DAY_MS);
    const subscriptionAgent = agentProfile({ listingPlan: "subscription" });

    expect(agentAiUnlimited(profile({ subscriptionStatus: "active", subscriptionPeriodEndAt: future }), subscriptionAgent)).toBe(true);
    expect(agentAiUnlimited(profile({ subscriptionStatus: "past_due", subscriptionPeriodEndAt: future }), subscriptionAgent)).toBe(false);
  });

  it("validates invitation codes against the configured shared code", () => {
    expect(isValidInvitationCode(" projectalpha26 ")).toBe(true);
    expect(isValidInvitationCode("PROJECTALPHA26")).toBe(true);
    expect(isValidInvitationCode("wrong-code")).toBe(false);
    expect(isValidInvitationCode("")).toBe(false);

    process.env.AGENT_INVITATION_CODE = "launch-only";

    expect(isValidInvitationCode("Launch-Only")).toBe(true);
    expect(isValidInvitationCode("projectalpha26")).toBe(false);
  });
});
