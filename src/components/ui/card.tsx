import * as React from "react"
import { cn } from "@/lib/utils"

/** Status or priority colour for the left accent stripe of a card. */
export type CardAccent =
  | "primary"
  | "success"
  | "muted"
  | "destructive"
  | "critical"
  | "high"
  | "medium"
  | "low";

// Strong (text-level) tokens so the stripe stays visible in both themes.
const accentClasses: Record<CardAccent, string> = {
  primary: "border-l-primary",
  success: "border-l-success",
  muted: "border-l-muted-foreground/50",
  destructive: "border-l-destructive",
  critical: "border-l-priority-critical",
  high: "border-l-priority-high",
  medium: "border-l-priority-medium",
  low: "border-l-priority-low",
}

/**
 * Soft tint for a card: a faint corner glow and a matching hover border. "primary" is the warm
 * Council Orange; "neutral" (default) is a quiet grey. The other names are aliases of "primary".
 */
export type CardTone = "neutral" | "primary" | "sky" | "violet" | "emerald" | "amber" | "rose"

const warm = "to-primary/[0.06] hover:border-primary/45 hover:to-primary/[0.12]"
const toneClasses: Record<CardTone, string> = {
  neutral: "to-foreground/[0.03] hover:to-foreground/[0.06]",
  primary: warm,
  // Kept so existing callers compile; every colour tone resolves to the same warm orange.
  sky: warm,
  violet: warm,
  emerald: warm,
  amber: warm,
  rose: warm,
}

export const toneIconClasses: Record<CardTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  sky: "bg-primary/10 text-primary",
  violet: "bg-primary/10 text-primary",
  emerald: "bg-primary/10 text-primary",
  amber: "bg-primary/10 text-primary",
  rose: "bg-primary/10 text-primary",
}

type CardProps = React.ComponentProps<"div"> & {
  /** Colour family for this card type. */
  tone?: CardTone
  /** Navigating or pressable card: gentle lift on hover, press-in on tap, focus ring. */
  interactive?: boolean
  /** Left colour stripe (status or priority). Never the only signal: pair it with text. */
  accent?: CardAccent
  /** Dashed border for drafts and "nothing here yet" panels. */
  dashed?: boolean
}

/**
 * ONE card style for the whole app: soft border, no heavy shadow, optional
 * left accent stripe, optional hover/press effect and a dashed variant.
 * Hover lift and press scale reuse `motion-card-interaction`, so they stay slow
 * (320 ms), only run where hover exists, and switch off for reduced motion.
 */
function Card({ className, interactive = false, accent, dashed = false, tone = "neutral", ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      data-interactive={interactive ? "true" : undefined}
      className={cn(
        "rounded-2xl border bg-card bg-linear-to-br from-transparent via-transparent text-card-foreground",
        toneClasses[tone],
        dashed && "border-dashed",
        accent && ["border-l-4", accentClasses[accent]],
        interactive &&
          "motion-card-interaction transition-[background-color,border-color] duration-500 focus-within:ring-3 focus-within:ring-ring/30",
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("grid gap-1 p-5 pb-0 sm:p-6 sm:pb-0", className)} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("font-display text-base font-semibold", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("p-5 sm:p-6", className)} {...props} />
}

/** Small meta row under a title: dates, counts, committee. Wraps instead of overflowing. */
function CardMeta({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-meta"
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Quiet icon badge for a card header (semantic tokens only). */
function CardIcon({ className, tone = "primary", ...props }: React.ComponentProps<"span"> & { tone?: CardTone }) {
  return (
    <span
      data-slot="card-icon"
      aria-hidden
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4",
        toneIconClasses[tone],
        className,
      )}
      {...props}
    />
  )
}

/** Thin determinate progress bar for a card's optional progress row. */
function CardProgress({
  value,
  label,
  className,
}: {
  /** 0 to 100. */
  value: number
  label: string
  className?: string
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div
      data-slot="card-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
    </div>
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardMeta, CardIcon, CardProgress }
