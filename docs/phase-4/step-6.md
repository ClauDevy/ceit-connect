# Step 6 — Desktop drag-and-drop and mobile status controls

**Status:** Gate-critical.

- Add dnd-kit to the desktop board. Optimistically move, persist only through Step 5b, and roll back clearly on conflict/error. No drag-to-delete.
- On real phones, use the prototype circular tap control to mark eligible tasks Completed; provide accessible non-drag controls for keyboard/screen readers, including backward moves. UI mirrors but never replaces RPC checks.
- Completing a prerequisite unlocks forward movement after invalidation/refetch. Moving it backward never auto-reverts a dependent. No unlock/status notifications.
- After success show `Moved to <lane> · Undo` for about eight seconds. Undo is client-only and submits a normal Step 5b move under current permission, dependency, event-state, and archive checks. Cross-lane Undo targets the previous lane. For a same-lane reorder, retain the task's previous neighbor ids and resubmit them as placement hints; when the card started first or last, the absent previous or next id explicitly represents that boundary. Step 5b validates the remaining neighbor is still at that boundary before choosing the rank server-side. No undo RPC/history. If another user moved/removed a neighbor, changed the task, invalidated the boundary, or the RPC otherwise rejects the reversal, show a clear message, refetch, and never force the old state.
- **Database impact:** none. New migration: **no**. Writes use Step 5b; freshness uses Step 2 focus/polling.
- **Guards that must remain true:** Archived moves fail; no drag delete or event/dependency/assignee mutation; confidential responses reveal no hidden fields.
- **Security risks:** optimistic/local undo state is not authorization. Never trust source, destination, status, dependency, role, or prior state; prevent doubles, clear pending state, and reconcile to server state. Undo never overwrites newer data.
- **Test deliverable:** `docs/PHASE-4-STEP-6-TESTS.md` follows the global contract for move permissions and adds manual pointer/keyboard, real-phone, backward-status, polling, offline/error rollback, accessibility, successful/expired cross-lane Undo, successful same-lane Undo between two neighbors, Undo to the first and last positions using one missing boundary neighbor, and stale/removed/forged/non-boundary-neighbor rejection with a clear message and refetch.
- **Acceptance:** approved moves work on desktop/keyboard/phone; forbidden and blocked moves explain failure; backward moves work without auto-revert; boards converge; every success offers time-limited normal-RPC Undo; same-lane reorders restore middle/first/last positions only through revalidated neighbor or boundary hints, and stale Undo refreshes rather than forcing.

[Back to Phase 4 index](../PHASE-4-PLAN.md)
