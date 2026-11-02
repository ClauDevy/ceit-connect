import * as React from "react"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { LoginHero } from "@/components/auth/login-hero"
import { LoginFooter } from "@/components/auth/login-footer"
import { TigerMascot } from "@/components/ui/tiger-mascot"

// Phones: one centred column, mascot above the form, credit line at the bottom.
// md and up: brand panel on the left, form (and the credit line) on the right.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col md:flex-row">
      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-10">
        <ThemeToggle />
      </div>

      <LoginHero />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-8 [@media(max-height:700px)]:py-4">
          <div className="w-full max-w-sm">
            <div className="relative mb-4 grid place-items-center md:hidden [@media(max-height:700px)]:mb-2">
              <span aria-hidden className="brand-shield-art absolute h-32 w-28 -translate-y-1" />
              <TigerMascot size={88} mark />
            </div>
            {children}
          </div>
        </main>
        <LoginFooter />
      </div>
    </div>
  )
}
