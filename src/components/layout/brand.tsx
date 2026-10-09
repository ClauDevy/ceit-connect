import { TigerLogo } from "@/components/ui/tiger-logo"
import { cn } from "@/lib/utils"

export function Brand({ collapsed, className }: { collapsed?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", collapsed && "justify-center", className)}>
      <TigerLogo size={34} />
      {!collapsed && (
        <div className="leading-tight">
          <p className="font-display text-[15px] font-semibold tracking-tight">CEIT Connect</p>
          <p className="-mt-0.5 text-[11px] text-muted-foreground">Student Council</p>
        </div>
      )}
    </div>
  )
}
