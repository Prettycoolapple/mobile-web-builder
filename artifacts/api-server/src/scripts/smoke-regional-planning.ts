import {
  fetchRegionalPlanningOverlays,
  fetchRegionalPlanningZone,
  regionalPlanningSmokeTargets,
} from "../lib/regional-arcgis";
import {
  fetchRegionalInfrastructure,
  regionalInfrastructureSmokeTargets,
} from "../lib/regional-infrastructure";
import { resolvePlanningJurisdiction } from "../lib/regional-planning";
import { fetchPropertyHistoryForReport } from "../lib/regional-planning-fetchers";
import { tryGeocodeAddress } from "../lib/geocode";
import { mergePropertyData } from "../lib/scrapers/merge";

const samples = [
  { label: "Hamilton CBD", address: "Victoria Street, Hamilton", lat: -37.787, lng: 175.279 },
  { label: "Christchurch CBD", address: "Cathedral Square, Christchurch", lat: -43.532, lng: 172.636 },
  { label: "Christchurch Waltham multi-parcel", address: "21 Defoe Place, Waltham, Christchurch 8023, New Zealand", lat: -43.5472275, lng: 172.6478817, expectedLandArea: 552 },
  { label: "Whangarei CBD", address: "Cameron Street, Whangarei", lat: -35.725, lng: 174.323 },
  { label: "Queenstown CBD", address: "Shotover Street, Queenstown", lat: -45.031, lng: 168.662 },
  { label: "Dunedin CBD", address: "George Street, Dunedin", lat: -45.878, lng: 170.503 },
  { label: "Lower Hutt Wainuiomata", address: "15 Parenga Street, Wainuiomata, Lower Hutt", lat: -41.285791, lng: 174.950586 },
  { label: "Rotorua Koutu", address: "85 Whittaker Road, Koutu, Rotorua", lat: -38.1251179, lng: 176.2437545 },
  { label: "Whakatane Rotoma 1134", address: "1134 Braemar Road, Rotoma, Rotorua 3192", lat: -38.0165820, lng: 176.7156598, expectedCv: 1_310_000, expectedProvider: "whakatane", expectedZone: "Rural Production Zone" },
  { label: "Whakatane Rotoma 1140", address: "1140 Braemar Rd, Rotorua", lat: -38.0155546, lng: 176.7193241, expectedCv: 630_000, expectedProvider: "whakatane", expectedZone: "Rural Production Zone" },
  { label: "Whakatane State Highway 30", address: "2926A State Highway 30, Onepu, Whakatāne District", lat: -38.0263534, lng: 176.7097369, expectedCv: 1_520_000, expectedProvider: "whakatane", expectedZone: "General Rural Zone" },
  { label: "Southland Balfour", address: "77 Kruger Street, Balfour, Southland 9746", lat: -45.8372796, lng: 168.5815783, expectedCv: 250_000, expectedProvider: "southland", expectedZone: "General Residential Zone (GRZ)" },
];

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  smokeTargetCount: regionalPlanningSmokeTargets().length,
  infrastructureSmokeTargetCount: regionalInfrastructureSmokeTargets().length,
}, null, 2));

