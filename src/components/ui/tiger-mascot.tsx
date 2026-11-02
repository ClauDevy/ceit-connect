import { cn } from "@/lib/utils"
import { TIGER_COLORS, TigerHead } from "@/components/ui/tiger-parts"

const { FUR, FUR_DARK, CREAM } = TIGER_COLORS

// Sitting tiger with a waving paw. Motion is gated on `motion-safe:` so
// reduced-motion users get a calm, static mascot.
// `mark` adds a tiny council-shield emblem on the tummy. It lives inside the SVG,
// so it scales and floats together with the tiger.
export function TigerMascot({
  className,
  size = 160,
  mark = false,
}: {
  className?: string
  size?: number
  mark?: boolean
}) {
  return (
    <div className={cn("motion-safe:animate-float", className)} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 160 170" className="mx-auto overflow-visible">
        {/* tail */}
        <path
          d="M112 146 Q146 146 142 118"
          stroke={FUR_DARK}
          strokeWidth="11"
          strokeLinecap="round"
          fill="none"
          className="origin-[112px_146px] [transform-box:view-box] motion-safe:animate-tail"
        />

        {/* body */}
        <ellipse cx="80" cy="136" rx="36" ry="30" fill={FUR} />
        <ellipse cx="80" cy="142" rx="21" ry="20" fill={CREAM} />
        <ellipse cx="64" cy="164" rx="13" ry="6.5" fill={CREAM} />
        <ellipse cx="96" cy="164" rx="13" ry="6.5" fill={CREAM} />

        {mark && (
          <image href="/brand/shield-mark.svg" x={71} y={130.7} width={18} height={20.6} />
        )}

        <TigerHead blink />

        {/* waving paw */}
        <g className="origin-[116px_150px] [transform-box:view-box] motion-safe:animate-wave">
          <ellipse cx="122" cy="132" rx="9" ry="15" fill={FUR} />
          <ellipse cx="122" cy="122" rx="6" ry="5" fill={CREAM} />
        </g>
      </svg>
    </div>
  )
}
