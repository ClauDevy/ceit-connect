# Step 6 tests: Mobile board

## Automated checks

Local gate on 2026-10-26 (Philippine time): Batch 6's three focused files pass 52/52 assertions; the production build completes all 23 routes; lint passes after the final cleanup. The full suite has 278 passing assertions and only the two pre-existing unrelated collection failures already recorded by Batch 3H/5: Vitest does not resolve existing `@/` runtime imports in `load-more-control.test.tsx` and `backup.test.ts`. Batch 6 does not modify those files or their behavior.

Static-only and pure-unit coverage verifies:

- active-column intersection/center tie resolution and one-based cue positions;
- independent transient collapse and filtered lane partition/count inputs;
- one-at-a-time operation locking and conservative cancellation after refetch, removal, masking, Backlog conversion, status change, or permission loss;
- collapsed cross-lane drops create tail-only intents with null neighbor hints;
- the phone handle follows the stretched link as an independent sibling control, is 44px, and alone carries touch/callout/selection suppression;
- every explicit end/cancel listener converges on the snap-restoring finish path, with separate unmount cleanup;
- drag uses the same polling/focus pause ref as mutations and adds no timer;
- shared reduced-motion preference controls dnd-kit's script-driven overlay drop animation; and
- existing permission, full-lane neighbor, optimistic placement, error mapping, polling, and Undo behavior remains covered by `board-move.test.ts`.

These checks do **not** prove physical gesture arbitration, browser link context menus, actual edge auto-scroll, Safari cancellation, app backgrounding, visible focus quality, or comfortable target size. Those require real devices.

## Real-phone setup

- Required: one physical Android phone with current Chrome.
- Strongly recommended when available: one physical iPhone with current Safari.
- Desktop device emulation is supplemental and does not replace a real-device pass.
- Recommended before commit/push: run the dev server on the LAN interface and use an existing Dev password account from a phone on the same Wi-Fi. The LAN origin has separate cookies from localhost/Prod. Magic-link or Google testing also requires that exact LAN `/auth/callback` origin in the Dev Supabase redirect allowlist, so password login is simpler.
- A Vercel Preview is convenient after the owner creates one. Its Preview variables must point to Dev, never Prod; Preview variables require a redeploy; and its URL or approved wildcard must be allowed by Dev Supabase for magic-link/Google callbacks. Deployment protection may require a Vercel login on the phone.

## Android Chrome and iOS Safari checklist

Run every available-device row in light and dark mode. Record device, OS, and browser version.

### Layout, swipe, and collapse

- Swipe To Do → In Progress → Completed and back. Each lane snaps predictably; `Column n of 3 · Status`, shape cue, and edge peek agree. No task moves and the page itself has no horizontal overflow.
- Scroll vertically and diagonally from card content. No drag begins unless the dedicated handle is used.
- Confirm every lane label/count remains visible when collapsed; collapse lanes independently, reopen them, change phase/filters, and reload/navigation. Counts remain data-correct and collapse resets only after reload/navigation.
- Verify reopening has one whole-region disclosure and no per-card entrance/stagger. Under reduced motion, final open/closed states appear immediately.
- Use a large multi-phase dataset. Across phase tabs and Backlog, every authorized returned task appears exactly once, lane ordering remains stable, and no paging/virtualization control appears.

### Links, controls, and accessibility

- Tap the card body to open the real task link. Long-press the card body/link and confirm normal browser link context behavior.
- Tap/release the drag handle without moving, then complete a drag and release. Neither action opens the task link or causes a delayed navigation.
- Confirm the handle, circular Completed control, Move-to trigger, collapse button, and adjacent phone controls measure at least 44×44 CSS pixels.
- Confirm the handle announces `Drag <task title>`, exposes pressed state while active, and has visible hover (where supported), pressed, and focus-visible states.
- With TalkBack or VoiceOver, use Move-to as the accessible alternative and verify ordinary task-link navigation remains available.

### Touch drag and auto-scroll

- As Admin, reorder within a visible lane and move across lanes. Refresh and confirm authoritative order.
- As owning Co-Admin, repeat on an own-committee task. Confirm another committee's card has no handle.
- As assigned Member, drag across statuses and confirm destination-tail placement; same-lane reorder produces no move.
- Hold the preview near both strip edges. The neighbouring column scrolls into view, the target is visible, and release drops once.
- Collapse a destination, drag from another lane, and drop on its dashed target. Reopen it and confirm the moved task is at the destination tail. Repeat for Admin, owning Co-Admin, and assigned Member where applicable.
- Verify masked, Backlog, unauthorized, and committee-filtered cards expose no handle. Verify the committee filter still leaves Move-to available.
- On a dependency-blocked task, an invalid forward drop rolls back with the existing dependency message; a permitted backward move still works.
- Before Batch 13b, a named phase whose tasks happen to be Completed retains exactly today's desktop drag and Move-to capability; Batch 6 adds no lock.

### Cancel, refetch, and duplicate protection

- Drop outside every lane; press Escape with a hardware keyboard where available; interrupt the touch; app-switch/background; lock/unlock; navigate away; rotate; and resize. Each path submits nothing, removes the preview, and restores column snapping.
- While holding a drag, change phase, priority, committee, or collapse state. The drag cancels before the state change and submits nothing.
- Start a refetch immediately before pickup and let that already-in-flight response settle during the drag, or use the explicit authoritative cache-update test path, including removing the card or revoking its move capability. The drag cancels immediately and never recreates or duplicates the card.
- Inspect Network: rapid/repeated releases, a second control activation, and a slow response produce at most one `move_task` request. Controls remain guarded through authoritative settlement.
- Work offline: the optimistic move rolls back once with the existing offline message. Restore connectivity and refetch; the card appears once in its authoritative lane.
- Complete a successful move and Undo within the existing window. Confirm one normal Undo RPC and one final card; expiry/stale failure behavior remains unchanged.

### Desktop regression

- Verify mouse and keyboard drag, Escape cancellation, three-column layout, lane order, filters, Backlog, task links, Move-to, Completed, dependency feedback, polling/focus settlement, and Undo behave as before.

### Future Batch 13b regression

- After Batch 13b lands, an authoritative completed-phase refresh must cancel any active phone drag, remove its handle/move controls, and keep touch drag identical to the new server-backed desktop/Move-to read-only capability.
