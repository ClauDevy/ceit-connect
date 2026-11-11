import { describe, expect, it } from "vitest";
import {
  DASHBOARD_STATUS_PRESENTATION,
  barDisplayPercent,
  donutCompletedPercentage,
  donutTotal,
  donutValues,
  formatCalendarDate,
  pairMembersWithSignals,
  safeTaskHref,
  shouldShowLevelOneSleepingTiger,
  shouldShowLevelTwoSleepingTiger,
  tasksWithoutMemberBarNote,
  type CommitteeMember,
  type CommitteeSummary,
  type DashboardOverview,
} from "./executive-dashboard";

const overview: DashboardOverview = {
  openTaskCount: 12,
  overdueTaskCount: 2,
  dueIn24HoursTaskCount: 3,
  unassignedTaskCount: 4,
  helpWantedTaskCount: 5,
  needsApprovalCount: 6,
  donutOverdueCount: 2,
  donutDueIn24HoursCount: 3,
  donutInProgressCount: 4,
  donutToDoCount: 5,
  donutCompletedCount: 6,
};

const summary: CommitteeSummary = {
  committeeId: "committee-a",
  committeeName: "COEXA",
  uniqueActiveTaskCount: 0,
  coveredTaskCount: 0,
  unassignedTaskCount: 0,
  inactiveOnlyTaskCount: 0,
  activeOutsideCommitteeOnlyTaskCount: 0,
  tasksWithoutMemberBarCount: 7,
};

describe("Executive Dashboard number mapping", () => {
  it("uses the largest returned panel value as the display-only denominator", () => {
    expect(barDisplayPercent(4, [4, 10, 2])).toBe(40);
    expect(barDisplayPercent(0, [0, 0])).toBe(0);
    expect(barDisplayPercent(12, [12, 3])).toBe(100);
  });

  it("takes sleeping-tiger and discrepancy states only from summary totals", () => {
    expect(shouldShowLevelTwoSleepingTiger(summary)).toBe(true);
    expect(tasksWithoutMemberBarNote(summary)).toBe(7);
    expect(shouldShowLevelOneSleepingTiger([{ ...summary }, { ...summary, committeeId: "b" }])).toBe(true);
    expect(shouldShowLevelOneSleepingTiger([{ ...summary, uniqueActiveTaskCount: 1 }])).toBe(false);
    expect(shouldShowLevelOneSleepingTiger([])).toBe(false);
  });

  it("maps donut fields directly and keeps the matching KPI numbers equal", () => {
    const values = donutValues(overview);
    expect(values.map((item) => item.value)).toEqual([2, 3, 4, 5, 6]);
    expect(values[0].value).toBe(overview.overdueTaskCount);
    expect(values[1].value).toBe(overview.dueIn24HoursTaskCount);
    expect(donutTotal(overview)).toBe(20);
    expect(donutCompletedPercentage(overview)).toBe(30);
    expect(DASHBOARD_STATUS_PRESENTATION.overdue.token).toBe("destructive");
    expect(DASHBOARD_STATUS_PRESENTATION.dueIn24Hours.token).toBe("chart-1");
  });

  it("returns a safe no-task result instead of NaN or Infinity", () => {
    const zero = Object.fromEntries(Object.keys(overview).map((key) => [key, 0])) as DashboardOverview;
    expect(donutTotal(zero)).toBe(0);
    expect(donutCompletedPercentage(zero)).toBeNull();
  });

  it("preserves member order and does not invent a missing signals row", () => {
    const members: CommitteeMember[] = [
      { committeeId: "c", memberId: "m2", fullName: "Second", avatarUrl: null, activeTaskCount: 2 },
      { committeeId: "c", memberId: "m1", fullName: "First", avatarUrl: null, activeTaskCount: 1 },
    ];
    const paired = pairMembersWithSignals(members, [
      { committeeId: "c", memberId: "m1", openTaskCount: 1, overdueTaskCount: 0, atRiskTaskCount: 0 },
    ]);
    expect(paired.map((row) => row.member.memberId)).toEqual(["m2", "m1"]);
    expect(paired[0].signal).toBeNull();
    expect(paired[1].signal?.openTaskCount).toBe(1);
  });

  it("formats calendar-date parts without a timezone parse", () => {
    expect(formatCalendarDate("2026-11-01")).toBe("Nov 1");
    expect(formatCalendarDate("2026-01-01")).toBe("Jan 1");
    expect(formatCalendarDate("2026-11-01T00:30:00+14:00")).toBe("2026-11-01T00:30:00+14:00");
  });

  it("only creates the existing task-detail route for a safe UUID", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(safeTaskHref(id)).toBe(`/tasks/${id}`);
    expect(safeTaskHref(id.toUpperCase())).toBe(`/tasks/${id.toUpperCase()}`);
    expect(safeTaskHref("123e4567-e89b-12d3-a4564-26614174000")).toBeNull();
    expect(safeTaskHref("bad-target")).toBeNull();
    expect(safeTaskHref(null)).toBeNull();
  });
});
