import { spawn, execFile, type ChildProcess } from "node:child_process";
import { type Server as HttpServer } from "node:http";
import { writeFile, mkdir, chmod, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
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
export type TunnelHealth =
  | "unknown"
  | "starting"
  | "healthy"
  | "ready"
  | "unhealthy";

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
  tunnelHealth: TunnelHealth;
  logs: LogLine[];
  child: ChildProcess | null;
  bridge: HttpServer | null;
  ngrokListener: { close: () => Promise<void> } | null;
  stdioTransport: StdioClientTransport | null;
  activeSse: SSEServerTransport | null;
  healthPoll: ReturnType<typeof setInterval> | null;
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
      tunnelHealth: "unknown",
      logs: [],
      child: null,
      bridge: null,
      ngrokListener: null,
      stdioTransport: null,
      activeSse: null,
      healthPoll: null,
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

// The GitHub repository that publishes tunnel-client release binaries.
// Overridable so the default does not become a hard dependency on a single
// upstream location.
function tunnelClientRepo(): string {
  return process.env["TUNNEL_CLIENT_GITHUB_REPO"] ?? "openai/tunnel-client";
}

// The release asset infix for the current OS/arch, e.g. "linux-amd64".
function tunnelClientPlatformInfix(): string | null {
  const platform = process.platform;
  if (platform !== "linux" && platform !== "darwin") return null;
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  return `${platform}-${arch}`;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

// Resolve the release asset (and its checksums file) for this OS/arch from the
// latest GitHub release. Returns null when the platform is unsupported.
async function resolveTunnelClientAsset(): Promise<{
  asset: GithubAsset;
  sumsUrl: string | null;
} | null> {
  const infix = tunnelClientPlatformInfix();
  if (!infix) return null;

  const repo = tunnelClientRepo();
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "mcp-server-manager",
  };
  const token = process.env["GITHUB_TOKEN"];
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(apiUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `Failed to query GitHub releases for ${repo}: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const release = (await res.json()) as { assets?: GithubAsset[] };
  const assets = release.assets ?? [];
  const asset = assets.find(
    (a) => a.name.includes(infix) && a.name.endsWith(".zip"),
  );
  if (!asset) {
    throw new Error(
      `No tunnel-client release asset found for ${infix} in ${repo}`,
    );
  }
  const sums = assets.find((a) => a.name === "SHA256SUMS.txt");
  return { asset, sumsUrl: sums?.browser_download_url ?? null };
}

async function fetchExpectedSha256(
  sumsUrl: string,
  assetName: string,
): Promise<string | null> {
  try {
    const res = await fetch(sumsUrl);
    if (!res.ok) return null;
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const [sum, rawName] = line.trim().split(/\s+/);
      if (!sum || !rawName) continue;
      // Normalize common checksum name formats: "*filename" (binary mode)
      // and "./filename" path prefixes.
      const name = rawName.replace(/^\*/, "").replace(/^\.\//, "");
      if (name === assetName) return sum.toLowerCase();
    }
  } catch {
    /* ignore — verification is best-effort when sums are unavailable */
  }
  return null;
}

// Ensure the tunnel-client binary is available. Resolution order: configured
// path (TUNNEL_CLIENT_PATH) / PATH / cache; otherwise download it on first use.
// By default the latest release zip is resolved from GitHub, its SHA-256
// verified against the published SHA256SUMS.txt, then the binary is extracted
// and cached with executable permissions. TUNNEL_CLIENT_DOWNLOAD_URL forces a
// direct raw-binary download (no extraction) for air-gapped/custom mirrors.
export async function ensureTunnelClient(
  onLog?: (message: string) => void,
): Promise<string | null> {
  const existing = await getTunnelClientPath();
  if (existing) return existing;

  const dest = tunnelClientCachePath();
  await mkdir(tunnelClientCacheDir(), { recursive: true });

  // Explicit override: treat the URL as a direct, ready-to-run binary.
  const explicit = process.env["TUNNEL_CLIENT_DOWNLOAD_URL"];
  if (explicit) {
    onLog?.(`Downloading tunnel-client from ${explicit}`);
    const res = await fetch(explicit);
    if (!res.ok) {
      throw new Error(
        `Failed to download tunnel-client: HTTP ${res.status} ${res.statusText}`,
      );
    }
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    await chmod(dest, 0o755);
    onLog?.(`Cached tunnel-client at ${dest}`);
    return dest;
  }

  // Default: resolve the latest GitHub release asset for this platform.
  const resolved = await resolveTunnelClientAsset();
  if (!resolved) return null;
  const { asset, sumsUrl } = resolved;

  onLog?.(`Downloading ${asset.name} from ${tunnelClientRepo()} releases`);
  const res = await fetch(asset.browser_download_url);
  if (!res.ok) {
    throw new Error(
      `Failed to download tunnel-client: HTTP ${res.status} ${res.statusText}`,
    );
  }
  const zipBuf = Buffer.from(await res.arrayBuffer());

  // Verify the archive against the published checksum. This is the default
  // path for downloading an executable, so it must fail closed: a missing
  // SHA256SUMS.txt or a missing/mismatched entry aborts the install.
  if (!sumsUrl) {
    throw new Error(
      `tunnel-client release for ${tunnelClientRepo()} has no SHA256SUMS.txt; refusing to install unverified binary`,
    );
  }
  const expected = await fetchExpectedSha256(sumsUrl, asset.name);
  if (!expected) {
    throw new Error(
      `No SHA-256 checksum entry found for ${asset.name}; refusing to install unverified binary`,
    );
  }
  const actual = createHash("sha256").update(zipBuf).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `tunnel-client checksum mismatch for ${asset.name} (expected ${expected}, got ${actual})`,
    );
  }
  onLog?.("Verified tunnel-client SHA-256 checksum");

  // Extract the binary entry from the zip into the cache.
  const zip = new AdmZip(zipBuf);
  const entry = zip
    .getEntries()
    .find(
      (e) =>
        !e.isDirectory &&
        (path.basename(e.entryName) === "tunnel-client" ||
          path.basename(e.entryName) === "tunnel-client.exe"),
    );
  if (!entry) {
    throw new Error(
      `tunnel-client binary not found inside ${asset.name}`,
    );
  }
  await writeFile(dest, entry.getData());
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
    tunnelHealth: rt.tunnelHealth,
  };
}

// process.env is Record<string, string | undefined>; the MCP stdio transport
// requires a clean string map. Drop undefined values.
function inheritedStringEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
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
      "tunnel-client binary is unavailable for this platform. Install the OpenAI Secure MCP Tunnel client on PATH, set TUNNEL_CLIENT_PATH, or set TUNNEL_CLIENT_DOWNLOAD_URL to a direct binary URL.",
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

  // Bind the tunnel-client health server to a random loopback port (the default
  // 127.0.0.1:8080 would collide with this API) and have it write the resolved
  // health URL to a file so we can poll /readyz and /healthz.
  const healthUrlFile = path.join(profileDir, "health.url");
  await rm(healthUrlFile, { force: true }).catch(() => undefined);

  const child = spawn(
    bin,
    [
      "run",
      "--profile-file",
      profilePath,
      "--health.listen-addr",
      "127.0.0.1:0",
      "--health.url-file",
      healthUrlFile,
    ],
    {
      env: {
        ...process.env,
        ...env,
        CONTROL_PLANE_TUNNEL_ID: tunnel.tunnelId,
        CONTROL_PLANE_API_KEY: apiKey,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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
    stopHealthPolling(rt);
    rt.tunnelHealth = "unknown";
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
  rt.tunnelHealth = "starting";
  startHealthPolling(rt, healthUrlFile);
}

// Poll the tunnel-client health server. It exposes /readyz (ready to serve
// traffic) and /healthz (process is alive) on the loopback address written to
// healthUrlFile. We surface "ready" / "healthy" / "unhealthy" on the runtime.
function startHealthPolling(rt: Runtime, healthUrlFile: string): void {
  stopHealthPolling(rt);
  let baseUrl: string | null = null;
  // Capture the interval handle this closure owns. A probe is async and may
  // still be in flight when stopHealthPolling() clears rt.healthPoll (or a
  // restart installs a new one); guard every mutation so a stale probe cannot
  // overwrite the health of a stopped or restarted runtime.
  const isCurrent = () => rt.healthPoll === handle;
  const handle: ReturnType<typeof setInterval> = setInterval(() => {
    void (async () => {
      try {
        if (!baseUrl) {
          if (!existsSync(healthUrlFile)) return;
          const raw = (await readFile(healthUrlFile, "utf8")).trim();
          if (!raw || !isCurrent()) return;
          baseUrl = raw.replace(/\/$/, "");
          appendLog(rt, "system", `tunnel-client health endpoint: ${baseUrl}`);
        }
        const ready = await probeHealth(`${baseUrl}/readyz`);
        if (!isCurrent()) return;
        if (ready) {
          if (rt.tunnelHealth !== "ready") {
            appendLog(rt, "system", "tunnel-client is ready");
          }
          rt.tunnelHealth = "ready";
          return;
        }
        const healthy = await probeHealth(`${baseUrl}/healthz`);
        if (!isCurrent()) return;
        rt.tunnelHealth = healthy ? "healthy" : "unhealthy";
      } catch {
        if (isCurrent()) rt.tunnelHealth = "unhealthy";
      }
    })();
  }, 2000);
  rt.healthPoll = handle;
}

function stopHealthPolling(rt: Runtime): void {
  if (rt.healthPoll) {
    clearInterval(rt.healthPoll);
    rt.healthPoll = null;
  }
}

async function probeHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
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
    // Inherit the parent environment (PATH, HOME, etc.) so standard commands
    // like `uvx mcp-pfsense` resolve correctly, then layer the per-server env
    // on top. Matches startNone/startTunnel behavior.
    env: { ...inheritedStringEnv(), ...env },
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

  stopHealthPolling(rt);
  rt.tunnelHealth = "unknown";

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
