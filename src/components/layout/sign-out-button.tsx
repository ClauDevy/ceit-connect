import { LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"

type SignOutButtonProps = {
  /** `icon` for tight spaces (collapsed sidebar); `inline` shows the label. */
  variant?: "icon" | "inline"
  className?: string
}

// A real form POST so sign-out works without JS and clears the server session.
export function SignOutButton({ variant = "inline", className }: SignOutButtonProps) {
  return (
    <form action="/auth/signout" method="post" className={className}>
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
    </form>
  )
}
