import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const history = readFileSync("src/components/tasks/task-history.tsx", "utf8");
const detail = readFileSync("src/components/tasks/task-detail.tsx", "utf8");
const taskPage = readFileSync(
  "src/app/(dashboard)/tasks/[taskId]/page.tsx",
  "utf8",
);
const taskActions = readFileSync(
  "src/components/tasks/task-people-controls.tsx",
  "utf8",
);
const sharedMotion = readFileSync(
  "src/components/shared/motion.tsx",
  "utf8",
);

describe("task page layout contract", () => {
  it("keeps History lazy, task-scoped, and separate from the global Activity Log page", () => {
    expect(taskPage).not.toContain('supabase.rpc("list_activity_log"');
    expect(history).toContain('"list_activity_log"');
    expect(history).toContain("TASK_HISTORY_PAGE_SIZE");
    expect(history).toContain("taskId,");
    expect(history).not.toContain("Load more");
  });

  it("places keyed History after Collaboration and Activity", () => {
    expect(detail).toContain('<TaskHistory key={task.id} taskId={task.id} />');
    expect(detail.indexOf("<TaskHistory key={task.id}")).toBeGreaterThan(
      detail.indexOf("<TaskComments"),
    );
  });

  it("uses the shared inert disclosure with accessible and reduced-motion states", () => {
    expect(history).toContain("<Collapse open={expanded}>");
    expect(history).toContain("aria-expanded={expanded}");
    expect(history).toContain("aria-controls={contentId}");
    expect(history).toContain("focus-visible:");
    expect(history).toContain("motion-reduce:transition-none");
    expect(sharedMotion).toContain('aria-hidden={!open}');
    expect(sharedMotion).toContain("inert={!open ? true : undefined}");
  });

  it("keeps collapsed rows and pager controls out of tab and accessibility order", () => {
    expect(history.indexOf("<ActivityLogList")).toBeGreaterThan(
      history.indexOf("<Collapse open={expanded}>"),
    );
    expect(history.indexOf('ariaLabel="Task history pages"')).toBeGreaterThan(
      history.indexOf("<Collapse open={expanded}>"),
    );
    expect(sharedMotion).toContain("inert={!open ? true : undefined}");
    expect(sharedMotion).toContain('aria-hidden={!open}');
  });

  it("renders Delete as a same-density destructive outline action", () => {
    expect(taskActions).toContain("Delete task");
    expect(taskActions).toContain('variant="outline"');
    expect(taskActions).toContain('size="sm"');
    expect(taskActions).toContain("border-destructive/40");
    expect(taskActions).toContain("active:bg-destructive/15");
    expect(taskActions).not.toContain("DropdownMenu");
    expect(taskActions).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
