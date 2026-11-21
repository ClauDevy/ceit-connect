// Presentation-only helpers: group already-loaded Activity Log rows by Manila calendar day
// so the list can show "Today", "Yesterday" and dated headings. Nothing here changes
// ordering, filtering, paging, or what the reader returns.

const MANILA = "Asia/Manila";
const DAY_MS = 24 * 60 * 60 * 1000;

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: MANILA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const shortDay = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const shortDayWithYear = new Intl.DateTimeFormat("en-PH", {
  timeZone: MANILA,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function manilaDayKey(value: Date | string) {
  return dayKeyFormat.format(typeof value === "string" ? new Date(value) : value);
}

export type ActivityDayHeading = {
  /** Big label: "Today", "Yesterday", or "Wed, Nov 18". */
  title: string;
  /** Quiet extra label, only for Today and Yesterday: "Fri, Nov 20". */
  subtitle: string | null;
};

export function activityDayHeading(key: string, now: Date = new Date()): ActivityDayHeading {
  const anchor = new Date(`${key}T12:00:00+08:00`);
  const todayKey = manilaDayKey(now);
  const yesterdayKey = manilaDayKey(new Date(now.getTime() - DAY_MS));
  if (key === todayKey) return { title: "Today", subtitle: shortDay.format(anchor) };
  if (key === yesterdayKey) return { title: "Yesterday", subtitle: shortDay.format(anchor) };
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  return {
    title: (sameYear ? shortDay : shortDayWithYear).format(anchor),
    subtitle: null,
  };
}

export type ActivityDayGroup<T> = {
  key: string;
  heading: ActivityDayHeading;
  rows: T[];
};

/** Keeps the incoming order; starts a new group whenever the Manila day changes. */
export function groupActivityByDay<T extends { activityCreatedAt: string }>(
  rows: readonly T[],
  now: Date = new Date(),
): ActivityDayGroup<T>[] {
  const groups: ActivityDayGroup<T>[] = [];
  for (const row of rows) {
    const key = manilaDayKey(row.activityCreatedAt);
    const last = groups.at(-1);
    if (last && last.key === key) {
      last.rows.push(row);
    } else {
      groups.push({ key, heading: activityDayHeading(key, now), rows: [row] });
    }
  }
  return groups;
}
