// @vitest-environment happy-dom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_CACHE_MAX_AGE_MS,
  DASHBOARD_SERVER_FRESH_CACHE_SENTINEL,
  type DashboardScopeData,
} from "@/lib/executive-dashboard";

const mocks = vi.hoisted(() => ({
  loadDashboardScope: vi.fn(),
  loadCommitteeTotals: vi.fn(),
  loadPushAdoption: vi.fn(),
  createClient: vi.fn(() => ({ rpc: vi.fn() })),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/executive-dashboard-data", () => ({
  loadDashboardScope: mocks.loadDashboardScope,
  loadCommitteeTotals: mocks.loadCommitteeTotals,
  loadPushAdoption: mocks.loadPushAdoption,
}));
vi.mock("@/components/dashboard/executive-dashboard-charts", () => ({
  CommitteeWorkload: ({ totals, onSelect, animate }: {
    totals: { status: string; data?: Array<{ committeeId: string; committeeName: string }> };
    onSelect: (id: string) => void;
    animate: boolean;
  }) => (
    <div data-testid="committee-workload" data-animate={String(animate)}>
      {totals.data?.map((row) => (
        <button key={row.committeeId} onClick={() => onSelect(row.committeeId)}>
          Open {row.committeeName}
        </button>
      ))}
    </div>
  ),
  MemberWorkload: ({ summary, animate }: {
    summary: { status: string; data?: { committeeName: string } | null };
    animate: boolean;
  }) => <div data-testid="member-workload" data-animate={String(animate)}>{summary.data?.committeeName}</div>,
}));
vi.mock("@/components/dashboard/executive-dashboard-sections", () => ({
  DashboardCard: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
  OverviewKpis: ({ section }: { section: { data?: { openTaskCount: number } } }) => <div>overview:{section.data?.openTaskCount}</div>,
  DeadlinesCard: () => <div>deadlines</div>,
  AttentionCard: () => <div>attention</div>,
  StatusCard: () => <div>status</div>,
  FreeMembersCard: () => <div>free</div>,
  PushAdoptionCard: () => <div>push</div>,
}));

import { ExecutiveDashboard } from "./executive-dashboard";

const committeeTotals = {
  status: "ready" as const,
  data: [
    { committeeId: "alpha", committeeName: "Alpha", uniqueActiveTaskCount: 2 },
    { committeeId: "beta", committeeName: "Beta", uniqueActiveTaskCount: 3 },
  ],
};

