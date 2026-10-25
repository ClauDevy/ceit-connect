# Step 5: Motion polish

**Status:** Implemented locally; automated verification complete, owner browser verification pending | **Branch:** `feature/motion-polish` | **Reasoning level:** Medium

## Owner-approved motion contract

- Route content fades in for **300 ms**. First-list items use opacity plus `translateY(10px)` for **300 ms** with **`cubic-bezier(0.16, 1, 0.3, 1)`**. Entrance fill mode is `backwards`; normal CSS is always the final visible, interactive state.
- Items 1–8 use 40 ms delays from 0–280 ms. Items 9–20 reuse 280 ms; item 21 onward never enters. The cap is across the whole list, not per section or phase.
- Determinate bars and the board ring reveal their already-correct final value over **700 ms ease-out** once when first mounted. Bars use `scaleX(0)` with left origin while retaining final width. The ring's animated `stroke-dashoffset` is the sole approved non-opacity/transform entrance exception.
- Cards/clickable rows transition color, border, shadow, translate, and scale for **220 ms**: desktop hover lifts 2 px with a stronger shadow; press returns to y=0 and scales to 0.99. Buttons hover up 1 px and press to 0.97. Hover movement is inside `@media (hover: hover)`.
- Parent-hover arrows move 3 px; navigation icons move 2 px; avatars scale to 1.05 with a stronger ring; badges brighten without movement. These use 220 ms.
- Dialog, alert-dialog, dropdown, and select popup enter from opacity 0 and scale 0.94 over 300 ms. Sheets slide for 300 ms. Base UI continues to own focus and dismissal.
- Theme icons rotate 90 degrees and cross-fade for 300 ms. Empty-state tigers breathe from scale 1 to 1.03. Undo bars slide/fade in for 300 ms; removal remains immediate and is never delayed for exit motion.
- Checkbox, switch, and circular Complete feedback is a 300 ms CSS activation pop. It is deliberately tied to user activation rather than mutation settlement, so polling, optimistic settlement, or an external value change cannot replay it.
- No number count-up, JavaScript motion timer, `requestAnimationFrame` loop, or animation library is used.

## Verified inventory

The rebuilt inventory was corrected against source: it now names the exact list renderers, loading controls, Base UI primitives, and shell consumers rather than implying blanket form/card entrances.

- Infrastructure: `src/app/globals.css`, `src/lib/motion.ts`, `src/components/shared/motion.tsx`.
- Shared primitives: `ui/button.tsx`, `input.tsx`, `select.tsx`, `dropdown-menu.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `badge.tsx`, and `table.tsx`; shared `empty-state.tsx`, `load-more-control.tsx`, and `priority-badge.tsx` inherit/use the shared classes.
- Route and shell: dashboard `app-shell.tsx`, `desktop-sidebar.tsx`, `nav-link.tsx`, `mobile-nav.tsx`, `navigation-progress.tsx`, `theme-toggle.tsx`, `avatar-menu.tsx`.
- List entrances and interactions: `home-event-list.tsx`, `archive-event-list.tsx`, `archived-task-list.tsx`, `my-tasks-list.tsx`, `help-wanted-list.tsx`, `users-table.tsx`, `members-table.tsx`, `members-cards.tsx`.
- Progress: `home-event-progress.tsx` and `event-board-progress-ring.tsx`.
- Board/Undo: `event-board.tsx`, `event-board-task-card.tsx`. Kanban cards get hover/press feedback only and never list entrance.
- Form/loading consumers retained from the verified inventory: `event-form.tsx`, `banner-uploader.tsx`, `role-picker.tsx`, `workspace-tasks.tsx`, `task-backup-controls.tsx`, `task-comments.tsx`, and `your-work-card.tsx`.
- Untouched by direct edit: `src/components/ui/segmented-control.tsx`, `src/components/auth/sign-in-panel.tsx`, and every file under `supabase/`. Shared Button/Input styling may appear within sign-in, but auth routes receive no entrance.

## First-20 and once-only mechanism

- The helper freezes at most the first 20 stable IDs for a mount. Home captures its server-rendered first page. Archives capture the server first page, and archived tasks flatten phases before applying the cap.
- My Tasks, Help Wanted, and roster wait for the first settled, successful, non-placeholder render. Placeholder/`keepPreviousData`, a retry after initial error, later pages, polling, focus refetch, filters, sort, search, tab return, Load more, optimistic changes, Undo, and settlement cannot arm or replace the set.
- The immutable ID order assigns the capped delay: indices 0–7 receive 0–280 ms; indices 8–19 remain at 280 ms. Eligibility is created with lazy `useState`, so Strict Mode cannot replay it.
- `animationend` is accepted only for `event.target === event.currentTarget` and animation name `cc-list-item-enter`.
- Workspace panels stay mounted across tab changes. Batch 3H progress appearing after first paint mounts its fill once and reveals once; later enrichment does not replay it.

## Reduced motion

`prefers-reduced-motion: reduce` disables route/list entrances, delay effects, progress bar/ring reveals, popup scale, sheet slide, card/button lift and scale, arrow/nav movement, avatar scale, theme rotation, toggle pop, Undo entrance, tiger breathing, skeleton pulse, navigation-progress looping, and loading-icon rotation. Bars and rings immediately show their correct final value. Content and controls remain visible and usable without timers; loading retains disabled state plus visible text or an accessible busy label.

## Verified security and behavior corrections

The rebuilt risk section was corrected to distinguish decorative callbacks from business state. Motion never changes a reader, writer, payload, permission, guard, capability, focus target, scroll position, or enabled state. Protected task/comment branch changes remain instant. Board polling, optimistic movement, Undo, and settlement do not drive entrance state. Base UI focus handling is untouched. Undo removal is intentionally not exit-animated because delaying removal could outlive its protected timer.

## Test coverage

The rebuilt detailed cases were corrected to focus on the actual changed surfaces and replay risks. `src/lib/motion.test.ts` pins 300/220/700 ms values, easing, 10 px start, 40 ms delay, eight-item stagger cap, whole-list 20-item limit, capture rules, final-state-first bar/ring markup, and absence of motion timers. Component tests cover roster and archived-phase boundaries plus Home bar and board ring output. Apply the regression cases from `step-2-tests.md`, `step-3-tests.md`, `step-3p-tests.md`, and `step-3h-tests.md`. Final automated and owner-pending browser checks are in `step-5-tests.md`.

## Acceptance

No database or Supabase change is part of this batch. Kanban cards have no entrance. Comments and task-detail refetch branches have no content-switch entrance. The owner will complete browser history, scroll, focus, BFcache, desktop hover, 10%-speed, and reduced-motion checks; this document claims no browser result.
