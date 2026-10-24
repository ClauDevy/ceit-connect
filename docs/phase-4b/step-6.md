# Step 6: Mobile board

**Status:** Planned | **Branch:** `feature/mobile-board` | **Reasoning level:** Medium

## Goal

Improve only the event board's phone layout with native horizontal scroll-snap navigation and independently collapsible status columns. Keep task cards as real links, keep the complete Kanban loaded, and preserve every existing task-move control and permission rule.

## Decisions

- Batch 6 is `feature/mobile-board`: swipeable columns on phones and independent column collapse.
- Kanban stays fully loaded; list paging does not apply.
- A swipe changes the viewed column only. It never changes task status.
- Collapse state is component-local and resets on navigation or reload.
- Task cards remain ordinary real links with standard tap, keyboard, open-in-new-tab, and browser-context behavior.
- The existing Move-to control and circular Completed control keep their current behavior. Phone touch drag-and-drop is out of scope.

## Current state

- `src/components/events/event-board.tsx` renders the board, filters, Backlog, three status lanes, polling, drag-and-drop, optimistic moves, and Undo.
- `src/components/events/event-board-task-card.tsx` renders real linked cards, capability-driven move controls, claim behavior, drag state, and the phone completion affordance.
- The current board is fully loaded through `list_event_board_tasks`; no board paging is planned.

## Scope: in / out

**In:** phone horizontal scroll snap; clear column labels, counts, and position cues; independent transient column collapse; responsive loading/empty/error/masked states; real card links; and preservation of all current phone move controls.

**Out:** desktop redesign; swipe-to-move; phone touch drag-and-drop; Kanban paging or virtualization; persisted collapse; replacement card-link behavior; new mutations, permissions, readers, or server actions.

## Database impact

None. This is responsive layout and transient client state over the existing board reader and `move_task()` writer.

## Mobile layout behavior

- One horizontal scroll container holds To Do, In Progress, and Completed as snap targets.
- Each column retains its visible label and count plus a non-color-only cue that more columns are available.
- Each column has an accessible expand/collapse control. Collapse changes no task, count, filter, or permission.
- Vertical card scrolling, horizontal column swiping, card links, and sibling action controls do not trap or activate one another.
- Cards remain real links; independent buttons are accessible siblings and meet the 44px phone-target rule.

## Guards that must remain true

- Filters, phases, Backlog classification, masking, counts, and lane ordering operate on the complete result.
- Only the existing Move-to and circular Completed controls mutate status through `move_task()`.
- Desktop pointer and keyboard drag-and-drop remain unchanged.
- Off-screen and collapsed content receives the same masking and capability checks as visible content.
- Phase-completion behavior delivered later by Batch 13b remains authoritative.

## Security risks

> **Rebuilt, please verify:** this short risk section was reconstructed from the current board implementation and session requirements because the exact earlier prose was not available in Git.

- Collapsing or moving a column off-screen must not change which cards were fetched, weaken masking, or retain newly forbidden content after an authoritative refresh.
- Gesture and action separation must not turn one tap, keypress, or retry into both navigation and a task mutation. Existing pending/busy guards continue to prevent duplicate status submissions.
- Counts and position cues are derived from the same complete authorized dataset as the cards; they must not reveal hidden tasks or be computed from a partial client page.

## Earlier test docs to re-run or update

- Re-run `docs/PHASE-4-STEP-6-TESTS.md`, board masking/lifecycle coverage, and the relevant Step 10E phone checks.
- Re-run the Phase 4B Step 3 event-board visual checklist after it lands. SQL tests remain unchanged.

## Test deliverable

Create `docs/phase-4b/step-6-tests.md` when the batch lands. Cover real-phone scroll snap, gestures versus links/actions, cues/counts, collapse/reset, loading/empty/error/masked states, both move controls, permission matrices, desktop regression, and full-board loading.

> **Rebuilt, please verify:** the duplicate-submission and complete-dataset cases below were reconstructed from the current board reader/writer contract because the exact earlier prose was not available in Git.

Explicitly prove that one activation produces at most one status submission; success, rejection, offline failure, Undo, polling, and focus refetch do not duplicate the mutation. Load a dataset large enough to span every lane and prove the board uses the complete result with no paging, every authorized task appears exactly once, no task card is duplicated during snap/collapse/refetch, lane ordering is unchanged, and counts match the full authorized dataset.

## Manual checklist

- At phone width in both themes, swipe through all three columns and verify predictable snap positions, cues, labels/counts, and no page overflow outside the board.
- Collapse/expand columns independently, change phase and filters, then reload; data remains correct and collapse resets.
- Verify vertical scrolling, horizontal swiping, ordinary card navigation, browser link behavior, phase tabs, filters, and Backlog do not conflict.
- Test all three roles, masked cards, successful moves, Undo, stale state, dependency rejection, read-only states, offline failure, polling, and focus refetch.
- With a complete multi-lane dataset, verify no paging controls or page-sized truncation, no missing or duplicate cards, stable lane order, and counts equal to the rendered authorized cards before and after collapse, filters, polling, and refetch.
- Rapidly activate each move control and simulate slow/offline responses; confirm exactly one submission and one final card placement.
- At desktop width, verify drag-and-drop, Move-to, lane layout, Backlog, filters, and task links are unchanged.

## Acceptance

Phone users navigate the fully loaded columns through horizontal scroll snap and independently collapse them until reload. Cards remain real links, swiping never moves a task, existing move controls remain authoritative, desktop drag-and-drop is unchanged, and both themes pass the mobile checks.

## Open questions for the owner

None.

## Docs to update when this lands

- Mark Step 6 results in this file and `docs/PROGRESS.md` only after implementation and verification.
- Add `docs/phase-4b/step-6-tests.md` after implementation.
