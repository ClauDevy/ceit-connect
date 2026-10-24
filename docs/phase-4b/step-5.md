# Step 5: Motion polish

**Status:** Planned | **Branch:** `feature/motion-polish` | **Reasoning level:** Medium

## Goal

Give interactions, page-route changes, forms, cards, and short lists restrained motion while keeping the interface calm, accessible, and fast on phones. Every animated surface must have a stable reduced-motion result.

## Decisions

- Batch 5 is `feature/motion-polish`: restrained interaction, page-route, form, card, and list entrance transitions that respect reduced-motion preferences.
- Page-route, form, card, and list entrance animations are in scope.
- Entrance motion uses only opacity and transform, one short fixed duration, and no entrance animation beyond the first 20 items of a list.
- The fully loaded Kanban board is not treated as a list to animate card-by-card.
- Focus, scroll position, readable content, and immediate access to controls are preserved. No animation library is added.

## Current state

- `src/app/globals.css` defines mascot, navigation-progress, and blink keyframes. Tiger motion and skeleton pulse are already gated with `motion-safe`, but behavior is not audited consistently.
- Shared controls and overlays use assorted transition properties and durations.
- Existing loading and success feedback already communicates real state; this batch polishes it without creating new workflows.

### Named component and loading inventory

> **Rebuilt, please verify:** this inventory was reconstructed from the current tracked source because the exact earlier prose was not available in Git.

