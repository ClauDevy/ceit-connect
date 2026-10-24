"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TaskBackupState } from "@/lib/tasks/backup";

export type BackupBusyAction =
  "toggle-backup" | "volunteer" | "withdraw" | `accept:${string}` | null;

type TaskBackupControlProps = {
  state: TaskBackupState;
  busyAction: BackupBusyAction;
  onToggle: (nextState: boolean) => Promise<void>;
  onVolunteer: () => Promise<void>;
  onWithdraw: () => Promise<void>;
  onAccept: (userId: string) => Promise<void>;
};

export function TaskBackupToggle({
  state,
  busyAction,
  onToggle,
}: Pick<TaskBackupControlProps, "state" | "busyAction" | "onToggle">) {
  if (!state.out_can_toggle_backup) return null;

  const busy = busyAction !== null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() => void onToggle(!state.out_request_backup)}
    >
      {busyAction === "toggle-backup" ? (
        <LoaderCircle className="animate-spin" aria-hidden />
      ) : (
        <TriangleAlert aria-hidden />
      )}
      {state.out_request_backup ? "Cancel Backup" : "Request Backup"}
    </Button>
  );
}

export function TaskBackupRequestedCard({
  state,
  busyAction,
  onVolunteer,
  onWithdraw,
  onAccept,
}: Omit<TaskBackupControlProps, "onToggle">) {
  if (!state.out_request_backup) return null;

  const busy = busyAction !== null;

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
        <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
          <TriangleAlert className="size-4" aria-hidden /> Backup Requested
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
        {state.out_can_accept ? (
          state.out_volunteers.length > 0 ? (
            <div className="space-y-3">
              {state.out_volunteers.map((volunteer) => {
                const name = volunteer.full_name?.trim() || "Member";
                const accepting = busyAction === `accept:${volunteer.id}`;
                return (
                  <div
                    key={volunteer.id}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar
                        name={name}
                        src={volunteer.avatar_url}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{name}</p>
                        <p className="text-xs text-muted-foreground">Pending</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onAccept(volunteer.id)}
                    >
                      {accepting ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : null}
                      Accept
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No volunteers yet.</p>
          )
        ) : state.out_has_volunteered ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your volunteer offer is pending.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={() => void onWithdraw()}
            >
              {busyAction === "withdraw" ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : null}
              Withdraw offer
            </Button>
          </div>
        ) : state.out_can_volunteer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={busy}
            onClick={() => void onVolunteer()}
          >
            {busyAction === "volunteer" ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : null}
            Volunteer to help
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            This task is looking for backup.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
