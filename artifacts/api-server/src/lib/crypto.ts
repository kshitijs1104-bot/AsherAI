import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// OAuth refresh/access tokens are the one thing in this schema that's an
// actual credential, not just business data — connectors.oauthTokenRef gets
// this applied before it ever touches the DB. AES-256-GCM with a random
// 12-byte IV per encryption (prepended to the ciphertext, GCM auth tag
// appended) so the same plaintext never produces the same stored value twice.
//
// Fails closed: no CONNECTOR_ENCRYPTION_KEY means encrypt()/decrypt() throw
// rather than silently falling back to storing tokens in plaintext.
function getKey(): Buffer {
  const raw = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CONNECTOR_ENCRYPTION_KEY must be set (32-byte value, hex or base64) — required before any OAuth token can be stored or read.",
    );
  }
  const key = raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256) — got " + key.length);
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptToken(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
