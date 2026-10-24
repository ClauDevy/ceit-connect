# Step 4: Branding

**Status:** Planned | **Branch:** `feature/branding` | **Reasoning level:** Medium

## Goal

Apply the CEIT Student Council shield consistently across the application without changing any product behavior. Replace the current paw-print page background with a scattered, faint shield treatment; carry the branding into the login page, provide a light-mode treatment, and use the shield for the favicon.

This batch keeps its Step 4 identifier but runs **after Batch 13b and before Batch 14**. The clean shield SVG is not needed until this batch starts.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 4 is `feature/branding`: council shield background, login page treatment, light-mode version, and favicon.
- The batch runs after Batch 13b and before Batch 14 even though its stable identifier remains 4.

### `docs/PHASE-4B-PLAN.md` — Updates (latest decisions)

- Obtain the clean shield SVG from these sources in order: the logo's original vector file; a trace made by Claude; or an online converter after removing the background.
- The shield asset is not required before the branding batch begins.

### Owner clarification

- The shield replaces the current paw-print page background; the two patterns do not coexist.
- Exact shield placement, scale, and opacity are visual-tuning decisions to make after the clean SVG exists.

## Current state

- `src/app/globals.css` applies a repeated, embedded paw-print background to `body`, with separate light- and dark-theme colors and opacity.
- `src/app/favicon.ico` supplies the current favicon, while `src/app/layout.tsx` defines the site metadata without an explicit shield icon configuration.
- `src/app/login/page.tsx` renders the existing `AuthShell`; `src/components/auth/auth-shell.tsx` uses a one-column phone layout and a split desktop layout; `src/components/auth/login-hero.tsx` provides the desktop brand panel. These surfaces currently use the tiger mascot rather than a council shield treatment.
- `src/components/layout/brand.tsx` uses the existing tiger logo for the CEIT Connect navigation identity. This batch does not automatically replace that established app-shell mark.
- Relevant branding and login sections were searched in `docs/prototypes/login.html` and `docs/prototypes/style.css`; neither prototype defines the final clean shield asset or its exact tuned placement.
- No clean council shield SVG is currently tracked in `public/` or `src/app/`.

## Scope: in / out

**In:** obtain and add one clean shield SVG using the approved source order; replace the global paw-print background with scattered, faint, fixed shield placements; tune placement, scale, and opacity once the asset exists; create readable light- and dark-theme treatments; apply the approved shield treatment to the existing login layout; replace the favicon with a legible shield-derived icon; retain semantic design tokens and responsive behavior.

**Out:** changing authentication behavior or copy; replacing the tiger mascot or app-shell logo unless separately approved; redesigning the dashboard shell or unrelated pages; adding remote image storage; changing database records; inventing a new council logo; keeping the paw-print pattern underneath the shields.

## Database impact

None. The checked surfaces are static assets, metadata, CSS, and presentational login components. No migration, table, function, policy, grant, Supabase Storage bucket, or stored row is required or planned.

If implementation discovers a need to store or remotely manage branding assets, stop and return that requirement to the owner rather than adding database or Storage work to this batch.

## Guards that must remain true

- The replacement background is decorative, does not enter the accessibility tree, does not intercept pointer input, and remains behind readable application surfaces.
- Shield placement is fixed and visually scattered rather than a dense repeating wallpaper. It must not cause horizontal overflow, obscure controls, or reduce text and focus-ring contrast.
- Light and dark treatments use the approved semantic palette and are tested independently; feature markup does not introduce raw palette colors.
- Login retains every current sign-in, magic-link, password-reset, theme, error, loading, and invite-only behavior.
- The favicon remains recognizable at small browser-tab sizes and does not depend on transparency that disappears in either browser theme.
- The source SVG is clean, local, scalable, and free of an embedded raster background before it is used to derive other assets.

## Security risks

- Treat any downloaded or converted SVG as untrusted: inspect it before use and remove scripts, event handlers, external references, embedded remote content, and unnecessary metadata.
- Do not load the shield from a third-party URL at runtime or add a network dependency to the login page.
- Do not move authentication controls, errors, or loading states behind decorative layers or change their submission behavior while applying the treatment.

## Earlier test docs to re-run or update

- Re-run the login and theme portions of `docs/PHASE-4-STEP-10E-GATE.md` so authentication behavior, responsive fit, focus, and both themes remain intact.
- Re-run the relevant shell and changed-page visual checks created for Phase 4B Steps 2 and 3 after those batches land.
- SQL and database catalog pastes remain unchanged because this batch has no database impact.

## Test deliverable

Create `docs/phase-4b/step-4-tests.md` when the batch lands. Record the final asset source, SVG safety inspection, favicon checks, visual coverage for every changed surface, both themes, phone and desktop widths, reduced-data/network independence, and confirmation that login behavior did not change.

## Manual checklist

- At phone width in both light and dark themes, verify the scattered shield background is faint, fixed, non-interactive, does not create overflow, and never competes with text, cards, bottom navigation, safe areas, or focus indicators.
- At phone width in both themes, verify every login state fits the viewport, all controls remain reachable, the theme toggle works, keyboard focus is visible, errors remain readable, and the shield treatment does not delay or block interaction.
- At desktop width in both themes, verify background placement across short and long pages, the complete login split layout, readable foreground contrast, and clean boundaries around cards, dialogs, sheets, and the sidebar.
- In both themes, inspect common empty, loading, error, dialog, and sheet states over the new background.
- Verify the paw-print background is fully removed rather than layered with the shield.
- Verify the favicon at common browser-tab sizes, after a hard refresh, and against light and dark browser chrome.
- Confirm all authentication paths and the app-shell identity still behave as they did before this batch.

## Acceptance

A sanitized clean shield SVG obtained through the approved source order drives the branding treatment. The shield replaces the paw-print background with visually tuned scattered, faint, fixed placements; the login page and favicon use the approved treatment; and phone and desktop layouts remain readable in both themes. No authentication behavior, application permission, or database contract changes.

## Open questions for the owner

- The plan requires a “login page treatment” but does not define the final composition beyond using the shield branding and retaining the existing responsive auth structure. Approve the proposed composition during implementation after the clean SVG can be previewed.
- Whether the app-shell tiger logo should ever be replaced by the council shield is not decided and remains outside this batch unless the owner explicitly adds it.

## Docs to update when this lands

- Mark Step 4 results in this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev or Prod status without owner confirmation.
- Add `docs/phase-4b/step-4-tests.md` with the final asset provenance and manual results. Update `docs/DESIGN-SYSTEM.md` only if the owner approves a reusable branding rule.
