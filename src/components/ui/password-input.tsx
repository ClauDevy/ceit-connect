"use client"

import * as React from "react"
import { Eye, EyeOff, LockKeyhole } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconInput } from "@/components/ui/icon-input"

function PasswordInput(props: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false)

  return (
    <IconInput
      icon={LockKeyhole}
      type={visible ? "text" : "password"}
      trailing={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="text-muted-foreground"
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      }
      {...props}
    />
  )
}

export { PasswordInput }
