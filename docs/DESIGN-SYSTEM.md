# CEIT Connect Design System

**Status:** Approved by the owner.

This guide turns the existing tokens, shared components, and approved prototype direction into one implementation contract. It applies to Batch 2 and later UI batches; it does not change permissions, readers, or database behavior.

## Foundations

- Use the semantic tokens defined in `src/app/globals.css`: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and the sidebar equivalents. Feature markup must not add hex, RGB, HSL, or raw palette colors.
- Use `font-display` for page and card headings and `font-sans` for body copy and controls. Reuse the radius scale and existing spacing before adding variants.
- Reuse `src/components/ui/*` and `src/components/shared/*`. Extend a shared primitive only when the same need appears across pages.

## App shell

- Desktop has a persistent labeled sidebar. Every navigation icon has a visible text label in the expanded state, with a clear semantic active state. Collapsing may retain icon tooltips and accessible names.
- Desktop has a top-right identity cluster containing the theme toggle, avatar, full name, and role. The sidebar is navigation, not the only place identity is shown.
- Desktop and phone top headers use a subtle semantic tint, soft bottom boundary, and restrained backdrop blur when content scrolls beneath them. Their sticky offsets and layer order must not cover focused content, dialogs, or page-level sticky panels.
- On phones, use the prototype pattern: sticky compact top bar, theme toggle and avatar, plus the existing bottom navigation and More sheet. Tapping the avatar opens a menu showing the user's full name, role, **Settings**, and **Sign out**. The main content must clear both bars and safe-area insets.
- Center the main content column with `mx-auto w-full max-w-6xl`; narrower forms and reading surfaces may use a smaller semantic max width. Kanban may use the full available content width.
- Home is events only. Do not add dashboard statistics, task summaries, notifications, or Phase 5 surfaces.

## Surfaces and hierarchy

- Use `bg-background` for the page, `bg-card text-card-foreground` for raised surfaces, `border-border` for boundaries, and `bg-muted` or `bg-secondary` for quiet grouped regions.
- Keep page structure consistent: `PageHeader`, optional actions, then content. Cards use the shared `Card`; empty results use `EmptyState`; tables use the shared responsive `Table` or the established phone-card equivalent.
- Give cards and section headers a polished but restrained hierarchy with semantic-token icon badges, soft `border` boundaries, consistent spacing, and optional subtle `primary`/`muted` tints or gradients. Do not use raw colors, entrance animation, or shield/paw backgrounds for this treatment.
- Settings uses a centered narrow content column (about `max-w-4xl`) with no more than two equal-width card columns. Profile, Profile photo, and Password remain independent cards and stack before their fields become cramped.
- Orange (`primary`) buttons are reserved for the single primary action in a local decision area, such as Create, Save, Launch, or Confirm. Use `outline`, `secondary`, or `ghost` for navigation and supporting actions, and `destructive` only for destructive actions. Do not make every action orange.
- Icon-only buttons require an accessible name and tooltip/title where the meaning is not visible. Every form label must match an input `id` through `htmlFor`.
- A navigating card or row uses the whole box as its link target. Never nest a button or another interactive control inside a link; place independent actions as accessible siblings.
- Per-item destructive actions such as Archive, Deactivate, Remove, and Delete live in menus and require confirmation. Bulk actions and typed-confirmation flows remain buttons that open their confirmation dialog.
- On a shared role-aware management page, derive the viewer role on the server and pass one explicit capability variant through the desktop table and phone cards. Both layouts must show the same actions and failure text; never maintain a second hidden mobile action inventory. Read-only authority such as a derived committee may be displayed as text, but must not be submitted as an editable field.
- On Active Home event cards, Edit and Archive live in one per-item menu that renders only when the viewer has an available action; its trigger stays separate from the stretched card link. Draft cards instead show a visible supporting Edit button because Drafts have no other per-card action.
- Home Draft events remain visually compact and distinct from Active cards: dashed boundary, small banner thumbnail, visible Draft badge, “Not launched” metadata, and a single-column list. Badge and Edit must wrap without overlap at every width.
- Long form dialogs may pin their header and action footer around one internal scroll region. Validation remains visible beside the actions, and an invalid submit focuses or reveals the first problem without changing validation rules.

## Contrast and states

- In both themes, normal text uses `foreground`; supporting copy uses `muted-foreground`; interactive emphasis uses token-paired foregrounds such as `primary-foreground` and `accent-foreground`.
- Never rely on color alone. Active, warning, error, confidential, Draft, and disabled states also need text, icons, borders, or shape.
- Borders and focus rings must remain visible against their surface in light and dark mode. Use the shared focus-visible ring. Disabled controls remain legible and cannot receive pointer actions.
- Validate every changed surface in both themes; do not assume a light-mode opacity or border works in dark mode.

### Task priority

