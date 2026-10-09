"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { IconInput } from "@/components/ui/icon-input"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { MembersCards } from "@/components/users/members-cards"
import { MembersTable } from "@/components/users/members-table"
import { useToggleMemberActive } from "@/components/users/use-toggle-member-active"
import type { Committee, Member } from "@/lib/types"

type UsersTableProps = {
  members: Member[]
  committees: Committee[]
  currentUserId: string
}

export function UsersTable({ members: initialMembers, committees, currentUserId }: UsersTableProps) {
  const { members, pendingId, error, setActive } = useToggleMemberActive(initialMembers)
  const [query, setQuery] = useState("")
  // `target` is kept after closing so the dialog text doesn't blank out mid-exit-animation.
  const [target, setTarget] = useState<Member | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const committeeName = (id: string | null) =>
    committees.find((c) => c.id === id)?.name ?? "—"

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter((m) =>
      [m.full_name, m.email, m.role, committees.find((c) => c.id === m.committee_id)?.name ?? ""]
        .some((field) => field.toLowerCase().includes(q))
    )
  }, [members, committees, query])

  const reactivating = target ? !target.is_active : false

  async function confirmToggle() {
    if (!target) return
    const ok = await setActive(target, reactivating)
    if (ok) setConfirmOpen(false)
  }

  function askToToggle(member: Member) {
    setTarget(member)
    setConfirmOpen(true)
  }

  const listProps = { members: visible, committeeName, currentUserId, pendingId, onToggle: askToToggle }

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <IconInput
            icon={Search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, committee…"
            aria-label="Search members"
          />
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {visible.length} of {members.length} {members.length === 1 ? "member" : "members"}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card className="min-w-0 overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            title={query ? "No members match that search" : "No members yet"}
            description={query ? "Try a different name, email or committee." : "Invite your first council member to get started."}
          />
        ) : (
          <>
            <div className="hidden min-w-0 md:block">
              <MembersTable {...listProps} />
            </div>
            <div className="md:hidden">
              <MembersCards {...listProps} />
            </div>
          </>
        )}
      </Card>

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
        loading={pendingId !== null}
        onConfirm={confirmToggle}
      />
    </div>
  )
}
