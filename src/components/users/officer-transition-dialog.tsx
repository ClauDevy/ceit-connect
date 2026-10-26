"use client";

import { useState } from "react";
import type { MemberActionName } from "@/components/users/member-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Committee, Member } from "@/lib/types";

type TransitionAction = Exclude<
  MemberActionName,
  "toggle" | "cancel-invite" | "edit-name"
>;

const TITLES: Record<TransitionAction, string> = {
  appoint: "Appoint officer",
  "return-to-member": "Return to Member",
  "move-committee": "Move committee",
  "step-down": "Step down to Member",
};

export function OfficerTransitionDialog({
  action,
  member,
  committees,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  action: TransitionAction | null;
  member: Member | null;
  committees: Committee[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (details: {
    role?: "Admin" | "Co-Admin";
    committeeId: string | null;
  }) => void;
}) {
  const [role, setRole] = useState<"Admin" | "Co-Admin">("Co-Admin");
  const [committeeId, setCommitteeId] = useState<string | null>(
    member?.committee_id ?? null,
  );

  const needsCommittee = action !== "appoint" || role === "Co-Admin";
  const invalid = needsCommittee && !committeeId;

  return (
    <Dialog
      open={action !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action ? TITLES[action] : "Officer action"}</DialogTitle>
          <DialogDescription>
            {action === "step-down"
              ? "You will become a Member and leave User management. Another confirmed active Admin must remain."
              : `Confirm the new role or committee for ${member?.full_name ?? "this user"}.`}
          </DialogDescription>
        </DialogHeader>

        {action === "appoint" ? (
          <div className="grid gap-1.5">
            <label htmlFor="transition-role" className="text-sm font-medium">
              Officer role
            </label>
            <Select
              items={[
                { value: "Admin", label: "Admin" },
                { value: "Co-Admin", label: "Co-Admin" },
              ]}
              value={role}
              onValueChange={(value) => {
                const next = value === "Admin" ? "Admin" : "Co-Admin";
                setRole(next);
                if (next === "Admin") setCommitteeId(null);
              }}
            >
              <SelectTrigger id="transition-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Admin">Admin</SelectItem>
                <SelectItem value="Co-Admin">Co-Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {needsCommittee ? (
          <div className="grid gap-1.5">
            <label htmlFor="transition-committee" className="text-sm font-medium">
              Member committee
            </label>
            <Select
              items={committees.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              value={committeeId}
              onValueChange={setCommitteeId}
            >
              <SelectTrigger id="transition-committee">
                <SelectValue placeholder="Select a committee" />
              </SelectTrigger>
              <SelectContent>
                {committees.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={action === "step-down" || action === "return-to-member" ? "destructive" : "default"}
            disabled={busy || invalid}
            onClick={() =>
              onSubmit({
                role: action === "appoint" ? role : undefined,
                committeeId: needsCommittee ? committeeId : null,
              })
            }
          >
            {busy ? "Working…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
