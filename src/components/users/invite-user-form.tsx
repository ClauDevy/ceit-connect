"use client"

import { useState } from "react"
import { CheckCircle2, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { IconInput } from "@/components/ui/icon-input"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RolePicker } from "@/components/users/role-picker"
import type { Committee, Role } from "@/lib/types"

type InviteUserFormProps = {
  committees: Committee[]
  onDone: () => void
}

export function InviteUserForm({ committees, onDone }: InviteUserFormProps) {
  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [role, setRole] = useState<Role>("Member")
  const [committeeId, setCommitteeId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const needsCommittee = role !== "Admin"
  const committeeItems = committees.map((c) => ({ value: c.id, label: c.name }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (needsCommittee && !committeeId) {
      setError("Choose a committee for this role.")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          fullName,
          role,
          committeeId: needsCommittee ? committeeId : null,
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      setSent(true)
    } catch {
      setError("Network error, please try again")
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="grid justify-items-center gap-3 py-2 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
        <div>
          <p className="font-display text-lg font-semibold">Invite sent</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {fullName || email} will get an email to set up their account.
          </p>
        </div>
        <Button className="mt-2 w-full" variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <FormField label="Email">
        {(control) => (
          <IconInput
            icon={Mail}
            type="email"
            required
            autoComplete="off"
            placeholder="name@cvsu.edu.ph"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...control}
          />
        )}
      </FormField>

      <FormField label="Full name">
        {(control) => (
          <Input
            required
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            {...control}
          />
        )}
      </FormField>

      <RolePicker value={role} onChange={setRole} />

      {needsCommittee && (
        <FormField label="Committee">
          {(control) => (
            <Select
              items={committeeItems}
              value={committeeId || null}
              onValueChange={(value) => setCommitteeId(value ?? "")}
            >
              <SelectTrigger {...control}>
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
          )}
        </FormField>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={loading} className="w-full">
        {loading ? "Sending…" : "Send invite"}
      </Button>
    </form>
  )
}
