# Phase 4 Step 10E — app review and final gate

This is the final review ledger for Phase 4. SQL pastes are run on **Dev only**
with **Run without RLS**, one complete paste at a time. Do not run them on Prod.
The manual checks below are point-and-click checks in the Dev app.

## A. App review checklist

Use an expendable Dev event with enough tasks to exercise the checks safely.
Keep one public task, one confidential task, a prerequisite/dependent pair, one
task with work links and comments, and one separate event that can be archived.

### Claudee — Admin

- [ ] Sign in as **Claudee**, open the Active event board, and open the public
  and confidential task details. Confirm both show their real titles and content.
- [ ] Open the dependent task and confirm it shows as blocked while its
  prerequisite is incomplete. Mark the prerequisite Completed, then move the
  dependent forward and refresh; confirm the move persists.
- [ ] Move that prerequisite backward. Confirm the dependent is not
  automatically moved backward. Add a new incomplete prerequisite to an
  already-forward dependent and confirm its stored status is not auto-reverted.
- [ ] On desktop, drag a task within a lane and between lanes. Refresh after
  each move and confirm the status and order persist. Use Undo once and refresh
  again to confirm the restored placement persists.
- [ ] Open the same board at mobile width, use the status-move control, refresh,
  and confirm the new status persists.
- [ ] On a task, add and remove a selected work link. Add a normal comment and
  a Heads Up comment, edit one, and delete one. Confirm each successful action
  is immediately reflected without exposing raw database errors.
- [ ] Assign and unassign **tv** as primary and assist on selected tasks. After
  each change, switch to tv and confirm My Tasks and task content follow the
  current assignment rather than stale UI state.
- [ ] On a disposable Active event containing one remaining To Do task, try its
  Delete action and confirm the app reports that the final Active task cannot be
  removed. Refresh and confirm the event is still Active and the task remains.
- [ ] Archive the separate event through the normal Archive action. Open its
  archive detail and task detail; confirm event/task edit, move, assignment,
  dependency, confidentiality, work-link mutation, and comment mutation controls
  are absent or safely rejected.
- [ ] For an Archived confidential task, confirm the combined Additional
  viewers list is visible. Search for tv, grant access, switch to tv to confirm
  real content/links/comments, then return as Claudee, revoke with confirmation,
  and verify tv immediately loses that access.
- [ ] **Step 7B-UI pending check:** confirm the share search is debounced and
  bounded, duplicate submissions are disabled, successful grant/revoke refreshes
  detail, controls, links, and comments, and Draft/Active tasks still show the
  ordinary Manage access behavior rather than archive sharing.
- [ ] **Step 9-UI pending check:** confirm empty-thread, mention chips, Heads Up,
  edited label, author/Admin edit-delete controls, confirmation, and Load older
  behavior. Confirm Archived threads are read-only and loss of real access
  clears the thread to the safe unavailable state.
- [ ] **Step 9A-UI pending check:** open Workspace and confirm My Tasks is the
  default tab, Help Wanted is second, status filtering and Deadline/Priority/Event
  sorting affect only My Tasks, badges remain stable while loading, and Load more
  does not duplicate or skip rows when more than 50 are available.

### Claude HAAAA — Co-Admin

- [ ] Sign in as **Claude HAAAA** and open the same Active board. Confirm own-
  committee tasks have the expected controls and other-committee tasks do not
  gain Co-Admin-only edit controls.
- [ ] Open the confidential task while authorized, then have Claudee remove the
  relevant assignment/viewer access. Refresh or wait for the normal app refresh
  and confirm every surface changes to the **Confidential Task** shell or safe
  unavailable state immediately.
- [ ] On mobile width, move an authorized task between statuses, refresh, and
  confirm it persists. Confirm a task outside the permitted scope cannot be moved.
- [ ] Use the dependency and confidentiality controls on an own-committee task.
  Confirm changes appear consistently on the board and detail page and that no
  equivalent controls appear for an unauthorized confidential task.
- [ ] Add/remove a selected work link and add/edit/delete an allowed comment.
  After Claudee revokes real access, confirm links and comments are no longer
  readable or writable.
- [ ] Change a selected primary/assist assignment and verify the affected user's
  My Tasks membership changes after refresh.
- [ ] Open the Archived event and confirm ordinary event/task/content mutations
  remain unavailable. On an Archived confidential own-committee task, verify the
  late-share Grant/Revoke controls work; on an out-of-scope task, verify the list
  is read-only and no share controls are exposed.
