import { cn } from "@/lib/utils"
import { TigerMascot } from "@/components/ui/tiger-mascot"
import { TIGER_COLORS, TigerHead } from "@/components/ui/tiger-parts"

const { FUR, FUR_DARK, CREAM, INK } = TIGER_COLORS
// Accent colours taken from the logo art: the gold rim light of the shield,
// the nose pink, plus one soft blue for the "oops" sweat drop.
const GOLD = "#FEAD16"
const PINK = "#E8667A"
const DROP = "#7DC4F2"
const GLASS = "#CFEAF7"

export type MascotPose = "sleeping" | "celebrating" | "searching" | "oops" | "waving"

/**
 * One reusable tiger. Every pose reuses the logo's head (TigerHead), so it always
 * matches `public/brand/app-logo.svg`. Poses are plain SVG shapes (a few hundred
 * bytes each); motion is `motion-safe:` only, so reduced-motion users get a calm,
 * still drawing. Place it OUTSIDE cards, with a short friendly line under it.
 */
export function Mascot({
  pose,
  size = 120,
  mark = true,
  className,
}: {
  pose: MascotPose
  /** Width in px. Keep it small (72 to 96) on data-heavy screens. */
  size?: number
  /** Tiny council-shield emblem on the tummy (sitting poses only). */
  mark?: boolean
  className?: string
}) {
  if (pose === "waving") return <TigerMascot size={size} mark={mark} className={className} />
  if (pose === "sleeping") return <SleepingTiger size={size} className={className} />

  const searching = pose === "searching"
  return (
    <div className={cn(pose === "celebrating" && "motion-safe:animate-float", className)} aria-hidden>
      <svg
        width={searching ? (size * 190) / 170 : size}
        height={size}
        viewBox={searching ? "-15 0 190 170" : "0 0 160 170"}
        className="mx-auto overflow-visible"
      >
        {pose === "celebrating" ? <Celebrating mark={mark} /> : null}
        {searching ? <Searching mark={mark} /> : null}
        {pose === "oops" ? <Oops mark={mark} /> : null}
      </svg>
    </div>
  )
}

function Body({ mark, tail = "up" }: { mark: boolean; tail?: "up" | "down" }) {
  return (
    <>
      <path
        d={tail === "up" ? "M112 146 Q146 146 142 118" : "M112 148 Q142 152 146 166"}
        stroke={FUR_DARK}
        strokeWidth="11"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="80" cy="136" rx="36" ry="30" fill={FUR} />
      <ellipse cx="80" cy="142" rx="21" ry="20" fill={CREAM} />
      <ellipse cx="64" cy="164" rx="13" ry="6.5" fill={CREAM} />
      <ellipse cx="96" cy="164" rx="13" ry="6.5" fill={CREAM} />
      {mark ? <image href="/brand/shield-mark.svg" x={71} y={130.7} width={18} height={20.6} /> : null}
    </>
  )
}

function Celebrating({ mark }: { mark: boolean }) {
  const confetti: Array<{ x: number; y: number; c: string; r: number; round?: boolean; d: string }> = [
    { x: 20, y: 36, c: GOLD, r: 20, d: "0s" },
    { x: 140, y: 28, c: PINK, r: -25, round: true, d: "0.6s" },
    { x: 34, y: 8, c: FUR, r: 40, round: true, d: "1.2s" },
    { x: 124, y: 6, c: GOLD, r: -10, d: "1.8s" },
    { x: 152, y: 70, c: FUR_DARK, r: 30, d: "0.9s" },
    { x: 8, y: 76, c: PINK, r: -35, d: "1.5s" },
    { x: 80, y: 4, c: CREAM, r: 15, round: true, d: "0.3s" },
  ]
  return (
    <>
      {confetti.map((piece, index) => (
        <g key={index} transform={`translate(${piece.x} ${piece.y}) rotate(${piece.r})`}>
          <g className="motion-safe:animate-confetti" style={{ animationDelay: piece.d }}>
            {piece.round ? (
              <circle r="3.6" fill={piece.c} stroke={FUR_DARK} strokeWidth="0.8" />
            ) : (
              <rect x="-4" y="-2.5" width="8" height="5" rx="1.2" fill={piece.c} />
            )}
          </g>
        </g>
      ))}
      <Body mark={mark} />
      <TigerHead eyes="happy" mouth="open" />
      {/* both arms up */}
      <g className="origin-[52px_142px] [transform-box:view-box] motion-safe:animate-cheer" style={{ rotate: "-32deg" }}>
        <ellipse cx="52" cy="112" rx="9" ry="20" fill={FUR} />
        <ellipse cx="52" cy="94" rx="6.5" ry="5.5" fill={CREAM} />
      </g>
      <g
        className="origin-[108px_142px] [transform-box:view-box] motion-safe:animate-cheer"
        style={{ rotate: "32deg", animationDirection: "reverse" }}
      >
        <ellipse cx="108" cy="112" rx="9" ry="20" fill={FUR} />
        <ellipse cx="108" cy="94" rx="6.5" ry="5.5" fill={CREAM} />
      </g>
    </>
  )
}

