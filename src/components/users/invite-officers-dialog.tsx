"use client";

import { useMemo, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Collapse, MotionPresence } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OfficerInviteState } from "@/lib/officers/contracts";
import type { Committee } from "@/lib/types";

type Row = {
  clientId: string;
  inviteId: string | null;
  authUserId?: string;
  email: string;
  fullName: string;
  role: "Admin" | "Co-Admin";
  committeeId: string | null;
  state?: OfficerInviteState;
  message?: string;
};

const newRow = (clientId: string): Row => ({
  clientId,
  inviteId: null,
  email: "",
  fullName: "",
  role: "Co-Admin",
  committeeId: null,
});

function statusVariant(state: OfficerInviteState) {
  if (state === "failed") return "destructive" as const;
  if (state === "sent") return "outline" as const;
  return "neutral" as const;
}

export function InviteOfficersDialog({
  committees,
}: {
  committees: Committee[];
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([newRow("officer-row-1")]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const unresolved = rows.some(
    (row) => row.state === "unsent" || row.state === "cleanup-pending",
  );
  const retryable = rows.filter(
    (row) => row.state === "unsent" || row.state === "cleanup-pending",
  );
  const hasResults = rows.some((row) => row.state !== undefined);
  const committeeItems = useMemo(
    () => committees.map((item) => ({ value: item.id, label: item.name })),
    [committees],
  );

  function resetAndClose() {
    setOpen(false);
    setRows([newRow("officer-row-1")]);
    setError("");
    setNotice("");
    setConfirmClose(false);
  }

  function requestClose() {
    if (busy) return;
    if (unresolved) {
      setConfirmClose(true);
      return;
    }
    resetAndClose();
  }

  function updateRow(clientId: string, updates: Partial<Row>) {
    setRows((current) =>
      current.map((row) =>
        row.clientId === clientId ? { ...row, ...updates } : row,
      ),
    );
  }

  async function submit(mode: "send" | "retry") {
    const selected = mode === "retry" ? retryable : rows;
    if (selected.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/invite-officers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          invites: selected.map((row) => ({
            clientId: row.clientId,
            inviteId: row.inviteId,
            email: row.email,
            fullName: row.fullName,
            role: row.role,
            committeeId: row.committeeId,
          })),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !body || typeof body !== "object") {
        setError(
          typeof (body as { error?: unknown } | null)?.error === "string"
            ? (body as { error: string }).error
            : "Officer invitations could not be processed.",
        );
        return;
      }
      const payload = body as { results?: unknown; notice?: unknown };
      if (!Array.isArray(payload.results)) {
        setError("Officer invitations could not be processed.");
        return;
      }
      const byId = new Map(
        payload.results
          .filter(
            (item): item is Row =>
              Boolean(
                item &&
                  typeof item === "object" &&
                  typeof (item as Row).clientId === "string" &&
                  typeof (item as Row).state === "string",
              ),
          )
          .map((item) => [item.clientId, item]),
      );
      setRows((current) =>
        current.map((row) => byId.get(row.clientId) ?? row),
      );
      setNotice(typeof payload.notice === "string" ? payload.notice : "");
      window.dispatchEvent(new Event("officer-invites-changed"));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setOpen(true);
          else requestClose();
        }}
      >
        <DialogTrigger render={<Button size="lg" variant="outline" />}>
          <ShieldCheck aria-hidden />
          Invite officers
        </DialogTrigger>
        <DialogContent
          className={!open ? "pointer-events-none max-w-3xl" : "max-w-3xl"}
          aria-hidden={!open || undefined}
          inert={!open ? true : undefined}
        >
          <DialogHeader>
            <DialogTitle>Invite officers</DialogTitle>
            <DialogDescription>
              Invite 1–10 Admins or committee Co-Admins. Emails are sent one at a time.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((row, index) => {
              const prefix = `officer-${row.clientId}`;
              return (
                <section
                  key={row.clientId}
                  className="motion-card-interaction grid gap-2 rounded-xl border border-border bg-card p-3 motion-reduce:transform-none"
                  aria-label={`Officer ${index + 1}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Officer {index + 1}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove officer ${index + 1}`}
                      disabled={busy || hasResults || rows.length === 1}
                      onClick={() =>
                        setRows((current) =>
                          current.filter((item) => item.clientId !== row.clientId),
                        )
                      }
                      className="size-11 md:size-9"
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <label className="text-xs font-medium" htmlFor={`${prefix}-name`}>
                        Full name
                      </label>
                      <Input
                        id={`${prefix}-name`}
                        value={row.fullName}
                        disabled={busy || row.state === "sent"}
                        onChange={(event) =>
                          updateRow(row.clientId, { fullName: event.target.value })
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <label className="text-xs font-medium" htmlFor={`${prefix}-email`}>
                        Email
                      </label>
                      <Input
                        id={`${prefix}-email`}
                        type="email"
                        value={row.email}
                        disabled={busy || row.state === "sent"}
                        onChange={(event) =>
                          updateRow(row.clientId, { email: event.target.value })
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <label className="text-xs font-medium" htmlFor={`${prefix}-role`}>
                        Role
                      </label>
                      <Select
                        items={[
                          { value: "Admin", label: "Admin" },
                          { value: "Co-Admin", label: "Co-Admin" },
                        ]}
                        value={row.role}
                        disabled={busy || row.state === "sent"}
                        onValueChange={(value) =>
                          updateRow(row.clientId, {
                            role: value === "Admin" ? "Admin" : "Co-Admin",
                            committeeId: value === "Admin" ? null : row.committeeId,
                          })
                        }
                      >
                        <SelectTrigger id={`${prefix}-role`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Admin">Admin</SelectItem>
                          <SelectItem value="Co-Admin">Co-Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Collapse open={row.role === "Co-Admin"} className="grid gap-1">
                      <label className="text-xs font-medium" htmlFor={`${prefix}-committee`}>
                        Committee
                      </label>
                      <Select
                        items={committeeItems}
                        value={row.committeeId}
                        disabled={busy || row.state === "sent"}
                        onValueChange={(value) =>
                          updateRow(row.clientId, { committeeId: value })
                        }
                      >
                        <SelectTrigger id={`${prefix}-committee`}>
                          <SelectValue placeholder="Select a committee" />
                        </SelectTrigger>
                        <SelectContent>
                          {committeeItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Collapse>
                  </div>
                  {row.state ? (
                    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                      <Badge variant={statusVariant(row.state)}>
                        {row.state.replace("-", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{row.message}</span>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>

          <MotionPresence open={Boolean(error || notice)}>
            {error || notice ? (
              <p
                role={error ? "alert" : "status"}
                className={
                  error
                    ? "rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    : "rounded-xl bg-muted px-3 py-2 text-sm text-accent-foreground"
                }
              >
                {error || notice}
              </p>
            ) : null}
          </MotionPresence>

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={busy || hasResults || rows.length >= 10}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  newRow(`officer-row-${crypto.randomUUID()}`),
                ])
              }
            >
              <Plus aria-hidden />
              Add officer
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              {retryable.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void submit("retry")}
                >
                  {busy ? "Retrying…" : "Retry unsent"}
                </Button>
              ) : null}
              {!hasResults ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void submit("send")}
                >
                  {busy ? "Sending…" : "Send invitations"}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close with unfinished invitations?"
        description="Unsent or cleanup-pending results will be cleared from this dialog. You can still reconcile stored pending invitations from User management."
        confirmLabel="Close dialog"
        destructive
        onConfirm={resetAndClose}
      />
    </>
  );
}