- Render task priority through the shared `PriorityBadge` and its accent/dot helpers. Every chip keeps the visible priority label, so color is never the only signal.
- Priority colors are semantic tokens with separate readable text, soft-background, and border values for both themes: Critical is red, High is orange, Medium is blue, and Low is green. Medium deliberately follows the event-board prototype's blue treatment instead of the workspace prototype's grey legend.
- Use the shared left accent only where a compact task row already has a priority edge. Use the shared dot for priority filters and legends; do not recreate priority colors in feature markup.
- Display the effective priority supplied by the current reader when that is what the surface already uses. Styling must not recompute priority or change sorting, filtering, or saved values.

## Loading, empty, and error states

- Use the shared `Skeleton` and page-specific skeletons. Skeleton geometry should match the final layout closely enough to avoid large jumps, use semantic surface colors, remain `aria-hidden`, and animate only through `motion-safe`.
- A loading region exposes a concise status label. Empty and error states remain distinct; errors offer a safe retry where possible and never display raw database messages.
- Mutating controls prevent duplicate submission and always leave their busy state through `try/catch/finally`.

## Paging

- The standard linear-list page is 20 visible items. Fetch 21, render 20, and show **Load more** only when the extra row proves another item exists.
- Loading another page appends without duplicates or gaps and preserves the current ordering, search, and filters. Disable Load more while its request or query-key transition is unsettled.
- Kanban remains fully loaded. Users paging belongs to Batch 7 and Activity Log paging to Batch 12. Task comments retain their existing separate keyset pattern unless the owner approves a later change.

## Motion

- Motion communicates state: short color/focus transitions, small disclosure movement, and restrained entry feedback. Avoid decorative movement that delays reading or interaction.
- Honor `prefers-reduced-motion`. Use `motion-safe` utilities for animation and provide a stable no-motion state for every animated element.
- Batch 5 motion uses 300 ms route/list/overlay entrances, 260 ms tab/section/small-disclosure motion, 220 ms interactions and exits, 200 ms table/menu background fades, and 700 ms determinate-progress reveals at 40% visibility. Entrances use opacity/transform except the SVG ring `stroke-dashoffset` and small grid-row collapse exceptions. Initially visible items 1–8 stagger 0–280 ms and initial items 9–20 share 280 ms; below-fold and Load-more rows reveal once on scroll without stagger. Do not add an animation library.
- Desktop hover lift/nudges must be inside `@media (hover: hover)`. Reduced motion removes entrance, stagger, progress reveal, lift, scale, slide, rotation, looping, and breathing while preserving correct final values and visible states.
- Preserve focus, scroll position, and readable content during loading. Never animate layout in a way that hides a control or causes accidental activation.

### Motion kit and rules for new pages

- Use `RouteEntrance` for the shared content slot; do not animate fixed navigation or add route exit motion.
- Use `useVisibilityAnimation` for determinate progress and future chart bars, `useListReveal` for stable-ID rows, `TabPanel` for explicit user-selected panels, `SectionEnter` for quiet form/card groups, `Collapse` for small disclosures, and `MotionPresence` for safe custom-panel/conditional exits.
- Visibility motion must be final-state-first. Do not hide before hydration or before a working observer reports an item offscreen; reveal focus, find-in-page/`beforematch`, and hash targets immediately; unobserve after reveal and disconnect on unmount.
- Tab motion is driven only by user selection. Polling, refetch, filtering, sorting, search, Load more, optimistic state, Undo, settlement, and validation redirects do not replay it. Kanban cards and comment rows never receive entrance motion.
- Closing snapshots are inert, `aria-hidden`, pointer-disabled, and non-submittable. Use Base UI ending styles or `transitionend`, never a timer; authorization removal and navigation may unmount immediately.
- Every new Activity Log, Executive Dashboard, and notifications UI must use the kit, document its normal and reduced-motion result, and add an automated contract row plus a manual browser row.
- User Management reuses `useListReveal` for stable roster rows and `TabPanel` only for user-selected Active/Deactivated changes. Search, paging, invite refresh, and name/status reconciliation do not replay tab motion. Its reduced-motion check requires immediately visible rows, menus, confirmation/edit dialogs, and final states with no one-off timers.

## Mobile rules

- Design from phone width upward. Stack page-header actions when needed, use full-width controls where space is tight, and keep every interactive touch target at least 44 by 44 CSS pixels on phones.
- Do not squeeze desktop tables or kanban columns into unreadable layouts. Use the established phone cards, controlled horizontal scrolling, or the separately approved mobile-board behavior.
- Dialogs, sheets, pickers, menus, and previews must fit the viewport, respect safe areas, keep their primary action reachable, and avoid horizontal page overflow.
- Keep essential labels visible; never depend on hover. Long names and titles truncate only when the full value remains available on the destination or detail view.

## Open questions for the owner

None.
