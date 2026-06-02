import { Router, type IRouter } from "express";
import { isNull } from "drizzle-orm";
import os from "node:os";
import { db, serversTable, envVarsTable } from "@workspace/db";
import {
  ensureTunnelClient,
  getRuntime,
  getTunnelClientPath,
  getTunnelClientVersion,
  isNgrokAvailable,
} from "../lib/manager";

const router: IRouter = Router();

router.get("/summary", async (_req, res) => {
  const servers = await db.select().from(serversTable);
  const globalVars = await db
    .select()
    .from(envVarsTable)
    .where(isNull(envVarsTable.serverId));

  let running = 0;
  let stopped = 0;
  let errored = 0;
  let tunnel = 0;
  let ngrok = 0;
  for (const s of servers) {
    const rt = getRuntime(s.id);
    if (rt.state === "running" || rt.state === "starting") running += 1;
    else if (rt.state === "error") errored += 1;
    else stopped += 1;
    if (s.connectionMode === "tunnel") tunnel += 1;
    else if (s.connectionMode === "ngrok") ngrok += 1;
  }

  res.json({
    totalServers: servers.length,
    runningServers: running,
    stoppedServers: stopped,
    erroredServers: errored,
    tunnelServers: tunnel,
    ngrokServers: ngrok,
    globalEnvVarCount: globalVars.length,
  });
});

router.get("/environment", async (_req, res) => {
  // Ensure the tunnel-client binary is provisioned (download + checksum verify
  // on first use, no-op once cached) so the reported status reflects the real,
  // ready-to-run state rather than whatever happened to be on PATH/cache.
  let tunnelClientError: string | null = null;
  try {
    await ensureTunnelClient();
  } catch (err) {
    tunnelClientError = err instanceof Error ? err.message : String(err);
  }
  const tunnelPath = await getTunnelClientPath();
  const tunnelVersion = tunnelPath ? await getTunnelClientVersion() : null;
  const ngrokInstalled = await isNgrokAvailable();
  res.json({
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    tunnelClientInstalled: !!tunnelPath,
    tunnelClientVersion: tunnelVersion,
    tunnelClientError,
    ngrokInstalled,
    boundToLocalhost: /^(127\.|::1$|localhost$)/.test(
      process.env["HOST"] ?? "127.0.0.1",
    ),
  });
});

export default router;
