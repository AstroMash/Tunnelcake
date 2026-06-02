import { spawn, execFile, type ChildProcess } from "node:child_process";
import { type Server as HttpServer } from "node:http";
import { writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import express from "express";
import yaml from "js-yaml";
import { eq, isNull } from "drizzle-orm";
import {
  db,
  serversTable,
  envVarsTable,
  tunnelConfigsTable,
  ngrokConfigsTable,
} from "@workspace/db";
import type { Request, Response, NextFunction } from "express";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { decryptSecret } from "./crypto";
import { requireServerBearer, type SseRequest } from "./sseAuth";
import { createRateLimiter } from "./rateLimit";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export type ProcessState = "stopped" | "starting" | "running" | "error";
export type ConnectionMode = "none" | "tunnel" | "ngrok";

export interface LogLine {
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

interface Runtime {
  serverId: number;
  state: ProcessState;
  connectionMode: ConnectionMode;
  pid: number | null;
  publicUrl: string | null;
  connectorUrl: string | null;
  bearerToken: string | null;
  startedAt: string | null;
  lastError: string | null;
  logs: LogLine[];
  child: ChildProcess | null;
  bridge: HttpServer | null;
  ngrokListener: { close: () => Promise<void> } | null;
  stdioTransport: StdioClientTransport | null;
  activeSse: SSEServerTransport | null;
}

const MAX_LOGS = 500;
const runtimes = new Map<number, Runtime>();

export function getRuntime(serverId: number): Runtime {
  let rt = runtimes.get(serverId);
  if (!rt) {
    rt = {
      serverId,
      state: "stopped",
      connectionMode: "none",
      pid: null,
      publicUrl: null,
      connectorUrl: null,
      bearerToken: null,
      startedAt: null,
      lastError: null,
      logs: [],
      child: null,
      bridge: null,
      ngrokListener: null,
      stdioTransport: null,
      activeSse: null,
    };
    runtimes.set(serverId, rt);
  }
  return rt;
}

function appendLog(
  rt: Runtime,
  stream: LogLine["stream"],
  message: string,
): void {
  const trimmed = message.replace(/\s+$/, "");
  if (!trimmed) return;
  for (const line of trimmed.split(/\r?\n/)) {
    rt.logs.push({
      timestamp: new Date().toISOString(),
      stream,
      message: line,
    });
  }
  if (rt.logs.length > MAX_LOGS) {
    rt.logs.splice(0, rt.logs.length - MAX_LOGS);
  }
}

async function resolveEnv(serverId: number): Promise<Record<string, string>> {
  const globalVars = await db
    .select()
    .from(envVarsTable)
    .where(isNull(envVarsTable.serverId));
  const serverVars = await db
    .select()
    .from(envVarsTable)
    .where(eq(envVarsTable.serverId, serverId));
  const merged: Record<string, string> = {};
  for (const v of globalVars) {
    merged[v.key] = decryptSecret(v.value);
  }
  // Per-server vars override globals.
  for (const v of serverVars) {
    merged[v.key] = decryptSecret(v.value);
  }
  return merged;
}

async function findExecutable(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("which", [name]);
    const p = stdout.trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

function dataDir(): string {
  return (
    process.env["MCP_DATA_DIR"] ?? path.join(homedir(), ".mcp-server-manager")
  );
}

function tunnelClientCacheDir(): string {
  return path.join(dataDir(), "bin");
}

function tunnelClientCachePath(): string {
  return path.join(tunnelClientCacheDir(), "tunnel-client");
}

export async function getTunnelClientPath(): Promise<string | null> {
  const configured = process.env["TUNNEL_CLIENT_PATH"];
  if (configured) return configured;
  const onPath = await findExecutable("tunnel-client");
  if (onPath) return onPath;
  const cached = tunnelClientCachePath();
  if (existsSync(cached)) return cached;
  return null;
}

// Resolve the download URL for the current OS/arch. The release base is
// configurable to avoid hardcoding an unverified URL; an explicit full URL
// always wins.
function tunnelClientDownloadUrl(): string | null {
  const explicit = process.env["TUNNEL_CLIENT_DOWNLOAD_URL"];
  if (explicit) return explicit;
  const base = process.env["TUNNEL_CLIENT_RELEASE_BASE"];
  if (!base) return null;
  const platform = process.platform;
  if (platform !== "linux" && platform !== "darwin") return null;
  const osPart = platform === "darwin" ? "darwin" : "linux";
  const archPart = process.arch === "arm64" ? "arm64" : "amd64";
  return `${base.replace(/\/$/, "")}/tunnel-client-${osPart}-${archPart}`;
}

// Ensure the tunnel-client binary is available. Resolution order: configured
// path / PATH / cache; otherwise download the OS-specific binary on first use
// and cache it with executable permissions.
export async function ensureTunnelClient(
  onLog?: (message: string) => void,
): Promise<string | null> {
  const existing = await getTunnelClientPath();
  if (existing) return existing;

  const url = tunnelClientDownloadUrl();
  if (!url) return null;

  const dest = tunnelClientCachePath();
  onLog?.(`Downloading tunnel-client from ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download tunnel-client: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(tunnelClientCacheDir(), { recursive: true });
  await writeFile(dest, buf);
  await chmod(dest, 0o755);
  onLog?.(`Cached tunnel-client at ${dest}`);
  return dest;
}

export async function getTunnelClientVersion(): Promise<string | null> {
  const bin = await getTunnelClientPath();
  if (!bin) return null;
  try {
    const { stdout } = await execFileAsync(bin, ["--version"]);
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export async function isNgrokAvailable(): Promise<boolean> {
  try {
    await import("@ngrok/ngrok");
    return true;
  } catch {
    return false;
  }
}

function publicBaseFromUrl(url: string): string {
  return url.replace(/\/$/, "");
}

export function serializeRuntime(rt: Runtime) {
  return {
    serverId: rt.serverId,
    state: rt.state,
    connectionMode: rt.connectionMode,
    pid: rt.pid,
    publicUrl: rt.publicUrl,
    connectorUrl: rt.connectorUrl,
    bearerToken: rt.bearerToken,
    startedAt: rt.startedAt,
    lastError: rt.lastError,
  };
}

async function startNone(
  rt: Runtime,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  rt.child = child;
  rt.pid = child.pid ?? null;
  child.stdout?.on("data", (d: Buffer) => appendLog(rt, "stdout", d.toString()));
  child.stderr?.on("data", (d: Buffer) => appendLog(rt, "stderr", d.toString()));
  child.on("error", (err) => {
    rt.state = "error";
    rt.lastError = err.message;
    appendLog(rt, "system", `Process error: ${err.message}`);
  });
  child.on("exit", (code, signal) => {
    appendLog(rt, "system", `Process exited (code=${code} signal=${signal})`);
    if (rt.state !== "stopped") {
      rt.state = code === 0 ? "stopped" : "error";
      if (code !== 0 && !rt.lastError) {
        rt.lastError = `Process exited with code ${code}`;
      }
    }
    rt.pid = null;
    rt.child = null;
  });
  // A stdio MCP server stays alive waiting for input; treat as running.
  rt.state = "running";
}

async function startTunnel(
  rt: Runtime,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  const cfg = await db
    .select()
    .from(tunnelConfigsTable)
    .where(eq(tunnelConfigsTable.serverId, rt.serverId));
  const tunnel = cfg[0];
  if (!tunnel) {
    throw new Error(
      "Tunnel mode requires a tunnel configuration. Add your tunnel ID and API key first.",
    );
  }
  const bin = await ensureTunnelClient((m) => appendLog(rt, "system", m));
  if (!bin) {
    throw new Error(
      "tunnel-client binary not found. Install the OpenAI Secure MCP Tunnel client on PATH, set TUNNEL_CLIENT_PATH, or configure TUNNEL_CLIENT_DOWNLOAD_URL / TUNNEL_CLIENT_RELEASE_BASE to download it automatically.",
    );
  }
  const apiKey = tunnel.apiKey ? decryptSecret(tunnel.apiKey) : "";
  if (!tunnel.tunnelId || !apiKey) {
    throw new Error("Tunnel configuration is incomplete (missing tunnel ID or API key).");
  }

  const profileDir = path.join(tmpdir(), "mcp-manager", `srv-${rt.serverId}`);
  await mkdir(profileDir, { recursive: true });
  const profilePath = path.join(profileDir, "profile.yaml");
  const profile = {
    servers: [
      {
        name: `mcp-server-${rt.serverId}`,
        command,
        args,
        env,
      },
    ],
  };
  await writeFile(profilePath, yaml.dump(profile), "utf8");
  appendLog(rt, "system", `Wrote tunnel profile to ${profilePath}`);

  const child = spawn(bin, ["run", "--profile-file", profilePath], {
    env: {
      ...process.env,
      ...env,
      CONTROL_PLANE_TUNNEL_ID: tunnel.tunnelId,
      CONTROL_PLANE_API_KEY: apiKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  rt.child = child;
  rt.pid = child.pid ?? null;
  rt.connectorUrl = tunnel.uiUrl ?? null;
  child.stdout?.on("data", (d: Buffer) => appendLog(rt, "stdout", d.toString()));
  child.stderr?.on("data", (d: Buffer) => appendLog(rt, "stderr", d.toString()));
  child.on("error", (err) => {
    rt.state = "error";
    rt.lastError = err.message;
    appendLog(rt, "system", `tunnel-client error: ${err.message}`);
  });
  child.on("exit", (code, signal) => {
    appendLog(rt, "system", `tunnel-client exited (code=${code} signal=${signal})`);
    if (rt.state !== "stopped") {
      rt.state = code === 0 ? "stopped" : "error";
      if (code !== 0 && !rt.lastError) {
        rt.lastError = `tunnel-client exited with code ${code}`;
      }
    }
    rt.pid = null;
    rt.child = null;
  });
  rt.state = "running";
}

async function startNgrok(
  rt: Runtime,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  const cfg = await db
    .select()
    .from(ngrokConfigsTable)
    .where(eq(ngrokConfigsTable.serverId, rt.serverId));
  const ngrokCfg = cfg[0];
  if (!ngrokCfg) {
    throw new Error(
      "ngrok mode requires an ngrok configuration. Add your ngrok auth token first.",
    );
  }
  const authToken = ngrokCfg.authToken ? decryptSecret(ngrokCfg.authToken) : "";
  if (!authToken) {
    throw new Error("ngrok configuration is incomplete (missing auth token).");
  }
  const bearerToken = ngrokCfg.bearerToken;

  if (!bearerToken) {
    throw new Error("ngrok configuration is incomplete (missing bearer token).");
  }

  let ngrok: typeof import("@ngrok/ngrok");
  try {
    ngrok = await import("@ngrok/ngrok");
  } catch {
    throw new Error("The @ngrok/ngrok package is not available in this environment.");
  }

  await startStdio(rt, command, args, env);

  // Dedicated SSE-only HTTP server that ngrok forwards to. It mounts ONLY the
  // SSE passthrough routes (same handlers as the documented /api endpoints), so
  // the management API — which can return decrypted secrets — is never exposed
  // publicly through the tunnel.
  const internalPort = await new Promise<number>((resolve, reject) => {
    const server = sseOnlyApp(rt.serverId).listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("Failed to bind SSE server port"));
    });
    server.on("error", reject);
    rt.bridge = server;
  });
  appendLog(rt, "system", `SSE server listening on 127.0.0.1:${internalPort}`);

  const listener = await ngrok.forward({
    addr: internalPort,
    authtoken: authToken,
    ...(ngrokCfg.domain ? { domain: ngrokCfg.domain } : {}),
  });
  rt.ngrokListener = listener;
  const publicUrl = listener.url();
  if (!publicUrl) {
    throw new Error("ngrok did not return a public URL.");
  }
  rt.publicUrl = publicUrl;
  rt.connectorUrl = `${publicBaseFromUrl(publicUrl)}/api/servers/${rt.serverId}/sse`;
  rt.bearerToken = bearerToken;

  // Persist the resolved public URL.
  await db
    .update(ngrokConfigsTable)
    .set({ publicUrl })
    .where(eq(ngrokConfigsTable.serverId, rt.serverId));

  appendLog(rt, "system", `ngrok public URL: ${publicUrl}`);
  rt.state = "running";
}

// Spawn the stdio MCP process and keep its transport on the runtime. Messages
// from the process are forwarded to whichever SSE session is currently active.
async function startStdio(
  rt: Runtime,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<void> {
  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );
  const stdioTransport = new StdioClientTransport({
    command,
    args,
    env: { ...env },
    stderr: "pipe",
  });
  stdioTransport.onmessage = (msg) => {
    rt.activeSse?.send(msg).catch((err) => {
      appendLog(rt, "system", `SSE send failed: ${String(err)}`);
    });
  };
  stdioTransport.onerror = (err) => {
    appendLog(rt, "stderr", `stdio transport error: ${String(err)}`);
  };
  stdioTransport.onclose = () => {
    appendLog(rt, "system", "stdio transport closed");
  };
  await stdioTransport.start();
  rt.stdioTransport = stdioTransport;
  rt.pid = stdioTransport.pid ?? null;
  stdioTransport.stderr?.on("data", (d: Buffer) =>
    appendLog(rt, "stderr", d.toString()),
  );
}

const sseLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

// Build a minimal Express app that exposes ONLY this server's SSE passthrough
// routes, for ngrok to forward to. Reuses the shared bearer-auth + rate-limit.
function sseOnlyApp(serverId: number): express.Express {
  const app = express();
  app.use(express.json());
  const onlyThisServer = (req: Request, res: Response, next: NextFunction) => {
    if (Number(req.params["id"]) !== serverId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };
  app.get(
    "/api/servers/:id/sse",
    onlyThisServer,
    sseLimiter,
    requireServerBearer,
    async (req, res) => {
      await openSseSession((req as SseRequest).serverId as number, res);
    },
  );
  app.post(
    "/api/servers/:id/messages",
    onlyThisServer,
    sseLimiter,
    requireServerBearer,
    async (req, res) => {
      await postSseMessage((req as SseRequest).serverId as number, req, res);
    },
  );
  return app;
}

// Attach a new SSE session to a running server's stdio process.
export async function openSseSession(
  serverId: number,
  res: Response,
): Promise<void> {
  const rt = getRuntime(serverId);
  if (!rt.stdioTransport || rt.state !== "running") {
    res.status(409).json({ error: "Server is not running" });
    return;
  }
  const { SSEServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/sse.js"
  );
  const sse = new SSEServerTransport(`/api/servers/${serverId}/messages`, res);
  rt.activeSse = sse;
  sse.onmessage = (msg) => {
    rt.stdioTransport?.send(msg).catch((err) => {
      appendLog(rt, "system", `stdio send failed: ${String(err)}`);
    });
  };
  sse.onclose = () => {
    if (rt.activeSse === sse) rt.activeSse = null;
    appendLog(rt, "system", "SSE client disconnected");
  };
  await sse.start();
  appendLog(rt, "system", "SSE client connected");
}

export async function postSseMessage(
  serverId: number,
  req: Request,
  res: Response,
): Promise<void> {
  const rt = getRuntime(serverId);
  if (!rt.activeSse) {
    res.status(409).json({ error: "No active SSE session" });
    return;
  }
  await rt.activeSse.handlePostMessage(req, res, req.body);
}

async function setRunningFlag(serverId: number, running: boolean): Promise<void> {
  await db
    .update(serversTable)
    .set({ running })
    .where(eq(serversTable.id, serverId));
}

// On boot, resume any servers that were running when the app last stopped.
export async function resumeServers(): Promise<void> {
  const rows = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.running, true));
  for (const s of rows) {
    appendLog(getRuntime(s.id), "system", "Resuming on startup");
    await startServer(s.id).catch((err) => {
      logger.error({ err, serverId: s.id }, "Failed to resume server");
    });
  }
}

export async function startServer(serverId: number) {
  const rows = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.id, serverId));
  const server = rows[0];
  if (!server) return null;

  const rt = getRuntime(serverId);
  if (rt.state === "running" || rt.state === "starting") {
    return serializeRuntime(rt);
  }

  rt.state = "starting";
  rt.lastError = null;
  rt.startedAt = new Date().toISOString();
  rt.connectionMode = server.connectionMode as ConnectionMode;
  rt.publicUrl = null;
  rt.connectorUrl = null;
  rt.bearerToken = null;
  appendLog(rt, "system", `Starting "${server.name}" in ${server.connectionMode} mode`);

  try {
    const env = await resolveEnv(serverId);
    const args = server.args ?? [];
    if (server.connectionMode === "tunnel") {
      await startTunnel(rt, server.command, args, env);
    } else if (server.connectionMode === "ngrok") {
      await startNgrok(rt, server.command, args, env);
    } else {
      await startNone(rt, server.command, args, env);
    }
  } catch (err) {
    rt.state = "error";
    rt.lastError = err instanceof Error ? err.message : String(err);
    appendLog(rt, "system", `Failed to start: ${rt.lastError}`);
    await stopServer(serverId).catch(() => undefined);
    rt.state = "error";
  }

  // Persist intent so the server can be resumed on next startup.
  const isRunning = getRuntime(serverId).state === "running";
  await setRunningFlag(serverId, isRunning).catch(() => undefined);
  return serializeRuntime(rt);
}

export async function stopServer(serverId: number) {
  const rt = getRuntime(serverId);
  rt.state = "stopped";
  appendLog(rt, "system", "Stopping server");
  await setRunningFlag(serverId, false).catch(() => undefined);

  if (rt.activeSse) {
    try {
      await rt.activeSse.close();
    } catch {
      /* ignore */
    }
    rt.activeSse = null;
  }
  if (rt.ngrokListener) {
    try {
      await rt.ngrokListener.close();
    } catch (err) {
      appendLog(rt, "system", `ngrok close error: ${String(err)}`);
    }
    rt.ngrokListener = null;
  }
  if (rt.stdioTransport) {
    try {
      await rt.stdioTransport.close();
    } catch {
      /* ignore */
    }
    rt.stdioTransport = null;
  }
  if (rt.bridge) {
    rt.bridge.close();
    rt.bridge = null;
  }
  if (rt.child) {
    rt.child.kill("SIGTERM");
    rt.child = null;
  }
  rt.pid = null;
  rt.publicUrl = null;
  rt.connectorUrl = null;
  rt.bearerToken = null;
  rt.startedAt = null;
  return serializeRuntime(rt);
}

export function deleteRuntime(serverId: number) {
  runtimes.delete(serverId);
}

export function getLogs(serverId: number): LogLine[] {
  return getRuntime(serverId).logs;
}
