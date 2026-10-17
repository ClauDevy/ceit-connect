import { describe, expect, it } from "vitest";
import type { BoardStatus, BoardTask } from "./board";
import {
  applyOptimisticMove,
  BOARD_POLL_INTERVAL_MS,
  BOARD_UNDO_WINDOW_MS,
  captureTaskNeighbors,
  createDropMoveIntent,
  createStatusMoveIntent,
  createUndoEntry,
  createUndoIntent,
  getBoardRefetchInterval,
  getMovePermission,
  getNeighborHints,
  mapMoveError,
  undoReducer,
  type UndoState,
} from "./board-move";

function task(
  id: string,
  status: BoardStatus,
  options: Partial<BoardTask> = {},
): BoardTask {
  return {
    id,
    title: id,
    phase: "Setup",
    status,
    effective_priority: "Medium",
    due_date: null,
    committee_id: "committee-a",
    committee_name: "Committee A",
    primary_assignees: [],
    assist_assignees: [],
    is_backlog: false,
    is_masked: false,
    ...options,
  };
}

const admin = { id: "admin", role: "Admin" as const, committeeId: null };

describe("board move permissions", () => {
  const assigned = task("assigned", "To Do", {
    primary_assignees: [
      { id: "member", full_name: "Member", avatar_url: null },
    ],
  });

  it("gives Admins and owning Co-Admins reorder permission", () => {
    expect(getMovePermission(assigned, admin)).toBe("reorder");
    expect(
      getMovePermission(assigned, {
        id: "coadmin",
        role: "Co-Admin",
        committeeId: "committee-a",
      }),
    ).toBe("reorder");
  });

  it("gives only assigned Members status permission", () => {
    expect(
      getMovePermission(assigned, {
        id: "member",
        role: "Member",
        committeeId: "committee-b",
      }),
    ).toBe("status");
    expect(
      getMovePermission(assigned, {
        id: "other-member",
        role: "Member",
        committeeId: "committee-a",
      }),
    ).toBe("none");
  });

  it("denies other-committee Co-Admins and every masked shell", () => {
    expect(
      getMovePermission(assigned, {
        id: "coadmin",
        role: "Co-Admin",
        committeeId: "committee-b",
      }),
    ).toBe("none");
    expect(getMovePermission({ ...assigned, is_masked: true }, admin)).toBe(
      "none",
    );
  });
});

describe("neighbor hints and optimistic placement", () => {
  it("computes empty, first, middle, and last boundaries", () => {
    expect(getNeighborHints([], 0)).toEqual({
      previousNeighborId: null,
      nextNeighborId: null,
    });
    expect(getNeighborHints(["a", "b"], 0)).toEqual({
      previousNeighborId: null,
      nextNeighborId: "a",
    });
    expect(getNeighborHints(["a", "b"], 1)).toEqual({
      previousNeighborId: "a",
      nextNeighborId: "b",
    });
    expect(getNeighborHints(["a", "b"], 2)).toEqual({
      previousNeighborId: "b",
      nextNeighborId: null,
    });
  });

  it("captures the moved task's original middle and boundary neighbors", () => {
    const tasks = [task("a", "To Do"), task("b", "To Do"), task("c", "To Do")];
    expect(captureTaskNeighbors(tasks, "a")).toEqual({
      previousNeighborId: null,
      nextNeighborId: "b",
    });
    expect(captureTaskNeighbors(tasks, "b")).toEqual({
      previousNeighborId: "a",
      nextNeighborId: "c",
    });
    expect(captureTaskNeighbors(tasks, "c")).toEqual({
      previousNeighborId: "b",
      nextNeighborId: null,
    });
  });

  it("computes same-lane drop hints from the complete ordered lane", () => {
    const tasks = [
      task("a", "To Do"),
      task("hidden-by-filter", "To Do", { effective_priority: "Low" }),
      task("c", "To Do"),
    ];
    expect(
      createDropMoveIntent({
        tasks,
        taskId: "c",
        destinationStatus: "To Do",
        overTaskId: "a",
        permission: "reorder",
      }),
    ).toMatchObject({
      previousNeighborId: null,
      nextNeighborId: "a",
    });
    expect(
      createDropMoveIntent({
        tasks: [...tasks, task("moving", "In Progress")],
        taskId: "moving",
        destinationStatus: "To Do",
        overTaskId: "c",
        permission: "reorder",
      }),
    ).toMatchObject({
      previousNeighborId: "hidden-by-filter",
      nextNeighborId: "c",
    });
  });

  it("makes Member and menu status changes tail-only", () => {
    const moving = task("moving", "To Do");
    expect(createStatusMoveIntent(moving, "Completed")).toEqual({
      taskId: "moving",
      phase: "Setup",
      expectedStatus: "To Do",
      destinationStatus: "Completed",
      previousNeighborId: null,
      nextNeighborId: null,
    });
    expect(
      createDropMoveIntent({
        tasks: [moving, task("done", "Completed")],
        taskId: "moving",
        destinationStatus: "Completed",
        overTaskId: "done",
        permission: "status",
      }),
    ).toMatchObject({ previousNeighborId: null, nextNeighborId: null });
  });

  it("optimistically places between hints and at a destination tail", () => {
    const tasks = [
      task("a", "To Do"),
      task("b", "To Do"),
      task("c", "In Progress"),
    ];
    const between = applyOptimisticMove(tasks, {
      taskId: "a",
      phase: "Setup",
      expectedStatus: "To Do",
      destinationStatus: "To Do",
      previousNeighborId: "b",
      nextNeighborId: null,
    });
    expect(
      between.filter((item) => item.status === "To Do").map((item) => item.id),
    ).toEqual(["b", "a"]);

    const tail = applyOptimisticMove(tasks, {
      taskId: "a",
      phase: "Setup",
      expectedStatus: "To Do",
      destinationStatus: "In Progress",
      previousNeighborId: null,
      nextNeighborId: null,
    });
    expect(
      tail
        .filter((item) => item.status === "In Progress")
        .map((item) => item.id),
    ).toEqual(["c", "a"]);
  });
});

