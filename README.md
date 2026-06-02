# MCP Server Manager

A local-first tool to manage your [Model Context Protocol](https://modelcontextprotocol.io)
(MCP) stdio servers and expose them to ChatGPT — either privately through the
OpenAI Secure MCP Tunnel or publicly through an ngrok SSE proxy.

It runs entirely on your own machine. There is **no database to set up** and
**nothing to deploy**: data is stored in a single local file and the whole app
runs as one process.

## Quick start

You need [Node.js](https://nodejs.org) **24 or newer** (the app uses Node's
built-in SQLite, so there are no native modules to compile).

Run it with a single command — no clone, no build, no configuration:

```bash
npx mcp-server-manager
```

This downloads the prebuilt app, starts a local server on an available port, and
opens the management UI in your browser.

### Running from a clone (for development)

If you have cloned the repository (this is a pnpm monorepo, so use pnpm):

```bash
pnpm install
pnpm start
```

`pnpm start` builds the app and launches it the same way as the published
command.

## Where your data is stored

All local state lives in a per-user directory:

- **macOS / Linux:** `~/.mcp-server-manager/`
- **Windows:** `%USERPROFILE%\.mcp-server-manager\`

Inside it you'll find:

- `mcp-server-manager.db` — the SQLite database (your servers, env vars, and
  connection configs). It is created automatically on first run and persists
  across restarts.
- `master.key` — the auto-generated key used to encrypt secrets at rest
  (created only if you don't set `MCP_MASTER_KEY`).
- `bin/` — the cached OpenAI tunnel-client binary.

To start completely fresh, stop the app and delete that directory.

### Configuration

Everything works with zero configuration. The following environment variables
are optional:

- `MCP_DATA_DIR` — override the data directory (default: `~/.mcp-server-manager`).
- `MCP_DATABASE_PATH` — override the database file path directly.
- `MCP_MASTER_KEY` — provide your own 32-byte (64-char hex) encryption key
  instead of the auto-generated one.
- `PORT` — pin the server to a specific port instead of picking a free one.

## Stack

- Node.js 24, TypeScript, pnpm workspaces
- API: Express 5
- Storage: SQLite via Node's built-in `node:sqlite` driver + Drizzle ORM
- UI: React + Vite (served as static assets by the same process in local mode)

The published `npx` package (`cli/`) bundles the prebuilt server and UI so it
runs on plain Node with no workspace tooling.
