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
    throw new HiveError("Too many attempts. Try later.", 429);
}
