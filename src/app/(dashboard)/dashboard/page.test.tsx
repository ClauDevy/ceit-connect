import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createClient: vi.fn(),
  loadDashboardScope: vi.fn(),
  loadCommitteeTotals: vi.fn(),
  loadPushAdoption: vi.fn(),
  dashboardProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/executive-dashboard-data", () => ({
  loadDashboardScope: mocks.loadDashboardScope,
  loadCommitteeTotals: mocks.loadCommitteeTotals,
  loadPushAdoption: mocks.loadPushAdoption,
}));
vi.mock("@/components/dashboard/executive-dashboard", () => ({
  ExecutiveDashboard: (props: Record<string, unknown>) => {
    mocks.dashboardProps = props;
    return <div>dashboard</div>;
  },
}));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: () => <h1>Executive Dashboard</h1> }));

import DashboardPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dashboardProps = undefined;
  mocks.requireUser.mockResolvedValue({ id: "signed-in" });
});

describe("Executive Dashboard page access", () => {
  it("blocks a Member before creating a Supabase client or running readers", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue(null);
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/home");
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith(["Admin", "Co-Admin"]);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.loadDashboardScope).not.toHaveBeenCalled();
  });

  it("shows a safe denial for a Co-Admin without a committee and runs no RPC", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue({ role: "Co-Admin", committee_id: null });
    renderToStaticMarkup(await DashboardPage());
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.loadDashboardScope).not.toHaveBeenCalled();
    expect(mocks.dashboardProps?.initialAccessDenied).toBe(true);
  });

  it("passes a Co-Admin committee id into the initial signed-in reader scope", async () => {
    const data = {
      overview: { status: "ready", data: {} }, attention: { status: "ready", data: [] },
      deadlines: { status: "ready", data: [] }, freeMembers: { status: "ready", data: [] },
      summary: { status: "ready", data: null }, members: { status: "ready", data: [] },
      signals: { status: "ready", data: [] },
    };
    mocks.getActiveProfileForRoles.mockResolvedValue({ role: "Co-Admin", committee_id: "committee-a" });
    mocks.createClient.mockResolvedValue({ rpc: vi.fn() });
    mocks.loadDashboardScope.mockResolvedValue(data);
    const page = await DashboardPage();
    const dashboard = (page as React.ReactElement<{
      children: React.ReactElement;
    }>).props.children;
    expect(dashboard.key).toBe("signed-in:Co-Admin:committee-a");
    renderToStaticMarkup(page);
    expect(mocks.loadDashboardScope.mock.calls[0]?.[1]).toEqual({
      kind: "committee",
      committeeId: "committee-a",
    });
    expect(mocks.loadCommitteeTotals).not.toHaveBeenCalled();
    expect(mocks.loadPushAdoption).not.toHaveBeenCalled();
  });
});
