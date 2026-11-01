import { describe, expect, it } from "vitest";
import {
  getPhaseCompletionErrorCode,
  getPhaseCompletionErrorMessage,
  parseBoardPhaseCompletionState,
  parseDraftPhaseCompletionState,
  parseTaskDetailPhaseComplete,
  PHASE_COMPLETION_ERROR_MESSAGES,
  PHASE_COMPLETION_REFRESH_MESSAGES,
  getEffectiveReopenCandidate,
  getReopenCandidates,
  initializePhaseDisclosure,
  reconcilePhaseDisclosureAfterRefresh,
  revealReopenedPhase,
  selectPhaseDisclosure,
  setPhaseDisclosureExpanded,
  applySuccessfulReopenState,
  shouldRefetchAfterPhaseCompletionError,
} from "./phase-completion";
import { ACTIVE_TASK_EXISTING_ERROR_MESSAGES } from "./active-task";

describe("phase-completion reader parsing", () => {
  it("normalizes missing board fields for the app-before-migration window", () => {
    expect(parseBoardPhaseCompletionState({ id: "task" })).toEqual({
      phaseComplete: false,
      canReopen: false,
      reopenUpdatedAt: null,
    });
  });

  it("normalizes missing Draft and detail fields", () => {
    expect(parseDraftPhaseCompletionState({ out_task_id: "task" })).toEqual({
      phaseComplete: false,
      canReopen: false,
      reopenUpdatedAt: null,
    });
    expect(parseTaskDetailPhaseComplete({ id: "task" })).toBe(false);
  });

  it("keeps the exact timestamp as an opaque string", () => {
    const timestamp = "2026-11-01T12:34:56.123456+00:00";
    const parsed = parseBoardPhaseCompletionState({
      phase_complete: true,
      can_reopen: true,
      updated_at: timestamp,
    });
    expect(parsed).toEqual({
      phaseComplete: true,
      canReopen: true,
      reopenUpdatedAt: timestamp,
    });
    expect(parsed?.reopenUpdatedAt).toBe(timestamp);
  });

  it("treats malformed or internally inconsistent new fields as absent", () => {
    expect(parseBoardPhaseCompletionState({ phase_complete: "yes" })).toEqual({ phaseComplete: false, canReopen: false, reopenUpdatedAt: null });
    expect(parseBoardPhaseCompletionState({
      phase_complete: false,
      can_reopen: true,
      updated_at: "token",
    })).toEqual({ phaseComplete: false, canReopen: false, reopenUpdatedAt: null });
    expect(parseDraftPhaseCompletionState({
      out_phase_complete: true,
      out_can_reopen: true,
      out_updated_at: null,
    })).toEqual({ phaseComplete: false, canReopen: false, reopenUpdatedAt: null });
    expect(parseTaskDetailPhaseComplete({ phase_complete: 1 })).toBe(false);
  });

  it("filters candidates without leaking masked or unavailable tasks and preserves timestamp identity", () => {
    const timestamp = "opaque-token";
    expect(getReopenCandidates([
      { id: "yes", title: "Visible", phase: "Setup", phaseComplete: true, canReopen: true, reopenUpdatedAt: timestamp },
      { id: "masked", title: "Hidden", phase: "Setup", phaseComplete: true, canReopen: true, reopenUpdatedAt: "hidden", isMasked: true },
      { id: "no", title: "No", phase: "Setup", phaseComplete: true, canReopen: false, reopenUpdatedAt: null },
    ], "Setup")).toEqual([{ id: "yes", title: "Visible", phase: "Setup", updatedAt: timestamp }]);
    expect(getReopenCandidates([{ id: "u", title: "U", phase: null, phaseComplete: true, canReopen: true, reopenUpdatedAt: timestamp }], "Unphased")).toEqual([]);
  });

  it("falls back to the first current Reopen candidate when the selected id disappears", () => {
    const candidates = [
      { id: "first", title: "First", phase: "Setup", updatedAt: "opaque-first" },
      { id: "second", title: "Second", phase: "Setup", updatedAt: "opaque-second" },
    ];

    expect(getEffectiveReopenCandidate(candidates, "removed")).toBe(candidates[0]);
  });

  it("returns null at submit time when there are no current Reopen candidates", () => {
    expect(getEffectiveReopenCandidate([], "removed")).toBeNull();
  });

  it("uses the refreshed exact opaque timestamp when the selected Reopen id remains", () => {
    const oldTimestamp = "2026-11-01T12:34:56.111111+00:00";
    const newTimestamp = "2026-11-01T12:34:56.222222+00:00";
    const refreshedCandidates = [
      { id: "selected", title: "Selected", phase: "Setup", updatedAt: newTimestamp },
      { id: "other", title: "Other", phase: "Setup", updatedAt: "opaque-other" },
    ];

    const submittedCandidate = getEffectiveReopenCandidate(
      refreshedCandidates,
      "selected",
    );

    expect(submittedCandidate).toBe(refreshedCandidates[0]);
    expect(submittedCandidate?.updatedAt).toBe(newTimestamp);
    expect(submittedCandidate?.updatedAt).not.toBe(oldTimestamp);
  });

  it("restarts disclosure deterministically across selection, refresh, explicit expansion, and Reopen", () => {
    const phases = ["Complete", "Open"];
    const initialized = initializePhaseDisclosure(
      phases,
      new Set(["Complete"]),
    );
    expect(initialized.activePhase).toBe("Complete");
    expect([...initialized.collapsedPhases]).toEqual(["Complete"]);

    const switched = selectPhaseDisclosure(initialized, "Open");
    expect(switched.activePhase).toBe("Open");
    expect([...switched.collapsedPhases]).toEqual(["Complete"]);

    const expanded = setPhaseDisclosureExpanded(switched, "Complete", true);
    expect([...expanded.collapsedPhases]).toEqual([]);
    const switchedBack = selectPhaseDisclosure(expanded, "Complete");
    expect(switchedBack.activePhase).toBe("Complete");
    expect([...switchedBack.collapsedPhases]).toEqual([]);
    const stillComplete = reconcilePhaseDisclosureAfterRefresh(
      switchedBack,
      phases,
      new Set(["Complete"]),
    );
    expect([...stillComplete.collapsedPhases]).toEqual([]);
    expect(stillComplete.focusPhase).toBeNull();

    const incomplete = reconcilePhaseDisclosureAfterRefresh(
      stillComplete,
      phases,
      new Set(),
    );
    expect([...incomplete.collapsedPhases]).toEqual([]);
    const completedAgain = reconcilePhaseDisclosureAfterRefresh(
      incomplete,
      phases,
      new Set(["Complete"]),
    );
    expect([...completedAgain.collapsedPhases]).toEqual(["Complete"]);

    const reopened = revealReopenedPhase(completedAgain, "Complete");
    expect(reopened.activePhase).toBe("Complete");
    expect([...reopened.collapsedPhases]).toEqual([]);
    expect([...reopened.completedPhases]).toEqual([]);
    expect(reopened.focusPhase).toBe("Complete");
    expect(applySuccessfulReopenState([
      { id: "chosen", phase: "Complete", status: "Completed", phaseComplete: true },
      { id: "other", phase: "Complete", status: "Completed", phaseComplete: true },
    ], { id: "chosen", title: "Chosen", phase: "Complete", updatedAt: "opaque" })).toEqual([
      { id: "chosen", phase: "Complete", status: "In Progress", phaseComplete: false },
      { id: "other", phase: "Complete", status: "Completed", phaseComplete: false },
    ]);
  });

  it("initializes to the same closed state twice under React Strict Mode", () => {
    const first = initializePhaseDisclosure(
      ["Complete", "Open"],
      new Set(["Complete"]),
    );
    const second = initializePhaseDisclosure(
      ["Complete", "Open"],
      new Set(["Complete"]),
    );
    expect(second.activePhase).toBe(first.activePhase);
    expect([...second.collapsedPhases]).toEqual([...first.collapsedPhases]);
    expect([...second.completedPhases]).toEqual([...first.completedPhases]);
    expect(second.focusPhase).toBe(first.focusPhase);
  });
});

