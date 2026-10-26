"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { TabPanel, useListReveal } from "@/components/shared/motion";
import { MembersCards } from "@/components/users/members-cards";
import { MembersTable } from "@/components/users/members-table";
import { useToggleMemberActive } from "@/components/users/use-toggle-member-active";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconInput } from "@/components/ui/icon-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useOffsetListPaging } from "@/hooks/use-offset-list-paging";
import type { OffsetListPage } from "@/lib/list-paging";
import { preventSearchFormSubmission } from "@/lib/search";
import type { Committee, Member } from "@/lib/types";
import {
  isMember,
  truncateUsersSearch,
  type UsersStatus,
} from "@/lib/users/list-users";

type UsersTableProps = {
  initialPage: OffsetListPage<Member>;
  committees: Committee[];
  currentUserId: string;
};

const TABS = [
  { value: "active", label: "Active" },
  { value: "deactivated", label: "Deactivated" },
] as const;

export function UsersTable({
  initialPage,
  committees,
  currentUserId,
}: UsersTableProps) {
  const [status, setStatus] = useState<UsersStatus>("active");
  const [tabMotionKey, setTabMotionKey] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<Member | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  const toggle = useToggleMemberActive(paging.refreshFromStart);
  const reveal = useListReveal({
    initialItems: initialPage.items,
    items: paging.items,
    settled: paging.settled,
    error: paging.error,
    getId: (member: Member) => member.id,
  });

  const committeeNames = useMemo(
    () => new Map(committees.map((committee) => [committee.id, committee.name])),
    [committees],
  );
  const committeeName = (id: string | null) =>
    (id ? committeeNames.get(id) : null) ?? "—";
  const reactivating = target ? !target.is_active : false;

  async function confirmToggle() {
    if (!target) return;
    const ok = await toggle.setActive(target, reactivating);
    if (ok) setConfirmOpen(false);
  }

  function selectTab(nextStatus: UsersStatus) {
    if (nextStatus === status) return;
    setStatus(nextStatus);
    setTabMotionKey((current) => current + 1);
  }

  const listProps = {
    members: paging.items,
    committeeName,
    currentUserId,
    pendingId: toggle.pendingId,
    onToggle: (member: Member) => {
      setTarget(member);
      setConfirmOpen(true);
    },
    getRevealProps: reveal.getRevealProps,
  };

  const statusLabel = status === "active" ? "active" : "deactivated";
  const initialError = paging.error && paging.failedMode === "replace";

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
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
            onChange={(event) =>
              setQuery(truncateUsersSearch(event.target.value))
            }
            onKeyDown={preventSearchFormSubmission}
            placeholder="Search name, email, role, committee…"
            aria-label="Search users"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {paging.items.length} {statusLabel} {paging.items.length === 1 ? "user" : "users"} loaded
        </p>
        {paging.isRefreshing && paging.items.length > 0 ? (
          <span className="text-xs text-muted-foreground">Refreshing…</span>
        ) : null}
      </div>

      {toggle.error ? (
        <p
          role="alert"
          className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {toggle.error}
        </p>
      ) : null}

      <TabPanel motionKey={tabMotionKey}>
        <Card className="min-w-0 overflow-hidden rounded-xl">
          {paging.isInitialLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground" role="status">
              Loading users…
            </div>
          ) : initialError ? (
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
              title={search ? "No users match that search" : `No ${statusLabel} users`}
              description={
                search
                  ? "Try a different name, email, role, or committee."
                  : status === "active"
                    ? "Invite a council member to get started."
                    : "Deactivated accounts will appear here."
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
      </TabPanel>

      <LoadMoreControl
        announcement={paging.announcement}
        disabled={paging.isRefreshing || toggle.pendingId !== null}
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
            : "This removes their access and deletes their profile photo. Their past work stays in the archives."
        }
        confirmLabel={reactivating ? "Reactivate" : "Deactivate"}
        destructive={!reactivating}
        loading={toggle.pendingId !== null}
        onConfirm={confirmToggle}
      />
    </div>
  );
}
