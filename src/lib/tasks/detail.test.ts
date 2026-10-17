import { describe, expect, it } from "vitest";
import { getTaskBackHref, isTaskDetail, type TaskDetail } from "./detail";

const realTask: TaskDetail = {
  id: "task-1",
  event_id: "event-1",
  event_name: "CEIT Week",
  event_status: "Active",
  title: "Prepare venue",
  description: "Confirm the final setup.",
  phase: "Preparation",
  status: "In Progress",
  effective_priority: "High",
  task_type: "Deliverable",
  due_date: "2026-10-20T08:00:00+00:00",
  call_time: null,
  end_time: null,
  created_at: "2026-10-10T08:00:00+00:00",
  committee_id: "committee-1",
  committee_name: "COEXA",
  primary_assignees: [
    { id: "user-1", full_name: "Ari Santos", avatar_url: null },
  ],
  assist_assignees: [],
  is_confidential: false,
  is_masked: false,
  has_dependency: false,
  is_blocked: false,
  dependency_label: null,
  access_list: [],
};

const maskedTask: TaskDetail = {
  id: "task-2",
  event_id: null,
  event_name: null,
  event_status: null,
  title: "Confidential Task",
  description: null,
  phase: "Execution",
  status: "To Do",
  effective_priority: null,
  task_type: null,
  due_date: null,
  call_time: null,
  end_time: null,
  created_at: null,
  committee_id: null,
  committee_name: null,
  primary_assignees: [],
  assist_assignees: [],
  is_confidential: null,
  is_masked: true,
  has_dependency: null,
  is_blocked: null,
  dependency_label: null,
  access_list: [],
};

describe("isTaskDetail", () => {
  it("accepts real and fully masked detail rows", () => {
    expect(isTaskDetail(realTask)).toBe(true);
    expect(isTaskDetail(maskedTask)).toBe(true);
  });

  it("rejects a masked row that leaks a non-placement field", () => {
    expect(isTaskDetail({ ...maskedTask, event_name: "Secret Event" })).toBe(
      false,
    );
  });

  it("rejects malformed access-list profiles", () => {
    expect(
      isTaskDetail({
        ...realTask,
        access_list: [{ id: "user-2", full_name: "Sam" }],
      }),
    ).toBe(false);
  });
});

describe("getTaskBackHref", () => {
  it.each([
    ["Active", "/events/event-1"],
    ["Archived", "/archives/event-1"],
    ["Draft", "/events/event-1/edit"],
  ] as const)("maps %s tasks to the right event page", (status, expected) => {
    expect(getTaskBackHref({ ...realTask, event_status: status })).toBe(
      expected,
    );
  });

  it("sends masked and unavailable tasks Home", () => {
    expect(getTaskBackHref(maskedTask)).toBe("/home");
    expect(getTaskBackHref(null)).toBe("/home");
  });
});
