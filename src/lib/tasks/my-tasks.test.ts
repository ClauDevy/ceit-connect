import { describe, expect, it } from "vitest";
import {
  MY_TASKS_PAGE_SIZE,
  dedupeMyTasks,
  formatLoadedTaskCount,
  getLoadedMyTasksCount,
  getMyTasksErrorMessage,
  getMyTasksRpcArgs,
  isMyTask,
  isMyTasksSort,
  isMyTasksStatus,
  type MyTask,
} from "./my-tasks";

const task: MyTask = {
  out_id: "task-1",
  out_title: "Assigned task",
  out_event_id: "event-1",
  out_event_name: "Event",
  out_phase: null,
  out_status: "To Do",
  out_effective_priority: "High",
  out_due_date: null,
  out_committee_id: "committee-1",
  out_committee_name: "Committee",
  out_is_primary: true,
  out_is_assist: false,
  out_request_backup: false,
};

describe("My Tasks response validation", () => {
  it("accepts the exact fixed-shape row", () => {
    expect(isMyTask(task)).toBe(true);
  });

  it("rejects missing, mistyped, and invalid enum fields", () => {
    expect(isMyTask({ ...task, out_title: undefined })).toBe(false);
    expect(isMyTask({ ...task, out_is_primary: "yes" })).toBe(false);
    expect(isMyTask({ ...task, out_status: "Blocked" })).toBe(false);
    expect(isMyTask({ ...task, out_effective_priority: "Urgent" })).toBe(
      false,
    );
  });
});

describe("My Tasks query helpers", () => {
  it("builds named 50-row RPC arguments and preserves All as null", () => {
    expect(getMyTasksRpcArgs(null, "deadline", 100)).toEqual({
      p_status: null,
      p_sort: "deadline",
      p_limit: MY_TASKS_PAGE_SIZE,
      p_offset: 100,
    });
  });

  it("accepts only the database status and sort values", () => {
    expect(isMyTasksStatus("To Do")).toBe(true);
    expect(isMyTasksStatus("In Progress")).toBe(true);
    expect(isMyTasksStatus("Completed")).toBe(true);
    expect(isMyTasksStatus("All")).toBe(false);
    expect(isMyTasksSort("deadline")).toBe(true);
    expect(isMyTasksSort("priority")).toBe(true);
    expect(isMyTasksSort("event")).toBe(true);
    expect(isMyTasksSort(null)).toBe(false);
  });

  it("deduplicates refreshed pages by task id using the latest row", () => {
    const updated = { ...task, out_title: "Updated title" };
    const second = { ...task, out_id: "task-2" };
    expect(dedupeMyTasks([[task, second], [updated]])).toEqual([
      updated,
      second,
    ]);
  });
});

describe("workspace badge helpers", () => {
  it("counts only loaded non-Completed My Tasks rows", () => {
    expect(
      getLoadedMyTasksCount([
        task,
        { ...task, out_id: "task-2", out_status: "In Progress" },
        { ...task, out_id: "task-3", out_status: "Completed" },
      ]),
    ).toBe(2);
  });

  it("adds a plus only while another page exists", () => {
    expect(formatLoadedTaskCount(37, true)).toBe("37+");
    expect(formatLoadedTaskCount(37, false)).toBe("37");
  });
});

describe("safe My Tasks errors", () => {
  const expected = {
    CCF01:
      "Your account is not active. Sign in again or contact an administrator.",
    CCF02: "My Tasks could not load because the page request was invalid.",
    CCF03: "Choose a valid task status.",
    CCF04: "Choose a valid task sort.",
  } as const;

  for (const [code, message] of Object.entries(expected)) {
    it(`maps ${code} without exposing database text`, () => {
      expect(getMyTasksErrorMessage({ code, message: "private SQL text" })).toBe(
        message,
      );
    });
  }

  it("uses a safe fallback for unknown and raw errors", () => {
    expect(
      getMyTasksErrorMessage({ code: "XX000", message: "private SQL text" }),
    ).toBe("My Tasks could not be loaded. Please try again.");
    expect(getMyTasksErrorMessage(new Error("private SQL text"))).not.toContain(
      "private SQL text",
    );
  });
});
