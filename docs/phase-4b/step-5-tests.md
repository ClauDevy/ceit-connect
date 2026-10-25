# Step 5: Motion polish — test record

**Status:** Automated verification complete locally; every browser result is pending the owner  
**Branch:** `feature/motion-polish`  
**Database/Supabase:** No change; no Supabase command run

## Contract under test

- Route: opacity only, 300 ms. First 20 list items: opacity plus `translateY(10px)`, 300 ms, 40 ms stagger through item 8 and a 280 ms cap for items 9–20.
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)`; entrance fill mode: backwards only; normal CSS holds the final state.
- Interaction transitions: 220 ms. Progress bar/ring reveal: 700 ms ease-out. The ring's `stroke-dashoffset` is the only approved entrance exception to opacity/transform.
- Reduced motion shows final values immediately and removes lift, scale, stagger, slide, rotation, looping, and breathing.

## Automated coverage

- Duration/easing variables; 10 px entrance; delay values 0–280 ms; eight-item stagger cap; 0/1/19/20/21 boundaries.
- One counter across flattened sections/phases and identical roster eligibility in desktop/mobile renderers.
- Server-initial capture; first settled non-placeholder successful client capture; placeholder, initial-error retry, and later-page exclusion.
- Button hover/press shared contract; progress bar final width plus mount-only class; ring final dash offset plus mount-only class; no `setTimeout` or `requestAnimationFrame` motion loop.
- Reduced-motion-safe skeleton, loading, route/list, progress, overlay, interaction, theme, navigation, avatar, badge, control, Undo, and tiger contracts.
- Existing board move, paging, form, and UI regressions remain applicable.
- Final focused run: **7 files, 30 tests passed**. `npm run lint` passed with no reported issue. `npm run build` passed on Next.js 16.3.4, including TypeScript and all 23 generated routes.
- The production CSS contains `cc-route-enter`, `cc-list-item-enter`, `cc-progress-fill`, `cc-progress-ring`, the capped delay class, the interaction class, and the reduced-motion media rule. Its minified variables are `.3s`, `.22s`, and `.7s`.

## Browser checklist — all pending owner

### Slow-motion desktop check (DevTools Animations at 10%)

- **Pending — owner:** Use a desktop viewport, set DevTools Animations playback to 10%, and confirm route fade is 300 ms opacity-only.
- **Pending — owner:** Load 21+ items. Items 1–8 should step by 40 ms; items 9–20 should share item 8's 280 ms delay; item 21 must not animate. Confirm no visible route/list double-pop.
- **Pending — owner:** Confirm Home/board determinate bars reveal from the left and the board ring reveals from empty over about 700 ms, ending at the exact displayed percentage.
- **Pending — owner:** Confirm dialog, alert, menu, and select scale from 0.94 with opacity over 300 ms; confirm sheets slide over 300 ms without focus changes.
- **Pending — owner:** Confirm cards/rows lift 2 px, Buttons lift 1 px, arrows nudge 3 px, nav icons nudge 2 px, avatars scale to 1.05, theme icons rotate/cross-fade, badges brighten without moving, and the empty-state tiger breathes gently.
- **Pending — owner:** Confirm Complete/checkbox/switch activation pops without delaying the action and Undo bars enter without extending or delaying their timer/removal.

### Replay, Kanban, and progress

- **Pending — owner:** Confirm no entrance replay on polling, focus refetch, search, filter, sort, workspace tab return, Load more, Load older, optimistic move, Undo, or settlement.
- **Pending — owner:** Confirm Home progress arriving after first paint reveals once when it appears, then does not replay on later enrichment/refetch.
- **Pending — owner:** Confirm Kanban cards have hover/press feedback but no entrance. Confirm comments loaded by polling/Load older and task-detail unavailable/masked/real switches are instant.

### History, scroll, focus, and BFcache

- **Pending — owner:** Scroll Home, navigate away, use Back/Forward, and confirm scroll restoration and focus behavior are unchanged with no jump.
- **Pending — owner:** Confirm only the pathname-keyed content slot fades; sidebar, header, and navigation progress stay mounted.
- **Pending — owner:** Exercise `BfcacheGuard` with Back/Forward and confirm its existing reload/session behavior, focus, and scroll remain unchanged.
- **Pending — owner:** Keyboard-check dialog/menu/sheet/select Tab order, Escape/outside dismissal where supported, and focus return.

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

## Regression documents

Use `docs/phase-4b/step-2-tests.md`, `step-3-tests.md`, `step-3p-tests.md`, and `step-3h-tests.md`. No database test or Supabase action is required.
