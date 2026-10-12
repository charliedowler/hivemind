import { z } from "zod";

export const digestScheduleInput = z
  .object({
    channelId: z.string().regex(/^[CG][A-Z0-9]{5,}$/),
    cadence: z.enum(["daily", "weekdays", "weekly", "fortnightly", "monthly"]),
    weekday: z.number().int().min(0).max(6).default(1),
    monthDay: z.number().int().min(1).max(31).default(1),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone."),
    enabled: z.boolean().default(true),
    learnings: z.boolean().default(true),
    insights: z.boolean().default(true),
    friction: z.boolean().default(true),
    decisions: z.boolean().default(true),
    skipEmpty: z.boolean().default(true),
  })
  .refine(
    (s) => s.learnings || s.insights || s.friction || s.decisions,
    "Include at least one section.",
  );
export type DigestScheduleInput = z.infer<typeof digestScheduleInput>;
export type DigestTiming = Pick<
  DigestScheduleInput,
  "cadence" | "weekday" | "monthDay" | "time" | "timezone"
> & { anchor: string };
const minute = 60_000,
  day = 86_400_000;
function parts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const n = (type: string) =>
    Number(values.find((p) => p.type === type)?.value);
  return {
    y: n("year"),
    m: n("month"),
    d: n("day"),
    h: n("hour"),
    min: n("minute"),
  };
}
function wallStamp(date: Date, timezone: string) {
  const p = parts(date, timezone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
}
function localInstant(stamp: number, timezone: string): Date {
  const offsets = new Set(
    [-day, 0, day].map(
      (shift) => wallStamp(new Date(stamp + shift), timezone) - stamp - shift,
    ),
  );
  const candidates = [...offsets]
    .map((offset) => stamp - offset)
    .sort((a, b) => a - b);
  const exact = candidates.find(
    (candidate) => wallStamp(new Date(candidate), timezone) === stamp,
  );
  if (exact !== undefined) return new Date(exact);
  const future = candidates.filter(
    (candidate) => wallStamp(new Date(candidate), timezone) > stamp,
  );
  if (future.length)
    return new Date(
      future.sort(
        (a, b) =>
          wallStamp(new Date(a), timezone) - wallStamp(new Date(b), timezone),
      )[0]!,
    );
  throw new Error("The local schedule time could not be resolved.");
}
export function nextRunAt(schedule: DigestTiming, after: Date): Date {
  const p = parts(after, schedule.timezone);
  const start = Date.UTC(p.y, p.m - 1, p.d);
  const a = parts(new Date(schedule.anchor), schedule.timezone);
  const anchorDate = Date.UTC(a.y, a.m - 1, a.d);
  const anchorWeek =
    anchorDate - ((new Date(anchorDate).getUTCDay() + 6) % 7) * day;
  const [h, min] = schedule.time.split(":").map(Number);
  for (let i = 0; i < 370; i++) {
    const date = new Date(start + i * day),
      weekday = date.getUTCDay();
    const monthlyDay = Math.min(
      schedule.monthDay,
      new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    );
    const fortnight =
      Math.floor((date.getTime() - anchorWeek) / (7 * day)) % 2 === 0;
    const matches =
      schedule.cadence === "daily" ||
      (schedule.cadence === "weekdays" && weekday > 0 && weekday < 6) ||
      (schedule.cadence === "weekly" && weekday === schedule.weekday) ||
      (schedule.cadence === "fortnightly" &&
        weekday === schedule.weekday &&
        fortnight) ||
      (schedule.cadence === "monthly" && date.getUTCDate() === monthlyDay);
    if (!matches) continue;
    const instant = localInstant(
      date.getTime() + h! * 60 * minute + min! * minute,
      schedule.timezone,
    );
    if (instant > after) return instant;
  }
  throw new Error("No next run was found.");
}
