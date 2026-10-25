import { describe, expect, it } from "vitest";
import {
  getVisibleActiveEventIds,
  markHomeEventProgressUnavailable,
  mergeHomeEventProgress,
  parseHomeEventProgressRows,
} from "./home-event-progress";
import type { HomeEvent } from "./list-paging";

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

const row = {
  out_event_id: "active-1",
  out_phase_label: "Setup",
  out_progress_percentage: 50,
  out_visible_backup_request_count: 2,
  out_backlog_count: 1,
};

describe("Home event progress", () => {
  it("accepts only the fixed bounded aggregate shape", () => {
    expect(parseHomeEventProgressRows([row])?.get("active-1")).toEqual({
      phaseLabel: "Setup",
      percentage: 50,
      visibleBackupRequestCount: 2,
      backlogCount: 1,
    });
    expect(
      parseHomeEventProgressRows([
        { ...row, out_progress_percentage: 101 },
      ]),
    ).toBeNull();
    expect(
      parseHomeEventProgressRows([
        { ...row, out_visible_backup_request_count: -1 },
      ]),
    ).toBeNull();
    expect(parseHomeEventProgressRows([row, row])).toBeNull();
  });

  it("passes only Active ids from the visible 20-row page", () => {
    const events = Array.from({ length: 21 }, (_, index) =>
      event(
        `event-${index + 1}`,
        index % 2 === 0 ? "Active" : "Draft",
      ),
    );
    expect(getVisibleActiveEventIds(events)).toEqual([
      "event-1",
      "event-3",
      "event-5",
      "event-7",
      "event-9",
      "event-11",
      "event-13",
      "event-15",
      "event-17",
      "event-19",
    ]);
    expect(getVisibleActiveEventIds([event("draft", "Draft")])).toEqual([]);
  });

  it("merges by id without enriching Draft or lookahead rows", () => {
    const events = [
      event("active-1", "Active"),
      event("draft-1", "Draft"),
      ...Array.from({ length: 19 }, (_, index) =>
        event(`active-${index + 2}`, "Active"),
      ),
    ];
    const merged = mergeHomeEventProgress(events, [row]);
    expect(merged[0].progress?.phaseLabel).toBe("Setup");
    expect(merged[1].progress).toBeUndefined();
    expect(merged[20].progress).toBeUndefined();
    expect(merged[2].progress).toBeNull();
  });

  it("marks only visible Active cards unavailable after a safe read failure", () => {
    const events = [event("active", "Active"), event("draft", "Draft")];
    const marked = markHomeEventProgressUnavailable(events);
    expect(marked[0].progress).toBeNull();
    expect(marked[1].progress).toBeUndefined();
  });
});
