// @vitest-environment happy-dom

import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/components/events/event-banner", () => ({
  EventBanner: ({ alt }: { alt: string }) => <div role="img" aria-label={alt} />,
}));

vi.mock("@/components/shared/motion", () => ({
  Collapse: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => <div hidden={!open}>{children}</div>,
  MotionPresence: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? children : null),
  TabPanel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotionPreference: () => false,
  useVisibilityAnimation: () => () => undefined,
}));

vi.mock("@dnd-kit/core", () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: () => ({}),
  useSensors: () => [],
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({
    render,
    children,
  }: {
    render: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <>
      {render}
      {children}
    </>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" role="menuitem" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/sheet", () => {
  const SheetContext = React.createContext(false);
  return {
    Sheet: ({
      open,
      children,
    }: {
      open: boolean;
      children: React.ReactNode;
    }) => <SheetContext.Provider value={open}>{children}</SheetContext.Provider>,
    SheetContent: ({
      children,
      finalFocus,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { finalFocus?: unknown }) => {
      void finalFocus;
      return React.useContext(SheetContext) ? <div {...props}>{children}</div> : null;
    },
    SheetTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 {...props}>{children}</h2>
    ),
    SheetDescription: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{children}</p>
    ),
    SheetClose: ({
      render,
      children,
    }: {
      render: React.ReactNode;
      children: React.ReactNode;
    }) => (
      <>
        {render}
        {children}
      </>
    ),
  };
});

vi.mock("@/components/tasks/active-task-dialog", () => ({
  ActiveTaskDialog: ({ mode }: { mode: "add" | "edit" }) => (
    <div role="dialog">{mode === "add" ? "Add task dialog" : "Edit task dialog"}</div>
  ),
}));

vi.mock("@/components/tasks/completed-phase-reopen-dialog", () => ({
  CompletedPhaseReopenDialog: ({ phase }: { phase: string }) => (
    <button type="button">Reopen {phase}</button>
  ),
}));

import type {
  BoardEvent,
  BoardStatus,
  BoardTask,
} from "@/lib/events/board";
import type { BoardViewer } from "@/lib/events/board-move";
import { EventBoard } from "./event-board";

const EVENT_ID = "10000000-0000-4000-8000-000000000001";
const COMMITTEE_A = "20000000-0000-4000-8000-000000000001";
const COMMITTEE_B = "20000000-0000-4000-8000-000000000002";
const ADMIN_ID = "30000000-0000-4000-8000-000000000001";
const COADMIN_ID = "30000000-0000-4000-8000-000000000002";
const MEMBER_ID = "30000000-0000-4000-8000-000000000003";

const event: BoardEvent = {
  id: EVENT_ID,
  name: "Foundation Week",
  description: "Prepare and run the council event.",
  start_date: "2026-01-10",
  end_date: "2026-01-12",
  banner_url: null,
};

const committees = [
  { id: COMMITTEE_A, name: "Operations" },
  { id: COMMITTEE_B, name: "Engineering" },
];

const viewers = {
  admin: { id: ADMIN_ID, role: "Admin", committeeId: null },
  coadmin: { id: COADMIN_ID, role: "Co-Admin", committeeId: COMMITTEE_A },
  member: { id: MEMBER_ID, role: "Member", committeeId: COMMITTEE_A },
} satisfies Record<string, BoardViewer>;

let taskSequence = 0;

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  taskSequence += 1;
  return {
    id: `40000000-0000-4000-8000-${String(taskSequence).padStart(12, "0")}`,
    title: `Task ${taskSequence}`,
    phase: "Live",
    status: "To Do",
    effective_priority: "Medium",
    due_date: null,
    committee_id: COMMITTEE_A,
    committee_name: "Operations",
    primary_assignees: [],
    assist_assignees: [],
    is_backlog: false,
    is_masked: false,
    phaseComplete: false,
    canReopen: false,
    reopenUpdatedAt: null,
    ...overrides,
  };
}

function readerRow(value: BoardTask) {
  return {
    ...value,
    phase_complete: value.phaseComplete,
    can_reopen: value.canReopen,
    updated_at: value.reopenUpdatedAt,
  };
}

function pendingBoardRequest() {
  return {
    abortSignal: () => new Promise<never>(() => undefined),
  };
}

function resolvedBoardRequest(rows: BoardTask[]) {
  return {
    abortSignal: () =>
      Promise.resolve({ data: rows.map(readerRow), error: null }),
  };
}

function renderBoard({
  initialTasks,
  viewer = viewers.admin,
  boardEvent = event,
}: {
  initialTasks: BoardTask[];
  viewer?: BoardViewer;
  boardEvent?: BoardEvent;
}) {
  return render(
    <EventBoard
      event={boardEvent}
      viewer={viewer}
      committees={committees}
      initialTasks={initialTasks}
      autoArchiveWarning={null}
    />,
  );
}

