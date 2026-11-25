"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarClock, CheckCircle2, ChevronRight } from "lucide-react";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { StretchedLink } from "@/components/shared/stretched-link";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TabPanel, useListReveal } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { APP_TIME_ZONE } from "@/lib/timezone";

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

const NO_PHASE = "Unphased";
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

  // null = every phase, grouped. Picking a phase shows just that phase, like the live event board.
  // Selection is the group's position (null = all), never its label, so a phase literally named
  // like a sentinel cannot collide with "All phases" or the unphased bucket.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [tabMotionKey, setTabMotionKey] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const tabId = (index: number | null) => `${baseId}-tab-${index ?? "all"}`;
  const activeIndex =
    selectedIndex !== null && selectedIndex < groups.length ? selectedIndex : null;
  const visibleGroups =
    activeIndex === null ? groups : [groups[activeIndex]];
  const tabs: Array<{ index: number | null; label: string; count: number }> = [
    { index: null, label: "All phases", count: tasks.length },
    ...groups.map((group, index) => ({
      index,
      label: group.phase,
      count: group.tasks.length,
    })),
  ];

  function selectPhase(index: number | null) {
    if (index === activeIndex) return;
    setSelectedIndex(index);
    setTabMotionKey((current) => current + 1);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    position: number,
  ) {
    let next: number;
    if (event.key === "ArrowRight") next = (position + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (position - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectPhase(tabs[next].index);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="grid gap-5">
      {groups.length > 1 ? (
        <div
          className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 gap-5 overflow-x-auto border-b px-1"
          role="tablist"
          aria-label="Archived event phases"
        >
          {tabs.map(({ index, label, count }, position) => {
            const selected = activeIndex === index;
            return (
              <button
                key={index === null ? "all" : `phase-${index}`}
                ref={(node) => {
                  tabRefs.current[position] = node;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                id={tabId(index)}
                aria-controls={selected ? panelId : undefined}
                tabIndex={selected ? 0 : -1}
                title={label}
                onClick={() => selectPhase(index)}
                onKeyDown={(event) => handleTabKeyDown(event, position)}
                className={cn(
                  "flex h-11 max-w-[75vw] shrink-0 items-center gap-2 rounded-t-md border-b-2 px-1 font-display text-sm font-semibold whitespace-nowrap transition-colors duration-300 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted motion-reduce:transition-none sm:text-base",
                  selected
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground",
                )}
              >
                <span className="truncate">{label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                    selected
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <TabPanel
        motionKey={tabMotionKey}
        className="grid gap-7"
        {...(groups.length > 1
          ? {
              id: panelId,
              role: "tabpanel",
              "aria-labelledby": tabId(activeIndex),
            }
          : {})}
      >
        {visibleGroups.map((group, groupIndex) => {
          const headingId = `archived-phase-${groupIndex}`;
          const showHeading = activeIndex === null;

          return (
            <section
              key={`${groupIndex}-${group.phase}`}
              aria-labelledby={headingId}
            >
              <div
                className={cn(
                  "mb-2.5 flex min-w-0 items-baseline gap-2",
                  showHeading ? "border-b pb-2" : "sr-only",
                )}
              >
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

              <div className="grid gap-3">
                {group.tasks.map((task) => {
                  const content = taskContent.get(task.id);
                  const people = Array.from(
                    new Set([
                      ...task.primary_assignees,
                      ...task.assist_assignees,
                    ]),
                  ).map((assigneeId) => {
                    const assignee = assignees.get(assigneeId);
                    return {
                      id: assigneeId,
                      assignee,
                      name: assignee?.full_name ?? "Former member",
                    };
                  });
                  const completed = task.status === "Completed";

                  return (
                    <Card
                      interactive
                      key={task.id}
                      {...reveal.getRevealProps(task.id)}
                      className="group relative overflow-hidden hover:bg-muted/20"
                    >
                      <StretchedLink
                        href={`/tasks/${task.id}`}
                        label={`Open ${content?.title ?? "Task details unavailable"}`}
                        className="transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted/60 motion-reduce:transition-none"
                      />
                      <div className="flex items-start gap-3 p-4 sm:p-5">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-display text-base font-semibold leading-snug sm:text-lg">
                            {content?.title ?? "Task details unavailable"}
                          </h4>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <PriorityBadge priority={task.priority} />
                            <Badge variant={completed ? "success" : "outline"}>
                              {completed ? <CheckCircle2 aria-hidden /> : null}
                              {task.status}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {task.task_type === "LiveOperation"
                                ? "Live Operation"
                                : "Deliverable"}
                            </span>
                          </div>
                          {content?.description ? (
                            <p className="mt-2.5 line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                              {content.description}
                            </p>
                          ) : null}

                          {task.due_date || people.length > 0 ? (
                            <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-3">
                              {task.due_date ? (
                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <CalendarClock
                                    className="size-3.5"
                                    aria-hidden
                                  />
                                  Due{" "}
                                  {taskDateFormatter.format(
                                    new Date(task.due_date),
                                  )}
                                </span>
                              ) : null}

                              {people.length > 0 ? (
                                assigneesUnavailable ? (
                                  <span className="text-xs text-muted-foreground">
                                    Assignee names are unavailable.
                                  </span>
                                ) : (
                                  <div
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
                                    aria-label="Assignees"
                                  >
                                    {people.map(({ id, assignee, name }) => (
                                      <span
                                        key={id}
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
                                    ))}
                                  </div>
                                )
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        <ChevronRight
                          className="motion-arrow mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
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
      </TabPanel>
    </div>
  );
}
