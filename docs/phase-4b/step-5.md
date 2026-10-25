# Step 5: Motion polish

**Status:** Implemented locally; automated verification complete, owner browser verification pending | **Branch:** `feature/motion-polish` | **Reasoning level:** Medium

## Owner-approved motion contract

- Route content fades in for **300 ms**. First-list items use opacity plus `translateY(10px)` for **300 ms** with **`cubic-bezier(0.16, 1, 0.3, 1)`**. Entrance fill mode is `backwards`; normal CSS is always the final visible, interactive state.
- Initially visible items 1–8 use 40 ms delays from 0–280 ms and initial items 9–20 reuse 280 ms. Initially visible item 21 onward does not animate. Initial rows genuinely below the fold and Load-more rows instead reveal once on scroll with no delay, tracked by stable ID across polling, refetch, filter, sort, search, and tab changes.
- Determinate bars and the board ring reveal their already-correct final value over **700 ms ease-out** once at 40% visibility. Bars use `scaleX(0)` with left origin while retaining final width. The ring's animated `stroke-dashoffset` is the approved non-opacity/transform entrance exception.
- Cards/clickable rows transition color, border, shadow, translate, and scale for **220 ms**: desktop hover lifts 2 px with a stronger shadow; press returns to y=0 and scales to 0.99. Buttons hover up 1 px and press to 0.97. Hover movement is inside `@media (hover: hover)`.
- Parent-hover arrows move 3 px; navigation icons move 2 px; avatars scale to 1.05 with a stronger ring; badges brighten without movement. These use 220 ms.
- Dialog, alert-dialog, dropdown, and select popup enter from opacity 0 and scale 0.94 over 300 ms and use Base UI ending styles for a 220 ms close. Sheets enter for 300 ms and close for 220 ms. Base UI continues to own focus and dismissal.
- User-selected tab panels and form sections use opacity plus `translateY(8px)` for **260 ms**; the Event Board phase panel is opacity-only. Programmatic validation/template tab switches are instant. Small disclosures use the approved `grid-template-rows: 0fr` to `1fr` exception for 260 ms, with 220 ms chevrons.
- Theme icons rotate 90 degrees and cross-fade for 300 ms. Empty-state tigers breathe from scale 1 to 1.03. Undo bars slide/fade in for 300 ms; removal remains immediate and is never delayed for exit motion.
- Checkbox, switch, and circular Complete feedback is a 300 ms CSS activation pop. It is deliberately tied to user activation rather than mutation settlement, so polling, optimistic settlement, or an external value change cannot replay it.
- No number count-up, JavaScript motion timer, `requestAnimationFrame` loop, or animation library is used.

## Verified inventory

The rebuilt inventory was corrected against source: it now names the exact list renderers, loading controls, Base UI primitives, and shell consumers rather than implying blanket form/card entrances.

