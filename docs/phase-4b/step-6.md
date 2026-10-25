# Step 6: Mobile board

**Status:** Implemented locally | **Branch:** `feature/mobile-board` | **Reasoning level:** High

## Goal

Give the fully loaded event board a phone-first horizontal scroll-snap layout, independent transient column collapse, and deliberate handle-only touch drag-and-drop. Preserve real task links, desktop drag, Move-to, circular Completed, Backlog, filters, masking, permissions, ordering, optimistic updates, rollback, and Undo.

## Owner decisions

- Phone touch drag-and-drop is in scope. A plain horizontal swipe only navigates columns and never changes task status.
- Use a dedicated 44px phone handle, not card-wide drag or long-press. The handle is a sibling of the stretched task link and is the only element with `touch-action: none`, `user-select: none`, and `-webkit-touch-callout: none`.
- Collapse is independent component-local state and resets on reload/navigation.
- A collapsed lane remains a valid drop target. A cross-lane drop appends at its authoritative destination tail with null neighbor hints for every role; `move_task()` remains authoritative.
- Batch 6 adds no completed-phase lock. Until Batch 13b lands, phone drag preserves today's desktop drag and Move-to behavior. Batch 13b owns the future read-only capability change.

## Implementation

### Phone strip and cue

- One `overflow-x-auto` strip contains To Do, In Progress, and Completed as nearly full-width `snap-start` targets below `md`; desktop retains its three-column grid.
- `IntersectionObserver`, rooted at the strip, selects the greatest visible ratio and breaks ties by distance to the strip center. It uses no timer.
- The visible `Column n of 3 · Status` label, three shape-changing position marks, and neighbouring-lane edge peek provide a non-color-only cue.
- The board reader remains one complete query with no paging or virtualization. Phase and priority selection filter the cached result; the Admin committee filter intentionally requests one complete committee-scoped result.

### Collapse and motion

- Each header keeps its label and data-derived count plus a 44px phone expand/collapse button with `aria-expanded`, `aria-controls`, accessible naming, focus, hover, and pressed feedback.
- Shared `MotionPresence` owns the whole card-stack disclosure. The closing snapshot is inert and `aria-hidden`, removal is driven by `transitionend`, and reduced motion reaches the final state immediately. Reopening provides one whole-region reveal; cards receive no individual entrance or stagger.
- The shared grid-row `Collapse` is intentionally not used because a fully loaded lane may contain many cards and interpolating its full height would create avoidable layout work.
- Collapse never changes the query, task arrays, filters, permissions, ordering, or counts.

### Touch drag

- The pinned dnd-kit `PointerSensor` already supports primary mouse, pen, and touch pointers; the existing 8px activation distance and KeyboardSensor remain. A second TouchSensor is not added because it would overlap the existing pointer activator.
- Eligible cards render a separate 44px handle below `md`; the existing desktop handle and desktop pointer/keyboard paths remain. Handle clicks always prevent default and stop propagation, so tap/release and the click following a drag cannot activate the sibling link.
- Ordinary card/link touch behavior remains native. Vertical scroll, horizontal strip swipe, link tap, and link context behavior outside the handle do not activate drag.
- dnd-kit's built-in scrollable-ancestor auto-scroll moves the phone strip near its edges. Scroll snapping is suspended only during drag and restored on every terminal path.
- The existing DragOverlay is the preview and existing droppable ring is the visible target. Script-driven overlay drop animation and preview scale are removed under reduced motion.

## Move path and duplicate guard

Touch, desktop pointer, and keyboard drops share `handleDragEnd()`, `createDropMoveIntent()`, `submitMove()`, and the unchanged `move_task()` call and payload. The existing optimistic cache update, rollback, safe feedback, settlement invalidation/refetch, and client-only Undo bar are unchanged.

The same synchronous `boardBusyRef` used by mutations is acquired while a drag is active. This pauses the 15-second polling interval and focus refetch, blocks a second operation, and is released without a timer on cancel/no-op drop or transferred immediately into the mutation lock on a valid drop. A successful refetch that was already settling when pickup began cancels the drag conservatively.

