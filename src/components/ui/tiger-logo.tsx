import { TigerHead } from "@/components/ui/tiger-parts"

// Cropped to the head so it stays legible at 26–34px.
export function TigerLogo({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size * (100 / 120)}
      viewBox="20 20 120 100"
      className={className ?? "shrink-0"}
      aria-hidden
    >
      <TigerHead />
    </svg>
  )
}
