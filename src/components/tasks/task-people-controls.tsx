"use client";

import { useMemo, useState } from "react";
import { Ellipsis, LogOut, Search, Trash2, UsersRound } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  assigneeIdsAreUnchanged,
  MAX_TASK_ASSIGNEES,
  type TaskEditControlData,
  type TaskEditViewer,
} from "@/lib/tasks/edit-controls";
import { formatWorkloadLabel } from "@/lib/tasks/workload";
import { preventSearchFormSubmission } from "@/lib/search";

type TaskPeopleControlsProps = {
  controls: TaskEditControlData;
  taskTitle: string;
  onAssignPeople: (
    primaryAssigneeIds: string[],
    assistAssigneeIds: string[],
  ) => Promise<void>;
  onDeleteTask: () => Promise<void>;
  onUnassignSelf: () => Promise<void>;
  workloadCounts: ReadonlyMap<string, number>;
};

function personName(person: TaskEditViewer) {
  return person.full_name?.trim() || "Former member";
}

export function TaskPeopleControls({
  controls,
  taskTitle,
  onAssignPeople,
  onDeleteTask,
  onUnassignSelf,
  workloadCounts,
}: TaskPeopleControlsProps) {
  const currentPrimaryIds = controls.primary_assignees.map(
    (person) => person.id,
  );
  const currentAssistIds = controls.assist_assignees.map((person) => person.id);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unassignOpen, setUnassignOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [primaryIds, setPrimaryIds] = useState<string[]>(currentPrimaryIds);
  const [assistIds, setAssistIds] = useState<string[]>(currentAssistIds);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeOptionIds = useMemo(
    () => new Set(controls.assignee_options.map((person) => person.id)),
    [controls.assignee_options],
  );
  const people = useMemo(() => {
    const byId = new Map<string, TaskEditViewer>();
    for (const person of controls.primary_assignees)
      byId.set(person.id, person);
    for (const person of controls.assist_assignees) byId.set(person.id, person);
    for (const person of controls.assignee_options) byId.set(person.id, person);
    const query = search.trim().toLocaleLowerCase();
    return [...byId.values()].filter((person) =>
      personName(person).toLocaleLowerCase().includes(query),
    );
  }, [controls, search]);

  const assignmentCount = primaryIds.length + assistIds.length;
  const assignmentUnchanged = assigneeIdsAreUnchanged(
    currentPrimaryIds,
    currentAssistIds,
    primaryIds,
    assistIds,
  );

  function openAssignment() {
    setPrimaryIds(currentPrimaryIds);
    setAssistIds(currentAssistIds);
    setSearch("");
    setActionError(null);
    setAssignmentOpen(true);
  }

  function setPersonCategory(
    personId: string,
    category: "none" | "primary" | "assist",
  ) {
    setPrimaryIds((current) => {
      const withoutPerson = current.filter((id) => id !== personId);
      return category === "primary"
        ? [...withoutPerson, personId]
        : withoutPerson;
    });
    setAssistIds((current) => {
      const withoutPerson = current.filter((id) => id !== personId);
      return category === "assist"
        ? [...withoutPerson, personId]
        : withoutPerson;
    });
  }

  async function saveAssignment() {
    setSavingAssignment(true);
    setActionError(null);
    try {
      await onAssignPeople(primaryIds, assistIds);
      setAssignmentOpen(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The assignees could not be saved.",
      );
    } finally {
      setSavingAssignment(false);
    }
  }

  async function deleteTask() {
    setDeleting(true);
    setActionError(null);
    try {
      await onDeleteTask();
      setDeleteOpen(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The task could not be deleted.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function unassignSelf() {
    setUnassigning(true);
    setActionError(null);
    try {
      await onUnassignSelf();
      setUnassignOpen(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "You could not leave this task.",
      );
    } finally {
      setUnassigning(false);
    }
  }

  const selfUnassignMessage =
    controls.self_unassign_block_code === "completed"
      ? "Completed tasks cannot be self-unassigned. Ask an Admin or Co-Admin to update the assignees."
      : controls.self_unassign_block_code === "due"
        ? "This task is due within 72 hours. Ask an Admin or Co-Admin to remove you."
        : null;

  const showTaskActions =
    controls.can_delete ||
    controls.can_unassign_self ||
    selfUnassignMessage !== null;

  return (
    <>
      {controls.can_assign_people ? (
        <Card className="overflow-hidden">
          <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
            <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              <UsersRound className="size-4" aria-hidden /> Assignment
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
            <p className="text-sm text-muted-foreground">
              {currentPrimaryIds.length} primary · {currentAssistIds.length}{" "}
              assist
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={openAssignment}
              disabled={savingAssignment || deleting || unassigning}
            >
              Manage assignees
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showTaskActions ? (
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-3 px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
            <CardTitle className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Task actions
            </CardTitle>
            {controls.can_delete ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`More actions for ${taskTitle}`}
                  disabled={deleting || unassigning}
                  className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none sm:size-9"
                >
                  <Ellipsis aria-hidden className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent aria-label={`Actions for ${taskTitle}`}>
                  <DropdownMenuItem
                    className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                    onClick={() => {
                      setActionError(null);
                      setDeleteOpen(true);
                    }}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    Delete task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
            {controls.can_unassign_self || selfUnassignMessage ? (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setActionError(null);
                    setUnassignOpen(true);
                  }}
                  disabled={
                    !controls.can_unassign_self || unassigning || deleting
                  }
                >
                  <LogOut aria-hidden /> Leave task
                </Button>
                {selfUnassignMessage ? (
                  <p className="text-xs text-muted-foreground">
                    {selfUnassignMessage}
                  </p>
                ) : null}
              </div>
            ) : null}
            {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={assignmentOpen} onOpenChange={setAssignmentOpen}>
        <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Task assignees</DialogTitle>
            <DialogDescription>
              Choose primary owners and assist assignees. A task without a
              primary owner returns to the To Do Backlog unless it is Completed.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            <label htmlFor="task-assignee-search" className="sr-only">
              Search assignees
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="task-assignee-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={preventSearchFormSubmission}
                placeholder="Search people"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {assignmentCount} of {MAX_TASK_ASSIGNEES} assigned
            </p>
            <div className="space-y-2">
              {people.map((person) => {
                const category = primaryIds.includes(person.id)
                  ? "primary"
                  : assistIds.includes(person.id)
                    ? "assist"
                    : "none";
                const isActive = activeOptionIds.has(person.id);
                return (
                  <fieldset key={person.id} className="rounded-xl border p-3">
                    <legend className="sr-only">
                      Assignment for {personName(person)}
                    </legend>
                    <div className="mb-2 flex items-center gap-2">
                      <UserAvatar
                        name={personName(person)}
                        src={person.avatar_url}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {isActive && workloadCounts.has(person.id)
                          ? formatWorkloadLabel(
                              personName(person),
                              workloadCounts.get(person.id)!,
                            )
                          : personName(person)}
                      </span>
                      {!isActive ? (
                        <span className="text-xs text-muted-foreground">
                          Inactive
                        </span>
                      ) : null}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-xs sm:gap-2">
                      {(["none", "primary", "assist"] as const).map((value) => {
                        const inputId = `task-assignee-${person.id}-${value}`;
                        return (
                          <label
                            key={value}
                            htmlFor={inputId}
                            className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1.5 py-2 hover:bg-muted sm:px-2"
                          >
                            <input
                              id={inputId}
                              type="radio"
                              name={`task-assignee-${person.id}`}
                              checked={category === value}
                              disabled={
                                !isActive &&
                                category !== value &&
                                value !== "none"
                              }
                              onChange={() =>
                                setPersonCategory(person.id, value)
                              }
                              className="size-4 accent-primary"
                            />
                            {value === "none"
                              ? "None"
                              : value === "primary"
                                ? "Primary"
                                : "Assist"}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              {people.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No people match this search.
                </p>
              ) : null}
            </div>
            {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignmentOpen(false)}
              disabled={savingAssignment}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void saveAssignment()}
              disabled={
                savingAssignment ||
                assignmentUnchanged ||
                assignmentCount > MAX_TASK_ASSIGNEES
              }
            >
              {savingAssignment ? "Saving…" : "Save assignees"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete task?"
        description={`“${taskTitle}” will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete task"
        destructive
        loading={deleting}
        onConfirm={() => void deleteTask()}
      />

      <ConfirmDialog
        open={unassignOpen}
        onOpenChange={setUnassignOpen}
        title="Leave this task?"
        description={
          controls.self_unassign_will_lose_access
            ? "You will be removed from this confidential task and will lose access to its details and work links."
            : "You will be removed from this task. If you are its last primary assignee, it will return to the To Do Backlog."
        }
        confirmLabel="Leave task"
        loading={unassigning}
        onConfirm={() => void unassignSelf()}
      />
    </>
  );
}