One gesture can submit at most once: dnd-kit has one terminal end/cancel path, the drag snapshot is cleared before intent creation, and `tryAcquireBoardOperation()` rejects any second same-tick drag, Move-to, Completed, Claim, or Undo submission through settlement.

## Cancellation contract

No move is submitted and snapping is restored for:

- outside/invalid drop;
- Escape, dnd abort, `pointercancel`, or lost pointer;
- hidden/background tab, `visibilitychange`, or `pagehide`;
- resize or orientation change;
- phase, priority, committee, or collapse change;
- component unmount; and
- any authoritative query update during drag, including task removal, masking, Backlog conversion, phase/status change, or permission loss.

Custom cancellation remounts the DndContext so stale sensor state cannot later finish a move. `handleDragEnd()` also revalidates the snapshot, current task, current permission, target status, and query update marker before creating an intent.

## Security and permission matrix

UI capability hiding is supplementary. `move_task()` independently rechecks the active profile, role, committee ownership, Draft/Active lifecycle, stored phase/status freshness, dependency direction, Member tail-only rules, neighbor boundaries, and task existence.

| Case | Handle and result |
| --- | --- |
| Active Admin, unfiltered, real lane card | Reorder or status change |
| Active owning Co-Admin, unfiltered, real lane card | Reorder or status change |
| Active assigned Member, real lane card | Status change only; destination tail |
| Other Co-Admin or unassigned Member | No handle; RPC also denies |
| Masked shell or Backlog card | No handle |
| Admin committee filter active | Drag disabled because safe neighbor ordering needs the complete unfiltered lane; Move-to remains |
| Incomplete prerequisite | Handle follows ordinary permission; invalid forward move rolls back with existing dependency feedback, backward move remains valid |
| Collapsed destination | Cross-lane move uses null hints and appends at the server-authoritative tail |
| Inactive/profile-less/unavailable lifecycle | No authorized board move; RPC denies independently |
| Completed named phase before Batch 13b | Exactly the same capability and result as current desktop drag and Move-to |

## Dataset and count rules

- Fully loaded means the complete authorized result for the current reader query, not every phase rendered at once and not committees excluded by the Admin committee filter.
- Lane counts are the current phase's assigned cards after current priority and server committee filtering. Backlog retains its independent count.
- Masked rows remain opaque and continue through the same phase/status grouping without exposing protected priority, committee, due date, or assignees.
- Across phase navigation, every returned task belongs to exactly one appropriate lane or Backlog surface. Collapse, swipe position, drag cancellation, polling, and focus settlement do not duplicate or remove cards.
- Existing `sort_order, id` reader ordering and complete-lane neighbor calculations remain unchanged.

## Tests

- Pure tests cover active-column selection/ties, collapse independence, filtered lane partitioning, shared operation locking, authoritative drag cancellation, and collapsed-lane tail intents.
- Static source contracts cover handle/link separation, handle-only touch suppression, refetch pausing, MotionPresence/reduced motion, all snap-restoration listeners and cleanup, and the mounted collapsed drop target.
- Existing permission, neighbor, optimistic placement, polling, safe error, and Undo tests remain and are extended rather than replaced.
- `docs/phase-4b/step-6-tests.md` records automated results and the required Android Chrome/iOS Safari checklist.
- Phase 4 Step 6 reader/RPC SQL remains unchanged. No migration or Supabase command belongs to this batch.

## Acceptance

On phones, users can swipe among three clearly identified snap columns, collapse each independently, and deliberately drag eligible cards from a dedicated handle with edge auto-scroll and a preview. A swipe never moves a task. Collapsed destinations append through the same authoritative writer. Every cancellation path restores snapping and submits nothing; one gesture submits at most once. Real links and fallback controls remain available, desktop behavior is preserved, and the board remains fully loaded and confidential-safe.

## Open questions

None.

## Docs updated with this batch

- `docs/PHASE-4B-PLAN.md`
- `docs/PROGRESS.md`
- `docs/phase-4b/step-6-tests.md`
- One future regression note in `docs/phase-4b/step-13b.md`