- [ ] Repeat the relevant **Step 7B-UI**, **Step 9-UI**, and **Step 9A-UI** checks
  above with Co-Admin permissions, especially own-committee boundaries and safe
  behavior immediately after access changes.

### tv — Member

- [ ] Sign in as **tv**, open the Active board, and find a confidential task for
  which tv is neither an assignee nor an allowed viewer. Confirm the card and
  detail expose only the exact **Confidential Task** shell, with no description,
  committee, people, dates, dependency label, links, comments, or access list.
- [ ] Ask Claudee to assign tv or grant ordinary Active-task viewer access.
  Refresh and confirm the real task, selected work links, and comments appear.
  Ask Claudee to revoke that access and confirm every surface returns immediately
  to the shell or safe unavailable state.
- [ ] While assigned, use the mobile status control, refresh, and confirm the
  move persists. Confirm no reorder, assignment, dependency, confidentiality,
  delete, or archive control is exposed.
- [ ] Open Workspace. Confirm assigned Active tasks appear in My Tasks with the
  right primary/assist flags, Completed behavior, filtering, and sorting. After
  unassignment, refresh and confirm the rows disappear when no assignment remains.
- [ ] On a real-access task, add a comment, edit/delete only tv's permitted
  comment, use a mention candidate, and confirm loss of access disables further
  comment and work-link interaction without leaking content.
- [ ] Open the Archived confidential task before late sharing and confirm it is
  unavailable or masked as designed. After Claudee grants tv, confirm real task
  content, links, and the read-only comment thread appear; after revoke, confirm
  they disappear immediately. Confirm tv never sees Grant/Revoke controls.
- [ ] Open Archived event/task records and confirm all ordinary mutation controls
  are absent. Confirm My Tasks remains Active-event-only and does not gain the
  late-shared Archived task.
- [ ] Repeat the Member-relevant **Step 7B-UI**, **Step 9-UI**, and **Step 9A-UI**
  checks above, including loading states, safe errors, and access changes without
  a full sign-out/sign-in cycle.

## B. Batched SQL re-run guide

For each session: run one paste at a time, tick it only after checking every
named result line, and record the result and date. **After each session, send the
result lines of any FAIL back to Claude chat.**

Counts marked **counted from source** were obtained by counting the labels emitted
by that paste's SQL, including repeated labels emitted by fixed loops. Counts
marked **documented; source match** were already stated by the document and were
independently checked against the SQL. No stated/source count mismatch was found.

### Session 1 — Steps 1 and 2 (13 pastes)

Test files: [`PHASE-4-STEP-1-TESTS.md`](PHASE-4-STEP-1-TESTS.md) and
[`PHASE-4-STEP-2-TESTS.md`](PHASE-4-STEP-2-TESTS.md). The Step column maps every
paste row to its named file.

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | 1 | TEST 1 — exact count, microsecond version, and unchanged tasks | 4 — counted from source | None known. | |
| [ ] | 1 | TEST 2 — stale count, stale version, and double submission | 3 — counted from source | None known. | |
| [ ] | 1 | TEST 3 — caller and event-status matrix | 9 — counted from source | None known; four caller-loop labels are included. | |
| [ ] | 1 | TEST 4 — raw policy, archive freeze, and reparent guards | 7 — counted from source | Step 5A later adds unconditional task `event_id` immutability, but this paste's Archived reparent cases should still be stopped first by the archive guard. Check on first run if the exact error source differs. | |
| [ ] | 1 | TEST 5 — event freeze and Active-event invariant remain enforced | 3 — counted from source | None known. | |
| [ ] | 1 | TEST 6 — function bodies, trigger catalogs, owner, and grants | 12 — counted from source | Later steps add task-child guards and task triggers. The named Step 1 objects remain authoritative, but check catalog/body exactness on first run. | |
| [ ] | 1 | TEST 7 — Co-Admin edit and launch paths remain available | 8 — counted from source | `edit_event_with_tasks` was later replaced by Step 5A while retaining its signature and earlier behavior; check on first run. | |
| [ ] | 2 | TEST 1 — Active visibility, masking, and board/get_task parity | 8 — counted from source | Step 9 and Step 7B later refactor the shared access helper and add Archived late sharing; the Active decisions in this paste should remain unchanged. | |
| [ ] | 2 | TEST 2 — Draft tasks are real only for Admin and owning Co-Admin | 6 — counted from source | Later access-helper replacements are required to preserve Draft behavior; check on first run. | |
| [ ] | 2 | TEST 3 — profile minimization, Admin filter, and inactive callers | 6 — counted from source | None known; two loop-emitted non-Admin filter labels are included. | |
| [ ] | 2 | TEST 4 — Archived and unknown event IDs are indistinguishable | 5 — counted from source | Step 7B later adds task-detail late sharing but must not make the event board return Archived rows. | |
| [ ] | 2 | TEST 5 — policies and function catalogs remain narrow | 10 — counted from source | Step 9 and Step 7B replace access helpers without changing the reader contract. Check function-body/catalog exactness on first run. | |
| [ ] | 2 | TEST 6 — effective-priority boundaries | 10 — counted from source | None known. | |

