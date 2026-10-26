"use client";

import { useMemo, useState } from "react";
import { Ellipsis, MailX } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PendingOfficerInvite } from "@/lib/types";

export function PendingOfficerInvites({
  invites,
  visibleAuthUserIds,
  loading,
  error,
  onRetry,
  onCancelled,
}: {
  invites: PendingOfficerInvite[];
  visibleAuthUserIds: ReadonlySet<string>;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onCancelled: () => Promise<void>;
}) {
  const [target, setTarget] = useState<PendingOfficerInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const standalone = useMemo(
    () =>
      invites.filter(
        (invite) =>
          invite.auth_user_id === null ||
          !visibleAuthUserIds.has(invite.auth_user_id),
      ),
    [invites, visibleAuthUserIds],
  );

  async function cancel() {
    if (!target) return;
    setBusy(true);
    setCancelError("");
    try {
      const response = await fetch("/api/invite-officers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", inviteId: target.id }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setCancelError(
          body &&
            typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "The invitation could not be cancelled.",
        );
        return;
      }
      setTarget(null);
      await onCancelled();
    } catch {
      setCancelError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!error && standalone.length === 0 && !loading) return null;

  return (
    <section className="grid gap-2" aria-labelledby="pending-officer-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="pending-officer-heading" className="font-display font-semibold">
            Pending officer invitations
          </h2>
          <p className="text-xs text-muted-foreground">
            Invitations without a visible roster row are listed here.
          </p>
        </div>
        {error ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
      <Card className="divide-y overflow-hidden rounded-xl">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground" role="status">
            Loading pending invitations…
          </p>
        ) : error ? (
          <p className="p-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          standalone.map((invite) => (
            <div
              key={invite.id}
              className="motion-card-interaction flex items-center gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{invite.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {invite.email}
                </p>
              </div>
              <Badge variant={invite.cleanup_pending ? "destructive" : "neutral"}>
                {invite.cleanup_pending ? "Cleanup pending" : "Invitation pending"}
              </Badge>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`More actions for ${invite.full_name}`}
                  className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none md:size-9"
                >
                  <Ellipsis aria-hidden className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                    onClick={() => setTarget(invite)}
                  >
                    <MailX aria-hidden />
                    Cancel invitation
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </Card>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !busy) {
            setTarget(null);
            setCancelError("");
          }
        }}
        title={`Cancel ${target?.full_name ?? "this invitation"}?`}
        description="Their profile will be deactivated and login blocked. Their account will not be deleted."
        confirmLabel={cancelError ? "Retry cancellation" : "Cancel invitation"}
        destructive
        loading={busy}
        error={cancelError}
        onConfirm={() => void cancel()}
      />
    </section>
  );
}
