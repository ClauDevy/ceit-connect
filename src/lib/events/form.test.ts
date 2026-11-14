import { describe, expect, it } from "vitest";
import {
  EVENT_ASSIGNEE_LIMIT_MESSAGE,
  buildEventPhaseViews,
  buildCompleteEventPhaseOrder,
  eventFormPhasesAreValid,
  excludeCompletedPhaseTaskMutations,
  getEventFormSummary,
  getEventPhaseCardKey,
  getEventPhaseControls,
  getCommitteeScopedEventAssignees,
  getEventTaskDueDateForSubmission,
  getEventTaskEndDateInputValue,
  getInitialEventTaskCommitteeId,
  getLiveOperationScheduleProblem,
  getSavableEventPhaseName,
  normalizeEventPhaseName,
  parseImportedDueDate,
  toTaskPayload,
  updateEventAssigneeSelection,
} from "./form";

const taskDraft = {
  title: "Prepare materials",
  description: "",
  committeeId: "committee-1",
  taskType: "Deliverable" as const,
  dueDate: "2026-10-24",
  callDate: "",
  callTime: "",
  endDate: "",
  endTime: "",
  priority: "Medium" as const,
  assigneeIds: [],
};

describe("completed Draft phases", () => {
  it("excludes every task mutation in a completed phase without touching other phases", () => {
    const phases = [
      { id: "a", name: "Done", originalName: "Done", origin: "persisted" as const, tasks: [{ id: "one", persisted: true }] },
      { id: "b", name: "Open", originalName: "Open", origin: "persisted" as const, tasks: [{ id: "two", persisted: true }] },
    ];
    expect(excludeCompletedPhaseTaskMutations(phases, new Set(["Done"])).map(({ task }) => task.id)).toEqual(["two"]);
  });
});