### Session 2 — Steps 3 and 4 (13 pastes)

Test files: [`PHASE-4-STEP-3-TESTS.md`](PHASE-4-STEP-3-TESTS.md) and
[`PHASE-4-STEP-4-TESTS.md`](PHASE-4-STEP-4-TESTS.md). The Step column maps every
paste row to its named file.

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | 3 | TEST 1 — Active role matrix, exact masked shell, and unknown IDs | 2 — counted from source | Step 9/7B centralize and extend access evaluation; Active shell behavior must remain unchanged. | |
| [ ] | 3 | TEST 2 — Draft and Archived lifecycle matrices | 2 — counted from source | Step 7B adds explicit Archived late viewers. No share rows exist in this fixture; check on first run. | |
| [ ] | 3 | TEST 3 — access-list minimization and immediate revocation | 5 — counted from source | Step 7 replaces direct viewer management with `set_task_confidentiality`; this paste uses an older raw Admin viewer update. Check on first run rather than treating an exact writer-path difference as a current defect. | |
| [ ] | 3 | TEST 4 — dependency state and label masking | 5 — counted from source | Step 7 adds the current dependency writer and raw forward-move gate; the read-state expectations remain authoritative. | |
| [ ] | 3 | TEST 5 — helper, board, get_task, detail, and priority parity | 2 — counted from source | Step 9 and Step 7B replace the helper/detail bodies. The parity contract remains current; check body-dependent behavior on first run. | |
| [ ] | 3 | TEST 6 — function catalogs, grants, read-only body, and unchanged policies | 8 — counted from source | Step 7B replaces `get_task_detail`; use the current 7B/10A catalogs if an old body-shape assertion differs. | |
| [ ] | 4 | TEST 1 — one-row reader, role matrix, Draft, Archived, and empty links | 4 — counted from source | Step 7B adds late-shared Archived real access. This fixture has no late-share row, so its matrix should remain unchanged. | |
| [ ] | 4 | TEST 2 — add rights, derived creator, URLs, duplicate, and cap | 6 — counted from source | None known. | |
| [ ] | 4 | TEST 3 — remove matrix and confidential Co-Admin boundary | 4 — counted from source | Step 7 later formalizes real-access controls; the work-link removal boundary remains current. | |
| [ ] | 4 | TEST 4 — Archived writes, immutable updates, profile deletion, and cascades | 5 — counted from source | Later child tables add their own guards, but the work-link-specific guard remains authoritative. | |
| [ ] | 4 | TEST 5 — Archived RPC failures, revocation, and reader parity | 3 — counted from source | Step 7 replaces viewer changes and Step 7B adds archive-only shares. This paste's ordinary access revocation remains relevant; check its older setup path on first run. | |
| [ ] | 4 | TEST 6 — catalog, grants, locks, triggers, and unchanged policies | 8 — counted from source | Later child guards do not replace the work-link guards. None otherwise known. | |
| [ ] | 4 | TEST 7 — orphaned creator keeps can_remove boolean | 5 — counted from source | None known. | |

### Session 3 — Steps 5A and 5B (11 pastes)

