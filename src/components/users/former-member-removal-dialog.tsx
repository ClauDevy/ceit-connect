"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import {
  expectedFormerMemberConfirmation,
  parseFormerMemberPreviewPayload,
  parseFormerMemberRemovalPayload,
  type FormerMemberPreview,
  type FormerMemberRemovalResult,
} from "@/lib/users/former-member-removal";

const PREVIEW_TIMEOUT_MS = 20_000;
const REMOVAL_TIMEOUT_MS = 65_000;

type RemovalRequest = {
  key: number;
  origin: "remove" | "rerun-cleanup" | "result-retry";
  userIds: string[];
};

type Phase =
  | "preview-loading"
  | "preview-error"
  | "confirm"
  | "running"
  | "results"
  | "unknown";

export function FormerMemberRemovalDialog({
  request,
  onClose,
  onRefresh,
  onStartRetry,
  onShowRemovedMembers,
  refreshInFlight,
}: {
  request: RemovalRequest | null;
  onClose: () => void;
  onRefresh: () => Promise<boolean>;
  onStartRetry: (userIds: string[]) => void;
  onShowRemovedMembers: () => Promise<boolean>;
  refreshInFlight: boolean;
}) {
  const snapshot = useMemo(() => request?.userIds ?? [], [request]);
  const [phase, setPhase] = useState<Phase>("preview-loading");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [preview, setPreview] = useState<FormerMemberPreview[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [results, setResults] = useState<FormerMemberRemovalResult[]>([]);
  const [runBusy, setRunBusy] = useState(false);
  const [showRemovedBusy, setShowRemovedBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PREVIEW_TIMEOUT_MS);

    void (async () => {
      try {
        const response = await fetch("/api/remove-former-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "preview", userIds: snapshot }),
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setError(
            readSafeError(body, "The removal preview could not be loaded."),
          );
          setPhase("preview-error");
          return;
        }
        const parsed = parseFormerMemberPreviewPayload(body, snapshot);
        if (!parsed) {
          setError(
            "The removal preview returned an invalid response. Retry the preview.",
          );
          setPhase("preview-error");
          return;
        }
        setPreview(parsed.users);
        setPhase("confirm");
      } catch {
        if (controller.signal.aborted && !timedOut) return;
        setError(
          timedOut
            ? "The preview timed out. No removal was started. Retry the preview."
            : "The preview could not be reached. Check your connection and retry.",
        );
        setPhase("preview-error");
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [previewAttempt, request, snapshot]);

  const expectedConfirmation = expectedFormerMemberConfirmation(
    snapshot.length,
  );
  const summary = useMemo(() => summarizeResults(results), [results]);
  const incompleteIds = results
    .filter(
      (result) =>
        result.state === "failed" || result.state === "cleanup-pending",
    )
    .map((result) => result.userId);

  async function runRemoval() {
    if (confirmation !== expectedConfirmation || runBusy) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REMOVAL_TIMEOUT_MS);

    setRunBusy(true);
    setPhase("running");
    setError("");
    setRefreshError("");
    try {
      const response = await fetch("/api/remove-former-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          userIds: snapshot,
          confirmation,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      const responseDisposition = classifyRemovalResponse(response, body);
      if (responseDisposition === "unknown") {
        setPhase("unknown");
        return;
      }
      if (responseDisposition === "error") {
        setError(
          readSafeError(
            body,
            "Removal could not be started. Preview again and retry.",
          ),
        );
        setPhase("confirm");
        return;
      }
      const parsed = parseFormerMemberRemovalPayload(body, snapshot);
      if (!parsed) {
        setPhase("unknown");
        return;
      }
      setResults(parsed.results);
      setPhase("results");
    } catch {
      if (controller.signal.aborted && !timedOut) return;
      setPhase("unknown");
    } finally {
      window.clearTimeout(timeout);
      try {
        const refreshed = await onRefresh();
        if (!refreshed) {
          setRefreshError(
            "The Deactivated list could not be refreshed. Refresh the page before retrying cleanup.",
          );
        }
      } catch {
        setRefreshError(
          "The Deactivated list could not be refreshed. Refresh the page before retrying cleanup.",
        );
      } finally {
        setRunBusy(false);
      }
    }
  }

  function retryPreview() {
    setPhase("preview-loading");
    setPreview([]);
    setConfirmation("");
    setError("");
    setRefreshError("");
    setResults([]);
    setPreviewAttempt((value) => value + 1);
  }

  async function showRemovedMembers() {
    if (showRemovedBusy || refreshInFlight) return;
    setShowRemovedBusy(true);
    setRefreshError("");
    try {
      const shown = await onShowRemovedMembers();
      if (!shown) {
        setRefreshError(
          "The Deactivated list could not be refreshed. Try showing removed members again.",
        );
      }
    } finally {
      setShowRemovedBusy(false);
    }
  }

  const busy =
    phase === "preview-loading" ||
    phase === "running" ||
    runBusy ||
    showRemovedBusy;
  const announcement =
    phase === "preview-loading"
      ? "Loading removal preview."
      : phase === "running"
        ? `Removing ${snapshot.length} ${snapshot.length === 1 ? "account" : "accounts"}.`
        : phase === "results"
          ? `${summary.removed} removed, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.cleanupPending} cleanup pending.`
          : phase === "unknown"
            ? "Removal outcome unknown. The Deactivated list was refreshed."
            : "";

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={!busy} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Remove former {snapshot.length === 1 ? "member" : "members"}
          </DialogTitle>
          <DialogDescription>
            Accounts are anonymized in place. Historical work and UUID
            references remain.
          </DialogDescription>
        </DialogHeader>

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {phase === "preview-loading" ? (
          <p
            role="status"
            className="py-5 text-center text-sm text-muted-foreground"
          >
            Loading authoritative preview…
          </p>
        ) : null}

        {phase === "preview-error" ? (
          <>
            <InlineAlert>{error}</InlineAlert>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={retryPreview}>
                Retry preview
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {(phase === "confirm" || phase === "running") && preview.length > 0 ? (
          <>
            <PreviewList users={preview} />
            {request?.origin === "rerun-cleanup" ? (
              <p className="text-sm text-muted-foreground">
                This re-runs Auth, Google sign-in, and photo cleanup for a
                removal that stopped halfway.
              </p>
            ) : null}
            {error ? <InlineAlert>{error}</InlineAlert> : null}
            <div className="grid gap-2 border-t pt-4">
              <label
                htmlFor="former-member-confirmation"
                className="text-sm font-medium"
              >
                Type <span className="font-mono">{expectedConfirmation}</span>{" "}
                to continue
              </label>
              <Input
                id="former-member-confirmation"
                value={confirmation}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || confirmation !== expectedConfirmation}
                onClick={() => void runRemoval()}
              >
                {phase === "running" ? "Removing…" : "Remove former members"}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {phase === "unknown" ? (
          <>
            <InlineAlert>
              Outcome unknown. The request ended after some accounts may have
              completed. The Deactivated list was refreshed; show removed
              members and use Re-run cleanup on marked rows.
            </InlineAlert>
            {refreshError ? <InlineAlert>{refreshError}</InlineAlert> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={showRemovedBusy}
                onClick={onClose}
              >
                Close
              </Button>
              <Button
                type="button"
                disabled={showRemovedBusy || refreshInFlight}
                onClick={() => void showRemovedMembers()}
              >
                {showRemovedBusy ? "Refreshing…" : "Show removed members"}
              </Button>
            </DialogFooter>
          </>
        ) : null}

        {phase === "results" ? (
          <>
            <div className="flex flex-wrap gap-2" aria-label="Removal summary">
              <Badge variant="success">{summary.removed} removed</Badge>
              <Badge variant="neutral">{summary.skipped} skipped</Badge>
              <Badge variant="destructive">{summary.failed} failed</Badge>
              <Badge variant="outline">
                {summary.cleanupPending} cleanup pending
              </Badge>
            </div>
            {refreshError ? <InlineAlert>{refreshError}</InlineAlert> : null}
            <ol className="divide-y border-y">
              {results.map((result, index) => {
                const identity = preview[index];
                const retryable =
                  result.state === "failed" ||
                  result.state === "cleanup-pending";
                return (
                  <li
                    key={result.userId}
                    className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {identity?.fullName ?? result.userId}
                        </p>
                        <ResultBadge state={result.state} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {result.message}
                      </p>
                    </div>
                    {retryable ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onStartRetry([result.userId])}
                      >
                        Retry cleanup
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              {incompleteIds.length > 0 ? (
                <Button
                  type="button"
                  onClick={() => onStartRetry(incompleteIds)}
                >
                  Retry incomplete
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PreviewList({ users }: { users: FormerMemberPreview[] }) {
  return (
    <ol className="max-h-72 divide-y overflow-y-auto border-y">
      {users.map((user) => (
        <li
          key={user.userId}
          className="flex items-start justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {user.fullName ?? user.userId}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email ?? "Account unavailable"}
            </p>
          </div>
          <PreviewBadge user={user} />
        </li>
      ))}
    </ol>
  );
}

function PreviewBadge({ user }: { user: FormerMemberPreview }) {
  if (user.outcome === "eligible")
    return <Badge variant="success">Eligible</Badge>;
  if (user.outcome === "already_anonymized") {
    return <Badge variant="outline">Cleanup retry</Badge>;
  }
  if (user.reasonCode === "open_tasks") {
    return (
      <Badge variant="neutral">
        {user.openTaskCount} open {user.openTaskCount === 1 ? "task" : "tasks"}{" "}
        — skipped
      </Badge>
    );
  }
  return <Badge variant="neutral">Unavailable</Badge>;
}

function ResultBadge({ state }: { state: FormerMemberRemovalResult["state"] }) {
  if (state === "removed") return <Badge variant="success">Removed</Badge>;
  if (state === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (state === "cleanup-pending")
    return <Badge variant="outline">Cleanup pending</Badge>;
  return <Badge variant="neutral">Skipped</Badge>;
}

function summarizeResults(results: readonly FormerMemberRemovalResult[]) {
  return results.reduce(
    (summary, result) => {
      if (result.state === "cleanup-pending") summary.cleanupPending += 1;
      else summary[result.state] += 1;
      return summary;
    },
    { removed: 0, skipped: 0, failed: 0, cleanupPending: 0 },
  );
}

function readSafeError(value: unknown, fallback: string) {
  return value &&
    typeof value === "object" &&
    typeof (value as { error?: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function classifyRemovalResponse(
  response: Pick<Response, "ok" | "status">,
  body: unknown,
) {
  if (response.status >= 500 || body === null) return "unknown" as const;
  return response.ok ? ("success" as const) : ("error" as const);
}

export {
  PREVIEW_TIMEOUT_MS,
  REMOVAL_TIMEOUT_MS,
  classifyRemovalResponse,
};
export type { RemovalRequest };
