import { describe, expect, it } from "vitest";
import {
  deletionErrorMessage,
  eventDeletionYears,
  eventManagementMotionState,
  eventManagementPageSlice,
  eventPageSelectionState,
  eventSelectionCapHint,
  failedEventSelection,
  filterEventsByYear,
  parseEventDeletionRequest,
  reconcileEventSelection,
  resetEventManagementFilter,
  requiredDeletionConfirmation,
  shouldToggleEventRowSelection,
  snapshotEventDeletionSelection,
  toggleEventPageSelection,
  toggleEventSelection,
  type EventDeletionListItem,
} from "./event-deletion";

const id = (n: number) => `13dd0000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const version = "2026-10-31T12:34:56.123456+00:00";
const event = (n: number, start_date: string | null): EventDeletionListItem => ({
  id: id(n), name: `Event ${n}`, start_date, status: n % 2 ? "Draft" : "Archived", updated_at: version,
});

describe("event deletion helpers", () => {
  it("strictly validates one to ten unique entries and preserves opaque microseconds", () => {
    const parsed = parseEventDeletionRequest({
      events: [{ id: id(1), expectedUpdatedAt: version }], confirmation: "Event 1",
    });
    expect(parsed?.events[0].expectedUpdatedAt).toBe(version);
    expect(parseEventDeletionRequest({ events: [], confirmation: "" })).toBeNull();
    expect(parseEventDeletionRequest({ events: [{ id: id(1), expectedUpdatedAt: version }], confirmation: "x", extra: true })).toBeNull();
    expect(parseEventDeletionRequest({ events: [{ id: id(1), expectedUpdatedAt: version, name: "client" }], confirmation: "x" })).toBeNull();
    expect(parseEventDeletionRequest({ events: [
      { id: id(1), expectedUpdatedAt: version }, { id: id(1).toUpperCase(), expectedUpdatedAt: version },
    ], confirmation: "x" })).toBeNull();
    expect(parseEventDeletionRequest({ events: Array.from({ length: 11 }, (_, index) => ({ id: id(index), expectedUpdatedAt: version })), confirmation: "x" })).toBeNull();
    expect(parseEventDeletionRequest({ events: [{ id: id(1), expectedUpdatedAt: "not-a-version" }], confirmation: "x" })).toBeNull();
  });

  it("builds descending years from the real date shape and keeps nulls in All years only", () => {
    const rows = [event(1, "2024-02-29"), event(2, null), event(3, "2026-01-01"), event(4, "2024-12-01")];
    expect(eventDeletionYears(rows)).toEqual([2026, 2024]);
    expect(filterEventsByYear(rows, "all")).toHaveLength(4);
    expect(filterEventsByYear(rows, 2024).map((row) => row.id)).toEqual([id(1), id(4)]);
    expect(filterEventsByYear(rows, 2026).map((row) => row.id)).toEqual([id(3)]);
  });

  it("uses the exact event name for one and submitted count for bulk", () => {
    expect(requiredDeletionConfirmation([event(1, "2026-01-01")])).toBe("Event 1");
    expect(requiredDeletionConfirmation([event(1, null), event(2, null)])).toBe("DELETE 2 EVENTS");
  });

  it("selects only ten current-page rows and reports the quiet cap hint", () => {
    const visible = Array.from({ length: 12 }, (_, index) => event(index, "2026-01-01"));
    const result = toggleEventPageSelection(visible, new Map());
    expect(Array.from(result.selected.keys())).toEqual(visible.slice(0, 10).map((row) => row.id));
    expect(result.limited).toBe(true);
    expect(eventSelectionCapHint(result.added, result.limited)).toBe(
      "Only 10 events were selected from this page because you can delete at most 10 at once.",
    );
    const cleared = toggleEventPageSelection(visible.slice(0, 10), result.selected);
    expect(cleared.selected.size).toBe(0);
    expect(cleared.limited).toBe(false);
  });

  it("fills only the three remaining slots and keeps off-page selections", () => {
    const existing = new Map(
      Array.from({ length: 7 }, (_, index) => {
        const row = event(index, "2025-01-01");
        return [row.id, row] as const;
      }),
    );
    const page = Array.from({ length: 5 }, (_, index) => event(index + 20, "2026-01-01"));
    const result = toggleEventPageSelection(page, existing);
    expect(result.added).toBe(3);
    expect(result.selected.size).toBe(10);
    expect(result.limited).toBe(true);
    expect(eventSelectionCapHint(result.added, result.limited)).toBe(
      "Only 3 events were selected from this page because you can delete at most 10 at once.",
    );
    expect(eventPageSelectionState(page, result.selected)).toEqual({
      checked: false,
      indeterminate: true,
    });
  });

  it("caps individual selection, preserves failed snapshots, and reconciles refreshed rows", () => {
    let selected = new Map<string, EventDeletionListItem>();
    for (let index = 0; index < 11; index += 1) {
      selected = toggleEventSelection(selected, event(index, "2026-01-01")).selected;
    }
    expect(selected.size).toBe(10);
    const failed = failedEventSelection(selected, [
      { eventId: id(1), eventName: "One", deletion: "done", cleanup: "done", cleanupWarning: false, message: "done" },
      { eventId: id(2), eventName: "Two", deletion: "failed", cleanup: "done", cleanupWarning: false, message: "failed" },
    ]);
    expect(Array.from(failed.keys())).toEqual([id(2)]);
    expect(reconcileEventSelection(failed, [event(3, null)])).toEqual(new Map());
  });

  it("freezes expectedUpdatedAt through dialog open and never swaps a refreshed version", () => {
    const original = event(1, "2026-01-01");
    const selected = toggleEventSelection(new Map(), original).selected;
    const refreshed = { ...original, updated_at: "2026-10-31T12:00:00.999999+08:00" };
    const reconciled = reconcileEventSelection(selected, [refreshed]);
    const dialogSnapshot = snapshotEventDeletionSelection(reconciled);
    expect(dialogSnapshot[0].updated_at).toBe(original.updated_at);
    expect(dialogSnapshot[0].updated_at).not.toBe(refreshed.updated_at);
  });

  it("resets filter state and slices or clamps pages without DOM state", () => {
    const rows = Array.from({ length: 21 }, (_, index) => event(index, "2026-01-01"));
    expect(eventManagementPageSlice(rows, 2).items.map((row) => row.id)).toEqual(
      rows.slice(10, 20).map((row) => row.id),
    );
    expect(eventManagementPageSlice(rows.slice(0, 9), 3)).toMatchObject({
      page: 1,
      totalPages: 1,
    });
    const reset = resetEventManagementFilter(2026);
    expect(reset).toMatchObject({ year: 2026, page: 1 });
    expect(reset.selection.size).toBe(0);
  });

  it("lets a row toggle once while checkbox clicks and text-selection clicks do not", () => {
    expect(
      shouldToggleEventRowSelection({
        clickedSelectionControl: false,
        hasSelectedText: false,
      }),
    ).toBe(true);
    expect(
      shouldToggleEventRowSelection({
        clickedSelectionControl: true,
        hasSelectedText: false,
      }),
    ).toBe(false);
    expect(
      shouldToggleEventRowSelection({
        clickedSelectionControl: false,
        hasSelectedText: true,
      }),
    ).toBe(false);
  });

  it("maps every deletion and cleanup code without using message text", () => {
    for (let number = 1; number <= 10; number += 1) {
      const code = `CCE${number.toString().padStart(2, "0")}`;
      expect(deletionErrorMessage(code)).not.toContain("private");
    }
    expect(deletionErrorMessage("CCE10")).toBe("The banner cleanup result could not be saved safely.");
    expect(deletionErrorMessage(undefined)).toContain("could not be deleted");
  });

  it("has an explicit final-state reduced-motion mode", () => {
    expect(eventManagementMotionState(true)).toBe("reduced");
    expect(eventManagementMotionState(false)).toBe("animated");
  });
});
