import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  serversTable,
  tunnelConfigsTable,
  ngrokConfigsTable,
} from "@workspace/db";
import {
  GetServerParams,
  SetTunnelConfigBody,
  SetNgrokConfigBody,
} from "@workspace/api-zod";
import { encryptSecret, generateBearerToken } from "../lib/crypto";

const router: IRouter = Router();

async function serverExists(id: number): Promise<boolean> {
  const rows = await db
    .select({ id: serversTable.id })
    .from(serversTable)
    .where(eq(serversTable.id, id));
  return !!rows[0];
}

function toTunnel(row: typeof tunnelConfigsTable.$inferSelect) {
  return {
    serverId: row.serverId,
    tunnelId: row.tunnelId,
    hasApiKey: !!row.apiKey,
    uiUrl: row.uiUrl,
  };
}

function toNgrok(row: typeof ngrokConfigsTable.$inferSelect) {
  return {
    serverId: row.serverId,
    hasAuthToken: !!row.authToken,
    bearerToken: row.bearerToken,
    domain: row.domain,
    publicUrl: row.publicUrl,
  };
}

router.get("/servers/:id/tunnel", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(tunnelConfigsTable)
    .where(eq(tunnelConfigsTable.serverId, params.data.id));
  if (!rows[0]) {
    res.status(404).json({ error: "Tunnel config not found" });
    return;
  }
  res.json(toTunnel(rows[0]));
});

router.put("/servers/:id/tunnel", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SetTunnelConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await serverExists(params.data.id))) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const existing = await db
    .select()
    .from(tunnelConfigsTable)
    .where(eq(tunnelConfigsTable.serverId, params.data.id));

  const apiKeyUpdate =
    parsed.data.apiKey && parsed.data.apiKey.length > 0
      ? encryptSecret(parsed.data.apiKey)
      : existing[0]?.apiKey ?? null;

  let row: typeof tunnelConfigsTable.$inferSelect;
  if (existing[0]) {
    const updated = await db
      .update(tunnelConfigsTable)
      .set({ tunnelId: parsed.data.tunnelId, apiKey: apiKeyUpdate })
      .where(eq(tunnelConfigsTable.serverId, params.data.id))
      .returning();
    row = updated[0]!;
  } else {
    const inserted = await db
      .insert(tunnelConfigsTable)
      .values({
        serverId: params.data.id,
        tunnelId: parsed.data.tunnelId,
        apiKey: apiKeyUpdate,
      })
      .returning();
    row = inserted[0]!;
  }
  res.json(toTunnel(row));
});

router.get("/servers/:id/ngrok", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(ngrokConfigsTable)
    .where(eq(ngrokConfigsTable.serverId, params.data.id));
  if (!rows[0]) {
    res.status(404).json({ error: "Ngrok config not found" });
    return;
  }
  res.json(toNgrok(rows[0]));
});

router.put("/servers/:id/ngrok", async (req, res) => {
  const params = GetServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SetNgrokConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await serverExists(params.data.id))) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  const existing = await db
    .select()
    .from(ngrokConfigsTable)
    .where(eq(ngrokConfigsTable.serverId, params.data.id));

  const authTokenUpdate =
    parsed.data.authToken && parsed.data.authToken.length > 0
      ? encryptSecret(parsed.data.authToken)
      : existing[0]?.authToken ?? null;

  const bearerToken =
    parsed.data.rotateBearerToken || !existing[0]
      ? generateBearerToken()
      : existing[0].bearerToken;

  const domain =
    parsed.data.domain !== undefined
      ? parsed.data.domain
      : existing[0]?.domain ?? null;

  let row: typeof ngrokConfigsTable.$inferSelect;
  if (existing[0]) {
    const updated = await db
      .update(ngrokConfigsTable)
      .set({ authToken: authTokenUpdate, bearerToken, domain })
      .where(eq(ngrokConfigsTable.serverId, params.data.id))
      .returning();
    row = updated[0]!;
  } else {
    const inserted = await db
      .insert(ngrokConfigsTable)
      .values({
        serverId: params.data.id,
        authToken: authTokenUpdate,
        bearerToken,
        domain,
      })
      .returning();
    row = inserted[0]!;
  }
  res.json(toNgrok(row));
});

export default router;
