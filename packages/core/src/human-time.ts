export type HumanTimeOptions = { timeZone?: string; now?: Date };
function zone(options: HumanTimeOptions) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: options.timeZone,
    }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
function dateValue(value: string | Date) {
  const date =
    value instanceof Date
      ? value
      : new Date(
          /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value,
        );
  return Number.isFinite(date.getTime()) ? date : null;
}
export function timeZoneLabel(timeZone?: string) {
  const resolved = zone({ timeZone });
  return `${resolved === "UTC" ? "UTC" : resolved.split("/").at(-1)!.replaceAll("_", " ")} time`;
}
export function formatHumanDate(
  value: string | Date,
  options: HumanTimeOptions = {},
) {
  const date = dateValue(value);
  if (!date) return "Unknown date";
  const timeZone =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? "UTC"
      : zone(options);
  const now = options.now ?? new Date();
  const year = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" });
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(year.format(date) !== year.format(now)
      ? { year: "numeric" as const }
      : {}),
  })
    .format(date)
    .replace(/,/g, "");
}
export function formatHumanClock(
  value: string | Date,
  options: HumanTimeOptions = {},
) {
  if (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    const [hour, minute] = value.split(":").map(Number);
    return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${hour < 12 ? "am" : "pm"}`;
  }
  const date = dateValue(value);
  if (!date) return "Unknown time";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone(options),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour") === "0" ? "12" : part("hour")}${part("minute") === "00" ? "" : `:${part("minute")}`}${part("dayPeriod").toLowerCase()}`;
}
export function formatHumanDateTime(
  value: string | Date,
  options: HumanTimeOptions = {},
) {
  return `${formatHumanDate(value, options)} at ${formatHumanClock(value, options)} (${timeZoneLabel(options.timeZone)})`;
}
export function formatRecency(
  value: string | Date,
  options: HumanTimeOptions = {},
) {
  const date = dateValue(value);
  if (!date) return "Unknown date";
  const now = options.now ?? new Date();
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 0) return formatHumanDateTime(value, options);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const calendar = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone(options),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = calendar.formatToParts(now);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const yesterday = new Date(
    Date.UTC(number("year"), number("month") - 1, number("day") - 1, 12),
  );
  const previousDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);
  return calendar.format(date) === previousDay
    ? "yesterday"
    : formatHumanDate(value, options);
}
export function humanizeTimeText(text: string, options: HumanTimeOptions = {}) {
  const convert = (value: string) => {
    const explicitZone =
      /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?\b/.exec(
        value,
      )?.[0];
    const local = { ...options, timeZone: explicitZone ?? options.timeZone };
    return value
      .replace(
        /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g,
        (date) => formatHumanDateTime(date, local),
      )
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => formatHumanDate(date, local))
      .replace(
        /\b(?:[01]\d|2[0-3]):[0-5]\d\b/g,
        (clock) =>
          `${formatHumanClock(clock)}${explicitZone ? "" : ` (${timeZoneLabel(local.timeZone)})`}`,
      )
      .replace(
        /\b(?:Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?\b/g,
        (name) => timeZoneLabel(name),
      );
  };
  return text
    .split(/(<[^>]+>|`[^`]+`|https?:\/\/\S+)/g)
    .map((part) => {
      if (part.startsWith("<")) {
        const split = part.indexOf("|");
        return split < 0
          ? part
          : `${part.slice(0, split + 1)}${convert(part.slice(split + 1, -1))}>`;
      }
      return part.startsWith("`") || /^https?:\/\//.test(part)
        ? part
        : convert(part);
    })
    .join("");
}
