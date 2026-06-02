---
name: MCP Server Manager
description: Durable decisions/constraints for the MCP Server Manager full-stack app (react-vite frontend + shared Express api-server).
---

# MCP Server Manager

A single-user local tool (Linux/macOS) that manages stdio MCP servers and exposes them to ChatGPT through two connection modes: OpenAI Secure MCP Tunnel (private, via tunnel-client binary + YAML profile) or ngrok SSE proxy (public HTTPS, bearer-token protected).

## Same-origin API → no CORS needed
The react-vite frontend (artifact at `/`) calls the api-server with **relative** `/api/...` paths, which the Replit path-routing proxy forwards to the api-server artifact — so frontend↔backend is **same-origin**. Do NOT enable permissive `cors()`.
**Why:** wildcard CORS + no auth + endpoints returning decrypted secrets (env-var values, ngrok bearer token) lets any malicious website read those secrets from a localhost-bound API. Browser same-origin policy already blocks cross-origin reads when CORS is off.
**How to apply:** keep CORS disabled; bind the API to loopback by default (`HOST` env var, default `127.0.0.1`) — the Replit proxy still reaches it via localhost on the same host.

## Deleting a server must stop it first
Process/tunnel lifecycle lives in an in-memory runtimes map in `manager.ts`, separate from DB rows. `DELETE /servers/:id` must call `stopServer(id)` before removing the DB row and `deleteRuntime(id)` after.
**Why:** otherwise a running child process / ngrok listener / SSE bridge is orphaned (still alive in memory), and the process routes guard on `serverExists`, so the orphan can never be stopped via API.

## Secret handling
AES-256-GCM (per-secret random IV) via `MCP_MASTER_KEY` shared env var encrypts tunnel API key, ngrok auth token, and env-var values at rest. Config GET endpoints expose only booleans (`hasApiKey`, `hasAuthToken`), never the plaintext secret. The ngrok **bearer token IS returned plaintext intentionally** — the user pastes it into ChatGPT as the connector's auth token.

## Generated TanStack Query hooks require `queryKey`
Every `useXxx(..., { query: {...} })` call must include `queryKey: getXxxQueryKey(args)` or it fails typecheck. Sync async query data into form state with `useEffect([data])`, never `useState(() => ...)` (the initializer runs once before data arrives and never re-syncs). Don't pass both `value` and `defaultValue` to a controlled Input.
