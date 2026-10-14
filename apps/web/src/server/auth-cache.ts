import { createHash } from "node:crypto";

// Bearer requests repeat within seconds (initialize, notifications/initialized, tools/call; hook runs), and each
// one used to re-read the credential, membership and cutover epoch. Successful lookups are kept per process for
// at most AUTH_CACHE_TTL_MS, so a credential or membership revoked elsewhere stops working within that window.
// Revocations made in this process clear the cache straight away through forgetCachedAuth().
export const AUTH_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 1_000;

const entries = new Map<string, { value: unknown; expiresAt: number }>();
let generation = 0;

export function authCacheKey(kind: string, secret: string) {
  return `${kind}:${createHash("sha256").update(secret).digest("hex")}`;
}

export function forgetCachedAuth() {
  generation++;
  entries.clear();
}

function prune(now: number) {
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
}

// Failed lookups (null) are never cached, so a new key or membership works on its first request.
export async function cachedAuth<T>(key: string, load: () => Promise<T | null>, notAfterMs = Infinity): Promise<T | null> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  if (hit) entries.delete(key);
  const loadedIn = generation;
  const value = await load();
  const expiresAt = Math.min(Date.now() + AUTH_CACHE_TTL_MS, notAfterMs);
  if (value !== null && loadedIn === generation && expiresAt > Date.now()) {
    if (entries.size >= MAX_ENTRIES) prune(Date.now());
    entries.set(key, { value, expiresAt });
  }
  return value;
}
