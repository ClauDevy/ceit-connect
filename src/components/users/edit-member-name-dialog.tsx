"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { Member } from "@/lib/types";

export function EditMemberNameDialog({
  member,
  onClose,
  onSaved,
}: {
  member: Member | null;
  onClose: () => void;
  onSaved: (fullName: string) => void;
}) {
  const [fullName, setFullName] = useState(member?.full_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!member) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/update-member-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, fullName }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        typeof (body as { fullName?: unknown }).fullName !== "string"
      ) {
        setError(
          body &&
            typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "The Member name could not be updated.",
        );
        return;
      }
      onSaved((body as { fullName: string }).fullName);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Member name</DialogTitle>
          <DialogDescription>
            This changes only the Member&apos;s full name. Their email, role, and
            committee stay the same.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <FormField label="Full name">
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                required
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            )}
          </FormField>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save name"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
