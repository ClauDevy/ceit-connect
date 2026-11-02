export function getInitials(name: string | null | undefined, max = 2): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, max)
    .toUpperCase();
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

/** "Oct 16 – Oct 31, 2026": short enough to stay on one line inside a compact card. */
export function formatShortDateRange(start: string, end?: string | null): string {
  const from = parseIsoDate(start);
  if (!from) return start;
  const fromText = `${SHORT_MONTHS[from.month]} ${from.day}`;
  const to = end ? parseIsoDate(end) : null;
  if (!to || (to.year === from.year && to.month === from.month && to.day === from.day)) {
    return `${fromText}, ${from.year}`;
  }
  const toText = `${SHORT_MONTHS[to.month]} ${to.day}`;
  if (to.year === from.year) return `${fromText} – ${toText}, ${from.year}`;
  return `${fromText}, ${from.year} – ${toText}, ${to.year}`;
}
