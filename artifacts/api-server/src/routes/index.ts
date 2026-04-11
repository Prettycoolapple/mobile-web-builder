import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyseRouter from "./analyse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyseRouter);

export default router;
