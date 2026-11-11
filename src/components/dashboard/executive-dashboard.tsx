"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import {
  DASHBOARD_CACHE_MAX_AGE_MS,
  DASHBOARD_SERVER_FRESH_CACHE_SENTINEL,
  dashboardHasAccessDenied,
  dashboardScopeKey,
  type CommitteeTotal,
  type DashboardRole,
  type DashboardScope,
  type DashboardScopeData,
  type DashboardSection,
  type PushAdoption,
} from "@/lib/executive-dashboard";
import {
  loadCommitteeTotals,
  loadDashboardScope,
  loadPushAdoption,
  type DashboardRpc,
  type DashboardRpcResult,
} from "@/lib/executive-dashboard-data";
import { CommitteeWorkload, MemberWorkload } from "@/components/dashboard/executive-dashboard-charts";
import {
  AttentionCard,
  DashboardCard,
  DeadlinesCard,
  FreeMembersCard,
  OverviewKpis,
  PushAdoptionCard,
  StatusCard,
} from "@/components/dashboard/executive-dashboard-sections";

type CachedScope = { data: DashboardScopeData; loadedAt: number };

export function ExecutiveDashboard({
  viewerRole,
  initialScope,
  initialData,
  initialCommitteeTotals,
  initialPushAdoption,
  initialLoadedAt,
  initialAccessDenied = false,
}: {
  viewerRole: DashboardRole;
  initialScope: DashboardScope;
  initialData: DashboardScopeData;
  initialCommitteeTotals: DashboardSection<CommitteeTotal[]>;
  initialPushAdoption: DashboardSection<PushAdoption> | null;
  initialLoadedAt: number;
  initialAccessDenied?: boolean;
}) {
  const initialKey = dashboardScopeKey(initialScope);
  const [activeScope, setActiveScope] = useState(initialScope);
  const [seenScopeKeys, setSeenScopeKeys] = useState<Set<string>>(new Set());
  const [cache, setCache] = useState<Record<string, CachedScope>>(() => ({
    [initialKey]: {
      data: initialData,
      loadedAt:
        initialLoadedAt === DASHBOARD_SERVER_FRESH_CACHE_SENTINEL
          ? Date.now()
          : initialLoadedAt,
    },
  }));
  const cacheRef = useRef(cache);
  const [committeeTotals, setCommitteeTotals] = useState(initialCommitteeTotals);
  const [pushAdoption, setPushAdoption] = useState(initialPushAdoption);
  const [pendingScopes, setPendingScopes] = useState<Set<string>>(new Set());
  const [accessDenied, setAccessDenied] = useState(
    initialAccessDenied ||
      dashboardHasAccessDenied(initialData) ||
      initialCommitteeTotals.status === "access-denied" ||
      initialPushAdoption?.status === "access-denied",
  );
  const latestRequestByScope = useRef(new Map<string, number>());
  const requestSequence = useRef(0);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const refreshScope = useCallback(
    async (scope: DashboardScope) => {
      const key = dashboardScopeKey(scope);
      const requestId = ++requestSequence.current;
      latestRequestByScope.current.set(key, requestId);
      setPendingScopes((current) => new Set(current).add(key));

      const supabase = createClient();
      const rpc: DashboardRpc = (name, args) =>
        supabase.rpc(name as never, args as never) as unknown as PromiseLike<DashboardRpcResult>;
      const [scopeData, refreshedTotals, refreshedPush] = await Promise.all([
        loadDashboardScope(rpc, scope),
        viewerRole === "Admin" && scope.kind === "council"
          ? loadCommitteeTotals(rpc)
          : Promise.resolve(null),
        viewerRole === "Admin" && scope.kind === "council"
          ? loadPushAdoption(rpc)
          : Promise.resolve(null),
      ]);

      if (latestRequestByScope.current.get(key) !== requestId) return;
      setPendingScopes((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      if (
        dashboardHasAccessDenied(scopeData) ||
        refreshedTotals?.status === "access-denied" ||
        refreshedPush?.status === "access-denied"
      ) {
        setAccessDenied(true);
        return;
      }
      const nextCached = { data: scopeData, loadedAt: Date.now() };
      cacheRef.current = { ...cacheRef.current, [key]: nextCached };
      setCache(cacheRef.current);
      if (refreshedTotals) setCommitteeTotals(refreshedTotals);
      if (refreshedPush) setPushAdoption(refreshedPush);
    },
    [viewerRole],
  );

  const openScope = useCallback(
    (scope: DashboardScope) => {
      const key = dashboardScopeKey(scope);
      setSeenScopeKeys((current) => new Set(current).add(dashboardScopeKey(activeScope)));
      setActiveScope(scope);
      const cached = cacheRef.current[key];
      if (!cached || Date.now() - cached.loadedAt > DASHBOARD_CACHE_MAX_AGE_MS) {
        void refreshScope(scope);
      }
    },
    [activeScope, refreshScope],
  );

  const activeKey = dashboardScopeKey(activeScope);
  const activeCache = cache[activeKey];
  const isPending = pendingScopes.has(activeKey);
  const animate = !seenScopeKeys.has(activeKey);

  useEffect(() => {
    if (
      activeCache &&
      !isPending &&
      Date.now() - activeCache.loadedAt > DASHBOARD_CACHE_MAX_AGE_MS
    ) {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) void refreshScope(activeScope);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [activeCache, activeKey, activeScope, isPending, refreshScope]);

  useEffect(() => {
    const refreshActiveScopeIfStale = () => {
      const active = cacheRef.current[activeKey];
      if (
        active &&
        !isPending &&
        Date.now() - active.loadedAt > DASHBOARD_CACHE_MAX_AGE_MS
      ) {
        void refreshScope(activeScope);
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshActiveScopeIfStale();
    };

    window.addEventListener("focus", refreshActiveScopeIfStale);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshActiveScopeIfStale);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [activeKey, activeScope, isPending, refreshScope]);

  if (accessDenied) {
    return (
      <InlineAlert>
        The Executive Dashboard is not available for this account. Return Home or ask an Admin to
        check your committee assignment.
      </InlineAlert>
    );
  }

  if (!activeCache) {
    return (
      <div className="space-y-4">
        {viewerRole === "Admin" && activeScope.kind === "committee" ? (
          <Button variant="outline" onClick={() => openScope({ kind: "council" })}>
            <ChevronLeft aria-hidden /> All committees
          </Button>
        ) : null}
        <DashboardLoadingState />
      </div>
    );
  }

  const data = activeCache.data;
  const committeeName =
    data.summary.status === "ready" ? data.summary.data?.committeeName ?? "Committee" : "Committee";

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {activeScope.kind === "council" ? "Council scope" : "Committee scope"}
          </p>
          <h2 className="truncate font-display text-xl font-semibold">
            {activeScope.kind === "council" ? "All committees" : committeeName}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {viewerRole === "Admin" && activeScope.kind === "committee" ? (
            <Button variant="outline" onClick={() => openScope({ kind: "council" })}>
              <ChevronLeft aria-hidden /> All committees
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => void refreshScope(activeScope)}
            disabled={isPending}
            aria-label="Refresh dashboard"
          >
            <RefreshCw aria-hidden className={isPending ? "motion-safe:animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {isPending ? <p role="status" className="text-xs text-muted-foreground">Refreshing dashboard…</p> : null}

      <OverviewKpis section={data.overview} />
      <DeadlinesCard section={data.deadlines} animate={animate} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <DashboardCard
          title={activeScope.kind === "council" ? "Workload by committee" : `Workload in ${committeeName}`}
          description={
            activeScope.kind === "council"
              ? "Select a committee to see its member workload."
              : "True workload per active committee member."
          }
        >
          {activeScope.kind === "council" ? (
            <CommitteeWorkload
              totals={committeeTotals}
              animate={animate}
              onSelect={(committeeId) => openScope({ kind: "committee", committeeId })}
            />
          ) : (
            <MemberWorkload
              summary={data.summary}
              members={data.members}
              signals={data.signals}
              animate={animate}
            />
          )}
        </DashboardCard>
        <div className="space-y-4">
          <AttentionCard section={data.attention} />
          <StatusCard section={data.overview} animate={animate} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FreeMembersCard section={data.freeMembers} />
        {viewerRole === "Admin" && activeScope.kind === "council" && pushAdoption ? (
          <PushAdoptionCard section={pushAdoption} />
        ) : null}
      </div>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div role="status" aria-label="Loading Executive Dashboard" className="space-y-5">
      <span className="sr-only">Loading Executive Dashboard</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24" />)}
      </div>
      <Skeleton className="h-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
