import type { CSSProperties } from "react"

// Decorative council-shield backdrop (Batch 4). One fixed layer behind the app:
// scattered, faint, non-interactive, clipped so it can never cause scrolling.
// Position, size, rotation, colour and opacity all live in globals.css (`.brand-bg*`);
// the placements below are only numbers. Tune them here after looking at the real screens.
//
// x / y: centre of the shield as a percentage of the viewport.
// size: shield height in vmin. rot: rotation in degrees.
type Placement = { x: number; y: number; size: number; rot: number }

// md and up: 11 shields. Kept clear of the left edge (the solid sidebar would hide them).
const DESKTOP: Placement[] = [
  { x: 24, y: 8, size: 11, rot: -14 },
  { x: 41, y: 22, size: 8, rot: 12 },
  { x: 58, y: 6, size: 10, rot: -8 },
  { x: 76, y: 16, size: 12, rot: 15 },
  { x: 92, y: 9, size: 9, rot: -16 },
  { x: 28, y: 48, size: 9, rot: 9 },
  { x: 50, y: 62, size: 8, rot: 16 },
  { x: 88, y: 44, size: 11, rot: -12 },
  { x: 34, y: 84, size: 12, rot: -6 },
  { x: 68, y: 80, size: 10, rot: 10 },
  { x: 94, y: 76, size: 9, rot: -18 },
]

// Phones: only the first 6 shields are shown, each with its own placement.
const PHONE: Placement[] = [
  { x: 10, y: 7, size: 20, rot: -14 },
  { x: 80, y: 16, size: 17, rot: 12 },
  { x: 22, y: 44, size: 15, rot: 8 },
  { x: 86, y: 56, size: 19, rot: -10 },
  { x: 12, y: 80, size: 18, rot: 14 },
  { x: 62, y: 90, size: 16, rot: -6 },
]

function placementVars(prefix: "" | "p", value: Placement) {
  return {
    [`--${prefix}x`]: `${value.x}%`,
    [`--${prefix}y`]: `${value.y}%`,
    [`--${prefix}s`]: `${value.size}vmin`,
    [`--${prefix}r`]: `${value.rot}deg`,
  }
}

export function BrandBackground() {
  return (
    <div aria-hidden="true" className="brand-bg">
      {DESKTOP.map((desktop, index) => {
        const phone = PHONE[index]
        const style = {
          ...placementVars("", desktop),
          ...(phone ? placementVars("p", phone) : {}),
        } as CSSProperties

        return (
          <span
            key={index}
            className={phone ? "brand-bg-shield" : "brand-bg-shield max-md:hidden"}
            style={style}
          />
        )
      })}
    </div>
  )
}