function expectLaneCount(status: BoardStatus, count: number) {
  const heading = screen.getByRole("heading", { name: status });
  expect(heading.nextElementSibling?.textContent).toBe(String(count));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  taskSequence = 0;
  mocks.rpc.mockReturnValue(pendingBoardRequest());
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "IntersectionObserver",
    class IntersectionObserver {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("EventBoard characterization", () => {
  it("formats the event summary and opens on the first incomplete canonical phase", () => {
    const tasks = [
      task({ title: "Completed setup", phase: "Setup", status: "Completed", phaseComplete: true }),
      task({ title: "Run program", phase: "Live", status: "To Do" }),
      task({ title: "Manage guests", phase: "Live", status: "In Progress" }),
      task({ title: "Unassigned follow-up", phase: null, is_backlog: true }),
    ];

    renderBoard({ initialTasks: tasks });

    expect(screen.getByRole("heading", { level: 1, name: event.name })).toBeDefined();
    expect(screen.getByText("January 10, 2026 – January 12, 2026")).toBeDefined();
    expect(screen.getByText("1 of 4 tasks completed")).toBeDefined();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      expect.stringContaining("Setup"),
      expect.stringContaining("Live"),
      expect.stringContaining("Unphased"),
    ]);
    expect(
      screen
        .getByRole("tab", { name: /Setup complete 1 task/ })
        .getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen.getByRole("tab", { name: /Live 2 tasks/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: /Unphased 1 task/ })).toBeDefined();
    expectLaneCount("To Do", 1);
    expectLaneCount("In Progress", 1);
    expectLaneCount("Completed", 0);
  });

  it("keeps an all-complete phase collapsed until the user expands it", () => {
    renderBoard({
      initialTasks: [
        task({
          title: "Closed task",
          phase: "Setup",
          status: "Completed",
          phaseComplete: true,
          canReopen: true,
          reopenUpdatedAt: "2026-01-12T08:00:00+00:00",
        }),
      ],
    });

    expect(
      screen
        .getByRole("tab", { name: /Setup complete 1 task/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("Phase complete. Great work, team!")).toBeDefined();
    expect(screen.getByRole("button", { name: "Reopen Setup" })).toBeDefined();
    const content = document.getElementById("event-board-completed-phase-content");
    expect(content?.parentElement?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Expand" }));

    expect(content?.parentElement?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByRole("button", { name: "Collapse" })).toBeDefined();
  });

  it.each([
    {
      label: "Admin",
      viewer: viewers.admin,
      actionMenus: 2,
      editItems: 2,
      addTask: true,
      committeeFilter: true,
    },
    {
      label: "Co-Admin",
      viewer: viewers.coadmin,
      actionMenus: 1,
      editItems: 1,
      addTask: true,
      committeeFilter: false,
    },
    {
      label: "Member",
      viewer: viewers.member,
      actionMenus: 1,
      editItems: 0,
      addTask: false,
      committeeFilter: false,
    },
  ])(
    "keeps the $label role-dependent board controls",
    ({ viewer, actionMenus, editItems, addTask, committeeFilter }) => {
      const ownPrimary = viewer.role === "Member"
        ? [{ id: MEMBER_ID, full_name: "Member", avatar_url: null }]
        : [];
      renderBoard({
        viewer,
        initialTasks: [
          task({ title: "Operations task", primary_assignees: ownPrimary }),
          task({
            title: "Engineering task",
            committee_id: COMMITTEE_B,
            committee_name: "Engineering",
          }),
        ],
      });

      expect(screen.queryAllByRole("button", { name: /Task actions for/ })).toHaveLength(
        actionMenus,
      );
      expect(screen.queryAllByRole("menuitem", { name: /Edit task/ })).toHaveLength(
        editItems,
      );
      expect(screen.queryByRole("button", { name: "Add Task" }) !== null).toBe(addTask);
      expect(screen.queryByRole("button", { name: /Committee:/ }) !== null).toBe(
        committeeFilter,
      );
    },
  );

  it("keeps masked tasks confidential and without edit, move, or drag controls", () => {
    renderBoard({
      initialTasks: [
        task({
          title: "Confidential task",
          effective_priority: null,
          is_masked: true,
        }),
      ],
    });

    expect(screen.getByText("Confidential")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Task actions for Confidential task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Drag Confidential task" })).toBeNull();
  });

  it("opens the shared dialog in Add and Edit modes from the board controls", () => {
    renderBoard({ initialTasks: [task({ title: "Editable task" })] });

    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect(screen.getByRole("dialog", { name: "" }).textContent).toBe(
      "Add task dialog",
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Edit task" }));
    expect(screen.getByRole("dialog", { name: "" }).textContent).toBe(
      "Edit task dialog",
    );
  });

  it("opens the backlog, lists its tasks, and claims with the current RPC arguments", async () => {
    const backlogTask = task({
      title: "Unassigned registration desk",
      is_backlog: true,
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "claim_task") {
        return Promise.resolve({
          data: [
            {
              out_task_id: backlogTask.id,
              out_primary_assignees: [MEMBER_ID],
            },
          ],
          error: null,
        });
      }
      if (name === "list_event_board_tasks") {
        return resolvedBoardRequest([backlogTask]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    renderBoard({ initialTasks: [backlogTask], viewer: viewers.member });

    expect(screen.queryByText("Unassigned registration desk")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Backlog, 1 task" }));
    expect(screen.getByRole("dialog", { name: "Task Backlog" })).toBeDefined();
    expect(screen.getByText("Unassigned registration desk")).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claim Task" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.rpc).toHaveBeenCalledWith("claim_task", {
      p_task_id: backlogTask.id,
    });
  });

  it("changes the Admin committee filter through the same board reader", async () => {
    const engineeringTask = task({
      title: "Filtered engineering task",
      committee_id: COMMITTEE_B,
      committee_name: "Engineering",
    });
    mocks.rpc.mockImplementation(
      (name: string, args: { p_committee_id?: string | null }) => {
        if (name !== "list_event_board_tasks") {
          throw new Error(`Unexpected RPC ${name}`);
        }
        return args.p_committee_id === COMMITTEE_B
          ? resolvedBoardRequest([engineeringTask])
          : pendingBoardRequest();
      },
    );
    renderBoard({ initialTasks: [task({ title: "Initial operations task" })] });

    fireEvent.click(screen.getByRole("button", { name: "Committee: All committees" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Engineering" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.rpc).toHaveBeenCalledWith("list_event_board_tasks", {
      p_event_id: EVENT_ID,
      p_committee_id: COMMITTEE_B,
    });
    expect(screen.getByText("Filtered engineering task")).toBeDefined();
    expect(screen.getByRole("button", { name: "Committee: Engineering" })).toBeDefined();
    expect(
      screen.getByText(/Clear the committee filter to drag cards/),
    ).toBeDefined();
  });

  it("shows the board empty state when no tasks are available", () => {
    renderBoard({ initialTasks: [] });

    expect(screen.getByText("No tasks are available")).toBeDefined();
    expect(
      screen.getByText("Try another committee filter or refresh the board."),
    ).toBeDefined();
  });

  it("shows lane-level empty states when the priority filter removes every card", () => {
    renderBoard({ initialTasks: [task({ effective_priority: "High" })] });

    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    fireEvent.click(screen.getByRole("button", { name: "Low" }));

    expect(screen.getAllByText("No tasks match this filter.")).toHaveLength(3);
  });

  it("routes the card Move-to Completed control through the unchanged move RPC", async () => {
    const movable = task({ title: "Move me" });
    let moved = false;
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "move_task") {
        moved = true;
        return Promise.resolve({
          data: [{ task_id: movable.id, status: "Completed", sort_order: 1024 }],
          error: null,
        });
      }
      if (name === "list_event_board_tasks") {
        return resolvedBoardRequest([
          { ...movable, status: moved ? "Completed" : "To Do" },
        ]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    renderBoard({ initialTasks: [movable] });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Completed" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.rpc).toHaveBeenCalledWith("move_task", {
      p_task_id: movable.id,
      p_expected_phase: "Live",
      p_expected_status: "To Do",
      p_destination_status: "Completed",
      p_previous_neighbor_id: null,
      p_next_neighbor_id: null,
    });
  });

  it("rolls a failed move back into its old lane and shows the mapped error", async () => {
    const movable = task({ title: "Rollback task" });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "move_task") {
        return Promise.resolve({
          data: null,
          error: { code: "40001", message: "stale fixture" },
        });
      }
      if (name === "list_event_board_tasks") {
        return resolvedBoardRequest([movable]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    renderBoard({ initialTasks: [movable] });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Completed" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expectLaneCount("To Do", 1);
    expectLaneCount("Completed", 0);
    expect(
      screen.getByText(
        "The board changed before this move finished. It was refreshed; try again.",
      ),
    ).toBeDefined();
  });

  it("offers Undo after a successful move and submits the inverse move before expiry", async () => {
    const movable = task({ title: "Undo task" });
    let authoritativeStatus: BoardStatus = "To Do";
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "move_task") {
        authoritativeStatus = args.p_destination_status as BoardStatus;
        return Promise.resolve({
          data: [
            {
              task_id: movable.id,
              status: authoritativeStatus,
              sort_order: 1024,
            },
          ],
          error: null,
        });
      }
      if (name === "list_event_board_tasks") {
        return resolvedBoardRequest([
          { ...movable, status: authoritativeStatus },
        ]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    renderBoard({ initialTasks: [movable] });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Completed" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Moved to Completed")).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });

    const moveCalls = mocks.rpc.mock.calls.filter(([name]) => name === "move_task");
    expect(moveCalls).toHaveLength(2);
    expect(moveCalls[1]).toEqual([
      "move_task",
      {
        p_task_id: movable.id,
        p_expected_phase: "Live",
        p_expected_status: "Completed",
        p_destination_status: "To Do",
        p_previous_neighbor_id: null,
        p_next_neighbor_id: null,
      },
    ]);
  });
});