Test files: [`PHASE-4-STEP-5A-TESTS.md`](PHASE-4-STEP-5A-TESTS.md) and
[`PHASE-4-STEP-5B-TESTS.md`](PHASE-4-STEP-5B-TESTS.md). The Step column maps every
paste row to its named file.

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | 5A | TEST 1 — unchanged create RPC, derived metadata, and real authenticated edit | 3 — counted from source | `edit_event_with_tasks` keeps the same signature but later writers/guards expand. Check on first run. | |
| [ ] | 5A | TEST 2 — Member status movement, immutable metadata, and reparenting matrix | 7 — counted from source | Step 7 adds the raw forward dependency gate. Owner-path status updates now keep their old rank unless rank is explicit; this paste's actual status move is impersonated and should use the destination trigger. | |
| [ ] | 5A | TEST 3 — dependency rules, clear prerequisite error, and event cascade | 6 — counted from source | Step 7 adds the public dependency mutator but preserves these integrity triggers. | |
| [ ] | 5A | TEST 4 — forced backfill failure restores named triggers and writes nothing | 3 — counted from source | This is a historical migration-atomicity simulation; later redefinitions keep the same named triggers, but check on first run. | |
| [ ] | 5A | TEST 5 — catalogs, function bodies, lock order, and unchanged policies | 13 — counted from source | Later steps redefine `restrict_assignee_task_updates` and add writers/triggers. Assertions about Step 5A's named objects remain useful, but current guard-column truth is Step 8 TEST 1. | |
| [ ] | 5B | TEST 1 — catalogs, owner exemption, grants, trigger order, and lock order | 11 — counted from source | **Superseded:** `ONLY_POSTGRES_DEFINER_TASK_UPDATER_IS_MOVE_TASK` is expected to differ after Step 7, and the owner-column union is later expanded by Steps 7A and 8. Use Step 8 TEST 1 for current writer/guard exactness. | |
| [ ] | 5B | TEST 2 — raw Member status change sees the hidden true destination tail | 1 — counted from source | Step 7 adds the forward dependency gate; this fixture should still pass if its move is dependency-safe. | |
| [ ] | 5B | TEST 3 — role matrix, leadership reorder, assignee tail, and dependencies | 14 — counted from source | None known; later steps are required to preserve this movement contract. | |
| [ ] | 5B | TEST 4 — direct forgery remains blocked and the RPC changes only status/order | 1 — counted from source | The current owner allowlist is wider for other named writers, but `move_task` itself must still change only status/rank. | |
| [ ] | 5B | TEST 5 — same-lane/cross-lane rebalance, activity noise, and Archived denial | 4 — counted from source | None known. | |
| [ ] | 5B | TEST 6 — Undo, stale/moved/removed/cross-lane/forged hints, and boundaries | 11 — counted from source | None known. | |

### Session 4 — Steps 6, 7, and 7A (13 pastes)

Test files: [`PHASE-4-STEP-6-TESTS.md`](PHASE-4-STEP-6-TESTS.md),
[`PHASE-4-STEP-7-TESTS.md`](PHASE-4-STEP-7-TESTS.md), and
[`PHASE-4-STEP-7A-TESTS.md`](PHASE-4-STEP-7A-TESTS.md). The Step column maps
every paste row to its named file.

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | 6 | SQL TEST 1 — reader catalog, grants, exact return shape, and hidden rank | 6 — counted from source | The owner fixture writes rank explicitly, which remains allowed by the latest owner guard. None otherwise known. | |
| [ ] | 6 | SQL TEST 2 — Active ordering and real/masked parity for all roles | 4 — counted from source | Step 9/7B refactor access evaluation; Active ordering and masking must remain unchanged. | |
| [ ] | 6 | SQL TEST 3 — Draft, Archived, unknown, and filter behavior remain unchanged | 6 — counted from source | Step 7B adds Archived detail sharing but the board must still return no Archived rows. | |
| [ ] | 6 | SQL TEST 4 — normal-RPC Undo hints reject stale, removed, forged, and non-boundary placement | 5 — counted from source | None known. | |
| [ ] | 7 | TEST 1 — catalogs, grants, exact writer allowlist, and lock order | 11 — counted from source | **Partly superseded by Step 8:** `EXACT_MOVE_AND_DEPENDENCY_WRITER_ALLOWLIST` and `OWNER_BRANCH_EXACT_COLUMN_UNION` pin older writer/column sets. Use Step 8 TEST 1 for current exactness. | |
| [ ] | 7 | TEST 2 — dependency roles, real/masked access, integrity, clear, and lifecycle | 14 — counted from source | None known. | |
| [ ] | 7 | TEST 3 — confidentiality validation, retained inactive viewers, and immediate access | 17 — counted from source | Step 7B adds an Archived-only share mechanism but does not replace Active/Draft `allowed_viewers`. | |
| [ ] | 7 | TEST 4 — direct forgery, owner-column union, raw forward gate, and move_task regression | 9 — counted from source | **Partly superseded by Step 8:** `OWNER_BRANCH_REJECTS_NONUNION_COLUMN` still rejects the write, but its exact old error text/column list is superseded by the latest `restrict_assignee_task_updates` definition. | |
| [ ] | 7A | TEST 1 — catalogs, grants, five-plus-helper/nine writers, and lock order | 13 — documented; source match | **Partly superseded by Step 8:** the five-owner-writer, nine-full-writer, and five-column guard labels are historical. Step 8 TEST 1 is authoritative. | |
| [ ] | 7A | TEST 2 — assignment roles, real access, validation, Completed, and activity | 12 — documented; source match | Step 8 adds claim/backup writers but must preserve assignment behavior. | |
| [ ] | 7A | TEST 3 — deletion, dependency protection, and Active-event invariant | 10 — documented; source match | None known. | |
| [ ] | 7A | TEST 4 — self-unassign timing, Completed, Backlog reset, and exhausted rank | 10 — documented; source match | None known; the two loop-emitted `CCU72` labels are included. | |
| [ ] | 7A | TEST 5 — exact Backlog meaning and unchanged reader contract | 2 — documented; source match | Step 8 adds Help Wanted/claim behavior but retains this Backlog definition. | |

