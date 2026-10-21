import { describe, expect, it } from "vitest";
import {
  confidentialityViewerIds,
  getTaskEditErrorMessage,
  isTaskEditControlData,
} from "./edit-controls";

const validControls = {
  can_set_dependency: true,
  can_set_confidentiality: true,
  depends_on_task_id: null,
  is_confidential: false,
  allowed_viewers: [],
  dependency_options: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      label: "Confidential Task",
      status: "To Do",
    },
  ],
  viewer_options: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      full_name: "Viewer",
      avatar_url: null,
    },
  ],
};

describe("isTaskEditControlData", () => {
  it("accepts the safe edit-control shape", () => {
    expect(isTaskEditControlData(validControls)).toBe(true);
  });

  it("rejects a dependency option with an invalid status", () => {
    expect(
      isTaskEditControlData({
        ...validControls,
        dependency_options: [
          { ...validControls.dependency_options[0], status: "Blocked" },
        ],
      }),
    ).toBe(false);
  });

  it("requires confidentiality-only fields to be hidden when denied", () => {
    expect(
      isTaskEditControlData({
        ...validControls,
        can_set_confidentiality: false,
        is_confidential: null,
        allowed_viewers: [],
        viewer_options: [],
      }),
    ).toBe(true);
    expect(
      isTaskEditControlData({
        ...validControls,
        can_set_confidentiality: false,
        is_confidential: true,
      }),
    ).toBe(false);
  });
});

describe("confidentialityViewerIds", () => {
  it("clears viewers when confidentiality is off", () => {
    expect(confidentialityViewerIds(false, ["one", "two"])).toEqual([]);
  });

  it("deduplicates confidential viewer ids", () => {
    expect(confidentialityViewerIds(true, ["one", "one", "two"])).toEqual([
      "one",
      "two",
    ]);
  });
});

describe("getTaskEditErrorMessage", () => {
  it("preserves safe dependency errors", () => {
    expect(
      getTaskEditErrorMessage(
        { message: "This dependency would create a cycle." },
        "dependency",
      ),
    ).toBe("This dependency would create a cycle.");
  });

  it("maps an unavailable prerequisite before the generic permission error", () => {
    expect(
      getTaskEditErrorMessage(
        {
          code: "42501",
          message: "The selected prerequisite task is unavailable.",
        },
        "dependency",
      ),
    ).toBe(
      "That prerequisite is no longer available. Choose another or clear it.",
    );
  });

  it("maps permission and stale errors without leaking details", () => {
    expect(
      getTaskEditErrorMessage({ code: "42501" }, "confidentiality"),
    ).toBe("You no longer have permission to make this change.");
    expect(getTaskEditErrorMessage({ code: "40001" }, "dependency")).toBe(
      "The task changed. Refresh the page and try again.",
    );
  });
});
