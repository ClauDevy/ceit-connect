"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, Trash2, X } from "lucide-react";
import { ListPager } from "@/components/shared/list-pager";
import { useListReveal, useReducedMotionPreference } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  activityBlockArrowTargets,
  activityPageBlock,
  activityPagerSlots,
} from "@/lib/activity-log";
import {
  EVENT_MANAGEMENT_PAGE_SIZE,
  eventDeletionYears,
  eventManagementMotionState,
  eventManagementPageSlice,
  eventPageSelectionState,
  eventSelectionCapHint,
  failedEventSelection,
  filterEventsByYear,
  reconcileEventSelection,
  resetEventManagementFilter,
  requiredDeletionConfirmation,
  shouldToggleEventRowSelection,
  snapshotEventDeletionSelection,
  toggleEventPageSelection,
  toggleEventSelection,
  type EventDeletionListItem,
  type EventDeletionResult,
  type EventDeletionSelection,
} from "@/lib/events/event-deletion";
import { cn } from "@/lib/utils";

type CleanupStatusResponse = { pendingCount: number };
type CleanupRetryResponse = CleanupStatusResponse & {
  attempted: number;
  done: number;
  failed: number;
  timedOut: boolean;
};

function formatStartDate(value: string | null) {
  if (!value) return "No start date";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "No start date";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: "Asia/Manila",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof value === "object" &&
      value !== null &&
      "error" in value &&
      typeof value.error === "string"
        ? value.error
        : "The request could not be completed. Try again.";
    throw new Error(message);
  }
  return value;
}

function EventStatusBadge({ status }: Pick<EventDeletionListItem, "status">) {
  return <Badge variant="neutral">{status}</Badge>;
}

function clickedSelectionControl(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("[data-event-selection-control]"))
  );
}

