# Step 3H: Home event progress

**Status:** Implemented locally; owner gate pending | **Branch:** `feature/home-event-progress` | **Reasoning level:** High

## Goal

Give each Active Home event card a lightweight summary of its current phase, task progress percentage, open backup requests visible to the caller, and Backlog count through one safe batched reader. The implementation preserves event visibility, confidential masking, and Batch 3P paging.

## Final contract

- `list_home_event_progress(uuid[])` accepts 1–20 event ids, derives the caller from `auth.uid()`, and returns aggregates only for caller-visible Active events. Draft, Archived, unknown, and inaccessible ids produce no row. Duplicate ids are de-duplicated while preserving first input order.
- A null/empty/over-20 array or an array containing null raises `22023`. A missing, inactive, or profile-less caller raises `42501` before any event result is returned.
- The function is `STABLE SECURITY DEFINER`, owned by `postgres`, has `search_path = ''`, has no overload, and is executable only by `authenticated`.
- Current phase is the first canonical phase with at least one non-Completed task, using the board's first-seen order over tasks sorted by `sort_order, id`. Canonical phase identity is `coalesce(nullif(btrim(phase), ''), 'Unphased')` and comparisons are case-sensitive. `Unphased` therefore appears wherever its earliest task appears; it is not forced first or last.
- If every task is Completed, the label is `All phases complete`. An event with no tasks has no phase label. A completed `Unphased` bucket contributes to the all-complete result but remains unlocked under Batch 13b; “never completes” in 13b is a write-freeze rule, not a Home-label exception.
- Progress is `round(completed::numeric * 100 / total)` and is zero for a zero-task event. Every real or masked task contributes to total, completed, current-phase, and Backlog aggregates.
- Backlog means `coalesce(cardinality(primary_assignees), 0) = 0 and status <> 'Completed'`, matching the board. Assist assignees do not remove a task from Backlog.
- Open backup requests are incomplete tasks with `request_backup is true` for which `task_content_access_for_user(...) = 'real'`. The card says **Backup requests you can see**. A caller who receives only a masked shell intentionally sees a lower backup count; this prevents the backup state of confidential content from leaking.
- Home passes only the Active ids in each visible 20-item page and skips the RPC when that page contains none. A progress read failure leaves the page usable and marks those Active summaries unavailable. Draft cards are unchanged.

## Implementation

- Migration: `supabase/migrations/20261025120000_home_event_progress.sql`.
- Server page enriches its first Batch 3P page with one RPC. Client Load more enriches each subsequent page before append, preserving the existing lookahead, ordering, de-duplication, reset, and cancellation behavior.
- Active cards use one compact phase/progress/count block with semantic tokens. Existing priority/status chips and card actions are unchanged.
- The reader does not return task ids, titles, descriptions, assignees, committee data, or per-task backup state. It does not replace or invoke `list_event_board_tasks()` and does not alter any table, policy, trigger, writer, or existing function.

## Tests and inventory

- `docs/phase-4b/step-3h-tests.md` contains three independent rollback-safe Dev SQL pastes with expected result-line counts of 18, 19, and 20. Each has its own auth fixtures, impersonation, immediate deferred-constraint checks, and intentional final `TEST RESULTS` exception.
- The third paste deletes its zero-task event's only task, reads the zero-task result, reinserts the task, then fires deferred constraints with `set constraints all immediate`. The existing guard is an `AFTER DELETE DEFERRABLE INITIALLY DEFERRED` constraint trigger, so no trigger is disabled or weakened.
- Focused application tests cover row validation/merging, 20-id selection and Draft skipping, safe failure behavior, migration contract, exact numeric percentage arithmetic, card values, accessible progress, and unavailable state.
- Batch 3H adds exactly one authenticated `SECURITY DEFINER` function. Batch 0 had already moved the post-Phase-4 source inventory from 57/35 to 58/36 functions/authenticated executables; 3H moves it to 59/37. Policy, trigger, and reviewed-table counts remain 11, 20, and 8; overload failures remain 0. The historical Phase 4 `57 / 8 / 11 / 20 / 0` record remains unchanged and is labeled historical.

## Manual checklist

- As Claudee (Admin), Claude HAAAA (Co-Admin), and tv (Member), test Home in light and dark themes at phone and desktop widths.
- Confirm Active cards show the phase, integer progress, **Backup requests you can see**, and Backlog values; compare them with the same board state.
- Confirm zero tasks has no phase, all-complete events say `All phases complete`, and mixed/case-sensitive/Unphased ordering follows the board.
- Confirm Draft cards have no summary changes and inaccessible/Archived events do not gain visibility.
- Confirm confidential tasks affect progress, Backlog, and phase without exposing content; confirm masked viewers do not receive their backup-request count.
- Confirm loading geometry, unavailable summaries, initial failure, Load more failure/retry, links, menus, ordering, and focus remain usable.

## Acceptance and release state

The implementation is local only. No Supabase command was run, no remote migration was applied, and no Dev or Prod verification is claimed. The owner runs the documented gate and applies the migration separately.
