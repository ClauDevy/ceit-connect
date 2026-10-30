import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const eventForm = readFileSync(
  "src/components/events/event-form.tsx",
  "utf8",
);

describe("Batch 13c Edit Event Draft visibility contract", () => {
  it("queries the fixed-shape Draft editor reader", () => {
    expect(eventForm).toContain(
      'supabase.rpc("list_draft_event_editor_tasks", {',
    );
    expect(eventForm).toContain("p_event_id: initialEvent!.id");
    expect(eventForm).toContain(
      'queryKey: ["draft-event-editor-tasks", initialEvent?.id]',
    );
  });

  it("renders cross-committee rows as read-only cards, including read-only-only phases", () => {
    expect(eventForm).toContain(
      "const readOnlyTasks = useMemo(",
    );
    expect(eventForm).toContain(".filter((task) => !task.out_is_editable)");
    expect(eventForm).toContain("readOnlyPhaseTasks.map((task) => (");
    expect(eventForm).toContain('key={`readonly-${phaseName}`}');
    expect(eventForm).toContain("Confidential details are hidden.");
    expect(eventForm).toContain(
      "phases.length === 0 && readOnlyTasksByPhase.size === 0",
    );
  });

  it("does not queue a phase deletion when its confirmation is cancelled", () => {
    const requestStart = eventForm.indexOf(
      "function requestRemovePhase(phase: PhaseDraft)",
    );
    const requestEnd = eventForm.indexOf(
      "async function handleSave",
      requestStart,
    );
    const requestBlock = eventForm.slice(requestStart, requestEnd);

    expect(requestBlock).not.toContain("setPhaseActions");
    expect(eventForm).toMatch(
      /onOpenChange=\{\(open\) => \{\s*if \(!open\) setPhaseToRemove\(null\);\s*\}\}/,
    );
  });

  it("uses a queued rename's original phase name when deletion is confirmed", () => {
    expect(eventForm).toMatch(
      /const queuedRename = current\.find\([\s\S]*?action\.key === phaseToRemove\.id && action\.type === "rename"/,
    );
    expect(eventForm).toContain(
      "phase: queuedRename?.phase ?? phaseToRemove.name",
    );
  });

  it("keeps reader rows outside editable phase state and every task save payload", () => {
    expect(eventForm).toContain(
      "initialEvent ? makeInitialPhases(initialEvent.tasks) : []",
    );
    expect(eventForm).toMatch(
      /const tasks = phases\.flatMap\(\(phase\) =>[\s\S]*?payload: toTaskPayload\(phase\.name, task\)/,
    );
    expect(eventForm).not.toMatch(
      /readOnlyTasks[\s\S]{0,120}(setPhases|p_tasks_to_add|p_tasks_to_update|p_task_ids_to_delete)/,
    );
  });

  it("blocks rename and delete controls for mixed phases and explains why", () => {
    expect(eventForm).toMatch(
      /const phaseActionsDisabled =[\s\S]*?readOnlyPhaseTasks\.length > 0/,
    );
    expect(eventForm.match(/disabled=\{phaseActionsDisabled\}/g)).toHaveLength(2);
    expect(eventForm).toContain(
      "This phase includes read-only tasks from another committee.",
    );
    expect(eventForm).toContain(
      "you can&apos;t rename or remove this phase.",
    );
  });

  it("polls and focus-refetches only reader data without resetting form state", () => {
    const queryStart = eventForm.indexOf("const draftReaderQuery = useQuery({");
    const queryEnd = eventForm.indexOf("const readOnlyTasks = useMemo(", queryStart);
    const queryBlock = eventForm.slice(queryStart, queryEnd);

    expect(queryBlock).toContain("refetchOnWindowFocus: true");
    expect(queryBlock).toContain("refetchInterval: 15_000");
    expect(queryBlock).not.toMatch(
      /set(Name|Description|StartDate|EndDate|Phases|DeletedTaskIds|EventVersion)\(/,
    );
    expect(eventForm).not.toContain("useEffect(() => setPhases");
  });
});
