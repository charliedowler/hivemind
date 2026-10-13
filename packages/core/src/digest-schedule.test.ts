import { describe, expect, it } from "vitest";
import {
  nextRunAt,
  digestScheduleInput,
  type DigestTiming,
} from "./digest-schedule";
const timing = (patch: Partial<DigestTiming> = {}): DigestTiming => ({
  cadence: "daily",
  weekday: 1,
  monthDay: 31,
  time: "09:00",
  timezone: "Europe/London",
  anchor: "2026-10-12T00:00:00Z",
  ...patch,
});
const next = (after: string, patch: Partial<DigestTiming> = {}) =>
  nextRunAt(timing(patch), new Date(after)).toISOString();
describe("local digest slots", () => {
  it("keeps London wall time across spring and autumn DST", () => {
    expect(next("2026-03-28T09:00:00Z")).toBe("2026-03-29T08:00:00.000Z");
    expect(next("2026-10-24T08:00:00Z")).toBe("2026-10-25T09:00:00.000Z");
  });
  it("keeps Los Angeles wall time across DST", () => {
    expect(
      next("2026-03-07T17:00:00Z", { timezone: "America/Los_Angeles" }),
    ).toBe("2026-03-08T16:00:00.000Z");
    expect(
      next("2026-10-31T16:00:00Z", { timezone: "America/Los_Angeles" }),
    ).toBe("2026-11-01T17:00:00.000Z");
  });
  it("shifts a missing time through the spring gap", () => {
    expect(next("2026-03-28T02:00:00Z", { time: "01:30" })).toBe(
      "2026-03-29T01:30:00.000Z",
    );
    expect(
      next("2026-03-07T12:00:00Z", {
        timezone: "America/Los_Angeles",
        time: "02:30",
      }),
    ).toBe("2026-03-08T10:30:00.000Z");
  });
  it("uses the first repeated time and never runs its second occurrence", () => {
    expect(next("2026-10-24T12:00:00Z", { time: "01:30" })).toBe(
      "2026-10-25T00:30:00.000Z",
    );
    expect(next("2026-10-25T00:30:00Z", { time: "01:30" })).toBe(
      "2026-10-26T01:30:00.000Z",
    );
  });
  it("clamps month ends, including leap years", () => {
    expect(next("2026-01-31T09:00:00Z", { cadence: "monthly" })).toBe(
      "2026-02-28T09:00:00.000Z",
    );
    expect(next("2028-01-31T09:00:00Z", { cadence: "monthly" })).toBe(
      "2028-02-29T09:00:00.000Z",
    );
  });
  it("skips weekends and supports chosen weekly days", () => {
    expect(next("2026-10-16T08:00:00Z", { cadence: "weekdays" })).toBe(
      "2026-10-19T08:00:00.000Z",
    );
    expect(
      next("2026-10-13T12:00:00Z", { cadence: "weekly", weekday: 5 }),
    ).toBe("2026-10-16T08:00:00.000Z");
  });
  it("anchors fortnightly schedules even after manual posts", () => {
    expect(next("2026-10-12T08:00:00Z", { cadence: "fortnightly" })).toBe(
      "2026-10-26T09:00:00.000Z",
    );
    expect(next("2026-10-14T11:00:00Z", { cadence: "fortnightly" })).toBe(
      "2026-10-26T09:00:00.000Z",
    );
  });
  it("rejects invalid fields and an empty section selection", () => {
    expect(
      digestScheduleInput.safeParse({
        channelId: "C123456",
        ...timing(),
        time: "24:00",
      }).success,
    ).toBe(false);
    expect(
      digestScheduleInput.safeParse({
        channelId: "C123456",
        ...timing(),
        timezone: "bad/zone",
      }).success,
    ).toBe(false);
  });
});
