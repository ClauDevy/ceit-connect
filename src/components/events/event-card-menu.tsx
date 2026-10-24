"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Ellipsis, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type EventCardMenuProps = {
  eventId: string;
  eventName: string;
  canEdit: boolean;
  canArchive: boolean;
  incompleteTaskCount?: number;
  eventUpdatedAt: string;
};

export function EventCardMenu({
  eventId,
  eventName,
  canEdit,
  canArchive,
  incompleteTaskCount,
  eventUpdatedAt,
}: EventCardMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const archiveAvailable = canArchive && incompleteTaskCount !== undefined;

  if (!canEdit && !archiveAvailable) return null;

  const taskLabel = incompleteTaskCount === 1 ? "task is" : "tasks are";

  async function archiveEvent() {
    if (incompleteTaskCount === undefined) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/archive-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          expectedIncompleteTaskCount: incompleteTaskCount,
          // This is the original database string. Do not round-trip it through Date.
          expectedUpdatedAt: eventUpdatedAt,
        }),
      });
      const result: unknown = await response.json();
      const message =
        typeof result === "object" &&
        result !== null &&
        "error" in result &&
        typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : "The event could not be archived.";

      if (!response.ok) {
        setOpen(false);
        setError(message);
        return;
      }

      setOpen(false);
      router.push("/archives");
      router.refresh();
    } catch {
      setError(
        "The event could not be archived. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="absolute top-3 right-3 z-20 grid justify-items-end gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${eventName}`}
          disabled={loading}
          className="inline-flex size-11 items-center justify-center rounded-xl border border-border/80 bg-popover/95 text-popover-foreground shadow-md outline-none backdrop-blur-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 md:size-9"
        >
          <Ellipsis aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={`Actions for ${eventName}`}>
          {canEdit ? (
            <DropdownMenuLinkItem
              render={<Link href={`/events/${eventId}/edit`} />}
              closeOnClick
            >
              <Pencil aria-hidden className="size-4" />
              Edit event
            </DropdownMenuLinkItem>
          ) : null}
          {archiveAvailable ? (
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
              onClick={() => {
                setError("");
                setOpen(true);
              }}
            >
              <Archive aria-hidden className="size-4" />
              Archive event
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <p
          role="alert"
          className="max-w-64 rounded-lg border border-destructive/30 bg-popover p-2 text-right text-xs text-destructive shadow-md"
        >
          {error}
        </p>
      ) : null}
      {archiveAvailable ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={`Archive ${eventName}?`}
          description={`${incompleteTaskCount} ${taskLabel} not completed and will be frozen as they are. Archiving is permanent and cannot be undone.`}
          confirmLabel="Archive event"
          destructive
          loading={loading}
          onConfirm={archiveEvent}
        />
      ) : null}
    </div>
  );
}
