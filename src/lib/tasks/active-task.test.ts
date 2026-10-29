import { describe, expect, it, vi } from "vitest";
import {
  ACTIVE_TASK_RETRY_MESSAGE,
  createActiveTaskRpcArgs,
  editActiveTaskRpcArgs,
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
  endTime: "02:00",
  primaryAssigneeIds: [personId],
  isConfidential: true,
  allowedViewerIds: [],
};

describe("active task request contracts", () => {
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
