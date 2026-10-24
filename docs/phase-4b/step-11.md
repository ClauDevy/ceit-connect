# Step 11: Event-board task actions

**Status:** Planned | **Branch:** `feature/event-board-task-actions` | **Reasoning level:** Medium for planning; High for the task-writer migration and SQL tests

## Goal

Let active Admins and Co-Admins add and edit tasks directly from an Active event board, and add the same Edit action plus task-record “Last updated” information to `/tasks/[taskId]`. Reuse the full Task Setup contract, create every new task as `To Do` at the destination lane tail, preserve committee scope, and enforce a real 200-task total-event capacity without weakening task parent immutability, the Active-event-has-a-task invariant, confidential-content rules, or the Archived freeze.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 11 is `feature/event-board-task-actions` and runs after Batch 10.
- It adds Add Task and Edit Task on the event page, plus Edit and updated-at information on the task page.

### Phase 4 carry-forward

- Phase 4 deliberately deferred “Add task from the board.” The follow-up must revisit safe single-task creation and total-event capacity.
- `create_event_with_tasks()` caps a new event’s initial payload at 200 tasks. `edit_event_with_tasks()` caps each submitted mutation list at 200 but does not cap the event’s total stored task count.
- The permanent contracts remain: an Active event has at least one task at transaction end, `tasks.event_id` is immutable, and Archived events and tasks are frozen.

### Owner clarifications for Step 11

- Add/Edit Task applies to **Active events only**. Draft tasks continue to use `/events/[eventId]/edit`.
- Active Admins may manage tasks from any committee. Active Co-Admins may manage only tasks in their own committee; writes remain committee-scoped.
- Reuse the full Task Setup fields. Do not expose a Status field.
- A new task always starts as `To Do` and is appended at the true server-owned lane tail.
- Status changes continue to use `move_task()`.
- Batch 13b’s completed-phase freeze must be able to block both Add Task and Edit Task.
- “Last updated” means the task row only. Comments and work links do not affect it.
- The `tasks.updated_at` design below is owner-approved for Batch 11.

## Current state

- `/events/[eventId]` is an Active-event Kanban backed by `list_event_board_tasks()`. It supports board moves and the established task controls but has no real Add Task or general Edit Task form.
- `/tasks/[taskId]` is backed by `get_task_detail()` and capability readers. It has specialized dependency, confidentiality, assignment, backup, archive-sharing, work-link, and comment controls, but no general task Edit button.
- The shared event form already implements the full Task Setup field model: title, description, committee, phase, priority, Deliverable/Live Operation type, due date, Philippine call/end times, primary assignees, confidentiality, and additional viewers.
- `tasks` has `created_at` but **does not have `updated_at`**. A 2026-09-27 migration explicitly removed a meaningless `updated_at` exception from the assignee guard because the column did not exist.
- New-task metadata and lane order are server-owned: the creation trigger derives `created_by` and appends `sort_order` at the destination lane tail.
- `tasks_z0_reject_event_id_changes` rejects every real task reparent. The Archived-task guard freezes all task writes beneath Archived events. Deferred constraints preserve at least one task for every Active event.
- The authoritative current Phase 4 inventory is Step 8’s exact eight postgres-owner-branch writers and 12 full direct task writers. Step 7A’s earlier exact five/nine assertions are historical. Any new direct writer changes the current full inventory; a postgres-owned definer writer may also change the owner-branch inventory and its exact allowed-column union.

## Scope: in / out

**In:** Active-board Add Task; Active-board Edit Task; task-page Edit action; full Task Setup fields; Admin-any-committee and Co-Admin-own-committee scope; fixed `To Do` creation; true lane-tail ordering; total stored capacity of 200 tasks per event; safe validation of assignees/viewers; Philippine timestamp handling; approved `updated_at` optimistic concurrency; board/detail refetch after success; future completed-phase compatibility.

**Out:** Draft task creation or editing outside the existing Edit Event page; Archived task writes; a Status field; direct status/rank writes from the form; dependency, backup, volunteer, comment, work-link, or archive-share redesign; task reparenting; empty-phase persistence; more than 200 tasks in one event; Phase 5 notifications; task Realtime; Batch 13b implementation itself.

## Database impact

Add a new tracked migration; never edit an applied Phase 3 or Phase 4 migration.

