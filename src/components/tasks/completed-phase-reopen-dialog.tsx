"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  getEffectiveReopenCandidate,
  getPhaseCompletionErrorMessage,
  type ReopenCandidate,
} from "@/lib/tasks/phase-completion";

export function CompletedPhaseReopenDialog({
  phase,
  candidates,
  onRefresh,
  onReopened,
}: {
  phase: string;
  candidates: readonly ReopenCandidate[];
  onRefresh: () => Promise<void>;
  onReopened: (candidate: ReopenCandidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(
    () => Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.title])),
    [candidates],
  );
  const selected = getEffectiveReopenCandidate(candidates, selectedId);
  if (candidates.length === 0) return null;

  async function submit() {
    if (busy) return;
    const currentSelection = getEffectiveReopenCandidate(candidates, selectedId);
    if (!currentSelection) return;
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc(
        "reopen_completed_phase_task",
        {
          p_task_id: currentSelection.id,
          // Exact reader token: intentionally opaque and never parsed as Date.
          p_expected_updated_at: currentSelection.updatedAt,
        },
      );
      if (rpcError) {
        const message = getPhaseCompletionErrorMessage(rpcError) ??
          "This task cannot be reopened.";
        try { await onRefresh(); } catch { /* fixed error still shown */ }
        setError(message);
        return;
      }
      await onRefresh();
      setOpen(false);
      onReopened(currentSelection);
    } catch {
      try { await onRefresh(); } catch { /* never leave the dialog hanging */ }
      setError("This task cannot be reopened.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
      <RotateCcw /> Reopen
    </Button>
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen {phase}</DialogTitle>
          <DialogDescription>
            Choose one completed task to return to In Progress.
          </DialogDescription>
        </DialogHeader>
        <Select items={items} value={selected?.id ?? null} onValueChange={(value) => value && setSelectedId(value)}>
          <SelectTrigger aria-label="Task to reopen"><SelectValue /></SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.title}</SelectItem>)}
          </SelectContent>
        </Select>
        {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={busy || !selected} onClick={submit}>
            {busy ? "Reopening…" : "Reopen task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
