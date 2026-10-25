import { describe, expect, it } from "vitest";
import {
  ARCHIVED_EVENT_ORDER,
  HOME_EVENT_ORDER,
  splitHomeEvents,
  type HomeEvent,
} from "./list-paging";

function event(id: string, status: HomeEvent["status"]): HomeEvent {
  return {
    id,
    name: id,
    description: null,
    start_date: "2026-10-25",
    end_date: null,
    status,
    banner_url: null,
    updated_at: "2026-10-25T00:00:00Z",
  };
}

describe("event list paging contracts", () => {
  it("keeps the unique event id as Home's final ascending tie-breaker", () => {
    expect(HOME_EVENT_ORDER).toEqual([
      { column: "start_date", ascending: true },
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ]);
  });

  it("keeps the unique event id as Archives' final descending tie-breaker", () => {
    expect(ARCHIVED_EVENT_ORDER).toEqual([
      { column: "start_date", ascending: false },
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  });

  it("splits one combined ordered Home result without status reordering", () => {
    const combined = [
      event("active-1", "Active"),
      event("draft-1", "Draft"),
      event("active-2", "Active"),
      event("draft-2", "Draft"),
    ];
    const split = splitHomeEvents(combined);
    expect(split.activeEvents.map(({ id }) => id)).toEqual([
      "active-1",
      "active-2",
    ]);
    expect(split.draftEvents.map(({ id }) => id)).toEqual([
      "draft-1",
      "draft-2",
    ]);
  });
});
