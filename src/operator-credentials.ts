import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const sessionLifetime = 30 * 60 * 1000;
export const emailPattern = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/;
export const sessionPattern = /^tfos_[A-Za-z0-9_-]{43}$/;
export const invitationPattern = /^tfoi_[A-Za-z0-9_-]{43}$/;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const credential = (prefix: "tfos" | "tfoi") => `${prefix}_${randomBytes(32).toString("base64url")}`;
const dummy = "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128);
let hashing = 0;
export class AuthenticationBusy extends Error {}
async function derive(value: string, salt: string): Promise<Buffer> {
  if (hashing >= 2) throw new AuthenticationBusy("Authentication is busy.");
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(value, salt, 64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key)));
  } finally { hashing--; }
}
export async function hashPassword(value: string): Promise<string> {
  if (value.length < 12 || value.length > 128) throw new Error("Use a password with 12 to 128 characters.");
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${(await derive(value, salt)).toString("hex")}`;
}
export async function verifyPassword(value: string, stored: string | null): Promise<boolean> {
  const valid = stored !== null && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored);
  const [,salt,key] = (valid ? stored! : dummy).split("$");
  const actual = await derive(value, salt);
  return timingSafeEqual(actual, Buffer.from(key, "hex")) && valid;
}
