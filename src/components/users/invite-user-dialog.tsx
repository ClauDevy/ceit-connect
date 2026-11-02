"use client"

import { useState } from "react"
import { UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { InviteUserForm } from "@/components/users/invite-user-form"
import type { Committee, Role } from "@/lib/types"

export function InviteUserDialog({
  committees,
  viewerRole,
  committeeName,
}: {
  committees: Committee[]
  viewerRole: Extract<Role, "Admin" | "Co-Admin">
  committeeName: string | null
}) {
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function closeDialog() {
    setOpen(false)
    setFormKey((current) => current + 1)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true)
        else closeDialog()
      }}
    >
      <DialogTrigger render={<Button className="flex-1 sm:flex-none" />}>
        <UserPlus />
        Invite user
      </DialogTrigger>
      <DialogContent
        className={!open ? "pointer-events-none max-w-lg" : "max-w-lg"}
        aria-hidden={!open || undefined}
        inert={!open ? true : undefined}
      >
        <DialogHeader className="grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5">
          <span
            aria-hidden
            className="row-span-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"
          >
            <UserPlus className="size-5" />
          </span>
          <DialogTitle>Invite a council member</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email link to set up their account. There are no public sign-ups.
          </DialogDescription>
        </DialogHeader>
        <InviteUserForm
          key={formKey}
          committees={committees}
          viewerRole={viewerRole}
          committeeName={committeeName}
          onDone={closeDialog}
        />
      </DialogContent>
    </Dialog>
  )
}