### Session 5 — Steps 7B and 8 (10 pastes)

Test files: [`PHASE-4-STEP-7B-TESTS.md`](PHASE-4-STEP-7B-TESTS.md) and
[`PHASE-4-STEP-8-TESTS.md`](PHASE-4-STEP-8-TESTS.md). The Step column maps every
paste row to its named file.

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | 7B | TEST 1 — exact catalogs, ownership, grants, and unchanged freeze objects | 20 — documented; source match | None known. | |
| [ ] | 7B | TEST 2 — authorization, target validation, search, and function ordering | 26 — documented; source match | None known. | |
| [ ] | 7B | TEST 3 — child integrity, parent guard, and concurrency catalogs | 19 — documented; source match | None known. | |
| [ ] | 7B | TEST 4 — unioned readers, immediate revoke, board, and My Tasks | 22 — documented; source match | None known. | |
| [ ] | 7B | TEST 5 — late viewers read but never write; archive freeze remains intact | 17 — documented; source match | None known. | |
| [ ] | 8 | TEST 1 — schema, catalogs, grants, exact writers, and lock order | 19 — documented; source match | This is the current authority for the six-column owner guard and exact writer inventories. | |
| [ ] | 8 | TEST 2 — claims, confidentiality, dependencies, loser, and activity | 14 — documented; source match | None known. | |
| [ ] | 8 | TEST 3 — request/cancel role matrix, cleanup, and activity | 11 — documented; source match | None known. | |
| [ ] | 8 | TEST 4 — volunteer, withdraw, accept, and stale-offer cleanup | 16 — documented; source match | None known. | |
| [ ] | 8 | TEST 5 — readers, workload, RLS, immutability, and archive freeze | 10 — documented; source match | None known. | |

### Session 6 — Steps 9 and 9A (9 pastes)

Test files: [`PHASE-4-STEP-9-TESTS.md`](PHASE-4-STEP-9-TESTS.md) and
[`PHASE-4-STEP-9A-TESTS.md`](PHASE-4-STEP-9A-TESTS.md). The Step column maps
every paste row to its named file.

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | 9 | TEST 1 — catalogs, helper parity contract, schema, grants, and writers | 23 — documented; source match | Step 7B later replaces the user-aware access helper/detail reader to add Archived shares. Use 7B/10A for current body/catalog exactness if this older exact-body check differs. | |
| [ ] | 9 | TEST 2 — access parity, role matrix, lifecycle, and non-leaking readers | 15 — documented; source match | Step 7B adds only the Archived late-share union; fixtures without a share should retain these decisions. | |
| [ ] | 9 | TEST 3 — empty thread, safe shapes, candidates, cursors, and revocation | 19 — documented; source match | None known. | |
| [ ] | 9 | TEST 4 — add/edit validation, unordered mentions, stale edits, and edited_at | 19 — documented; source match | None known. | |
| [ ] | 9 | TEST 5 — delete roles, Archived freeze, cascades, locks, and no notifications | 20 — documented; source match | None known. | |
| [ ] | 9A | TEST 1 — catalog, fixed shape, grants, and read-only body | 12 — documented; source match | None known. | |
| [ ] | 9A | TEST 2 — caller scope, roles, confidentiality, and lifecycle | 14 — documented; source match | Step 7B explicitly preserves My Tasks as Active-event-only. | |
| [ ] | 9A | TEST 3 — filters, all three sorts, and pagination | 16 — documented; source match | None known. | |
| [ ] | 9A | TEST 4 — pagination validation, inactive-reader difference, and raw RLS regression | 13 — documented; source match | None known. | |

