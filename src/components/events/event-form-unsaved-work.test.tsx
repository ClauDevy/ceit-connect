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
  EventFormTaskPhases: () => null,
}));

vi.mock("@/components/events/event-form-task-dialog", () => ({
  EventFormTaskDialog: () => null,
}));

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
    expect(discard.indexOf("approveNavigation();")).toBeLessThan(
      discard.indexOf("window.history.back()"),
    );
    expect(discard.indexOf("clearBackGuard()")).toBeLessThan(
      discard.indexOf("window.history.back()"),
    );
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
});
