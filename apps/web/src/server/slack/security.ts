import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { HiveError } from "../errors";

export function verifySlack(
  body: string,
  headers: Headers,
  secret = process.env.SLACK_SIGNING_SECRET,
  now = Date.now(),
) {
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (
    !secret ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function tokenKey() {
  const raw = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
  if (!raw || Buffer.from(raw, "base64").length !== 32)
    throw new HiveError("Slack token encryption is not configured.", 503);
  return Buffer.from(raw, "base64");
}
export function encryptBotToken(
  token: string,
  teamId: string,
  workspaceId: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  cipher.setAAD(Buffer.from(`${teamId}:${workspaceId}`));
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
}
export function decryptBotToken(
  value: string,
  teamId: string,
  workspaceId: string,
) {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext)
    throw new HiveError("Reconnect Slack to restore access.", 503);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    tokenKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAAD(Buffer.from(`${teamId}:${workspaceId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
export function sameOrigin(request: Request) {
  const url = process.env.PUBLIC_URL ?? request.url;
  if (!URL.canParse(url))
    throw new HiveError("Hive settings URL is invalid.", 503);
  const expected = new URL(url).origin;
  if (request.headers.get("origin") !== expected)
    throw new HiveError(
      "Open Slack settings in your hive to make this change.",
      403,
    );
}