- Infrastructure: `src/app/globals.css`, `src/lib/motion.ts`, `src/components/shared/motion.tsx`.
- Shared kit: `RouteEntrance`, `useVisibilityAnimation`, stable-ID `useListReveal`, `TabPanel`, `SectionEnter`, `Collapse`, and `MotionPresence`; future chart bars use the same visibility primitive with scale-from-zero CSS.
- Shared primitives: `ui/button.tsx`, `input.tsx`, `select.tsx`, `dropdown-menu.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `badge.tsx`, and `table.tsx`; shared `empty-state.tsx`, `load-more-control.tsx`, and `priority-badge.tsx` inherit/use the shared classes.
- Route and shell: dashboard `app-shell.tsx`, `desktop-sidebar.tsx`, `nav-link.tsx`, `mobile-nav.tsx`, `navigation-progress.tsx`, `theme-toggle.tsx`, `avatar-menu.tsx`.
- List entrances and interactions: `home-event-list.tsx`, `archive-event-list.tsx`, `archived-task-list.tsx`, `my-tasks-list.tsx`, `help-wanted-list.tsx`, `users-table.tsx`, `members-table.tsx`, `members-cards.tsx`.
- Progress: `home-event-progress.tsx` and `event-board-progress-ring.tsx`.
- Board/Undo: `event-board.tsx`, `event-board-task-card.tsx`. Kanban cards get hover/press feedback only and never list entrance.
- Form/loading consumers retained from the verified inventory: `event-form.tsx`, `banner-uploader.tsx`, `role-picker.tsx`, `workspace-tasks.tsx`, `task-backup-controls.tsx`, `task-comments.tsx`, and `your-work-card.tsx`.
- Settings/form surfaces: `settings/page.tsx`, `settings-section.tsx`, `full-name-form.tsx`, `set-password-form.tsx`, `avatar-uploader.tsx`, `avatar-cropper.tsx`, plus Event Form mode, tabs, field groups, phase disclosure, conditional Live Operation/notices/errors, and Add/Edit Task Details/When/Who sections.
- Close paths: shared Dialog, AlertDialog, DropdownMenu, Select, and Sheet primitives; Event Board priority/committee panels; comment mention results; Invite User, banner crop, and Add/Edit Task snapshots. Closing snapshots are inert, `aria-hidden`, pointer-disabled, and removed by `transitionend`, never a timer.
- Untouched by direct edit: `src/components/ui/segmented-control.tsx`, `src/components/auth/sign-in-panel.tsx`, and every file under `supabase/`. Shared Button/Input styling may appear within sign-in, but auth routes receive no entrance.

## Initial stagger and once-only scroll reveal

- The helper freezes the complete initial stable-ID set plus its first-20 entrance subset. Home and Archives capture their server-rendered first pages; archived tasks flatten phases first. Initially visible IDs after item 20 remain static, while initial rows proven below the fold and later-page IDs remain eligible for one no-stagger scroll reveal.
- My Tasks, Help Wanted, and roster wait for the first settled, successful, non-placeholder render. Placeholder/`keepPreviousData`, a retry after initial error, later pages, polling, focus refetch, filters, sort, search, tab return, Load more, optimistic changes, Undo, and settlement cannot arm or replace the set.
- The immutable initial ID order assigns indices 0–7 delays of 0–280 ms and indices 8–19 a 280 ms cap. An initial eligible row first reported below the fold switches to the no-stagger scroll reveal.
- Content is normal and visible in SSR CSS. A row becomes pending only after hydration and only after a working observer reports it offscreen. Missing or throwing observers leave final content visible. Focus, `beforematch` find-in-page, and hash targets reveal immediately. Each revealed element is unobserved and the observer disconnects on unmount.
- `animationend` cleanup accepts only the current target and the expected list entrance/reveal name. Stable revealed IDs prevent replay after reorder, filtering, tab return, or later pages.
- Workspace panels stay mounted across tab changes. Batch 3H progress appearing after first paint mounts its fill once and reveals once; later enrichment does not replay it.

## Reduced motion

`prefers-reduced-motion: reduce` disables route/list/panel/section entrances, delay effects, observers' pending visual state, progress bar/ring reveals, popup scale, sheet slide/close motion, collapse interpolation, card/button lift and scale, arrow/nav movement, avatar scale, theme rotation, toggle pop, Undo entrance, tiger breathing, skeleton pulse, navigation-progress looping, and loading-icon rotation. Bars and rings immediately show their correct final value. Content and controls remain visible and usable without timers; loading retains disabled state plus visible text or an accessible busy label.

## Verified security and behavior corrections

The rebuilt risk section was corrected to distinguish decorative callbacks from business state. Motion never changes a reader, writer, payload, permission, guard, capability, focus target, scroll position, or enabled state. Protected task/comment branch changes remain instant. Board polling, optimistic movement, Undo, and settlement do not drive entrance state. Base UI focus handling is untouched. Undo removal is intentionally not exit-animated because delaying removal could outlive its protected timer.

## Test coverage

The detailed cases cover 300/260/220/700 ms timing, easing, the 10 px list and 8 px section starts, capped initial stagger, stable-ID scroll reveal, observer fallback, focus/find/hash escape, 40% progress threshold, user-only tab activation, inert collapse/presence, Base UI ending styles, final-state-first values, and absence of motion timers. Component tests cover roster/archive stable IDs and Home/board progress output. Apply the regression cases from `step-2-tests.md`, `step-3-tests.md`, `step-3p-tests.md`, and `step-3h-tests.md`. Final automated and owner-pending browser checks are in `step-5-tests.md`.

## Acceptance

No database or Supabase change is part of this batch. Kanban cards have no entrance. Comments and task-detail refetch branches have no content-switch entrance. The owner will complete browser history, scroll, focus, BFcache, desktop hover, 10%-speed, and reduced-motion checks; this document claims no browser result.