function scopeData(name: string | null, openTaskCount: number): DashboardScopeData {
  return {
    overview: { status: "ready", data: {
      openTaskCount,
      overdueTaskCount: 0,
      dueIn24HoursTaskCount: 0,
      unassignedTaskCount: 0,
      helpWantedTaskCount: 0,
      needsApprovalCount: 0,
      donutOverdueCount: 0,
      donutDueIn24HoursCount: 0,
      donutInProgressCount: openTaskCount,
      donutToDoCount: 0,
      donutCompletedCount: 0,
    } },
    attention: { status: "ready", data: [] },
    deadlines: { status: "ready", data: [] },
    freeMembers: { status: "ready", data: [] },
    summary: name ? { status: "ready", data: {
      committeeId: name.toLowerCase(), committeeName: name, uniqueActiveTaskCount: openTaskCount,
      coveredTaskCount: openTaskCount, unassignedTaskCount: 0, inactiveOnlyTaskCount: 0,
      activeOutsideCommitteeOnlyTaskCount: 0, tasksWithoutMemberBarCount: 0,
    } } : { status: "ready", data: null },
    members: { status: "ready", data: [] },
    signals: { status: "ready", data: [] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Executive Dashboard scope cache", () => {
  it("ignores an older committee response after rapid switching", async () => {
    const alpha = deferred<DashboardScopeData>();
    const beta = deferred<DashboardScopeData>();
    mocks.loadDashboardScope.mockImplementation((_rpc, scope: { committeeId?: string }) =>
      scope.committeeId === "alpha" ? alpha.promise : beta.promise,
    );
    render(
      <ExecutiveDashboard
        viewerRole="Admin"
        initialScope={{ kind: "council" }}
        initialData={scopeData(null, 5)}
        initialCommitteeTotals={committeeTotals as never}
        initialPushAdoption={{ status: "ready", data: { activeProfilesWithPushCount: 1, activeProfileCount: 2 } }}
        initialLoadedAt={Date.now()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: /All committees/i }));
    fireEvent.click(screen.getByRole("button", { name: "Open Beta" }));
    beta.resolve(scopeData("Beta", 3));
    expect((await screen.findAllByText("Beta")).length).toBeGreaterThan(0);
    expect(screen.queryByText("push")).toBeNull();
    alpha.resolve(scopeData("Alpha", 2));
    await waitFor(() => expect(screen.queryByText("Alpha")).toBeNull());
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
  });

  it("shows stale cached data immediately and refreshes it quietly", async () => {
    const refreshed = deferred<DashboardScopeData>();
    mocks.loadDashboardScope.mockReturnValue(refreshed.promise);
    mocks.loadCommitteeTotals.mockResolvedValue(committeeTotals);
    mocks.loadPushAdoption.mockResolvedValue({ status: "ready", data: { activeProfilesWithPushCount: 2, activeProfileCount: 3 } });
    render(
      <ExecutiveDashboard
        viewerRole="Admin"
        initialScope={{ kind: "council" }}
        initialData={scopeData(null, 5)}
        initialCommitteeTotals={committeeTotals as never}
        initialPushAdoption={{ status: "ready", data: { activeProfilesWithPushCount: 1, activeProfileCount: 2 } }}
        initialLoadedAt={0}
      />,
    );

    expect(screen.getByText("overview:5")).toBeTruthy();
    const workloadBeforeRefresh = screen.getByTestId("committee-workload");
    await waitFor(() => expect(mocks.loadDashboardScope).toHaveBeenCalledOnce());
    expect(screen.getByRole("status").textContent).toContain("Refreshing dashboard");
    refreshed.resolve(scopeData(null, 9));
    expect(await screen.findByText("overview:9")).toBeTruthy();
    expect(screen.getByTestId("committee-workload")).toBe(workloadBeforeRefresh);
  });

  it.each(["focus", "visibilitychange"] as const)(
    "refreshes stale active data when the dashboard receives %s",
    async (eventName) => {
      let now = 10_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      mocks.loadDashboardScope.mockResolvedValue(scopeData(null, 8));
      mocks.loadCommitteeTotals.mockResolvedValue(committeeTotals);
      mocks.loadPushAdoption.mockResolvedValue({ status: "ready", data: { activeProfilesWithPushCount: 2, activeProfileCount: 3 } });
      render(
        <ExecutiveDashboard
          viewerRole="Admin"
          initialScope={{ kind: "council" }}
          initialData={scopeData(null, 5)}
          initialCommitteeTotals={committeeTotals as never}
          initialPushAdoption={{ status: "ready", data: { activeProfilesWithPushCount: 1, activeProfileCount: 2 } }}
          initialLoadedAt={now}
        />,
      );

      expect(mocks.loadDashboardScope).not.toHaveBeenCalled();
      now += DASHBOARD_CACHE_MAX_AGE_MS + 1;
      if (eventName === "focus") {
        fireEvent.focus(window);
      } else {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        fireEvent(document, new Event("visibilitychange"));
      }

      await waitFor(() => expect(mocks.loadDashboardScope).toHaveBeenCalledOnce());
    },
  );

  it("treats server-fetched data as fresh at this component's initialization time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    render(
      <ExecutiveDashboard
        viewerRole="Admin"
        initialScope={{ kind: "council" }}
        initialData={scopeData(null, 5)}
        initialCommitteeTotals={committeeTotals as never}
        initialPushAdoption={{ status: "ready", data: { activeProfilesWithPushCount: 1, activeProfileCount: 2 } }}
        initialLoadedAt={DASHBOARD_SERVER_FRESH_CACHE_SENTINEL}
      />,
    );

    await Promise.resolve();
    expect(mocks.loadDashboardScope).not.toHaveBeenCalled();
  });

  it("starts with a fresh scope and no previous cache when the viewer identity key changes", async () => {
    mocks.loadDashboardScope.mockResolvedValue(scopeData("Alpha", 2));
    const { rerender } = render(
      <ExecutiveDashboard
        key="viewer-a:Admin:none"
        viewerRole="Admin"
        initialScope={{ kind: "council" }}
        initialData={scopeData(null, 5)}
        initialCommitteeTotals={committeeTotals as never}
        initialPushAdoption={{ status: "ready", data: { activeProfilesWithPushCount: 1, activeProfileCount: 2 } }}
        initialLoadedAt={Date.now()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Alpha" }));
    expect((await screen.findAllByText("Alpha")).length).toBeGreaterThan(0);

    rerender(
      <ExecutiveDashboard
        key="viewer-b:Co-Admin:beta"
        viewerRole="Co-Admin"
        initialScope={{ kind: "committee", committeeId: "beta" }}
        initialData={scopeData("Beta", 7)}
        initialCommitteeTotals={{ status: "ready", data: [] }}
        initialPushAdoption={null}
        initialLoadedAt={Date.now()}
      />,
    );

    expect(screen.getByText("overview:7")).toBeTruthy();
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByRole("button", { name: /All committees/i })).toBeNull();
  });

  it("gives a Co-Admin no council navigation or push-adoption section", () => {
    render(
      <ExecutiveDashboard
        viewerRole="Co-Admin"
        initialScope={{ kind: "committee", committeeId: "coexa" }}
        initialData={scopeData("COEXA", 2)}
        initialCommitteeTotals={{ status: "ready", data: [] }}
        initialPushAdoption={{ status: "ready", data: { activeProfilesWithPushCount: 1, activeProfileCount: 2 } }}
        initialLoadedAt={Date.now()}
      />,
    );
    expect(screen.queryByRole("button", { name: /All committees/i })).toBeNull();
    expect(screen.queryByText("push")).toBeNull();
  });
});
