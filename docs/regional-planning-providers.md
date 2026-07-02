# Regional Planning Providers

This feature is additive and is disabled unless `ENABLE_REGIONAL_PLANNING_PROVIDERS` is set to a truthy value.

## Vercel environment variables

Required existing production keys:

- `LINZ_API_KEY` or the existing LINZ key name used by the app for parcel, aerial, and terrain-related calls.
- Existing geocoding/scraper/AI keys already used by the Auckland feasibility report.

Regional council planning and services feeds currently do not need new API keys. They use public ArcGIS REST services.

Feature flag:

- `ENABLE_REGIONAL_PLANNING_PROVIDERS=true`

Recommended rollout:

1. Deploy with the flag unset/false and confirm Auckland reports are unchanged.
2. Enable the flag in a staging/preview environment and run a sample report for each mapped region.
3. Enable the flag in production only after the smoke test passes.

## Public endpoints currently wired

### Hamilton / Waikato

- Planning zones: `https://maps.hamilton.govt.nz/server/rest/services/agol_odp2017/DistrictPlan_Proposed_Decisions_2015_Zoning/MapServer`
- Planning features: `https://maps.hamilton.govt.nz/server/rest/services/agol_odp2017/DistrictPlan_Proposed_Decisions_2015_Features/MapServer`
- Water: `https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Freshwater Dataset - Hamilton City Council/FeatureServer`
- Wastewater: `https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Wastewater Dataset - Hamilton City Council/FeatureServer`
- Stormwater: `https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Stormwater Dataset - Hamilton City Council/FeatureServer`

### Christchurch / Canterbury

- Christchurch District Plan: `https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlan/FeatureServer`
- Christchurch DistrictPlanB: `https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlanB/FeatureServer`
- Canterbury three waters: `https://services1.arcgis.com/RNxkQaMWQcgbiF98/arcgis/rest/services/Canterbury_Three_Waters_Data_2_view/FeatureServer`

### Whangarei

- District Plan: `https://geo.wdc.govt.nz/server/rest/services/District_Plan_Public/MapServer`
- Water: `https://geo.wdc.govt.nz/server/rest/services/Water_Public/FeatureServer`
- Wastewater: `https://geo.wdc.govt.nz/server/rest/services/Wastewater_Public/FeatureServer`
- Stormwater: `https://geo.wdc.govt.nz/server/rest/services/Stormwater_Public/FeatureServer`
- Subdivision rule source: `https://eplan.wdc.govt.nz/plan/?chapter=subdivision`

### Queenstown Lakes

- Proposed District Plan: `https://gis.qldc.govt.nz/server/rest/services/DistrictPlan/PDP_Stage_1_2_3_Decisions/MapServer`
- Operative District Plan: `https://gis.qldc.govt.nz/server/rest/services/DistrictPlan/Operative_District_Plan/FeatureServer`
- Three Waters: `https://gis.qldc.govt.nz/server/rest/services/ThreeWaters/Three_Waters/FeatureServer`

### Dunedin / Otago

- District Plan: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/District_Plan/MapServer`
- Water: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Water/FeatureServer`
- Stormwater: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Stormwater/FeatureServer`
- Wastewater/CityCare utilities: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/CityCare/MapServer`

## Current rule-modelling status

- Auckland: existing full Auckland path remains the only automated yield/ROI path.
- Whangarei: verified minimum-lot guidance is exposed for General Residential and Medium Density Residential zones, but automated yield/ROI remains disabled until the full rule pack is implemented.
- Hamilton, Christchurch, Canterbury, QLDC, Dunedin: official planning/service facts are shown where mapped; local subdivision rule packs are not yet fully modelled.

