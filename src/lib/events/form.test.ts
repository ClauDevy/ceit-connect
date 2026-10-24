import { describe, expect, it } from "vitest";
import { parseImportedDueDate, toTaskPayload } from "./form";

const taskDraft = {
  title: "Prepare materials",
  description: "",
  committeeId: "committee-1",
  taskType: "Deliverable" as const,
  dueDate: "2026-10-24",
  callDate: "",
  callTime: "",
  endTime: "",
  priority: "Medium" as const,
  assigneeIds: [],
};

describe("event task due dates", () => {
  it("keeps the yyyy-mm-dd value produced by the date input", () => {
    expect(toTaskPayload("Preparation", taskDraft).due_date).toBe("2026-10-24");
  });

  it.each([
    ["date-only", "2026-10-24"],
    ["timestamp", "2026-10-23T16:30:00.000Z"],
  ])("normalizes an archived-template %s due date before saving", (_, dueDate) => {
    const parsed = parseImportedDueDate(dueDate);

    expect(parsed).toEqual(
      expect.objectContaining({ date: "2026-10-24" }),
    );
    expect(
      toTaskPayload("Preparation", {
        ...taskDraft,
        dueDate: parsed!.date,
      }).due_date,
    ).toBe("2026-10-24");
  });
});
