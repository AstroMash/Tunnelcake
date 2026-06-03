---
name: uv/uvx + tunnel-client provisioning
description: Durable decisions for running stdio MCP servers (uvx) and provisioning the OpenAI tunnel-client in this environment.
---

# Running stdio MCP servers via uvx

`uvx <pkg>` needs BOTH `uv` and a system Python runtime installed; uv here is
configured to use only a pre-existing interpreter and is not allowed to download
one, so a missing Python yields a confusing "no interpreter found" failure.
**Rule:** keep a Python module installed alongside uv whenever the app must
spawn `uvx ...` servers.
**Why:** without the interpreter, the spawn succeeds but uv's resolution fails,
which looks like an app bug rather than a missing dependency.

# Provisioning the tunnel-client binary

The tunnel-client binary is fetched on demand, verified by checksum, and cached
outside the repo (under `~/.tunnelcake/bin`) — so it does NOT persist to a fresh
environment via source control.
**Decision:** provision it deterministically at API-server startup (and on the
Environment status request) by invoking the existing ensure routine, rather than
relying on a manual one-off download or a Nix package.
**Why:** a manual download into the home dir is invisible to a fresh clone, so
the "go live" tunnel mode would silently be unavailable after rebuilds; tying
provisioning to the always-running server makes it self-healing.
