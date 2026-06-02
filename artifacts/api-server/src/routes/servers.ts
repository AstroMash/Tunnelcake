import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, serversTable } from "@workspace/db";
import {
  CreateServerBody,
  UpdateServerBody,
  GetServerParams,
} from "@workspace/api-zod";
import { getRuntime, stopServer, deleteRuntime } from "../lib/manager";

const router: IRouter = Router();

function toServer(row: typeof serversTable.$inferSelect) {
  const rt = getRuntime(row.id);
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: row.args ?? [],
    connectionMode: row.connectionMode,
    state: rt.state,
    publicUrl: rt.publicUrl,
    lastError: rt.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/servers", async (_req, res) => {
  const rows = await db.select().from(serversTable);
  res.json(rows.map(toServer));
});

router.post("/servers", async (req, res) => {
  const parsed = CreateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, command, args, connectionMode } = parsed.data;
  const inserted = await db
    .insert(serversTable)
    .values({
      name,
      command,
      args: args ?? [],
      connectionMode: connectionMode ?? "none",
    })
    .returning();
  res.status(201).json(toServer(inserted[0]!));
});

router.get("/servers/:id", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.id, params.data.id));
  if (!rows[0]) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(toServer(rows[0]));
});

router.patch("/servers/:id", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates["name"] = parsed.data.name;
  if (parsed.data.command !== undefined) updates["command"] = parsed.data.command;
  if (parsed.data.args !== undefined) updates["args"] = parsed.data.args;
  if (parsed.data.connectionMode !== undefined)
    updates["connectionMode"] = parsed.data.connectionMode;

  const updated = await db
    .update(serversTable)
    .set(updates)
    .where(eq(serversTable.id, params.data.id))
    .returning();
  if (!updated[0]) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(toServer(updated[0]));
});

router.delete("/servers/:id", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await stopServer(params.data.id);
  const deleted = await db
    .delete(serversTable)
    .where(eq(serversTable.id, params.data.id))
    .returning();
  if (!deleted[0]) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  deleteRuntime(params.data.id);
  res.status(204).end();
});

export default router;
