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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg" />}>
        <UserPlus />
        Invite user
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a council member</DialogTitle>
          <DialogDescription>
            They&apos;ll get an email link to set up their account. There are no public sign-ups.
          </DialogDescription>
        </DialogHeader>
        {/* Keyed on `open` so reopening always starts from a blank form. */}
        {open && <InviteUserForm committees={committees} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  )
}
