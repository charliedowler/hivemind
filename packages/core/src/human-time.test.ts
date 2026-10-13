import { describe, it, expect } from "vitest";
import {
  formatHumanDate,
  formatHumanClock,
  formatHumanDateTime,
  formatRecency,
  timeZoneLabel,
} from "./human-time";
const options = {
  timeZone: "Europe/London",
  now: new Date("2026-10-13T12:00:00Z"),
};
describe("Human time formatting", () => {
  it("uses weekday and day-month dates", () =>
    expect(formatHumanDate("2026-10-19", options)).toBe("Monday 19 October"));
  it("uses 9am clocks and the target zone", () =>
    expect(formatHumanDateTime("2026-10-19T08:00:00.000Z", options)).toBe(
      "Monday 19 October at 9am (London time)",
    ));
  it("handles summer and winter time", () =>
    expect(formatHumanDateTime("2026-12-07T09:00:00Z", options)).toBe(
      "Monday 7 December at 9am (London time)",
    ));
  it("formats local form clocks without a zone conversion", () => {
    expect(formatHumanClock("09:00")).toBe("9am");
    expect(formatHumanClock("00:30")).toBe("12:30am");
    expect(formatHumanClock("13:05")).toBe("1:05pm");
  });
  it("uses human recency", () => {
    expect(formatRecency("2026-10-13T10:00:00Z", options)).toBe("2 hours ago");
    expect(formatRecency("2026-10-12T10:00:00Z", options)).toBe("yesterday");
  });
  it("retains the year for older dates and validates zones", () => {
    expect(formatHumanDate("2025-10-12", options)).toBe(
      "Sunday 12 October 2025",
    );
    expect(timeZoneLabel("invalid")).toBe("UTC time");
    expect(timeZoneLabel("America/New_York")).toBe("New York time");
  });
  it("handles invalid input without showing raw dates", () =>
    expect(formatHumanDate("invalid")).toBe("Unknown date"));
  it("uses the previous calendar day across daylight-saving changes", () => {
    const spring = {
      timeZone: "Europe/London",
      now: new Date("2026-03-29T23:30:00Z"),
    };
    expect(formatRecency("2026-03-28T23:00:00Z", spring)).toBe(
      "Saturday 28 March",
    );
  });
});
