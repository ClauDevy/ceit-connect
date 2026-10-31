import { isCanonicalUuid } from "@/lib/uuid";

export const MAX_EVENTS_PER_DELETION = 10;
export const EVENT_MANAGEMENT_PAGE_SIZE = 10;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type EventDeletionListItem = {
  id: string;
  name: string;
  start_date: string | null;
  status: "Draft" | "Archived";
  updated_at: string;
};

export type EventDeletionEntry = {
  id: string;
  expectedUpdatedAt: string;
};

export type EventDeletionRequest = {
  events: EventDeletionEntry[];
  confirmation: string;
};

export type EventDeletionResult = {
  eventId: string;
  eventName: string | null;
  deletion: "done" | "failed";
  cleanup: "done" | "pending" | "failed";
  cleanupWarning: boolean;
  message: string;
};

export type EventDeletionSelection = Map<string, EventDeletionListItem>;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseEventDeletionRequest(value: unknown): EventDeletionRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!hasExactKeys(body, ["events", "confirmation"])) return null;
  if (
    !Array.isArray(body.events) ||
    body.events.length === 0 ||
    body.events.length > MAX_EVENTS_PER_DELETION ||
    typeof body.confirmation !== "string" ||
    body.confirmation.length > 300
  ) {
    return null;
  }

  const seen = new Set<string>();
  const events: EventDeletionEntry[] = [];
  for (const value of body.events) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (!hasExactKeys(entry, ["id", "expectedUpdatedAt"])) return null;
    if (!isCanonicalUuid(entry.id) || typeof entry.expectedUpdatedAt !== "string") return null;
    if (!TIMESTAMP_PATTERN.test(entry.expectedUpdatedAt)) return null;
    const normalizedId = entry.id.toLowerCase();
    if (seen.has(normalizedId)) return null;
    seen.add(normalizedId);
    events.push({ id: entry.id, expectedUpdatedAt: entry.expectedUpdatedAt });
  }

  return { events, confirmation: body.confirmation };
}

export function requiredDeletionConfirmation(
  events: readonly Pick<EventDeletionListItem, "name">[],
) {
  if (events.length === 1) return events[0].name;
  return `DELETE ${events.length} EVENTS`;
}

export function eventYear(startDate: string | null) {
  if (!startDate) return null;
  const match = DATE_PATTERN.exec(startDate);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Number(match[1]);
}

export function eventDeletionYears(events: readonly Pick<EventDeletionListItem, "start_date">[]) {
  return Array.from(
    new Set(events.map((event) => eventYear(event.start_date)).filter((year): year is number => year !== null)),
  ).sort((a, b) => b - a);
}

export function filterEventsByYear<T extends Pick<EventDeletionListItem, "start_date">>(
  events: readonly T[],
  year: "all" | number,
) {
  if (year === "all") return [...events];
  return events.filter((event) => eventYear(event.start_date) === year);
}

export function toggleEventSelection(
  selection: ReadonlyMap<string, EventDeletionListItem>,
  event: EventDeletionListItem,
) {
  const selected = new Map(selection);
  if (selected.has(event.id)) {
    selected.delete(event.id);
    return { selected, limited: false };
  }
  if (selected.size >= MAX_EVENTS_PER_DELETION) {
    return { selected, limited: true };
  }
  selected.set(event.id, { ...event });
  return { selected, limited: false };
}

export function toggleEventPageSelection(
  pageEvents: readonly EventDeletionListItem[],
  selection: ReadonlyMap<string, EventDeletionListItem>,
) {
  const allPageSelected =
    pageEvents.length > 0 && pageEvents.every((event) => selection.has(event.id));
  const selected = new Map(selection);
  if (allPageSelected) {
    for (const event of pageEvents) selected.delete(event.id);
    return { selected, limited: false, added: 0 };
  }

  let added = 0;
  let limited = false;
  for (const event of pageEvents) {
    if (selected.has(event.id)) continue;
    if (selected.size >= MAX_EVENTS_PER_DELETION) {
      limited = true;
      continue;
    }
    selected.set(event.id, { ...event });
    added += 1;
  }
  return { selected, limited, added };
}

export function eventPageSelectionState(
  pageEvents: readonly Pick<EventDeletionListItem, "id">[],
  selection: ReadonlyMap<string, EventDeletionListItem>,
) {
  const selectedCount = pageEvents.filter((event) => selection.has(event.id)).length;
  return {
    checked: pageEvents.length > 0 && selectedCount === pageEvents.length,
    indeterminate: selectedCount > 0 && selectedCount < pageEvents.length,
  };
}

export function eventSelectionCapHint(added: number, limited: boolean) {
  if (!limited) return null;
  if (added > 0) {
    return `Only ${added} ${added === 1 ? "event was" : "events were"} selected from this page because you can delete at most 10 at once.`;
  }
  return "You can delete at most 10 events at once.";
}

export function failedEventSelection(
  selection: ReadonlyMap<string, EventDeletionListItem>,
  results: readonly EventDeletionResult[],
) {
  const failedIds = new Set(
    results.filter((result) => result.deletion === "failed").map((result) => result.eventId),
  );
  return new Map(Array.from(selection).filter(([id]) => failedIds.has(id)));
}

export function reconcileEventSelection(
  selection: ReadonlyMap<string, EventDeletionListItem>,
  events: readonly Pick<EventDeletionListItem, "id">[],
) {
  const available = new Set(events.map((event) => event.id));
  return new Map(Array.from(selection).filter(([id]) => available.has(id)));
}

export function snapshotEventDeletionSelection(
  selection: ReadonlyMap<string, EventDeletionListItem>,
) {
  return Array.from(selection.values(), (event) => ({ ...event }));
}

export function eventManagementPageSlice<T>(
  events: readonly T[],
  requestedPage: number,
  pageSize = EVENT_MANAGEMENT_PAGE_SIZE,
) {
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize));
  const page = Math.min(Math.max(Math.floor(requestedPage) || 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: events.slice(start, start + pageSize),
    page,
    totalPages,
  };
}

export function resetEventManagementFilter(year: "all" | number) {
  return {
    year,
    page: 1,
    selection: new Map<string, EventDeletionListItem>(),
  };
}

export function shouldToggleEventRowSelection({
  clickedSelectionControl,
  hasSelectedText,
}: {
  clickedSelectionControl: boolean;
  hasSelectedText: boolean;
}) {
  return !clickedSelectionControl && !hasSelectedText;
}

export function deletionErrorMessage(code: string | undefined) {
  const messages: Record<string, string> = {
    CCE01: "Only active Admins can delete events.",
    CCE02: "The deletion request is invalid.",
    CCE03: "This event is no longer available.",
    CCE04: "Only Draft or Archived events can be deleted.",
    CCE05: "This event changed. Refresh and confirm the deletion again.",
    CCE06: "This event is busy. Wait a moment and try again.",
    CCE07: "This event could not be deleted safely.",
    CCE08: "The deletion could not be completed safely.",
    CCE09: "The deletion could not be completed safely.",
    CCE10: "The banner cleanup result could not be saved safely.",
  };
  return (code && messages[code]) || "This event could not be deleted. Refresh and try again.";
}

export function eventManagementMotionState(reducedMotion: boolean) {
  return reducedMotion ? "reduced" : "animated";
}
