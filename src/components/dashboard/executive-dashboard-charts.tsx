"use client";

import { useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { ChartBarGrow, Collapse, useVisibilityAnimation } from "@/components/shared/motion";
import { UserAvatar } from "@/components/shared/user-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { PagedList } from "@/components/dashboard/paged-list";
import {
  DASHBOARD_STATUS_PRESENTATION,
  barDisplayPercent,
  committeeInitials,
  donutCompletedPercentage,
  donutTotal,
  donutValues,
  pairMembersWithSignals,
  shouldShowLevelOneSleepingTiger,
  shouldShowLevelTwoSleepingTiger,
  tasksWithoutMemberBarNote,
  type CommitteeMember,
  type CommitteeSummary,
  type CommitteeTotal,
  type DashboardOverview,
  type DashboardSection,
  type MemberSignal,
} from "@/lib/executive-dashboard";
import { cn } from "@/lib/utils";

function WorkloadBar({
  value,
  values,
  label,
  animate,
}: {
  value: number;
  values: readonly number[];
  label: string;
  animate: boolean;
}) {
  const width = barDisplayPercent(value, values);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${label}: ${value} open ${value === 1 ? "task" : "tasks"}`}
      >
        {animate ? (
          <ChartBarGrow
            axis="x"
            observeParent
            className="h-full rounded-full bg-primary"
            style={{ width: `${width}%` }}
          />
        ) : (
          <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
        )}
      </div>
      <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function CommitteeWorkload({
  totals,
  animate,
  onSelect,
}: {
  totals: DashboardSection<CommitteeTotal[]>;
  animate: boolean;
  onSelect: (committeeId: string) => void;
}) {
  if (totals.status !== "ready") {
    return <SectionUnavailable label="Committee workload" />;
  }
  if (totals.data.length === 0) {
    return <EmptyState compact title="No committees available" />;
  }
  const values = totals.data.map((row) => row.uniqueActiveTaskCount);
  return (
    <div className="space-y-3">
      {shouldShowLevelOneSleepingTiger(totals.data) ? (
        <EmptyState
          compact
          title="The council is resting"
          description="There are no active tasks across the committees right now."
        />
      ) : null}
      <PagedList
        label="committees"
        pageSize={6}
        className="space-y-2"
        items={totals.data}
        getKey={(row) => row.committeeId}
        renderItem={(row) => (
          <button
            type="button"
            className="motion-button-interaction grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/70 bg-background p-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => onSelect(row.committeeId)}
            aria-label={`Open ${row.committeeName} dashboard, ${row.uniqueActiveTaskCount} open tasks`}
          >
            <span
              role="img"
              aria-label={`${row.committeeName} committee`}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
            >
              {committeeInitials(row.committeeName)}
            </span>
            <span className="min-w-0 space-y-2">
              <span className="block min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                {row.committeeName}
              </span>
              <WorkloadBar
                value={row.uniqueActiveTaskCount}
                values={values}
                label={row.committeeName}
                animate={animate}
              />
            </span>
          </button>
        )}
      />
    </div>
  );
}

export function MemberWorkload({
  summary,
  members,
  signals,
  animate,
}: {
  summary: DashboardSection<CommitteeSummary | null>;
  members: DashboardSection<CommitteeMember[]>;
  signals: DashboardSection<MemberSignal[]>;
  animate: boolean;
}) {
  const summaryData = summary.status === "ready" ? summary.data : null;
  const memberRows = members.status === "ready" ? members.data : null;
  const signalRows = signals.status === "ready" ? signals.data : [];
  const noteCount = tasksWithoutMemberBarNote(summaryData);

  return (
    <div className="space-y-4">
      {summary.status === "error" ? <SectionUnavailable label="Committee summary" /> : null}
      {summaryData ? <CommitteeSummaryNumbers summary={summaryData} /> : null}
      {shouldShowLevelTwoSleepingTiger(summaryData) ? (
        <EmptyState
          compact
          title="This committee is resting"
          description="There are no active tasks for this committee right now."
        />
      ) : null}
      {noteCount > 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          {noteCount} {noteCount === 1 ? "task has" : "tasks have"} no member bar because no
          active member in this committee owns the work.
        </p>
      ) : null}
      {signals.status === "error" ? (
        <p className="text-xs text-muted-foreground">Workload signals are unavailable.</p>
      ) : null}
      {memberRows === null ? (
        <SectionUnavailable label="Member workload" />
      ) : memberRows.length === 0 ? (
        <p className="py-3 text-center text-sm text-muted-foreground">No active committee members.</p>
      ) : (
        <MemberRows
          rows={pairMembersWithSignals(memberRows, signalRows)}
          allCounts={memberRows.map((row) => row.activeTaskCount)}
          animate={animate}
        />
      )}
    </div>
  );
}

type PairedMember = ReturnType<typeof pairMembersWithSignals>[number];

// Members with no open tasks only get their own collapsed group once there are enough of
// them to push the busy people out of view.
const IDLE_GROUP_THRESHOLD = 3;

function MemberRows({
  rows,
  allCounts,
  animate,
}: {
  rows: PairedMember[];
  allCounts: number[];
  animate: boolean;
}) {
  const [idleOpen, setIdleOpen] = useState(false);
  const idle = rows.filter(({ member }) => member.activeTaskCount === 0);
  const groupIdle = idle.length > IDLE_GROUP_THRESHOLD;
  const busy = groupIdle ? rows.filter(({ member }) => member.activeTaskCount > 0) : rows;

  return (
    <div className="space-y-3">
      {busy.length > 0 ? (
        <PagedList
          label="members"
          pageSize={8}
          className="space-y-2"
          items={busy}
          getKey={({ member }) => member.memberId}
          renderItem={({ member, signal }) => (
            <div className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/70 bg-background p-3">
              <UserAvatar name={member.fullName} src={member.avatarUrl} />
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold [overflow-wrap:anywhere]">
                    {member.fullName}
                  </p>
                  {signal ? (
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      <SignalChip label={`${signal.openTaskCount} open`} />
                      {signal.overdueTaskCount > 0 ? (
                        <SignalChip tone="danger" label={`${signal.overdueTaskCount} overdue`} />
                      ) : null}
                      {signal.atRiskTaskCount > 0 ? (
                        <SignalChip tone="warning" label={`${signal.atRiskTaskCount} at risk`} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <WorkloadBar
                  value={member.activeTaskCount}
                  values={allCounts}
                  label={member.fullName}
                  animate={animate}
                />
              </div>
            </div>
          )}
        />
      ) : null}
      {groupIdle ? (
        <div className="rounded-xl border border-dashed border-border/70">
          <button
            type="button"
            aria-expanded={idleOpen}
            onClick={() => setIdleOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-sm font-medium outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span>
              {idle.length} members have no open tasks
            </span>
            <ChevronDown
              aria-hidden
              className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", idleOpen && "rotate-180")}
            />
          </button>
          <Collapse open={idleOpen}>
            <div className="border-t border-border/70 p-2">
              <PagedList
                as="ul"
                label="members"
                pageSize={6}
                className="divide-y divide-border/60"
                items={idle}
                getKey={({ member }) => member.memberId}
                renderItem={({ member }) => (
                  <div className="flex min-h-11 items-center gap-3 px-1 py-2">
                    <UserAvatar name={member.fullName} src={member.avatarUrl} size="sm" />
                    <p className="min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]">
                      {member.fullName}
                    </p>
                  </div>
                )}
              />
            </div>
          </Collapse>
        </div>
      ) : null}
    </div>
  );
}

function CommitteeSummaryNumbers({ summary }: { summary: CommitteeSummary }) {
  const items = [
    ["Active", summary.uniqueActiveTaskCount],
    ["Covered", summary.coveredTaskCount],
    ["Unassigned", summary.unassignedTaskCount],
    ["Inactive owners", summary.inactiveOnlyTaskCount],
    ["Outside committee", summary.activeOutsideCommitteeOnlyTaskCount],
    ["Without a bar", summary.tasksWithoutMemberBarCount],
  ] as const;
  return (
    <dl className="motion-stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-muted/70 px-3 py-2">
          <dt className="text-[11px] text-muted-foreground">{label}</dt>
          <dd className="font-display text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SignalChip({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "danger" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-medium",
        tone === "danger"
          ? "bg-destructive/10 text-destructive"
          : tone === "warning"
            ? "bg-chart-1/15 text-chart-1"
            : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function DonutArc({
  cumulative,
  strokeClass,
  animate,
}: {
  cumulative: number;
  strokeClass: string;
  animate: boolean;
}) {
  const revealRef = useVisibilityAnimation<SVGCircleElement>({ className: "motion-progress-ring" });
  return (
    <circle
      ref={animate ? revealRef : undefined}
      cx="60"
      cy="60"
      r="48"
      pathLength="100"
      fill="none"
      strokeWidth="16"
      strokeDasharray="100"
      strokeDashoffset={100 - cumulative}
      className={cn("motion-progress-ring-target", strokeClass)}
      style={{ "--motion-ring-empty-offset": 100 } as CSSProperties}
    />
  );
}

export function TaskStatusDonut({ overview, animate }: { overview: DashboardOverview; animate: boolean }) {
  const values = donutValues(overview);
  const total = donutTotal(overview);
  const completedPercentage = donutCompletedPercentage(overview);
  const arcs = values.map((item, index) => ({
    ...item,
    cumulative:
      total === 0
        ? 0
        : (values.slice(0, index + 1).reduce((sum, value) => sum + value.value, 0) /
            total) *
          100,
  }));
  const summary = values
    .map((item) => `${DASHBOARD_STATUS_PRESENTATION[item.key].label}: ${item.value}`)
    .join(", ");
  const completionSummary = completedPercentage === null
    ? "No tasks"
    : `${completedPercentage}% done`;

  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6 lg:grid-cols-1 lg:justify-items-center">
      <div
        className="relative mx-auto size-[7.5rem] sm:size-36"
        role="img"
        aria-label={`Task status. ${completionSummary}. ${summary}`}
      >
        <svg className="size-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="48" fill="none" className="stroke-muted" strokeWidth="16" />
          {arcs
            .slice()
            .reverse()
            .map((arc) => (
              <DonutArc
                key={arc.key}
                cumulative={arc.cumulative}
                strokeClass={DASHBOARD_STATUS_PRESENTATION[arc.key].strokeClass}
                animate={animate}
              />
            ))}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          {completedPercentage === null ? (
            <span className="text-sm font-semibold">No tasks</span>
          ) : (
            <>
              <span className="font-display text-xl font-semibold tabular-nums">{completedPercentage}%</span>
              <span className="text-[11px] text-muted-foreground">done</span>
            </>
          )}
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm" aria-label="Task status counts">
        {values.map((item) => {
          const presentation = DASHBOARD_STATUS_PRESENTATION[item.key];
          return (
            <li key={item.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", presentation.dotClass)} aria-hidden />
                {presentation.label}
              </span>
              <strong className={cn("tabular-nums", presentation.textClass)}>{item.value}</strong>
            </li>
          );
        })}
      </ul>
      <p className="sr-only">{summary}</p>
    </div>
  );
}

function SectionUnavailable({ label }: { label: string }) {
  return <p className="py-5 text-center text-sm text-muted-foreground">{label} is unavailable.</p>;
}
