export const DASHBOARD_ACCESS_DENIED = "Executive Dashboard access denied.";
export const DASHBOARD_CACHE_MAX_AGE_MS = 60_000;
export const DASHBOARD_SERVER_FRESH_CACHE_SENTINEL = -1;

export type DashboardRole = "Admin" | "Co-Admin";
export type DashboardScope =
  | { kind: "council" }
  | { kind: "committee"; committeeId: string };

export type DashboardSection<T> =
  | { status: "ready"; data: T }
  | { status: "error" }
  | { status: "access-denied" };

export type CommitteeTotal = {
  committeeId: string;
  committeeName: string;
  uniqueActiveTaskCount: number;
  coveredTaskCount: number;
  unassignedTaskCount: number;
  inactiveOnlyTaskCount: number;
  activeOutsideCommitteeOnlyTaskCount: number;
  tasksWithoutMemberBarCount: number;
};

export type CommitteeSummary = CommitteeTotal;

export type CommitteeMember = {
  committeeId: string;
  memberId: string;
  fullName: string;
  avatarUrl: string | null;
  activeTaskCount: number;
};

export type MemberSignal = {
  committeeId: string;
  memberId: string;
  openTaskCount: number;
  overdueTaskCount: number;
  atRiskTaskCount: number;
};

export type DashboardOverview = {
  openTaskCount: number;
  overdueTaskCount: number;
  dueIn24HoursTaskCount: number;
  unassignedTaskCount: number;
  helpWantedTaskCount: number;
  needsApprovalCount: number;
  donutOverdueCount: number;
  donutDueIn24HoursCount: number;
  donutInProgressCount: number;
  donutToDoCount: number;
  donutCompletedCount: number;
};

export type AttentionRow = {
  category: string;
  taskId: string | null;
  label: string;
  committeeId: string;
  committeeName: string;
  dueDate: string | null;
  sourceCreatedAt: string;
};

export type DeadlineDay = {
  calendarDate: string;
  openTaskCount: number;
};

export type FreeMember = {
  memberId: string;
  fullName: string;
  avatarUrl: string | null;
  role: "Admin" | "Co-Admin" | "Member";
  openTaskCount: number;
};

export type PushAdoption = {
  activeProfilesWithPushCount: number;
  activeProfileCount: number;
};

export type DashboardScopeData = {
  overview: DashboardSection<DashboardOverview>;
  attention: DashboardSection<AttentionRow[]>;
  deadlines: DashboardSection<DeadlineDay[]>;
  freeMembers: DashboardSection<FreeMember[]>;
  summary: DashboardSection<CommitteeSummary | null>;
  members: DashboardSection<CommitteeMember[]>;
  signals: DashboardSection<MemberSignal[]>;
};

export type DashboardStatusKey =
  | "overdue"
  | "dueIn24Hours"
  | "inProgress"
  | "toDo"
  | "completed";

export const DASHBOARD_STATUS_PRESENTATION = {
  overdue: {
    label: "Overdue",
    token: "destructive",
    textClass: "text-destructive",
    dotClass: "bg-destructive",
    strokeClass: "stroke-destructive",
  },
  dueIn24Hours: {
    label: "Due in 24 hours",
    token: "chart-1",
    textClass: "text-chart-1",
    dotClass: "bg-chart-1",
    strokeClass: "stroke-chart-1",
  },
  inProgress: {
    label: "In progress",
    token: "primary",
    textClass: "text-primary",
    dotClass: "bg-primary",
    strokeClass: "stroke-primary",
  },
  toDo: {
    label: "To do",
    token: "chart-3",
    textClass: "text-chart-3",
    dotClass: "bg-chart-3",
    strokeClass: "stroke-chart-3",
  },
  completed: {
    label: "Completed",
    token: "chart-4",
    textClass: "text-chart-4",
    dotClass: "bg-chart-4",
    strokeClass: "stroke-chart-4",
  },
} as const satisfies Record<
  DashboardStatusKey,
  {
    label: string;
    token: string;
    textClass: string;
    dotClass: string;
    strokeClass: string;
  }
>;

export function dashboardScopeKey(scope: DashboardScope) {
  return scope.kind === "council" ? "council" : `committee:${scope.committeeId}`;
}

export function dashboardRpcArgs(scope: DashboardScope) {
  return scope.kind === "council" ? undefined : { p_committee_id: scope.committeeId };
}

export function committeeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
}

export function barDisplayPercent(value: number, panelValues: readonly number[]) {
  const denominator = Math.max(1, ...panelValues);
  return value === 0 ? 0 : (value / denominator) * 100;
}

export function shouldShowLevelOneSleepingTiger(totals: readonly CommitteeTotal[]) {
  return totals.length > 0 && totals.every((row) => row.uniqueActiveTaskCount === 0);
}

export function shouldShowLevelTwoSleepingTiger(summary: CommitteeSummary | null) {
  return summary?.uniqueActiveTaskCount === 0;
}

export function tasksWithoutMemberBarNote(summary: CommitteeSummary | null) {
  return summary?.tasksWithoutMemberBarCount ?? 0;
}

export function pairMembersWithSignals(
  members: readonly CommitteeMember[],
  signals: readonly MemberSignal[],
) {
  const byMemberId = new Map(signals.map((signal) => [signal.memberId, signal]));
  return members.map((member) => ({ member, signal: byMemberId.get(member.memberId) ?? null }));
}

export function donutValues(overview: DashboardOverview) {
  return [
    { key: "overdue" as const, value: overview.donutOverdueCount },
    { key: "dueIn24Hours" as const, value: overview.donutDueIn24HoursCount },
    { key: "inProgress" as const, value: overview.donutInProgressCount },
    { key: "toDo" as const, value: overview.donutToDoCount },
    { key: "completed" as const, value: overview.donutCompletedCount },
  ];
}

export function donutTotal(overview: DashboardOverview) {
  return donutValues(overview).reduce((total, item) => total + item.value, 0);
}

export function donutCompletedPercentage(overview: DashboardOverview) {
  const total = donutTotal(overview);
  return total === 0 ? null : Math.round((overview.donutCompletedCount / total) * 100);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatCalendarDate(calendarDate: string) {
  const match = CALENDAR_DATE.exec(calendarDate);
  if (!match) return calendarDate;
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex >= MONTH_NAMES.length || day < 1 || day > 31) {
    return calendarDate;
  }
  return `${MONTH_NAMES[monthIndex]} ${day}`;
}

export function safeTaskHref(taskId: string | null) {
  return taskId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)
    ? `/tasks/${taskId}`
    : null;
}

export function dashboardHasAccessDenied(data: DashboardScopeData) {
  return Object.values(data).some((section) => section.status === "access-denied");
}
