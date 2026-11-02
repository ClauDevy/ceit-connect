// The CEIT Connect app mark (tiger + shield) from public/brand/app-logo.svg.
// Sized by height; width follows the file's 743 x 842 shape so nothing shifts while it loads.
const ASPECT = 743 / 842

export function AppLogo({ height = 34, className }: { height?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- local static SVG; next/image adds nothing here
    <img
      src="/brand/app-logo.svg"
      alt=""
      aria-hidden
      width={Math.round(height * ASPECT)}
      height={height}
      decoding="async"
      className={className ?? "shrink-0"}
    />
  )
}
