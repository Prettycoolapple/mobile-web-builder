import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyseRouter from "./analyse";
import authRouter from "./auth";
import pipelineTestRouter from "./pipeline-test";
import stripeRouter from "./stripe";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(analyseRouter);
router.use(pipelineTestRouter);
router.use(stripeRouter);

export default router;
