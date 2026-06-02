import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, serversTable, ngrokConfigsTable } from "@workspace/db";
import { requireServerBearer, type SseRequest } from "./sseAuth";

const createdServerIds: number[] = [];
const BEARER = "the-correct-bearer-token";

// Mirror the ngrok bridge: a route guarded by requireServerBearer that only
// runs its handler once the per-server bearer token is verified.
function app() {
  const a = express();
  a.use(express.json());
  a.get("/api/servers/:id/sse", requireServerBearer, (req, res) => {
    res.json({ ok: true, serverId: (req as SseRequest).serverId });
  });
  return a;
}

async function createServerWithBearer(token: string | null): Promise<number> {
  const inserted = await db
    .insert(serversTable)
    .values({
      name: `sseauth-test-${Date.now()}-${Math.random()}`,
      command: "echo",
      args: [],
      connectionMode: "ngrok",
    })
    .returning();
  const id = inserted[0]!.id;
  createdServerIds.push(id);
  if (token !== null) {
    await db
      .insert(ngrokConfigsTable)
      .values({ serverId: id, bearerToken: token });
  }
  return id;
}

afterEach(async () => {
  for (const id of createdServerIds.splice(0)) {
    await db.delete(serversTable).where(eq(serversTable.id, id));
  }
});

describe("requireServerBearer (ngrok bridge auth)", () => {
  it("rejects requests with no Authorization header", async () => {
    const id = await createServerWithBearer(BEARER);
    const res = await request(app()).get(`/api/servers/${id}/sse`);
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const id = await createServerWithBearer(BEARER);
    const res = await request(app())
      .get(`/api/servers/${id}/sse`)
      .set("Authorization", "Bearer not-the-right-token");
    expect(res.status).toBe(401);
  });

  it("rejects a bare token without the Bearer scheme", async () => {
    const id = await createServerWithBearer(BEARER);
    const res = await request(app())
      .get(`/api/servers/${id}/sse`)
      .set("Authorization", BEARER);
    expect(res.status).toBe(401);
  });

  it("accepts the correct bearer token and exposes the serverId", async () => {
    const id = await createServerWithBearer(BEARER);
    const res = await request(app())
      .get(`/api/servers/${id}/sse`)
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, serverId: id });
  });

  it("rejects when the server has no ngrok config / bearer token", async () => {
    const id = await createServerWithBearer(null);
    const res = await request(app())
      .get(`/api/servers/${id}/sse`)
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(401);
  });
});