Use narrow, caller-session task mutation RPCs or an equivalently narrow database boundary for one-task creation and one-task editing. Prefer `SECURITY INVOKER` with the existing RLS and explicit active-role checks so general field editing does not require widening the postgres-owner assignee-guard exemption. The implementation must still pin function ownership, `search_path`, execute grants, affected-row counts, and the exact post-migration direct-writer inventory. If implementation instead requires a postgres-owned `SECURITY DEFINER` task writer, document why and expand the owner-branch function allowlist and allowed-column union only to the exact fields that writer needs.

For Add Task, lock and re-read the stored event, require `Active`, verify the active caller’s role and committee authority, serialize capacity with the event’s established task/advisory lock discipline, count all tasks independently of caller RLS, reject when 200 rows already exist, and then insert exactly one task. The database derives `event_id`, `created_by`, initial `status = 'To Do'`, and lane-tail `sort_order`; none is trusted from the browser. The 200-row check must be race-safe, not a UI count.

For Edit Task, identify the stored task first, require its stored parent to be `Active`, re-check Admin/owning-Co-Admin authority, and update only the approved Task Setup fields. Preserve stored `event_id`, `created_by`, `status`, `sort_order`, dependency, and backup state. Validate text lengths, enums, Live Operation timestamps, assignment limits, newly active versus retained inactive assignees, confidentiality/viewer rules, and no-op/stale writes. Do not reconstruct hidden task content in the client. An edit that does not change either assignee array keeps the established row-first parent/task locking path and does not rewrite those arrays.

Every Add/Edit Task writer that changes `primary_assignees` or `assist_assignees` must use Step 10's shared per-user advisory lock contract. For Add Task, form the affected-user set from the proposed primary/assist ids because no stored task exists. For Edit Task, first read the stored and proposed arrays without row locks and form the affected-user set from their union. Deduplicate the applicable set, sort it by UUID, and take every per-user transaction advisory lock in that order before any task or event row lock. Then take the established parent/event and, for Edit, task row locks and re-read the authoritative rows. Edit recomputes the affected-user set from the now-authoritative arrays plus the proposal; Add revalidates its proposed users after the event lock before inserting.

If the recomputed set differs from the set already locked, the database function must raise the specific retry error `CCL01` and make no mutation. It must never acquire the missing lock late in that transaction because doing so would break the global sorted order. The server route catches only `CCL01` and retries the whole function in a new transaction, which releases the earlier transaction-level locks, for a fixed maximum of three total attempts. Other errors are not retried. After the third `CCL01`, return a friendly “Assignments changed while saving. Please try again.” response without exposing database text or leaving the form busy.

The migration must make Batch 13b integration explicit: both new mutation entry points are ordinary writers that the completed-phase freeze must deny. Batch 13b’s writer catalog and phase-freeze tests must include their exact signatures rather than relying on UI hiding.

### Approved `tasks.updated_at` design

Add `tasks.updated_at timestamptz not null default clock_timestamp()` as a server-derived optimistic-concurrency token. A trigger advances it monotonically for every meaningful task-row change, including status moves, assignments, confidentiality, dependency, backup state, and general field edits. A write whose only effective change is `sort_order` preserves the old value, so same-lane reorder and rank rebalance remain silent. Comments, work links, volunteers, and other child-table writes do not change it.

The Edit Task RPC accepts the exact expected timestamp, locks the row, compares it without truncating precision, rejects stale saves, and returns the new token. Clients display `created_at` and `updated_at` in Philippine time and refetch authoritative board/detail/control state after settlement. The timestamp trigger must run safely with the activity trigger: status or other meaningful changes still produce one task activity row, while rank-only writes produce neither an `updated_at` bump nor activity noise. Direct attempts to forge only `updated_at` must collapse to the stored value or fail.

## Guards that must remain true

