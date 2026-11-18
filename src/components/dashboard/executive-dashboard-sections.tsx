"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { UserAvatar } from "@/components/shared/user-avatar";
import { ChartBarGrow } from "@/components/shared/motion";
import {
  DASHBOARD_STATUS_PRESENTATION,
  barDisplayPercent,
  formatCalendarDate,
  safeTaskHref,
  type AttentionRow,
  type DashboardOverview,
  type DashboardSection,
  type DeadlineDay,
  type FreeMember,
  type PushAdoption,
} from "@/lib/executive-dashboard";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { TaskStatusDonut } from "@/components/dashboard/executive-dashboard-charts";
import { PagedList } from "@/components/dashboard/paged-list";

function SectionError({ label }: { label: string }) {
  return <InlineAlert>{label} could not be loaded. Use Refresh to try again.</InlineAlert>;
}

export function OverviewKpis({ section }: { section: DashboardSection<DashboardOverview> }) {
  if (section.status !== "ready") return <SectionError label="Dashboard totals" />;
  const overview = section.data;
  const cards = [
    ["Open tasks", overview.openTaskCount, "text-foreground"],
    ["Overdue", overview.overdueTaskCount, DASHBOARD_STATUS_PRESENTATION.overdue.textClass],
    ["Due in 24 hours", overview.dueIn24HoursTaskCount, DASHBOARD_STATUS_PRESENTATION.dueIn24Hours.textClass],
    ["Unassigned", overview.unassignedTaskCount, DASHBOARD_STATUS_PRESENTATION.toDo.textClass],
    ["Help wanted", overview.helpWantedTaskCount, "text-primary"],
    ["Needs approval", overview.needsApprovalCount, "text-chart-5"],
  ] as const;
  return (
    <section aria-labelledby="dashboard-kpis-title">
      <h2 id="dashboard-kpis-title" className="sr-only">Dashboard totals</h2>
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
        {cards.map(([label, value, tone]) => (
          <div
            key={label}
            className={cn(
              "rounded-xl border bg-card px-3.5 py-3 shadow-xs sm:px-4 sm:py-3.5",
              label === "Overdue" && value > 0 && "border-destructive/40 bg-destructive/5",
            )}
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn("mt-0.5 font-display text-2xl font-semibold tabular-nums", tone)}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DeadlinesCard({ section, animate }: { section: DashboardSection<DeadlineDay[]>; animate: boolean }) {
  return (
    <DashboardCard title="Deadlines this week" description="Open tasks due across seven Manila calendar days.">
      {section.status !== "ready" ? (
        <SectionError label="Deadlines" />
      ) : (
        <DeadlineRows rows={section.data} animate={animate} />
      )}
    </DashboardCard>
  );
}

function DeadlineRows({ rows, animate }: { rows: DeadlineDay[]; animate: boolean }) {
  const values = rows.map((row) => row.openTaskCount);
  const allZero = rows.every((row) => row.openTaskCount === 0);
  return (
    <div className="space-y-3">
      {allZero ? <p className="text-sm text-muted-foreground">No deadlines this week</p> : null}
      <div className="grid grid-cols-7 gap-1.5" role="img" aria-label={rows.map((row) => `${row.calendarDate}: ${row.openTaskCount}`).join(", ")}>
        {rows.map((row) => {
          const height = barDisplayPercent(row.openTaskCount, values);
          return (
            <div key={row.calendarDate} className="flex min-w-0 flex-col items-center gap-1.5">
              <span className="text-xs font-semibold tabular-nums">{row.openTaskCount}</span>
              <div className="flex h-20 w-full items-end overflow-hidden rounded-md bg-muted">
                {animate ? (
                  <ChartBarGrow
                    observeParent
                    className="w-full rounded-md bg-primary"
                    style={{ height: `${height}%` }}
                  />
                ) : (
                  <div className="w-full rounded-md bg-primary" style={{ height: `${height}%` }} />
                )}
              </div>
              <span className="text-center text-[10px] leading-tight text-muted-foreground">
                {formatCalendarDate(row.calendarDate)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AttentionCard({ section }: { section: DashboardSection<AttentionRow[]> }) {
  return (
    <DashboardCard title="Needs attention" description="The most urgent work returned by the dashboard reader.">
      {section.status !== "ready" ? (
        <SectionError label="Needs attention" />
      ) : section.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
      ) : (
        <PagedList
          as="ul"
          label="items"
          pageSize={5}
          className="divide-y divide-border/70"
          items={section.data.map((row, index) => ({ row, key: `${row.sourceCreatedAt}:${index}` }))}
          getKey={(entry) => entry.key}
          renderItem={(entry) => <AttentionItem row={entry.row} />}
        />
      )}
    </DashboardCard>
  );
}

export function attentionCategoryLabel(category: string) {
  switch (category) {
    case "overdue": return "Overdue";
    case "due_in_24_hours": return "Due in 24 hours";
    case "needs_approval": return "Needs approval";
    case "help_wanted": return "Help wanted";
    case "needs_new_owner": return "Needs a new owner";
    case "unassigned": return "Unassigned";
    default: return "Needs attention";
  }
}

function AttentionItem({ row }: { row: AttentionRow }) {
  const href = safeTaskHref(row.taskId);
  const content = (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{row.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {attentionCategoryLabel(row.category)} · {row.committeeName}
          {row.dueDate ? ` · ${formatAttentionDeadline(row.dueDate)}` : " · No deadline"}
        </p>
      </div>
      {href ? <span aria-hidden className="text-muted-foreground">›</span> : null}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function formatAttentionDeadline(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Deadline unavailable";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: APP_TIME_ZONE.iana,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function StatusCard({ section, animate }: { section: DashboardSection<DashboardOverview>; animate: boolean }) {
  return (
    <DashboardCard title="Task status" description="Where every task stands right now.">
      {section.status !== "ready" ? <SectionError label="Task status" /> : <TaskStatusDonut overview={section.data} animate={animate} />}
    </DashboardCard>
  );
}

export function FreeMembersCard({ section }: { section: DashboardSection<FreeMember[]> }) {
  const count = section.status === "ready" ? section.data.length : 0;
  return (
    <DashboardCard
      title="Free to take work"
      description="Active officers and members with two or fewer council-wide open tasks."
      aside={
        count > 0 ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success tabular-nums">
            {count} available
          </span>
        ) : null
      }
    >
      {section.status !== "ready" ? (
        <SectionError label="Free members" />
      ) : section.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members available to take work.</p>
      ) : (
        <PagedList
          as="ul"
          label="members"
          pageSize={5}
          className="divide-y divide-border/70"
          items={section.data}
          getKey={(member) => member.memberId}
          renderItem={(member) => (
            <div className="flex min-h-11 items-center gap-3 py-2.5">
              <UserAvatar name={member.fullName} src={member.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{member.fullName}</p>
                <p className="text-xs text-muted-foreground">{member.role}</p>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
                  member.openTaskCount === 0
                    ? "bg-success/10 text-success"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {member.openTaskCount} open
              </span>
            </div>
          )}
        />
      )}
    </DashboardCard>
  );
}

export function PushAdoptionCard({ section }: { section: DashboardSection<PushAdoption> }) {
  return (
    <DashboardCard title="Push adoption" description="Active profiles with at least one current push subscription.">
      {section.status !== "ready" ? (
        <SectionError label="Push adoption" />
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">With push</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{section.data.activeProfilesWithPushCount}</dd>
          </div>
          <div className="rounded-lg bg-muted p-3">
            <dt className="text-xs text-muted-foreground">Active profiles</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{section.data.activeProfileCount}</dd>
          </div>
        </dl>
      )}
    </DashboardCard>
  );
}

export function DashboardCard({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
