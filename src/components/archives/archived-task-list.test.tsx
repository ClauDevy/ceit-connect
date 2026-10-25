import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/priority-badge", () => ({
  PriorityBadge: ({ priority }: { priority: string }) => (
    <span>{priority}</span>
  ),
}));
vi.mock("@/components/shared/stretched-link", () => ({
  StretchedLink: ({ href, label }: { href: string; label: string }) => (
    <a href={href} aria-label={label} />
  ),
}));
vi.mock("@/components/shared/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: React.ComponentProps<"div">) => (
    <div {...props}>{children}</div>
  ),
}));
vi.mock("@/lib/timezone", () => ({
  APP_TIME_ZONE: { iana: "Asia/Manila" },
}));
vi.mock("@/lib/motion", () => ({
  selectEntranceIds: <T,>(items: readonly T[], getId: (item: T) => string) =>
    new Set(items.slice(0, 20).map(getId)),
  getEntranceClassName: (
    capture: { ids: ReadonlySet<string> },
    id: string,
  ) => capture.ids.has(id) ? "motion-list-item-enter motion-list-delay-0" : undefined,
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | undefined>) =>
    values.filter(Boolean).join(" "),
}));

import {
  ArchivedTaskList,
  groupArchivedTasksByPhase,
  type ArchivedTask,
} from "./archived-task-list";

function task(
  id: string,
  phase: string | null,
  overrides: Partial<ArchivedTask> = {},
): ArchivedTask {
  return {
    id,
    phase,
    status: "To Do",
    priority: "Medium",
    task_type: "Deliverable",
    due_date: null,
    primary_assignees: [],
    assist_assignees: [],
    ...overrides,
  };
}

describe("archived task phase groups", () => {
  it("keeps first-seen named phase order and task order, with No phase last", () => {
    const groups = groupArchivedTasksByPhase([
      task("b-1", "Phase B"),
      task("none-1", null),
      task("a-1", "Phase A"),
      task("b-2", "Phase B"),
      task("none-2", "  "),
      task("a-2", "Phase A"),
    ]);

    expect(groups.map((group) => group.phase)).toEqual([
      "Phase B",
      "Phase A",
      "No phase",
    ]);
    expect(groups.map((group) => group.tasks.map(({ id }) => id))).toEqual([
      ["b-1", "b-2"],
      ["a-1", "a-2"],
      ["none-1", "none-2"],
    ]);
  });

  it("removes a masked archived task's returned phase before grouping", () => {
    const maskedTask = task("masked-task", "Secret phase", {
      priority: "High",
      status: "In Progress",
    });
    const html = renderToStaticMarkup(
      <ArchivedTaskList
        tasks={[maskedTask]}
        taskContent={
          new Map([
            [
              maskedTask.id,
              {
                id: maskedTask.id,
                title: "🔒 Confidential Task",
                description: null,
              },
            ],
          ])
        }
        assignees={new Map()}
        assigneesUnavailable={false}
      />,
    );

    expect(html).toContain("No phase");
    expect(html).toContain("🔒 Confidential Task");
    expect(html).not.toContain("Secret phase");
    expect(html).not.toContain("Secret description");
    expect(html).not.toContain("Secret assignee");
  });

  it("animates only the first 20 displayed tasks across phase groups", () => {
    const tasks = [
      ...Array.from({ length: 12 }, (_, index) =>
        task(`phase-a-${index + 1}`, "Phase A"),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        task(`phase-b-${index + 1}`, "Phase B"),
      ),
    ];
    const taskContent = new Map(
      tasks.map((item) => [
        item.id,
        { id: item.id, title: item.id, description: null },
      ]),
    );
    const html = renderToStaticMarkup(
      <ArchivedTaskList
        tasks={tasks}
        taskContent={taskContent}
        assignees={new Map()}
        assigneesUnavailable={false}
      />,
    );

    expect(html.match(/motion-list-item-enter/g)).toHaveLength(20);
    expect(html).toMatch(/phase-b-8[^]*motion-list-item-enter|motion-list-item-enter[^]*phase-b-8/);
  });
});
