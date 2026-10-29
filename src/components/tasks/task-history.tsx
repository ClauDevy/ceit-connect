"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityLogList } from "@/components/activity-log/activity-log-list";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_LOG_STALE_TIME,
  DEFAULT_ACTIVITY_FILTERS,
  activityErrorCode,
  activityFiltersToRpc,
  activityReplayDepth,
  appendActivityPage,
  activityLogRetentionNotice,
  normalizeActivityResponse,
  replayActivityPages,
  taskHistoryOlderPageFailure,
  taskHistoryQueryKey,
  unavailableActivityWindow,
  type ActivityCursor,
  type ActivityPage,
  type ActivityWindow,
} from "@/lib/activity-log";
import { createClient } from "@/lib/supabase/client";

export function TaskHistory({ taskId, initialWindow }: { taskId: string; initialWindow: ActivityWindow }) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const busy = useRef(false);
  const replayDepth = useRef(activityReplayDepth(initialWindow));
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const queryKey = taskHistoryQueryKey(taskId);

  async function readPage(cursor: ActivityCursor | null): Promise<ActivityPage> {
    const { data, error } = await supabase.rpc(
      "list_activity_log",
      activityFiltersToRpc(DEFAULT_ACTIVITY_FILTERS, cursor, taskId),
    );
    if (error) throw error;
    return normalizeActivityResponse(data);
  }

  const query = useQuery({
    queryKey,
    initialData: initialWindow,
    staleTime: ACTIVITY_LOG_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: async () => {
      const pages: ActivityPage[] = [];
      let cursor: ActivityCursor | null = null;
      try {
        for (let index = 0; index < replayDepth.current; index += 1) {
          const page = await readPage(cursor);
          pages.push(page);
          if (!page.hasMore || !page.cursor) break;
          cursor = page.cursor;
        }
      } catch (error) {
        if (activityErrorCode(error) === "CAL01") return unavailableActivityWindow();
        throw error;
      }
      return replayActivityPages(initialWindow, pages, null);
    },
  });

  useEffect(() => {
    if (query.data) replayDepth.current = activityReplayDepth(query.data);
  }, [query.data]);

  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }

  async function loadMore() {
    if (busy.current || !query.data?.cursor) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const page = await readPage(query.data.cursor);
      queryClient.setQueryData<ActivityWindow>(queryKey, (current) =>
        current ? appendActivityPage(current, page) : initialWindow,
      );
      setLoadMoreError(null);
    } catch (error) {
      const failure = taskHistoryOlderPageFailure(error);
      if (failure.unavailable) {
        queryClient.setQueryData(queryKey, unavailableActivityWindow());
        setLoadMoreError(null);
      } else {
        setLoadMoreError(failure.message);
      }
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }

  const unavailable = query.data?.unavailable;
  return (
    <section className="space-y-3" aria-labelledby="task-history-heading">
      <div className="flex items-center justify-between">
        <h2 id="task-history-heading" className="font-display text-lg font-semibold">History</h2>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing || loadingMore}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{activityLogRetentionNotice()}</p>
      {!unavailable && query.error ? (
        <p className="text-sm text-muted-foreground">
          History could not refresh. The previous results are still shown.
        </p>
      ) : null}
      {!unavailable && loadMoreError ? (
        <p className="text-sm text-muted-foreground">{loadMoreError}</p>
      ) : null}
      {unavailable ? (
        <p className="text-sm text-muted-foreground">Activity history is unavailable.</p>
      ) : query.data?.rows.length ? (
        <ActivityLogList rows={query.data.rows} settled={!query.isFetching} />
      ) : (
        <p className="text-sm text-muted-foreground">No task history yet.</p>
      )}
      {!unavailable && query.data?.hasMore ? (
        <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore || refreshing}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </section>
  );
}
