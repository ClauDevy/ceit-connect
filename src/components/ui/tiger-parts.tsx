// One drawing of the tiger, shared by the small logo and the login mascot.
// Deliberately flat and minimal: four colours, round shapes, dot eyes.
const FUR = "#F28A3C"
const FUR_DARK = "#C9631C"
const CREAM = "#FFF3E3"
const INK = "#3B2314"

export type TigerEyes = "open" | "closed" | "happy" | "worried" | "look"
export type TigerMouth = "smile" | "open" | "o" | "wavy"

type TigerHeadProps = {
  /** Adds the blink loop (respects reduced motion via `motion-safe:`). */
  blink?: boolean
  /** Expression for the mascot poses. The defaults draw the logo face exactly as before. */
  eyes?: TigerEyes
  mouth?: TigerMouth
}

/** Head only, centred on (80, 72) in a 160-unit space. */
export function TigerHead({ blink = false, eyes = "open", mouth = "smile" }: TigerHeadProps) {
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
      {eyes === "open" || eyes === "look" || eyes === "worried" ? (
        <g
          className={blink && eyes === "open" ? "motion-safe:animate-blink-open" : undefined}
          transform={eyes === "look" ? "translate(3 1.5)" : undefined}
        >
          <ellipse cx="62" cy="70" rx="5" ry={eyes === "worried" ? 6.8 : 6} fill={INK} />
          <ellipse cx="98" cy="70" rx="5" ry={eyes === "worried" ? 6.8 : 6} fill={INK} />
          <circle cx="63.8" cy="67.6" r="1.8" fill="#fff" />
          <circle cx="99.8" cy="67.6" r="1.8" fill="#fff" />
        </g>
      ) : (
        <g stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none">
          {eyes === "closed" ? (
            <>
              <path d="M56 71 Q62 77 68 71" />
              <path d="M92 71 Q98 77 104 71" />
            </>
          ) : (
            <>
              <path d="M56 74 Q62 63 68 74" />
              <path d="M92 74 Q98 63 104 74" />
            </>
          )}
        </g>
      )}
      {eyes === "worried" ? (
        <g stroke={FUR_DARK} strokeWidth="3.2" strokeLinecap="round" fill="none">
          <path d="M53 60 L68 55" />
          <path d="M107 60 L92 55" />
        </g>
      ) : null}
      {blink && eyes === "open" && (
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
      {mouth === "smile" ? (
        <path
          d="M80 90 V93 M80 93 Q75 98 70 94 M80 93 Q85 98 90 94"
          stroke={INK}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      ) : mouth === "open" ? (
        <>
          <path d="M80 90 V92" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M70 93 Q80 110 90 93 Z" fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          <ellipse cx="80" cy="102" rx="5" ry="3" fill="#E8667A" />
        </>
      ) : mouth === "wavy" ? (
        <>
          <path d="M80 90 V92" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <path
            d="M69 98 Q74.5 93 80 98 Q85.5 103 91 98"
            stroke={INK}
            strokeWidth="2.4"
            strokeLinecap="round"
            fill="none"
          />
        </>
      ) : (
        <>
          <path d="M80 90 V92" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="80" cy="98" rx="3.8" ry="4.6" fill={INK} />
        </>
      )}
    </g>
  )
}

export const TIGER_COLORS = { FUR, FUR_DARK, CREAM, INK } as const
