import { Router } from "express";
import { runPropertyPipeline } from "../lib/pipeline";
import { extractNZAddress } from "../lib/address-parser";

const router = Router();

const TEST_ADDRESS = "42 Arney Road, Remuera, Auckland";

router.get("/pipeline-test", async (req, res) => {
  const address = (req.query["address"] as string) || TEST_ADDRESS;

  try {
    const start = Date.now();
    const result = await runPropertyPipeline(address);
    const elapsed = Date.now() - start;
    const merged = result.merged;
    const diagnostics = {
      failed_sources: result.failed_sources,
      data_sources: merged?.data_sources ?? {},
      missing_critical_fields: merged?.missing_critical_fields ?? [],
      coverage: {
        cv_nzd: merged?.cv_nzd ?? null,
        build_year: merged?.build_year ?? null,
        floor_area_sqm: merged?.floor_area_sqm ?? null,
        land_area_sqm: merged?.land_area_sqm ?? null,
      },
      financials: {
        cv_unavailable: result.costs?.cv_unavailable ?? null,
        total_excludes_land: result.costs?.total_excludes_land ?? null,
        total_cost_low: result.costs?.total_low ?? null,
        total_cost_high: result.costs?.total_high ?? null,
      },
      lots: result.lots
        ? {
            lots: result.lots.lots,
            zone_label: result.lots.zone_label,
            gross_area_sqm: result.lots.gross_area_sqm,
            net_area_sqm: result.lots.net_area_sqm,
            easement_area_sqm: result.lots.easement_area_sqm,
          }
        : null,
      planning: {
        provider_id: result.raw_property?.planning_provider?.providerId ?? null,
        zone_code: result.zone?.zone_code ?? result.merged?.zone_code ?? null,
        zone_description: result.zone?.zone_description ?? result.merged?.zone_description ?? null,
        overlays: result.overlays.map((overlay) => ({ name: overlay.name, status: overlay.status })),
      },
      scoring: {
        scores: result.scores,
        roi_scenario_count: result.scenarios.length,
        first_roi_percent: result.scenarios[0]?.roi_percent ?? null,
      },
      timing_ms: result.timing_ms,
    };

    res.json({
      status: "ok",
      address,
      elapsed_ms: elapsed,
      diagnostics,
      pipeline: result,
    });
  } catch (error) {
    req.log.error({ error }, "Pipeline test failed");
    res.status(500).json({
      status: "error",
      address,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

router.get("/pipeline-test/extract", async (req, res) => {
  const message = (req.query["message"] as string) || "Can you check 42 Arney Road Remuera for me";

  try {
    const extracted = await extractNZAddress(message);
    res.json({ message, extracted });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

export default router;