describe("polling and focus protection", () => {
  it("pauses visible polling while a move or Undo is in flight", () => {
    expect(getBoardRefetchInterval(true)).toBe(false);
    expect(getBoardRefetchInterval(false)).toBe(BOARD_POLL_INTERVAL_MS);
  });
});

describe("move error mapping", () => {
  it("maps stale and permission SQLSTATEs", () => {
    expect(mapMoveError({ code: "40001", message: "stale" }).kind).toBe(
      "stale",
    );
    expect(mapMoveError({ code: "42501", message: "denied" }).kind).toBe(
      "permission",
    );
  });

  it("preserves the safe dependency and Archived messages", () => {
    expect(
      mapMoveError({
        code: "P0001",
        message:
          "Complete the prerequisite task before moving this task forward.",
      }),
    ).toEqual({
      kind: "dependency",
      message: "Complete the prerequisite task before moving this task forward.",
    });
    expect(
      mapMoveError({
        code: "P0001",
        message: "Tasks in Archived events are read-only.",
      }).kind,
    ).toBe("archived");
  });

  it("maps network and unknown failures without exposing arbitrary text", () => {
    expect(mapMoveError(new Error("Failed to fetch")).kind).toBe("offline");
    expect(mapMoveError(new Error("secret backend detail")).kind).toBe(
      "unknown",
    );
  });
});

describe("Undo state machine", () => {
  const original = task("a", "To Do");
  const intent = {
    taskId: "a",
    phase: "Setup",
    expectedStatus: "To Do" as const,
    destinationStatus: "In Progress" as const,
    previousNeighborId: null,
    nextNeighborId: null,
  };
  const entry = createUndoEntry(
    original,
    intent,
    { previousNeighborId: "before", nextNeighborId: "after" },
    1_000,
  );

  it("offers an eight-second entry and makes cross-lane Undo tail-only", () => {
    expect(entry.expiresAt).toBe(1_000 + BOARD_UNDO_WINDOW_MS);
    expect(createUndoIntent(entry)).toMatchObject({
      expectedStatus: "In Progress",
      destinationStatus: "To Do",
      previousNeighborId: null,
      nextNeighborId: null,
    });
  });

  it("retains middle, first, and last boundaries for same-lane Undo", () => {
    const cases = [
      { previousNeighborId: "before", nextNeighborId: "after" },
      { previousNeighborId: null, nextNeighborId: "first" },
      { previousNeighborId: "last", nextNeighborId: null },
    ];
    for (const neighbors of cases) {
      expect(
        createUndoIntent({
          ...entry,
          fromStatus: "To Do",
          toStatus: "To Do",
          ...neighbors,
        }),
      ).toMatchObject(neighbors);
    }
  });

  it("transitions through offer, undo, success, failure, and expiry", () => {
    const empty: UndoState = { entries: [], undoingTaskId: null };
    const offered = undoReducer(empty, { type: "offer", entry });
    expect(offered.entries).toEqual([entry]);
    const undoing = undoReducer(offered, { type: "undo-start", taskId: "a" });
    expect(undoing.undoingTaskId).toBe("a");
    expect(
      undoReducer(undoing, { type: "undo-success", taskId: "a" }),
    ).toEqual({ entries: [], undoingTaskId: null });
    expect(
      undoReducer(undoing, { type: "undo-failure", taskId: "a" }),
    ).toEqual({ entries: [], undoingTaskId: null });
    expect(
      undoReducer(offered, {
        type: "expire",
        taskId: "a",
        expiresAt: entry.expiresAt,
      }).entries,
    ).toEqual([]);
  });

  it("does not let an old timer expire a replacement entry", () => {
    const replacement = { ...entry, expiresAt: entry.expiresAt + 1_000 };
    const state = undoReducer(
      { entries: [entry], undoingTaskId: null },
      { type: "offer", entry: replacement },
    );
    expect(
      undoReducer(state, {
        type: "expire",
        taskId: "a",
        expiresAt: entry.expiresAt,
      }).entries,
    ).toEqual([replacement]);
  });
});
