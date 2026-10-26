import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BoardTask } from "./board";
import {
  getActiveMobileLane,
  getAssignedPhaseTasks,
  getMobileLanePosition,
  toggleCollapsedLane,
} from "./mobile-board";

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: "Task",
    phase: "Setup",
    status: "To Do",
    effective_priority: "Medium",
    due_date: null,
    committee_id: "committee",
    committee_name: "Committee",
    primary_assignees: [],
    assist_assignees: [],
    is_backlog: false,
    is_masked: false,
    ...overrides,
  };
}

describe("mobile board column state", () => {
  it("selects the most visible lane and uses center distance and status order as ties", () => {
    expect(
      getActiveMobileLane([
        { status: "To Do", intersectionRatio: 0.3, centerDistance: 20 },
        { status: "In Progress", intersectionRatio: 0.8, centerDistance: 40 },
        { status: "Completed", intersectionRatio: 0, centerDistance: 0 },
      ]),
    ).toBe("In Progress");
    expect(
      getActiveMobileLane([
        { status: "To Do", intersectionRatio: 0.5, centerDistance: 40 },
        { status: "In Progress", intersectionRatio: 0.5, centerDistance: 10 },
      ]),
    ).toBe("In Progress");
    expect(
      getActiveMobileLane([
        { status: "Completed", intersectionRatio: 0.5, centerDistance: 10 },
        { status: "To Do", intersectionRatio: 0.5, centerDistance: 10 },
      ]),
    ).toBe("To Do");
    expect(getActiveMobileLane([])).toBe("To Do");
  });

  it("collapses lanes independently without mutating the previous set", () => {
    const original = new Set(["To Do"] as const);
    const withSecondLane = toggleCollapsedLane(original, "In Progress");
    expect([...original]).toEqual(["To Do"]);
    expect([...withSecondLane]).toEqual(["To Do", "In Progress"]);
    expect([...toggleCollapsedLane(withSecondLane, "To Do")]).toEqual([
      "In Progress",
    ]);
  });

  it("keeps complete filtered phase data in one ordered lane partition", () => {
    const tasks = [
      task({ id: "todo", status: "To Do" }),
      task({
        id: "masked",
        status: "In Progress",
        effective_priority: null,
        is_masked: true,
      }),
      task({
        id: "other-priority",
        status: "Completed",
        effective_priority: "Low",
      }),
      task({ id: "other-phase", phase: "Live", status: "To Do" }),
      task({ id: "backlog", is_backlog: true }),
    ];
    const assigned = getAssignedPhaseTasks(tasks, "Setup", new Set(["Medium"]));
    expect(assigned.map((item) => item.id)).toEqual(["todo", "masked"]);
    expect(new Set(assigned.map((item) => item.id)).size).toBe(assigned.length);
  });

  it("reports a stable one-based position for the visible cue", () => {
    expect(getMobileLanePosition("To Do")).toBe(1);
    expect(getMobileLanePosition("In Progress")).toBe(2);
    expect(getMobileLanePosition("Completed")).toBe(3);
  });
});

describe("mobile board source contracts", () => {
  const boardSource = readFileSync(
    resolve(process.cwd(), "src/components/events/event-board.tsx"),
    "utf8",
  );
  const cardSource = readFileSync(
    resolve(process.cwd(), "src/components/events/event-board-task-card.tsx"),
    "utf8",
  );

  it("keeps the phone handle outside the real link and limits touch suppression to the handle", () => {
    expect(cardSource.indexOf("<StretchedLink")).toBeLessThan(
      cardSource.indexOf("aria-label={`Drag ${task.title}`}"),
    );
    expect(cardSource).toContain("md:hidden");
    expect(cardSource).toContain("size-11 cursor-grab touch-none select-none");
    expect(cardSource).toContain("[-webkit-touch-callout:none]");
    expect(cardSource).toContain("event.preventDefault()");
    expect(cardSource).toContain("event.stopPropagation()");
  });

  it("restores snapping through the shared finish path and unmount cleanup", () => {
    expect(boardSource).toMatch(
      /const finishDragSession = useCallback[\s\S]*?setSnapSuspended\(false\)/,
    );
    expect(boardSource).toMatch(
      /function handleDragEnd[\s\S]*?finishDragSession\(\)/,
    );
    expect(boardSource).toMatch(
      /function handleDragCancel[\s\S]*?finishDragSession\(\)/,
    );
    expect(boardSource).toContain(
      'mobileBoardRef.current?.removeAttribute("data-dragging")',
    );
    expect(boardSource).toContain('window.addEventListener("pagehide"');
    expect(boardSource).toContain(
      'window.addEventListener("orientationchange"',
    );
    expect(boardSource).toContain('window.addEventListener("resize"');
    expect(boardSource).toContain(
      'document.addEventListener("visibilitychange"',
    );
  });

  it("uses the same refetch pause lock for drag and mutation without a timer", () => {
    expect(boardSource).toContain("tryAcquireBoardOperation(boardBusyRef)");
    expect(boardSource).toContain(
      "refetchOnWindowFocus: () => !boardBusyRef.current",
    );
    expect(boardSource).toContain(
      "getBoardRefetchInterval(boardBusyRef.current)",
    );
    expect(boardSource).not.toContain("setTimeout(finishDragSession");
  });

  it("keeps collapsed lanes mounted as tail-only drop targets", () => {
    expect(boardSource).toContain("collapsed={collapsed}");
    expect(boardSource).toContain(
      "const appendToTail = collapsedLanes.has(overStatus as BoardStatus)",
    );
    expect(boardSource).toContain("appendToTail,");
  });

  it("restarts lane observation when an empty board receives tasks", () => {
    expect(boardSource).toContain("!hasTasks ||");
    expect(boardSource).toContain("}, [hasTasks, query.isPending]);");
  });
});
