import { describe, expect, it } from "vitest";
import {
  formatEventAutoArchiveWarning,
  parseEventAutoArchiveWarning,
} from "./auto-archive-warning";

describe("event auto-archive warning", () => {
  it.each([
    [3, 4, false, "This event archives automatically in 3 days. 4 tasks are unfinished."],
    [1, 1, false, "This event archives automatically in 1 day. 1 task is unfinished."],
    [0, 0, false, "This event archives automatically today."],
    [0, 2, true, "This event archives automatically today. 2 tasks are unfinished. Edit the event to extend its end date."],
  ])("formats %i days and %i tasks", (daysRemaining, unfinishedTaskCount, canExtend, expected) => {
    expect(formatEventAutoArchiveWarning({ daysRemaining, unfinishedTaskCount }, canExtend)).toBe(expected);
  });

  it("accepts one bounded aggregate row and fails closed otherwise", () => {
    expect(parseEventAutoArchiveWarning([{ days_remaining: 2, unfinished_task_count: 4 }])).toEqual({
      daysRemaining: 2,
      unfinishedTaskCount: 4,
    });
    expect(parseEventAutoArchiveWarning([])).toBeNull();
    expect(parseEventAutoArchiveWarning([{ days_remaining: -1, unfinished_task_count: 4 }])).toBeNull();
    expect(parseEventAutoArchiveWarning([{ days_remaining: 1, unfinished_task_count: "4" }])).toBeNull();
  });
});
