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

const samples = [
  { label: "Hamilton CBD", address: "Victoria Street, Hamilton", lat: -37.787, lng: 175.279 },
  { label: "Christchurch CBD", address: "Cathedral Square, Christchurch", lat: -43.532, lng: 172.636 },
  { label: "Whangarei CBD", address: "Cameron Street, Whangarei", lat: -35.725, lng: 174.323 },
  { label: "Queenstown CBD", address: "Shotover Street, Queenstown", lat: -45.031, lng: 168.662 },
  { label: "Dunedin CBD", address: "George Street, Dunedin", lat: -45.878, lng: 170.503 },
  { label: "Lower Hutt Wainuiomata", address: "15 Parenga Street, Wainuiomata, Lower Hutt", lat: -41.285791, lng: 174.950586 },
  { label: "Rotorua Koutu", address: "85 Whittaker Road, Koutu, Rotorua", lat: -38.1251179, lng: 176.2437545 },
  { label: "Whakatane Rotoma", address: "1134 Braemar Road, Rotoma", lat: -38.0165820, lng: 176.7156598 },
  { label: "Whakatane State Highway 30", address: "2926A, State Highway 30, Whakatane District", lat: -38.0263534, lng: 176.7097369 },
];

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  smokeTargetCount: regionalPlanningSmokeTargets().length,
  infrastructureSmokeTargetCount: regionalInfrastructureSmokeTargets().length,
}, null, 2));

for (const sample of samples) {
  const jurisdiction = resolvePlanningJurisdiction(sample);
  const zone = await fetchRegionalPlanningZone(jurisdiction, sample.lat, sample.lng);
  const overlays = await fetchRegionalPlanningOverlays(jurisdiction, sample.lat, sample.lng);
  const infrastructure = await fetchRegionalInfrastructure(jurisdiction.providerId, sample.lat, sample.lng);

  console.log(JSON.stringify({
    sample: sample.label,
    providerId: jurisdiction.providerId,
    providerName: jurisdiction.providerName,
    expectedZoneResolved: ["Lower Hutt Wainuiomata", "Rotorua Koutu", "Whakatane Rotoma", "Whakatane State Highway 30"].includes(sample.label)
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
  }, null, 2));
}
