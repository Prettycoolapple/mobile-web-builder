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

    res.json({
      status: "ok",
      address,
      elapsed_ms: elapsed,
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
