# Step 2: UI redesign shell

**Status:** Implemented and verified locally; manual account checks pending | **Branch:** `feature/ui-redesign-shell` | **Reasoning level:** Medium

## Goal

Once the owner approves `docs/DESIGN-SYSTEM.md`, Batch 2 applies it to the authenticated shell and Home. Deliver a labeled desktop sidebar, the approved identity header and phone avatar menu, centered content, events-only Home, accessible contrast, and consistent button hierarchy without changing data access.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Working rules

- `docs/DESIGN-SYSTEM.md` is written on the docs branch and approved by the owner before Batch 2 starts; Batch 2 and later UI batches apply it.
- Everything is fixed to Philippine time (`Asia/Manila`, UTC+08:00). No timezone picker.

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 2 is `feature/ui-redesign-shell`: once the owner approves `docs/DESIGN-SYSTEM.md`, apply it; add the labeled sidebar, top-right header (theme toggle, avatar, name, role), phone avatar menu (full name, role, Settings, Sign out), centered content, Home as events only, contrast, and button hierarchy.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Batch IDs and run order are stable; Batch 2 applies `docs/DESIGN-SYSTEM.md` only once the owner approves it.

## Current state

- `src/components/layout/app-shell.tsx` provides the shell, but its `max-w-6xl` main column is not centered.
- `src/components/layout/desktop-sidebar.tsx` has expanded labels plus a collapsible icon state; theme and identity currently live at the bottom of the sidebar through `ThemeToggle` and `UserCard`.
- `src/components/layout/mobile-topbar.tsx` already uses the prototype's compact theme-toggle/avatar pattern; `src/components/layout/mobile-nav.tsx` supplies bottom navigation and the More sheet.
- `src/app/(dashboard)/home/page.tsx` currently renders only Active and Draft events and the leadership Create Event action.
- `src/app/globals.css`, `src/components/ui/button.tsx`, and `src/components/shared/page-header.tsx` are the existing token, button, and page-heading foundations. Relevant shell sections were searched in `docs/prototypes/index.html`, `tasks.html`, and `style.css`.

## Scope: in / out

**In:** authenticated shell layout, labeled sidebar, desktop top-right identity header, condensed phone header and avatar menu, centered main content, Home presentation, light/dark contrast, button hierarchy, and matching loading shell.

**Out:** page-specific redesigns owned by Step 3; paging owned by Step 3P; mobile kanban behavior owned by Batch 6; account warning behavior owned by Batch 7; branding owned by Batch 4; notifications and Executive Dashboard work.

## Database impact

None. No migration, table, function, policy, or grant changes are expected.

## Guards that must remain true

- Pages keep their own `requireUser()` or active-role guard; shell visibility never substitutes for authorization.
- Home retains current RLS-scoped event reads and leadership-only Create/Edit controls.
- No client receives service-role credentials or new security-relevant profile fields.
- Existing mobile navigation, safe-area spacing, keyboard focus, and accessible names remain functional.
- The phone avatar menu shows only the authenticated user's safe display name and role plus Settings and Sign out; it preserves focus, dismissal, sign-out, and 44px touch-target behavior.

## Security risks

- Do not infer permission from a visible nav item, role label, or hidden button.
- Do not expose email or other profile data in the new identity header.
- Preserve inactive-user handling and server-side page guards while moving presentation components.

## Earlier test docs to re-run or update

- Re-run the shell, Home, role-boundary, theme, and mobile portions of `docs/PHASE-4-STEP-10E-GATE.md`; no SQL paste needs updating for a presentation-only change.
- Re-run existing navigation, Home loading, and role-specific manual checks affected by component movement.

## Test deliverable

Create `docs/phase-4b/step-2-tests.md` when the batch lands, recording build/lint/test results and the three-account shell checklist. Add focused component/unit coverage only where logic changes; do not create database tests for a no-database batch.

## Manual checklist

- At desktop and phone width, sign in as **Claudee** (Admin), **Claude HAAAA** (Co-Admin), and **tv** (Member); verify each sees only their allowed navigation and Home actions.
- In light and dark themes, verify sidebar labels, active state, desktop theme/avatar/name/role cluster, phone theme/avatar cluster and menu, focus rings, borders, and text contrast.
- On phones, tap and keyboard-open the avatar menu; verify full name, role, Settings, and Sign out, 44px targets, Escape/outside dismissal, focus return, and successful sign-out.
- Confirm the main column is centered, Home contains events only, and Active/Draft event behavior and links are unchanged.
- Check keyboard navigation, collapsed-sidebar labels/tooltips, phone bottom navigation/More sheet, safe areas, loading skeletons, empty state, and no horizontal overflow.

## Acceptance

Once the owner approves `docs/DESIGN-SYSTEM.md`, Batch 2 visibly and accessibly applies it to the shell and Home in both themes and at phone width. The desktop header contains theme toggle, avatar, name, and role; the phone header condenses to theme toggle and avatar; Home stays events-only; and no authorization or database behavior changes.

## Open questions for the owner

None.

## Implementation results

- The desktop sidebar remains collapsible, opens labeled by default, remembers the existing local preference, and now contains navigation plus a separate Sign out action. Theme and identity moved to a centered-width desktop header with avatar, full name, and role only.
- The phone header keeps the compact theme/avatar pattern. Its avatar opens an accessible menu with full name, role, Settings, and a native `POST /auth/signout` action. The More sheet keeps its full role-filtered navigation inventory without duplicate identity or sign-out controls.
- The shell content column is centered, Home remains Active/Draft events only, and Create Event is now the single labeled primary action with its existing leadership-only condition. Data reads, role checks, event actions, and page guards did not change.
- Home and shared page-header skeleton geometry now match the responsive labeled-action layout. Semantic tokens, focus styles, phone targets, safe-area spacing, and width containment are preserved.
- Pure navigation tests pin the complete Admin, Co-Admin, and Member desktop/mobile inventories and active-route matching. Local verification passes 27 test files / 267 tests, the Next.js 16.3.4 production build with all 23 routes, and lint with zero reported issues.
- No database, migration, RLS, grant, Supabase CLI, deployment, commit, or push work was performed. Real-browser checks remain recorded in `docs/phase-4b/step-2-tests.md` and are not claimed complete.

## Docs to update when this lands

- Mark Step 2 results in this file and `docs/PROGRESS.md` without claiming Dev/Prod deployment until owner-confirmed.
- Add `docs/phase-4b/step-2-tests.md` and update `docs/DESIGN-SYSTEM.md` only for owner-approved clarifications discovered during implementation.
