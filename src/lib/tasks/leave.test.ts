import { describe, expect, it } from "vitest";
import {
  excludeActorFromNewCandidates,
  getTaskLeaveConfirmationDescription,
  getTaskLeaveErrorMessage,
  isTaskLeaveRequest,
} from "./leave";

describe("task leave helpers", () => {
  it("accepts only complete pending-request rows", () => {
    expect(isTaskLeaveRequest({
      out_id: "request", out_task_id: "task", out_task_title: "Run sheet",
      out_event_name: "Assembly", out_requester_id: "member",
      out_requester_name: "Ari", out_due_date: null,
      out_created_at: "2026-10-30T00:00:00Z", out_can_resolve: true,
      out_is_requester: false,
    })).toBe(true);
    expect(isTaskLeaveRequest({ out_id: "request" })).toBe(false);
  });

  it("maps database errors to fixed safe copy", () => {
    expect(getTaskLeaveErrorMessage({ code: "CCL01", message: "secret" }))
      .toBe("A leave request is already pending.");
    expect(getTaskLeaveErrorMessage({ code: "unknown", message: "secret" }))
      .toBe("The leave request could not be updated. Please try again.");
  });

  it("hides the actor as a new candidate but retains a stored chip", () => {
    const actor = { id: "actor" };
    const other = { id: "other" };
    expect(excludeActorFromNewCandidates([actor, other], [], "actor"))
      .toEqual([other]);
    expect(excludeActorFromNewCandidates([actor, other], [actor], "actor"))
      .toEqual([actor, other]);
  });

  it("predicts request copy only for a Member at the server-reported due boundary", () => {
    expect(getTaskLeaveConfirmationDescription("Member", "due", true)).toBe(
      "You are sending a leave request. Your assignment and access will stay unchanged until leadership approves it.",
    );
    expect(getTaskLeaveConfirmationDescription("Admin", "due", true)).toBe(
      "You will be removed from this confidential task and will lose access to its details and work links.",
    );
    expect(getTaskLeaveConfirmationDescription("Member", null, false)).toBe(
      "You will be removed from this task. If you are its last primary assignee, it will return to the To Do Backlog.",
    );
  });
});
