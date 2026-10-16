"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type TransitionEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Filter,
  Inbox,
  LockKeyhole,
  RefreshCw,
  X,
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
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BOARD_PRIORITIES,
  BOARD_STATUSES,
  isBoardTask,
  type BoardCommittee,
  type BoardEvent,
  type BoardPriority,
  type BoardTask,
} from "@/lib/events/board";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type EventBoardProps = {
  event: BoardEvent;
  isAdmin: boolean;
  committees: BoardCommittee[];
  initialTasks?: BoardTask[];
};

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

function formatEventDate(date: string) {
  return eventDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatEventDateRange(event: BoardEvent) {
  if (!event.end_date || event.end_date === event.start_date) {
    return formatEventDate(event.start_date);
  }
  return `${formatEventDate(event.start_date)} – ${formatEventDate(event.end_date)}`;
}

function formatTaskCount(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
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
  const showBacklogFooter =
    task.is_masked ||
    task.status === "Completed" ||
    task.due_date !== null ||
    task.primary_assignees.length > 0 ||
    task.assist_assignees.length > 0;

  return (
    <Card
      className={cn(
        "p-0",
        task.status === "Completed" && !task.is_masked && "opacity-70",
        backlog &&
          "transition-[transform,opacity] hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          {!task.is_masked && task.effective_priority ? (
            <Badge
              variant={priorityVariant(task.effective_priority)}
              className={cn(backlog && "gap-1.5 px-2 text-xs")}
            >
              {backlog ? (
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
              ) : null}
              {task.effective_priority}
            </Badge>
          ) : (
            <Badge variant="neutral">
              <LockKeyhole aria-hidden /> Confidential
            </Badge>
          )}
          {task.status === "Completed" && !task.is_masked ? (
            <Check className="size-4 text-emerald-600" aria-label="Completed" />
          ) : null}
        </div>
        <p
          className={cn(
            "text-sm font-semibold leading-snug",
            backlog && "line-clamp-2",
            task.status === "Completed" && !task.is_masked &&
              "line-through decoration-muted-foreground",
          )}
        >
          {task.title}
        </p>
        {backlog && !task.is_masked ? (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              {task.committee_name ?? "Committee unavailable"}
            </span>
            <span
              className="shrink-0 rounded-full bg-muted px-2 py-0.5"
              title={task.phase?.trim() || "Unphased"}
            >
              {task.phase?.trim() || "Unphased"}
            </span>
          </div>
        ) : null}
        {!backlog || showBacklogFooter ? (
          <div className="flex min-h-7 items-center justify-between gap-3">
            <TaskAssignees task={task} />
            <span className="text-xs text-muted-foreground">
              {task.is_masked
                ? null
                : task.status === "Completed"
                ? "Completed"
                : task.due_date
                  ? `Due ${dueDateFormatter.format(new Date(task.due_date))}`
                  : null}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PriorityChoices({
  selected,
  onToggle,
}: {
  selected: Set<BoardPriority>;
  onToggle: (priority: BoardPriority) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="font-display text-sm font-semibold">Filter by priority</p>
      <div className="grid grid-cols-2 gap-2">
        {BOARD_PRIORITIES.map((priority) => {
          const active = selected.has(priority);
          return (
            <Button
              key={priority}
              type="button"
              variant="outline"
              className={cn(
                "h-11 justify-between",
                active && "border-primary bg-primary/10 text-primary",
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
  const [priorityPanelMounted, setPriorityPanelMounted] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [committeePanelMounted, setCommitteePanelMounted] = useState(false);
  const [committeeActiveIndex, setCommitteeActiveIndex] = useState(0);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const priorityTriggerRef = useRef<HTMLButtonElement>(null);
  const priorityPanelRef = useRef<HTMLDivElement>(null);
  const priorityOverlayRef = useRef<HTMLButtonElement>(null);
  const priorityReturnFocusRef = useRef(true);
  const committeeTriggerRef = useRef<HTMLButtonElement>(null);
  const committeePanelRef = useRef<HTMLDivElement>(null);
  const committeeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const committeeReturnFocusRef = useRef(true);
  const backlogButtonRef = useRef<HTMLButtonElement>(null);

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
  const selectedPhaseTasks = tasks.filter(
    (task) => (task.phase?.trim() || "Unphased") === selectedPhase,
  );
  const unassignedSelectedPhaseTasks = selectedPhaseTasks.filter(
    (task) => task.is_backlog,
  );
  const assignedPhaseTasks = tasks.filter(
    (task) =>
      !task.is_backlog &&
      (task.phase?.trim() || "Unphased") === selectedPhase &&
      matchesPriority(task),
  );
  const isUnfilteredSelectedPhase =
    committeeId === null &&
    selectedPriorities.size === 0;
  const isUnfilteredBacklogOnlyPhase =
    isUnfilteredSelectedPhase &&
    selectedPhaseTasks.length > 0 &&
    unassignedSelectedPhaseTasks.length === selectedPhaseTasks.length;
  const isUnfilteredMixedPhase =
    isUnfilteredSelectedPhase &&
    unassignedSelectedPhaseTasks.length > 0 &&
    unassignedSelectedPhaseTasks.length < selectedPhaseTasks.length;
  const completed = tasks.filter((task) => task.status === "Completed").length;
  const completion =
    tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
  const selectedPriorityLabel = BOARD_PRIORITIES.filter((priority) =>
    selectedPriorities.has(priority),
  ).join(", ");
  const priorityButtonLabel = selectedPriorityLabel
    ? selectedPriorityLabel.length > 24
      ? `Priority: ${selectedPriorities.size} selected`
      : `Priority: ${selectedPriorityLabel}`
    : "Priority";
  const committeeOptions = [
    { id: null, name: "All committees" },
    ...committees,
  ];
  const selectedCommitteeIndex = committeeOptions.findIndex(
    (committee) => committee.id === committeeId,
  );
  const committeeButtonLabel =
    committeeOptions[selectedCommitteeIndex]?.name ?? "All committees";

  useEffect(() => {
    if (!priorityOpen && !committeeOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const isPriorityOverlay = priorityOverlayRef.current?.contains(target) ?? false;
      if (
        priorityOpen &&
        !priorityPanelRef.current?.contains(target) &&
        !priorityTriggerRef.current?.contains(target)
      ) {
        closePriorityFilter(isPriorityOverlay);
      }
      if (
        committeeOpen &&
        !committeePanelRef.current?.contains(target) &&
        !committeeTriggerRef.current?.contains(target)
      ) {
        closeCommitteeFilter(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (committeeOpen) closeCommitteeFilter();
        else closePriorityFilter();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [priorityOpen, committeeOpen]);

  function openPriorityFilter() {
    committeeReturnFocusRef.current = false;
    if (committeeOpen) closeCommitteeFilter(false);
    setPriorityPanelMounted(true);
    requestAnimationFrame(() => setPriorityOpen(true));
  }

  function closePriorityFilter(returnFocus = true) {
    priorityReturnFocusRef.current = returnFocus;
    setPriorityOpen(false);
  }

  function handlePriorityPanelTransitionEnd(
    event: TransitionEvent<HTMLDivElement>,
  ) {
    if (
      event.target === event.currentTarget &&
      event.propertyName === "opacity" &&
      !priorityOpen
    ) {
      setPriorityPanelMounted(false);
      if (priorityReturnFocusRef.current) {
        priorityTriggerRef.current?.focus();
      }
    }
  }

  function openCommitteeFilter() {
    priorityReturnFocusRef.current = false;
    if (priorityOpen) closePriorityFilter(false);
    setCommitteeActiveIndex(Math.max(selectedCommitteeIndex, 0));
    setCommitteePanelMounted(true);
    requestAnimationFrame(() => {
      setCommitteeOpen(true);
      requestAnimationFrame(() => {
        committeeOptionRefs.current[
          Math.max(selectedCommitteeIndex, 0)
        ]?.focus();
      });
    });
  }

  function closeCommitteeFilter(returnFocus = true) {
    committeeReturnFocusRef.current = returnFocus;
    setCommitteeOpen(false);
  }

  function handleCommitteePanelTransitionEnd(
    event: TransitionEvent<HTMLDivElement>,
  ) {
    if (
      event.target === event.currentTarget &&
      event.propertyName === "opacity" &&
      !committeeOpen
    ) {
      setCommitteePanelMounted(false);
      if (committeeReturnFocusRef.current) {
        committeeTriggerRef.current?.focus();
      }
    }
  }

  function selectCommittee(id: string | null) {
    setCommitteeId(id);
    closeCommitteeFilter();
  }

  function handleCommitteeOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        event.key === "ArrowDown"
          ? (index + 1) % committeeOptions.length
          : (index - 1 + committeeOptions.length) % committeeOptions.length;
      setCommitteeActiveIndex(nextIndex);
      committeeOptionRefs.current[nextIndex]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectCommittee(committeeOptions[index].id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommitteeFilter();
    }
  }

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
        <div className="flex flex-col lg:flex-row">
          <div className="w-full px-5 pt-5 sm:px-8 sm:pt-8 lg:w-2/5 lg:shrink-0 lg:px-0 lg:pt-0">
            <div className="mx-auto w-full max-w-xl lg:max-w-none">
              <EventBanner
                src={event.banner_url}
                alt={`${event.name} banner`}
                className="aspect-video w-full"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-4 p-5 sm:p-8">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {event.name}
                </h1>
                <Badge variant="outline">Active</Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                {formatEventDateRange(event)}
              </p>
              {event.description ? (
                <p className="text-sm text-muted-foreground">
                  {event.description}
                </p>
              ) : null}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                {completed} of {formatTaskCount(tasks.length)} completed
              </p>
            </div>
            <div className="shrink-0">
              <div
                className="grid size-16 place-items-center rounded-full border-6 border-muted text-sm font-bold"
                aria-label={`${completion}% complete`}
              >
                {completion}%
              </div>
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
          className="flex w-full min-w-0 gap-8 overflow-x-auto border-b md:flex-1"
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
                title={phase}
                className={cn(
                  "flex h-11 max-w-[75vw] shrink-0 items-center border-b-2 px-1 font-display text-base font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:max-w-xs",
                  selectedPhase === phase
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground",
                )}
                onClick={() => setActivePhase(phase)}
              >
                <span className="flex min-w-0 items-center">
                  <span className="truncate">{phase}</span>
                  <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 font-sans text-xs font-normal text-muted-foreground">
                    {formatTaskCount(count)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="flex w-full min-w-0 items-center gap-2"
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2",
            isAdmin ? "md:w-[30rem] md:flex-none" : "sm:max-w-sm",
          )}
        >
          <div className="relative min-w-0 flex-1">
          <Button
            ref={priorityTriggerRef}
            variant="outline"
            className="h-10 w-full min-w-0 justify-start px-3 text-sm"
            aria-haspopup="dialog"
            aria-expanded={priorityOpen}
            aria-controls="priority-filter-panel"
            aria-label={priorityButtonLabel}
            onClick={() =>
              priorityOpen ? closePriorityFilter() : openPriorityFilter()
            }
          >
            <Filter aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">
              {priorityButtonLabel}
            </span>
            <ChevronDown
              className={cn(
                "ml-auto transition-transform duration-150 motion-reduce:rotate-0 motion-reduce:transition-none",
                priorityOpen && "rotate-180",
              )}
              aria-hidden
            />
          </Button>
          {priorityPanelMounted ? (
            <>
              <button
                ref={priorityOverlayRef}
                type="button"
                className={cn(
                  "fixed inset-0 z-40 bg-black/40 transition-opacity duration-150 sm:hidden motion-reduce:duration-[120ms]",
                  priorityOpen ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                aria-label="Close priority filter"
                onClick={() => closePriorityFilter()}
              />
              <div
                id="priority-filter-panel"
                ref={priorityPanelRef}
                role="dialog"
                aria-label="Priority filter"
                onTransitionEnd={handlePriorityPanelTransitionEnd}
                className={cn(
                  "absolute top-full left-0 z-50 mt-2 w-full min-w-[14rem] max-w-[calc(100vw-1rem)] rounded-2xl border bg-popover p-4 shadow-2xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:transform-none",
                  priorityOpen
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-[0.98] opacity-0 motion-reduce:scale-100",
                )}
              >
                <PriorityChoices
                  selected={selectedPriorities}
                  onToggle={togglePriority}
                />
                <div className="mt-4 flex items-center justify-between gap-3">
                  {selectedPriorities.size > 0 ? (
                    <Button
                      variant="link"
                      className="h-11 px-0 lg:h-10"
                      onClick={() => setSelectedPriorities(new Set())}
                    >
                      Clear
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    className="h-11 sm:hidden"
                    onClick={() => closePriorityFilter()}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </>
          ) : null}
          </div>

          {isAdmin ? (
            <div className="relative min-w-0 flex-1">
            <Button
              ref={committeeTriggerRef}
              variant="outline"
              className="h-10 w-full min-w-0 justify-start px-3 text-sm"
              aria-haspopup="listbox"
              aria-expanded={committeeOpen}
              aria-controls="committee-filter-panel"
              aria-label={`Committee: ${committeeButtonLabel}`}
              onClick={() =>
                committeeOpen ? closeCommitteeFilter() : openCommitteeFilter()
              }
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {committeeButtonLabel}
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto transition-transform duration-150 motion-reduce:rotate-0 motion-reduce:transition-none",
                  committeeOpen && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
            {committeePanelMounted ? (
              <div
                id="committee-filter-panel"
                ref={committeePanelRef}
                role="listbox"
                aria-label="Committee filter"
                aria-activedescendant={`committee-filter-option-${committeeActiveIndex}`}
                onTransitionEnd={handleCommitteePanelTransitionEnd}
                className={cn(
                  "absolute top-full right-0 z-50 mt-2 w-full min-w-[14rem] max-w-[calc(100vw-1rem)] rounded-2xl border bg-popover p-2 shadow-2xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:transform-none sm:right-auto sm:left-0",
                  committeeOpen
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-[0.98] opacity-0 motion-reduce:scale-100",
                )}
              >
                <div className="max-h-60 space-y-1 overflow-y-auto overscroll-contain">
                  {committeeOptions.map((committee, index) => {
                    const selected = committee.id === committeeId;
                    return (
                      <Button
                        key={committee.id ?? "all"}
                        id={`committee-filter-option-${index}`}
                        ref={(element) => {
                          committeeOptionRefs.current[index] = element;
                        }}
                        type="button"
                        role="option"
                        variant="ghost"
                        className={cn(
                          "h-11 w-full justify-between px-3 text-left",
                          selected && "bg-primary/10 text-primary",
                        )}
                        aria-selected={selected}
                        onClick={() => selectCommittee(committee.id)}
                        onFocus={() => setCommitteeActiveIndex(index)}
                        onKeyDown={(event) =>
                          handleCommitteeOptionKeyDown(event, index)
                        }
                      >
                        <span className="min-w-0 truncate">{committee.name}</span>
                        {selected ? <Check aria-hidden /> : null}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            </div>
          ) : null}
        </div>

        <Button
          id="event-board-backlog-button"
          ref={backlogButtonRef}
          variant="outline"
          className="h-10 w-auto min-w-10 shrink-0 px-2.5 md:ml-auto"
          aria-label={`Open Backlog, ${formatTaskCount(backlogTasks.length)}`}
          onClick={() => setBacklogOpen(true)}
        >
          <Inbox aria-hidden />
          <span className="sr-only sm:not-sr-only">Backlog</span>
          <Badge variant="neutral" className="px-1.5">
            {backlogTasks.length}
          </Badge>
        </Button>
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
        <>
          {isUnfilteredBacklogOnlyPhase || isUnfilteredMixedPhase ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <span>
                {isUnfilteredBacklogOnlyPhase ? (
                  <>
                    {formatTaskCount(selectedPhaseTasks.length)} in this phase{" "}
                    {selectedPhaseTasks.length === 1 ? "is" : "are"} unassigned.
                  </>
                ) : (
                  <>
                    {unassignedSelectedPhaseTasks.length} of{" "}
                    {formatTaskCount(selectedPhaseTasks.length)} unassigned.
                  </>
                )}
              </span>
              <Button
                variant="link"
                className="h-11 px-0 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
                onClick={() => setBacklogOpen(true)}
              >
                Open Backlog
              </Button>
            </div>
          ) : null}

          <div className="grid gap-5 md:grid-cols-3">
            {BOARD_STATUSES.map((status) => {
              const laneTasks = assignedPhaseTasks.filter(
                (task) => task.status === status,
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
                        {selectedPriorities.size > 0
                          ? "No tasks match this filter."
                          : "No tasks yet"}
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      <Sheet open={backlogOpen} onOpenChange={setBacklogOpen}>
        <SheetContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-board-backlog-title"
          aria-describedby="event-board-backlog-description"
          finalFocus={backlogButtonRef}
          className="group flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t p-0 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:translate-y-full data-[ending-style]:opacity-0 data-[starting-style]:translate-y-full data-[starting-style]:opacity-0 data-[ending-style]:duration-200 data-[ending-style]:ease-in motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0 md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:max-h-none md:w-96 md:rounded-none md:border-t-0 md:border-l md:data-[ending-style]:translate-x-full md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-full md:data-[starting-style]:translate-y-0 motion-reduce:md:data-[ending-style]:translate-x-0 motion-reduce:md:data-[starting-style]:translate-x-0"
        >
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-popover px-5 py-4">
            <div className="min-w-0 flex-1">
              <SheetTitle
                id="event-board-backlog-title"
                className="not-sr-only font-display text-lg font-semibold"
              >
                Task Backlog
              </SheetTitle>
              <SheetDescription id="event-board-backlog-description" className="text-xs">
                Unassigned tasks · read only
              </SheetDescription>
            </div>
            <Badge variant="neutral" className="shrink-0 px-2">
              {formatTaskCount(backlogTasks.length)}
            </Badge>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-8"
                  aria-label="Close backlog"
                />
              }
            >
              <X aria-hidden />
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {backlogTasks.map((task, index) => (
              <div
                key={task.id}
                className={cn(
                  "transition-[opacity,transform] duration-200 ease-out group-data-[starting-style]:translate-y-2 group-data-[starting-style]:opacity-0 motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:delay-0 motion-reduce:group-data-[starting-style]:translate-y-0",
                  index === 1 && "delay-[30ms]",
                  index === 2 && "delay-[60ms]",
                  index === 3 && "delay-[90ms]",
                  index === 4 && "delay-[120ms]",
                  index === 5 && "delay-[150ms]",
                )}
              >
                <TaskCard task={task} backlog />
              </div>
            ))}
            {backlogTasks.length === 0 ? (
              <p className="rounded-xl border-2 border-dashed p-5 text-center text-sm text-muted-foreground">
                {selectedPriorities.size > 0
                  ? "No unassigned tasks match this filter."
                  : "No unassigned tasks."}
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
