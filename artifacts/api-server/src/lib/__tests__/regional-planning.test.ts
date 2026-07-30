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
      "thames-coromandel",
      "buller",
      "auckland-legacy",
      "hamilton",
      "matamata-piako",
      "waipa",
      "manawatu",
      "selwyn",
      "christchurch",
      "canterbury",
      "nelson",
      "whangarei",
      "qldc",
      "wairarapa",
      "kapiti",
      "wellington",
      "dunedin",
      "tauranga",
      "western-bay",
      "whakatane",
      "taupo",
      "rotorua",
      "napier",
      "hastings",
      "new-plymouth",
      "southland",
      "unsupported",
    ]);
  });

  it("resolves conservative coordinates to the intended provider", () => {
    expect(resolvePlanningJurisdiction({ lat: -36.85, lng: 174.76, address: "Auckland" }).providerId).toBe("auckland-legacy");
    expect(resolvePlanningJurisdiction({ lat: -37.787, lng: 175.279, address: "Hamilton" }).providerId).toBe("hamilton");
    expect(resolvePlanningJurisdiction({ lat: -37.5352280, lng: 175.7074969, address: "19 Centennial Avenue, Te Aroha" }).providerId).toBe("matamata-piako");
    expect(resolvePlanningJurisdiction({ lat: -37.81, lng: 175.77, address: "Matamata" }).providerId).toBe("matamata-piako");
    expect(resolvePlanningJurisdiction({ lat: -37.65, lng: 175.53, address: "Morrinsville" }).providerId).toBe("matamata-piako");
    expect(resolvePlanningJurisdiction({ lat: -37.88476037, lng: 175.47794877, address: "91 Thornton Road, Cambridge" }).providerId).toBe("waipa");
    expect(resolvePlanningJurisdiction({ lat: -38.01, lng: 175.33, address: "Te Awamutu" }).providerId).toBe("waipa");
    expect(resolvePlanningJurisdiction({ lat: -40.356, lng: 175.611, address: "Palmerston North" }).providerId).toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: -39.06562567, lng: 174.03497135, address: "70 Pioneer Road, Moturoa, New Plymouth" }).providerId).toBe("new-plymouth");
    expect(resolvePlanningJurisdiction({ lat: -40.225, lng: 175.565, address: "Feilding" }).providerId).toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: -37.14783098, lng: 175.55078515, address: "111 Rolleston Street, Thames" }).providerId).toBe("thames-coromandel");
    expect(resolvePlanningJurisdiction({ lat: -41.76295052, lng: 171.60663355, address: "175 Romilly Street, Westport" }).providerId).toBe("buller");
    for (const address of [
      "54 Manawatu Street, Palmerston North",
      "Cambridge Avenue, Ashhurst",
      "Raymond Street, Bunnythorpe",
      "State Highway 56, Longburn",
      "Dundas Road, Sanson",
      "Douglas Square, Rongotea",
      "1252 Makoura Road, Apiti",
      "Kairanga Bunnythorpe Road, Kairanga",
    ]) {
      expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address }).providerId).toBe("manawatu");
    }
    expect(resolvePlanningJurisdiction({ lat: -40.069, lng: 175.379, address: "Marton" }).providerId).not.toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: -40.472, lng: 175.285, address: "Foxton" }).providerId).not.toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: -40.208, lng: 176.100, address: "Dannevirke" }).providerId).not.toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: -43.532, lng: 172.636, address: "Christchurch" }).providerId).toBe("christchurch");
    expect(resolvePlanningJurisdiction({ lat: -43.5929461, lng: 172.5104991, address: "100 Birchs Road, Prebbleton, Selwyn District" }).providerId).toBe("selwyn");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "111 Rolleston Street, Thames" }).providerId).toBe("thames-coromandel");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "175 Romilly Street, Westport, Buller District" }).providerId).toBe("buller");
    expect(resolvePlanningJurisdiction({ lat: -44.397, lng: 171.254, address: "Timaru" }).providerId).toBe("canterbury");
    expect(resolvePlanningJurisdiction({ lat: -41.306, lng: 173.222, address: "17 Quiet Woman Way, Monaco, Nelson" }).providerId).toBe("nelson");
    expect(resolvePlanningJurisdiction({ lat: -35.725, lng: 174.323, address: "Whangarei" }).providerId).toBe("whangarei");
    expect(resolvePlanningJurisdiction({ lat: -45.031, lng: 168.662, address: "Queenstown" }).providerId).toBe("qldc");
    expect(resolvePlanningJurisdiction({ lat: -45.878, lng: 170.503, address: "Dunedin" }).providerId).toBe("dunedin");
    expect(resolvePlanningJurisdiction({ lat: -40.9382383, lng: 175.6708268, address: "78 Opaki Road, Lansdowne, Masterton" }).providerId).toBe("wairarapa");
    expect(resolvePlanningJurisdiction({ lat: -41.025, lng: 175.528, address: "Carterton" }).providerId).toBe("wairarapa");
    expect(resolvePlanningJurisdiction({ lat: -41.116, lng: 175.325, address: "Featherston" }).providerId).toBe("wairarapa");
    expect(resolvePlanningJurisdiction({ lat: -41.2865, lng: 174.7762, address: "Wellington" }).providerId).toBe("wellington");
    expect(resolvePlanningJurisdiction({ lat: -40.8838658, lng: 175.0208898, address: "37 Tieko Street, Otaihanga" }).providerId).toBe("kapiti");
    expect(resolvePlanningJurisdiction({ lat: -41.2100, lng: 174.9000, address: "345 Hebden Crescent, Kelson, Lower Hutt" }).providerId).toBe("wellington");
    expect(resolvePlanningJurisdiction({ lat: -37.6646905, lng: 176.2110862, address: "16 Lodge Avenue, Mount Maunganui, Tauranga" }).providerId).toBe("tauranga");
    expect(resolvePlanningJurisdiction({ lat: -37.4460583, lng: 175.9643635, address: "30 Athenree Road, Athenree" }).providerId).toBe("western-bay");
    expect(resolvePlanningJurisdiction({ lat: -37.7720624, lng: 176.4995595, address: "481 Pukehina Parade" }).providerId).toBe("western-bay");
    expect(resolvePlanningJurisdiction({ lat: -37.6878, lng: 176.1651, address: "Tauranga" }).providerId).not.toBe("western-bay");
    expect(resolvePlanningJurisdiction({ lat: -38.1251, lng: 176.2438, address: "85 Whittaker Road, Koutu, Rotorua" }).providerId).toBe("rotorua");
    expect(resolvePlanningJurisdiction({ lat: -38.6206095, lng: 175.9763673, address: "302 Whangamata Road, Kinloch, Taupō District" }).providerId).toBe("taupo");
    expect(resolvePlanningJurisdiction({ lat: -38.0166, lng: 176.7157, address: "1134 Braemar Road, Rotoma" }).providerId).toBe("whakatane");
    expect(resolvePlanningJurisdiction({ lat: -38.0156, lng: 176.7193, address: "1140 Braemar Road, Rotorua" }).providerId).toBe("whakatane");
    expect(resolvePlanningJurisdiction({ lat: -38.1251, lng: 176.2438, address: "85 Whittaker Road, Whakatane" }).providerId).toBe("rotorua");
    expect(resolvePlanningJurisdiction({ lat: -39.5112541, lng: 176.8915180, address: "23 Wycliffe Street, Onekawa, Napier" }).providerId).toBe("napier");
    expect(resolvePlanningJurisdiction({ lat: -39.65520308, lng: 176.85964827, address: "226 Havelock Road, Akina, Hastings" }).providerId).toBe("hastings");
    expect(resolvePlanningJurisdiction({ lat: -38.998, lng: 177.420, address: "Wairoa" }).providerId).not.toBe("hastings");
    expect(resolvePlanningJurisdiction({ lat: -39.995, lng: 176.557, address: "Waipukurau" }).providerId).not.toBe("hastings");
    expect(resolvePlanningJurisdiction({ lat: -45.8372796, lng: 168.5815783, address: "77 Kruger Street, Balfour" }).providerId).toBe("southland");
    expect(resolvePlanningJurisdiction({ lat: -46.098, lng: 168.946, address: "Gore" }).providerId).toBe("unsupported");
  });

  it("uses address hints when coordinates are not enough", () => {
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "10 Victoria Street, Hamilton" }).providerId).toBe("hamilton");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "91 Thornton Road, Cambridge" }).providerId).toBe("waipa");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "19 Centennial Avenue, Te Aroha" }).providerId).toBe("matamata-piako");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "High Street, Morrinsville" }).providerId).toBe("matamata-piako");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "The Square, Palmerston North" }).providerId).toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "Manchester Street, Feilding" }).providerId).toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "Tangimoana Road, Tangimoana, Manawatu District" }).providerId).toBe("manawatu");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "1 Bealey Avenue, Christchurch" }).providerId).toBe("christchurch");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "100 Birchs Road, Prebbleton, Selwyn District" }).providerId).toBe("selwyn");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "111 Rolleston Street, Thames" }).providerId).toBe("thames-coromandel");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "17 Quiet Woman Way, Monaco, Nelson" }).providerId).toBe("nelson");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "1 Ardmore Street, Wanaka" }).providerId).toBe("qldc");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "78 Opaki Road, Lansdowne, Masterton" }).providerId).toBe("wairarapa");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "High Street, Carterton" }).providerId).toBe("wairarapa");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "Fitzherbert Street, Featherston" }).providerId).toBe("wairarapa");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "37 Tieko Street, Otaihanga, Kāpiti Coast" }).providerId).toBe("kapiti");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "85 Whittaker Road, Koutu, Rotorua" }).providerId).toBe("rotorua");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "302 Whangamata Road, Kinloch, Taupō District" }).providerId).toBe("taupo");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "16 Lodge Avenue, Mount Maunganui, Tauranga City" }).providerId).toBe("tauranga");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "30 Athenree Road, Athenree, Western Bay of Plenty" }).providerId).toBe("western-bay");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "481 Pukehina Parade, Pukehina Beach" }).providerId).toBe("western-bay");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "23 Wycliffe Street, Onekawa, Napier City" }).providerId).toBe("napier");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "226 Havelock Road, Akina, Hastings District" }).providerId).toBe("hastings");
    expect(resolvePlanningJurisdiction({ lat: 0, lng: 0, address: "70 Pioneer Road, Moturoa, New Plymouth" }).providerId).toBe("new-plymouth");
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
      "thames-coromandel",
      "buller",
      "auckland-legacy",
      "hamilton",
      "matamata-piako",
      "waipa",
      "manawatu",
      "selwyn",
      "christchurch",
      "canterbury",
      "nelson",
      "whangarei",
      "qldc",
      "wairarapa",
      "kapiti",
      "wellington",
      "dunedin",
      "taupo",
      "tauranga",
      "western-bay",
      "whakatane",
      "rotorua",
      "napier",
      "hastings",
      "new-plymouth",
      "southland",
    ]));
  });
});
