import type { RefObject } from "react";
import { CalendarDays, FileText, Users } from "lucide-react";
import { EventFormAssigneePicker } from "@/components/events/event-form-assignee-picker";
import { priorities, priorityItems, taskTypes } from "@/components/events/event-form-helpers";
import { MotionPresence, SectionEnter } from "@/components/shared/motion";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Committee, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import type {
  AssigneeOption,
  TaskEditor,
  TaskStatus,
  TaskType,
} from "@/components/events/event-form-types";

type EventFormTaskDialogProps = {
  open: boolean;
  taskEditor: TaskEditor | null;
  taskDialogScrollRef: RefObject<HTMLDivElement | null>;
  endDate: string;
  role: Extract<Role, "Admin" | "Co-Admin">;
  taskCommittees: Committee[];
  committeeItems: { value: string; label: string }[];
  taskEditorError: string;
  taskEditorErrorField: string | null;
  editedTaskStatus: TaskStatus | null | undefined;
  inactiveAssigneeIds: string[];
  assigneeSearch: string;
  visibleAssignees: AssigneeOption[];
  selectedVisibleAssigneeCount: number;
  selectAllVisibleExceedsLimit: boolean;
  selectedCommitteeHasActiveMembers: boolean;
  assigneeGroups: { selected: AssigneeOption[]; other: AssigneeOption[] };
  committeeNames: Map<string, string>;
  onClose: () => void;
  onClosed: () => void;
  updateTaskDraft: (updates: Partial<TaskEditor["draft"]>) => void;
  onSearchChange: (value: string) => void;
  onUpdateVisibleAssignees: (checked: boolean) => void;
  onUpdateSingleAssignee: (assigneeId: string, checked: boolean) => void;
  onSaveTask: () => void;
};

