import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyseRouter from "./analyse";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(analyseRouter);

export default router;
