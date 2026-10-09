import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("rounded-lg bg-secondary motion-safe:animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
