# Step 1: UI bug fixes and cleanup

**Status:** Planned | **Branch:** `fix/ui-bugs` | **Reasoning level:** Medium

## Goal

Fix the approved cross-application UI defects before the redesign begins: stable search inputs, correct whole-card navigation, phone-safe targets and previews, first-image avatar cropping, route-specific skeletons, aligned comment actions, Philippine-time display/parsing, and the verified package/lint/root-script cleanup. This batch changes no database object or access rule.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batch and working rules

- Batch 1 is `fix/ui-bugs` and runs after Batch 0.
- Everything displayed or parsed as local application time uses Philippine time (`Asia/Manila`, UTC+08:00); there is no timezone picker.
- Search inputs must not refresh or navigate the page, lose focus, or remount while the user types, while a debounce settles, during background polling, or while idle.
- A navigating card or row uses its whole box as the link target without nesting a button or other interactive control inside a link. Phone touch targets are at least 44 by 44 CSS pixels.

### Owner clarifications

- Step 1 aligns the existing comment Edit/Delete buttons only. Moving per-comment Delete into a menu belongs to Batch 3.
- The avatar cropper must allow zooming out until the whole selected image is visible, starting with the first image picked rather than only after replacing or reopening it.
- Per-item destructive actions move into menus with confirmation in the redesign batches. Bulk actions and typed-confirmation flows remain buttons that open a confirmation.

## Current state

### Search inventory

The implementation batch must re-run a repository search, but the current eight search fields are:

1. `src/components/users/users-table.tsx` — Users name/email/committee search.
2. `src/components/tasks/task-people-controls.tsx` — task assignee search.
3. `src/components/tasks/task-edit-controls.tsx` — prerequisite-task search.
4. `src/components/tasks/task-edit-controls.tsx` — additional-viewer search.
5. `src/components/tasks/task-comments.tsx` — mention-candidate search.
6. `src/components/tasks/archived-task-sharing.tsx` — archive-sharing person search.
7. `src/components/events/event-form.tsx` — Archived-template search.
8. `src/components/events/event-form.tsx` — task-assignee search.

Local filtering and debounced server searches use different query paths, but all eight must retain the same mounted input and focus across loading, placeholder data, focus refetch, visible-only polling, and idle time. Search fields inside forms must never submit the surrounding form from typing or Enter unless that exact behavior is explicitly intended and tested.

### Required lint baseline

`npm run lint` was run before this plan was written on 2026-10-24 (through `npm.cmd` because this Windows PowerShell policy blocks the `npm.ps1` shim). It completed with zero errors and exactly three warnings:

- `src/components/auth/password-sign-in-form.tsx:37:5` — `@next/next/no-location-assign-relative-destination` for `window.location.href = "/home"`.
- `src/components/auth/reset-password-flow.tsx:66:7` — `@next/next/no-location-assign-relative-destination` for `window.location.href = "/home"`.
- `src/lib/supabase/middleware.ts:34:13` — `@typescript-eslint/no-unused-vars` because `user` is assigned but never used.

The separate development-only warning is the raw `<script dangerouslySetInnerHTML>` in `src/app/layout.tsx`. Step 1 must resolve it using the supported Next.js 16 approach after consulting the installed Next.js documentation, while preserving the pre-hydration theme behavior and avoiding a production regression.

`package.json` currently declares the external packages `cn` and `p`. Repository search finds no import from either package. The many `cn(...)` calls import the local `@/lib/utils` helper and must remain.

## Scope: in / out

**In:** all current search boxes; all current whole-card/row destinations; 44px phone targets; first-selection avatar crop zoom range; route-specific loading skeletons; Drive preview containment on narrow phones; comment Edit/Delete alignment; application display/parsing audit for `Asia/Manila`; removal of the unused external `cn` and `p` packages after proof; the exact three lint warnings; and the development-only root-layout script warning.

**Out:** database migrations; RLS or authorization changes; visual redesign beyond the named fixes; moving comment Delete into a menu; new destructive-action flows; paging; motion polish; mobile-board layout; unrelated package upgrades or cleanup.

## Database impact

None. No migration, table, function, policy, trigger, index, grant, or remote Supabase operation belongs to this batch.

## Required behavior

