import { getSql } from "../db/client";
import { hashToken } from "../db/ids";
import { HiveError } from "../errors";
export async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  seconds: number,
): Promise<void> {
  const bucket = `${scope}:${hashToken(identity)}`;
  const rows =
    await getSql()`INSERT INTO rate_limits (bucket, window_start, count) VALUES (${bucket}, now(), 1) ON CONFLICT (bucket) DO UPDATE SET count = CASE WHEN rate_limits.window_start < now() - ${seconds} * interval '1 second' THEN 1 ELSE rate_limits.count + 1 END, window_start = CASE WHEN rate_limits.window_start < now() - ${seconds} * interval '1 second' THEN now() ELSE rate_limits.window_start END RETURNING count`;
  if (rows[0].count > limit)
    throw new HiveError("Too many attempts. Please try later.", 429);
}

export async function joinPhraseRateLimit(ownerId: string, trustedProxyIp: string | null): Promise<void> {
  const attempts = await Promise.allSettled([
    rateLimit("join-phrase-owner", ownerId, 5, 60),
    rateLimit("join-phrase-ip", trustedProxyIp || "unavailable", 30, 60),
    rateLimit("join-phrase-global", "all", 1000, 60),
  ]);
  if (attempts.some(attempt => attempt.status === "rejected")) throw new HiveError("This hive could not be joined. Try again later.", 429);
}
