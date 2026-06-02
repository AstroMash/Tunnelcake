import { Router, type IRouter } from "express";
import { eq, isNull } from "drizzle-orm";
import { db, envVarsTable } from "@workspace/db";
import {
  CreateEnvVarBody,
  UpdateEnvVarBody,
  UpdateEnvVarParams,
  ListEnvVarsQueryParams,
} from "@workspace/api-zod";
import { encryptSecret, decryptSecret } from "../lib/crypto";

const router: IRouter = Router();

function toEnvVar(row: typeof envVarsTable.$inferSelect) {
  return {
    id: row.id,
    serverId: row.serverId,
    scope: row.serverId === null ? "global" : "server",
    key: row.key,
    value: decryptSecret(row.value),
  };
}

router.get("/env-vars", async (req, res) => {
  const parsed = ListEnvVarsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const serverId = parsed.data.serverId;
  const rows =
    serverId === undefined || serverId === null
      ? await db.select().from(envVarsTable).where(isNull(envVarsTable.serverId))
      : await db
          .select()
          .from(envVarsTable)
          .where(eq(envVarsTable.serverId, serverId));
  res.json(rows.map(toEnvVar));
});

router.post("/env-vars", async (req, res) => {
  const parsed = CreateEnvVarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { serverId, key, value } = parsed.data;
  const inserted = await db
    .insert(envVarsTable)
    .values({
      serverId: serverId ?? null,
      key,
      value: encryptSecret(value),
    })
    .returning();
  res.status(201).json(toEnvVar(inserted[0]!));
});

router.patch("/env-vars/:id", async (req, res) => {
  const params = UpdateEnvVarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEnvVarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.key !== undefined) updates["key"] = parsed.data.key;
  if (parsed.data.value !== undefined)
    updates["value"] = encryptSecret(parsed.data.value);
  if (Object.keys(updates).length === 0) {
    const rows = await db
      .select()
      .from(envVarsTable)
      .where(eq(envVarsTable.id, params.data.id));
    if (!rows[0]) {
      res.status(404).json({ error: "Environment variable not found" });
      return;
    }
    res.json(toEnvVar(rows[0]));
    return;
  }
  const updated = await db
    .update(envVarsTable)
    .set(updates)
    .where(eq(envVarsTable.id, params.data.id))
    .returning();
  if (!updated[0]) {
    res.status(404).json({ error: "Environment variable not found" });
    return;
  }
  res.json(toEnvVar(updated[0]));
});

router.delete("/env-vars/:id", async (req, res) => {
  const params = UpdateEnvVarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const deleted = await db
    .delete(envVarsTable)
    .where(eq(envVarsTable.id, params.data.id))
    .returning();
  if (!deleted[0]) {
    res.status(404).json({ error: "Environment variable not found" });
    return;
  }
  res.status(204).end();
});

export default router;
