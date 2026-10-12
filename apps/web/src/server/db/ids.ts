import { createHash, randomBytes } from "node:crypto";
const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
export function randomBase32(length: number): string {
  return [...randomBytes(length)].map((byte) => alphabet[byte & 31]).join("");
}
export function newId(prefix: string): string { return `${prefix}_${randomBase32(12)}`; }
export function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function newToken(): string { return randomBytes(32).toString("base64url"); }
