"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ellipsis, LogOut, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  getTaskLeaveErrorMessage,
  isTaskLeaveRequest,
  type TaskLeaveRequest,
} from "@/lib/tasks/leave";
import { createClient } from "@/lib/supabase/client";

type PendingAction = {
  request: TaskLeaveRequest;
  kind: "cancel" | "deny";
} | null;

export function TaskLeaveRequests({ taskId }: { taskId?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState<TaskLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const retryBusyRef = useRef(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc(
      "list_pending_task_leave_requests",
      { p_task_id: taskId ?? null },
    );
    if (loadError) throw loadError;
    if (!Array.isArray(data) || !data.every(isTaskLeaveRequest)) {
      throw new Error("Invalid leave-request response.");
    }
    setRequests(data);
  }, [supabase, taskId]);

  async function retryLoad() {
    if (busyId || retryBusyRef.current) return;
    retryBusyRef.current = true;
    setBusyId("retry");
    try {
      await load();
      setError(null);
    } catch {
      setError("Leave requests could not be loaded.");
    } finally {
      retryBusyRef.current = false;
      setBusyId(null);
    }
  }

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load()
        .catch(() => active && setError("Leave requests could not be loaded."))
        .finally(() => active && setLoading(false));
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    const refresh = () => void load().catch(() => {
      setError("Leave requests could not be loaded.");
    });
    window.addEventListener("task-leave-requests:changed", refresh);
    return () => window.removeEventListener("task-leave-requests:changed", refresh);
  }, [load]);

  async function mutate(
    request: TaskLeaveRequest,
    decision: "approved" | "denied" | "cancelled",
  ) {
    if (busyId) return;
    setBusyId(request.out_id);
    setError(null);
    try {
      const result = decision === "cancelled"
        ? await supabase.rpc("cancel_task_leave_request", {
            p_task_id: request.out_task_id,
          })
        : await supabase.rpc("resolve_task_leave_request", {
            p_request_id: request.out_id,
            p_decision: decision,
          });
      if (result.error) throw result.error;
      await load();
      setPendingAction(null);
    } catch (actionError) {
      setError(getTaskLeaveErrorMessage(actionError));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return null;
  if (requests.length === 0 && !error) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <LogOut className="size-4" aria-hidden /> Leave requests
        </CardTitle>
        <Badge variant="neutral">{requests.length} pending</Badge>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 sm:px-5">
        {error ? (
          <InlineAlert className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyId !== null}
              onClick={() => void retryLoad()}
            >
              <RefreshCw aria-hidden /> Retry
            </Button>
          </InlineAlert>
        ) : null}
        {requests.map((request) => (
          <div key={request.out_id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{request.out_requester_name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {request.out_task_title} · {request.out_event_name}
              </p>
            </div>
            {request.out_can_resolve ? (
              <Button
                type="button"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void mutate(request, "approved")}
              >
                Approve
              </Button>
            ) : null}
            {request.out_can_resolve || request.out_is_requester ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`More actions for ${request.out_requester_name}`}
                  disabled={busyId !== null}
                  className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 motion-reduce:transition-none"
                >
                  <Ellipsis className="size-4" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                    onClick={() => setPendingAction({
                      request,
                      kind: request.out_is_requester ? "cancel" : "deny",
                    })}
                  >
                    {request.out_is_requester ? "Cancel request" : "Deny request"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ))}
      </CardContent>
      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title={pendingAction?.kind === "cancel" ? "Cancel leave request?" : "Deny leave request?"}
        description="This pending request will be closed."
        confirmLabel={pendingAction?.kind === "cancel" ? "Cancel request" : "Deny request"}
        destructive
        loading={pendingAction ? busyId === pendingAction.request.out_id : false}
        onConfirm={() => {
          if (pendingAction) void mutate(
            pendingAction.request,
            pendingAction.kind === "cancel" ? "cancelled" : "denied",
          );
        }}
      />
    </Card>
  );
}
