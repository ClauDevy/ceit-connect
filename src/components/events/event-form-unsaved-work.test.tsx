// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [],
    isPending: false,
    isError: false,
    refetch: vi.fn().mockResolvedValue({ data: [] }),
  }),
  useQueryClient: () => ({ refetchQueries: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/components/events/event-form-fundamentals", () => ({
  EventFormFundamentals: ({
    name,
    startDate,
    endDate,
    onNameChange,
    onStartDateChange,
    onEndDateChange,
  }: {
    name: string;
    startDate: string;
    endDate: string;
    onNameChange: (value: string) => void;
    onStartDateChange: (value: string) => void;
    onEndDateChange: (value: string) => void;
  }) => (
    <>
      <label htmlFor="rendered-event-name">Event name</label>
      <input
        id="rendered-event-name"
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
      <label htmlFor="rendered-start-date">Start date</label>
      <input
        id="rendered-start-date"
        value={startDate}
        onChange={(event) => onStartDateChange(event.target.value)}
      />
      <label htmlFor="rendered-end-date">End date</label>
      <input
        id="rendered-end-date"
        value={endDate}
        onChange={(event) => onEndDateChange(event.target.value)}
      />
    </>
  ),
}));

vi.mock("@/components/events/event-form-summary", () => ({
  EventFormSummary: ({
    initialEvent,
    onSave,
  }: {
    initialEvent?: { status: "Draft" | "Active" };
    onSave: (launch: boolean) => void;
  }) => (
    <>
      <button type="button" onClick={() => onSave(false)}>
        {initialEvent ? "Save Changes" : "Save Draft"}
      </button>
      {!initialEvent || initialEvent.status === "Draft" ? (
        <button type="button" onClick={() => onSave(true)}>Launch Event</button>
      ) : null}
    </>
  ),
}));

vi.mock("@/components/events/event-form-template-picker", () => ({
  EventFormTemplatePicker: () => null,
}));

