import { describe, expect, it } from "vitest";
import {
  getPhaseCompletionErrorCode,
  getPhaseCompletionErrorMessage,
  parseBoardPhaseCompletionState,
  parseDraftPhaseCompletionState,
  parseTaskDetailPhaseComplete,
  PHASE_COMPLETION_ERROR_MESSAGES,
  shouldRefetchAfterPhaseCompletionError,
} from "./phase-completion";

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

  it("rejects malformed or internally inconsistent new fields", () => {
    expect(parseBoardPhaseCompletionState({ phase_complete: "yes" })).toBeNull();
    expect(parseBoardPhaseCompletionState({
      phase_complete: false,
      can_reopen: true,
      updated_at: "token",
    })).toBeNull();
    expect(parseDraftPhaseCompletionState({
      out_phase_complete: true,
      out_can_reopen: true,
      out_updated_at: null,
    })).toBeNull();
    expect(parseTaskDetailPhaseComplete({ phase_complete: 1 })).toBeNull();
  });
});

describe("phase-completion fixed error messages", () => {
  it.each(Object.entries(PHASE_COMPLETION_ERROR_MESSAGES))(
    "maps %s without using backend text",
    (code, message) => {
      expect(getPhaseCompletionErrorMessage({ code, message: "secret" })).toBe(
        message,
      );
      expect(shouldRefetchAfterPhaseCompletionError({ code })).toBe(true);
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
