import { expect, it } from "vitest";
import { GET } from "./route";
import { cliVersion } from "@/lib/cli-version";

it("advertises the released installer without authentication and caches its tiny response", async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
  expect(await response.json()).toEqual({ latest: "0.2.1", minimum: "0.2.0" });
  expect(cliVersion.latest).toBe("0.2.1");
});
