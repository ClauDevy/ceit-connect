import * as React from "react"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { LoginHero } from "@/components/auth/login-hero"
import { TigerMascot } from "@/components/ui/tiger-mascot"

// Phones: one centred column, mascot above the form, nothing to scroll past.
// md and up: brand panel on the left, form on the right.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col md:flex-row">
      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-10">
        <ThemeToggle />
      </div>

      <LoginHero />

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-sm">
          <TigerMascot size={88} className="mb-4 md:hidden" />
          {children}
        </div>
      </main>
    </div>
  )
}