- Only active Admins and Co-Admins can Add/Edit; Members, inactive users, and profile-less callers cannot.
- Admins may target any committee. Co-Admins may target only their current committee, including when a stale form submits after their role or committee changes.
- Add/Edit applies only to the task’s real stored Active parent. Drafts stay on Edit Event; Archived writes remain impossible.
- New tasks always use the route event, caller-derived creator, `To Do`, and the true lane tail. The client cannot choose another event, creator, status, or rank.
- One event can store at most 200 tasks after every creation path. Concurrent attempts at 199 tasks cannot both create row 200.
- `tasks.event_id` and `created_by` remain immutable. The Active-event-has-a-task invariant and dependency deletion protections remain intact.
- Full confidential content is fetched only through the existing restricted readers. Masked shells expose no edit form or mutation capability.
- Newly added assignees/viewers must be active; permitted retained inactive assignees follow the established contract. Combined assignee and viewer caps remain enforced server-side.
- Status movement remains exclusively in `move_task()`; Edit Task cannot smuggle status or rank changes.
- Rank-only reorder/rebalance remains absent from the business activity log and does not advance `tasks.updated_at`.
- Batch 13b can freeze Add/Edit when a phase is complete without replacing or bypassing these entry points.
- Assignee-changing writes lock the complete sorted affected-user set before parent/task rows. A changed discovery set raises `CCL01`; it is never completed by taking late user locks. Non-assignee edits retain row-first locking and do not rewrite assignee arrays.

## Security risks

- A client-supplied event id, committee, creator, status, rank, expected timestamp, assignee list, or viewer list is untrusted. Re-read stored relationships and derive security fields server-side.
- Counting only RLS-visible rows lets a Co-Admin bypass the 200-task cap. Capacity must count every task in the stored event under the serialized database boundary.
- A count followed by an unlocked insert permits two concurrent creators to exceed 200. The check and insert require one shared serialization contract.
- An unlocked assignee snapshot can become stale before row locking. Recompute after the authoritative row re-read and restart the transaction on `CCL01`; taking only newly discovered user locks in place can invert the global order and deadlock another writer.
- An unbounded or broad retry loop can hide real validation failures and keep the request busy. Retry only `CCL01`, use three total attempts, and surface the fixed friendly message on exhaustion.
- A general definer writer can silently broaden the assignee guard. Prefer invoker security; otherwise pin the exact writer name and column union and reject every non-union column.
- Returning raw task rows to prefill an edit form can leak confidential content. Use the existing real-content and control readers, and show no form for masked/hidden results.
- A stale edit can overwrite a status, assignment, or confidentiality change made elsewhere. The recommended per-task concurrency token prevents blind last-write-wins behavior.
- An unconditional timestamp trigger would turn rank-only rebalances into false business edits and activity rows. Compare business columns before changing the token.
- Batch 13b runs later. If its phase guard omits the new RPCs, a completed phase could be mutated through a direct call even when the UI is read-only.

## Earlier test docs to re-run or update

The historical migration assertions stay in their applied files because each was true when it ran. Update current test documentation and the new migration’s final catalog assertion instead.

These files contain exact or superseded task-writer/owner-column assumptions and must be updated when Batch 11 lands:

- `docs/PHASE-4-STEP-5B-TESTS.md` — its sole-definer-writer assertion is historical; keep its move-only columns, rank noise, and lock tests.
- `docs/PHASE-4-STEP-7-TESTS.md` — update the supersession note and current writer/owner-column interpretation; rerun dependency/confidentiality and raw forward-gate coverage.
- `docs/PHASE-4-STEP-7A-TESTS.md` — update the historical exact nine-writer note; rerun assignment, deletion, last-task, Backlog, and activity coverage.
- `docs/PHASE-4-STEP-8-TESTS.md` — replace Step 8 TEST 1 as the authoritative current exact inventory with the new Batch 11 inventory, while retaining the exact six-column owner branch if the new writers are invoker-security.
- `docs/PHASE-4-STEP-10-TESTS.md` and `docs/phase-4/step-10-database-review.md` — expand current function/direct-writer allowlists and counts; keep the original Phase 4 results historical.

Also rerun the relevant behavior in `docs/PHASE-4-STEP-1A-TESTS.md`, `docs/PHASE-4-STEP-1-TESTS.md`, `docs/PHASE-4-STEP-2-TESTS.md`, `docs/PHASE-4-STEP-3-TESTS.md`, `docs/PHASE-4-STEP-5A-TESTS.md`, `docs/PHASE-4-STEP-5B-TESTS.md`, `docs/PHASE-4-STEP-6-TESTS.md`, `docs/PHASE-4-STEP-7-TESTS.md`, `docs/PHASE-4-STEP-7A-TESTS.md`, `docs/PHASE-4-STEP-8-TESTS.md`, and `docs/PHASE-4-STEP-9-TESTS.md` for raw access, archive/invariant enforcement, masking, derived metadata, parent immutability, lane order, activity noise, confidentiality, assignments, backup state, and proof that comments do not change task timestamps.

