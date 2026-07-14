import { beforeEach, describe, expect, it } from "vitest";
import {
  allPlanningProviders,
  planningProviderMetadata,
  planningProviderSmokeTargets,
  regionalPlanningProvidersEnabled,
  resolvePlanningJurisdiction,
  shouldSuppressAucklandPlanningRules,
} from "../regional-planning";

const FLAG = "ENABLE_REGIONAL_PLANNING_PROVIDERS";

describe("regional planning provider registry", () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });

  it("keeps the regional provider router enabled by default", () => {
    expect(regionalPlanningProvidersEnabled()).toBe(true);
    expect(planningProviderMetadata({ lat: -37.787, lng: 175.279, address: "Hamilton" })).toMatchObject({
      providerId: "hamilton",
    });
  });

  it("allows regional providers to be explicitly disabled", () => {
    process.env[FLAG] = "false";
    expect(regionalPlanningProvidersEnabled()).toBe(false);
    expect(planningProviderMetadata({ lat: -37.787, lng: 175.279, address: "Hamilton" })).toBeNull();
  });

  it("registers Auckland legacy plus WIP regional providers", () => {
    expect(allPlanningProviders().map((provider) => provider.id)).toEqual([
      "auckland-legacy",
      "hamilton",
      "waipa",
      "christchurch",
      "canterbury",
      "nelson",
      "whangarei",
      "qldc",
      "wellington",
      "dunedin",
      "whakatane",
      "rotorua",
      "southland",
      "unsupported",
    ]);
  });

  it("resolves conservative coordinates to the intended provider", () => {
    expect(resolvePlanningJurisdiction({ lat: -36.85, lng: 174.76, address: "Auckland" }).providerId).toBe("auckland-legacy");
    expect(resolvePlanningJurisdiction({ lat: -37.787, lng: 175.279, address: "Hamilton" }).providerId).toBe("hamilton");
    expect(resolvePlanningJurisdiction({ lat: -37.88476037, lng: 175.47794877, address: "91 Thornton Road, Cambridge" }).providerId).toBe("waipa");
    expect(resolvePlanningJurisdiction({ lat: -43.532, lng: 172.636, address: "Christchurch" }).providerId).toBe("christchurch");
    expect(resolvePlanningJurisdiction({ lat: -44.397, lng: 171.254, address: "Timaru" }).providerId).toBe("canterbury");
    expect(resolvePlanningJurisdiction({ lat: -41.306, lng: 173.222, address: "17 Quiet Woman Way, Monaco, Nelson" }).providerId).toBe("nelson");
    expect(resolvePlanningJurisdiction({ lat: -35.725, lng: 174.323, address: "Whangarei" }).providerId).toBe("whangarei");
    expect(resolvePlanningJurisdiction({ lat: -45.031, lng: 168.662, address: "Queenstown" }).providerId).toBe("qldc");
    expect(resolvePlanningJurisdiction({ lat: -45.878, lng: 170.503, address: "Dunedin" }).providerId).toBe("dunedin");
    expect(resolvePlanningJurisdiction({ lat: -41.2865, lng: 174.7762, address: "Wellington" }).providerId).toBe("wellington");
    expect(resolvePlanningJurisdiction({ lat: -41.2100, lng: 174.9000, address: "345 Hebden Crescent, Kelson, Lower Hutt" }).providerId).toBe("wellington");
    expect(resolvePlanningJurisdiction({ lat: -38.1251, lng: 176.2438, address: "85 Whittaker Road, Koutu, Rotorua" }).providerId).toBe("rotorua");
    expect(resolvePlanningJurisdiction({ lat: -38.0166, lng: 176.7157, address: "1134 Braemar Road, Rotoma" }).providerId).toBe("whakatane");
    expect(resolvePlanningJurisdiction({ lat: -38.0156, lng: 176.7193, address: "1140 Braemar Road, Rotorua" }).providerId).toBe("whakatane");
    expect(resolvePlanningJurisdiction({ lat: -38.1251, lng: 176.2438, address: "85 Whittaker Road, Whakatane" }).providerId).toBe("rotorua");
    expect(resolvePlanningJurisdiction({ lat: -45.8372796, lng: 168.5815783, address: "77 Kruger Street, Balfour" }).providerId).toBe("southland");
    expect(resolvePlanningJurisdiction({ lat: -46.098, lng: 168.946, address: "Gore" }).providerId).toBe("unsupported");
  });

  it("uses address hints when coordinates are not enough", () => {
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "10 Victoria Street, Hamilton" }).providerId).toBe("hamilton");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "91 Thornton Road, Cambridge" }).providerId).toBe("waipa");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "1 Bealey Avenue, Christchurch" }).providerId).toBe("christchurch");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "17 Quiet Woman Way, Monaco, Nelson" }).providerId).toBe("nelson");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "1 Ardmore Street, Wanaka" }).providerId).toBe("qldc");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "85 Whittaker Road, Koutu, Rotorua" }).providerId).toBe("rotorua");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "1134 Braemar Road, Rotoma" }).providerId).toBe("whakatane");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "2926A State Highway 30, Onepu, Whakatāne District" }).providerId).toBe("whakatane");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "77 Kruger Street, Balfour, Southland District" }).providerId).toBe("southland");
  });

  it("emits provider metadata when the router is enabled", () => {
    expect(planningProviderMetadata({ lat: -37.787, lng: 175.279, address: "Hamilton" })).toMatchObject({
      providerId: "hamilton",
      coverageStatus: "partial",
      territorialAuthority: "Hamilton City Council",
      region: "Waikato",
    });
  });

  it("suppresses Auckland-specific planning rules outside Auckland when metadata is present", () => {
    expect(shouldSuppressAucklandPlanningRules(null)).toBe(false);
    expect(shouldSuppressAucklandPlanningRules({ providerId: "auckland-legacy" })).toBe(false);
    expect(shouldSuppressAucklandPlanningRules({ providerId: "hamilton" })).toBe(true);
    expect(shouldSuppressAucklandPlanningRules({ providerId: "unsupported" })).toBe(true);
  });

  it("exposes official endpoint smoke-test targets for WIP providers", () => {
    const providerIds = new Set(planningProviderSmokeTargets().map((target) => target.providerId));
    expect(providerIds).toEqual(new Set([
      "auckland-legacy",
      "hamilton",
      "waipa",
      "christchurch",
      "canterbury",
      "nelson",
      "whangarei",
      "qldc",
      "wellington",
      "dunedin",
      "whakatane",
      "rotorua",
      "southland",
    ]));
  });
});
