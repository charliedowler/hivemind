import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
function derive(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      value,
      salt,
      32,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}
export async function hashCode(value: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derive(value, salt)).toString("hex")}`;
}
export async function verifyCode(
  value: string,
  hash: string,
): Promise<boolean> {
  const [salt, expected] = hash.split(":");
  if (
    !/^[a-f0-9]{32}$/.test(salt ?? "") ||
    !/^[a-f0-9]{64}$/.test(expected ?? "")
  )
    return false;
  return timingSafeEqual(
    await derive(value, Buffer.from(salt, "hex")),
    Buffer.from(expected, "hex"),
  );
}
