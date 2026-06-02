import crypto from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function deriveKey(raw: string): Buffer {
  // Accept a 64-char hex key directly; otherwise derive a 32-byte key.
  return /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : crypto.createHash("sha256").update(raw).digest();
}

function keyFilePath(): string {
  const dir =
    process.env["MCP_DATA_DIR"] ??
    path.join(homedir(), ".mcp-server-manager");
  return path.join(dir, "master.key");
}

// When no MCP_MASTER_KEY env var is provided, the key is generated once and
// persisted to a local, non-source-controlled file with owner-only perms.
// This keeps the encryption-at-rest key out of any tracked config.
function loadOrCreateKeyFile(): Buffer {
  const file = keyFilePath();
  if (existsSync(file)) {
    return deriveKey(readFileSync(file, "utf8").trim());
  }
  const key = crypto.randomBytes(32);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  return key;
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env["MCP_MASTER_KEY"];
  cachedKey = raw ? deriveKey(raw) : loadOrCreateKeyFile();
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

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
