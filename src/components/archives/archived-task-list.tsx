"use client";

import { CalendarClock, ChevronRight } from "lucide-react";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { StretchedLink } from "@/components/shared/stretched-link";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useListReveal } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

export type ArchivedTask = {
  id: string;
  phase: string | null;
  status: "To Do" | "In Progress" | "Completed";
  priority: "Low" | "Medium" | "High" | "Critical";
  task_type: "Deliverable" | "LiveOperation";
  due_date: string | null;
  primary_assignees: string[];
  assist_assignees: string[];
};

export type ArchivedTaskContent = {
  id: string;
  title: string;
  description: string | null;
};

export type ArchivedAssignee = {
  id: string;
  full_name: string;
  avatar_url: string | null;
};

export type ArchivedTaskGroup = {
  phase: string;
  tasks: ArchivedTask[];
};

const NO_PHASE = "No phase";
const MASKED_TASK_TITLE = "🔒 Confidential Task";

const taskDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

export function groupArchivedTasksByPhase(
  tasks: ArchivedTask[],
  taskContent: ReadonlyMap<string, ArchivedTaskContent> = new Map(),
): ArchivedTaskGroup[] {
  // Match the board's first-seen named-phase order. The archive keeps its
  // existing created_at task order, while the owner-approved No phase bucket
  // is always placed last.
  const namedGroups = new Map<string, ArchivedTask[]>();
  const noPhaseTasks: ArchivedTask[] = [];

  for (const task of tasks) {
    const content = taskContent.get(task.id);
    const isMasked =
      content?.title === MASKED_TASK_TITLE && content.description === null;
    const phase = isMasked ? undefined : task.phase?.trim();
    if (!phase) {
      noPhaseTasks.push(task);
      continue;
    }

    const group = namedGroups.get(phase);
    if (group) {
      group.push(task);
    } else {
      namedGroups.set(phase, [task]);
    }
  }

  const groups = Array.from(namedGroups, ([phase, phaseTasks]) => ({
    phase,
    tasks: phaseTasks,
  }));

  if (noPhaseTasks.length > 0) {
    groups.push({ phase: NO_PHASE, tasks: noPhaseTasks });
  }

  return groups;
}

function formatTaskCount(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

export function ArchivedTaskList({
  tasks,
  taskContent,
  assignees,
  assigneesUnavailable,
}: {
  tasks: ArchivedTask[];
  taskContent: ReadonlyMap<string, ArchivedTaskContent>;
  assignees: ReadonlyMap<string, ArchivedAssignee>;
  assigneesUnavailable: boolean;
}) {
  const groups = groupArchivedTasksByPhase(tasks, taskContent);
  const flattenedTasks = groups.flatMap((group) => group.tasks);
  const reveal = useListReveal({
    initialItems: flattenedTasks,
    items: flattenedTasks,
    settled: true,
    getId: (task: ArchivedTask) => task.id,
  });

  return (
    <div className="grid gap-7">
      {groups.map((group, groupIndex) => {
        const headingId = `archived-phase-${groupIndex}`;

        return (
          <section
            key={`${groupIndex}-${group.phase}`}
            aria-labelledby={headingId}
          >
            <div className="mb-2.5 flex min-w-0 items-baseline gap-2 border-b pb-2">
              <h3
                id={headingId}
                className="min-w-0 truncate font-display text-base font-semibold"
                title={group.phase}
              >
                {group.phase}
              </h3>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatTaskCount(group.tasks.length)}
              </span>
            </div>

            <div className="grid gap-2.5">
              {group.tasks.map((task) => {
                const content = taskContent.get(task.id);
                const assigneeIds = Array.from(
                  new Set([
                    ...task.primary_assignees,
                    ...task.assist_assignees,
                  ]),
                );

                return (
                  <Card
                    key={task.id}
                    {...reveal.getRevealProps(task.id)}
                    className={cn(
                      "motion-card-interaction group relative overflow-hidden rounded-xl hover:border-primary/40 hover:bg-muted/20 has-[a:focus-visible]:border-primary/50",
                    )}
                  >
                    <StretchedLink
                      href={`/tasks/${task.id}`}
                      label={`Open ${content?.title ?? "Task details unavailable"}`}
                      className="transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted/60 motion-reduce:transition-none"
                    />
                    <div className="grid gap-3 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:p-4">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <PriorityBadge priority={task.priority} />
                          <Badge variant="outline">{task.status}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {task.task_type === "LiveOperation"
                              ? "Live Operation"
                              : "Deliverable"}
                          </span>
                        </div>
                        <h4 className="font-display text-sm font-semibold leading-snug sm:text-base">
                          {content?.title ?? "Task details unavailable"}
                        </h4>
                        {content?.description ? (
                          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                            {content.description}
                          </p>
                        ) : null}

                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {task.due_date ? (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <CalendarClock className="size-3.5" aria-hidden />
                              Due{" "}
                              {taskDateFormatter.format(
                                new Date(task.due_date),
                              )}
                            </span>
                          ) : null}

                          {assigneeIds.length > 0 ? (
                            assigneesUnavailable ? (
                              <span className="text-xs text-muted-foreground">
                                Assignee names are unavailable.
                              </span>
                            ) : (
                              <div
                                className="flex flex-wrap items-center gap-2"
                                aria-label="Assignees"
                              >
                                {assigneeIds.map((assigneeId) => {
                                  const assignee = assignees.get(assigneeId);
                                  const name =
                                    assignee?.full_name ?? "Former member";

                                  return (
                                    <span
                                      key={assigneeId}
                                      className="flex items-center gap-1.5 text-xs"
                                    >
                                      <UserAvatar
                                        name={name}
                                        src={assignee?.avatar_url}
                                        size="sm"
                                        className={
                                          assignee
                                            ? "size-6 text-[9px]"
                                            : "size-6 bg-muted text-[9px] text-muted-foreground"
                                        }
                                      />
                                      <span>{name}</span>
                                    </span>
                                  );
                                })}
                              </div>
                            )
                          ) : null}
                        </div>
                      </div>

                      <ChevronRight
                        className="motion-arrow hidden size-4 text-muted-foreground group-hover:text-foreground sm:block"
                        aria-hidden
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
