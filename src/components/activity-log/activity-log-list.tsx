"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react";
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
  activityMotionState,
  activityOpenTaskHref,
  type ActivityRow,
} from "@/lib/activity-log";
import { cn } from "@/lib/utils";

const manilaTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

const manilaDate = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
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

const actionBadgeClasses = {
  INSERT: "border border-current/30 shadow-xs",
  UPDATE: "border border-primary/30 bg-primary/15 text-primary shadow-xs",
  DELETE: "border border-destructive/30 bg-destructive/15 text-destructive shadow-xs",
};

const actionAccentVariants = {
  INSERT: "success",
  UPDATE: "brand",
  DELETE: "destructive",
} as const;

const actionAccentClasses = {
  INSERT: "",
  UPDATE: "bg-primary",
  DELETE: "bg-destructive",
};

const globalActivityGrid =
  "grid-cols-[135px_110px_minmax(220px,1fr)_180px_minmax(200px,1fr)]";

function ActionAccent({ action }: Pick<ActivityRow, "action">) {
  return (
    <Badge
      variant={actionAccentVariants[action]}
      className={cn(
        "absolute inset-y-0 left-0 w-[3px] rounded-none border-0 p-0",
        actionAccentClasses[action],
      )}
      aria-hidden
    />
  );
}

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
        {[row.eventName, row.committeeName].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

function ChangeSummary({ row }: { row: ActivityRow }) {
  const taskHref = activityOpenTaskHref(row);
  return (
    <div className="space-y-3">
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {row.changeSummary?.map((change, index) => (
          <li key={`${row.activityId}-${index}`}>{change}</li>
        ))}
      </ul>
      {taskHref ? (
        <Link
          href={taskHref}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open task <ArrowUpRight aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function GlobalDate({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <span className="block whitespace-nowrap">
      <span className="block font-medium text-foreground">
        {manilaDate.format(date)}
      </span>
      <span className="block text-xs text-muted-foreground">
        {manilaClock.format(date)}
      </span>
    </span>
  );
}

function GlobalTask({ row }: { row: ActivityRow }) {
  if (row.isMasked) return <RowDetails row={row} global />;
  return (
    <div className="min-w-0">
      <p className="truncate font-semibold text-foreground">{row.taskTitle}</p>
      <div className="mt-0.5 flex min-w-0 items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {row.eventName ?? "—"}
        </span>
        {row.committeeName ? (
          <Badge variant="neutral" className="max-w-40 truncate py-0 text-[11px] font-medium">
            {row.committeeName}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

function GlobalActor({ name }: { name: string | null }) {
  const initials = activityActorInitials(name);
  if (!name || !initials) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full border bg-secondary text-xs font-semibold text-secondary-foreground"
        aria-hidden
      >
        {initials}
      </span>
      <span className="truncate text-sm text-foreground">{name}</span>
    </span>
  );
}

function GlobalChangePreview({
  row,
  expandable,
  expanded,
}: {
  row: ActivityRow;
  expandable: boolean;
  expanded: boolean;
}) {
  if (row.isMasked) {
    return <span className="text-sm text-muted-foreground">Hidden</span>;
  }
  const first = row.changeSummary?.[0] ?? "No details";
  const additional = Math.max((row.changeSummary?.length ?? 0) - 1, 0);
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
      <span className="min-w-0 flex-1 truncate">{first}</span>
      {additional > 0 ? (
        <span className="shrink-0 text-xs text-muted-foreground">+{additional} more</span>
      ) : null}
      {expandable ? (
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      ) : null}
    </span>
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
      <div className="hidden overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm md:block">
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
            className="rounded-xl border bg-card px-4 py-3"
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
  const global = true;
  const motionState = activityMotionState(reduced);

  function toggle(row: ActivityRow) {
    setExpanded({
      resetKey,
      activityId: expandedId === row.activityId ? null : row.activityId,
    });
  }

  return (
    <div data-motion-state={motionState}>
      <div className="hidden overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm md:block">
        <Table>
          <TableHeader className="bg-secondary">
            <TableRow>
              <TableHead colSpan={5} className="p-0">
                <div className={cn("grid items-center gap-4 px-4 py-3", globalActivityGrid)}>
                  <span>Time</span>
                  <span>Action</span>
                  <span>Activity</span>
                  <span>Actor</span>
                  <span>Changes</span>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const expandable =
                global && !row.isMasked && Boolean(row.changeSummary?.length);
              const detailsId = `activity-details-${row.activityId}`;
              const isExpanded = expandedId === row.activityId;
              const content = (
                <div
                  className={cn(
                    "relative grid w-full items-center gap-4 px-4 py-2.5 text-left",
                    globalActivityGrid,
                  )}
                >
                  <ActionAccent action={row.action} />
                  <GlobalDate value={row.activityCreatedAt} />
                  <ActionBadge row={row} global={global} />
                  <GlobalTask row={row} />
                  <GlobalActor name={row.isMasked ? null : row.actorName} />
                  <GlobalChangePreview
                    row={row}
                    expandable={expandable}
                    expanded={isExpanded}
                  />
                </div>
              );
              return (
                <Fragment key={row.activityId}>
                  <TableRow {...getRevealProps(row.activityId)}>
                    <TableCell colSpan={5} className="p-0">
                      {expandable ? (
                        <button
                          type="button"
                          className="w-full outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-secondary motion-reduce:transition-none"
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          onClick={() => toggle(row)}
                        >
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </TableCell>
                  </TableRow>
                  {expandable && isExpanded ? (
                    <TableRow id={detailsId}>
                      <TableCell colSpan={5} className="bg-secondary/60 px-6 py-4">
                        <ChangeSummary row={row} />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((row) => {
          const expandable =
            global && !row.isMasked && Boolean(row.changeSummary?.length);
          const detailsId = `activity-card-details-${row.activityId}`;
          const isExpanded = expandedId === row.activityId;
          const content = (
            <>
              <div className="flex items-start justify-between gap-3">
                <ActionBadge row={row} global={global} />
                <GlobalDate value={row.activityCreatedAt} />
              </div>
              <div className="mt-3">
                <GlobalTask row={row} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <GlobalActor name={row.isMasked ? null : row.actorName} />
                <GlobalChangePreview
                  row={row}
                  expandable={expandable}
                  expanded={isExpanded}
                />
              </div>
            </>
          );
          return (
            <article
              key={row.activityId}
              {...getRevealProps(row.activityId)}
              className="relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
            >
              <ActionAccent action={row.action} />
              {expandable ? (
                <button
                  type="button"
                  className="min-h-11 w-full px-4 py-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-secondary motion-reduce:transition-none"
                  aria-expanded={isExpanded}
                  aria-controls={detailsId}
                  onClick={() => toggle(row)}
                >
                  {content}
                </button>
              ) : (
                <div className="px-4 py-3">{content}</div>
              )}
              {expandable && isExpanded ? (
                <div id={detailsId} className="border-t bg-secondary/60 px-4 py-3">
                  <ChangeSummary row={row} />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
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