Batch 13b must later add Batch 11’s RPCs to its completed-phase writer matrix and rerun Batch 11’s Add/Edit cases against a completed phase.

## Test deliverable

Create `docs/phase-4b/step-11-tests.md` when the batch lands. Include one self-contained rollback-safe Dev SQL paste ending in the required intentional `TEST RESULTS` exception plus focused application tests and a manual checklist.

Cover 0, 199, 200, and attempted 201 task totals; two serialized creation attempts at 199; Admin-any-committee and owning/non-owning Co-Admin cases; Member, inactive, and profile-less denial; Active/Draft/Archived parents; stale role/committee/event/task state; forged event/creator/status/rank; `event_id` immutability; lane-tail placement with RLS-hidden rows and rank exhaustion; new/retained inactive assignees; confidential viewer validation; malformed Live Operation timestamps; no-op and stale edits; and exact affected-row counts. For assignee changes, prove the unlocked discovery set includes stored and proposed primary/assist ids, all unique user locks are sorted and precede row locks, an authoritative set change raises `CCL01` without a write, and no late lock is acquired.

Add route tests proving `CCL01` starts a new transaction and succeeds when a later attempt stabilizes, only `CCL01` is retried, and three consecutive retry errors produce the friendly try-again response with no partial mutation or stuck busy state. Prove an edit that does not change assignees follows the row-first path and never rewrites either array.

Test insert defaults, meaningful field changes, status moves, dependency/assignment/confidentiality/backup changes, rank-only moves and rebalances, child-table comment/work-link changes, forged timestamp input, microsecond stale detection, one activity row for a meaningful update, and zero activity/timestamp change for rank-only writes.

Assert the exact current direct-writer set, owner-branch writer set, owner-column union, trigger order, function security/search paths/grants, no overloads, and 200-cap serialization. Preserve the Active-event invariant, archive freeze, raw access, dependency gate, and board/detail masking tests.

## Manual checklist

- As an Admin, add a task for several committees from an Active board. Confirm each starts in `To Do`, appears at the correct phase/lane tail after refresh, and opens with the submitted real content.
- At 200 tasks, confirm Add Task is unavailable or fails safely without creating a row. Confirm 199 permits exactly one final task.
- As an owning Co-Admin, add and edit an own-committee task. Attempt another committee through the UI and a direct RPC call; both must fail.
- As a Member, inactive officer, profile-less user, and masked confidential viewer, confirm Add/Edit controls are absent and direct calls fail without content leakage.
- Confirm Draft tasks are still edited only through Edit Event and Archived event/task pages remain read-only.
- Edit every Task Setup field, including Philippine Live Operation times, assignments, and confidential viewers. Confirm status, dependency, backup state, parent, creator, and order remain unchanged.
- Change a task’s status through the existing move control; confirm Edit Task still has no Status field and the board order remains authoritative.
- Verify meaningful task changes advance Last updated; rank-only reorder, comments, and work links do not.
- Race an assignee change against another assignment writer; confirm the first stale set returns `CCL01`, the route retries in a new transaction, and forced three-attempt exhaustion shows the friendly try-again message without taking a late user lock.
- After Batch 13b lands, complete a phase and confirm Add/Edit is absent or denied for that phase until the approved reopen flow runs.

## Acceptance

Active Admins can add or edit a task from the event board and edit the same task from its detail page. Active Co-Admins can do so only for their committee. New tasks are validated, capacity-safe, caller-derived, `To Do`, and at the true lane tail. Edits use the complete Task Setup model without changing status, rank, parent, creator, dependency, or backup state. Assignee-changing edits acquire the complete sorted user-lock set before row locks and restart outside the function on `CCL01`; unchanged-assignee edits retain row-first locking. The approved `tasks.updated_at` token advances for meaningful task-row changes including status, but not rank-only or child-table changes. Drafts remain on Edit Event, Archived rows remain frozen, every Active event retains a task, writer inventories are current, and Batch 13b has an explicit integration point.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-11-tests.md`.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with the one-task mutation boundary, 200-task total cap, exact current writer inventories, and approved timestamp contract.
- Apply the listed supersession/current-catalog updates to the five Phase 4 test/review documents without rewriting their historical migration results.
- Add the Batch 11 objects to the authoritative Phase 4B catalog test scheduled after Batch 13b and to Batch 14’s expanded Step 10 allowlists.
