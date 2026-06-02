import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import yaml from "js-yaml";
import { eq, isNull } from "drizzle-orm";
import {
  db,
  serversTable,
  envVarsTable,
  tunnelConfigsTable,
  ngrokConfigsTable,
} from "@workspace/db";
import { decryptSecret } from "./crypto";
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
  stdioTransport: { close: () => Promise<void> } | null;
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

export async function getTunnelClientPath(): Promise<string | null> {
  const configured = process.env["TUNNEL_CLIENT_PATH"];
  if (configured) return configured;
  return findExecutable("tunnel-client");
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
  const bin = await getTunnelClientPath();
  if (!bin) {
    throw new Error(
      "tunnel-client binary not found. Install the OpenAI Secure MCP Tunnel client and ensure it is on PATH or set TUNNEL_CLIENT_PATH.",
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

  let ngrok: typeof import("@ngrok/ngrok");
  try {
    ngrok = await import("@ngrok/ngrok");
  } catch {
    throw new Error("The @ngrok/ngrok package is not available in this environment.");
  }

  const { StdioClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/stdio.js"
  );
  const { SSEServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/sse.js"
  );

  const stdioTransport = new StdioClientTransport({
    command,
    args,
    env: { ...env },
    stderr: "pipe",
  });

  let activeSse: InstanceType<typeof SSEServerTransport> | null = null;

  stdioTransport.onmessage = (msg) => {
    activeSse?.send(msg).catch((err) => {
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
  const stderrStream = stdioTransport.stderr;
  stderrStream?.on("data", (d: Buffer) => appendLog(rt, "stderr", d.toString()));

  const bridge = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = req.headers["authorization"];
    const expected = `Bearer ${bearerToken}`;
    if (auth !== expected) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      appendLog(rt, "system", "Rejected unauthorized request");
      return;
    }

    if (req.method === "GET" && url.pathname === "/sse") {
      const sse = new SSEServerTransport("/messages", res);
      activeSse = sse;
      sse.onmessage = (msg) => {
        stdioTransport.send(msg).catch((err) => {
          appendLog(rt, "system", `stdio send failed: ${String(err)}`);
        });
      };
      sse.onclose = () => {
        if (activeSse === sse) activeSse = null;
        appendLog(rt, "system", "SSE client disconnected");
      };
      await sse.start();
      appendLog(rt, "system", "SSE client connected");
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      if (!activeSse) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "No active SSE session" }));
        return;
      }
      await activeSse.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  const internalPort: number = await new Promise((resolve, reject) => {
    bridge.on("error", reject);
    bridge.listen(0, "127.0.0.1", () => {
      const addr = bridge.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("Failed to bind bridge port"));
    });
  });
  rt.bridge = bridge;
  appendLog(rt, "system", `SSE bridge listening on 127.0.0.1:${internalPort}`);

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
  rt.connectorUrl = `${publicBaseFromUrl(publicUrl)}/sse`;
  rt.bearerToken = bearerToken;

  // Persist the resolved public URL.
  await db
    .update(ngrokConfigsTable)
    .set({ publicUrl })
    .where(eq(ngrokConfigsTable.serverId, rt.serverId));

  appendLog(rt, "system", `ngrok public URL: ${publicUrl}`);
  rt.state = "running";
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

  return serializeRuntime(rt);
}

export async function stopServer(serverId: number) {
  const rt = getRuntime(serverId);
  rt.state = "stopped";
  appendLog(rt, "system", "Stopping server");

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