export function EventFormTaskDialog({
  open,
  taskEditor,
  taskDialogScrollRef,
  endDate,
  role,
  taskCommittees,
  committeeItems,
  taskEditorError,
  taskEditorErrorField,
  editedTaskStatus,
  inactiveAssigneeIds,
  assigneeSearch,
  visibleAssignees,
  selectedVisibleAssigneeCount,
  selectAllVisibleExceedsLimit,
  selectedCommitteeHasActiveMembers,
  assigneeGroups,
  committeeNames,
  onClose,
  onClosed,
  updateTaskDraft,
  onSearchChange,
  onUpdateVisibleAssignees,
  onUpdateSingleAssignee,
  onSaveTask,
}: EventFormTaskDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:p-0",
          !open && "pointer-events-none",
        )}
        aria-hidden={!open || undefined}
        inert={!open ? true : undefined}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "opacity" &&
            !open
          ) {
            onClosed();
          }
        }}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-3.5 pr-12 sm:px-5 sm:py-4 sm:pr-14">
          <DialogTitle>{taskEditor?.taskId ? "Edit task" : "Add task"}</DialogTitle>
          <DialogDescription>
            Set the task details, schedule, and assignees.
          </DialogDescription>
        </DialogHeader>

        {taskEditor && (
          <div
            ref={taskDialogScrollRef}
            className="grid min-h-0 min-w-0 gap-5 overflow-y-auto px-4 py-5 sm:px-5"
          >
            <SectionEnter as="section" index={0} className="grid gap-4 border-b pb-5">
              <SectionHeading icon={<FileText aria-hidden />} title="Details" />
              <FormField label="Task title">
                {(control) => (
                  <Input
                    {...control}
                    data-task-field="title"
                    autoFocus
                    maxLength={200}
                    value={taskEditor.draft.title}
                    onChange={(event) =>
                      updateTaskDraft({ title: event.target.value })
                    }
                    placeholder="e.g. Coordinate sound system"
                  />
                )}
              </FormField>

              <FormField
                label="Description"
                hint="Optional · up to 2,000 characters"
              >
                {(control) => (
                  <textarea
                    {...control}
                    rows={3}
                    maxLength={2000}
                    value={taskEditor.draft.description}
                    onChange={(event) =>
                      updateTaskDraft({ description: event.target.value })
                    }
                    className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none dark:bg-input/30"
                  />
                )}
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Task type" labelTarget="group">
                  {(control) => (
                    <TaskTypeToggle
                      {...control}
                      value={taskEditor.draft.taskType}
                      onValueChange={(value) =>
                        updateTaskDraft({ taskType: value })
                      }
                    />
                  )}
                </FormField>

                <FormField label="Priority">
                  {(control) => (
                    <Select
                      items={priorityItems}
                      value={taskEditor.draft.priority}
                      onValueChange={(value) =>
                        value && updateTaskDraft({ priority: value })
                      }
                    >
                      <SelectTrigger {...control}>
                        <SelectValue className="sr-only" />
                        <PriorityBadge
                          priority={taskEditor.draft.priority}
                          aria-hidden="true"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {priorities.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            <PriorityBadge priority={priority} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>
            </SectionEnter>

            <SectionEnter as="section" index={1} className="grid gap-4 border-b pb-5">
              <SectionHeading icon={<CalendarDays aria-hidden />} title="Schedule" />
              {taskEditor.draft.taskType === "Deliverable" ? (
                <FormField label="Due date" hint="Optional">
                  {(control) => (
                    <Input
                      {...control}
                      data-task-field="due-date"
                      type="date"
                      max={endDate || undefined}
                      value={taskEditor.draft.dueDate}
                      onChange={(event) =>
                        updateTaskDraft({ dueDate: event.target.value })
                      }
                    />
                  )}
                </FormField>
              ) : null}

              <MotionPresence open={taskEditor.draft.taskType === "LiveOperation"}>
                {taskEditor.draft.taskType === "LiveOperation" ? <div className="grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                  <InlineAlert variant="info">
                    A Live Operation schedule is optional. If you add one,
                    choose both a Duty date and Call time.
                  </InlineAlert>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Duty date">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="call-date"
                          type="date"
                          max={endDate || undefined}
                          value={taskEditor.draft.callDate}
                          onChange={(event) =>
                            updateTaskDraft({ callDate: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                    <FormField label="Call time">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="call-time"
                          type="time"
                          value={taskEditor.draft.callTime}
                          onChange={(event) =>
                            updateTaskDraft({ callTime: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                    <FormField label="End date" hint="Optional · leave blank for the Duty date">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="end-date"
                          type="date"
                          min={taskEditor.draft.callDate || undefined}
                          max={endDate || undefined}
                          value={taskEditor.draft.endDate}
                          onChange={(event) =>
                            updateTaskDraft({ endDate: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                    <FormField label="End time" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="end-time"
                          type="time"
                          min={
                            !taskEditor.draft.endDate ||
                            taskEditor.draft.endDate === taskEditor.draft.callDate
                              ? taskEditor.draft.callTime || undefined
                              : undefined
                          }
                          value={taskEditor.draft.endTime}
                          onChange={(event) =>
                            updateTaskDraft({ endTime: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                  </div>
                </div> : null}
              </MotionPresence>
            </SectionEnter>

            <SectionEnter as="section" index={2} className="grid gap-4">
              <SectionHeading icon={<Users aria-hidden />} title="People" />
              <FormField
                label="Committee"
                error={taskEditorErrorField === "committee" ? taskEditorError : null}
              >
                {(control) =>
                  role === "Co-Admin" ? (
                    <Input
                      {...control}
                      readOnly
                      data-task-field="committee"
                      value={
                        taskCommittees.length === 1
                          ? taskCommittees[0].name
                          : "Committee unavailable"
                      }
                      className="bg-muted/40"
                    />
                  ) : (
                    <Select
                      items={committeeItems}
                      value={taskEditor.draft.committeeId || null}
                      onValueChange={(value) =>
                        updateTaskDraft({ committeeId: value ?? "" })
                      }
                    >
                      <SelectTrigger {...control} data-task-field="committee">
                        <SelectValue placeholder="Select a committee" />
                      </SelectTrigger>
                      <SelectContent>
                        {committeeItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                }
              </FormField>

              <EventFormAssigneePicker
                taskEditor={taskEditor}
                editedTaskStatus={editedTaskStatus}
                inactiveAssigneeIds={inactiveAssigneeIds}
                assigneeSearch={assigneeSearch}
                visibleAssignees={visibleAssignees}
                selectedVisibleAssigneeCount={selectedVisibleAssigneeCount}
                selectAllVisibleExceedsLimit={selectAllVisibleExceedsLimit}
                selectedCommitteeHasActiveMembers={selectedCommitteeHasActiveMembers}
                assigneeGroups={assigneeGroups}
                committeeNames={committeeNames}
                onUpdateTaskDraft={updateTaskDraft}
                onSearchChange={onSearchChange}
                onUpdateVisibleAssignees={onUpdateVisibleAssignees}
                onUpdateSingleAssignee={onUpdateSingleAssignee}
              />
            </SectionEnter>
          </div>
        )}

        <div className="grid shrink-0 gap-3 border-t bg-popover p-4 sm:px-5">
          <MotionPresence open={Boolean(taskEditorError)}>
            {taskEditorError ? <InlineAlert>{taskEditorError}</InlineAlert> : null}
          </MotionPresence>
          <DialogFooter className="grid grid-cols-2 sm:flex">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={onSaveTask}
            >
              {taskEditor?.taskId ? "Save changes" : "Add task"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-3.5">
        {icon}
      </span>
      <h3 className="font-display text-sm font-semibold">{title}</h3>
    </div>
  );
}

function TaskTypeToggle({
  id,
  value,
  onValueChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: TaskType;
  onValueChange: (value: TaskType) => void;
  "aria-labelledby": string;
  "aria-describedby"?: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-2 rounded-xl focus-within:ring-3 focus-within:ring-ring/50"
    >
      {taskTypes.map((option) => {
        const selected = option.value === value;
        const optionId = `${id}-${option.value}`;

        return (
          <label
            key={option.value}
            htmlFor={optionId}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-center text-sm font-semibold transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted motion-reduce:transition-none ${
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground"
            }`}
          >
            <input
              id={optionId}
              type="radio"
              name={`${id}-task-type`}
              value={option.value}
              checked={selected}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}
