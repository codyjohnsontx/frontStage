import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for integration tokens at rest. The key comes from
 * the INTEGRATION_TOKEN_KEY environment variable (32 bytes, base64) — never
 * from the database. Format: base64(iv).base64(ciphertext).base64(authTag).
 */

export function encryptToken(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_TOKEN_KEY must be 32 bytes (base64)");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${ciphertext.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
}

export function decryptToken(encrypted: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_TOKEN_KEY must be 32 bytes (base64)");
  const [ivB64, dataB64, tagB64] = encrypted.split(".");
  if (!ivB64 || !dataB64 || !tagB64) throw new Error("Malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
