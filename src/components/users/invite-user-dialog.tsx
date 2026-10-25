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
import type { Committee } from "@/lib/types"

export function InviteUserDialog({ committees }: { committees: Committee[] }) {
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
      <DialogTrigger render={<Button size="lg" />}>
        <UserPlus />
        Invite user
      </DialogTrigger>
      <DialogContent
        className={!open ? "pointer-events-none max-w-lg" : "max-w-lg"}
        aria-hidden={!open || undefined}
        inert={!open ? true : undefined}
      >
        <DialogHeader>
          <DialogTitle>Invite a council member</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email link to set up their account. There are no public sign-ups.
          </DialogDescription>
        </DialogHeader>
        <InviteUserForm
          key={formKey}
          committees={committees}
          onDone={closeDialog}
        />
      </DialogContent>
    </Dialog>
  )
}
