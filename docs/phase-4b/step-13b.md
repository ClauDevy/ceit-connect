# Step 13b: Phase completion

**Status:** Planned | **Branch:** `feature/phase-completion` | **Reasoning level:** High (security-critical derived freeze, writer guards, and tests)

## Goal

Derive completion from the tasks in each event phase. When every task in a phase is Completed, show a check and strikethrough on its tab, collapse it by default, and make it read-only while preserving task access and confidential masking. Provide one narrow Reopen RPC that moves one selected task to `In Progress` and unlocks the phase for an authorized Admin or the event-owning Co-Admin.

The stable run order for this group is **13, 13c, 13d, 13b**. Phase completion runs last so its freeze and writer catalog cover every task rule, Draft reader, event-deletion exception, and task writer added earlier.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Updates and audit resolutions

- When every task in a phase is Completed, the phase tab shows a check and strikethrough, is collapsed by default, and is read-only.
- Read-only means no moves, task edits, assignment changes, comments, link changes, or task mutations submitted through Edit Event. Edit Event may still save event metadata when it submits no task mutation for a completed phase. Members can still open the phase’s tasks to read them.
- Completion is derived from all tasks in the event+phase; there is no phases table and no stored completion flag.
- One Reopen RPC moves one chosen task to `In Progress`.
- Reopen callers are any active Admin or the active Co-Admin whose id equals `events.created_by`. If that Co-Admin is inactive, only Admins may reopen.
- Moving a task out of Completed unlocks the phase.
- The future Batch 15 dependency auto-revert path may unlock a phase automatically.
- Batch 13b needs database rules and tests, uses High reasoning, and is planned like the Archived freeze.

### Owner clarifications for Step 13b

- Canonical phase identity is `coalesce(nullif(btrim(phase), ''), 'Unphased')` with case-sensitive comparison.
- The completed-phase freeze applies to Draft and Active events.
- Archived events remain under the stronger Archived freeze and cannot be reopened.
- Completed-phase task and child mutations are blocked, including task mutations submitted through Edit Event. Edit Event may still change event metadata when it submits no mutation for a completed phase.
- The canonical `Unphased` bucket never completes or locks.
- Batch 3H's Home summary may display `All phases complete` when every task, including every `Unphased` task, is Completed. That display aggregate does not make `Unphased` complete for this batch and never activates the completed-phase freeze.

## Current state

- A phase is only `tasks.phase text`; no `phases` table or phase id exists. Empty phases are intentionally not persisted.
- The event board currently normalizes null/blank phase labels to `Unphased` in the UI and groups tabs by the resulting case-sensitive text.
- `tasks_lane_sort_order_key` and lane-tail helpers partition by stored `(event_id, phase, status)`, treating null consistently for rank uniqueness but not storing phase lifecycle state.
- `move_task()` is the narrow deliberate status/rank writer. Raw task status changes remain available only through RLS and the assignee guard, with the same forward dependency gate.
- Task writes also occur through Create/Edit Event, Batch 11 Add/Edit, dependency, confidentiality, assignment, deletion, self-leave, claim, backup, volunteer acceptance, and future Batch 13 leave/helper functions.
- Child writes occur through work-link, comment, volunteer, archive-viewer, and Batch 13 leave-request functions. Their tables are deny-by-default and have independent lifecycle guards.
- Archived event/task/child guards already provide the model for fail-closed database enforcement beyond UI capability hiding.
- Batch 13d runs first and introduces an approved whole-event deletion cascade for Draft/Archived events. Batch 13b must not block that exact deletion path or create a new one.

## Scope: in / out

**In:** canonical derived completion; Draft/Active database freeze; Archived precedence; phase-tab check/strikethrough/default collapse; read-only task detail and board capabilities; all normal task and child writers through Batch 13d; Edit Event and Batch 11 behavior; one Reopen RPC; event-creator Co-Admin ownership; confidential masking; concurrency and lock-order proof; current writer/trigger catalogs; regression and manual tests.

