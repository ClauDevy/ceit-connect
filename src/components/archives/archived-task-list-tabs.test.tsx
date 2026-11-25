// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/priority-badge", () => ({
  PriorityBadge: ({ priority }: { priority: string }) => <span>{priority}</span>,
}));
vi.mock("@/components/shared/stretched-link", () => ({
  StretchedLink: ({ href, label }: { href: string; label: string }) => (
    <a href={href} aria-label={label} />
  ),
}));
vi.mock("@/components/shared/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("@/components/shared/motion", () => ({
  TabPanel: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  useListReveal: () => ({
    getRevealProps: (id: string) => ({ "data-motion-reveal-id": id }),
  }),
}));

import { ArchivedTaskList, type ArchivedTask } from "./archived-task-list";

function task(id: string, phase: string | null): ArchivedTask {
  return {
    id,
    phase,
    status: "To Do",
    priority: "Medium",
    task_type: "Deliverable",
    due_date: null,
    primary_assignees: [],
    assist_assignees: [],
  } as ArchivedTask;
}

function renderList(tasks: ArchivedTask[]) {
  const taskContent = new Map(
    tasks.map((t) => [t.id, { title: `Title ${t.id}`, description: null }]),
  );
  return render(
    <ArchivedTaskList
      tasks={tasks}
      taskContent={taskContent as never}
      assignees={new Map()}
      assigneesUnavailable={false}
    />,
  );
}

const tabs = () => screen.getAllByRole("tab");

afterEach(cleanup);

describe("archived task phase tabs", () => {
  it("renders no tablist for a single phase", () => {
    renderList([task("a", "Phase A"), task("b", "Phase A")]);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("filters by phase and restores everything on All phases", () => {
    renderList([task("a", "Phase A"), task("b", "Phase B")]);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: /Phase B/ }));
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/tasks/b"]);
    fireEvent.click(screen.getByRole("tab", { name: /All phases/ }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("tracks aria-selected and roving tabIndex", () => {
    renderList([task("a", "Phase A"), task("b", "Phase B")]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(tabs()[2]);
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("supports arrow keys with wrap-around, Home and End", () => {
    renderList([task("a", "Phase A"), task("b", "Phase B")]);
    fireEvent.keyDown(tabs()[0], { key: "ArrowLeft" });
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[2]);
    fireEvent.keyDown(tabs()[2], { key: "ArrowRight" });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs()[0], { key: "End" });
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs()[2], { key: "Home" });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("selects by position when phases are named like built-in tabs", () => {
    renderList([task("a", "All phases"), task("b", "Unphased"), task("c", null)]);
    expect(tabs()).toHaveLength(4);
    fireEvent.click(tabs()[1]); // the phase literally named "All phases"
    expect(tabs().map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false", "false"]);
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/tasks/a"]);
  });
});
