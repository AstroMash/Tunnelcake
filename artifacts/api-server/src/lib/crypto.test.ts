import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  generateBearerToken,
  timingSafeEqualStr,
} from "./crypto";

describe("crypto encryption round-trip", () => {
  it("encrypts then decrypts back to the original env-var value", () => {
    const plaintext = "super-secret-env-value";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("round-trips auth-token style strings, including unicode and empty", () => {
    const samples = [
      "ngrok_2abcDEF_authtoken",
      "tunnel-api-key-with-symbols-!@#$%^&*()",
      "ключ-密钥-🔑",
      "",
    ];
    for (const sample of samples) {
      expect(decryptSecret(encryptSecret(sample))).toBe(sample);
    }
  });

  it("produces a fresh ciphertext per call (random IV) that still decrypts", () => {
    const plaintext = "repeatable-input";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("marks encrypted values and leaves plaintext unmarked", () => {
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
    expect(isEncrypted("plain text")).toBe(false);
  });

  it("passes through values that are not encrypted (back-compat)", () => {
    expect(decryptSecret("not-encrypted-plaintext")).toBe(
      "not-encrypted-plaintext",
    );
  });

  it("rejects a tampered/malformed encrypted payload", () => {
    const encrypted = encryptSecret("tamper-me");
    const tampered = `${encrypted}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
    expect(() => decryptSecret("enc:v1:onlyonepart")).toThrow(
      /Malformed encrypted value/,
    );
  });
});

describe("generateBearerToken", () => {
  it("returns non-empty, url-safe, unique tokens", () => {
    const a = generateBearerToken();
    const b = generateBearerToken();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("timingSafeEqualStr", () => {
  it("is true only for identical strings", () => {
    expect(timingSafeEqualStr("Bearer abc", "Bearer abc")).toBe(true);
    expect(timingSafeEqualStr("Bearer abc", "Bearer xyz")).toBe(false);
  });

  it("is false for different lengths without throwing", () => {
    expect(timingSafeEqualStr("short", "much-longer-string")).toBe(false);
    expect(timingSafeEqualStr("", "x")).toBe(false);
  });
});
