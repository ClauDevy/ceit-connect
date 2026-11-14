import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preventSearchFormSubmission } from "@/lib/search";
import type {
  AssigneeOption,
  TaskEditor,
  TaskStatus,
} from "@/components/events/event-form-types";

type EventFormAssigneePickerProps = {
  taskEditor: TaskEditor;
  editedTaskStatus: TaskStatus | null | undefined;
  inactiveAssigneeIds: string[];
  assigneeSearch: string;
  visibleAssignees: AssigneeOption[];
  selectedVisibleAssigneeCount: number;
  selectAllVisibleExceedsLimit: boolean;
  selectedCommitteeHasActiveMembers: boolean;
  assigneeGroups: {
    selected: AssigneeOption[];
    other: AssigneeOption[];
  };
  committeeNames: Map<string, string>;
  onUpdateTaskDraft: (updates: Partial<TaskEditor["draft"]>) => void;
  onSearchChange: (value: string) => void;
  onUpdateVisibleAssignees: (checked: boolean) => void;
  onUpdateSingleAssignee: (assigneeId: string, checked: boolean) => void;
};

export function EventFormAssigneePicker({
  taskEditor,
  editedTaskStatus,
  inactiveAssigneeIds,
  assigneeSearch,
  visibleAssignees,
  selectedVisibleAssigneeCount,
  selectAllVisibleExceedsLimit,
  selectedCommitteeHasActiveMembers,
  assigneeGroups,
  committeeNames,
  onUpdateTaskDraft,
  onSearchChange,
  onUpdateVisibleAssignees,
  onUpdateSingleAssignee,
}: EventFormAssigneePickerProps) {
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="mb-1 text-sm font-semibold">Primary assignees</legend>
      <p className="text-xs text-muted-foreground">
        {taskEditor.taskId
          ? editedTaskStatus === "In Progress"
            ? "Removing all Primary assignees returns this task to To Do in the Backlog."
            : "Primary assignees can be changed without changing this task’s current status."
          : "Leave Primary assignees empty to add this task to the Backlog."}
      </p>
      {inactiveAssigneeIds.length > 0 && (
        <div className="grid gap-2 rounded-xl border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Previously assigned members who are now inactive can stay assigned or be removed.
          </p>
          <div className="flex flex-wrap gap-2">
            {inactiveAssigneeIds.map((assigneeId) => (
              <span
                key={assigneeId}
                className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-2.5 text-xs font-medium"
              >
                Inactive member
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove inactive member"
                  onClick={() =>
                    onUpdateTaskDraft({
                      assigneeIds: taskEditor.draft.assigneeIds.filter(
                        (id) => id !== assigneeId,
                      ),
                    })
                  }
                >
                  <X />
                </Button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search assignees"
          type="search"
          value={assigneeSearch}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={preventSearchFormSubmission}
          placeholder="Search members…"
          className="pl-9"
        />
      </div>

      <div className="grid max-h-64 gap-3 overflow-y-auto rounded-xl border bg-card p-2">
        {visibleAssignees.length >= 2 && (
          <AssigneeBulkControls
            committeeName={committeeNames.get(taskEditor.draft.committeeId) ?? "selected committee"}
            visibleCount={visibleAssignees.length}
            selectedVisibleCount={selectedVisibleAssigneeCount}
            selectAllDisabled={selectAllVisibleExceedsLimit}
            onSelectAll={(checked) => onUpdateVisibleAssignees(checked)}
            onClear={() => onUpdateVisibleAssignees(false)}
          />
        )}

        {!selectedCommitteeHasActiveMembers && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            No active members in this committee. You can still assign people
            from other committees.
          </p>
        )}

        {assigneeGroups.selected.length > 0 && (
          <AssigneeGroup
            title={`${committeeNames.get(taskEditor.draft.committeeId) ?? "Selected committee"} members`}
            assignees={assigneeGroups.selected}
            selectedIds={taskEditor.draft.assigneeIds}
            committeeNames={committeeNames}
            onToggle={(assigneeId, checked) =>
              onUpdateSingleAssignee(assigneeId, checked)
            }
          />
        )}

        {assigneeGroups.other.length > 0 && (
          <AssigneeGroup
            title="Other committees"
            assignees={assigneeGroups.other}
            selectedIds={taskEditor.draft.assigneeIds}
            committeeNames={committeeNames}
            onToggle={(assigneeId, checked) =>
              onUpdateSingleAssignee(assigneeId, checked)
            }
          />
        )}

        {assigneeGroups.selected.length === 0 &&
          assigneeGroups.other.length === 0 &&
          selectedCommitteeHasActiveMembers && (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              No members match your search.
            </p>
          )}
      </div>
      <p className="text-xs text-muted-foreground">
        {taskEditor.draft.assigneeIds.length} selected.
      </p>
    </fieldset>
  );
}

function AssigneeGroup({
  title,
  assignees,
  selectedIds,
  committeeNames,
  onToggle,
}: {
  title: string;
  assignees: AssigneeOption[];
  selectedIds: string[];
  committeeNames: Map<string, string>;
  onToggle: (assigneeId: string, checked: boolean) => void;
}) {
  return (
    <div className="grid gap-1">
      <p className="px-2 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {assignees.map((assignee) => {
        const inputId = `assignee-${assignee.id}`;
        const selected = selectedIds.includes(assignee.id);
        return (
          <label
            key={assignee.id}
            htmlFor={inputId}
            className={`motion-control-trigger flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-within:ring-3 focus-within:ring-ring/50 active:bg-muted motion-reduce:transition-none ${
              selected
                ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                : "border-transparent hover:bg-muted"
            }`}
          >
            <input
              id={inputId}
              type="checkbox"
              checked={selected}
              onChange={(event) => onToggle(assignee.id, event.target.checked)}
              className="motion-control-pop size-5 shrink-0 accent-primary"
            />
            <UserAvatar
              name={assignee.full_name}
              src={assignee.avatar_url}
              size="sm"
              className="size-7 text-[10px]"
            />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">
                {assignee.full_name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {assignee.activeTaskCount} active{" "}
                {assignee.activeTaskCount === 1 ? "task" : "tasks"}
              </span>
            </span>
            <Badge
              variant="neutral"
              className="max-w-28 truncate px-2 py-0.5 text-[10px]"
            >
              {assignee.committee_id
                ? (committeeNames.get(assignee.committee_id) ?? "Unknown committee")
                : "No committee"}
            </Badge>
          </label>
        );
      })}
    </div>
  );
}

function AssigneeBulkControls({
  committeeName,
  visibleCount,
  selectedVisibleCount,
  selectAllDisabled,
  onSelectAll,
  onClear,
}: {
  committeeName: string;
  visibleCount: number;
  selectedVisibleCount: number;
  selectAllDisabled: boolean;
  onSelectAll: (checked: boolean) => void;
  onClear: () => void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = selectedVisibleCount === visibleCount;
  const partlySelected = selectedVisibleCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partlySelected;
    }
  }, [partlySelected]);

  return (
    <div className="grid gap-1 border-b bg-card px-2 pb-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <label className="motion-control-trigger flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1 text-xs font-semibold transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50 active:bg-muted motion-reduce:transition-none has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            aria-checked={partlySelected ? "mixed" : allSelected}
            aria-describedby={selectAllDisabled ? "assignee-select-all-limit" : undefined}
            disabled={selectAllDisabled}
            onChange={(event) => onSelectAll(event.target.checked)}
            className="motion-control-pop size-5 shrink-0 accent-primary"
          />
          <span className="truncate">Select all shown in {committeeName} ({visibleCount})</span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={selectedVisibleCount === 0}
          onClick={onClear}
          className="shrink-0 active:bg-muted"
        >
          Clear shown
        </Button>
      </div>
      {selectAllDisabled && (
        <p id="assignee-select-all-limit" className="text-xs text-muted-foreground">
          You can select up to 100 assignees. Clear another selection before
          selecting all shown.
        </p>
      )}
    </div>
  );
}
