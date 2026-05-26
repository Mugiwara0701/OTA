"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Derive a 32-byte key from the JWT secret (avoids needing a separate env var)
// In production, prefer a dedicated ENCRYPTION_KEY env var
function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!raw)
    throw new Error("[Crypto] ENCRYPTION_KEY or JWT_SECRET must be set");
  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plain-text string.
 * Returns a colon-delimited string: iv:authTag:ciphertext (all hex)
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a colon-delimited string produced by encrypt().
 */
function decrypt(ciphertext) {
  if (!ciphertext) return null;
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) return null;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

module.exports = { encrypt, decrypt };
