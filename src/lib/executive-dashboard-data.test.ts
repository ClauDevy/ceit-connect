import { describe, expect, it, vi } from "vitest";
import { loadDashboardScope, type DashboardRpc } from "./executive-dashboard-data";

const id = "123e4567-e89b-12d3-a456-426614174000";
const overview = [{
  out_open_task_count: 1,
  out_overdue_task_count: 0,
  out_due_in_24_hours_task_count: 0,
  out_unassigned_task_count: 0,
  out_help_wanted_task_count: 0,
  out_needs_approval_count: 0,
  out_donut_overdue_count: 0,
  out_donut_due_in_24_hours_count: 0,
  out_donut_in_progress_count: 1,
  out_donut_to_do_count: 0,
  out_donut_completed_count: 0,
}];
const summary = [{
  out_committee_id: id,
  out_committee_name: "COEXA",
  out_unique_active_task_count: 1,
  out_covered_task_count: 1,
  out_unassigned_task_count: 0,
  out_inactive_only_task_count: 0,
  out_active_outside_committee_only_task_count: 0,
  out_tasks_without_member_bar_count: 0,
}];

function resultFor(name: string) {
  if (name === "get_executive_dashboard_extras_overview") return overview;
  if (name === "list_executive_dashboard_needs_attention") return [];
  if (name === "list_executive_dashboard_deadlines") {
    return Array.from({ length: 7 }, (_, index) => ({
      out_calendar_date: `2026-11-${String(index + 1).padStart(2, "0")}`,
      out_open_task_count: 0,
    }));
  }
  if (name === "list_executive_dashboard_free_members") return [];
  if (name === "get_executive_dashboard_committee_summary") return summary;
  if (name === "list_executive_dashboard_committee_members") {
    return [{ out_committee_id: id, out_member_id: "member", out_full_name: "Member", out_avatar_url: null, out_active_task_count: 1 }];
  }
  if (name === "list_executive_dashboard_member_slipping_signals") {
    return [{ out_committee_id: id, out_member_id: "member", out_open_task_count: 1, out_overdue_task_count: 0, out_at_risk_task_count: 0 }];
  }
  throw new Error(`Unexpected reader ${name}`);
}

describe("Executive Dashboard reader scope", () => {
  it("omits council scope and always passes the selected committee id", async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const rpc: DashboardRpc = vi.fn(async (name, args) => {
      calls.push([name, args]);
      return { data: resultFor(name), error: null };
    });
    const councilResult = await loadDashboardScope(rpc, { kind: "council" });
    expect(Object.values(councilResult).every((section) => section.status === "ready")).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls.every(([, args]) => args === undefined)).toBe(true);

    calls.length = 0;
    const committeeResult = await loadDashboardScope(rpc, { kind: "committee", committeeId: id });
    expect(Object.values(committeeResult).every((section) => section.status === "ready")).toBe(true);
    expect(calls).toHaveLength(7);
    expect(calls.every(([, args]) => args?.p_committee_id === id)).toBe(true);
  });

  it("keeps member bars ready when only slipping signals fail", async () => {
    const rpc: DashboardRpc = async (name) => ({
      data: resultFor(name),
      error: name === "list_executive_dashboard_member_slipping_signals" ? { message: "Unavailable" } : null,
    });
    const data = await loadDashboardScope(rpc, { kind: "committee", committeeId: id });
    expect(data.members.status).toBe("ready");
    expect(data.signals.status).toBe("error");
    expect(data.overview.status).toBe("ready");
  });

  it("classifies the fixed denial without exposing its raw text", async () => {
    const rpc: DashboardRpc = async (name) => ({
      data: resultFor(name),
      error: name === "list_executive_dashboard_deadlines"
        ? { message: "Executive Dashboard access denied." }
        : null,
    });
    const data = await loadDashboardScope(rpc, { kind: "council" });
    expect(data.deadlines).toEqual({ status: "access-denied" });
  });
});
