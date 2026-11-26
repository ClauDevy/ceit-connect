import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("task creation dependency characterization", () => {
  it("keeps the existing trigger as the dependency integrity boundary", () => {
    const migration = read(
      "supabase/migrations/20261018120000_task_creator_order_dependency_integrity.sql",
    );

    expect(migration).toContain("create function public.validate_task_dependency()");
    expect(migration).toContain("before insert or update of depends_on_task_id");
    expect(migration).toContain("A task cannot depend on itself.");
    expect(migration).toContain(
      "A task can depend only on another task in the same event.",
    );
    expect(migration).toContain("This dependency would create a cycle.");
    const validatorBody = migration.slice(
      migration.indexOf("create function public.validate_task_dependency()"),
      migration.indexOf("create trigger tasks_validate_dependency"),
    );
    expect(validatorBody).not.toMatch(/new\.phase|dependency\.phase/);
  });

  it("masks prerequisite labels through the established picker contract", () => {
    const migration = read(
      "supabase/migrations/20261020120000_task_dependency_confidentiality_controls.sql",
    );
    const controls = read("src/components/tasks/task-edit-controls.tsx");

    expect(migration).toContain("when 'masked' then 'Confidential Task'");
    expect(controls).toContain("Hidden titles are never");
    expect(controls).toContain("controls.dependency_options");
  });

  it("keeps board Edit and archived-template creation on their current paths", () => {
    const dialog = read("src/components/tasks/active-task-dialog.tsx");
    const eventForm = read("src/components/events/event-form.tsx");

    expect(dialog).toContain('method: mode === "add" ? "POST" : "PATCH"');
    expect(eventForm).toContain('supabase.rpc("create_event_from_archived_template"');
    const migration = read("supabase/migrations/20261130120000_task_creation_dependencies.sql");
    expect(migration).toContain("public.create_event_with_tasks(");
    expect(migration).toContain("public.edit_event_with_tasks(");
  });
});
