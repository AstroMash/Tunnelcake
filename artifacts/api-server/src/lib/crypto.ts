import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env["MCP_MASTER_KEY"];
  if (!raw) {
    throw new Error(
      "MCP_MASTER_KEY is not set. Secrets cannot be encrypted or decrypted.",
    );
  }
  // Accept a 64-char hex key directly; otherwise derive a 32-byte key.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, "hex");
  } else {
    cachedKey = crypto.createHash("sha256").update(raw).digest();
  }
  return cachedKey;
}

const PREFIX = "enc:v1:";

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(
      ":",
    )
  );
}

export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) {
    // Backwards/forwards compatibility: treat as plaintext if not encrypted.
    return value;
  }
  const body = value.slice(PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted value.");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function generateBearerToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}
