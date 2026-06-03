import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema";

/**
 * Resolve the per-user data directory. This is the same convention used by the
 * api-server for its master key and binary cache, so all local state lives in
 * one place. Override with `MCP_DATA_DIR` (or the database file directly with
 * `MCP_DATABASE_PATH`).
 */
function dataDir(): string {
  return (
    process.env["MCP_DATA_DIR"] ?? path.join(homedir(), ".tunnelcake")
  );
}

export function databaseFilePath(): string {
  return (
    process.env["MCP_DATABASE_PATH"] ??
    path.join(dataDir(), "tunnelcake.db")
  );
}

// Create the data directory and open the file-backed database. Node's built-in
// `node:sqlite` driver requires no native-module compilation.
const dbFile = databaseFilePath();
mkdirSync(path.dirname(dbFile), { recursive: true });

export const sqlite = new DatabaseSync(dbFile);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

// Initialize the schema on first run. `CREATE TABLE IF NOT EXISTS` keeps this
// idempotent so the app is zero-setup and survives restarts. Column types mirror
// the Drizzle SQLite schema in ./schema (timestamps as unix seconds, booleans as
// 0/1 integers, json arrays as text).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '[]',
    connection_mode TEXT NOT NULL DEFAULT 'none',
    running INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS env_vars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER REFERENCES servers(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tunnel_configs (
    server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    tunnel_id TEXT NOT NULL,
    api_key TEXT,
    ui_url TEXT
  );

  CREATE TABLE IF NOT EXISTS ngrok_configs (
    server_id INTEGER PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
    auth_token TEXT,
    bearer_token TEXT NOT NULL,
    domain TEXT,
    public_url TEXT
  );
`);

// Bridge Drizzle's async SQLite proxy driver onto the synchronous `node:sqlite`
// API. The proxy expects each row returned as an array of column values in
// SELECT order; `node:sqlite` returns row objects whose key order matches the
// column order, so `Object.values` yields the correct shape.
export const db = drizzle(
  async (sqlText, params, method) => {
    // `node:sqlite` only binds null/number/bigint/string/Uint8Array. Drizzle
    // already encodes booleans, but coerce defensively so a stray boolean never
    // throws a binding error.
    const boundParams = params.map((p) =>
      typeof p === "boolean" ? (p ? 1 : 0) : p,
    );

    const stmt = sqlite.prepare(sqlText);

    if (method === "run") {
      stmt.run(...boundParams);
      return { rows: [] };
    }

    if (method === "get") {
      const row = stmt.get(...boundParams) as Record<string, unknown> | undefined;
      return { rows: row ? Object.values(row) : [] };
    }

    // "all" | "values"
    const rows = stmt.all(...boundParams) as Record<string, unknown>[];
    return { rows: rows.map((row) => Object.values(row)) };
  },
  { schema },
);

export * from "./schema";
