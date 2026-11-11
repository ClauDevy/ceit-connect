import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  loadCommitteeTotals,
  loadDashboardScope,
  loadPushAdoption,
  type DashboardRpc,
  type DashboardRpcResult,
} from "@/lib/executive-dashboard-data";
import {
  DASHBOARD_SERVER_FRESH_CACHE_SENTINEL,
  type CommitteeTotal,
  type DashboardScopeData,
  type DashboardSection,
  type PushAdoption,
} from "@/lib/executive-dashboard";

export default async function DashboardPage() {
  const user = await requireUser();
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin"]);

  if (!profile) {
    redirect("/home");
  }

  if (profile.role === "Co-Admin" && !profile.committee_id) {
    return (
      <DashboardFrame>
        <ExecutiveDashboard
          key={`${user.id}:${profile.role}:${profile.committee_id ?? "none"}`}
          viewerRole="Co-Admin"
          initialScope={{ kind: "committee", committeeId: "unavailable" }}
          initialData={emptyDashboardData()}
          initialCommitteeTotals={{ status: "ready", data: [] }}
          initialPushAdoption={null}
          initialLoadedAt={DASHBOARD_SERVER_FRESH_CACHE_SENTINEL}
          initialAccessDenied
        />
      </DashboardFrame>
    );
  }

  const supabase = await createClient();
  const rpc: DashboardRpc = (name, args) =>
    supabase.rpc(name as never, args as never) as unknown as PromiseLike<DashboardRpcResult>;
  const initialScope =
    profile.role === "Admin"
      ? ({ kind: "council" } as const)
      : ({ kind: "committee", committeeId: profile.committee_id ?? "" } as const);
  const [initialData, initialCommitteeTotals, initialPushAdoption] = await Promise.all([
    loadDashboardScope(rpc, initialScope),
    profile.role === "Admin"
      ? loadCommitteeTotals(rpc)
      : Promise.resolve<DashboardSection<CommitteeTotal[]>>({ status: "ready", data: [] }),
    profile.role === "Admin"
      ? loadPushAdoption(rpc)
      : Promise.resolve<DashboardSection<PushAdoption> | null>(null),
  ]);

  return (
    <DashboardFrame>
      <ExecutiveDashboard
        key={`${user.id}:${profile.role}:${profile.committee_id ?? "none"}`}
        viewerRole={profile.role}
        initialScope={initialScope}
        initialData={initialData}
        initialCommitteeTotals={initialCommitteeTotals}
        initialPushAdoption={initialPushAdoption}
        initialLoadedAt={DASHBOARD_SERVER_FRESH_CACHE_SENTINEL}
      />
    </DashboardFrame>
  );
}

function DashboardFrame({ children }: { children: ReactNode }) {
  return (
    <div className="motion-content-ready space-y-5 md:space-y-6">
      <PageHeader
        title="Executive Dashboard"
        description="Council workload, urgent work, and capacity from the signed-in dashboard readers."
      />
      {children}
    </div>
  );
}

function emptyDashboardData(): DashboardScopeData {
  return {
    overview: { status: "error" },
    attention: { status: "error" },
    deadlines: { status: "error" },
    freeMembers: { status: "error" },
    summary: { status: "error" },
    members: { status: "error" },
    signals: { status: "error" },
  };
}
