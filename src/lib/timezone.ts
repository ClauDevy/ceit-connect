export const APP_TIME_ZONE = {
  iana: "Asia/Manila",
  utcOffset: "+08:00",
} as const;

const appDateTimeParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE.iana,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function toAppTimestamp(date: string, time: string) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00${APP_TIME_ZONE.utcOffset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function splitAppTimestamp(value: string | null) {
  if (!value) return { date: "", time: "" };

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Map(
    appDateTimeParts
      .formatToParts(parsed)
      .map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`,
    time: `${parts.get("hour")}:${parts.get("minute")}`,
  };
}
