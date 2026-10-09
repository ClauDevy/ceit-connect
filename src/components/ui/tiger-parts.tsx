// One drawing of the tiger, shared by the small logo and the login mascot.
// Deliberately flat and minimal: four colours, round shapes, dot eyes.
const FUR = "#F28A3C"
const FUR_DARK = "#C9631C"
const CREAM = "#FFF3E3"
const INK = "#3B2314"

type TigerHeadProps = {
  /** Adds the blink loop (respects reduced motion via `motion-safe:`). */
  blink?: boolean
}

/** Head only, centred on (80, 72) in a 160-unit space. */
export function TigerHead({ blink = false }: TigerHeadProps) {
  return (
    <g>
      {/* ears */}
      <circle cx="40" cy="38" r="15" fill={FUR} />
      <circle cx="120" cy="38" r="15" fill={FUR} />
      <circle cx="40" cy="39" r="7.5" fill={CREAM} />
      <circle cx="120" cy="39" r="7.5" fill={CREAM} />

      {/* head */}
      <ellipse cx="80" cy="72" rx="50" ry="43" fill={FUR} />

      {/* stripes */}
      <g stroke={FUR_DARK} strokeWidth="4.5" strokeLinecap="round" fill="none">
        <path d="M80 31 V44" />
        <path d="M66 34 L69 45" />
        <path d="M94 34 L91 45" />
        <path d="M31 68 H44" />
        <path d="M34 80 H45" />
        <path d="M129 68 H116" />
        <path d="M126 80 H115" />
      </g>

      {/* muzzle + blush */}
      <ellipse cx="80" cy="90" rx="23" ry="16" fill={CREAM} />
      <ellipse cx="48" cy="88" rx="7" ry="4.5" fill="#FF8F7A" opacity=".45" />
      <ellipse cx="112" cy="88" rx="7" ry="4.5" fill="#FF8F7A" opacity=".45" />

      {/* eyes */}
      <g className={blink ? "motion-safe:animate-blink-open" : undefined}>
        <ellipse cx="62" cy="70" rx="5" ry="6" fill={INK} />
        <ellipse cx="98" cy="70" rx="5" ry="6" fill={INK} />
        <circle cx="63.8" cy="67.6" r="1.8" fill="#fff" />
        <circle cx="99.8" cy="67.6" r="1.8" fill="#fff" />
      </g>
      {blink && (
        <g
          className="opacity-0 motion-safe:animate-blink-closed"
          stroke={INK}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M56 71 Q62 76 68 71" />
          <path d="M92 71 Q98 76 104 71" />
        </g>
      )}

      {/* nose + mouth */}
      <path d="M74.5 83 H85.5 L80 89.5 Z" fill="#E8667A" stroke="#E8667A" strokeWidth="2" strokeLinejoin="round" />
      <path
        d="M80 90 V93 M80 93 Q75 98 70 94 M80 93 Q85 98 90 94"
        stroke={INK}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  )
}

export const TIGER_COLORS = { FUR, FUR_DARK, CREAM, INK } as const
