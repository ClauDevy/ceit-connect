import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_TASK_RETRY_MESSAGE,
  createActiveTaskRpcArgs,
  editActiveTaskRpcArgs,
  getActiveTaskDateFloorProblem,
  parseCreateActiveTaskRequest,
  parseEditActiveTaskRequest,
  runActiveTaskRpc,
  validateCreateActiveTaskRequest,
  validateEditActiveTaskRequest,
} from "./active-task";

const eventId = "10000000-0000-4000-8000-000000000001";
const taskId = "20000000-0000-4000-8000-000000000001";
const committeeId = "30000000-0000-4000-8000-000000000001";
const personId = "40000000-0000-4000-8000-000000000001";
const viewerId = "40000000-0000-4000-8000-000000000002";
const eventIdV7 = "01900000-0000-7000-8000-000000000001";
const taskIdV7 = "01900000-0000-7000-8000-000000000002";
const committeeIdV7 = "01900000-0000-7000-8000-000000000003";
const personIdV7 = "01900000-0000-7000-8000-000000000004";
const viewerIdV7 = "01900000-0000-7000-8000-000000000005";

const draft = {
  title: "  Prepare venue  ",
  description: "Confirm access.",
  phase: "  Preparation  ",
  committeeId,
  priority: "High" as const,
  taskType: "LiveOperation" as const,
  dueDate: "2026-10-30",
  dutyDate: "2026-10-31",
  callTime: "00:30",
  endDate: "",
  endTime: "02:00",
  primaryAssigneeIds: [personId],
  isConfidential: true,
  allowedViewerIds: [],
};

