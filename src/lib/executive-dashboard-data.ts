import {
  DASHBOARD_ACCESS_DENIED,
  dashboardRpcArgs,
  type AttentionRow,
  type CommitteeMember,
  type CommitteeSummary,
  type CommitteeTotal,
  type DashboardOverview,
  type DashboardScope,
  type DashboardScopeData,
  type DashboardSection,
  type DeadlineDay,
  type FreeMember,
  type MemberSignal,
  type PushAdoption,
} from "@/lib/executive-dashboard";

export type DashboardRpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type DashboardRpc = (
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<DashboardRpcResult>;

type UnknownRow = Record<string, unknown>;

function isRow(value: unknown): value is UnknownRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(row: UnknownRow, key: string) {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error("invalid");
  return value;
}

function nullableText(row: UnknownRow, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("invalid");
  return value;
}

function count(row: UnknownRow, key: string) {
  const value = row[key];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error("invalid");
  return numeric;
}

function firstRow(value: unknown) {
  if (!Array.isArray(value) || value.length !== 1 || !isRow(value[0])) throw new Error("invalid");
  return value[0];
}

function rows(value: unknown) {
  if (!Array.isArray(value) || !value.every(isRow)) throw new Error("invalid");
  return value;
}

function parseCommitteeTotal(row: UnknownRow): CommitteeTotal {
  return {
    committeeId: text(row, "out_committee_id"),
    committeeName: text(row, "out_committee_name"),
    uniqueActiveTaskCount: count(row, "out_unique_active_task_count"),
    coveredTaskCount: count(row, "out_covered_task_count"),
    unassignedTaskCount: count(row, "out_unassigned_task_count"),
    inactiveOnlyTaskCount: count(row, "out_inactive_only_task_count"),
    activeOutsideCommitteeOnlyTaskCount: count(row, "out_active_outside_committee_only_task_count"),
    tasksWithoutMemberBarCount: count(row, "out_tasks_without_member_bar_count"),
  };
}

function parseOverview(value: unknown): DashboardOverview {
  const row = firstRow(value);
  return {
    openTaskCount: count(row, "out_open_task_count"),
    overdueTaskCount: count(row, "out_overdue_task_count"),
    dueIn24HoursTaskCount: count(row, "out_due_in_24_hours_task_count"),
    unassignedTaskCount: count(row, "out_unassigned_task_count"),
    helpWantedTaskCount: count(row, "out_help_wanted_task_count"),
    needsApprovalCount: count(row, "out_needs_approval_count"),
    donutOverdueCount: count(row, "out_donut_overdue_count"),
    donutDueIn24HoursCount: count(row, "out_donut_due_in_24_hours_count"),
    donutInProgressCount: count(row, "out_donut_in_progress_count"),
    donutToDoCount: count(row, "out_donut_to_do_count"),
    donutCompletedCount: count(row, "out_donut_completed_count"),
  };
}

function parseAttention(value: unknown): AttentionRow[] {
  return rows(value).map((row) => ({
    category: text(row, "out_category"),
    taskId: nullableText(row, "out_task_id"),
    label: text(row, "out_label"),
    committeeId: text(row, "out_committee_id"),
    committeeName: text(row, "out_committee_name"),
    dueDate: nullableText(row, "out_due_date"),
    sourceCreatedAt: text(row, "out_source_created_at"),
  }));
}

function parseDeadlines(value: unknown): DeadlineDay[] {
  const parsed = rows(value).map((row) => ({
    calendarDate: text(row, "out_calendar_date"),
    openTaskCount: count(row, "out_open_task_count"),
  }));
  if (parsed.length !== 7) throw new Error("invalid");
  return parsed;
}

function parseFreeMembers(value: unknown): FreeMember[] {
  return rows(value).map((row) => {
    const role = text(row, "out_role");
    if (role !== "Admin" && role !== "Co-Admin" && role !== "Member") throw new Error("invalid");
    return {
      memberId: text(row, "out_member_id"),
      fullName: text(row, "out_full_name"),
      avatarUrl: nullableText(row, "out_avatar_url"),
      role,
      openTaskCount: count(row, "out_open_task_count"),
    };
  });
}

function parseMembers(value: unknown): CommitteeMember[] {
  return rows(value).map((row) => ({
    committeeId: text(row, "out_committee_id"),
    memberId: text(row, "out_member_id"),
    fullName: text(row, "out_full_name"),
    avatarUrl: nullableText(row, "out_avatar_url"),
    activeTaskCount: count(row, "out_active_task_count"),
  }));
}

function parseSignals(value: unknown): MemberSignal[] {
  return rows(value).map((row) => ({
    committeeId: text(row, "out_committee_id"),
    memberId: text(row, "out_member_id"),
    openTaskCount: count(row, "out_open_task_count"),
    overdueTaskCount: count(row, "out_overdue_task_count"),
    atRiskTaskCount: count(row, "out_at_risk_task_count"),
  }));
}

async function read<T>(
  rpc: DashboardRpc,
  name: string,
  args: Record<string, unknown> | undefined,
  parse: (value: unknown) => T,
): Promise<DashboardSection<T>> {
  try {
    const result = await rpc(name, args);
    if (result.error) {
      return result.error.message === DASHBOARD_ACCESS_DENIED
        ? { status: "access-denied" }
        : { status: "error" };
    }
    return { status: "ready", data: parse(result.data) };
  } catch {
    return { status: "error" };
  }
}

export async function loadCommitteeTotals(rpc: DashboardRpc) {
  return read(rpc, "list_executive_dashboard_committee_totals", undefined, (value) =>
    rows(value).map(parseCommitteeTotal),
  );
}

export async function loadPushAdoption(rpc: DashboardRpc) {
  return read<PushAdoption>(rpc, "get_executive_dashboard_push_adoption", undefined, (value) => {
    const row = firstRow(value);
    return {
      activeProfilesWithPushCount: count(row, "out_active_profiles_with_push_count"),
      activeProfileCount: count(row, "out_active_profile_count"),
    };
  });
}

export async function loadDashboardScope(
  rpc: DashboardRpc,
  scope: DashboardScope,
): Promise<DashboardScopeData> {
  const args = dashboardRpcArgs(scope);
  const committeeArgs = scope.kind === "committee" ? args : undefined;
  const unavailableSummary: DashboardSection<CommitteeSummary | null> = {
    status: "ready",
    data: null,
  };
  const unavailableMembers: DashboardSection<CommitteeMember[]> = { status: "ready", data: [] };
  const unavailableSignals: DashboardSection<MemberSignal[]> = { status: "ready", data: [] };

  const [overview, attention, deadlines, freeMembers, summary, members, signals] = await Promise.all([
    read(rpc, "get_executive_dashboard_extras_overview", args, parseOverview),
    read(rpc, "list_executive_dashboard_needs_attention", args, parseAttention),
    read(rpc, "list_executive_dashboard_deadlines", args, parseDeadlines),
    read(rpc, "list_executive_dashboard_free_members", args, parseFreeMembers),
    scope.kind === "committee"
      ? read(rpc, "get_executive_dashboard_committee_summary", committeeArgs, (value) =>
          parseCommitteeTotal(firstRow(value)),
        )
      : Promise.resolve(unavailableSummary),
    scope.kind === "committee"
      ? read(rpc, "list_executive_dashboard_committee_members", committeeArgs, parseMembers)
      : Promise.resolve(unavailableMembers),
    scope.kind === "committee"
      ? read(rpc, "list_executive_dashboard_member_slipping_signals", committeeArgs, parseSignals)
      : Promise.resolve(unavailableSignals),
  ]);

  return { overview, attention, deadlines, freeMembers, summary, members, signals };
}
