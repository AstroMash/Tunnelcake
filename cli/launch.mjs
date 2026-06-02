#!/usr/bin/env node
// Pure-Node launcher. No pnpm, no build step, no workspace assumptions.
//
// Two run modes, auto-detected:
//   1. Published npm package (`npx mcp-server-manager`): runs the prebuilt
//      bundle shipped in ./dist (server + web), with @ngrok/ngrok resolved from
//      this package's own dependencies.
//   2. Monorepo / `pnpm start`: runs the in-place artifact builds so dynamic
//      deps (e.g. @ngrok/ngrok) resolve from the workspace.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const repoServer = path.resolve(
  here,
  "..",
  "artifacts/api-server/dist/index.mjs",
);
const repoWeb = path.resolve(here, "..", "artifacts/mcp-manager/dist/public");
const bundledServer = path.join(here, "dist/server/index.mjs");
const bundledWeb = path.join(here, "dist/public");

function log(msg) {
  process.stdout.write(`[mcp-server-manager] ${msg}\n`);
}

let serverEntry;
let webDist;
if (existsSync(repoServer)) {
  serverEntry = repoServer;
  webDist = repoWeb;
} else if (existsSync(bundledServer)) {
  serverEntry = bundledServer;
  webDist = bundledWeb;
} else {
  log(
    "Could not find the built app. If running from source, run `pnpm install` then `pnpm start`.",
  );
  process.exit(1);
}

// Ask the OS for a free loopback port by binding to port 0.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForReady(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function openBrowser(url) {
  const os = platform();
  const cmd = os === "darwin" ? "open" : os === "win32" ? "cmd" : "xdg-open";
  const args = os === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* headless / no browser — the URL is logged below */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

async function main() {
  const host = "127.0.0.1";
  const port = process.env.PORT
    ? Number(process.env.PORT)
    : await findFreePort();
  const url = `http://${host}:${port}/`;

  const child = spawn(
    process.execPath,
    ["--enable-source-maps", "--no-warnings", serverEntry],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        HOST: host,
        PORT: String(port),
        MCP_WEB_DIST: webDist,
      },
    },
  );

  const shutdown = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  child.on("exit", (code) => process.exit(code ?? 0));

  const dataDir =
    process.env.MCP_DATA_DIR ?? path.join(homedir(), ".mcp-server-manager");
  log(`Data is stored in ${dataDir}`);
  log(`Starting on ${url}`);

  const ready = await waitForReady(`${url}api/healthz`);
  if (ready) {
    log("Ready — opening your browser.");
    openBrowser(url);
  } else {
    log(`Server did not become ready in time. Open ${url} manually.`);
  }
}

main().catch((err) => {
  log(`Failed to start: ${err?.message ?? err}`);
  process.exit(1);
});
