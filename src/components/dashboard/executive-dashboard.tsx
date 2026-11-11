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

type CachedScope = {
  data: DashboardScopeData;
  loadedAt: number;
  lastAttemptAt: number;
  refreshFailed: boolean;
};

function dashboardHasReaderError(data: DashboardScopeData) {
  return Object.values(data).some((section) => section.status === "error");
}

function preserveSuccessfulSections(
  previous: DashboardScopeData | undefined,
  next: DashboardScopeData,
): DashboardScopeData {
  if (!previous) return next;
  return {
    overview: next.overview.status === "error" && previous.overview.status === "ready"
      ? previous.overview
      : next.overview,
    attention: next.attention.status === "error" && previous.attention.status === "ready"
      ? previous.attention
      : next.attention,
    deadlines: next.deadlines.status === "error" && previous.deadlines.status === "ready"
      ? previous.deadlines
      : next.deadlines,
    freeMembers: next.freeMembers.status === "error" && previous.freeMembers.status === "ready"
      ? previous.freeMembers
      : next.freeMembers,
    summary: next.summary.status === "error" && previous.summary.status === "ready"
      ? previous.summary
      : next.summary,
    members: next.members.status === "error" && previous.members.status === "ready"
      ? previous.members
      : next.members,
    signals: next.signals.status === "error" && previous.signals.status === "ready"
      ? previous.signals
      : next.signals,
  };
}

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
  const [cache, setCache] = useState<Record<string, CachedScope>>(() => {
    const loadedAt = initialLoadedAt === DASHBOARD_SERVER_FRESH_CACHE_SENTINEL
      ? Date.now()
      : initialLoadedAt;
    return {
      [initialKey]: { data: initialData, loadedAt, lastAttemptAt: loadedAt, refreshFailed: false },
    };
  });
  const cacheRef = useRef(cache);
  const [committeeTotals, setCommitteeTotals] = useState(initialCommitteeTotals);
  const [pushAdoption, setPushAdoption] = useState(initialPushAdoption);
  const [pendingScopes, setPendingScopes] = useState<Set<string>>(new Set());
  const [deniedScopeKeys, setDeniedScopeKeys] = useState<Set<string>>(() =>
    initialAccessDenied ||
    dashboardHasAccessDenied(initialData) ||
    initialCommitteeTotals.status === "access-denied" ||
    initialPushAdoption?.status === "access-denied"
      ? new Set([initialKey])
      : new Set(),
  );
  const inFlightByScope = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const refreshScope = useCallback(
    (scope: DashboardScope) => {
      const key = dashboardScopeKey(scope);
      const existingRequest = inFlightByScope.current.get(key);
      if (existingRequest) return existingRequest;

      const request = (async () => {
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
          const nextCache = { ...cacheRef.current };
          delete nextCache[key];
          cacheRef.current = nextCache;
          setCache(nextCache);
          setDeniedScopeKeys((current) => new Set(current).add(key));
          return;
        }
        const previousCached = cacheRef.current[key];
        const attemptedAt = Date.now();
        const refreshFailed =
          dashboardHasReaderError(scopeData) ||
          refreshedTotals?.status === "error" ||
          refreshedPush?.status === "error";
        if (!refreshFailed) {
          setDeniedScopeKeys((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
        const nextCached = {
          data: preserveSuccessfulSections(previousCached?.data, scopeData),
          loadedAt: refreshFailed ? previousCached?.loadedAt ?? 0 : attemptedAt,
          lastAttemptAt: refreshFailed
            ? Math.max(attemptedAt, (previousCached?.loadedAt ?? 0) + 1)
            : attemptedAt,
          refreshFailed,
        };
        cacheRef.current = { ...cacheRef.current, [key]: nextCached };
        setCache(cacheRef.current);
        if (refreshedTotals) {
          setCommitteeTotals((current) =>
            refreshedTotals.status === "error" && current.status === "ready"
              ? current
              : refreshedTotals,
          );
        }
        if (refreshedPush) {
          setPushAdoption((current) =>
            refreshedPush.status === "error" && current?.status === "ready"
              ? current
              : refreshedPush,
          );
        }
      })();

      inFlightByScope.current.set(key, request);
      const removeRequest = () => {
        if (inFlightByScope.current.get(key) === request) {
          inFlightByScope.current.delete(key);
        }
      };
      void request.then(removeRequest, removeRequest);
      return request;
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
  const accessDenied = deniedScopeKeys.has(activeKey);

  useEffect(() => {
    if (
      activeCache &&
      !isPending &&
      !accessDenied &&
      activeCache.lastAttemptAt <= activeCache.loadedAt &&
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
  }, [accessDenied, activeCache, activeKey, activeScope, isPending, refreshScope]);

  useEffect(() => {
    const refreshActiveScopeIfStale = () => {
      const active = cacheRef.current[activeKey];
      const now = Date.now();
      if (
        active &&
        !isPending &&
        !accessDenied &&
        now - active.loadedAt > DASHBOARD_CACHE_MAX_AGE_MS &&
        now - active.lastAttemptAt > DASHBOARD_CACHE_MAX_AGE_MS
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
  }, [accessDenied, activeKey, activeScope, isPending, refreshScope]);

  if (accessDenied) {
    const canRetryAccess =
      activeScope.kind === "council" || activeScope.committeeId !== "unavailable";
    return (
      <div className="space-y-4">
        {viewerRole === "Admin" && activeScope.kind === "committee" ? (
          <Button variant="outline" onClick={() => openScope({ kind: "council" })}>
            <ChevronLeft aria-hidden /> All committees
          </Button>
        ) : null}
        <InlineAlert>
          The Executive Dashboard is not available for this account. Return Home or ask an Admin to
          check your committee assignment.
        </InlineAlert>
        {canRetryAccess ? (
          <Button
            variant="outline"
            onClick={() => void refreshScope(activeScope)}
            disabled={isPending}
          >
            <RefreshCw aria-hidden className={isPending ? "motion-safe:animate-spin" : undefined} />
            Retry access
          </Button>
        ) : null}
      </div>
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
      {activeCache.refreshFailed ? (
        <InlineAlert variant="warning">
          Some dashboard data could not refresh. Previously loaded values may still be shown and
          could be out of date. Use Refresh to try again.
        </InlineAlert>
      ) : null}

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