describe("event task due dates", () => {
  it("keeps the yyyy-mm-dd value produced by the date input", () => {
    expect(toTaskPayload("Preparation", taskDraft).due_date).toBe("2026-10-24");
  });

  it("submits no Due date for a new Live Operation but preserves an existing stored date", () => {
    const liveTask = { ...taskDraft, taskType: "LiveOperation" as const };
    expect(toTaskPayload("Operations", liveTask).due_date).toBeNull();
    expect(toTaskPayload("Operations", liveTask, "2026-10-24").due_date).toBe("2026-10-24");
    expect(getEventTaskDueDateForSubmission(liveTask, "2026-10-24")).toBe("2026-10-24");
  });

  it("keeps an edited Deliverable Due date in state while an existing task switched to Live Operation submits the stored date", () => {
    const edited = {
      ...taskDraft,
      dueDate: "2026-11-20",
      taskType: "LiveOperation" as const,
    };
    expect(edited.dueDate).toBe("2026-11-20");
    expect(toTaskPayload("Operations", edited, "2026-10-24").due_date).toBe("2026-10-24");
  });

  it("keeps untouched existing schedule payloads byte-for-byte equivalent", () => {
    const existing = {
      ...taskDraft,
      taskType: "LiveOperation" as const,
      dueDate: "2026-10-24",
      callDate: "2026-11-01",
      callTime: "23:00",
      endDate: "2026-11-02",
      endTime: "02:00",
    };
    expect(toTaskPayload("Operations", existing, existing.dueDate)).toEqual({
      title: "Prepare materials",
      description: null,
      phase: "Operations",
      committee_id: "committee-1",
      task_type: "LiveOperation",
      due_date: "2026-10-24",
      call_time: "2026-11-01T15:00:00.000Z",
      end_time: "2026-11-01T18:00:00.000Z",
      priority: "Medium",
      assignee_ids: [],
    });
  });

  it("leaves same-day End date blank and preserves an overnight date", () => {
    expect(getEventTaskEndDateInputValue({
      callDate: "2026-11-01",
      endDate: "2026-11-01",
      endTime: "18:00",
    })).toBe("");
    expect(getEventTaskEndDateInputValue({
      callDate: "2026-11-01",
      endDate: "2026-11-02",
      endTime: "02:00",
    })).toBe("2026-11-02");
  });

  it("serializes a Live Operation end time on a later Manila date", () => {
    expect(
      toTaskPayload("Operations", {
        ...taskDraft,
        taskType: "LiveOperation",
        callDate: "2026-11-01",
        callTime: "23:00",
        endDate: "2026-11-02",
        endTime: "02:00",
      }),
    ).toMatchObject({
      call_time: "2026-11-01T15:00:00.000Z",
      end_time: "2026-11-01T18:00:00.000Z",
    });
  });

  it.each([
    [
      "an end date before the duty date",
      { callDate: "2026-11-02", callTime: "23:00", endDate: "2026-11-01", endTime: "23:30" },
      { field: "end-date", message: "End date cannot be before the duty date." },
    ],
    [
      "a same-date end time before the call time",
      { callDate: "2026-11-02", callTime: "23:00", endDate: "2026-11-02", endTime: "22:59" },
      { field: "end-time", message: "End time cannot be before call time." },
    ],
  ])("focuses the exact field for %s", (_, schedule, expected) => {
    expect(
      getLiveOperationScheduleProblem({
        ...taskDraft,
        taskType: "LiveOperation",
        ...schedule,
      }),
    ).toEqual(expected);
  });

  it.each([
    [
      "missing duty date",
      { callDate: "", callTime: "23:00", endDate: "", endTime: "" },
      { field: "call-date", message: "Choose a Duty date when adding a Live Operation schedule." },
    ],
    [
      "missing call time",
      { callDate: "2026-11-01", callTime: "", endDate: "", endTime: "02:00" },
      { field: "call-time", message: "Choose a Call time when adding a Live Operation schedule." },
    ],
  ])("reports the exact field for a partial schedule with %s", (_, schedule, expected) => {
    expect(
      getLiveOperationScheduleProblem({
        ...taskDraft,
        taskType: "LiveOperation",
        ...schedule,
      }),
    ).toEqual(expected);
  });

  it("requires an end time only when a new or edited task sets an end date", () => {
    expect(
      getLiveOperationScheduleProblem({
        ...taskDraft,
        taskType: "LiveOperation",
        callDate: "2026-11-01",
        callTime: "23:00",
        endDate: "2026-11-02",
      }),
    ).toEqual({
      field: "end-time",
      message: "Choose an end time when setting an end date.",
    });

    expect(
      toTaskPayload("Operations", {
        ...taskDraft,
        taskType: "LiveOperation",
        callDate: "2026-11-01",
        callTime: "23:00",
        endDate: "2026-11-02",
      }).end_time,
    ).toBeNull();
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

describe("event task picker safety", () => {
  it("starts an Admin task with no committee selected", () => {
    expect(getInitialEventTaskCommitteeId("Admin", [
      { id: "committee-a" },
      { id: "committee-b" },
    ])).toBe("");
  });

  it("keeps a Co-Admin's verified committee fixed", () => {
    expect(getInitialEventTaskCommitteeId("Co-Admin", [{ id: "committee-a" }])).toBe("committee-a");
  });
  it("fails a committee-less Co-Admin closed without reading index zero", () => {
    expect(getInitialEventTaskCommitteeId("Co-Admin", [])).toBe("");
  });

  it("rejects a single 101st assignee with the board message", () => {
    const selected = Array.from({ length: 100 }, (_, index) => `person-${index}`);
    expect(updateEventAssigneeSelection(selected, "person-101", true)).toEqual({
      ids: selected,
      error: EVENT_ASSIGNEE_LIMIT_MESSAGE,
    });
  });

  it("keeps bulk candidates scoped to the selected committee", () => {
    const people = [
      { id: "a", committee_id: "committee-a" },
      { id: "b", committee_id: "committee-b" },
      { id: "c", committee_id: "committee-a" },
    ];
    expect(
      getCommitteeScopedEventAssignees(people, "committee-a").map(({ id }) => id),
    ).toEqual(["a", "c"]);
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

  it("locks a Co-Admin template phase containing a server-derived task", () => {
    const [phase] = buildEventPhaseViews(
      [
        {
          id: "template-phase",
          name: "Shared phase",
          originalName: "Shared phase",
          origin: "local" as const,
          tasks: [
            {
              id: "foreign-template-task",
              persisted: false,
              templateEditable: false,
            },
          ],
        },
      ],
      [],
    );

    expect(
      getEventPhaseControls({
        role: "Co-Admin",
        isDraft: false,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: true,
        phase,
        readOnlyTasks: [],
      }),
    ).toMatchObject({ canRename: false, canRemove: false });
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

  it("uses stable identity for Unphased and permits an in-progress persisted rename", () => {
    const namedPhase = {
      id: "planning",
      name: "",
      originalName: "Planning",
      origin: "persisted" as const,
      tasks: [{ id: "task", persisted: true }],
    };
    const [namedView] = buildEventPhaseViews([namedPhase], []);
    expect(
      getEventPhaseControls({
        role: "Admin",
        isDraft: false,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: false,
        phase: namedView,
        readOnlyTasks: [],
      }).canRename,
    ).toBe(true);
    expect(getSavableEventPhaseName(namedPhase)).toBe("Planning");
    expect(eventFormPhasesAreValid([namedPhase])).toBe(true);

    const unphased = { ...namedPhase, originalName: "Unphased" };
    const [unphasedView] = buildEventPhaseViews([unphased], []);
    expect(
      getEventPhaseControls({
        role: "Admin",
        isDraft: false,
        readerAvailable: true,
        hasExactlyOneTaskCommittee: false,
        phase: unphasedView,
        readOnlyTasks: [],
      }).canRename,
    ).toBe(false);
  });

  it("builds reorder actions from the complete server sequence", () => {
    expect(
      buildCompleteEventPhaseOrder({
        serverOrder: ["Visible A", "Hidden", "Visible B", "Unphased"],
        visibleOrder: ["Visible B", "Visible A"],
        phaseActions: [],
      }),
    ).toEqual(["Visible B", "Hidden", "Visible A", "Unphased"]);
    expect(
      buildCompleteEventPhaseOrder({
        serverOrder: ["Visible A", "Hidden", "Visible B"],
        visibleOrder: ["Renamed", "Visible B", "New"],
        phaseActions: [
          { type: "rename", phase: "Visible A", next_phase: "Renamed" },
        ],
      }),
    ).toEqual(["Renamed", "Hidden", "Visible B", "New"]);
    expect(
      buildCompleteEventPhaseOrder({
        serverOrder: ["A", "B", "C"],
        visibleOrder: ["C", "B"],
        phaseActions: [
          { type: "rename", phase: "A", next_phase: "C" },
        ],
        applyVisibleOrder: false,
      }),
    ).toEqual(["B", "C"]);
  });
});
