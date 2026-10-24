# CEIT Connect Design System

**Status:** Owner approval required before Phase 4B Batch 2 starts.

This guide turns the existing tokens, shared components, and approved prototype direction into one implementation contract. It applies to Batch 2 and later UI batches; it does not change permissions, readers, or database behavior.

## Foundations

- Use the semantic tokens defined in `src/app/globals.css`: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, and the sidebar equivalents. Feature markup must not add hex, RGB, HSL, or raw palette colors.
- Use `font-display` for page and card headings and `font-sans` for body copy and controls. Reuse the radius scale and existing spacing before adding variants.
- Reuse `src/components/ui/*` and `src/components/shared/*`. Extend a shared primitive only when the same need appears across pages.

## App shell

- Desktop has a persistent labeled sidebar. Every navigation icon has a visible text label in the expanded state, with a clear semantic active state. Collapsing may retain icon tooltips and accessible names.
- Desktop has a top-right identity cluster containing the theme toggle, avatar, full name, and role. The sidebar is navigation, not the only place identity is shown.
- On phones, use the prototype pattern: sticky compact top bar, theme toggle and avatar, plus the existing bottom navigation and More sheet. Tapping the avatar opens a menu showing the user's full name, role, **Settings**, and **Sign out**. The main content must clear both bars and safe-area insets.
- Center the main content column with `mx-auto w-full max-w-6xl`; narrower forms and reading surfaces may use a smaller semantic max width. Kanban may use the full available content width.
- Home is events only. Do not add dashboard statistics, task summaries, notifications, or Phase 5 surfaces.

## Surfaces and hierarchy

- Use `bg-background` for the page, `bg-card text-card-foreground` for raised surfaces, `border-border` for boundaries, and `bg-muted` or `bg-secondary` for quiet grouped regions.
- Keep page structure consistent: `PageHeader`, optional actions, then content. Cards use the shared `Card`; empty results use `EmptyState`; tables use the shared responsive `Table` or the established phone-card equivalent.
- Orange (`primary`) buttons are reserved for the single primary action in a local decision area, such as Create, Save, Launch, or Confirm. Use `outline`, `secondary`, or `ghost` for navigation and supporting actions, and `destructive` only for destructive actions. Do not make every action orange.
- Icon-only buttons require an accessible name and tooltip/title where the meaning is not visible. Every form label must match an input `id` through `htmlFor`.
- A navigating card or row uses the whole box as its link target. Never nest a button or another interactive control inside a link; place independent actions as accessible siblings.
- Per-item destructive actions such as Archive, Deactivate, Remove, and Delete live in menus and require confirmation. Bulk actions and typed-confirmation flows remain buttons that open their confirmation dialog.

## Contrast and states

- In both themes, normal text uses `foreground`; supporting copy uses `muted-foreground`; interactive emphasis uses token-paired foregrounds such as `primary-foreground` and `accent-foreground`.
- Never rely on color alone. Active, warning, error, confidential, Draft, and disabled states also need text, icons, borders, or shape.
- Borders and focus rings must remain visible against their surface in light and dark mode. Use the shared focus-visible ring. Disabled controls remain legible and cannot receive pointer actions.
- Validate every changed surface in both themes; do not assume a light-mode opacity or border works in dark mode.

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
- Page-route, form, card, and list entrance motion must be restrained, use only opacity and transform, use one short fixed duration, and never animate more than the first 20 items of a list. Do not add an animation library.
- Preserve focus, scroll position, and readable content during loading. Never animate layout in a way that hides a control or causes accidental activation.

## Mobile rules

- Design from phone width upward. Stack page-header actions when needed, use full-width controls where space is tight, and keep every interactive touch target at least 44 by 44 CSS pixels on phones.
- Do not squeeze desktop tables or kanban columns into unreadable layouts. Use the established phone cards, controlled horizontal scrolling, or the separately approved mobile-board behavior.
- Dialogs, sheets, pickers, menus, and previews must fit the viewport, respect safe areas, keep their primary action reachable, and avoid horizontal page overflow.
- Keep essential labels visible; never depend on hover. Long names and titles truncate only when the full value remains available on the destination or detail view.

## Open questions for the owner

None.