### Already completed Step 10 evidence — do not re-run here

| Part | Evidence | Status |
|---|---|---|
| 10A | One read-only catalog paste; five result sets `57 / 8 / 11 / 20 / 0` | Passed on Dev (owner-confirmed) |
| 10B | Two pastes; `10 / 16` result lines | Passed on Dev (owner-confirmed) |
| 10C | Three pastes; `18 / 16 / 16` result lines | Passed on Dev (owner-confirmed) |
| 10D | Three pastes; `12 / 14 / 14` result lines | Passed on Dev (owner-confirmed) |

### Optional final legacy session — Phase 3 regression pastes

Test files: [`PHASE-3-HARDENING-TESTS.md`](PHASE-3-HARDENING-TESTS.md),
[`PHASE-3-STEP-4-TESTS.md`](PHASE-3-STEP-4-TESTS.md),
[`PHASE-3-STEP-6-ARCHIVE-VISIBILITY-TESTS.md`](PHASE-3-STEP-6-ARCHIVE-VISIBILITY-TESTS.md),
and [`PHASE-3-STEP-7-BANNER-TESTS.md`](PHASE-3-STEP-7-BANNER-TESTS.md). The Step
column maps every paste row to its named file.

These older blocks are optional. They predate the global `TEST RESULTS` contract:
on success they emit **zero named result lines** and reach their final rollback;
on failure an assertion raises. Their count is therefore `0 — counted from
source`, not an invented PASS-line count. Keep their browser/manual sections and
the banner delete-policy explanation out of the SQL paste list. **After each
session, send the result lines of any FAIL back to Claude chat.**

