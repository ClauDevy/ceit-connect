import { describe, expect, it } from "vitest";

import {
  eventFormIsDirty,
  eventFormSaveState,
  type EventFormSaveStateInput,
} from "@/components/events/event-form-dirty-state";
import type { PhaseDraft, TaskDraft } from "@/components/events/event-form-types";

function task(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    id: "task-1",
    persisted: true,
    status: "To Do",
    title: "Prepare venue",
    description: "",
    committeeId: "committee-1",
    taskType: "Deliverable",
    dueDate: "2026-12-01",
    callDate: "",
    callTime: "",
    endDate: "",
    endTime: "",
    priority: "Medium",
    assigneeIds: [],
    dependsOnTaskId: null,
    dependsOnClientKey: null,
    sourceTemplateTaskId: null,
    templateEditable: true,
    ...overrides,
  };
}

function phase(overrides: Partial<PhaseDraft> = {}): PhaseDraft {
  return {
    id: "phase-1",
    name: "Preparation",
    originalName: "Preparation",
    origin: "persisted",
    collapsed: false,
    tasks: [task()],
    ...overrides,
  };
}

function state(overrides: Partial<EventFormSaveStateInput> = {}): EventFormSaveStateInput {
  return {
    name: "Foundation Day",
    description: "Annual event",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    phases: [phase()],
    initialTaskDueDates: new Map([["task-1", "2026-12-01"]]),
    pendingBanner: null,
    templateSummary: null,
    excludedTemplateTaskIds: [],
    ...overrides,
  };
}

describe("event form dirty state", () => {
  it("uses the same clean comparison for Create and Edit state", () => {
    const edit = state();
    expect(eventFormIsDirty(eventFormSaveState(edit), edit)).toBe(false);

    const create = state({
      name: "",
      description: "",
      startDate: "",
      endDate: "",
      phases: [],
      initialTaskDueDates: new Map(),
    });
    expect(eventFormIsDirty(eventFormSaveState(create), create)).toBe(false);
  });

  it("tracks save-relevant event, phase, task, banner, and template changes", () => {
    const initial = state();
    const initialState = eventFormSaveState(initial);

    expect(eventFormIsDirty(initialState, state({ name: "Changed" }))).toBe(true);
    expect(eventFormIsDirty(initialState, state({ phases: [phase({ name: "Event Day" })] }))).toBe(true);
    expect(eventFormIsDirty(initialState, state({ phases: [phase({ tasks: [task({ title: "Changed" })] })] }))).toBe(true);
    expect(eventFormIsDirty(initialState, state({ phases: [] }))).toBe(true);
    expect(eventFormIsDirty(initialState, state({ pendingBanner: new File(["x"], "banner.png", { type: "image/png" }) }))).toBe(true);
    expect(eventFormIsDirty(initialState, state({
      templateSummary: {
        template: { id: "template-1", name: "Past event", startDate: "2025-01-01" },
        importedStartDate: "2026-12-01",
        importedTaskCount: 1,
        skippedConfidentialCount: 0,
        applied: true,
      },
      excludedTemplateTaskIds: ["source-1"],
    }))).toBe(true);
  });

  it("normalizes submitted text and ignores disclosure plus empty unsavable phases", () => {
    const initial = state();
    const initialState = eventFormSaveState(initial);
    expect(eventFormIsDirty(initialState, state({
      name: "  Foundation Day  ",
      description: " Annual event ",
      phases: [
        phase({ collapsed: true }),
        phase({ id: "empty", name: "Draft only", origin: "local", tasks: [] }),
      ],
    }))).toBe(false);
  });

  it("returns clean after a save-relevant change is fully reverted", () => {
    const initial = state();
    const initialState = eventFormSaveState(initial);
    const changed = state({ phases: [phase({ tasks: [task({ priority: "High" })] })] });
    expect(eventFormIsDirty(initialState, changed)).toBe(true);
    expect(eventFormIsDirty(initialState, state())).toBe(false);
  });

  it("treats a dependency-only change as dirty and a reverted dependency as clean", () => {
    const initial = state();
    const initialState = eventFormSaveState(initial);
    expect(eventFormIsDirty(initialState, state({
      phases: [phase({ tasks: [task({ dependsOnTaskId: "task-2" })] })],
    }))).toBe(true);
    expect(eventFormIsDirty(initialState, state())).toBe(false);
  });
});
