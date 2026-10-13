import { expect, it } from "vitest";
import { digestTime, digestZone, digestCadence } from "./human-time";
it("formats wall-clock times, weekdays, dates and human zone labels", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  expect(digestTime("2026-10-19T08:00:00Z", "Europe/London", { now })).toBe(
    "Monday 19 October at 9am",
  );
  expect(
    digestTime("2026-10-14T16:30:00Z", "Europe/London", {
      now,
      relative: true,
    }),
  ).toBe("tomorrow at 5:30pm");
  expect(
    digestTime("2026-10-13T16:00:00Z", "Europe/London", {
      now,
      relative: true,
    }),
  ).toBe("today at 5pm");
  expect(
    digestTime("2027-01-01T17:00:00Z", "America/Los_Angeles", { now }),
  ).toBe("Friday 1 January 2027 at 9am");
  expect(digestZone("Europe/London")).toBe("London time");
  expect(digestZone("America/Los_Angeles")).toBe("Los Angeles time");
  expect(digestZone("UTC")).toBe("UTC");
  expect(
    digestCadence({ cadence: "weekly", weekday: 1, time: "09:00" } as never),
  ).toBe("Every Monday at 9am");
});
it("uses the schedule zone across midnight and daylight-saving changes", () => {
  const now = new Date("2026-03-28T23:30:00Z");
  expect(
    digestTime("2026-03-29T08:00:00Z", "Europe/London", {
      now,
      relative: true,
    }),
  ).toBe("tomorrow at 9am");
  expect(
    digestTime("2026-10-13T00:30:00Z", "America/Los_Angeles", {
      now: new Date("2026-10-13T00:00:00Z"),
      relative: true,
    }),
  ).toBe("today at 5:30pm");
});