vi.mock("@/components/events/event-form-task-phases", () => ({
  EventFormTaskPhases: ({
    phaseViews,
    onOpenNewTask,
  }: {
    phaseViews: { editablePhases: { id: string }[] }[];
    onOpenNewTask: (phaseId: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onOpenNewTask(phaseViews[0].editablePhases[0].id)}
    >
      Open task dialog
    </button>
  ),
}));

vi.mock("@/components/events/event-form-task-dialog", async () => {
  const { Dialog, DialogContent, DialogTitle } = await vi.importActual<
    typeof import("@/components/ui/dialog")
  >("@/components/ui/dialog");

  return {
    EventFormTaskDialog: ({
      open,
      taskEditor,
      onClose,
      updateTaskDraft,
      onSaveTask,
    }: {
      open: boolean;
      taskEditor: { draft: { title: string; committeeId: string } } | null;
      onClose: () => void;
      updateTaskDraft: (updates: { title?: string; committeeId?: string }) => void;
      onSaveTask: () => void;
    }) => (
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <DialogContent>
          <DialogTitle>Rendered task dialog</DialogTitle>
          {taskEditor ? (
            <>
              <label htmlFor="rendered-task-title">Task title</label>
              <input
                id="rendered-task-title"
                value={taskEditor.draft.title}
                onChange={(event) => updateTaskDraft({ title: event.target.value })}
              />
              <label htmlFor="rendered-task-committee">Task committee</label>
              <select
                id="rendered-task-committee"
                value={taskEditor.draft.committeeId}
                onChange={(event) => updateTaskDraft({ committeeId: event.target.value })}
              >
                <option value="">Choose</option>
                <option value="committee-1">Operations</option>
              </select>
              <button type="button" onClick={onSaveTask}>Save rendered task</button>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    ),
  };
});

import { EventForm, type InitialEvent } from "@/components/events/event-form";

const eventForm = readFileSync(
  "src/components/events/event-form.tsx",
  "utf8",
).replaceAll("\r\n", "\n");
const confirmations = readFileSync(
  "src/components/events/event-form-confirmations.tsx",
  "utf8",
).replaceAll("\r\n", "\n");

const initialTask = {
  id: "task-1",
  title: "Prepare venue",
  description: "",
  phase: "Preparation",
  committeeId: "committee-1",
  taskType: "Deliverable" as const,
  dueDate: "2026-12-01",
  callDate: "",
  callTime: "",
  endDate: "",
  endTime: "",
  priority: "Medium" as const,
  assigneeIds: [],
  dependsOnTaskId: null,
  status: "To Do" as const,
};

function initialEvent(status: "Draft" | "Active"): InitialEvent {
  return {
    id: `event-${status.toLowerCase()}`,
    name: `${status} event`,
    description: "",
    startDate: "2026-12-01",
    endDate: "2026-12-02",
    status,
    updatedAt: "2026-11-26T00:00:00.000000+00:00",
    bannerUrl: null,
    phaseOrder: ["Preparation"],
    tasks: [initialTask],
  };
}

function renderEventForm(event?: InitialEvent) {
  return render(
    <EventForm
      currentUserId="user-1"
      role="Admin"
      committees={[{ id: "committee-1", name: "Operations" }]}
      taskCommittees={[{ id: "committee-1", name: "Operations" }]}
      assignees={[]}
      archivedTemplates={[]}
      initialEvent={event}
    />,
  );
}

function beforeUnloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function makeDirty(nextName: string) {
  fireEvent.change(screen.getByLabelText("Event name"), {
    target: { value: nextName },
  });
  await waitFor(() => {
    expect(window.history.state?.__ceitConnectModal).toBeTruthy();
    expect(beforeUnloadPrevented()).toBe(true);
  });
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.rpc.mockReset();
  window.history.replaceState({}, "", window.location.href);
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.restoreAllMocks();
});

describe("event form unsaved-work contract", () => {
  it("uses one derived dirty value for Back and beforeunload", () => {
    expect(eventForm).toContain("const isDirty = eventFormIsDirty(");
    expect(eventForm).toContain("useBackNavigationGuard(");
    expect(eventForm).toContain('window.addEventListener("beforeunload", warnBeforeUnload)');
    expect(eventForm).toContain('window.removeEventListener("beforeunload", warnBeforeUnload)');
    expect(eventForm).toContain("if (!isDirty || navigationApprovedRef.current) return;");
    expect(eventForm).toContain("if (navigationApprovedRef.current) return;");
  });

  it("clears the guard after success and before every save redirect", () => {
    const success = eventForm.indexOf("approveNavigation();", eventForm.indexOf("const saveError"));
    const clear = eventForm.indexOf("await clearBackGuard();", success);
    const firstRedirect = eventForm.indexOf("router.replace(", clear);

    expect(success).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(success);
    expect(firstRedirect).toBeGreaterThan(clear);
    expect(eventForm.slice(success, clear)).not.toContain("router.replace(");
    expect(eventForm).toContain('router.replace(launch ? "/home?launched=1" : "/home")');
  });

  it("approves discard before closing the confirmation and taking real Back", () => {
    const discard = eventForm.slice(eventForm.indexOf("onDiscardChanges={() =>"));
    expect(discard).toContain("if (discardChangesInFlightRef.current) return;");
    expect(discard.indexOf("discardChangesInFlightRef.current = true;")).toBeLessThan(
      discard.indexOf("clearBackGuard()"),
    );
    expect(discard.indexOf("approveNavigation();")).toBeLessThan(
      discard.indexOf("window.history.back()"),
    );
    expect(discard.indexOf("clearBackGuard()")).toBeLessThan(
      discard.indexOf("window.history.back()"),
    );
    expect(discard).toContain(".finally(() => {");
    expect(discard).toContain("discardChangesInFlightRef.current = false;");
    expect(confirmations).toContain("loading={leaveConfirmLoading}");
  });

  it("keeps the approved English actions and no timezone copy", () => {
    expect(confirmations).toContain('cancelLabel="Keep editing"');
    expect(confirmations).toContain('confirmLabel="Discard changes"');
    expect(confirmations).not.toMatch(/Manila|Philippine|timezone|time zone/i);
  });
});

describe("event form unsaved-work behavior", () => {
  it.each([
    { label: "Save Draft", event: undefined, nextName: "New event", expectedPath: "/home" },
    { label: "Save Changes", event: initialEvent("Active"), nextName: "Changed active event", expectedPath: "/home" },
    { label: "Launch Event", event: initialEvent("Draft"), nextName: "Changed draft event", expectedPath: "/home?launched=1" },
  ])("clears every guard after successful $label", async ({ label, event, nextName, expectedPath }) => {
    mocks.rpc.mockResolvedValue({ data: event?.id ?? "created-event", error: null });
    renderEventForm(event);
    await makeDirty(nextName);

    if (!event) {
      fireEvent.change(screen.getByLabelText("Start date"), {
        target: { value: "2026-12-01" },
      });
    }
    fireEvent.click(screen.getByText(label));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith(expectedPath));
    expect(window.history.state?.__ceitConnectModal).toBeUndefined();
    expect(beforeUnloadPrevented()).toBe(false);
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
  });

  it("keeps the guard active after an RPC save failure", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "Save failed", code: "XX000" },
    });
    renderEventForm(initialEvent("Active"));
    await makeDirty("Unsaved active event");

    fireEvent.click(screen.getByText("Save Changes"));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());

    expect(mocks.replace).not.toHaveBeenCalled();
    expect(window.history.state?.__ceitConnectModal).toBeTruthy();
    expect(beforeUnloadPrevented()).toBe(true);
  });

  it("opens the real discard confirmation when Back reaches a dirty form", async () => {
    renderEventForm(initialEvent("Active"));
    await makeDirty("Dirty active event");

    window.history.back();

    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    expect(screen.getByText("Keep editing")).toBeTruthy();
    expect(screen.getByText("Discard changes")).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("arms the guard without opening discard when saving a task closes its dialog", async () => {
    renderEventForm(initialEvent("Active"));
    expect(beforeUnloadPrevented()).toBe(false);
    expect(window.history.state?.__ceitConnectModal).toBeUndefined();

    fireEvent.click(screen.getByText("Tasks (1)"));
    fireEvent.click(screen.getByText("Open task dialog"));
    await waitFor(() => {
      expect(screen.getByLabelText("Task title")).toBeTruthy();
      expect(window.history.state?.__ceitConnectModal?.id).toMatch(/^modal-/);
      expect(beforeUnloadPrevented()).toBe(false);
    });

    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "New task" },
    });
    fireEvent.change(screen.getByLabelText("Task committee"), {
      target: { value: "committee-1" },
    });
    fireEvent.click(screen.getByText("Save rendered task"));

    await waitFor(() => {
      expect(screen.queryByLabelText("Task title")).toBeNull();
      expect(window.history.state?.__ceitConnectModal?.id).toMatch(/^guard-/);
    });
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();

    window.history.back();
    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
  });
});
