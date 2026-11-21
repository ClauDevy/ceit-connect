"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronDown,
  Cog,
  LockKeyhole,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useListReveal,
  useReducedMotionPreference,
} from "@/components/shared/motion";
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ACTION_PRESENTATION,
  activityActorInitials,
  activityEventLabel,
  activityMotionState,
  activityOpenTaskHref,
  type ActivityRow,
} from "@/lib/activity-log";
import { groupActivityByDay, manilaDayKey } from "@/components/activity-log/activity-log-days";
import { cn } from "@/lib/utils";

const manilaTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

const manilaClock = new Intl.DateTimeFormat("en-PH", {
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

const actionIcons = {
  plus: Plus,
  pencil: Pencil,
  trash: Trash2,
};

// Semantic tokens only. The word (Created / Updated / Deleted) is always shown next to
// the colour, so colour is never the only signal.
const actionBadgeClasses = {
  INSERT: "border border-current/30 shadow-xs",
  UPDATE: "border border-primary/30 bg-primary/15 text-primary shadow-xs",
  DELETE: "border border-destructive/30 bg-destructive/15 text-destructive shadow-xs",
};

const actionDotClasses = {
  INSERT: "bg-success text-white",
  UPDATE: "bg-primary text-primary-foreground",
  DELETE: "bg-destructive text-white",
};

function ActionBadge({ row, global }: { row: ActivityRow; global: boolean }) {
  if (!global) {
    return <Badge variant="neutral">{ACTIVITY_ACTION_LABELS[row.action]}</Badge>;
  }
  const presentation = ACTIVITY_ACTION_PRESENTATION[row.action];
  const Icon = actionIcons[presentation.icon];
  return (
    <Badge
      variant={presentation.variant}
      className={actionBadgeClasses[row.action]}
    >
      <Icon aria-hidden />
      {presentation.label}
    </Badge>
  );
}

function RowDetails({ row, global }: { row: ActivityRow; global: boolean }) {
  if (row.isMasked) {
    return global ? (
      <Badge variant="neutral">
        <LockKeyhole aria-hidden />
        Confidential Task
      </Badge>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <LockKeyhole className="size-3.5" aria-hidden />
        Confidential Task
      </span>
    );
  }
  return (
    <div>
      <p className="font-medium">{row.taskTitle}</p>
      <p className="text-xs text-muted-foreground">
        {[activityEventLabel(row.eventName), row.committeeName].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

function ChangeSummary({ row }: { row: ActivityRow }) {
  const taskHref = activityOpenTaskHref(row);
  return (
    <div className="grid gap-3">
      <div>
        <p className="mb-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
          What changed
        </p>
        <ul className="grid gap-1.5 text-sm text-foreground">
          {row.changeSummary?.map((change, index) => (
            <li key={`${row.activityId}-${index}`} className="flex gap-2.5">
              <span
                className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden
              />
              <span className="min-w-0 break-words">{change}</span>
            </li>
          ))}
        </ul>
      </div>
      {taskHref ? (
        <Link
          href={taskHref}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-fit")}
        >
          Open task <ArrowUpRight aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Round avatar with initials (or a cog for automatic System changes) and a small
 * Created / Updated / Deleted marker. Confidential rows show a lock instead of a person.
 */
function ActivityAvatar({ row }: { row: ActivityRow }) {
  const MarkerIcon = actionIcons[ACTIVITY_ACTION_PRESENTATION[row.action].icon];
  const initials = activityActorInitials(row.actorName);
  const isSystem = row.actorName === "System";
  return (
    <span className="relative inline-flex size-10 shrink-0 sm:size-11" aria-hidden>
      <span className="flex size-full items-center justify-center rounded-full border bg-secondary text-sm font-semibold text-secondary-foreground">
        {row.isMasked ? (
          <LockKeyhole className="size-4" />
        ) : isSystem ? (
          <Cog className="size-4" />
        ) : (
          (initials ?? "?")
        )}
      </span>
      <span
        className={cn(
          "absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full ring-2 ring-card [&_svg]:size-2.5",
          actionDotClasses[row.action],
        )}
      >
        <MarkerIcon />
      </span>
    </span>
  );
}

function GlobalRowMain({ row, expanded }: { row: ActivityRow; expanded: boolean }) {
  if (row.isMasked) {
    return (
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionBadge row={row} global />
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 font-display font-semibold">
          <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Confidential Task
        </p>
        <p className="text-xs text-muted-foreground">Details are hidden for your role.</p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <ActionBadge row={row} global />
        {row.committeeName ? (
          <Badge variant="neutral" className="max-w-full truncate py-0.5 text-[11px] font-medium">
            {row.committeeName}
          </Badge>
        ) : null}
      </div>
      <p
        className={cn(
          "mt-1.5 font-display text-[15px] leading-snug font-semibold break-words text-foreground",
          !expanded && "line-clamp-2",
        )}
      >
        {row.taskTitle}
      </p>
      <p className={cn("mt-0.5 text-xs break-words text-muted-foreground", !expanded && "line-clamp-2")}>
        {activityEventLabel(row.eventName)}
        {row.actorName ? <> · by {row.actorName}</> : null}
      </p>
    </div>
  );
}

function GlobalRowPreview({ row }: { row: ActivityRow }) {
  if (row.isMasked) return null;
  const first = row.changeSummary?.[0];
  if (!first) return <span className="text-sm text-muted-foreground">No details</span>;
  const additional = Math.max((row.changeSummary?.length ?? 0) - 1, 0);
  return (
    <p className="flex min-w-0 items-baseline gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm text-foreground">
      <span className="min-w-0 flex-1 truncate">{first}</span>
      {additional > 0 ? (
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          +{additional} more
        </span>
      ) : null}
    </p>
  );
}

function GlobalActivityRow({
  row,
  expandable,
  expanded,
  onToggle,
  revealProps,
}: {
  row: ActivityRow;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  revealProps: {
    "data-motion-reveal-id": string;
    ref: (node: HTMLElement | null) => void;
  };
}) {
  const detailsId = `activity-details-${row.activityId}`;
  const content = (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2.5 p-3.5 sm:p-4 md:grid-cols-[auto_minmax(0,1.25fr)_minmax(0,1fr)_auto] md:items-center md:gap-x-4">
      <ActivityAvatar row={row} />
      <GlobalRowMain row={row} expanded={expanded} />
      <div className="col-start-3 row-start-1 flex flex-col items-end gap-1.5 text-right md:col-start-4 md:flex-row md:items-center md:gap-3">
        <time
          dateTime={row.activityCreatedAt}
          className="text-xs font-medium whitespace-nowrap text-muted-foreground"
        >
          {manilaClock.format(new Date(row.activityCreatedAt))}
        </time>
        {expandable ? (
          <span
            className="flex size-7 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            aria-hidden
          >
            <ChevronDown
              className={cn(
                "size-4 transition-transform motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </span>
        ) : null}
      </div>
      {!row.isMasked ? (
        <div className="col-span-2 col-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
          <GlobalRowPreview row={row} />
        </div>
      ) : null}
    </div>
  );
  return (
    <article
      {...revealProps}
      className={cn(
        "overflow-hidden rounded-2xl border bg-card text-card-foreground transition-colors motion-reduce:transition-none",
        expanded && "border-primary/40",
      )}
    >
      {expandable ? (
        <button
          type="button"
          className="block min-h-11 w-full text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted motion-reduce:transition-none"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={onToggle}
        >
          {content}
        </button>
      ) : (
        content
      )}
      {expandable ? (
        // Same grid-row disclosure the shared motion kit's Collapse uses (.motion-collapse),
        // with the reduced-motion fallback already in globals.css.
        <div
          className="motion-collapse"
          data-open={expanded ? "true" : "false"}
          aria-hidden={!expanded}
          inert={!expanded ? true : undefined}
        >
          <div className="min-h-0 overflow-hidden">
            <div id={detailsId} className="border-t bg-muted/40 px-4 py-3.5 sm:px-5">
              <ChangeSummary row={row} />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function HistoryActivityLogList({
  rows,
  settled,
}: {
  rows: ActivityRow[];
  settled: boolean;
}) {
  const reduced = useReducedMotionPreference();
  const { getRevealProps } = useListReveal({
    items: rows,
    settled,
    getId: (row) => row.activityId,
  });
  return (
    <div data-motion-state={activityMotionState(reduced)}>
      <div className="hidden overflow-hidden rounded-2xl border bg-card text-card-foreground md:block">
        <Table>
          <TableHeader className="bg-secondary">
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Activity</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.activityId} {...getRevealProps(row.activityId)}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {manilaTime.format(new Date(row.activityCreatedAt))}
                </TableCell>
                <TableCell><ActionBadge row={row} global={false} /></TableCell>
                <TableCell><RowDetails row={row} global={false} /></TableCell>
                <TableCell className="text-sm">
                  {row.isMasked ? "—" : row.actorName ?? "Unavailable actor"}
                </TableCell>
                <TableCell className="max-w-64 text-xs text-muted-foreground">
                  {row.isMasked ? "—" : row.changeSummary?.join(" · ") ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <article
            key={row.activityId}
            {...getRevealProps(row.activityId)}
            className="rounded-2xl border bg-card px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <ActionBadge row={row} global={false} />
              <time className="text-xs text-muted-foreground">
                {manilaTime.format(new Date(row.activityCreatedAt))}
              </time>
            </div>
            <div className="mt-2"><RowDetails row={row} global={false} /></div>
            {!row.isMasked && row.actorName ? (
              <p className="mt-2 text-xs text-muted-foreground">{row.actorName}</p>
            ) : null}
            {!row.isMasked && row.changeSummary?.length ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {row.changeSummary.join(" · ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

// Returns a Date that only changes when the Manila calendar day changes: it re-checks at the
// next Manila midnight and when the tab becomes visible again, so "Today" never goes stale.
function useManilaToday() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function sync() {
      const current = new Date();
      setNow((previous) =>
        manilaDayKey(previous) === manilaDayKey(current) ? previous : current,
      );
      if (timer) clearTimeout(timer);
      const msIntoDay = (current.getTime() + 8 * 3_600_000) % 86_400_000;
      timer = setTimeout(sync, 86_400_000 - msIntoDay + 1000);
    }
    function onVisible() {
      if (document.visibilityState === "visible") sync();
    }
    sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return now;
}

function GlobalActivityLogList({
  rows,
  settled,
  resetKey = "history",
}: {
  rows: ActivityRow[];
  settled: boolean;
  resetKey?: string;
}) {
  const reduced = useReducedMotionPreference();
  const { getRevealProps } = useListReveal({
    items: rows,
    settled,
    getId: (row) => row.activityId,
  });
  const [expanded, setExpanded] = useState<{
    resetKey: string;
    activityId: string | null;
  }>({ resetKey, activityId: null });
  const expandedId = expanded.resetKey === resetKey ? expanded.activityId : null;
  const motionState = activityMotionState(reduced);
  // Day headings only. Row order is exactly what the reader returned.
  const now = useManilaToday();
  const groups = groupActivityByDay(rows, now);

  function toggle(row: ActivityRow) {
    setExpanded({
      resetKey,
      activityId: expandedId === row.activityId ? null : row.activityId,
    });
  }

  return (
    <div data-motion-state={motionState} className="grid gap-5">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.heading.title} className="grid gap-2.5">
          <div className="flex items-baseline gap-2 px-1">
            <h3 className="font-display text-base font-semibold">{group.heading.title}</h3>
            {group.heading.subtitle ? (
              <span className="text-sm text-muted-foreground">{group.heading.subtitle}</span>
            ) : null}
            <span className="h-px flex-1 self-center bg-border" aria-hidden />
            <span className="text-xs font-medium text-muted-foreground">
              {group.rows.length} {group.rows.length === 1 ? "change" : "changes"}
            </span>
          </div>
          <div className="grid gap-2.5">
            {group.rows.map((row) => {
              const expandable = !row.isMasked && Boolean(row.changeSummary?.length);
              return (
                <GlobalActivityRow
                  key={row.activityId}
                  row={row}
                  expandable={expandable}
                  expanded={expandedId === row.activityId}
                  onToggle={() => toggle(row)}
                  revealProps={getRevealProps(row.activityId)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ActivityLogList({
  rows,
  settled,
  mode = "history",
  resetKey,
}: {
  rows: ActivityRow[];
  settled: boolean;
  mode?: "global" | "history";
  resetKey?: string;
}) {
  if (mode === "global") {
    return (
      <GlobalActivityLogList
        rows={rows}
        settled={settled}
        resetKey={resetKey}
      />
    );
  }
  return <HistoryActivityLogList rows={rows} settled={settled} />;
}
