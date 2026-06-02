import { Router, type IRouter } from "express";
import healthRouter from "./health";
import serversRouter from "./servers";
import envVarsRouter from "./envVars";
import connectionRouter from "./connection";
import processRouter from "./process";
import dashboardRouter from "./dashboard";
import sseRouter from "./sse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(serversRouter);
router.use(connectionRouter);
router.use(processRouter);
router.use(sseRouter);
router.use(envVarsRouter);

export default router;