**Out:** a phases table; stored `is_completed`; manual “complete phase” action; reopening Archived events; dependency auto-revert or multiple prerequisites; notifications; Realtime; changing event ownership; branding; deleting events outside Batch 13d’s approved RPC.

## Derived phase model

For a stored task row, compute its canonical phase key as:

```sql
coalesce(nullif(btrim(phase), ''), 'Unphased')
```

Comparison is case-sensitive. `Setup` and `setup` are different phase keys. Whitespace-only and null values map to `Unphased`, which is always open and never participates in completion or freezing.

A persisted named phase is complete only when it contains at least one task and every task for the same `event_id` and canonical phase key has `status = 'Completed'`. `Unphased` always returns not complete. Because empty named phases have no rows, they cannot be complete or appear as database phases. Completion is always computed from authoritative rows independently of caller RLS.

Do not add a phase record or completion column. Add one restricted internal helper or equivalent repeated predicate that accepts the real stored event/phase identity, reads every task regardless of caller RLS, and returns only the derived boolean. Reuse one canonical expression everywhere so board grouping, guards, Reopen, Edit Event, and tests cannot disagree.

## Database freeze

Add one tracked security-critical migration after Batches 13, 13c, and 13d. Do not edit the Archived-freeze or historical task-writer migrations.

The database guard applies to Draft and Active phases and checks both the source and destination canonical phase where relevant:

- INSERT: reject adding a task to a phase that was already complete before the insert.
- UPDATE: reject every ordinary update whose stored source phase is complete; also reject moving/renaming a task into a different already-complete destination phase.
- DELETE: reject deleting a task from a complete phase.
- A valid final move from incomplete to Completed is allowed. That transaction makes the derived phase complete; later normal writes fail.
- The exact Batch 13d whole-event deletion cascade remains allowed. No individual task/child delete inherits that exception.
- Archived status is checked first. Archived operations keep the Archived error/guard semantics and never reach Reopen.

The freeze covers, at minimum, raw task writes; Create/Edit Event task mutations; Batch 11 Add/Edit; `move_task()`; dependency/confidentiality/assignment/deletion/self-leave; claim/backup/volunteer/acceptance; Batch 13 leave/helper writers; comments; work links; and every mutable task child introduced through Batch 13d. Archive-only viewer grant/revoke remains governed by the Archived access-sharing contract and must not become a route to mutate task content.

Capability readers must return false/no mutation state for a completed phase, but UI hiding is supplementary. Direct RPC calls and permitted raw SQL must fail at the database boundary.

### Edit Event and Batch 11

Keep completed-phase task data read-only through Edit Event as well as Batch 11:

- adding a task to an already-complete canonical phase is rejected;
- editing any task in a complete phase is rejected;
- renaming a complete phase, moving a task out of it, or merging another phase into it is rejected;
- deleting a task or the whole completed phase through Edit Event is rejected;
- renaming or moving a task from an incomplete phase into an already-complete canonical key is rejected; and
- Batch 11 Add/Edit receives the same database result and cannot bypass the rule through a different form.

A distinct phase whose key is not already complete may still be created. Event metadata such as name, dates, and description may be saved when the request submits no task mutation for a completed phase. Clients must not rely on submitting unchanged completed tasks through a broad payload: the server compares real stored rows and rejects actual completed-phase mutations.

## Reopen RPC

Add exactly one narrow authenticated Reopen RPC. It must:

- derive `auth.uid()` and require an active profile before task/event detail lookup;
- lock and re-read the stored event, canonical phase membership, task status, and derived completion;
- reject Archived, unknown, stale, non-complete, non-Completed-target, or unauthorized cases with stable safe errors;
- authorize any active Admin;
- authorize a Co-Admin only when that caller is active, still has role `Co-Admin`, and their id equals the stored `events.created_by`;
- not infer ownership from any task committee, even when a phase contains tasks from several committees;
- move exactly the selected task from `Completed` to `In Progress` at the true server-owned destination lane tail;
- produce exactly one ordinary task activity entry attributed to the initiating caller; and
- return only the selected task id/status/order and the authoritative unlocked phase state needed for reconciliation.

