import { describe, expect, it } from "vitest";
import {
  TASK_BACKUP_ACTIONS,
  TASK_BACKUP_ERROR_CODES,
  getAcceptVolunteerOutcomeMessage,
  getTaskBackupErrorMessage,
  isAcceptVolunteerResult,
  isBackupToggleResult,
  isClaimTaskResult,
  isClaimableBacklogTask,
  isHelpWantedTask,
  isTaskBackupState,
  isVolunteerTaskResult,
  isWithdrawVolunteerResult,
  type TaskBackupAction,
  type TaskBackupErrorCode,
} from "./backup";

const backupState = {
  out_task_id: "task-1",
  out_request_backup: true,
  out_can_toggle_backup: false,
  out_can_volunteer: true,
  out_has_volunteered: false,
  out_can_accept: false,
  out_volunteers: [],
};

const helpTask = {
  out_id: "task-1",
  out_title: "Help",
  out_event_id: "event-1",
  out_event_name: "Event",
  out_phase: null,
  out_status: "To Do",
  out_effective_priority: "High",
  out_due_date: null,
  out_committee_id: "committee-1",
  out_committee_name: "Committee",
  out_has_volunteered: false,
  out_can_volunteer: true,
};

describe("Step 8 response validators", () => {
  it("validates backup state and rejects inconsistent own-offer state", () => {
    expect(isTaskBackupState(backupState)).toBe(true);
    expect(
      isTaskBackupState({
        ...backupState,
        out_can_volunteer: false,
        out_has_volunteered: true,
      }),
    ).toBe(false);
  });

  it("validates Help Wanted's exact prefixed shape", () => {
    expect(isHelpWantedTask(helpTask)).toBe(true);
    expect(isHelpWantedTask({ ...helpTask, out_title: undefined })).toBe(false);
  });

  it("validates every writer result shape", () => {
    expect(
      isClaimTaskResult({
        out_task_id: "task-1",
        out_primary_assignees: ["person-1"],
      }),
    ).toBe(true);
    expect(
      isBackupToggleResult({
        out_task_id: "task-1",
        out_request_backup: true,
      }),
    ).toBe(true);
    expect(
      isVolunteerTaskResult({
        out_task_id: "task-1",
        out_user_id: "person-1",
        out_created_at: "2026-10-22T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      isWithdrawVolunteerResult({
        out_task_id: "task-1",
        out_user_id: "person-1",
      }),
    ).toBe(true);
    expect(
      isAcceptVolunteerResult({
        out_task_id: "task-1",
        out_user_id: "person-1",
        out_assist_assignees: ["person-1"],
        out_outcome: "accepted",
      }),
    ).toBe(true);
    expect(
      isAcceptVolunteerResult({
        out_task_id: "task-1",
        out_user_id: "person-1",
        out_assist_assignees: [],
        out_outcome: "unknown",
      }),
    ).toBe(false);
  });
});

describe("claim presentation", () => {
  it("allows only real non-Completed Backlog rows", () => {
    expect(
      isClaimableBacklogTask({
        is_backlog: true,
        is_masked: false,
        status: "To Do",
      }),
    ).toBe(true);
    expect(
      isClaimableBacklogTask({
        is_backlog: true,
        is_masked: true,
        status: "To Do",
      }),
    ).toBe(false);
    expect(
      isClaimableBacklogTask({
        is_backlog: true,
        is_masked: false,
        status: "Completed",
      }),
    ).toBe(false);
  });
});

const sharedExpected: Partial<Record<TaskBackupErrorCode, string>> = {
  CCB01: "This task is no longer available.",
  CCB02: "Only tasks in active events can be changed.",
  CCB03: "This task is no longer available to claim.",
  CCB04: "You are already helping with this task.",
  CCB05: "This task is not currently accepting that backup change.",
  CCB07: "You are already assigned to this task.",
  CCB08: "Tasks in archived events are read-only.",
  CCB09: "Volunteer offers cannot be edited.",
  CCB10: "This task already has the maximum number of assignees.",
  "42501": "You no longer have permission to do that.",
  "40001": "The task changed. Refresh and try again.",
  "40P01": "The task is busy. Refresh and try again.",
};

const ccb06Expected: Record<TaskBackupAction, string> = {
  claim: "The task could not be claimed. Please try again.",
  "toggle-backup": "The backup request could not be changed. Please try again.",
  volunteer: "You've already volunteered for this task.",
  withdraw: "No pending offer was found.",
  accept: "That offer is no longer pending.",
};

describe("action-aware Step 8 error mapping", () => {
  for (const action of TASK_BACKUP_ACTIONS) {
    for (const code of TASK_BACKUP_ERROR_CODES) {
      it(`maps ${action} + ${code}`, () => {
        const expected =
          code === "CCB06" ? ccb06Expected[action] : sharedExpected[code];
        expect(getTaskBackupErrorMessage(action, { code })).toBe(expected);
      });
    }
  }

  it("uses an action-specific fallback", () => {
    expect(getTaskBackupErrorMessage("withdraw", new Error("private"))).toBe(
      "Your volunteer offer could not be withdrawn. Please try again.",
    );
  });
});

describe("acceptance outcomes", () => {
  it("uses safe messages for every outcome", () => {
    expect(getAcceptVolunteerOutcomeMessage("accepted")).toBe(
      "Volunteer accepted.",
    );
    expect(getAcceptVolunteerOutcomeMessage("inactive_removed")).toContain(
      "no longer active",
    );
    expect(
      getAcceptVolunteerOutcomeMessage("already_assigned_removed"),
    ).toContain("already assigned");
  });
});
