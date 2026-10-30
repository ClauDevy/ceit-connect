import { describe, expect, it } from "vitest";
import {
  buildEventPhaseViews,
  getEventFormSummary,
  getEventPhaseCardKey,
  getEventPhaseControls,
  normalizeEventPhaseName,
  parseImportedDueDate,
  toTaskPayload,
} from "./form";

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

describe("Draft editor phase presentation", () => {
  it("normalizes phase names exactly like the database", () => {
    expect(normalizeEventPhaseName("  Planning  ")).toBe("Planning");
    expect(normalizeEventPhaseName("Plan   Work")).toBe("Plan   Work");
    expect(normalizeEventPhaseName("planning")).toBe("planning");
    expect(normalizeEventPhaseName("   ")).toBe("Unphased");
    expect(normalizeEventPhaseName(null)).toBe("Unphased");
  });

  it("merges editable and latest reader rows by trimmed, case-sensitive phase name", () => {
    const editablePhases = [
      {
        id: "phase-1",
        name: " Planning ",
        originalName: "Planning",
        origin: "persisted" as const,
        tasks: [{ id: "own-1", persisted: true }],
      },
    ];
    const firstReaderRows = [
      { out_task_id: "other-1", out_phase: "Planning" },
      { out_task_id: "masked-1", out_phase: " Planning " },
      { out_task_id: "lowercase-1", out_phase: "planning" },
    ];

    const firstViews = buildEventPhaseViews(editablePhases, firstReaderRows);
    expect(firstViews.map((phase) => phase.name)).toEqual([
      "Planning",
      "planning",
    ]);
    expect(firstViews[0]).toMatchObject({
      editablePhases,
      isReaderShell: false,
    });
    expect(firstViews[0].name).toBe("Planning");
    expect(firstViews[0].editablePhases[0].name).toBe(" Planning ");
    expect(firstViews[0].readOnlyTasks.map((task) => task.out_task_id)).toEqual([
      "other-1",
      "masked-1",
    ]);

    const refreshedViews = buildEventPhaseViews(editablePhases, [
      { out_task_id: "other-2", out_phase: "Planning" },
    ]);
    expect(
      refreshedViews[0].readOnlyTasks.map((task) => task.out_task_id),
    ).toEqual(["other-2"]);
  });

  it("deduplicates summary tasks, excludes deletions, and counts masked shells", () => {
    const summary = getEventFormSummary(
      [
        {
          id: "phase-1",
          name: " Planning ",
          originalName: "Planning",
          origin: "persisted",
          tasks: [
            { id: "persisted-1", persisted: true },
            { id: "local-1", persisted: false },
          ],
        },
        {
          id: "phase-2",
          name: "Unphased",
          originalName: "Unphased",
          origin: "local",
          tasks: [{ id: "deleted-1", persisted: true }],
        },
      ],
      [
        { out_task_id: "persisted-1", out_phase: "Planning" },
        { out_task_id: "masked-1", out_phase: "  Unphased  " },
      ],
      new Set(["deleted-1"]),
    );

    expect(summary).toEqual({ phaseCount: 2, taskCount: 3, hasTasks: true });
  });

  it("keeps reader shells local and emits no rename or delete phase action", () => {
    const shell = {
      id: "reader-shell-1",
      name: "Shared phase",
      originalName: "Shared phase",
      origin: "reader-shell" as const,
      tasks: [{ id: "local-1", persisted: false }],
    };
    const [withReader] = buildEventPhaseViews(
      [shell],
      [{ out_task_id: "other-1", out_phase: "Shared phase" }],
    );
    expect(
      getEventPhaseControls({
        role: "Co-Admin",
        isDraft: true,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: true,
        phase: withReader,
        readOnlyTasks: withReader.readOnlyTasks,
      }),
    ).toEqual({
      canAddTask: true,
      canRename: false,
      canRemove: false,
      queuesPhaseAction: false,
    });

    const [afterReaderDisappears] = buildEventPhaseViews([shell], []);
    expect(afterReaderDisappears.isReaderShell).toBe(false);
    expect(
      getEventPhaseControls({
        role: "Co-Admin",
        isDraft: true,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: true,
        phase: afterReaderDisappears,
        readOnlyTasks: [],
      }),
    ).toMatchObject({
      canAddTask: true,
      canRename: true,
      canRemove: true,
      queuesPhaseAction: false,
    });

    expect(
      buildEventPhaseViews(
        [{ ...shell, tasks: [] }],
        [],
      ),
    ).toEqual([]);
  });

  it("fails Co-Admin Add task closed without exactly one committee", () => {
    const [phase] = buildEventPhaseViews(
      [
        {
          id: "phase-1",
          name: "Planning",
          originalName: "Planning",
          origin: "persisted",
          tasks: [],
        },
      ],
      [],
    );

    expect(
      getEventPhaseControls({
        role: "Co-Admin",
        isDraft: true,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: false,
        phase,
        readOnlyTasks: [],
      }).canAddTask,
    ).toBe(false);
  });

  it("keys a merged card by its first editable phase and keeps every editable phase present", () => {
    const first = {
      id: "stable-first",
      name: " Planning ",
      originalName: "Planning",
      origin: "persisted" as const,
      tasks: [],
    };
    const second = {
      id: "stable-second",
      name: "Planning",
      originalName: "Other phase",
      origin: "persisted" as const,
      tasks: [],
    };
    const [beforeJoin] = buildEventPhaseViews([first], []);
    const [merged] = buildEventPhaseViews([first, second], []);

    expect(getEventPhaseCardKey(beforeJoin)).toBe("stable-first");
    expect(getEventPhaseCardKey(merged)).toBe("stable-first");
    expect(merged.editablePhases.map((phase) => phase.id)).toEqual([
      "stable-first",
      "stable-second",
    ]);

    const afterTyping = buildEventPhaseViews(
      [{ ...first, name: "Planning next" }, second],
      [],
    );
    expect(
      afterTyping.flatMap((phase) =>
        phase.editablePhases.map((editablePhase) => editablePhase.id),
      ),
    ).toEqual(["stable-first", "stable-second"]);
    expect(getEventPhaseCardKey(afterTyping[0])).toBe("stable-first");

    const readerOnly = buildEventPhaseViews(
      [],
      [{ out_task_id: "reader-1", out_phase: "Reader phase" }],
    )[0];
    expect(getEventPhaseCardKey(readerOnly)).toBe("Reader phase");
  });

  it("locks mixed phases by original name without reacting to the live typed name", () => {
    const readerRows = [
      { out_task_id: "reader-1", out_phase: "Shared phase" },
    ];
    const ownOnlyPhase = {
      id: "own-only",
      name: "Shared phase",
      originalName: "Original own phase",
      origin: "persisted" as const,
      tasks: [],
    };
    const [liveCollision] = buildEventPhaseViews([ownOnlyPhase], readerRows);

    expect(
      getEventPhaseControls({
        role: "Co-Admin",
        isDraft: true,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: true,
        phase: liveCollision,
        readOnlyTasks: readerRows,
      }).canRename,
    ).toBe(true);

    const originallyMixed = {
      ...ownOnlyPhase,
      name: "Temporarily typed elsewhere",
      originalName: "Shared phase",
    };
    const mixedView = buildEventPhaseViews([originallyMixed], readerRows).find(
      (phase) => phase.editablePhases.length > 0,
    )!;
    expect(
      getEventPhaseControls({
        role: "Co-Admin",
        isDraft: true,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: true,
        phase: mixedView,
        readOnlyTasks: readerRows,
      }).canRename,
    ).toBe(false);
  });

  it("keeps a blank raw phase name in state and normalizes only for matching and save", () => {
    const blankPhase = {
      id: "blank-phase",
      name: "",
      originalName: "Planning",
      origin: "persisted" as const,
      tasks: [],
    };
    const [view] = buildEventPhaseViews([blankPhase], []);

    expect(view.name).toBe("Unphased");
    expect(view.editablePhases[0].name).toBe("");
    expect(toTaskPayload("", taskDraft).phase).toBe("");
  });
});
