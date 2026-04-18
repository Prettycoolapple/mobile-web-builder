import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyseRouter from "./analyse";
import authRouter from "./auth";
import pipelineTestRouter from "./pipeline-test";
import stripeRouter from "./stripe";
import searchesRouter from "./searches";
import storageRouter from "./storage";
import uploadRouter from "./upload";
import listingsRouter from "./listings";
import dmRouter from "./dm";
import usersRouter from "./users";
import notificationsRouter from "./notifications";
import recommendationsRouter from "./recommendations";
import agentContactRouter from "./agent-contact";
import streetviewRouter from "./streetview";
import otpRouter from "./otp";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(analyseRouter);
router.use(pipelineTestRouter);
router.use(stripeRouter);
router.use(searchesRouter);
router.use(storageRouter);
router.use(uploadRouter);
router.use(listingsRouter);
router.use(dmRouter);
router.use(usersRouter);
router.use(notificationsRouter);
router.use(recommendationsRouter);
router.use(agentContactRouter);
router.use(streetviewRouter);
router.use(otpRouter);

export default router;
