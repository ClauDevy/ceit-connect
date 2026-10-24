"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LockKeyhole, RefreshCw, Search } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { preventSearchFormSubmission } from "@/lib/search";
import type { BoardAssignee } from "@/lib/events/board";
import {
  getArchivedTaskShareErrorCode,
  getArchivedTaskShareErrorMessage,
  isArchivedTaskShareControl,
  isArchivedTaskShareRetryableError,
  isArchivedTaskShareUnavailableError,
  MAX_ARCHIVED_TASK_VIEWER_SEARCH_LENGTH,
  normalizeArchivedTaskViewerSearch,
  type ArchivedTaskShareControl,
} from "@/lib/tasks/archive-sharing";
import { createClient } from "@/lib/supabase/client";

const POLL_INTERVAL_MS = 15_000;
const SEARCH_DEBOUNCE_MS = 250;

type BusyAction = {
  action: "grant" | "revoke";
  userId: string;
} | null;

type ArchivedTaskSharingProps = {
  taskId: string;
  viewers: BoardAssignee[];
};

function viewerName(viewer: BoardAssignee) {
  return viewer.full_name?.trim() || "Member";
}

export function ArchivedTaskSharing({
  taskId,
  viewers,
}: ArchivedTaskSharingProps) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const mutationInFlight = useRef(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] =
    useState<ArchivedTaskShareControl | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = normalizeArchivedTaskViewerSearch(search);
      if (!normalized.ok) {
        setSearchError(normalized.message);
        return;
      }
      setSearchError(null);
      setDebouncedSearch(normalized.value);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const controlsQuery = useQuery({
    queryKey: ["archived-task-share-controls", taskId, debouncedSearch],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("get_archived_task_share_controls", {
        p_task_id: taskId,
        p_search: debouncedSearch,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isArchivedTaskShareControl)) {
        throw new Error(
          "The archive-sharing reader returned an invalid response.",
        );
      }
      return data;
    },
    retry: (failureCount, error) =>
      !isArchivedTaskShareUnavailableError(error) && failureCount < 1,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchInterval: (query) =>
      query.state.dataUpdatedAt > query.state.errorUpdatedAt
        ? POLL_INTERVAL_MS
        : false,
    refetchIntervalInBackground: false,
  });

  const lastControlsResponseSucceeded =
    controlsQuery.isPlaceholderData ||
    (controlsQuery.data !== undefined &&
      controlsQuery.dataUpdatedAt > controlsQuery.errorUpdatedAt);
  const controls = lastControlsResponseSucceeded
    ? (controlsQuery.data ?? [])
    : [];
  const controlsUnavailable = isArchivedTaskShareUnavailableError(
    controlsQuery.error,
  );

  async function refreshTaskSurface() {
    await Promise.all([
      controlsQuery.refetch(),
      queryClient.refetchQueries({
        queryKey: ["task-detail", taskId],
        exact: true,
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: ["task-work-links", taskId],
        exact: true,
        type: "active",
      }),
      queryClient.refetchQueries({
        queryKey: ["task-comments", taskId, "newest"],
        exact: true,
        type: "active",
      }),
    ]);
  }

  async function runMutation(
    action: "grant" | "revoke",
    target: ArchivedTaskShareControl,
  ) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusyAction({ action, userId: target.out_id });
    setActionError(null);
    setNotice(null);
    try {
      const { error } = await supabase.rpc(
        action === "grant"
          ? "grant_archived_task_viewer"
          : "revoke_archived_task_viewer",
        {
          p_task_id: taskId,
          p_user_id: target.out_id,
        },
      );
      if (error) throw error;

      await refreshTaskSurface();
      setNotice(
        action === "grant"
          ? `${target.out_full_name} can now view this archived task.`
          : `${target.out_full_name} can no longer view this archived task.`,
      );
      if (action === "revoke") setRevokeTarget(null);
    } catch (error) {
      const code = getArchivedTaskShareErrorCode(error);
      if (
        isArchivedTaskShareRetryableError(error) ||
        ["CCS01", "CCS02", "CCS03", "CCS04", "CCS05"].includes(code)
      ) {
        await refreshTaskSurface();
      }
      if (action === "revoke") setRevokeTarget(null);
      setActionError(getArchivedTaskShareErrorMessage(error, action));
    } finally {
      mutationInFlight.current = false;
      setBusyAction(null);
    }
  }

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
        <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          <LockKeyhole className="size-4" aria-hidden /> Additional viewers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
        {viewers.length > 0 ? (
          <div className="space-y-2.5">
            {viewers.map((viewer) => {
              const name = viewerName(viewer);
              return (
                <div key={viewer.id} className="flex items-center gap-2.5">
                  <UserAvatar name={name} src={viewer.avatar_url} size="sm" />
                  <span className="min-w-0 truncate text-sm font-medium">
                    {name}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No additional viewers.
          </p>
        )}

        {lastControlsResponseSucceeded ? (
          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-sm font-semibold">Manage archived access</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Search active people to grant or revoke archive-only access.
              </p>
            </div>
            <div>
              <label htmlFor="archived-viewer-search" className="sr-only">
                Search people
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="archived-viewer-search"
                  type="search"
                  value={search}
                  maxLength={MAX_ARCHIVED_TASK_VIEWER_SEARCH_LENGTH}
                  disabled={busyAction !== null}
                  aria-invalid={Boolean(searchError)}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={preventSearchFormSubmission}
                  placeholder="Search people"
                  className="pl-9"
                />
              </div>
              {searchError ? (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  {searchError}
                </p>
              ) : null}
            </div>

            {controlsQuery.isPlaceholderData ? (
              <p className="text-sm text-muted-foreground">Loading people…</p>
            ) : controls.length > 0 ? (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {controls.map((candidate) => {
                  const action = candidate.out_is_archive_only
                    ? "revoke"
                    : "grant";
                  const busy =
                    busyAction?.action === action &&
                    busyAction.userId === candidate.out_id;
                  return (
                    <div
                      key={candidate.out_id}
                      className="flex items-center gap-2 rounded-lg px-2 py-2"
                    >
                      <UserAvatar
                        name={candidate.out_full_name}
                        src={candidate.out_avatar_url}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {candidate.out_full_name}
                      </span>
                      <Button
                        type="button"
                        variant={
                          candidate.out_is_archive_only
                            ? "destructive"
                            : "outline"
                        }
                        size="sm"
                        disabled={busyAction !== null}
                        onClick={() => {
                          setActionError(null);
                          setNotice(null);
                          if (candidate.out_is_archive_only) {
                            setRevokeTarget(candidate);
                          } else {
                            void runMutation("grant", candidate);
                          }
                        }}
                      >
                        {busy
                          ? "Saving…"
                          : candidate.out_is_archive_only
                            ? "Revoke"
                            : "Grant"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No matching people found.
              </p>
            )}
          </div>
        ) : null}

        {controlsQuery.error && !controlsUnavailable ? (
          <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {getArchivedTaskShareErrorMessage(controlsQuery.error, "read")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={controlsQuery.isFetching}
              onClick={() => void controlsQuery.refetch()}
            >
              <RefreshCw aria-hidden /> Retry
            </Button>
          </InlineAlert>
        ) : null}
        {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
        {notice ? (
          <p className="text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && busyAction === null) setRevokeTarget(null);
        }}
        title="Revoke archived access?"
        description={
          revokeTarget
            ? `${revokeTarget.out_full_name} will lose access to this confidential archived task.`
            : "This person will lose access to this confidential archived task."
        }
        confirmLabel="Revoke access"
        destructive
        loading={busyAction?.action === "revoke"}
        onConfirm={() => {
          if (revokeTarget) void runMutation("revoke", revokeTarget);
        }}
      />
    </Card>
  );
}
