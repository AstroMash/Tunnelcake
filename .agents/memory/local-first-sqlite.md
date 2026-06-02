---
name: Local-first SQLite storage
description: Durable decisions/gotchas for SQLite persistence and the publishable npx launcher (no Postgres, no native modules).
---

# Local-first SQLite storage

Persistence is a single SQLite file in a per-user dir (`~/.mcp-server-manager`,
override via `MCP_DATA_DIR` / `MCP_DATABASE_PATH`). No `DATABASE_URL`, no
Postgres, no native compilation.

## Why node:sqlite via Drizzle `sqlite-proxy`
The pinned Drizzle ships no dedicated `node:sqlite` adapter — only native drivers
and the async `sqlite-proxy`. To use Node's built-in `node:sqlite` with zero
native build, bridge it through `sqlite-proxy` (an async callback that runs each
statement synchronously).
**Why:** keeps "download and run on plain Node" true. **How to apply:** if a real
`node-sqlite` Drizzle adapter appears on upgrade, prefer it over the bridge.

## sqlite-proxy row-shape gotcha
The proxy callback must return rows as **arrays of column values in SELECT
order**, not row objects (`get` → one value-array, `all`/`values` → array of
value-arrays, `run` → empty). `node:sqlite` row objects keep column order, so
`Object.values(row)` is correct; returning objects silently mismaps columns.
Also coerce booleans → 0/1 before binding — `node:sqlite` throws on a raw boolean.

## Tables created at startup, not via drizzle-kit
Schema is bootstrapped with idempotent `CREATE TABLE IF NOT EXISTS` DDL at module
load.
**Why:** drizzle-kit's SQLite push needs a native driver we deliberately avoid,
and a local single-file DB doesn't need a migration history. `PRAGMA
foreign_keys = ON` is required for ON DELETE CASCADE.

## The npx package is a separate, self-contained package (`cli/`)
`npx mcp-server-manager` must work on a clean machine with **only Node** — it
cannot run the pnpm workspace. So the publishable package lives in `cli/` (its
own public package.json, no `private`, no pnpm-only `preinstall`), ships the
**prebuilt** server + web bundles in `cli/dist`, and its launcher is pure Node
(picks a free port, runs the server with `MCP_WEB_DIST` set, opens the browser).
Do NOT try to make the workspace root the published package — its preinstall
guard rejects npm and would break `npx`.
**Why:** the workspace root is pnpm-only by design; conflating it with the
distributable breaks the Node-only install path.
**How to apply:** the only runtime external dep of the server bundle is
`@ngrok/ngrok` (lazily imported) — keep it declared in `cli/package.json`. The
launcher prefers in-place `artifacts/*/dist` when present (monorepo/dev) and
falls back to `cli/dist` (published), so ngrok resolves correctly in both modes.
