import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_CACHE_TTL_MS, authCacheKey, cachedAuth, forgetCachedAuth } from "./auth-cache";

afterEach(() => {
  forgetCachedAuth();
  vi.useRealTimers();
});

describe("auth cache", () => {
  it("reuses a successful lookup only within the TTL", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ memberId: "mem_a" }));
    await cachedAuth("k", load);
    vi.advanceTimersByTime(AUTH_CACHE_TTL_MS - 1);
    await cachedAuth("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await cachedAuth("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never caches a refusal, so a new credential works on its first retry", async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ ok: true });
    expect(await cachedAuth("k", load)).toBeNull();
    expect(await cachedAuth("k", load)).toEqual({ ok: true });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("drops everything on an in-process revocation, including lookups in flight", async () => {
    const load = vi.fn(async () => true);
    await cachedAuth("k", load);
    forgetCachedAuth();
    await cachedAuth("k", load);
    expect(load).toHaveBeenCalledTimes(2);
    let finish!: (value: boolean) => void;
    const racing = cachedAuth("race", () => new Promise<boolean>((resolve) => (finish = resolve)));
    forgetCachedAuth();
    finish(true);
    await racing;
    const reload = vi.fn(async () => true);
    await cachedAuth("race", reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never outlives the credential's own expiry", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => true);
    await cachedAuth("k", load, Date.now() + 1000);
    vi.advanceTimersByTime(1000);
    await cachedAuth("k", load, Date.now() + 1000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keys by a digest, never by the raw credential", () => {
    const key = authCacheKey("key", "hm_secret");
    expect(key).toMatch(/^key:[0-9a-f]{64}$/);
    expect(key).not.toContain("secret");
  });
});
