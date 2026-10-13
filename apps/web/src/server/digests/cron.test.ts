import { afterEach, expect, it, vi } from "vitest";
import { authorizedCron } from "@/app/api/cron/slack-digests/route";
afterEach(() => vi.unstubAllEnvs());
it("fails closed for missing and wrong cron secrets", () => {
  vi.stubEnv("CRON_SECRET", "");
  expect(
    authorizedCron(new Request("https://gohive.dev/api/cron/slack-digests")),
  ).toBe(false);
  vi.stubEnv("CRON_SECRET", "synthetic-secret");
  expect(
    authorizedCron(
      new Request("https://gohive.dev", {
        headers: { authorization: "Bearer wrong" },
      }),
    ),
  ).toBe(false);
  expect(
    authorizedCron(
      new Request("https://gohive.dev", {
        headers: { authorization: "Bearer synthetic-secret" },
      }),
    ),
  ).toBe(true);
});