export function EventManagement({ events }: { events: EventDeletionListItem[] }) {
  const router = useRouter();
  const [year, setYear] = useState<"all" | number>("all");
  const [page, setPage] = useState(1);
  const [selectionState, setSelection] =
    useState<EventDeletionSelection>(new Map());
  const [selectionHint, setSelectionHint] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogEvents, setDialogEvents] = useState<EventDeletionListItem[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [results, setResults] = useState<EventDeletionResult[]>([]);
  const loadedCleanupStatus = useRef(false);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const reducedMotion = useReducedMotionPreference();

  const years = useMemo(() => eventDeletionYears(events), [events]);
  const yearLabels = useMemo(
    () => ({
      all: "All years",
      ...Object.fromEntries(
        years.map((item) => [String(item), String(item)]),
      ),
    }),
    [years],
  );
  const filteredEvents = useMemo(
    () => filterEventsByYear(events, year),
    [events, year],
  );
  const pageWindow = useMemo(
    () => eventManagementPageSlice(filteredEvents, page),
    [filteredEvents, page],
  );
  const pageEvents = pageWindow.items;
  const selection = useMemo(
    () => reconcileEventSelection(selectionState, events),
    [selectionState, events],
  );
  const selectedEvents = useMemo(
    () => Array.from(selection.values()),
    [selection],
  );
  const pageSelection = eventPageSelectionState(pageEvents, selection);
  const requiredConfirmation =
    dialogEvents.length > 0 ? requiredDeletionConfirmation(dialogEvents) : "";
  const pageNumbers = activityPageBlock(
    pageWindow.page,
    pageWindow.totalPages,
  );
  const pagerSlots = activityPagerSlots(pageNumbers);
  const arrowTargets = activityBlockArrowTargets(pageWindow.page);
  const showPager = filteredEvents.length > EVENT_MANAGEMENT_PAGE_SIZE;

  const desktopReveal = useListReveal({
    initialItems: events,
    items: pageEvents,
    settled: true,
    getId: (event) => `event-management-desktop-${event.id}`,
  });
  const mobileReveal = useListReveal({
    initialItems: events,
    items: pageEvents,
    settled: true,
    getId: (event) => `event-management-mobile-${event.id}`,
  });

  useEffect(() => {
    if (results.length > 0) resultsHeadingRef.current?.focus();
  }, [results]);

  useEffect(() => {
    if (loadedCleanupStatus.current) return;
    loadedCleanupStatus.current = true;
    void postJson("/api/event-storage-cleanup", { action: "status" })
      .then((value) => {
        const response = value as CleanupStatusResponse;
        if (typeof response.pendingCount === "number") {
          setPendingCount(response.pendingCount);
        }
      })
      .catch(() =>
        setCleanupMessage("Pending banner cleanup could not be loaded."),
      );
  }, []);

  function changeYear(value: string | null) {
    const nextYear = value === "all" || value === null ? "all" : Number(value);
    const reset = resetEventManagementFilter(nextYear);
    setYear(reset.year);
    setPage(reset.page);
    setSelection(reset.selection);
    setSelectionHint(null);
  }

  function togglePage() {
    const result = toggleEventPageSelection(pageEvents, selection);
    setSelection(result.selected);
    setSelectionHint(eventSelectionCapHint(result.added, result.limited));
  }

  function toggleOne(event: EventDeletionListItem) {
    const result = toggleEventSelection(selection, event);
    setSelection(result.selected);
    setSelectionHint(eventSelectionCapHint(0, result.limited));
  }

  function handleRowClick(
    clickEvent: React.MouseEvent<HTMLElement>,
    event: EventDeletionListItem,
  ) {
    const shouldToggle = shouldToggleEventRowSelection({
      clickedSelectionControl: clickedSelectionControl(clickEvent.target),
      hasSelectedText: Boolean(window.getSelection()?.toString().trim()),
    });
    if (shouldToggle) toggleOne(event);
  }

  function clearSelection() {
    setSelection(new Map());
    setSelectionHint(null);
  }

  async function retryCleanup() {
    if (cleanupBusy) return;
    setCleanupBusy(true);
    setCleanupMessage(null);
    try {
      const value = (await postJson("/api/event-storage-cleanup", {
        action: "retry",
      })) as CleanupRetryResponse;
      setPendingCount(value.pendingCount);
      setCleanupMessage(
        value.timedOut
          ? `Processed ${value.attempted} cleanup jobs before the time limit. Remaining jobs can be retried.`
          : `Cleanup pass finished: ${value.done} done, ${value.failed} failed.`,
      );
    } catch (error) {
      setCleanupMessage(
        error instanceof Error
          ? error.message
          : "Banner cleanup could not be retried.",
      );
    } finally {
      setCleanupBusy(false);
    }
  }

  function openDeletionDialog() {
    if (selectedEvents.length === 0) return;
    setDialogEvents(snapshotEventDeletionSelection(selection));
    setConfirmation("");
    setDeleteError(null);
    setDialogOpen(true);
  }

  async function submitDeletion() {
    if (
      deleteBusy ||
      dialogEvents.length === 0 ||
      confirmation !== requiredConfirmation
    ) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const value = (await postJson("/api/event-deletion", {
        events: dialogEvents.map((event) => ({
          id: event.id,
          expectedUpdatedAt: event.updated_at,
        })),
        confirmation,
      })) as { results: EventDeletionResult[]; pendingCount: number | null };
      const deletedIds = new Set(
        value.results
          .filter((result) => result.deletion === "done")
          .map((result) => result.eventId),
      );
      setPage(
        eventManagementPageSlice(
          filteredEvents.filter((event) => !deletedIds.has(event.id)),
          page,
        ).page,
      );
      setResults(value.results);
      setSelection(
        failedEventSelection(
          new Map(dialogEvents.map((event) => [event.id, event])),
          value.results,
        ),
      );
      setSelectionHint(null);
      if (typeof value.pendingCount === "number") {
        setPendingCount(value.pendingCount);
      }
      setDialogOpen(false);
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "The deletion could not be completed.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  const pageCheckboxProps = {
    checked: pageSelection.checked,
    "aria-checked": pageSelection.indeterminate
      ? ("mixed" as const)
      : pageSelection.checked,
    onChange: togglePage,
    ref: (node: HTMLInputElement | null) => {
      if (node) node.indeterminate = pageSelection.indeterminate;
    },
  };

  return (
    <div
      className="space-y-5"
      data-motion-state={eventManagementMotionState(reducedMotion)}
      data-event-count={events.length}
    >
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-1.5 sm:max-w-56">
              <label
                htmlFor="event-management-year"
                className="text-sm font-medium"
              >
                Start year
              </label>
              <Select
                items={yearLabels}
                value={year === "all" ? "all" : String(year)}
                onValueChange={changeYear}
              >
                <SelectTrigger id="event-management-year">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All years</SelectItem>
                  {years.map((item) => (
                    <SelectItem key={item} value={String(item)}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {pendingCount !== null ? (
                <span className="text-sm text-muted-foreground">
                  {pendingCount === 0
                    ? "No pending banner cleanup"
                    : `${pendingCount} cleanup ${pendingCount === 1 ? "job" : "jobs"} pending`}
                </span>
              ) : null}
              {pendingCount !== null && pendingCount > 0 ? (
                <Button
                  variant="outline"
                  onClick={retryCleanup}
                  disabled={cleanupBusy}
                >
                  <RefreshCw
                    className={
                      cleanupBusy
                        ? "animate-spin motion-reduce:animate-none"
                        : ""
                    }
                    aria-hidden
                  />
                  {cleanupBusy ? "Retrying…" : "Retry cleanup"}
                </Button>
              ) : null}
            </div>
          </div>
          {cleanupMessage ? (
            <InlineAlert
              variant={
                cleanupMessage.includes("could not") ? "error" : "info"
              }
            >
              {cleanupMessage}
            </InlineAlert>
          ) : null}
        </CardContent>
      </Card>

      {results.length > 0 ? (
        <Card>
          <CardContent className="space-y-3">
            <h2
              ref={resultsHeadingRef}
              tabIndex={-1}
              className="rounded-sm font-display font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Deletion results
            </h2>
            <ul className="space-y-2">
              {results.map((result) => (
                <li
                  key={result.eventId}
                  className="flex items-start justify-between gap-3 rounded-xl bg-muted px-3 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {result.eventName ?? "Event no longer available"}
                    </p>
                    <p className="text-muted-foreground">{result.message}</p>
                  </div>
                  <Badge
                    variant={
                      result.deletion === "done" &&
                      result.cleanup === "done" &&
                      !result.cleanupWarning
                        ? "success"
                        : result.deletion === "failed"
                          ? "destructive"
                          : "neutral"
                    }
                  >
                    {result.deletion === "failed"
                      ? "Not deleted"
                      : result.cleanup === "done"
                        ? "Deleted"
                        : `Deleted · cleanup ${result.cleanup}`}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {events.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No Draft or Archived events are available to delete.
          </CardContent>
        </Card>
      ) : filteredEvents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No deletable events start in {year}.
          </CardContent>
        </Card>
      ) : (
        <div
          className={cn(
            "space-y-3",
            selection.size > 0 && "pb-24 md:pb-0",
          )}
        >
          <Card className="hidden md:block lg:[&_[data-slot=table-container]]:overflow-visible">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">
                    <input
                      id="event-page-selection-desktop"
                      type="checkbox"
                      data-event-selection-control
                      aria-label="Select this page"
                      className="size-4 rounded accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      {...pageCheckboxProps}
                    />
                  </TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                  <TableHead className="w-44">Start date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageEvents.map((event) => {
                  const selected = selection.has(event.id);
                  const checkboxId = `event-selection-desktop-${event.id}`;
                  return (
                    <TableRow
                      key={event.id}
                      aria-selected={selected}
                      onClick={(clickEvent) =>
                        handleRowClick(clickEvent, event)
                      }
                      className={cn(
                        "cursor-pointer active:bg-secondary/70 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40 has-[:focus-visible]:ring-inset",
                        selected && "bg-primary/10 hover:bg-primary/15",
                      )}
                      {...desktopReveal.getRevealProps(
                        `event-management-desktop-${event.id}`,
                      )}
                    >
                      <TableCell>
                        <input
                          id={checkboxId}
                          type="checkbox"
                          data-event-selection-control
                          checked={selected}
                          onChange={() => toggleOne(event)}
                          aria-label={`Select ${event.name}`}
                          className="size-4 rounded accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      </TableCell>
                      <TableCell className="min-w-0 font-medium">
                        <label
                          htmlFor={checkboxId}
                          data-event-selection-control
                          className="block min-w-0 cursor-pointer truncate"
                          title={event.name}
                        >
                          {event.name}
                        </label>
                      </TableCell>
                      <TableCell>
                        <EventStatusBadge status={event.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatStartDate(event.start_date)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <label
            htmlFor="event-page-selection-mobile"
            data-event-selection-control
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-muted active:bg-secondary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40 motion-reduce:transition-none md:hidden"
          >
            <input
              id="event-page-selection-mobile"
              type="checkbox"
              data-event-selection-control
              className="size-5 rounded accent-primary focus-visible:outline-none"
              {...pageCheckboxProps}
            />
            Select this page
          </label>

          <div className="space-y-2 md:hidden">
            {pageEvents.map((event) => {
              const selected = selection.has(event.id);
              const checkboxId = `event-selection-mobile-${event.id}`;
              return (
                <Card
                  key={event.id}
                  aria-selected={selected}
                  onClick={(clickEvent) => handleRowClick(clickEvent, event)}
                  className={cn(
                    "cursor-pointer transition-colors active:bg-secondary/70 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40 motion-reduce:transition-none",
                    selected
                      ? "border-primary/40 bg-primary/10"
                      : "hover:bg-primary/5",
                  )}
                  {...mobileReveal.getRevealProps(
                    `event-management-mobile-${event.id}`,
                  )}
                >
                  <CardContent className="flex items-start gap-3 p-3">
                    <div
                      data-event-selection-control
                      className="flex size-11 shrink-0 items-center justify-center"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleOne(event)}
                        aria-label={`Select ${event.name}`}
                        className="size-5 rounded accent-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <label
                          htmlFor={checkboxId}
                          data-event-selection-control
                          className="min-w-0 cursor-pointer truncate font-medium"
                          title={event.name}
                        >
                          {event.name}
                        </label>
                        <EventStatusBadge status={event.status} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatStartDate(event.start_date)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {selectionHint ? (
            <p role="status" className="text-sm text-muted-foreground">
              {selectionHint}
            </p>
          ) : selection.size === 10 ? (
            <p role="status" className="text-sm text-muted-foreground">
              Selection limit reached. Delete or clear events before selecting
              more.
            </p>
          ) : null}

          {showPager ? (
            <ListPager
              activePage={pageWindow.page}
              ariaLabel="Event management pages"
              nextDisabled={arrowTargets.next > pageWindow.totalPages}
              onNext={() => setPage(arrowTargets.next)}
              onPage={setPage}
              onPrevious={() =>
                arrowTargets.previous && setPage(arrowTargets.previous)
              }
              pageSize={EVENT_MANAGEMENT_PAGE_SIZE}
              previousDisabled={!arrowTargets.previous}
              slots={pagerSlots}
            />
          ) : null}

          {selection.size > 0 ? (
            <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/95 px-3 py-2 shadow-lg backdrop-blur md:static md:shadow-sm">
              <p className="text-sm font-semibold">{selection.size} selected</p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                >
                  <X aria-hidden /> Clear
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={openDeletionDialog}
                  disabled={deleteBusy}
                >
                  <Trash2 aria-hidden /> Delete selected
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!deleteBusy) setDialogOpen(open);
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <div className="grid gap-1.5">
            <AlertDialogTitle>
              Delete {dialogEvents.length}{" "}
              {dialogEvents.length === 1 ? "event" : "events"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected event records and their
              tasks. Activity history remains.
            </AlertDialogDescription>
          </div>
          <div className="max-h-36 overflow-y-auto rounded-xl bg-muted p-3">
            <ul className="space-y-1.5 text-sm">
              {dialogEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex min-w-0 items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate" title={event.name}>
                    {event.name}
                  </span>
                  <EventStatusBadge status={event.status} />
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-1.5">
            <label
              htmlFor="event-deletion-confirmation"
              className="text-sm font-medium"
            >
              Type <strong>{requiredConfirmation}</strong> to confirm
            </label>
            <Input
              id="event-deletion-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              disabled={deleteBusy}
            />
          </div>
          {deleteError ? <InlineAlert>{deleteError}</InlineAlert> : null}
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-destructive"
              aria-hidden
            />
            Storage cleanup runs only after each database deletion commits.
          </div>
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={deleteBusy}
              onClick={() => setDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy || confirmation !== requiredConfirmation}
              onClick={submitDeletion}
            >
              {deleteBusy ? "Deleting…" : "Delete permanently"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
