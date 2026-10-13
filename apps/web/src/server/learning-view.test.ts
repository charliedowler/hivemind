import { expect, it } from "vitest";
import { learningView } from "./learning-view";
it("requires verification for outdated cells even when database time leads the app clock", () => {
  const timestamps = {
    created_at: new Date(),
    updated_at: new Date(),
    last_pushed_at: new Date(),
  };
  const future = new Date(Date.now() + 60000);
  expect(
    learningView({ ...timestamps, lifecycle: "outdated", verify_after: future })
      .verifyBeforeUse,
  ).toBe(true);
  expect(
    learningView({
      ...timestamps,
      lifecycle: "confirmed",
      verify_after: future,
    }).verifyBeforeUse,
  ).toBe(false);
  expect(
    learningView({
      ...timestamps,
      lifecycle: "confirmed",
      verify_after: new Date(Date.now() - 60000),
    }).verifyBeforeUse,
  ).toBe(true);
});
