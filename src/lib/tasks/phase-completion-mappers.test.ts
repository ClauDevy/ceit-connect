import { describe, expect, it, vi } from "vitest";
import { mapMoveError } from "../events/board-move";
import { getEventSaveErrorMessage } from "../events/save-error";
import { runActiveTaskRpc } from "./active-task";
import { getTaskBackupErrorMessage } from "./backup";
import { getTaskCommentErrorMessage } from "./comments";
import { getTaskEditErrorMessage } from "./edit-controls";
import { getTaskLeaveErrorMessage } from "./leave";
import { PHASE_COMPLETION_ERROR_MESSAGES } from "./phase-completion";
import { getWorkLinkErrorMessage } from "./work-links";

describe("phase-completion additions to action mappers", () => {
  it("adds a fixed CCQ message to every task and Event Edit mapper", async () => {
    const error = { code: "CCQ03", message: "private backend text" };
    const expected = PHASE_COMPLETION_ERROR_MESSAGES.CCQ03;
    expect(mapMoveError(error).message).toBe(expected);
    expect(getEventSaveErrorMessage(error)).toBe(expected);
    expect(getTaskEditErrorMessage(error, "dependency")).toBe(expected);
    expect(getWorkLinkErrorMessage(error, "add")).toBe(expected);
    expect(getTaskCommentErrorMessage(error, "add")).toBe(expected);
    expect(getTaskBackupErrorMessage("claim", error)).toBe(expected);
    expect(getTaskLeaveErrorMessage(error)).toBe(expected);
    await expect(runActiveTaskRpc(
      { rpc: vi.fn().mockResolvedValue({ data: null, error }) },
      "edit_active_event_task",
      {},
    )).resolves.toMatchObject({ ok: false, message: expected });
  });

  it("keeps every pre-existing retry mapping byte-identical", async () => {
    expect(mapMoveError({ code: "40001" }).message).toBe("The board changed before this move finished. It was refreshed; try again.");
    expect(getEventSaveErrorMessage({ code: "40P01", message: "private" })).toBe("Another task change happened at the same time. Please try saving again.");
    expect(getTaskEditErrorMessage({ code: "40001" }, "dependency")).toBe("The task changed. Refresh the page and try again.");
    expect(getTaskCommentErrorMessage({ code: "40001" }, "add")).toBe("Comments changed while saving. Refresh and try again.");
    expect(getTaskCommentErrorMessage({ code: "40P01" }, "add")).toBe("Comments are busy right now. Refresh and try again.");
    expect(getTaskBackupErrorMessage("claim", { code: "40001" })).toBe("The task changed. Refresh and try again.");
    expect(getTaskBackupErrorMessage("claim", { code: "40P01" })).toBe("The task is busy. Refresh and try again.");
    expect(getTaskLeaveErrorMessage({ code: "40001" })).toBe("This leave request changed. Refresh and try again.");
    await expect(runActiveTaskRpc(
      { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "40001" } }) },
      "edit_active_event_task",
      {},
    )).resolves.toMatchObject({ message: "The task changed while saving. Refresh and try again." });
  });
});
