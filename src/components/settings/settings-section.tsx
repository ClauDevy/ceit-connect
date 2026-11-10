import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { SettingsWarningDot } from "@/components/layout/settings-warning-dot"
import { SectionEnter } from "@/components/shared/motion"

// Each settings section has its own soft hue so the page is easy to scan: a tinted header
// fading to the card colour and a matching icon chip with a faint ring.
export type SettingsTone = "primary" | "sky" | "violet" | "amber"

const tones: Record<SettingsTone, { header: string; icon: string }> = {
  primary: {
    header: "from-primary/12",
    icon: "bg-primary/15 text-primary ring-primary/30",
  },
  sky: {
    header: "from-sky-500/12",
    icon: "bg-sky-500/15 text-sky-600 ring-sky-500/30 dark:text-sky-300",
  },
  violet: {
    header: "from-violet-500/12",
    icon: "bg-violet-500/15 text-violet-600 ring-violet-500/30 dark:text-violet-300",
  },
  amber: {
    header: "from-amber-500/12",
    icon: "bg-amber-500/15 text-amber-600 ring-amber-500/30 dark:text-amber-300",
  },
}

type SettingsSectionProps = {
  title: string
  description?: string
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
  motionIndex?: number
  tone?: SettingsTone
  /** Shows the same orange dot as the nav when this section needs action. */
  attention?: boolean
}

export function SettingsSection({
  title,
  description,
  icon,
  className,
  children,
  motionIndex = 0,
  tone = "primary",
  attention = false,
}: SettingsSectionProps) {
  return (
    <SectionEnter index={motionIndex}>
      <Card className={cn("overflow-hidden", className)}>
        <CardHeader
          className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b bg-linear-to-r via-transparent to-transparent pb-4 sm:pb-4",
            tones[tone].header,
          )}
        >
          {icon ? (
            <span
              className={cn(
                "row-span-2 flex size-11 items-center justify-center rounded-xl ring-1 [&_svg]:size-5",
                tones[tone].icon,
              )}
            >
              {icon}
            </span>
          ) : null}
          <CardTitle className={cn("flex items-center gap-2 text-lg", !icon && "col-span-2")}>
            {title}
            {attention ? <SettingsWarningDot /> : null}
          </CardTitle>
          {description && (
            <CardDescription className={cn(!icon && "col-span-2")}>
              {description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </SectionEnter>
  )
}
