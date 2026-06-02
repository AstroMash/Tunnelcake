import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  serversTable,
  tunnelConfigsTable,
  ngrokConfigsTable,
} from "@workspace/db";
import { decryptSecret } from "../lib/crypto";
import connectionRouter from "./connection";

const createdServerIds: number[] = [];

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", connectionRouter);
  return a;
}

async function createServer(): Promise<number> {
  const inserted = await db
    .insert(serversTable)
    .values({
      name: `security-test-${Date.now()}-${Math.random()}`,
      command: "echo",
      args: [],
      connectionMode: "none",
    })
    .returning();
  const id = inserted[0]!.id;
  createdServerIds.push(id);
  return id;
}

afterEach(async () => {
  for (const id of createdServerIds.splice(0)) {
    // Configs cascade-delete with the server row.
    await db.delete(serversTable).where(eq(serversTable.id, id));
  }
});

describe("tunnel config endpoints never expose the API key", () => {
  const PLAINTEXT_KEY = "tunnel-plaintext-api-key-do-not-leak";

  it("PUT then GET returns hasApiKey boolean and no plaintext", async () => {
    const id = await createServer();

    const putRes = await request(app())
      .put(`/api/servers/${id}/tunnel`)
      .send({ tunnelId: "tnl_123", apiKey: PLAINTEXT_KEY });
    expect(putRes.status).toBe(200);
    expect(putRes.body).toMatchObject({ hasApiKey: true, tunnelId: "tnl_123" });
    expect(putRes.body).not.toHaveProperty("apiKey");
    expect(JSON.stringify(putRes.body)).not.toContain(PLAINTEXT_KEY);

    const getRes = await request(app()).get(`/api/servers/${id}/tunnel`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.hasApiKey).toBe(true);
    expect(getRes.body).not.toHaveProperty("apiKey");
    expect(JSON.stringify(getRes.body)).not.toContain(PLAINTEXT_KEY);
  });

  it("persists the API key encrypted at rest and round-trips on decrypt", async () => {
    const id = await createServer();
    await request(app())
      .put(`/api/servers/${id}/tunnel`)
      .send({ tunnelId: "tnl_456", apiKey: PLAINTEXT_KEY });

    const rows = await db
      .select()
      .from(tunnelConfigsTable)
      .where(eq(tunnelConfigsTable.serverId, id));
    const stored = rows[0]!.apiKey!;
    expect(stored).not.toBe(PLAINTEXT_KEY);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(stored)).toBe(PLAINTEXT_KEY);
  });
});

describe("ngrok config endpoints never expose the auth token", () => {
  const PLAINTEXT_TOKEN = "ngrok-plaintext-auth-token-do-not-leak";

  it("PUT then GET returns hasAuthToken boolean and no plaintext", async () => {
    const id = await createServer();

    const putRes = await request(app())
      .put(`/api/servers/${id}/ngrok`)
      .send({ authToken: PLAINTEXT_TOKEN });
    expect(putRes.status).toBe(200);
    expect(putRes.body.hasAuthToken).toBe(true);
    expect(putRes.body).not.toHaveProperty("authToken");
    expect(JSON.stringify(putRes.body)).not.toContain(PLAINTEXT_TOKEN);
    // The bearer token is intentionally surfaced (the user pastes it into the
    // connector), but the secret ngrok auth token must never be.
    expect(typeof putRes.body.bearerToken).toBe("string");

    const getRes = await request(app()).get(`/api/servers/${id}/ngrok`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.hasAuthToken).toBe(true);
    expect(getRes.body).not.toHaveProperty("authToken");
    expect(JSON.stringify(getRes.body)).not.toContain(PLAINTEXT_TOKEN);
  });

  it("persists the auth token encrypted at rest and round-trips on decrypt", async () => {
    const id = await createServer();
    await request(app())
      .put(`/api/servers/${id}/ngrok`)
      .send({ authToken: PLAINTEXT_TOKEN });

    const rows = await db
      .select()
      .from(ngrokConfigsTable)
      .where(eq(ngrokConfigsTable.serverId, id));
    const stored = rows[0]!.authToken!;
    expect(stored).not.toBe(PLAINTEXT_TOKEN);
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(stored)).toBe(PLAINTEXT_TOKEN);
  });
});
