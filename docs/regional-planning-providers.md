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
- Subdivision rule source: `https://hamilton.govt.nz/assets/Uploads/Documents/Content-Documents/Property-Rates-and-Building/PC12-Growing-Up/IHP-recommendation/Clean-Change-Version/Chapters/PC12-Chapter-23-Subdivision-IPI-Recommendations-Clean-Version-November-2024.pdf`

### Christchurch / Canterbury

- Christchurch District Plan: `https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlan/FeatureServer`
- Christchurch DistrictPlanB: `https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlanB/FeatureServer`
- Canterbury three waters: `https://services1.arcgis.com/RNxkQaMWQcgbiF98/arcgis/rest/services/Canterbury_Three_Waters_Data_2_view/FeatureServer`
- Christchurch subdivision rule source: `https://ccc.govt.nz/assets/Documents/The-Council/Plans-Strategies-Policies-Bylaws/Plans/district-plan/Print-Chapters/Chapter-8.pdf`

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
- Subdivision rule source: `https://www.qldc.govt.nz/media/ez5gvf4t/pdp-chapter-27-subdivision-and-development-28-mar-2024.pdf`

### Dunedin / Otago

- District Plan: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/District_Plan/MapServer`
- Water: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Water/FeatureServer`
- Stormwater: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Stormwater/FeatureServer`
- Wastewater/CityCare utilities: `https://apps.dunedin.govt.nz/arcgis/rest/services/Public/CityCare/MapServer`
- General Residential 1 rule source: `https://www.dunedin.govt.nz/__data/assets/pdf_file/0012/873498/V2-Rule-Changes-in-General-Res1-and-Township-Settlement-Zones-updated.pdf`
- General Residential 2 rule source: `https://www.dunedin.govt.nz/__data/assets/pdf_file/0011/873497/V2-General-Residential-2-Rezoning-updated.pdf`

## Current rule-modelling status

- Auckland: existing full Auckland path remains unchanged and is still the default when the feature flag is off.
- Hamilton: standard vacant-lot yield and ROI are enabled for verified General Residential, Rotokauri North Residential Precinct, Medium Density Residential, and High Density Residential matches. A conservative concurrent land-use/subdivision pathway is modelled for these zones; Ruakura, Te Awa Lakes and Peacocke MDRZ precincts stay facts-only until their structure-plan rules are mapped.
- Christchurch: standard vacant-lot yield and ROI are enabled for verified HRZ, MRZ/RMD, RSDT, RS, Residential Banks Peninsula, Residential Hills, and Residential Large Lot matches. A conservative HRZ/MRZ comprehensive-development pathway is modelled only when no mapped qualifying matter is returned. Residential New Neighbourhood stays facts-only.
- Whangarei: standard vacant-lot yield and ROI are enabled for verified General Residential, Medium Density Residential, and Low Density Residential matches. Medium Density Residential also gets a conservative unit-title opportunity flag; the model does not use the 50sqm legal minimum directly for ROI.
- Queenstown Lakes: standard vacant-lot yield and ROI are enabled for verified High Density Residential, Medium Density Residential, and Lower Density/Suburban Residential matches. Airport-noise and Lake Hawea South Area B minimum-lot exceptions are applied when the mapped overlays are returned; the approved-residential-unit pathway is blocked inside the airport-noise/outer-control overlays.
- Dunedin: standard vacant-lot yield and ROI are enabled for verified General Residential 1 and General Residential 2 matches. GR2 uses a conservative 400sqm setting until wastewater-constraint mapping is verified. GR1/GR2 existing-house, duplex and multi-unit subdivision exemptions are modelled as conservative design-led opportunity flags, with pre-1940 demolition risk blocking the uplift.
- Canterbury outside Christchurch and Otago outside Dunedin/QLDC: official planning/service facts are shown where mapped; local subdivision rule packs are not yet fully modelled, so automated yield/ROI remains disabled.

## Regional design-led guardrails

Regional design-led/concurrent pathways are intentionally conservative. They only activate when the title/typology reads as a standalone redevelopment site, land area is verified, the property is not already an already-subdivided child title, and the pathway would exceed the standard vacant-lot yield. Restricted overlays, steep terrain, narrow parcel geometry, airport-noise controls, qualifying matters and pre-1940 demolition rules either lower confidence or block the uplift depending on the local rule.

## Regional cost profiles

The cost-estimator now accepts a regional cost profile. All regional profiles currently use Auckland-equivalent default values so production numbers stay familiar until region-specific construction, demolition, retaining, finance, consent, and contingency assumptions are supplied.

Configured profile IDs:

- `auckland-default`
- `hamilton-default`
- `christchurch-default`
- `canterbury-default`
- `whangarei-default`
- `qldc-default`
- `dunedin-default`
- `unsupported-default`