describe("phase-completion fixed error messages", () => {
  it("defines the exact refresh-before-message inventory", () => {
    expect([...PHASE_COMPLETION_REFRESH_MESSAGES]).toEqual([
      PHASE_COMPLETION_ERROR_MESSAGES.CCQ01,
      PHASE_COMPLETION_ERROR_MESSAGES.CCQ05,
      PHASE_COMPLETION_ERROR_MESSAGES.CCQ06,
      PHASE_COMPLETION_ERROR_MESSAGES.CCQ07,
      PHASE_COMPLETION_ERROR_MESSAGES["40001"],
      PHASE_COMPLETION_ERROR_MESSAGES["40P01"],
      PHASE_COMPLETION_ERROR_MESSAGES.CCQ02,
      PHASE_COMPLETION_ERROR_MESSAGES.CCQ04,
    ]);
  });

  it("keeps shared refresh strings distinct from existing active-task API messages", () => {
    for (const message of PHASE_COMPLETION_REFRESH_MESSAGES) {
      expect(ACTIVE_TASK_EXISTING_ERROR_MESSAGES).not.toContain(message);
    }
  });
  it.each(Object.entries(PHASE_COMPLETION_ERROR_MESSAGES))(
    "maps %s without using backend text",
    (code, message) => {
      expect(getPhaseCompletionErrorMessage({ code, message: "secret" })).toBe(
        message,
      );
      expect(shouldRefetchAfterPhaseCompletionError({ code })).toBe(
        code !== "CCQ03",
      );
    },
  );

  it("does not intercept any existing non-phase error code", () => {
    const existingCodes = [
      "22023",
      "23505",
      "42501",
      "CCB01",
      "CCB02",
      "CCB03",
      "CCB04",
      "CCB05",
      "CCB06",
      "CCB07",
      "CCB08",
      "CCB09",
      "CCB10",
      "CCC01",
      "CCC02",
      "CCC03",
      "CCC04",
      "CCC05",
      "CCC06",
      "CCC07",
      "CCC08",
      "CCC09",
      "CCC10",
      "CCD01",
      "CCL01",
      "CCL02",
      "CCL03",
      "CCL04",
      "CCL20",
      "CCN01",
      "CCP01",
      "CCS01",
      "CCT01",
      "CCT02",
      "CCT03",
      "CCU72",
      "CCU73",
    ];

    for (const code of existingCodes) {
      expect(getPhaseCompletionErrorMessage({ code, message: "existing" }))
        .toBeNull();
      expect(shouldRefetchAfterPhaseCompletionError({ code })).toBe(false);
    }
  });

  it.each([
    "toString",
    "constructor",
    "__proto__",
    "hasOwnProperty",
  ])("rejects inherited property name %s", (code) => {
    expect(getPhaseCompletionErrorCode({ code })).toBeNull();
    expect(getPhaseCompletionErrorMessage({ code })).toBeNull();
    expect(shouldRefetchAfterPhaseCompletionError({ code })).toBe(false);
  });

  it.each([null, undefined, 40001, {}])(
    "rejects non-string code %s without throwing",
    (code) => {
      expect(() => getPhaseCompletionErrorCode({ code })).not.toThrow();
      expect(getPhaseCompletionErrorCode({ code })).toBeNull();
      expect(getPhaseCompletionErrorMessage({ code })).toBeNull();
      expect(shouldRefetchAfterPhaseCompletionError({ code })).toBe(false);
    },
  );
});