If the event creator is inactive, no longer a Co-Admin, or absent, only an active Admin may reopen. The RPC is not available on Archived events. It is the only exception that may move a task out of a currently complete Draft/Active phase until Batch 15 adds its separately approved automatic-revert path.

The phase guard’s Reopen exception must be non-forgeable. Do not exempt every postgres-owned definer writer. Use an exact execution boundary pinned by function owner/role or another catalog-testable mechanism that direct authenticated SQL and other task RPCs cannot reproduce.

## Lock order and concurrency

The implementation must add phase serialization without weakening or racing the existing archive, dependency, lane-order, and child guards.

- Archived task guarding runs before completed-phase permission. A row that became Archived while waiting fails as Archived.
- `move_task()` keeps its stored-event lock and existing per-event dependency/order advisory lock, then takes any phase-completion serialization required before task/lane mutation and re-checks derived completion under lock.
- Operations touching two canonical phase keys lock them in deterministic key order.
- Reopen follows stored event → existing event advisory key → deterministic phase key → task/lane rows, then revalidates before update.
- Deny-by-default child writers currently use task → event locking. Do not simply add a phase advisory wait after a task lock when another writer holds that phase lock and waits for the same task. Either refactor the affected narrow child writers to one proven order with post-lock revalidation or use an equivalent serialization design that cannot create this cycle.
- Raw task UPDATE necessarily acquires the task row before its `BEFORE` guards. Its already documented inversion against event-first RPCs remains retryable; the phase guard must re-check after any wait, and clients map `40001`/`40P01` by refetching authoritative state.
- Batch 13d event deletion locks the event before its approved cascade. The phase guard recognizes only that exact cascade and never waits in an order that lets a child writer and deletion hold mutually blocking locks.

The SQL tests must inspect function bodies and trigger order and include deterministic sequential-loser coverage. If true two-session testing is not added, document why the lock/catalog proof is sufficient rather than claiming untested concurrency.

## Confidential masking and readers

- Add derived phase-complete state to the minimum fixed-shape board/detail response needed by the UI, or provide one equally restricted phase-state reader. Do not expose raw task rows.
- Compute the authoritative boolean across all tasks, including confidential rows, independently of caller RLS.
- A masked task remains the same opaque `Confidential Task` shell. Completion must not expose title, description, assignments, access lists, dependency ids/labels, comments, links, volunteers, leave requests, or hidden mutation capabilities.
- Return no synthetic phase containing only hidden tasks to a caller whose lifecycle reader would otherwise return nothing. For visible phases, expose only the boolean/check needed by the approved UI, not hidden counts or task identities.
- Members retain read access to tasks they could already open. Completion removes mutation capabilities; it does not revoke content access.
- Draft behavior follows Batch 13c: privileged users see all Draft phases/tasks with confidential masking, while writes remain committee-scoped until the phase freeze blocks every normal writer.
- Archived readers may display already-derived completion presentation where their existing data supports it, but Archived remains read-only for its own stronger reason and has no Reopen capability.

## UI behavior

- A complete phase tab shows a check and strikethrough and is collapsed by default on initial load.
- A user may expand a complete phase and open its task links. Collapse is presentation only and does not hide tasks from accessible navigation.
- Move controls, Add/Edit, assignment, leave, backup, volunteer, dependency, confidentiality, comments, and work-link mutation controls are absent or disabled for complete phases according to the fixed-shape server capabilities.
- Authorized users receive one Reopen action. They choose one Completed task; success moves it to `In Progress`, removes the completed styling, expands/unlocks the phase, and refetches board/detail/control/child state.
- Unauthorized Members, non-owner Co-Admins, inactive users, profile-less users, and masked callers receive no Reopen capability.
- Polling/focus refresh can turn an open phase read-only or unlocked while the page is visible. In-flight mutation failures refetch and show a safe stale/frozen message.
- The UI never decides completion from only the currently filtered/visible cards or from an optimistic local subset.

