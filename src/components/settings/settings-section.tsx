import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type SettingsSectionProps = {
  title: string
  description?: string
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
}

export function SettingsSection({
  title,
  description,
  icon,
  className,
  children,
}: SettingsSectionProps) {
  return (
    <Card className={cn("overflow-hidden border-border/70", className)}>
      <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-border/70 bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
        {icon ? (
          <span className="row-span-2 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
            {icon}
          </span>
        ) : null}
        <CardTitle className={cn(!icon && "col-span-2")}>{title}</CardTitle>
        {description && (
          <CardDescription className={cn(!icon && "col-span-2")}>
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
