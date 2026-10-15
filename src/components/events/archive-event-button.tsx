"use client";

import { useState } from "react";
import { Archive } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";

type ArchiveEventButtonProps = {
  eventId: string;
  eventName: string;
  incompleteTaskCount: number;
};

export function ArchiveEventButton({
  eventId,
  eventName,
  incompleteTaskCount,
}: ArchiveEventButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const taskLabel = incompleteTaskCount === 1 ? "task is" : "tasks are";

  async function archiveEvent() {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/archive-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
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
        setError(message);
        return;
      }

      setOpen(false);
      router.push("/archives");
      router.refresh();
    } catch {
      setError("The event could not be archived. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        <Archive aria-hidden />
        Archive
      </Button>
      {error ? (
        <p role="alert" className="max-w-64 text-xs text-destructive">
          {error}
        </p>
      ) : null}
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
    </div>
  );
}
