import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    deploymentSha: process.env["VERCEL_GIT_COMMIT_SHA"] ?? process.env["GIT_COMMIT_SHA"] ?? null,
  });
  res.json(data);
});

export default router;
