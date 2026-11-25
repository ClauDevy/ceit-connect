import type {
  PhaseDraft,
  TemplateImportSummary,
} from "@/components/events/event-form-types";
import {
  getSavableEventPhaseName,
  toTaskPayload,
} from "@/lib/events/form";

export type EventFormSaveStateInput = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  phases: PhaseDraft[];
  initialTaskDueDates: ReadonlyMap<string, string>;
  pendingBanner: File | null;
  templateSummary: TemplateImportSummary | null;
  excludedTemplateTaskIds: string[];
};

function pendingBannerKey(file: File | null) {
  return file
    ? {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      }
    : null;
}

export function eventFormSaveState(input: EventFormSaveStateInput) {
  return JSON.stringify({
    name: input.name.trim(),
    description: input.description.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    pendingBanner: pendingBannerKey(input.pendingBanner),
    templateEventId: input.templateSummary?.template.id ?? null,
    excludedTemplateTaskIds: [...input.excludedTemplateTaskIds].sort(),
    phases: input.phases.flatMap((phase) => {
      if (phase.tasks.length === 0) return [];
      const phaseName = getSavableEventPhaseName(phase);
      return [{
        name: phaseName,
        tasks: phase.tasks.map((task) => ({
          persistedId: task.persisted ? task.id : null,
          sourceTemplateTaskId: task.sourceTemplateTaskId,
          templateEditable: task.templateEditable,
          payload: toTaskPayload(
            phaseName,
            task,
            input.initialTaskDueDates.get(task.id) ?? null,
          ),
        })),
      }];
    }),
  });
}

export function eventFormIsDirty(
  initialState: string,
  current: EventFormSaveStateInput,
) {
  return eventFormSaveState(current) !== initialState;
}
