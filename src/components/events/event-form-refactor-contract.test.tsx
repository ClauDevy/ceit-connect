import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entrySource = readFileSync(
  "src/components/events/event-form.tsx",
  "utf8",
).replaceAll("\r\n", "\n");
const source = [
  "event-form.tsx",
  "event-form-template-picker.tsx",
  "event-form-fundamentals.tsx",
  "event-form-task-phases.tsx",
  "event-form-summary.tsx",
  "event-form-task-dialog.tsx",
  "event-form-assignee-picker.tsx",
  "event-form-confirmations.tsx",
]
  .map((file) => readFileSync(`src/components/events/${file}`, "utf8"))
  .join("\n")
  .replaceAll("\r\n", "\n");

function publicExportNames(value: string) {
  const names = new Set<string>();

  for (const match of value.matchAll(
    /export\s+(?:declare\s+)?(?:type|interface|function|class|const)\s+([A-Za-z0-9_]+)/g,
  )) {
    names.add(match[1]);
  }

  for (const match of value.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[1] ??
        item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.add(name.trim());
    }
  }

  return [...names].sort();
}

describe("U3 event form refactor characterization", () => {
  it("pins the public event-form exports", () => {
    expect(publicExportNames(entrySource)).toEqual([
      "ArchivedEventTemplate",
      "EventForm",
      "InitialEvent",
      "InitialEventTask",
    ]);
  });

  it("pins representative rendered copy", () => {
    for (const text of [
      "Choose a starting point",
      "Start from Scratch",
      "Event fundamentals",
      "Task setup",
      "No phases yet",
      "Event summary",
      "Set the task details, schedule, and assignees.",
      "A Live Operation schedule is optional.",
      "Save Changes",
      "Save Draft",
      "Launch Event",
      "Replace the current task setup?",
      "Remove this phase?",
    ]) {
      expect(source).toContain(text);
    }
  });

  it("pins representative layout and motion classes", () => {
    for (const className of [
      "mx-auto max-w-6xl",
      "lg:grid-cols-[minmax(0,1fr)_20rem]",
      "lg:sticky lg:top-24",
      "grid-rows-[auto_minmax(0,1fr)_auto]",
      "motion-success-enter outline-2 outline-primary/40",
      "transition-transform duration-[var(--motion-interaction-duration)]",
      "motion-reduce:transition-none",
    ]) {
      expect(source).toContain(className);
    }
  });

  it("pins the RPC and adjacent API-call inventory", () => {
    const rpcNames = [...source.matchAll(/supabase\s*\.rpc\(\s*["']([^"']+)/g)]
      .map((match) => match[1])
      .sort();

    expect(rpcNames).toEqual([
      "create_event_from_archived_template",
      "create_event_with_tasks",
      "edit_event_with_tasks",
      "get_archived_event_template",
      "list_draft_event_editor_tasks",
    ]);
    expect(source).toContain("uploadEventBanner(");
    expect(source).toContain('.from("events")');
    expect(source).toContain("router.replace(");
    expect(source).toContain("router.refresh()");
  });
});