for (const sample of samples) {
  const expectsExactProperty = sample.expectedCv != null || sample.expectedLandArea != null;
  const exactGeocode = expectsExactProperty ? await tryGeocodeAddress(sample.address) : null;
  if (expectsExactProperty && !exactGeocode) throw new Error(`Expected exact geocode for ${sample.address}`);
  const lat = exactGeocode?.lat ?? sample.lat;
  const lng = exactGeocode?.lng ?? sample.lng;
  const jurisdiction = resolvePlanningJurisdiction({ ...sample, lat, lng });
  const zone = await fetchRegionalPlanningZone(jurisdiction, lat, lng);
  const overlays = await fetchRegionalPlanningOverlays(jurisdiction, lat, lng);
  const infrastructure = await fetchRegionalInfrastructure(jurisdiction.providerId, lat, lng);
  const propertyHistory = await fetchPropertyHistoryForReport(sample.address, lat, lng);

  if (sample.expectedCv != null) {
    if (sample.expectedProvider && jurisdiction.providerId !== sample.expectedProvider) {
      throw new Error(`Expected ${sample.expectedProvider} provider, got ${jurisdiction.providerId}`);
    }
    if (sample.expectedZone && zone.zone_code !== sample.expectedZone) {
      throw new Error(`Expected ${sample.expectedZone}, got ${zone.zone_code}`);
    }
    if (propertyHistory.cv_nzd !== sample.expectedCv) {
      throw new Error(`Expected CV ${sample.expectedCv}, got ${propertyHistory.cv_nzd}`);
    }
    const requestedNumber = sample.address.match(/^\d+[A-Z]?/i)?.[0]?.toUpperCase();
    const resolvedNumber = exactGeocode?.formatted.match(/^\d+[A-Z]?/i)?.[0]?.toUpperCase();
    if (!requestedNumber || requestedNumber !== resolvedNumber) {
      throw new Error(`Address deviation: requested ${requestedNumber}, resolved ${resolvedNumber}`);
    }
  }

  if (sample.expectedLandArea != null) {
    if (jurisdiction.providerId !== "christchurch") throw new Error(`Expected Christchurch provider, got ${jurisdiction.providerId}`);
    if (zone.zone_code === "UNKNOWN") throw new Error("Expected Christchurch zone at 21 Defoe Place");
    if (propertyHistory.land_area_sqm !== sample.expectedLandArea) {
      throw new Error(`Expected land area ${sample.expectedLandArea}, got ${propertyHistory.land_area_sqm}`);
    }
    const merged = mergePropertyData(
      { area_sqm: 363 } as never,
      null,
      null,
      zone,
      overlays,
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure,
        property_history: propertyHistory,
        analysed_address: exactGeocode?.formatted ?? sample.address,
      },
    );
    if (merged.land_area_sqm !== sample.expectedLandArea) {
      throw new Error(`Merged land area regressed: expected ${sample.expectedLandArea}, got ${merged.land_area_sqm}`);
    }
    if (merged.data_sources.land_area_sqm !== "christchurch_council_rating_unit") {
      throw new Error(`Expected Christchurch rating-unit source, got ${merged.data_sources.land_area_sqm}`);
    }
    for (const service of ["Water Supply", "Wastewater", "Stormwater"]) {
      if (!infrastructure.some((item) => item.name === service)) {
        throw new Error(`Expected existing ${service} result at 21 Defoe Place`);
      }
    }
  }

  if (sample.label === "Whakatane State Highway 30") {
    if (jurisdiction.providerId !== "whakatane") throw new Error(`Expected Whakatane provider, got ${jurisdiction.providerId}`);
    if (zone.zone_code !== "General Rural Zone") throw new Error(`Expected General Rural Zone, got ${zone.zone_code}`);
    if (!overlays.some((overlay) => overlay.name === "State Highway Buffer")) {
      throw new Error("Expected State Highway Buffer overlay at 2926A State Highway 30");
    }
  }

  if (sample.label === "Southland Balfour") {
    for (const service of ["Water Supply", "Wastewater", "Stormwater"]) {
      const item = infrastructure.find((candidate) => candidate.name === service);
      if (!item || item.location === "unknown") {
        throw new Error(`Expected mapped ${service} at 77 Kruger Street`);
      }
    }
    if (overlays.length !== 0) {
      throw new Error(`Expected no applicable Southland overlay/control at 77 Kruger Street, got ${overlays.map((item) => item.name).join(", ")}`);
    }
  }

  console.log(JSON.stringify({
    sample: sample.label,
    providerId: jurisdiction.providerId,
    providerName: jurisdiction.providerName,
    exactGeocode: exactGeocode ? { formatted: exactGeocode.formatted, lat, lng } : undefined,
    expectedZoneResolved: ["Christchurch Waltham multi-parcel", "Lower Hutt Wainuiomata", "Rotorua Koutu", "Whakatane Rotoma 1134", "Whakatane Rotoma 1140", "Whakatane State Highway 30", "Southland Balfour"].includes(sample.label)
      ? zone.zone_code !== "UNKNOWN"
      : undefined,
    zone: {
      code: zone.zone_code,
      description: zone.zone_description,
      hasRawZone: Boolean(zone.raw_zone),
    },
    overlays: overlays.map((overlay) => ({
      name: overlay.name,
      status: overlay.status,
    })),
    infrastructure: infrastructure.map((item) => ({
      name: item.name,
      location: item.location,
      distance_metres: item.distance_metres,
      risk: item.risk,
      source: item.service_source_owner,
    })),
    propertyHistory: {
      cv_nzd: propertyHistory.cv_nzd,
      cv_year: propertyHistory.cv_year,
      land_area_sqm: propertyHistory.land_area_sqm,
      land_area_source: propertyHistory.land_area_source,
      sources_confirmed: propertyHistory.sources_confirmed,
    },
  }, null, 2));
}
