import { it, expect } from "vitest";
import { slackToolReply } from "./reply";
it("formats sibling tool timestamps and removes legacy undo hints", () => {
  const result = slackToolReply(
    "Schedule saved. Next: 2026-10-19T08:00:00.000Z. Reply undo to pause this schedule within an hour.",
    { timeZone: "Europe/London" },
  );
  expect(result).toBe(
    "Schedule saved. Next: Monday 19 October at 9am (London time).",
  );
  expect(
    slackToolReply("<https://gohive.dev/2026-10-19|Cell dated 2026-10-19>", {}),
  ).toBe("<https://gohive.dev/2026-10-19|Cell dated Monday 19 October>");
});
