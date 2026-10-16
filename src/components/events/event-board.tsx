"use client";

import { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Filter,
  Inbox,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { EventBanner } from "@/components/events/event-banner";
import { EventBoardSkeleton } from "@/components/events/event-board-skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type BoardEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
};

export type BoardCommittee = { id: string; name: string };

type BoardPriority = "Low" | "Medium" | "High" | "Critical";
type BoardStatus = "To Do" | "In Progress" | "Completed";

type BoardAssignee = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export type BoardTask = {
  id: string;
  title: string;
  phase: string | null;
  status: BoardStatus;
  effective_priority: BoardPriority | null;
  due_date: string | null;
  committee_id: string | null;
  committee_name: string | null;
  primary_assignees: BoardAssignee[];
  assist_assignees: BoardAssignee[];
  is_backlog: boolean;
  is_masked: boolean;
};

type EventBoardProps = {
  event: BoardEvent;
  isAdmin: boolean;
  committees: BoardCommittee[];
  initialTasks?: BoardTask[];
};

const STATUSES: BoardStatus[] = ["To Do", "In Progress", "Completed"];
const PRIORITIES: BoardPriority[] = ["Low", "Medium", "High", "Critical"];
const POLL_INTERVAL_MS = 15_000;

const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

function isAssignee(value: unknown): value is BoardAssignee {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (typeof row.full_name === "string" || row.full_name === null) &&
    (typeof row.avatar_url === "string" || row.avatar_url === null)
  );
}

export function isBoardTask(value: unknown): value is BoardTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    (typeof row.phase === "string" || row.phase === null) &&
    STATUSES.includes(row.status as BoardStatus) &&
    (PRIORITIES.includes(row.effective_priority as BoardPriority) ||
      row.effective_priority === null) &&
    (typeof row.due_date === "string" || row.due_date === null) &&
    (typeof row.committee_id === "string" || row.committee_id === null) &&
    (typeof row.committee_name === "string" || row.committee_name === null) &&
    Array.isArray(row.primary_assignees) &&
    row.primary_assignees.every(isAssignee) &&
    Array.isArray(row.assist_assignees) &&
    row.assist_assignees.every(isAssignee) &&
    typeof row.is_backlog === "boolean" &&
    typeof row.is_masked === "boolean"
  );
}