describe("active task request contracts", () => {
  it.each([
    ["due date", { taskType: "Deliverable" as const, dueDate: "2026-11-13" }, "dueDate", "Choose today or a later due date."],
    ["duty date", { dutyDate: "2026-11-13" }, "dutyDate", "Choose today or a later duty date."],
    ["end date", { endDate: "2026-11-13" }, "endDate", "Choose today or a later end date."],
  ])("rejects a past %s on create", (_, change, field, message) => {
    expect(
      getActiveTaskDateFloorProblem({
        mode: "add",
        draft: {
          ...draft,
          dueDate: "2026-11-14",
          dutyDate: "2026-11-14",
          endDate: "2026-11-15",
          ...change,
        },
        initialDraft: null,
        today: "2026-11-14",
      }),
    ).toEqual({ field, message });
  });

  it("allows today even when the selected times have passed and allows an overnight end", () => {
    expect(
      getActiveTaskDateFloorProblem({
        mode: "add",
        draft: {
          ...draft,
          dueDate: "2026-11-14",
          dutyDate: "2026-11-14",
          callTime: "00:01",
          endDate: "2026-11-15",
          endTime: "02:00",
        },
        initialDraft: null,
        today: "2026-11-14",
      }),
    ).toBeNull();
  });

  it("ignores a hidden kept Due date for a new Live Operation", () => {
    expect(
      getActiveTaskDateFloorProblem({
        mode: "add",
        draft: {
          ...draft,
          dueDate: "2000-01-01",
          dutyDate: "2026-11-14",
          callTime: "09:00",
        },
        initialDraft: null,
        today: "2026-11-14",
      }),
    ).toBeNull();
  });

  it("allows an existing task switched to Live Operation to resubmit its unchanged old Due date", () => {
    const initial = {
      ...draft,
      taskType: "Deliverable" as const,
      dueDate: "2000-01-01",
      dutyDate: "",
      callTime: "",
      endDate: "",
      endTime: "",
    };
    expect(
      getActiveTaskDateFloorProblem({
        mode: "edit",
        draft: {
          ...initial,
          taskType: "LiveOperation",
          dueDate: "2099-01-01",
          dutyDate: "2026-11-14",
          callTime: "09:00",
        },
        initialDraft: initial,
        today: "2026-11-14",
      }),
    ).toBeNull();
  });

  it("uses changed calendar dates, not changed times, for grandfathered edits", () => {
    const initial = {
      ...draft,
      dueDate: "2026-11-10",
      dutyDate: "2026-11-11",
      callTime: "09:00",
      endDate: "2026-11-12",
      endTime: "02:00",
    };
    expect(
      getActiveTaskDateFloorProblem({
        mode: "edit",
        draft: { ...initial, title: "Changed", callTime: "10:00", endTime: "03:00" },
        initialDraft: initial,
        today: "2026-11-14",
      }),
    ).toBeNull();
    expect(
      getActiveTaskDateFloorProblem({
        mode: "edit",
        draft: { ...initial, dutyDate: "2026-11-13" },
        initialDraft: initial,
        today: "2026-11-14",
      }),
    ).toEqual({
      field: "dutyDate",
      message: "Choose today or a later duty date.",
    });
    expect(
      getActiveTaskDateFloorProblem({
        mode: "edit",
        draft: { ...initial, dueDate: "", endDate: "", endTime: "" },
        initialDraft: initial,
        today: "2026-11-14",
      }),
    ).toBeNull();
  });

  it("strictly validates POST and PATCH fields", () => {
    expect(parseCreateActiveTaskRequest({ eventId, ...draft })).toEqual({
      eventId,
      ...draft,
      title: "Prepare venue",
      phase: "Preparation",
    });
    expect(
      parseEditActiveTaskRequest({
        taskId,
        expectedUpdatedAt: "2026-10-28T12:34:56.123456+00:00",
        ...draft,
      }),
    ).not.toBeNull();
    expect(parseCreateActiveTaskRequest({ eventId, ...draft, status: "To Do" })).toBeNull();
    expect(parseCreateActiveTaskRequest({ eventId, ...draft, dueDate: "2026-02-30" })).toBeNull();
    expect(parseCreateActiveTaskRequest({ eventId, ...draft, primaryAssigneeIds: [personId, personId] })).toBeNull();
    expect(parseEditActiveTaskRequest({ taskId, expectedUpdatedAt: "not-a-token", ...draft })).toBeNull();
  });

  it.each([
    ["POST", (body: Record<string, unknown>) => validateCreateActiveTaskRequest({ eventId, ...body })],
    ["PATCH", (body: Record<string, unknown>) => validateEditActiveTaskRequest({ taskId, expectedUpdatedAt: "2026-10-28T12:34:56.123456+00:00", ...body })],
  ])("keeps endDate optional for old %s clients but validates it when present", (_, validate) => {
    const legacyDraft: Record<string, unknown> = { ...draft };
    delete legacyDraft.endDate;
    expect(validate(legacyDraft)).toMatchObject({ ok: true, data: { endDate: "" } });
    expect(validate({ ...draft, endDate: "" })).toMatchObject({ ok: true });
    expect(validate({ ...draft, endDate: 123 })).toMatchObject({ ok: false, field: "endDate" });
    expect(validate({ ...draft, endDate: null })).toMatchObject({ ok: false, field: "endDate" });
    expect(validate({ ...draft, endDate: "2026-02-30" })).toMatchObject({ ok: false, field: "endDate" });
  });

  it("accepts and serializes an overnight Live Operation", () => {
    const payload = parseCreateActiveTaskRequest({
      eventId,
      ...draft,
      dutyDate: "2026-12-31",
      callTime: "23:00",
      endDate: "2027-01-01",
      endTime: "02:00",
    })!;
    expect(createActiveTaskRpcArgs(payload)).toMatchObject({
      p_call_time: "2026-12-31T15:00:00.000Z",
      p_end_time: "2026-12-31T18:00:00.000Z",
    });
  });

  it.each([
    [{ dutyDate: "", callTime: "23:00" }, "dutyDate", "Choose a Duty date when adding a Live Operation schedule."],
    [{ dutyDate: "2026-11-01", callTime: "", endTime: "02:00" }, "callTime", "Choose a Call time when adding a Live Operation schedule."],
    [{ dutyDate: "2026-11-01", callTime: "23:00", endDate: "2026-11-02", endTime: "" }, "endTime", "Choose an end time when setting an end date."],
    [{ dutyDate: "2026-11-02", callTime: "23:00", endDate: "2026-11-01", endTime: "23:30" }, "endDate", "End date cannot be before the duty date."],
    [{ dutyDate: "2026-11-02", callTime: "23:00", endDate: "2026-11-02", endTime: "22:59" }, "endTime", "End time cannot be before call time."],
  ])("returns a precise board schedule error for %#", (change, field, message) => {
    expect(validateCreateActiveTaskRequest({ eventId, ...draft, ...change })).toMatchObject({
      ok: false,
      field,
      message,
    });
  });

  it("rejects every schedule value on Deliverables, including endDate", () => {
    expect(
      validateCreateActiveTaskRequest({
        eventId,
        ...draft,
        taskType: "Deliverable",
        dutyDate: "",
        callTime: "",
        endTime: "",
        endDate: "2026-11-01",
      }),
    ).toMatchObject({ ok: false, field: "schedule" });
  });

  it.each([
    ["title", { title: "" }, "Enter a task title up to 200 characters."],
    ["description", { description: "x".repeat(2001) }, "Keep the description to 2,000 characters."],
    ["phase", { phase: "" }, "Enter a phase up to 100 characters."],
    ["committee", { committeeId: "bad" }, "Choose an available committee."],
    ["priority", { priority: "Urgent" }, "Choose a valid priority."],
    ["task type", { taskType: "Other" }, "Choose a valid task type."],
    ["due date", { dueDate: "2026-02-30" }, "Choose a valid due date."],
    ["schedule", { taskType: "Deliverable" }, "Check the Live Operation date and times."],
    ["primary assignees", { primaryAssigneeIds: [personId, personId] }, "Check the selected primary assignees and try again."],
    ["confidentiality", { isConfidential: "yes" }, "Check the confidentiality setting."],
    ["viewers", { isConfidential: false, allowedViewerIds: [viewerId] }, "Check the selected additional viewers and try again."],
  ])("returns a fixed, field-specific message for invalid %s", (_, change, message) => {
    expect(validateCreateActiveTaskRequest({ eventId, ...draft, ...change })).toMatchObject({
      ok: false,
      message,
    });
  });

  it.each([
    ["event", { eventId: eventIdV7 }],
    ["committee", { committeeId: committeeIdV7 }],
    ["primary assignee", { primaryAssigneeIds: [personIdV7] }],
    ["additional viewer", { allowedViewerIds: [viewerIdV7] }],
  ])("accepts a canonical UUIDv7 %s in POST", (_, change) => {
    expect(
      validateCreateActiveTaskRequest({
        eventId,
        ...draft,
        allowedViewerIds: [viewerId],
        ...change,
      }),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["task", { taskId: taskIdV7 }],
    ["committee", { committeeId: committeeIdV7 }],
    ["primary assignee", { primaryAssigneeIds: [personIdV7] }],
    ["additional viewer", { allowedViewerIds: [viewerIdV7] }],
  ])("accepts a canonical UUIDv7 %s in PATCH", (_, change) => {
    expect(
      validateEditActiveTaskRequest({
        taskId,
        expectedUpdatedAt: "2026-10-28T12:34:56.123456+00:00",
        ...draft,
        allowedViewerIds: [viewerId],
        ...change,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects braces and unhyphenated UUIDs and deduplicates case-insensitively", () => {
    expect(
      validateCreateActiveTaskRequest({
        eventId: `{${eventIdV7}}`,
        ...draft,
      }),
    ).toMatchObject({ ok: false, message: "The event is unavailable." });
    expect(
      validateCreateActiveTaskRequest({
        eventId: eventIdV7.replaceAll("-", ""),
        ...draft,
      }),
    ).toMatchObject({ ok: false, message: "The event is unavailable." });
    expect(
      validateCreateActiveTaskRequest({
        eventId,
        ...draft,
        primaryAssigneeIds: [personId.toUpperCase(), personId],
      }),
    ).toMatchObject({
      ok: false,
      message: "Check the selected primary assignees and try again.",
    });
  });

  it("uses cap messages only when the actual array length exceeds its cap", () => {
    const primaryAssigneeIds = Array.from(
      { length: 101 },
      (_, index) =>
        `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const allowedViewerIds = Array.from(
      { length: 51 },
      (_, index) =>
        `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    expect(
      validateCreateActiveTaskRequest({ eventId, ...draft, primaryAssigneeIds }),
    ).toMatchObject({ ok: false, message: "Select up to 100 people." });
    expect(
      validateCreateActiveTaskRequest({ eventId, ...draft, allowedViewerIds }),
    ).toMatchObject({
      ok: false,
      message: "Select up to 50 additional viewers.",
    });
  });

  it("keeps unexpected shapes generic and identifiers out of messages", () => {
    const unexpected = validateCreateActiveTaskRequest({
      eventId,
      ...draft,
      unexpected: "private",
    });
    expect(unexpected).toEqual({
      ok: false,
      field: "form",
      message: "Review the task details and try again.",
    });
    if (unexpected.ok) throw new Error("Expected validation to fail.");
    expect(unexpected.message).not.toContain(eventId);
    expect(unexpected.message).not.toContain("unexpected");

    const stale = validateEditActiveTaskRequest({
      taskId,
      expectedUpdatedAt: "bad",
      ...draft,
    });
    expect(stale).toMatchObject({
      ok: false,
      message: "This task changed after you loaded it. Reload and try again.",
    });
  });

  it("matches Event Create/Edit Philippine serialization and preserves tokens", () => {
    const createPayload = parseCreateActiveTaskRequest({ eventId, ...draft })!;
    expect(createActiveTaskRpcArgs(createPayload)).toMatchObject({
      p_due_date: "2026-10-30",
      p_call_time: "2026-10-30T16:30:00.000Z",
      p_end_time: "2026-10-30T18:00:00.000Z",
    });

    const token = "2026-10-28T12:34:56.123456+00:00";
    const editPayload = parseEditActiveTaskRequest({
      taskId,
      expectedUpdatedAt: token,
      ...draft,
    })!;
    expect(editActiveTaskRpcArgs(editPayload).p_expected_updated_at).toBe(token);
  });
});

describe("active task CCL01 retry helper", () => {
  it.each([2, 3])("succeeds on attempt %s using a new RPC request", async (successAttempt) => {
    const rpc = vi.fn();
    for (let attempt = 1; attempt < successAttempt; attempt += 1) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "CCL01" } });
    }
    rpc.mockResolvedValueOnce({ data: [{ out_task_id: taskId }], error: null });

    const result = await runActiveTaskRpc(
      { rpc },
      "edit_active_event_task",
      { p_task_id: taskId },
    );
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(successAttempt);
    expect(new Set(rpc.mock.results.map((call) => call.value)).size).toBe(successAttempt);
  });

  it("returns the exact friendly message after three CCL01 failures", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "CCL01", message: "private database text" },
    });
    await expect(
      runActiveTaskRpc({ rpc }, "edit_active_event_task", {}),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      message: ACTIVE_TASK_RETRY_MESSAGE,
    });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it.each(["40001", "40P01", "CCS01", "CCP01", "CCN01", "42501", "XX999"])(
    "does not retry %s",
    async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: "private database text" },
      });
      const result = await runActiveTaskRpc({ rpc }, "edit_active_event_task", {});
      expect(result.ok).toBe(false);
      expect(rpc).toHaveBeenCalledTimes(1);
      if (!result.ok) expect(result.message).not.toContain("private");
    },
  );

  it("maps the approved stable messages", async () => {
    const expected = new Map([
      ["CCD07", "Choose today or a later due date."],
      ["CCD08", "Choose today or a later duty date."],
      ["CCD09", "Choose today or a later end date."],
      ["CCD05", "The due date cannot be after the event end date."],
      ["CCD02", "The call time cannot be after the event end date."],
      ["CCD03", "The end time cannot be after the event end date."],
      ["CCS01", "This task changed after you loaded it. Reload and try again."],
      ["CCP01", "This event already has the maximum of 200 tasks."],
      ["CCN01", "No changes to save."],
      ["42501", "The task is unavailable."],
    ]);
    for (const [code, message] of expected) {
      const result = await runActiveTaskRpc(
        { rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }) },
        "edit_active_event_task",
        {},
      );
      expect(result).toMatchObject({ ok: false, message });
    }
  });
});
