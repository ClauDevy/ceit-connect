# Step 5: Motion polish — test record

**Status:** Automated verification complete locally; every browser result is pending the owner  
**Branch:** `feature/motion-polish`  
**Database/Supabase:** No change; no Supabase command run

## Contract under test

- Route: opacity only, 300 ms. Initially visible list items use opacity plus `translateY(10px)`, 300 ms, with a 40 ms stagger through item 8 and a 280 ms cap through initial item 20. Below-fold and Load-more rows reveal once on scroll with no stagger.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)`; entrance fill mode: backwards only; normal CSS holds the final state.
- Interaction transitions: 220 ms; table/menu background transitions: 200 ms. User tab/section and small-collapse motion: 260 ms. Progress bar/ring reveal: 700 ms ease-out at 40% visibility. The ring's `stroke-dashoffset` and small grid-row collapse are the approved entrance exceptions to opacity/transform.
- Reduced motion shows final values immediately and removes lift, scale, stagger, slide, rotation, looping, and breathing.

## Automated coverage

- Duration/easing variables; 10 px list and 8 px section starts; delay values 0–280 ms; eight-item stagger cap; initial 0/1/19/20/21 boundaries.
- One counter across flattened sections/phases, stable IDs across desktop/mobile roster renderers, no entrance for initially visible item 21 onward, and no-stagger eligibility for below-fold/Load-more rows.
- Server-initial capture; first settled non-placeholder successful client capture; placeholder, initial-error retry, and later-page exclusion.
- Button hover/press shared contract; progress bar final width and ring final dash offset; shared 40% observer; missing/throwing-observer visible fallback; focus, `beforematch`, and hash reveal; unobserve/disconnect cleanup; no motion timer or animation-frame loop.
- User-only tab activation, instant programmatic Event Form switches, opacity-only Event Board panel, mounted/inert Workspace panels, grid-row collapse accessibility, inert closing snapshots, and Base UI ending-style close duration.
- Reduced-motion-safe skeleton, loading, route/list, progress, overlay, interaction, theme, navigation, avatar, badge, control, Undo, and tiger contracts.
- Existing board move, paging, form, and UI regressions remain applicable.
- Final focused run: **5 files, 30 tests passed**. The full run has **37 passing files / 264 passing assertions** and the same two unrelated pre-existing collection failures: `load-more-control.test.tsx` reaches `load-more-control.tsx:4` and cannot resolve `@/components/ui/button`; `backup.test.ts` reaches `backup.ts:2` and cannot resolve `@/lib/list-paging`. Neither failing import is in a Batch 5 test edit. `npm run lint` passed with zero errors or warnings. `npm run build` passed on Next.js 16.3.4, including TypeScript and all 23 generated routes.
- The production CSS contains `cc-route-enter`, `cc-list-item-enter`, `cc-progress-fill`, `cc-progress-ring`, the capped delay class, the interaction class, and the reduced-motion media rule. Its minified variables are `.3s`, `.22s`, and `.7s`.

## Browser checklist — all pending owner

### Slow-motion desktop check (DevTools Animations at 10%)

- **Pending — owner:** Use a desktop viewport, set DevTools Animations playback to 10%, and confirm route fade is 300 ms opacity-only.
- **Pending — owner:** Load 21+ initially visible items. Items 1–8 should step by 40 ms, items 9–20 should share item 8's 280 ms delay, and initially visible item 21 onward must not animate. Confirm no visible route/list double-pop.
- **Pending — owner:** With a short viewport, confirm initially below-fold and Load-more rows stay in normal layout, reveal once when scrolled into view with no stagger, and never replay after polling, focus refetch, filter, sort, search, tab return, or reordering.
- **Pending — owner:** Confirm Home/board determinate bars remain final-state-safe, begin at 40% visibility, reveal from the left/from empty over about 700 ms, and end at the exact displayed percentage.
- **Pending — owner:** Confirm user-clicked Workspace/Event Form panels use the 260 ms 8 px transition, Event Board phases use opacity only, and validation/template programmatic switches are instant with unchanged focus/scroll.
- **Pending — owner:** Confirm dialog, alert, menu, and select scale from 0.94 with opacity over 300 ms and close over 220 ms; confirm sheets enter over 300 ms and close over 220 ms without focus changes.
- **Pending — owner:** Confirm phase and Drive-preview disclosures interpolate for 260 ms, chevrons rotate for 220 ms, and collapsed descendants cannot receive keyboard focus or appear in the accessibility tree.
- **Pending — owner:** Confirm cards/rows lift 2 px, Buttons lift 1 px, arrows nudge 3 px, nav icons nudge 2 px, avatars scale to 1.05, theme icons rotate/cross-fade, badges brighten without moving, and the empty-state tiger breathes gently.
- **Pending — owner:** Confirm Complete/checkbox/switch activation pops without delaying the action and Undo bars enter without extending or delaying their timer/removal.

### Replay, Kanban, and progress

- **Pending — owner:** Confirm revealed IDs do not replay on polling, focus refetch, search, filter, sort, workspace tab return, Load older, optimistic move, Undo, or settlement; newly appended Load-more IDs reveal once on scroll.
- **Pending — owner:** Confirm Home progress arriving after first paint reveals once when it appears, then does not replay on later enrichment/refetch.
- **Pending — owner:** Confirm Kanban cards have hover/press feedback but no entrance. Confirm comments loaded by polling/Load older and task-detail unavailable/masked/real switches are instant.

### History, scroll, focus, and BFcache

- **Pending — owner:** Scroll Home, navigate away, use Back/Forward, and confirm scroll restoration and focus behavior are unchanged with no jump.
- **Pending — owner:** Confirm only the pathname-keyed content slot fades; sidebar, header, and navigation progress stay mounted.
- **Pending — owner:** Exercise `BfcacheGuard` with Back/Forward and confirm its existing reload/session behavior, focus, and scroll remain unchanged.
- **Pending — owner:** Keyboard-check dialog/menu/sheet/select Tab order, Escape/outside dismissal where supported, and focus return.
- **Pending — owner:** For dialogs, alerts, sheets, menus, selects, Board filters, and mention results, test X, Cancel, Escape, outside click, selection, successful submit, and programmatic close where supported. During closing, verify content is inert, pointer-disabled, non-submittable, and a quick reopen shows fresh current state.
- **Pending — owner:** With DevTools closed, repeat Back/Forward to exercise real BFcache behavior. The existing `BfcacheGuard` reload/session protection must remain unchanged and route arrival must stay opacity-only.

### Reduced motion

- **Pending — owner:** Enable reduced motion and confirm bars/ring show final values immediately; route/list, stagger, popup/slide, lift/scale, arrows/nav, avatar, theme, control pop, Undo entrance, tiger breathing, skeleton pulse, progress loop, and spinner rotation stop.
- **Pending — owner:** Confirm visible hover, focus-visible, pressed, validation, disabled, loading text, `aria-busy`, error, and retry feedback remain.

### Computed-style diagnosis

After a hard reload with motion enabled, verify:

```js
matchMedia("(prefers-reduced-motion: reduce)").matches // false
getComputedStyle(document.querySelector("[data-slot=button]")).transitionDuration // about 0.22s
getComputedStyle(document.querySelector(".motion-route-enter")).animationName // cc-route-enter
```

During initial display, inspect a list item (`cc-list-item-enter`), fill (`cc-progress-fill`), and ring (`cc-progress-ring`). Their computed durations should be 0.3 s, 0.7 s, and 0.7 s respectively.

For scroll reveal, inspect a below-fold row before and after entry. `data-motion-pending` may appear only after hydration and an observer callback reports it offscreen; it must be removed at reveal. Focus the row, use browser Find, and navigate to an in-page hash while it is pending; each must reveal it immediately. Disable `IntersectionObserver` before reload and confirm every row and progress value remains visible in its final state.

## Static-only checks and owner browser responsibility

The repository has no DOM testing library. Vitest therefore verifies pure reveal registries and source/static-render contracts only; it cannot execute real IntersectionObserver geometry, transition events, focus return, inert keyboard behavior, scroll restoration, or BFcache. Every browser result above remains **Pending — owner** until manually completed.

## Regression documents

Use `docs/phase-4b/step-2-tests.md`, `step-3-tests.md`, `step-3p-tests.md`, and `step-3h-tests.md`. No database test or Supabase action is required.