function formatEventDate(date: string) {
  return eventDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatEventDateRange(event: BoardEvent) {
  if (!event.end_date || event.end_date === event.start_date) {
    return formatEventDate(event.start_date);
  }
  return `${formatEventDate(event.start_date)} – ${formatEventDate(event.end_date)}`;
}

function priorityVariant(priority: BoardPriority) {
  if (priority === "Critical") return "destructive" as const;
  if (priority === "High") return "outline" as const;
  return "neutral" as const;
}

function TaskAssignees({ task }: { task: BoardTask }) {
  const assignees = [
    ...task.primary_assignees,
    ...task.assist_assignees,
  ].filter(
    (assignee, index, all) =>
      all.findIndex((candidate) => candidate.id === assignee.id) === index,
  );

  if (task.is_masked) {
    return (
      <LockKeyhole
        className="size-4 text-muted-foreground"
        aria-label="Confidential"
      />
    );
  }

  if (assignees.length === 0) return null;

  return (
    <div className="flex -space-x-2" aria-label="Assignees">
      {assignees.slice(0, 3).map((assignee) => {
        const name = assignee.full_name ?? "Former member";
        return (
          <UserAvatar
            key={assignee.id}
            name={name}
            src={assignee.avatar_url}
            size="sm"
            className="size-7 border-2 border-card text-[10px]"
          />
        );
      })}
      {assignees.length > 3 ? (
        <span className="z-10 inline-flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold">
          +{assignees.length - 3}
        </span>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  backlog = false,
}: {
  task: BoardTask;
  backlog?: boolean;
}) {
  return (
    <Card className={cn("py-4", task.status === "Completed" && "opacity-70")}>
      <CardContent className="space-y-3 px-4">
        <div className="flex items-start justify-between gap-3">
          {task.effective_priority ? (
            <Badge variant={priorityVariant(task.effective_priority)}>
              {task.effective_priority}
            </Badge>
          ) : (
            <Badge variant="neutral">
              <LockKeyhole aria-hidden /> Confidential
            </Badge>
          )}
          {task.status === "Completed" ? (
            <Check className="size-4 text-emerald-600" aria-label="Completed" />
          ) : null}
        </div>
        <p
          className={cn(
            "text-sm font-semibold leading-snug",
            task.status === "Completed" &&
              "line-through decoration-muted-foreground",
          )}
        >
          {task.title}
        </p>
        {backlog && !task.is_masked ? (
          <p className="text-xs text-muted-foreground">
            {task.committee_name ?? "Committee unavailable"} ·{" "}
            {task.phase?.trim() || "Unphased"}
          </p>
        ) : null}
        <div className="flex min-h-7 items-center justify-between gap-3">
          <TaskAssignees task={task} />
          <span className="text-xs text-muted-foreground">
            {task.status === "Completed"
              ? "Completed"
              : task.due_date
                ? `Due ${dueDateFormatter.format(new Date(task.due_date))}`
                : null}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PriorityChoices({
  selected,
  onToggle,
  onClear,
}: {
  selected: Set<BoardPriority>;
  onToggle: (priority: BoardPriority) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-display text-sm font-semibold">Filter by priority</p>
        <Button
          variant="link"
          size="xs"
          onClick={onClear}
          disabled={selected.size === 0}
        >
          Clear
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PRIORITIES.map((priority) => {
          const active = selected.has(priority);
          return (
            <Button
              key={priority}
              type="button"
              variant="outline"
              className={cn(
                "justify-between",
                active && "border-primary bg-muted",
              )}
              aria-pressed={active}
              onClick={() => onToggle(priority)}
            >
              {priority}
              {active ? <Check aria-hidden /> : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function BoardContents({
  event,
  isAdmin,
  committees,
  initialTasks,
}: EventBoardProps) {
  const supabase = useMemo(() => createClient(), []);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [selectedPriorities, setSelectedPriorities] = useState<
    Set<BoardPriority>
  >(() => new Set());
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [backlogOpen, setBacklogOpen] = useState(false);

  const query = useQuery({
    queryKey: ["event-board", event.id, committeeId],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("list_event_board_tasks", {
        p_event_id: event.id,
        p_committee_id: isAdmin ? committeeId : null,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isBoardTask)) {
        throw new Error("The event board returned an invalid response.");
      }
      return data;
    },
    initialData: committeeId === null ? initialTasks : undefined,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const tasks = useMemo(() => query.data ?? [], [query.data]);
  const phases = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.phase?.trim() || "Unphased")),
      ),
    [tasks],
  );

  const selectedPhase =
    activePhase && phases.includes(activePhase)
      ? activePhase
      : (phases[0] ?? null);

  const matchesPriority = (task: BoardTask) =>
    selectedPriorities.size === 0 ||
    task.effective_priority === null ||
    selectedPriorities.has(task.effective_priority);

  const backlogTasks = tasks.filter(
    (task) => task.is_backlog && matchesPriority(task),
  );
  const assignedPhaseTasks = tasks.filter(
    (task) =>
      !task.is_backlog &&
      (task.phase?.trim() || "Unphased") === selectedPhase &&
      matchesPriority(task),
  );
  const completed = tasks.filter((task) => task.status === "Completed").length;
  const completion =
    tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);

  function togglePriority(priority: BoardPriority) {
    setSelectedPriorities((current) => {
      const next = new Set(current);
      if (next.has(priority)) next.delete(priority);
      else next.add(priority);
      return next;
    });
  }

  return (
    <div className="space-y-7">
      <Link
        href="/home"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <ArrowLeft aria-hidden /> Home
      </Link>

      <section className="overflow-hidden rounded-3xl border bg-card">
        <EventBanner
          src={event.banner_url}
          alt={`${event.name} banner`}
          className="h-28 w-full sm:h-36"
        />
        <div className="flex flex-col gap-5 p-5 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                {event.name}
              </h1>
              <Badge variant="outline">Active</Badge>
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="size-4" aria-hidden />
              {formatEventDateRange(event)}
            </p>
            {event.description ? (
              <p className="max-w-2xl text-sm text-muted-foreground">
                {event.description}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {completed} of {tasks.length} visible tasks completed
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="grid size-16 place-items-center rounded-full border-6 border-muted text-sm font-bold"
              aria-label={`${completion}% complete`}
            >
              {completion}%
            </div>
          </div>
        </div>
      </section>

      {query.error ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            The board could not refresh. The last successful result is still
            shown.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div
          className="flex min-w-0 gap-6 overflow-x-auto border-b"
          role="tablist"
          aria-label="Event phases"
        >
          {phases.map((phase) => {
            const count = tasks.filter(
              (task) => (task.phase?.trim() || "Unphased") === phase,
            ).length;
            return (
              <button
                key={phase}
                type="button"
                role="tab"
                aria-selected={selectedPhase === phase}
                className={cn(
                  "shrink-0 border-b-2 px-1 pb-3 font-display text-sm font-semibold",
                  selectedPhase === phase
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground",
                )}
                onClick={() => setActivePhase(phase)}
              >
                {phase}{" "}
                <span className="font-sans text-xs font-normal">
                  {count} tasks
                </span>
              </button>
            );
          })}
        </div>
        <Button variant="outline" onClick={() => setBacklogOpen(true)}>
          <Inbox aria-hidden /> Backlog ({backlogTasks.length})
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Button
            variant="outline"
            aria-expanded={priorityOpen}
            aria-controls="priority-filter-panel"
            onClick={() => setPriorityOpen((open) => !open)}
          >
            <Filter aria-hidden /> Priority
            {selectedPriorities.size > 0 ? (
              <Badge className="px-1.5">{selectedPriorities.size}</Badge>
            ) : null}
          </Button>
          {priorityOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 bg-black/40 md:hidden"
                aria-label="Close priority filter"
                onClick={() => setPriorityOpen(false)}
              />
              <div
                id="priority-filter-panel"
                role="dialog"
                aria-label="Priority filter"
                className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border bg-popover p-4 shadow-2xl md:absolute md:inset-auto md:top-full md:left-0 md:mt-2 md:w-72 md:rounded-2xl"
              >
                <PriorityChoices
                  selected={selectedPriorities}
                  onToggle={togglePriority}
                  onClear={() => setSelectedPriorities(new Set())}
                />
                <Button
                  className="mt-4 w-full md:hidden"
                  onClick={() => setPriorityOpen(false)}
                >
                  Done
                </Button>
              </div>
            </>
          ) : null}
        </div>

        {isAdmin ? (
          <div>
            <label
              htmlFor="board-committee"
              className="mb-1 block text-xs font-semibold text-muted-foreground"
            >
              Committee
            </label>
            <select
              id="board-committee"
              value={committeeId ?? ""}
              onChange={(event) => setCommitteeId(event.target.value || null)}
              className="h-9 rounded-md border bg-card px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <option value="">All committees</option>
              {committees.map((committee) => (
                <option key={committee.id} value={committee.id}>
                  {committee.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {query.isPending ? (
        <EventBoardSkeleton />
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display font-semibold">No tasks are available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try another committee filter or refresh the board.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {STATUSES.map((status) => {
            const laneTasks = assignedPhaseTasks.filter(
              (task) => task.status === status,
            );
            const phaseHasTasks = tasks.some(
              (task) =>
                !task.is_backlog &&
                (task.phase?.trim() || "Unphased") === selectedPhase &&
                task.status === status,
            );
            return (
              <section
                key={status}
                aria-labelledby={`lane-${status.replaceAll(" ", "-")}`}
              >
                <div className="mb-3.5 flex items-center gap-2 px-0.5">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      status === "To Do" && "bg-muted-foreground",
                      status === "In Progress" && "bg-primary",
                      status === "Completed" && "bg-emerald-500",
                    )}
                  />
                  <h2
                    id={`lane-${status.replaceAll(" ", "-")}`}
                    className="text-sm font-semibold tracking-wide uppercase"
                  >
                    {status}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {laneTasks.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {laneTasks.map((task) => (
                    <TaskCard key={task.id} task={task} />
                  ))}
                  {laneTasks.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed p-4 text-center text-xs text-muted-foreground">
                      {phaseHasTasks
                        ? "No tasks match this filter"
                        : "No tasks yet"}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Sheet open={backlogOpen} onOpenChange={setBacklogOpen}>
        <SheetContent className="inset-y-0 right-0 left-auto h-dvh max-h-none w-full max-w-sm rounded-none border-t-0 border-l p-0">
          <SheetTitle>Task Backlog</SheetTitle>
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold">
                Task Backlog
              </h2>
              <p className="text-xs text-muted-foreground">
                Unassigned tasks · read only
              </p>
            </div>
            <SheetClose render={<Button variant="ghost" size="sm" />}>
              Close
            </SheetClose>
          </div>
          <div className="space-y-3 overflow-y-auto p-5">
            {backlogTasks.map((task) => (
              <TaskCard key={task.id} task={task} backlog />
            ))}
            {backlogTasks.length === 0 ? (
              <p className="rounded-xl border-2 border-dashed p-5 text-center text-sm text-muted-foreground">
                No Backlog tasks match this view.
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function EventBoard(props: EventBoardProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BoardContents {...props} />
    </QueryClientProvider>
  );
}
