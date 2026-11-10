import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PushAwareSignOutForm } from "@/components/layout/push-aware-sign-out-form"

type SignOutButtonProps = {
  /** `icon` for tight spaces (collapsed sidebar); `inline` shows the label. */
  variant?: "icon" | "inline"
  className?: string
  userId: string
}

// A real form POST so sign-out works without JS and clears the server session.
export function SignOutButton({ userId, variant = "inline", className }: SignOutButtonProps) {
  return (
    <PushAwareSignOutForm userId={userId} className={className}>
      {variant === "icon" ? (
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
          <LogOut />
        </Button>
      ) : (
        <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
          <LogOut />
          Sign out
        </Button>
      )}
    </PushAwareSignOutForm>
  )
}