// Same arm as the waving tiger (a fur ellipse with a cream paw), swung out by `angle`.
function Arm({ side, angle }: { side: "left" | "right"; angle: number }) {
  const cx = side === "right" ? 122 : 38;
  const pivotX = side === "right" ? 116 : 44;
  return (
    <g transform={`rotate(${angle} ${pivotX} 150)`}>
      <ellipse cx={cx} cy="132" rx="9" ry="15" fill={FUR} />
      <ellipse cx={cx} cy="122" rx="6" ry="5" fill={CREAM} />
    </g>
  )
}

function Searching({ mark }: { mark: boolean }) {
  return (
    <>
      <Body mark={mark} />
      <TigerHead eyes="look" mouth="smile" />
      {/* magnifying glass held out to the side, clear of the face */}
      <g className="origin-[134px_127px] [transform-box:view-box] motion-safe:animate-search">
        <path d="M134 126 L142 114" stroke={FUR_DARK} strokeWidth="6" strokeLinecap="round" fill="none" />
        <circle cx="152" cy="100" r="17" fill={GLASS} fillOpacity="0.9" stroke={GOLD} strokeWidth="5" />
        <path d="M142 97 Q144 90 151 88" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </g>
      <Arm side="right" angle={28} />
      <circle cx="134" cy="127" r="6" fill={CREAM} />
    </>
  )
}

function Oops({ mark }: { mark: boolean }) {
  return (
    <>
      <Body mark={mark} tail="down" />
      {/* a sheepish shrug, arms out at the sides */}
      <Arm side="left" angle={-40} />
      <Arm side="right" angle={40} />
      <g transform="rotate(-5 80 115)">
        <TigerHead eyes="worried" mouth="wavy" />
      </g>
      <path
        d="M136 52 Q144 64 136 70 Q128 64 136 52 Z"
        fill={DROP}
        stroke={FUR_DARK}
        strokeWidth="1"
        className="motion-safe:animate-drip"
      />
      <g transform="translate(138 4)" stroke={GOLD} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M0 8 Q0 0 8 0 Q16 0 16 7 Q16 12 8 16 V19" />
      </g>
      <circle cx="146" cy="30" r="2.6" fill={GOLD} />
    </>
  )
}

function SleepingTiger({ size, className }: { size: number; className?: string }) {
  return (
    <div className={className} aria-hidden>
      <svg width={size} height={(size * 140) / 200} viewBox="0 0 200 140" className="mx-auto overflow-visible">
        {/* curled body, breathing very gently */}
        <g className="origin-[122px_110px] [transform-box:view-box] motion-empty-breathe">
          <ellipse cx="122" cy="102" rx="68" ry="34" fill={FUR} />
          <g stroke={FUR_DARK} strokeWidth="5" strokeLinecap="round" fill="none">
            <path d="M104 70 Q108 82 104 92" />
            <path d="M122 68 Q127 82 122 94" />
            <path d="M140 70 Q145 83 140 94" />
            <path d="M158 76 Q162 87 158 97" />
          </g>
          <ellipse cx="166" cy="108" rx="24" ry="22" fill={FUR} />
        </g>
        {/* tail wrapped round the front */}
        <path d="M188 102 Q196 124 150 132 Q120 136 96 132" stroke={FUR_DARK} strokeWidth="11" strokeLinecap="round" fill="none" />
        {/* head resting on the paws */}
        <g transform="translate(18 40) scale(0.82)">
          <TigerHead eyes="closed" />
        </g>
        <ellipse cx="62" cy="124" rx="13" ry="7" fill={CREAM} />
        <ellipse cx="90" cy="126" rx="13" ry="7" fill={CREAM} />
        {/* floating Zzz */}
        <g className="text-muted-foreground" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M120 34 H129 L120 45 H129" className="motion-safe:animate-zzz" style={{ animationDelay: "0s", opacity: 0.85 }} />
          <path d="M138 18 H150 L138 33 H150" className="motion-safe:animate-zzz" style={{ animationDelay: "1.6s", opacity: 0.85 }} />
          <path d="M160 4 H174 L160 21 H174" className="motion-safe:animate-zzz" style={{ animationDelay: "3.2s", opacity: 0.85 }} />
        </g>
      </svg>
    </div>
  )
}
