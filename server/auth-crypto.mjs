import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_ALGO = "scrypt";
const PASSWORD_PARAMS = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024
};

export function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw new Error("Password must be at least 8 characters.");
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(value, salt, PASSWORD_PARAMS.keylen, PASSWORD_PARAMS).toString("base64url");
  return [
    PASSWORD_ALGO,
    PASSWORD_PARAMS.N,
    PASSWORD_PARAMS.r,
    PASSWORD_PARAMS.p,
    salt,
    hash
  ].join("$");
}

export function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_ALGO) return false;

  const [, rawN, rawR, rawP, salt, expected] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expected) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "base64url");
  const actualBuffer = scryptSync(String(password || ""), salt, expectedBuffer.length, {
    N,
    r,
    p,
    maxmem: PASSWORD_PARAMS.maxmem
  });

  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("base64url");
}