| Done | Step | Independent paste | Expected result lines | Later-step warning | Result / date |
|---|---|---|---:|---|---|
| [ ] | Phase 3 hardening | 1. Active callers receive content and deactivated callers receive no row | 0 — counted from source | `get_task` was later replaced by Phase 4 access helpers; check on first run. | |
| [ ] | Phase 3 hardening | 2. Active insert: empty fails; atomic creation with a task passes | 0 — counted from source | The create RPC and task creation metadata/order path were replaced in Step 5A; check on first run. | |
| [ ] | Phase 3 hardening | 3. Edit RPC: deleting the final task fails; replacing it passes | 0 — counted from source | The edit RPC was replaced in Step 5A while preserving the invariant; check on first run. | |
| [ ] | Phase 3 hardening | 4. Moving tasks: emptying a source fails; swapping final state passes | 0 — counted from source | **Superseded:** Step 5A makes `tasks.event_id` immutable, so this historical reparent-based invariant test is no longer a valid current move path. | |
| [ ] | Phase 3 hardening | 5. Launch requires an end date; legacy Active null-end rows remain editable | 0 — counted from source | None known. | |
| [ ] | Phase 3 hardening | 6. Real archive path stays frozen; Active event deletion still works | 0 — counted from source | The document already updates this case to use Step 1 `archive_event`; check on first run. | |
| [ ] | Phase 3 hardening | 7. Co-Admin is protected by the invariant and still cannot archive | 0 — counted from source | Step 1 makes the archive RPC the only archive path; the denial remains current. | |
| [ ] | Phase 3 hardening | 8. Member cannot create or mutate events/tasks | 0 — counted from source | Later task controls add narrow Member actions, but not general raw event/task creation or mutation. Check exact expectations on first run. | |
| [ ] | Phase 3 Step 4 | 1. Stale `updated_at` is rejected | 0 — counted from source | The edit RPC was replaced in Step 5A; stale-version behavior should remain, but check on first run. | |
| [ ] | Phase 3 Step 4 | Inactive-assignee A. Updating a title while an existing assignment remains succeeds | 0 — counted from source | Step 5A replaces the edit RPC and adds task metadata/lane guards; check on first run. | |
| [ ] | Phase 3 Step 4 | Inactive-assignee B. Adding a new inactive assignee is rejected atomically | 0 — counted from source | Step 5A replaces the edit RPC; check on first run. | |
| [ ] | Phase 3 Step 4 | Inactive-assignee C. Removing an existing inactive assignee succeeds | 0 — counted from source | Step 5A replaces the edit RPC; check on first run. | |
| [ ] | Phase 3 Step 4 | Inactive-assignee D. A Co-Admin may retain one on an own-committee task | 0 — counted from source | Step 5A replaces the edit RPC; check on first run. | |
| [ ] | Phase 3 Step 4 | 2. Co-Admin cross-committee update and delete are rejected atomically | 0 — counted from source | Later named cross-committee task operations do not broaden the general edit RPC; check on first run. | |
| [ ] | Phase 3 Step 4 | 3. A non-To-Do task cannot be deleted | 0 — counted from source | Step 7A adds `delete_task`, but the edit RPC's historical deletion rule remains separate. Check on first run. | |
| [ ] | Phase 3 Step 4 | 4. A task omitted from all mutation lists is unchanged | 0 — counted from source | Step 5A replaces the edit RPC; check on first run. | |
| [ ] | Phase 3 Step 4 | 5. A Member cannot call the function | 0 — counted from source | Narrow Member move/claim/comment actions added later do not grant this edit RPC. | |
| [ ] | Phase 3 Step 4 | 6. Draft-to-Active succeeds with a task added in the same save | 0 — counted from source | Step 5A replaces the edit RPC and adds ordering metadata; check on first run. | |
| [ ] | Phase 3 Step 6 archive visibility | 1. A Member sees a non-confidential Archived task but not a confidential one | 0 — counted from source | **Fixture superseded:** it raw-updates the event to Archived; Step 1 requires `archive_event`. Step 7B also adds an explicit late-share exception for confidential tasks. | |
| [ ] | Phase 3 Step 6 archive visibility | 2. A Member still cannot see an unassigned Active task | 0 — counted from source | Step 2 intentionally changes the board to show a masked shell while raw task RLS remains hidden. Interpret this as a raw-visibility regression only; check on first run. | |
| [ ] | Phase 3 Step 6 archive visibility | 3. A deactivated user sees no non-confidential Archived task | 0 — counted from source | **Fixture superseded:** raw archive setup is blocked by Step 1. The inactive-user expectation remains current. | |
| [ ] | Phase 3 Step 6 archive visibility | 4. A Member still cannot update an Archived task | 0 — counted from source | **Fixture superseded:** raw archive setup is blocked by Step 1; Archived write denial remains current. | |
| [ ] | Phase 3 Step 6 archive visibility | 5. The assignee function returns names and only the three allowed fields | 0 — counted from source | **Fixture superseded:** raw archive setup is blocked by Step 1. The reader shape remains current. | |
| [ ] | Phase 3 Step 6 archive visibility | 6. The assignee function returns nothing for an Active event | 0 — counted from source | None known. | |
| [ ] | Phase 3 Step 6 archive visibility | 7. The assignee function returns nothing to a deactivated Member | 0 — counted from source | **Fixture superseded:** raw archive setup is blocked by Step 1. | |
| [ ] | Phase 3 Step 6 archive visibility | 8. A deactivated assignee still appears by real name | 0 — counted from source | **Fixture superseded:** raw archive setup is blocked by Step 1. The historical-name behavior remains current. | |
| [ ] | Phase 3 Step 7 banner | SQL test 1 — Active-event policies mirror `events_update` | 0 — counted from source | **Fixture superseded:** its final raw Active-to-Archived update is blocked by Step 1. | |
| [ ] | Phase 3 Step 7 banner | SQL test 2 — Archived events freeze all Storage write policies | 0 — counted from source | **Fixture superseded:** it raw-updates the fixture to Archived; Step 1 requires `archive_event`. | |
| [ ] | Phase 3 Step 7 banner | SQL test 3 — URL integrity, object existence, version bump, and template NULL | 0 — counted from source | **Fixture superseded:** its raw archive setup is blocked by Step 1. | |

## C. Final acceptance ledger

Update a row only from the evidence named in that row. **After each session,
send the result lines of any FAIL back to Claude chat.** Historical progress or
an earlier merge is not a substitute for this final re-run ledger.

