import type { DigestScheduleInput } from "./digest-schedule";
export function digestTime(
  value: string | Date,
  timezone: string,
  options: {
    mode?: "date" | "datetime" | "clock";
    now?: Date;
    relative?: boolean;
  } = {},
) {
  const mode = options.mode ?? "datetime",
    now = options.now ?? new Date();
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = (d: Date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
  const p = parts(date),
    n = parts(now);
  const clock = `${Number(p.hour)}${p.minute === "00" ? "" : `:${p.minute}`}${p.dayPeriod.toLowerCase()}`;
  if (mode === "clock") return clock;
  let day = `${p.weekday} ${p.day} ${p.month}${p.year !== n.year ? ` ${p.year}` : ""}`;
  if (options.relative && mode !== "date") {
    const calendar = (d: Date) =>
      Object.fromEntries(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          year: "numeric",
          month: "numeric",
          day: "numeric",
        })
          .formatToParts(d)
          .map((p) => [p.type, p.value]),
      );
    const current = calendar(now),
      target = calendar(date);
    const ordinal = (p: Record<string, string>) =>
      Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
    if (ordinal(target) === ordinal(current)) day = "today";
    else if (ordinal(target) === ordinal(current) + 86400000) day = "tomorrow";
  }
  return mode === "date" ? day : `${day} at ${clock}`;
}
export function digestZone(timezone: string) {
  if (timezone === "UTC" || timezone === "Etc/UTC") return "UTC";
  return `${timezone.split("/").at(-1)!.replaceAll("_", " ")} time`;
}
export function digestCadence(schedule: DigestScheduleInput) {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const cadence =
    schedule.cadence === "weekly"
      ? `Every ${days[schedule.weekday]}`
      : schedule.cadence === "fortnightly"
        ? `Every other ${days[schedule.weekday]}`
        : schedule.cadence === "monthly"
          ? `Monthly on day ${schedule.monthDay}`
          : schedule.cadence === "weekdays"
            ? "Every weekday"
            : "Every day";
  const [hour, minute] = schedule.time.split(":");
  const clock = digestTime(
    new Date(Date.UTC(2000, 0, 1, Number(hour), Number(minute))),
    "UTC",
    { mode: "clock" },
  );
  return `${cadence} at ${clock}`;
}
