import * as React from "react"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { LoginHero } from "@/components/auth/login-hero"
import { LoginFooter } from "@/components/auth/login-footer"
import { TigerMascot } from "@/components/ui/tiger-mascot"
import { ViewportRecovery } from "@/components/auth/viewport-recovery"

// Phones: one centred column, mascot above the form, credit line at the bottom.
// md and up: brand panel on the left, form (and the credit line) on the right.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col md:flex-row">
      <ViewportRecovery />
      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-10">
        <ThemeToggle />
      </div>

      <LoginHero />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex flex-1 flex-col items-center justify-center px-6 py-4 md:py-8">
          <div className="w-full max-w-sm">
            <div
              role="img"
              aria-label="CEIT Connect tiger mascot"
              className="relative mb-5 grid place-items-center md:hidden [@media(max-height:700px)]:mb-3"
            >
              <span aria-hidden className="brand-shield-art absolute h-36 w-32 -translate-y-1 [@media(max-height:700px)]:h-20 [@media(max-height:700px)]:w-16 [@media(max-height:560px)]:hidden" />
              <div className="hidden [@media(min-height:701px)]:block">
                <TigerMascot size={104} mark />
              </div>
              <div className="hidden [@media(max-height:700px)]:block [@media(max-height:560px)]:hidden">
                <TigerMascot size={60} mark />
              </div>
              <p className="mt-2 font-display text-3xl leading-tight font-semibold tracking-tight [@media(max-height:700px)]:text-2xl">
                CEIT Connect
              </p>
              <p className="mt-0.5 text-xs font-semibold tracking-wider text-accent-foreground uppercase">
                CEIT Student Council
              </p>
            </div>
            {children}
          </div>
        </main>
        <LoginFooter />
      </div>
    </div>
  )
}
