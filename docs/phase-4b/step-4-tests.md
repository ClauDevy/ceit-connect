# Step 4 tests: Branding (`feature/branding`)

**Status:** Implemented locally in Claude chat. The owner runs the gate and the browser checks below; nothing here is claimed as passed yet. Database impact: none. SQL pastes: none.

## Asset provenance and SVG safety record

The owner supplied clean, transparent SVGs and placed them in `public/brand/`. Each file was inspected for scripts, event handlers, external references, embedded raster data, `<foreignObject>`, `<use>`, metadata, and any URL other than the SVG namespace. All files pass, and `src/lib/branding-contract.test.ts` re-checks them on every test run.

| File | Role | Size (gzipped) |
|---|---|---|
| `public/brand/app-logo.svg` | App-shell mark (tiger + shield, no wordmark). Slimmed from 259 KB by rounding coordinates to whole numbers; visually near-identical. | 185 KB (59 KB) |
| `public/brand/shield-color.svg` | Gold shield: light background, login art | 11 KB (5.5 KB) |
| `public/brand/shield-white.svg` | White shield: dark background, login art | 11 KB (5.5 KB) |
| `public/brand/shield-mark.svg` | `shield-color.svg` recolored to the tiger's dark fur color, used as the tummy mark | 11 KB (5.5 KB) |
| `public/brand/team-logo.svg` / `team-logo-dark.svg` | eduCache.on logo for the login footer (black or white text) | 85 KB (32 KB) each |
| `src/app/icon.svg` | Favicon: gold shield on a dark rounded square | 11 KB (5.5 KB) |
| `src/app/favicon.ico` | Generated 16/32/48 PNG entries of the same icon | 5.6 KB |

No runtime third-party URL is used. All images are local static files, so the login page has no new network dependency. `app-logo.svg` is loaded as an image file and is never inlined into client JavaScript.

## Automated coverage (run in the owner's gate)

- `src/lib/branding-contract.test.ts`: SVG safety, asset colors, ICO structure (16/32/48 PNG entries), paw-print removal, the fixed/non-interactive/clipped layer, theme-scoped image loading, opacity tokens, forced-colors and print hiding, app-shell wiring (`brand.tsx` 34px, `mobile-topbar.tsx` 28px), the root layout order, the login footer text and accessibility, and no raw colors in the new markup.
- `src/components/brand/brand-background.test.tsx`: 11 shields, 5 hidden on phones, placement variables, rotations within -18 to +16 degrees, and no images or links in the layer.
- `src/app/layout.test.tsx` must keep passing unchanged.

## Manual checklist

Run each item at phone width (about 390 px) and desktop width (about 1440 px), in light and dark.

1. **Paw-print gone.** No paw prints anywhere; only shields. Hard refresh (Ctrl+Shift+R) first.
2. **Background layer.** Shields are faint, scattered (not a wallpaper), fixed while the page scrolls, and never take clicks, text selection, or focus. Cards, dialogs, sheets, the sidebar, and the bottom nav stay solid above them. No horizontal scroll on any page. Count: about 11 on desktop, 6 on phone.
3. **Theme images.** In the browser Network tab, only the active theme's shield file loads. After toggling the theme, the other file loads once and no flash occurs on reload.
4. **Contrast and focus.** Text over the background and keyboard focus rings stay fully readable; shields never compete with content.
5. **Login, phone.** Every state fits and is reachable: sign-in (Password and Email link), Google, link-sent, reset flow, an error from `?error=...`, and loading. The faint shield sits behind the 88 px tiger, the tummy mark scales with the tiger, and the footer sits under the form. Prefer no scroll at 390 x 844; on very short phones (about 360 x 640) a few pixels of scroll is acceptable but no control may be hidden or covered.
6. **Login, desktop.** The split layout shows the large faint shield behind the 200 px tiger, the tummy mark, and the footer under the form column only. The tiger still floats, blinks, and waves; reduced motion still calms it.
7. **Footer.** Two lines, muted, no links: the team logo with "Built by eduCache.on", then the copyright line. The logo swaps between black text (light) and white text (dark) without a flash. Safe area respected on a phone.
8. **App-shell logo.** Desktop sidebar shows the app mark at 34 px next to "CEIT Connect" and "Student Council"; the collapsed sidebar shows only the mark, centered; the phone header shows it at 28 px. Link and collapse behavior are unchanged. The mark stays crisp and recognizable at the smallest size in both themes.
9. **Unchanged tigers.** Empty states, the event banner, and the event form still show the old tiger head.
10. **Favicon.** Check the browser tab after a hard refresh against light and dark browser chrome (and a bookmark at 16 px if possible): a gold shield on a dark rounded square. If the 16 px version is too weak, report it for tuning.
11. **Over the new background.** Look at common empty, loading, error, dialog, and sheet states in both themes.
12. **Auth behavior.** Re-run the login and theme portions of `docs/PHASE-4-STEP-10E-GATE.md`: all sign-in paths, errors, and the theme toggle behave exactly as before.

## Tuning notes (first-pass numbers)

- Shield positions, sizes, and rotations: `src/components/brand/brand-background.tsx`.
- Background opacity: `--brand-shield-bg-opacity` (light 0.16, dark 0.055) and login art opacity `--brand-shield-hero-opacity` (light 0.22, dark 0.06), both in `src/app/globals.css`.
- Corner glow strength: the `10%` in `.brand-bg`.
- Tummy mark size and position: the `<image>` in `src/components/ui/tiger-mascot.tsx` (18 units wide, centered on the belly).

## Results

Owner to record: gate output, browser results per item above, and any tuning requests.
