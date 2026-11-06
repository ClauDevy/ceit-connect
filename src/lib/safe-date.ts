/**
 * Date text that can never crash a page. Some saved dates cannot be read by the browser
 * (for example a year typed with extra digits), and `Intl.DateTimeFormat.format` throws
 * "RangeError: Invalid time value" for them, which used to take the whole page down.
 */
export function formatDateSafe(
  formatter: Intl.DateTimeFormat,
  value: string | null | undefined,
  fallback = "Date unavailable",
): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : formatter.format(date);
}

/** "Due Oct 18", "No deadline" when there is none, or "Due date unavailable" when unreadable. */
export function formatDueLabel(
  formatter: Intl.DateTimeFormat,
  value: string | null | undefined,
): string {
  if (!value) return "No deadline";
  const text = formatDateSafe(formatter, value, "");
  return text ? `Due ${text}` : "Due date unavailable";
}
