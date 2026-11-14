import type { Dispatch, SetStateAction } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type {
  ArchivedEventTemplate,
  PendingTemplateImport,
  PhaseAction,
  PhaseDraft,
} from "@/components/events/event-form-types";

type EventFormConfirmationsProps = {
  pendingTemplateImport: PendingTemplateImport | null;
  phaseToRemove: PhaseDraft | null;
  setPendingTemplateImport: Dispatch<SetStateAction<PendingTemplateImport | null>>;
  setPhaseToRemove: Dispatch<SetStateAction<PhaseDraft | null>>;
  setPhaseActions: Dispatch<SetStateAction<PhaseAction[]>>;
  setDeletedTaskIds: Dispatch<SetStateAction<string[]>>;
  setPhases: Dispatch<SetStateAction<PhaseDraft[]>>;
  importTemplate: (template: ArchivedEventTemplate) => Promise<void>;
};

export function EventFormConfirmations({
  pendingTemplateImport,
  phaseToRemove,
  setPendingTemplateImport,
  setPhaseToRemove,
  setPhaseActions,
  setDeletedTaskIds,
  setPhases,
  importTemplate,
}: EventFormConfirmationsProps) {
  return (
    <>
      <ConfirmDialog
        open={pendingTemplateImport !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTemplateImport(null);
        }}
        title={
          pendingTemplateImport?.reason === "reimport"
            ? "Re-import this template?"
            : "Replace the current task setup?"
        }
        description={
          pendingTemplateImport?.reason === "reimport"
            ? "This replaces the current phases and tasks with a fresh copy shifted from the template to the new start date. Any task edits made after the previous import will be lost."
            : "Importing this template replaces every phase and task currently in the form. Event details are not changed."
        }
        confirmLabel={
          pendingTemplateImport?.reason === "reimport"
            ? "Re-import tasks"
            : "Replace and import"
        }
        onConfirm={() => {
          const pending = pendingTemplateImport;
          setPendingTemplateImport(null);
          if (pending) void importTemplate(pending.template);
        }}
      />

      <ConfirmDialog
        open={phaseToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPhaseToRemove(null);
        }}
        title="Remove this phase?"
        description={
          phaseToRemove?.tasks.length
            ? `This also removes ${phaseToRemove.tasks.length} task${phaseToRemove.tasks.length === 1 ? "" : "s"}. Tasks can’t be moved between phases here; persisted To Do tasks will be deleted when you save.`
            : "This removes the empty phase from the form."
        }
        confirmLabel="Remove phase"
        destructive
        onConfirm={() => {
          if (phaseToRemove) {
            if (phaseToRemove.origin === "persisted") {
              setPhaseActions((current) => {
                const queuedRename = current.find(
                  (action) =>
                    action.key === phaseToRemove.id && action.type === "rename",
                );
                return [
                  ...current.filter((action) => action.key !== phaseToRemove.id),
                  {
                    key: phaseToRemove.id,
                    type: "delete",
                    phase: queuedRename?.phase ?? phaseToRemove.name,
                  },
                ];
              });
            }
            const persistedIds = phaseToRemove.tasks
              .filter((task) => task.persisted)
              .map((task) => task.id);
            setDeletedTaskIds((current) => [
              ...current,
              ...persistedIds.filter((id) => !current.includes(id)),
            ]);
            setPhases((current) =>
              current.filter((phase) => phase.id !== phaseToRemove.id),
            );
          }
          setPhaseToRemove(null);
        }}
      />
    </>
  );
}