- Shared interaction primitives: `src/components/ui/button.tsx`, `input.tsx`, `select.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, and `skeleton.tsx`.
- Shell and navigation: `src/components/navigation/navigation-progress.tsx`, `src/components/layout/desktop-sidebar.tsx`, `mobile-nav.tsx`, `nav-link.tsx`, and `src/components/theme/theme-toggle.tsx`.
- Event/task surfaces: `src/components/events/event-form.tsx`, `event-board.tsx`, `event-board-task-card.tsx`, `src/components/tasks/workspace-tasks.tsx`, `your-work-card.tsx`, and `task-detail.tsx`.
- Named loading surfaces: `src/app/(dashboard)/loading.tsx`, `home/loading.tsx`, `users/loading.tsx`, `settings/loading.tsx`, `tasks/[taskId]/loading.tsx`, `src/components/shared/page-skeleton.tsx`, `src/components/events/event-board-skeleton.tsx`, and `src/components/tasks/task-detail-skeleton.tsx`.
- Authentication, settings, invite, archive, comments, and confirmation forms must be inventoried when implementation starts so submit, validation, success, error, retry, and disabled motion stays consistent without changing their workflows.

## Scope: in / out

**In:** short transitions for buttons, fields, focus, navigation, theme controls, menus, selects, dialogs, sheets, disclosures, loading, success feedback, page-route content, forms, cards, and at most the first 20 items of a list.

**Out:** animation after list item 20; card-by-card Kanban entrance; parallax; decorative background motion; autoplay celebration effects; animation-driven business behavior; persisted motion state; or a new animation library.

## Database impact

None. No migration, table, function, policy, grant, reader, writer, or stored value changes are expected.

## Components and behavior

- **Interactions:** buttons, fields, focus states, menus, selects, dialogs, sheets, and disclosures use restrained feedback without delaying availability or focus.
- **Page routes and forms:** new route content and form surfaces may enter once through subtle opacity/transform motion without replaying on background refetch.
- **Cards and lists:** cards may enter once; a list animates no more than its first 20 rendered items. Items 21 onward appear immediately in their stable state.
- **Loading and success:** motion represents real waiting or settlement and stops promptly when state settles.

## Reduced-motion behavior

- Under `prefers-reduced-motion: reduce`, remove entrance, decorative, looping, sliding, scaling, and layout movement.
- Render the stable end state immediately. A brief opacity change is permitted only when needed for state continuity.
- No essential information, focus movement, or control availability depends on animation.
- Do not use JavaScript timers to override the operating-system preference.

## Measurable phone performance budget

- Animated entrance and movement properties are limited to `opacity` and `transform`.
- Use one short fixed duration across entrance motion; implementation documents the chosen value and keeps it at or below 200 ms.
- Animate no more than the first 20 rendered items in any list. Items 21 onward have no entrance animation.
- Do not animate height, width, large-area blur, background position, large shadows, or the fully loaded Kanban cards.
- Do not run entrance motion again for polling, focus refetch, placeholder data, or ordinary search/filter updates.
- Phone scrolling, input, overlays, safe areas, keyboard display, and fixed navigation remain responsive during motion.

## Guards that must remain true

- Motion never delays an action, changes permission, masks an error, exposes protected content, or leaves a control visually busy after settlement.
- Existing duplicate-submission guards, polling pauses, focus management, and authoritative refetch behavior remain unchanged.
- Controls do not move under a pointer or finger in a way that causes accidental activation.
- Loading, empty, error, retry, success, disabled, and destructive states remain distinguishable without motion or color alone.

## Security risks

> **Rebuilt, please verify:** this restored risk and recovery coverage was reconstructed from the session requirements and current tracked components because the exact earlier prose was not available in Git.

- A stale optimistic surface must not keep protected task, event, activity, user, or request content visible after an authoritative refetch removes access. Exit motion never delays clearing protected content.
- A forbidden control must not become briefly enabled during entrance, hydration, optimistic settlement, polling, focus refetch, or reduced-motion fallback. Authorization and disabled state are established before animation begins.
- Animation callbacks and timers must not become a second source of business state. A cancelled transition, navigation, unmount, offline failure, or stale response cannot submit twice, skip cleanup, or leave a control busy.

## Earlier test docs to re-run or update

- Re-run motion-relevant checks from `docs/PHASE-4-STEP-6-TESTS.md`, `docs/PHASE-4-STEP-10E-GATE.md`, and Phase 4B Steps 2 and 3.
- Re-run focused component tests for any shared primitive whose state classes change. Database tests remain unchanged.

## Test deliverable

Create `docs/phase-4b/step-5-tests.md` when the batch lands. Inventory each changed component, normal motion, reduced-motion state, focus behavior, property names, fixed duration, list-item count, and phone result.

> **Rebuilt, please verify:** the detailed keyboard, validation, offline, retry, stale-response, and busy-state cases below were reconstructed because the exact earlier prose was not available in Git.

Focused checks must cover keyboard activation, Tab order, Escape dismissal, outside dismissal where already supported, and focus return for menus, dialogs, sheets, selects, and disclosures. Verify that route/form/card entrance never steals focus, changes scroll position, or hides validation summaries and inline errors.

For each changed form or optimistic surface, test client validation, server validation, offline failure, retry, stale response ordering, authoritative refetch, rapid repeat activation, navigation/unmount during settlement, and success/error recovery. Buttons and fields must recover from busy state in `catch`/`finally`, duplicate-submission guards must remain effective, and stale optimistic protected content or forbidden controls must disappear immediately when authority changes.

## Manual checklist

- At phone and desktop widths in both themes, exercise interaction motion, route changes, forms, cards, lists, overlays, loading, and success/Undo feedback.
- Repeat with reduced motion enabled and confirm all content appears immediately in its stable state.
- Inspect a list with more than 20 items and prove only items 1–20 receive entrance motion.
- Confirm polling, focus refetch, searching, filtering, and Load more do not replay the initial entrance sequence.
- Confirm only opacity and transform are used for entrance/movement and the documented duration is at most 200 ms.
- Verify the fully loaded Kanban does not animate cards individually and phone scrolling remains smooth.
- Keyboard through every changed interactive primitive; verify Enter/Space behavior, Escape dismissal, stable Tab order, and focus returning to the invoking control.
- Trigger validation errors, offline failures, retry, stale responses, rapid repeat actions, and navigation during submission; verify no duplicate submission, stale protected content, forbidden flash, or stuck busy state.

## Acceptance

Interactions, routes, forms, cards, and short-list entrances use consistent restrained motion. Entrance and movement use only opacity and transform at one documented duration of at most 200 ms, with no list entrance beyond item 20 and no card-by-card Kanban entrance. Reduced-motion users receive immediate stable states, phone interaction remains responsive, and application/security/database behavior is unchanged.

## Open questions for the owner

None.

## Docs to update when this lands

- Mark Step 5 results in this file and `docs/PROGRESS.md` only after implementation and verification.
- Add `docs/phase-4b/step-5-tests.md` with the measured motion inventory.
