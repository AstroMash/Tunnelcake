#!/usr/bin/env node
// Assembles the self-contained, publishable bundle: builds the API server and
// web UI from the workspace and copies their compiled output into ./dist so the
// published npm package can run on plain Node with no workspace/pnpm tooling.
//
// This script requires pnpm + the monorepo and runs at publish time (`prepack`)
// or when a contributor runs `pnpm start`. It is NOT run on the consumer's
// machine — `npx mcp-server-manager` ships the prebuilt ./dist.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    console.error(`[build] \`${cmd} ${args.join(" ")}\` failed`);
    process.exit(result.status ?? 1);
  }
}

console.log("[build] Building API server...");
run("pnpm", ["--filter", "@workspace/api-server", "run", "build"], {
  NODE_ENV: "production",
});

console.log("[build] Building web UI...");
// vite.config requires a positive PORT and a BASE_PATH; the values only matter
// for the dev server, but the build still validates them. Base "/" so the
// assets resolve when served from the root by the launcher.
run("pnpm", ["--filter", "@workspace/mcp-manager", "run", "build"], {
  NODE_ENV: "production",
  PORT: "5173",
  BASE_PATH: "/",
});

const serverSrc = path.join(repoRoot, "artifacts/api-server/dist");
const webSrc = path.join(repoRoot, "artifacts/mcp-manager/dist/public");
const distDir = path.join(here, "dist");

console.log("[build] Assembling bundle...");
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(serverSrc, path.join(distDir, "server"), { recursive: true });
cpSync(webSrc, path.join(distDir, "public"), { recursive: true });

console.log(`[build] Bundled into ${distDir}`);
