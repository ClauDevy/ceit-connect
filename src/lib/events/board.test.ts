import { describe, expect, it } from "vitest";
import { isBoardTask } from "./board";

const validRealCard = {
  id: "task-1",
  title: "Prepare venue",
  phase: "Setup",
  status: "In Progress",
  effective_priority: "High",
  due_date: "2026-10-16T12:00:00+00:00",
  committee_id: "committee-1",
  committee_name: "Logistics",
  primary_assignees: [
    { id: "user-1", full_name: "Ari Santos", avatar_url: null },
  ],
  assist_assignees: [],
  is_backlog: false,
  is_masked: false,
};

describe("isBoardTask", () => {
  it("accepts a valid real card", () => {
    expect(isBoardTask(validRealCard)).toBe(true);
  });

  it("accepts a valid masked card", () => {
    expect(
      isBoardTask({
        ...validRealCard,
        title: "Confidential Task",
        effective_priority: null,
        due_date: null,
        committee_id: null,
        committee_name: null,
        primary_assignees: [],
        assist_assignees: [],
        is_masked: true,
      }),
    ).toBe(true);
  });

  it("rejects an invalid status", () => {
    expect(isBoardTask({ ...validRealCard, status: "Blocked" })).toBe(false);
  });

  it("rejects an invalid priority", () => {
    expect(
      isBoardTask({ ...validRealCard, effective_priority: "Urgent" }),
    ).toBe(false);
  });

  it("rejects a malformed assignee", () => {
    expect(
      isBoardTask({
        ...validRealCard,
        primary_assignees: [{ id: "user-1", full_name: "Ari Santos" }],
      }),
    ).toBe(false);
  });

  it("rejects a non-object input", () => {
    expect(isBoardTask("not a board task")).toBe(false);
  });
});
