import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, serversTable } from "@workspace/db";
import {
  getRuntime,
  stopServer,
  deleteRuntime,
  type ProcessState,
} from "./manager";
import serversRouter from "../routes/servers";

const createdServerIds: number[] = [];

async function createServer(connectionMode = "none"): Promise<number> {
  const inserted = await db
    .insert(serversTable)
    .values({
      name: `lifecycle-test-${Date.now()}-${Math.random()}`,
      command: "echo",
      args: ["hi"],
      connectionMode,
    })
    .returning();
  const id = inserted[0]!.id;
  createdServerIds.push(id);
  return id;
}

// Build a runtime that looks like a live server with a child process, an active
// SSE session, an ngrok tunnel listener, an stdio transport and a bridge HTTP
// server — plus the spies that let us assert each one is torn down.
function makeLiveRuntime(serverId: number) {
  const rt = getRuntime(serverId);
  const childKill = vi.fn();
  const ngrokClose = vi.fn().mockResolvedValue(undefined);
  const stdioClose = vi.fn().mockResolvedValue(undefined);
  const sseClose = vi.fn().mockResolvedValue(undefined);
  const bridgeClose = vi.fn();

  rt.state = "running";
  rt.pid = 4242;
  rt.connectionMode = "ngrok";
  rt.publicUrl = "https://example.ngrok.app";
  rt.connectorUrl = "https://example.ngrok.app/api/servers/x/sse";
  rt.bearerToken = "live-bearer";
  rt.tunnelHealth = "ready";
  rt.healthPoll = setInterval(() => {}, 60_000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt.child = { kill: childKill } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt.ngrokListener = { close: ngrokClose } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt.stdioTransport = { close: stdioClose } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt.activeSse = { close: sseClose } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rt.bridge = { close: bridgeClose } as any;

  return { rt, childKill, ngrokClose, stdioClose, sseClose, bridgeClose };
}

afterEach(async () => {
  for (const id of createdServerIds.splice(0)) {
    deleteRuntime(id);
    await db.delete(serversTable).where(eq(serversTable.id, id));
  }
  vi.restoreAllMocks();
});

describe("stopServer", () => {
  it("tears down the process, tunnel, SSE session and bridge", async () => {
    const id = await createServer("ngrok");
    const { rt, childKill, ngrokClose, stdioClose, sseClose, bridgeClose } =
      makeLiveRuntime(id);

    await stopServer(id);

    expect(childKill).toHaveBeenCalledWith("SIGTERM");
    expect(ngrokClose).toHaveBeenCalledTimes(1);
    expect(stdioClose).toHaveBeenCalledTimes(1);
    expect(sseClose).toHaveBeenCalledTimes(1);
    expect(bridgeClose).toHaveBeenCalledTimes(1);

    // No live handles may linger on the runtime after a stop.
    expect(rt.state).toBe<ProcessState>("stopped");
    expect(rt.child).toBeNull();
    expect(rt.ngrokListener).toBeNull();
    expect(rt.stdioTransport).toBeNull();
    expect(rt.activeSse).toBeNull();
    expect(rt.bridge).toBeNull();
    expect(rt.pid).toBeNull();
    expect(rt.healthPoll).toBeNull();
    expect(rt.publicUrl).toBeNull();
    expect(rt.bearerToken).toBeNull();
  });

  it("clears the persisted running flag in the database", async () => {
    const id = await createServer("none");
    await db
      .update(serversTable)
      .set({ running: true })
      .where(eq(serversTable.id, id));
    getRuntime(id).state = "running";

    await stopServer(id);

    const rows = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, id));
    expect(rows[0]?.running).toBe(false);
  });
});

describe("deleteRuntime", () => {
  it("drops the runtime so a fresh one has no orphaned handles", () => {
    const id = -98765; // arbitrary id with no DB row needed
    const original = makeLiveRuntime(id);
    deleteRuntime(id);

    const fresh = getRuntime(id);
    expect(fresh).not.toBe(original.rt);
    expect(fresh.state).toBe<ProcessState>("stopped");
    expect(fresh.child).toBeNull();
    expect(fresh.ngrokListener).toBeNull();
    expect(fresh.stdioTransport).toBeNull();
    // Clean up the interval we created on the orphaned runtime.
    if (original.rt.healthPoll) clearInterval(original.rt.healthPoll);
  });
});

describe("DELETE /api/servers/:id lifecycle", () => {
  function app() {
    const a = express();
    a.use(express.json());
    a.use("/api", serversRouter);
    return a;
  }

  it("stops a running server's process/tunnel before removing it", async () => {
    const id = await createServer("ngrok");
    const { childKill, ngrokClose, stdioClose } = makeLiveRuntime(id);
    const rtBefore = getRuntime(id);

    const res = await request(app()).delete(`/api/servers/${id}`);
    expect(res.status).toBe(204);

    // Runtime was torn down...
    expect(childKill).toHaveBeenCalledWith("SIGTERM");
    expect(ngrokClose).toHaveBeenCalledTimes(1);
    expect(stdioClose).toHaveBeenCalledTimes(1);

    // ...the DB row is gone...
    const rows = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.id, id));
    expect(rows.length).toBe(0);

    // ...and the in-memory runtime was dropped (no lingering orphan): a fresh
    // lookup yields a brand-new, clean runtime object.
    const rtAfter = getRuntime(id);
    expect(rtAfter).not.toBe(rtBefore);
    expect(rtAfter.state).toBe<ProcessState>("stopped");
    expect(rtAfter.child).toBeNull();

    deleteRuntime(id);
  });

  it("returns 404 when deleting a non-existent server", async () => {
    const res = await request(app()).delete(`/api/servers/99999999`);
    expect(res.status).toBe(404);
  });
});
