export type HomeEventProgress = {
  phaseLabel: string | null;
  percentage: number;
  visibleBackupRequestCount: number;
  backlogCount: number;
};

export type HomeEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: "Active" | "Draft";
  banner_url: string | null;
  updated_at: string;
  incompleteTaskCount?: number;
  progress?: HomeEventProgress | null;
};

export type ArchivedEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
};

export const HOME_EVENT_ORDER = [
  { column: "start_date", ascending: true },
  { column: "created_at", ascending: true },
  { column: "id", ascending: true },
] as const;

export const ARCHIVED_EVENT_ORDER = [
  { column: "start_date", ascending: false },
  { column: "created_at", ascending: false },
  { column: "id", ascending: false },
] as const;

export function splitHomeEvents(events: readonly HomeEvent[]) {
  return {
    activeEvents: events.filter((event) => event.status === "Active"),
    draftEvents: events.filter((event) => event.status === "Draft"),
  };
}
