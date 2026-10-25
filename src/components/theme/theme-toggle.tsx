"use client"

import { useState } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/hooks/use-theme"
import { cn } from "@/lib/utils"

type ThemeToggleProps = {
  /** `row` is the full-width sidebar control; `icon` is the round topbar button. */
  variant?: "row" | "icon"
  /** Row variant only: drop the label and switch, keep the icon. */
  collapsed?: boolean
  className?: string
}

export function ThemeToggle({ variant = "icon", collapsed, className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const [hasToggled, setHasToggled] = useState(false)
  const dark = theme === "dark"
  const Icon = dark ? Moon : Sun
  const label = dark ? "Dark mode" : "Light mode"
  const handleToggle = () => {
    setHasToggled(true)
    toggleTheme()
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
        className={cn(
          "motion-button-interaction flex size-11 items-center justify-center rounded-full border bg-background text-secondary-foreground outline-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 md:size-9",
          className
        )}
      >
        <Icon key={theme} className={cn(hasToggled && "motion-theme-icon-enter", "size-4")} />
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={collapsed ? label : undefined}
      onClick={handleToggle}
      className={cn(
        "motion-control-trigger flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium text-secondary-foreground outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        collapsed && "justify-center px-0",
        className
      )}
    >
      <span className="flex items-center gap-2">
        <Icon key={theme} className={cn(hasToggled && "motion-theme-icon-enter", "size-4 shrink-0")} />
        {!collapsed && label}
      </span>
      {!collapsed && (
        <span
          aria-hidden
          className={cn(
            "motion-control-pop relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--motion-interaction-duration)] motion-reduce:transition-none",
            dark ? "bg-primary" : "bg-border"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
              dark && "translate-x-4"
            )}
          />
        </span>
      )}
    </button>
  )
}