## Guards that must remain true

- Derived completion uses every persisted task in the exact event+canonical phase, not caller-visible rows.
- No stored phase-complete flag or phases table is introduced.
- `Unphased` never completes or locks.
- Draft and Active completed phases reject every normal database writer. Archived remains governed by the stronger archive freeze.
- The only manual unlock is the approved Reopen RPC moving one selected task to `In Progress`.
- Reopen authorization uses `events.created_by` for the Co-Admin case, not task committees or `tasks.created_by`.
- A mixed-committee phase has one event owner for Reopen; committee heads do not gain ownership merely because their tasks are present.
- Raw status writes, `move_task()`, Edit Event, Batch 11, Batch 13, and child writers cannot bypass the freeze.
- The Batch 13d whole-event deletion cascade remains usable without permitting individual completed-phase deletion.
- Confidential masking and active/profile-less denial remain unchanged.
- Reopen produces one activity row; blocked attempts and rank-only rebalance produce none.
- The future Batch 15 automatic-revert exception is not preimplemented.

## Security risks

- Deriving completion through caller RLS lets a Co-Admin or Member ignore hidden incomplete tasks and freeze/unfreeze the wrong phase. Use an internal all-row decision.
- UI-only capability removal leaves every existing RPC as a bypass. Guard the task and child tables/functions at the database boundary.
- A broad postgres-owner exception would let unrelated definers mutate completed phases. The Reopen exception must identify one exact writer.
- Checking only the source phase lets a rename/add merge into a completed phase; checking only the destination lets a completed task escape its source phase.
- Comparing raw `phase` values inconsistently splits null, blank, or whitespace variants from the visible `Unphased` tab. Reuse the canonical expression exactly.
- A phase-completion lock added after a child task lock can deadlock with `move_task()` or Reopen. Prove one coherent lock order and retry behavior.
- Exposing aggregate completion for a fully hidden phase can reveal hidden work. Do not synthesize invisible phases or return counts.
- Letting Batch 13d cascade use a generic nested-trigger exemption can make direct deletes possible. Preserve its exact non-forgeable deletion context.

## Pinned tests and counts affected

Do not invent future numeric catalog or result-line counts before Batches 11–13d have landed. At implementation time, recount from the final source and update the current assertions below while keeping historical migration results labeled historical:

- `docs/PHASE-4-STEP-5B-TESTS.md` TEST 1: function/owner writer assumptions and move/lock catalog; retain movement behavior tests.
- `docs/PHASE-4-STEP-7-TESTS.md` TEST 1 and TEST 4: exact writer allowlist, owner-column union, trigger order, raw forward gate, and `move_task()` regression.
- `docs/PHASE-4-STEP-7A-TESTS.md` TEST 1: historical five-owner/nine-full-writer counts and reset-helper callers.
- `docs/PHASE-4-STEP-8-TESTS.md` TEST 1: the authoritative pre-4B eight-owner/12-full-writer counts; replace its current-state inventory with the post-13b exact set while preserving the former result as historical.
- `docs/PHASE-4-STEP-10-TESTS.md` 10A and relevant 10B–10D allowlists/result-line expectations: recognize the completed-phase helper, guard, Reopen writer, child/table changes, and final writer sets.
- `docs/phase-4/step-10-database-review.md`: keep the Phase 4 `57 / 8 / 11 / 20 / 0` result as historical and add only reviewed post-13b objects/counts after live Dev output exists.
- `docs/PHASE-4-STEP-10E-GATE.md`: recalculate any expected result-line counts only after the affected SQL documents are final; do not carry stale numbers forward.
- Batch 11, 13, 13c, and 13d test documents: add completed-phase denial or approved cascade cases without rewriting their pre-13b historical results.

The new authoritative Phase 4B catalog is created after Batch 13b and records the actual live Dev counts; this planning document does not predict them.

## Earlier test docs to re-run or update

