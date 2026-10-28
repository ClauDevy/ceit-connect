"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { TabPanel, useListReveal } from "@/components/shared/motion";
import { MembersCards } from "@/components/users/members-cards";
import { MembersTable } from "@/components/users/members-table";
import { type MemberActionName } from "@/components/users/member-actions";
import { OfficerTransitionDialog } from "@/components/users/officer-transition-dialog";
import { EditMemberNameDialog } from "@/components/users/edit-member-name-dialog";
import {
  FormerMemberRemovalDialog,
  type RemovalRequest,
} from "@/components/users/former-member-removal-dialog";
import { PendingOfficerInvites } from "@/components/users/pending-officer-invites";
import { useToggleMemberActive } from "@/components/users/use-toggle-member-active";
import { UsersRosterSkeleton } from "@/components/users/users-roster-skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconInput } from "@/components/ui/icon-input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOffsetListPaging } from "@/hooks/use-offset-list-paging";
import type { OffsetListPage } from "@/lib/list-paging";
import { preventSearchFormSubmission } from "@/lib/search";
import type { Committee, Member, Role } from "@/lib/types";
import type { PendingOfficerInvite } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import {
  getSelectableFormerMemberIds,
  toggleVisibleFormerMemberSelection,
  updateFormerMemberSelection,
} from "@/lib/users/former-member-selection";
import {
  countRemovedMembers,
  getVisibleMembers,
  isUsersSearchDebouncing,
} from "@/lib/users/former-member-visibility";
import {
  isMember,
  truncateUsersSearch,
  type UsersStatus,
} from "@/lib/users/list-users";

type UsersTableProps = {
  initialPage: OffsetListPage<Member>;
  committees: Committee[];
  currentUserId: string;
  initialPendingInvites: PendingOfficerInvite[];
  initialPendingError: boolean;
  viewerRole: Extract<Role, "Admin" | "Co-Admin">;
};

const TABS = [
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Deactivated" },
] as const;

