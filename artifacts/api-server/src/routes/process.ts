import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, serversTable } from "@workspace/db";
import { GetServerParams } from "@workspace/api-zod";
import {
  startServer,
  stopServer,
  getRuntime,
  serializeRuntime,
  getLogs,
} from "../lib/manager";

const router: IRouter = Router();

async function serverExists(id: number): Promise<boolean> {
  const rows = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.id, id));
  return !!rows[0];
}

router.post("/servers/:id/start", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = await startServer(params.data.id);
  if (!result) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(result);
});

router.post("/servers/:id/stop", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await serverExists(params.data.id))) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const result = await stopServer(params.data.id);
  res.json(result);
});

router.get("/servers/:id/status", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await serverExists(params.data.id))) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(serializeRuntime(getRuntime(params.data.id)));
});

router.get("/servers/:id/logs", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await serverExists(params.data.id))) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json({ serverId: params.data.id, lines: getLogs(params.data.id) });
});

export default router;
