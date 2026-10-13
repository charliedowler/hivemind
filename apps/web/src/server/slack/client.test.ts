import { afterEach, expect, it, vi } from "vitest";
import { postMessage } from "./client";
afterEach(() => vi.unstubAllGlobals());
it("sends a threaded reply with broadcasting explicitly disabled", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ ok: true, ts: "1800000000.002" }));
  vi.stubGlobal("fetch", fetch);
  await postMessage("synthetic", "C123", "No.", "1800000000.001");
  const body = fetch.mock.calls[0][1].body as URLSearchParams;
  expect(body.get("thread_ts")).toBe("1800000000.001");
  expect(body.get("reply_broadcast")).toBe("false");
});
it("rejects a reply without a parent timestamp before calling Slack", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(postMessage("synthetic", "C123", "No.", "")).rejects.toThrow(
    "requires a thread",
  );
  expect(fetch).not.toHaveBeenCalled();
});
