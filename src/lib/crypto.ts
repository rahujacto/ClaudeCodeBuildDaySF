import crypto from "node:crypto";

/**
 * App-level secret encryption (AES-256-GCM).
 *
 * Connection tokens are encrypted with this before they touch the database,
 * and decrypted ONLY in server code (API routes / server actions). The raw
 * token never reaches the browser, a URL, or a log.
 *
 * Production note: a real deployment would move this to a managed KMS
 * (or Supabase Vault / pgsodium). A single env-held key is the
 * hackathon-appropriate version of the same idea.
 */
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must decode to 32 bytes (generate with: openssl rand -base64 32)",
    );
  }
  return key;
}

/** Encrypt a UTF-8 secret. Returns base64(iv | authTag | ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a payload produced by encryptSecret. Throws if tampered. */
export function decryptSecret(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