- Search state and input nodes remain stable across query-key changes and background refreshes. Placeholder/loading content replaces only the result region.
- Navigating surfaces expose one valid link across the box. Sibling action buttons remain outside that link while preserving accessible names, keyboard order, and 44px targets on phones.
- The avatar cropper computes a minimum zoom that can contain the whole image and applies it on the first selected image as well as replacements.
- Every route with a loading state uses a skeleton shaped like that route's real header, controls, and content rather than a generic unrelated page.
- `DrivePreview` and its fallback fit the phone viewport without horizontal page overflow and keep the open-in-Drive escape path reachable.
- Comment Edit/Delete controls align consistently at desktop and phone widths; their current authorization and confirmation behavior stays unchanged.
- Dates and timestamps are displayed and parsed with the shared `Asia/Manila` contract. This audit does not change stored values, schema, or date-only event semantics.
- Internal auth navigation uses the supported Next.js client navigation API without leaving buttons stuck or breaking back-button protections.
- Removing the unused middleware binding must not change Supabase session refresh behavior.

## Guards that must remain true

- No nested interactive control appears inside a link.
- Search fixes do not broaden returned data, expose hidden counts, or change authorization.
- Skeletons contain no real confidential or stale content.
- Drive preview retains its safe exact-host parser, sandbox, referrer policy, lazy loading, and fallback link.
- Date-only `events.start_date` and `events.end_date` remain `yyyy-mm-dd` strings; timestamp conversion does not depend on the viewer's browser timezone.
- Package removal changes only `package.json` and the lockfile entries belonging to the unused external packages.
- The local `cn()` utility and all of its imports remain intact.

## Security and regression risks

- Replacing a full-card link with an `onClick` container can break keyboard navigation, open-in-new-tab behavior, and standard link semantics.
- Remounting a debounced search input on query state changes recreates the focus-loss defect even if the data results are correct.
- Changing auth navigation can break successful sign-in, successful password reset, or browser-history protection; both flows require regression tests.
- A timezone audit that rewrites stored UTC timestamps or date-only values would exceed this presentation/parsing batch.
- Changing the theme bootstrap timing can introduce a light-theme flash or hydration mismatch.

## Earlier test docs to re-run or update

- Re-run the affected auth, Settings/avatar, event-form, Users, task-detail, comments, archive-sharing, work-link, loading, phone, and timezone checks from the Phase 3/4 test documents and Step 10E gate.
- Preserve the existing query placeholder/polling behavior tests for task comments and archive sharing.
- Re-run the Drive parser and preview tests without changing its security contract.

## Test deliverable

Create `docs/phase-4b/step-1-tests.md` when the batch lands. Record the pre-change three-warning lint baseline above, the proof that no source imports external `cn` or `p`, every changed file, and final test/build/lint results.

Add focused coverage for search input identity/focus through typing, debounce and refetch; form non-submission; link and sibling-action markup; 44px phone targets; initial avatar crop containment; route-specific skeleton structure; Drive preview overflow; comment alignment; Philippine-time display/parsing; theme initialization; and auth navigation.

The auth navigation tests must prove that successful sign-in and successful password reset still reach `/home` after replacing `window.location.href`.

## Manual checklist

- Exercise all eight current search fields while typing continuously, pausing past the debounce, waiting through visible polling, switching focus away/back, pressing Enter, and clearing the query. Confirm no page refresh and no unexpected focus loss.
- Use mouse, keyboard, middle-click, and phone taps on every navigating card/row. Confirm the whole box navigates, sibling actions work independently, and no nested-button/link warning appears.
- On a real phone or equivalent viewport, measure representative interactive targets at 44 by 44 CSS pixels or larger.
- Pick a portrait, landscape, square, and small avatar image as the first selection. Confirm each can zoom out to show the whole image before cropping.
- Visit every route with `loading.tsx`; compare its skeleton with the real page in both themes and at phone width.
- Open representative Drive file/folder and Docs/Sheets/Slides previews at narrow phone widths and confirm no horizontal page overflow.
- Verify comment Edit/Delete alignment without changing their permissions or moving Delete into a menu.
- Compare all affected displayed timestamps from browsers in different local timezones; every result must remain correct for `Asia/Manila`.
- Complete password sign-in and password reset, verify navigation to `/home`, then test back-button/session behavior.
- Confirm initial theme selection has no flash or hydration warning in development and production builds.

## Acceptance

Every current search input remains mounted and focused as appropriate without refreshing the page. Navigating cards and rows are valid whole-box links with separate actions and 44px phone targets. Initial avatar cropping can contain the whole image, skeletons match their routes, Drive preview fits phones, comment actions align, and Philippine-time presentation/parsing is consistent. The unused external `cn` and `p` packages and all four documented warning sources are gone; sign-in, reset, session refresh, theme bootstrap, and the local `cn()` helper still work. Build and lint pass with zero warnings.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev or Prod status without owner confirmation.
- Add `docs/phase-4b/step-1-tests.md` with the final evidence.
- After Step 1 merges, remove the `cn`/`p`, lint, and root-script warning items from `docs/PROGRESS.md` Open items. Step 14 only verifies they remain absent.