- Phase 4 Steps 1/1A for archive/event deletion precedence and raw task paths.
- Phase 4 Steps 2/3 for board/detail presentation, masking, and Member reads.
- Phase 4 Step 4 for work-link freeze.
- Phase 4 Steps 5A/5B/6 for phase/status/order, dependency gates, moves, Undo, and activity silence.
- Phase 4 Steps 7/7A/8 for dependency, confidentiality, assignment, deletion, leave, claim, backup, volunteers, exact writers, and reset behavior.
- Phase 4 Step 9 for comment add/edit/delete freeze.
- Phase 4 Step 9A for feed status changes after Reopen.
- Batch 11 for Add/Edit task denial and task timestamp behavior.
- Batch 12 for activity attribution and masked history.
- Batch 13 for leave/helper/picker writers.
- Batch 13c for Draft masking and scope.
- Batch 13d for the exact approved whole-event cascade.

## Test deliverable

Create `docs/phase-4b/step-13b-tests.md` when the batch lands. Include independently rollback-safe Dev SQL pastes ending in the intentional `TEST RESULTS` exception, focused derived-state/UI tests, and a three-role manual checklist.

Cover zero/one/many tasks; final-task completion; mixed status; canonical whitespace/null and case-sensitive keys; `Unphased` never completing; mixed committees; Draft/Active/Archived; every role and inactive/profile-less caller; real/masked/hidden tasks; raw INSERT/UPDATE/DELETE; every normal task writer; every mutable child writer; Edit Event metadata-only success plus task add/edit/delete/rename denial; source/destination phase checks; stale completion; simultaneous final completions; Reopen authorization and exact one-task move; inactive/former event creator; lane-tail/rank exhaustion; activity attribution; Batch 13d cascade; and direct attempts to forge the Reopen exception.

Assert exact helper/guard/RPC signatures, owners, volatility, security mode, search paths, grants, no overloads, trigger attachment/order/enablement, canonical expression, lock order, current direct-task-writer sets, owner-branch column union, reset/helper callers, completed-phase normal-writer block list, and unchanged archive/task/content RLS.

## Manual checklist

- Complete every task in a phase and confirm its tab gains a check/strikethrough and collapses by default after authoritative refresh.
- Expand the phase and open its tasks as a Member. Confirm reading still works while every mutation control is absent or disabled.
- Attempt moves, edits, assignments, leave, backup, volunteering, dependency/confidentiality changes, comments, and work-link changes through UI and direct RPCs; all normal paths must fail.
- Attempt Edit Event and Batch 11 task mutations involving the complete phase, including add, rename, merge, edit, and delete.
- As an Admin, reopen one selected task and confirm it moves to the `In Progress` tail, logs once, and unlocks the phase.
- As the active Co-Admin whose id equals `events.created_by`, repeat Reopen even when the phase contains several committees. Confirm another committee head cannot reopen.
- Deactivate or change the creator’s role and confirm only an Admin may reopen.
- Confirm Archived phases cannot reopen and retain their stronger read-only messaging.
- Delete a disposable Draft/Archived event through Batch 13d and confirm the completed-phase guard does not block the approved whole-event cascade.
- Verify masked shells never reveal completed-phase task details or Reopen controls.

## Acceptance

Phase completion is derived from authoritative event+canonical-phase task rows. A complete Draft or Active phase is database-enforced read-only through every normal task and child writer, including Edit Event and Batch 11, while Members retain approved read access. Archived events remain under their stronger freeze. Tabs show the approved check, strikethrough, and default collapse. One exact Reopen RPC lets any active Admin or the active Co-Admin identified by `events.created_by` move one selected task to `In Progress`, log the initiating actor once, and unlock the phase. Writer catalogs, lock order, confidential masking, event deletion, and pinned tests are current and verified.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod application without owner confirmation.
- Add `docs/phase-4b/step-13b-tests.md`.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with the canonical derived model, complete writer/child freeze, Reopen authorization, lock order, and final catalogs.
- Apply the listed supersession/current-count changes without rewriting historical results.
- Add the final Batch 13b objects and exact counts to the authoritative Phase 4B catalog and Batch 14 allowlists.
