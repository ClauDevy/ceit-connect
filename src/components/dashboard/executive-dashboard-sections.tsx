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
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border bg-card p-4 shadow-xs">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", tone)}>{value}</dd>
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
        <ul className="divide-y divide-border/70">
          {section.data.map((row, index) => (
            <AttentionItem key={`${row.sourceCreatedAt}:${index}`} row={row} />
          ))}
        </ul>
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
  return <li>{href ? <Link href={href}>{content}</Link> : content}</li>;
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
    <DashboardCard title="Task status" description="The reader's status split, including completed tasks in Active events.">
      {section.status !== "ready" ? <SectionError label="Task status" /> : <TaskStatusDonut overview={section.data} animate={animate} />}
    </DashboardCard>
  );
}

export function FreeMembersCard({ section }: { section: DashboardSection<FreeMember[]> }) {
  return (
    <DashboardCard title="Free to take work" description="Active officers and members with two or fewer council-wide open tasks.">
      {section.status !== "ready" ? (
        <SectionError label="Free members" />
      ) : section.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members available to take work.</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {section.data.map((member) => (
            <li key={member.memberId} className="flex min-h-11 items-center gap-3 py-2.5">
              <UserAvatar name={member.fullName} src={member.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{member.fullName}</p>
                <p className="text-xs text-muted-foreground">{member.role}</p>
              </div>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">{member.openTaskCount} open</span>
            </li>
          ))}
        </ul>
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

export function DashboardCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