| Requirement | Evidence | Status |
|---|---|---|
| Gate-critical Step 1A — raw task access hardening | 10B-1 and 10B-2; Step 1A is not separately rerun | Not yet run |
| Gate-critical Step 1 — transactional archive RPC | Session 1, Step 1 TESTS 1–7; Claudee archive/freeze checks | Not yet run |
| Gate-critical Step 2 — read-only event board | Session 1, Step 2 TESTS 1–6; all three user checklists | Not yet run |
| Gate-critical Step 3 — task detail and access states | Session 2, Step 3 TESTS 1–6; shell/access-change checks | Not yet run |
| Gate-critical Step 5A — metadata and dependency integrity | Session 3, Step 5A TESTS 1–5 | Not yet run |
| Gate-critical Step 5B — transactional task moves | Session 3, Step 5B TESTS 1–6 | Not yet run |
| Gate-critical Step 6 — desktop drag-and-drop and mobile moves | Session 4, Step 6 SQL TESTS 1–4; Claudee/Claude HAAAA/tv move checks | Not yet run |
| Gate-critical Step 7 — dependency and confidentiality controls | Session 4, Step 7 TESTS 1–4; dependency/access manual checks | Not yet run |
| Step 10A — database review and live catalog inventory | Read-only catalog result sets `57 / 8 / 11 / 20 / 0` | Passed on Dev (owner-confirmed) |
| Step 10B — Step 1A leak and raw-write matrices | 10B-1 `10`; 10B-2 `16` | Passed on Dev (owner-confirmed) |
| Step 10C — cross-feature and archive-race coverage | 10C-1 `18`; 10C-2 `16`; 10C-3 `16` | Passed on Dev (owner-confirmed) |
| Step 10D — large results, pagination, and invariant coverage | 10D-1 `12`; 10D-2 `14`; 10D-3 `14` | Passed on Dev (owner-confirmed) |
| Gate-critical Step 10 overall | 10A–10D, all six required re-run sessions, Part A, and command checks | Not yet run |
| Selected Step 4 — work links | Session 2, Step 4 TESTS 1–7; selected link manual checks | Not yet run |
| Selected Step 7A — assignment, deletion, and self-unassign | Session 4, Step 7A TESTS 1–5; assignment/final-task manual checks | Not yet run |
| Selected Step 7B — archive-only late sharing | Session 5, Step 7B TESTS 1–5; pending Step 7B-UI checklist | Not yet run |
| Selected Step 8 — claims, backup, volunteers, and Help Wanted | Session 5, Step 8 TESTS 1–5; Help Wanted checks | Not yet run |
| Selected Step 9 — task comments | Session 6, Step 9 TESTS 1–5; pending Step 9-UI checklist | Not yet run |
| Selected Step 9A — My Tasks | Session 6, Step 9A TESTS 1–4; pending Step 9A-UI checklist | Not yet run |
| Completing a prerequisite unlocks forward movement without later automatic status reversion | Step 5B TEST 3, 10C-3, and Claudee dependency sequence | Not yet run |
| Unauthorized Member receives only the Confidential Task shell | Step 2/3 suites, 10C-1, and tv shell check | Not yet run |
| Desktop and mobile task moves persist | Step 5B/6 suites and all applicable manual move checks | Not yet run |
| Archived events, tasks, and guarded child records remain frozen | Step 1, 4, 7A, 7B, 8, and 9 suites; 10C-2/10C-3; archive manual checks | Not yet run |
| `tasks.event_id` remains immutable | Step 5A TEST 2, Step 7 TEST 4, and 10C-3 | Not yet run |
| Every Active event retains at least one task at transaction end | Step 1 TEST 5, Step 7A TEST 3, 10D-3, and Claudee final-task check | Not yet run |
| Work links follow current access and assignment changes | Step 4 suite, 10C-1, and three-user link checks | Not yet run |
| Comments follow current access changes | Step 9 suite, 10C-1/10C-2, and pending Step 9-UI checks | Not yet run |
| Archived late sharing grants and revokes access consistently | Step 7B suite, 10C-1, and three-user late-share checks | Not yet run |
| My Tasks follows assignment and access changes consistently | Step 9A suite, 10D-2, and pending Step 9A-UI checks | Not yet run |
| No board-create capacity trigger, notifications, Realtime, or Executive Dashboard wiring was added | 10A review, Step 9 no-notification assertion, repository/app review | Not yet run |
| Automated verification passes | `npm test`, `npm run build`, and `npm run lint` | Not yet run |
| Step 10E manual app review is complete | Every checkbox in Part A | Not yet run |