export function UsersTable({
  initialPage,
  committees,
  currentUserId,
  initialPendingInvites,
  initialPendingError,
  viewerRole,
}: UsersTableProps) {
  const router = useRouter();
  const supabase = useMemo(
    () => (viewerRole === "Admin" ? createClient() : null),
    [viewerRole],
  );
  const [status, setStatus] = useState<UsersStatus>("active");
  const [tabMotionKey, setTabMotionKey] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Member | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(
    {},
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMessage, setSelectionMessage] = useState("");
  const [showRemovedMembers, setShowRemovedMembers] = useState(false);
  const [forceRosterSkeleton, setForceRosterSkeleton] = useState(false);
  const [removalRequest, setRemovalRequest] = useState<RemovalRequest | null>(
    null,
  );
  const removalRequestKey = useRef(0);
  const unknownRevealPromise = useRef<Promise<boolean> | null>(null);
  const [cancelInviteTarget, setCancelInviteTarget] = useState<Member | null>(
    null,
  );
  const [cancelInviteError, setCancelInviteError] = useState("");
  const [cancelInviteBusy, setCancelInviteBusy] = useState(false);
  const [transitionAction, setTransitionAction] = useState<Exclude<
    MemberActionName,
    | "toggle"
    | "cancel-invite"
    | "edit-name"
    | "remove-former-member"
    | "retry-former-member-cleanup"
  > | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<Member | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionError, setTransitionError] = useState("");
  const [pendingInvites, setPendingInvites] = useState(initialPendingInvites);
  const [pendingInvitesError, setPendingInvitesError] = useState(
    initialPendingError ? "Pending invitations could not be loaded." : "",
  );
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      const params = new URLSearchParams({
        offset: String(offset),
        search,
        status,
      });
      const response = await fetch(`/api/users?${params}`, {
        cache: "no-store",
        signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !body ||
        typeof body !== "object" ||
        !Array.isArray((body as { users?: unknown }).users) ||
        !(body as { users: unknown[] }).users.every(isMember)
      ) {
        throw new Error("Users could not be loaded");
      }
      return (body as { users: Member[] }).users;
    },
    [search, status],
  );

  const paging = useOffsetListPaging({
    active: true,
    fetchPage,
    getId: (member: Member) => member.id,
    identity: `${status}:${search}`,
    initialPage,
    paused: false,
    singularLabel: "user",
    pluralLabel: "users",
  });
  const refreshUsers = paging.refreshFromStart;

  const refreshPendingInvites = useCallback(async () => {
    if (!supabase) return;
    setPendingInvitesLoading(true);
    const { data, error } = await supabase.rpc("list_pending_officer_invites");
    if (error) {
      setPendingInvitesError("Pending invitations could not be loaded.");
    } else {
      setPendingInvites((data ?? []) as PendingOfficerInvite[]);
      setPendingInvitesError("");
    }
    setPendingInvitesLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (viewerRole !== "Admin") return;
    const refresh = () => {
      void refreshPendingInvites();
      void refreshUsers();
    };
    window.addEventListener("officer-invites-changed", refresh);
    return () => window.removeEventListener("officer-invites-changed", refresh);
  }, [refreshPendingInvites, refreshUsers, viewerRole]);

  useEffect(() => {
    const refresh = () => {
      if (status === "active") void refreshUsers();
      else {
        setStatus("active");
        setTabMotionKey((current) => current + 1);
      }
    };
    window.addEventListener("member-users-changed", refresh);
    return () => window.removeEventListener("member-users-changed", refresh);
  }, [refreshUsers, status]);
  const toggle = useToggleMemberActive(async () => {
    await paging.refreshFromStart();
  });
  const reveal = useListReveal({
    initialItems: initialPage.items,
    items: paging.items,
    settled: paging.settled,
    error: paging.error,
    getId: (member: Member) => member.id,
  });

  const committeeNames = useMemo(
    () =>
      new Map(committees.map((committee) => [committee.id, committee.name])),
    [committees],
  );
  const committeeName = (id: string | null) =>
    (id ? committeeNames.get(id) : null) ?? "—";
  const reactivating = target ? !target.is_active : false;

  function openRemoval(
    userIds: string[],
    origin: RemovalRequest["origin"] = "remove",
  ) {
    removalRequestKey.current += 1;
    setRemovalRequest({
      key: removalRequestKey.current,
      origin,
      userIds: [...userIds],
    });
  }

  async function confirmToggle() {
    if (!target) return;
    const ok = await toggle.setActive(target, reactivating);
    if (ok) setConfirmOpen(false);
  }

  function handleAction(action: MemberActionName, member: Member) {
    if (action === "toggle") {
      setTarget(member);
      setConfirmOpen(true);
    } else if (action === "cancel-invite") {
      setCancelInviteTarget(member);
      setCancelInviteError("");
    } else if (action === "edit-name") {
      setEditTarget(member);
    } else if (
      action === "remove-former-member" ||
      action === "retry-former-member-cleanup"
    ) {
      openRemoval(
        [member.id],
        action === "retry-former-member-cleanup" ? "rerun-cleanup" : "remove",
      );
    } else {
      setTransitionTarget(member);
      setTransitionAction(action);
      setTransitionError("");
    }
  }

  async function cancelRosterInvitation() {
    if (!cancelInviteTarget) return;
    const invitation = pendingInvites.find(
      (item) => item.auth_user_id === cancelInviteTarget.id,
    );
    if (!invitation) {
      setCancelInviteError(
        "The pending invitation changed. Refresh and try again.",
      );
      return;
    }
    setCancelInviteBusy(true);
    setCancelInviteError("");
    try {
      const response = await fetch("/api/invite-officers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", inviteId: invitation.id }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setCancelInviteError(
          body &&
            typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "The invitation could not be cancelled.",
        );
        return;
      }
      setCancelInviteTarget(null);
      await Promise.all([refreshPendingInvites(), paging.refreshFromStart()]);
    } catch {
      setCancelInviteError("Network error. Try again.");
    } finally {
      setCancelInviteBusy(false);
    }
  }

  async function submitTransition(details: {
    role?: "Admin" | "Co-Admin";
    committeeId: string | null;
  }) {
    if (!transitionAction || !transitionTarget) return;
    setTransitionBusy(true);
    setTransitionError("");
    const requestBody =
      transitionAction === "appoint"
        ? {
            action: transitionAction,
            userId: transitionTarget.id,
            role: details.role,
            committeeId: details.committeeId,
          }
        : transitionAction === "step-down"
          ? { action: transitionAction, committeeId: details.committeeId }
          : {
              action: transitionAction,
              userId: transitionTarget.id,
              committeeId: details.committeeId,
            };
    try {
      const response = await fetch("/api/officer-transitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setTransitionError(
          body &&
            typeof body === "object" &&
            typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : "The officer action could not be completed.",
        );
        return;
      }
      if (transitionAction === "step-down") {
        router.replace("/home");
        router.refresh();
        return;
      }
      setTransitionAction(null);
      setTransitionTarget(null);
      await paging.refreshFromStart();
    } catch {
      setTransitionError("Network error. Try again.");
    } finally {
      setTransitionBusy(false);
    }
  }

  function selectTab(nextStatus: UsersStatus) {
    if (nextStatus === status) return;
    setSelectedIds(new Set());
    setSelectionMessage("");
    setStatus(nextStatus);
    setTabMotionKey((current) => current + 1);
  }

  const loadedMembers = paging.items.map((member) => ({
    ...member,
    full_name: nameOverrides[member.id] ?? member.full_name,
  }));
  const removedLoadedCount =
    status === "deactivated" ? countRemovedMembers(loadedMembers) : 0;
  const displayedMembers =
    status === "deactivated" && !showRemovedMembers
      ? getVisibleMembers(loadedMembers, false)
      : loadedMembers;
  const searchDebouncing = isUsersSearchDebouncing(query, search);
  const rosterLoading =
    paging.isIdentityLoading || searchDebouncing || forceRosterSkeleton;
  const selectionEnabled = viewerRole === "Admin" && status === "deactivated";
  const visibleSelectableIds = selectionEnabled
    ? getSelectableFormerMemberIds(displayedMembers)
    : [];
  const visibleSelectableIdSet = new Set(visibleSelectableIds);
  const effectiveSelectedIds = new Set(
    [...selectedIds].filter((id) => visibleSelectableIdSet.has(id)),
  );
  const selectedVisibleCount = visibleSelectableIds.filter((id) =>
    effectiveSelectedIds.has(id),
  ).length;
  const allVisibleSelected =
    visibleSelectableIds.length > 0 &&
    selectedVisibleCount === visibleSelectableIds.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  function applySelectionUpdate(
    update: ReturnType<typeof updateFormerMemberSelection>,
  ) {
    if (!update.ok) {
      setSelectionMessage(update.message);
      return;
    }
    setSelectedIds(update.selectedIds);
    setSelectionMessage(
      update.selectedIds.size === 0
        ? "Selection cleared."
        : `${update.selectedIds.size} ${update.selectedIds.size === 1 ? "account" : "accounts"} selected.`,
    );
  }

  function toggleMemberSelection(member: Member, selected: boolean) {
    if (
      !selectionEnabled ||
      member.role === "Admin" ||
      member.anonymized_at !== null
    )
      return;
    applySelectionUpdate(
      updateFormerMemberSelection(effectiveSelectedIds, member.id, selected),
    );
  }

  function toggleVisibleSelection() {
    applySelectionUpdate(
      toggleVisibleFormerMemberSelection(
        effectiveSelectedIds,
        visibleSelectableIds,
      ),
    );
  }

  const listProps = {
    members: displayedMembers,
    committeeName,
    currentUserId,
    pendingId: toggle.pendingId,
    onAction: handleAction,
    getRevealProps: reveal.getRevealProps,
    pendingInviteByAuthUserId: new Map(
      pendingInvites
        .filter((invite) => invite.auth_user_id)
        .map((invite) => [invite.auth_user_id as string, invite]),
    ),
    viewerRole,
    selectionEnabled,
    selectedIds: effectiveSelectedIds,
    allVisibleSelected,
    someVisibleSelected,
    onToggleSelection: toggleMemberSelection,
    onToggleVisibleSelection: toggleVisibleSelection,
  };

  const statusLabel = status === "active" ? "active" : "deactivated";
  const initialError = paging.error && paging.failedMode === "replace";

  function revealRemovedMembersAfterUnknownOutcome() {
    if (unknownRevealPromise.current) return unknownRevealPromise.current;
    if (paging.isRefreshing || forceRosterSkeleton)
      return Promise.resolve(false);

    setForceRosterSkeleton(true);
    const refresh = paging
      .refreshFromStart()
      .then((refreshed) => {
        if (!refreshed) return false;
        setShowRemovedMembers(true);
        setRemovalRequest(null);
        return true;
      })
      .finally(() => {
        setForceRosterSkeleton(false);
        unknownRevealPromise.current = null;
      });
    unknownRevealPromise.current = refresh;
    return refresh;
  }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      {viewerRole === "Admin" ? (
        <PendingOfficerInvites
          invites={pendingInvites}
          visibleAuthUserIds={new Set(paging.items.map((member) => member.id))}
          loading={pendingInvitesLoading}
          error={pendingInvitesError}
          onRetry={() => void refreshPendingInvites()}
          onCancelled={async () => {
            await Promise.all([
              refreshPendingInvites(),
              paging.refreshFromStart(),
            ]);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SegmentedControl
          aria-label="User status"
          options={TABS}
          value={status}
          onValueChange={selectTab}
          className="w-full sm:w-fit"
        />
        <div className="w-full sm:max-w-sm">
          <IconInput
            icon={Search}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(truncateUsersSearch(event.target.value));
              setSelectedIds(new Set());
              setSelectionMessage("");
            }}
            onKeyDown={preventSearchFormSubmission}
            placeholder="Search name, email, role, committee…"
            aria-label="Search users"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-sm text-muted-foreground"
          aria-live="polite"
          aria-atomic="true"
        >
          {rosterLoading
            ? `Loading ${statusLabel} users.`
            : `${displayedMembers.length} ${statusLabel} ${displayedMembers.length === 1 ? "user" : "users"} loaded`}
          {selectionMessage ? (
            <span className="sr-only"> {selectionMessage}</span>
          ) : null}
        </p>
        {status === "deactivated" ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!showRemovedMembers && removedLoadedCount > 0 ? (
              <span className="text-xs text-muted-foreground">
                {removedLoadedCount} removed hidden
              </span>
            ) : null}
            <label className="motion-control-trigger flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50 active:bg-muted motion-reduce:transition-none">
              <input
                type="checkbox"
                checked={showRemovedMembers}
                className="motion-control-pop size-4 rounded border-input accent-primary"
                onChange={(event) =>
                  setShowRemovedMembers(event.target.checked)
                }
              />
              Show removed members
            </label>
          </div>
        ) : null}
      </div>

      {!rosterLoading && selectionEnabled && displayedMembers.length > 0 ? (
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-y py-2">
          <label className="motion-control-trigger flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50 active:bg-muted motion-reduce:transition-none">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              aria-checked={someVisibleSelected ? "mixed" : allVisibleSelected}
              className="motion-control-pop size-4 rounded border-input accent-primary"
              onChange={toggleVisibleSelection}
            />
            Select all visible
          </label>
          <span className="text-sm text-muted-foreground">
            {selectedVisibleCount} selected
          </span>
          {selectedVisibleCount > 0 ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectionMessage("Selection cleared.");
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="ml-auto"
                onClick={() =>
                  openRemoval(
                    visibleSelectableIds.filter((id) =>
                      effectiveSelectedIds.has(id),
                    ),
                  )
                }
              >
                Remove selected
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {selectionMessage.startsWith("Select no more") ? (
        <InlineAlert>{selectionMessage}</InlineAlert>
      ) : null}

      {toggle.error ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {toggle.error}
        </p>
      ) : null}

      <TabPanel motionKey={tabMotionKey}>
        {rosterLoading ? (
          <UsersRosterSkeleton />
        ) : (
          <Card className="min-w-0 overflow-hidden rounded-xl">
            {initialError ? (
              <EmptyState
                title="Users could not be loaded"
                description="Try the request again."
                action={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void paging.retry()}
                  >
                    Retry
                  </Button>
                }
              />
            ) : paging.items.length === 0 ? (
              <EmptyState
                title={
                  search
                    ? "No users match that search"
                    : `No ${statusLabel} users`
                }
                description={
                  search
                    ? "Try a different name, email, role, or committee."
                    : status === "active"
                      ? "Invite a council member to get started."
                      : "Deactivated accounts will appear here."
                }
              />
            ) : displayedMembers.length === 0 && removedLoadedCount > 0 ? (
              <EmptyState
                title="All loaded members are removed"
                description={
                  paging.hasMore
                    ? "Load more to check later results, or show removed members."
                    : "Turn on Show removed members to view them."
                }
              />
            ) : (
              <>
                <div className="hidden min-w-0 lg:block">
                  <MembersTable {...listProps} />
                </div>
                <div className="lg:hidden">
                  <MembersCards {...listProps} />
                </div>
              </>
            )}
          </Card>
        )}
      </TabPanel>

      <LoadMoreControl
        announcement={paging.announcement}
        disabled={
          rosterLoading || paging.isRefreshing || toggle.pendingId !== null
        }
        errorMessage={
          paging.error && paging.failedMode === "append"
            ? "More users could not be loaded. The loaded users are still shown."
            : undefined
        }
        hasLoadedMore={paging.hasLoadedMore}
        hasMore={paging.hasMore}
        isLoading={paging.isLoadingMore}
        onLoadMore={() => void paging.loadMore()}
        onRetry={() => void paging.retry()}
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`${reactivating ? "Reactivate" : "Deactivate"} ${target?.full_name ?? "member"}?`}
        description={
          reactivating
            ? "They'll be able to sign in again."
            : viewerRole === "Admin"
              ? "This removes their access and deletes their profile photo. Their past work stays in the archives."
              : "This removes their app access. Their profile photo and past work stay unchanged."
        }
        confirmLabel={
          toggle.cleanupPendingId === target?.id
            ? "Retry login cleanup"
            : reactivating
              ? "Reactivate"
              : "Deactivate"
        }
        destructive={!reactivating}
        loading={toggle.pendingId !== null}
        onConfirm={confirmToggle}
      />

      {viewerRole === "Admin" ? (
        <ConfirmDialog
          open={cancelInviteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !cancelInviteBusy) {
              setCancelInviteTarget(null);
              setCancelInviteError("");
            }
          }}
          title={`Cancel ${cancelInviteTarget?.full_name ?? "this invitation"}?`}
          description="Their profile will be deactivated and login blocked. Their account will not be deleted."
          confirmLabel={
            cancelInviteError ? "Retry cancellation" : "Cancel invitation"
          }
          destructive
          loading={cancelInviteBusy}
          error={cancelInviteError}
          onConfirm={() => void cancelRosterInvitation()}
        />
      ) : null}

      {viewerRole === "Admin" ? (
        <OfficerTransitionDialog
          key={`${transitionAction ?? "closed"}:${transitionTarget?.id ?? "none"}`}
          action={transitionAction}
          member={transitionTarget}
          committees={committees}
          busy={transitionBusy}
          error={transitionError}
          onClose={() => {
            if (transitionBusy) return;
            setTransitionAction(null);
            setTransitionTarget(null);
            setTransitionError("");
          }}
          onSubmit={(details) => void submitTransition(details)}
        />
      ) : null}

      {viewerRole === "Co-Admin" ? (
        <EditMemberNameDialog
          key={editTarget?.id ?? "closed"}
          member={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(fullName) => {
            if (!editTarget) return;
            setNameOverrides((current) => ({
              ...current,
              [editTarget.id]: fullName,
            }));
            setEditTarget(null);
            void paging.refreshFromStart();
          }}
        />
      ) : null}

      {viewerRole === "Admin" ? (
        <FormerMemberRemovalDialog
          key={removalRequest?.key ?? "closed"}
          request={removalRequest}
          onClose={() => setRemovalRequest(null)}
          onRefresh={async () => {
            setSelectedIds(new Set());
            setSelectionMessage("");
            return paging.refreshFromStart();
          }}
          onStartRetry={(userIds) => openRemoval(userIds, "result-retry")}
          onShowRemovedMembers={revealRemovedMembersAfterUnknownOutcome}
          refreshInFlight={paging.isRefreshing || forceRosterSkeleton}
        />
      ) : null}
    </div>
  );
}
