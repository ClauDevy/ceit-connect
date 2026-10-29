# Batch 11 Run 1 — replaced database definitions

This is the review map for every function replaced by the two Run 1
migrations. “Old” means the latest definition before Batch 11; “new” means
the definition in the local Batch 11 migration. No RLS policy is replaced.

## Signatures and source definitions

| Function | Old definition | New definition | Signature change |
| --- | --- | --- | --- |
| `log_task_activity()` | `20261018130000_transactional_task_move_rpc.sql:169` | `20261028120000_task_updated_at_and_readers.sql:16` | None; trigger → trigger |
| `get_task_detail(uuid)` | `20261023160000_archived_task_viewers.sql:669` | `20261028120000_task_updated_at_and_readers.sql:107` | DROP + recreate; adds `updated_at timestamptz` after `created_at` |
| `get_task_edit_controls(uuid)` | `20261021130000_task_assignment_deletion_self_unassign.sql:985` | `20261028120000_task_updated_at_and_readers.sql:372` | DROP + recreate; adds `can_edit_task boolean` after `can_set_confidentiality` |
| `guard_task_assignee_writes()` | `20261027120000_task_assignee_locking.sql:189` | `20261028130000_active_event_task_writers.sql:140` | None; trigger → trigger |
| `restrict_assignee_task_updates()` | `20261027120000_task_assignee_locking.sql:239` | `20261028130000_active_event_task_writers.sql:184` | None; trigger → trigger |
| `set_task_destination_lane_order()` | `20261027120000_task_assignee_locking.sql:285` | `20261028130000_active_event_task_writers.sql:263` | None; trigger → trigger |
| `edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])` | `20261027130000_task_assignee_locking_hardening.sql:322` | `20261028130000_active_event_task_writers.sql:425` | None; return remains `timestamptz` |

The two reader return signatures are therefore:

| Reader | Old | New |
| --- | --- | --- |
| `get_task_detail(uuid)` | `TABLE(id uuid, event_id uuid, event_name text, event_status text, title text, description text, phase text, status text, effective_priority text, task_type text, due_date timestamptz, call_time timestamptz, end_time timestamptz, created_at timestamptz, committee_id uuid, committee_name text, primary_assignees jsonb, assist_assignees jsonb, is_confidential boolean, is_masked boolean, has_dependency boolean, is_blocked boolean, dependency_label text, access_list jsonb)` | Same order, with `updated_at timestamptz` inserted immediately after `created_at`. Masked rows return null for it. |
| `get_task_edit_controls(uuid)` | `TABLE(can_set_dependency boolean, can_set_confidentiality boolean, can_assign_people boolean, can_delete boolean, can_unassign_self boolean, self_unassign_block_code text, self_unassign_will_lose_access boolean, depends_on_task_id uuid, is_confidential boolean, allowed_viewers jsonb, dependency_options jsonb, viewer_options jsonb, primary_assignees jsonb, assist_assignees jsonb, assignee_options jsonb)` | Same order, with `can_edit_task boolean` inserted immediately after `can_set_confidentiality`. |

Both reader replacements explicitly drop the old signature, create the new
fixed shape, restore owner `postgres`, retain `SECURITY DEFINER` with empty
`search_path`, revoke from `PUBLIC`/`anon`/`authenticated`, then grant
only `authenticated`. The migration ends with a one-overload assertion for
each reader.

## Complete behavior differences

### `log_task_activity()`

Old:

- Ignored only `sort_order` when deciding whether an UPDATE was meaningful.
- Stored complete INSERT/UPDATE/DELETE row JSON, which would include a new
  `updated_at` column.

New:

- Ignores both `sort_order` and `updated_at` in the UPDATE comparison.
- Removes `updated_at` from INSERT, both UPDATE snapshots, and DELETE JSON.
- A status-only edit remains meaningful because `status` is still compared;
  it still produces one action `UPDATE` row.
- Owner, empty path, definer mode, trigger return, and grants are unchanged.

### `get_task_detail(uuid)`

Old returned no task concurrency token. New returns the stored token only for a
real-content row and returns null in the masked shell. Every other real/masked/
hidden, dependency-label, access-list, priority, active-profile, and grant rule
is unchanged.

### `get_task_edit_controls(uuid)`

Old exposed the existing dependency/confidentiality/assignment/delete/self-
unassign capabilities. New adds a separate `can_edit_task` capability that is
true only for an Active-event task and an active Admin or the active Co-Admin
whose current committee owns the stored task. Cross-committee leadership may
still receive the older controls exactly as before; that older breadth is
logged for Batch 14 instead of being silently changed here. Masked/hidden and
Archived behavior is unchanged.

### `guard_task_assignee_writes()`

Old trusted six assignment markers:
`create_event_with_tasks`, `edit_event_with_tasks`,
`assign_task_people`, `unassign_self`, `claim_task`, and
`accept_task_volunteer`.

New adds exactly `create_active_event_task` and
`edit_active_event_task`. The current-user-is-postgres condition, INSERT/
UPDATE array-change detection, error, owner, empty path, and no-client-grant
contract are unchanged.

### `restrict_assignee_task_updates()`

Old had one six-column postgres-owner union, with Edit Event falling through to
the authenticated Admin/Co-Admin branch.

New has three explicit branches:

1. the ordinary exact six-column union:
   `status | sort_order | depends_on_task_id | primary_assignees |
   assist_assignees | request_backup`;
2. Edit Event:
   `title | description | committee_id | phase | priority | task_type |
   due_date | call_time | end_time | primary_assignees`;
3. Edit Active Task:
   `title | description | committee_id | phase | priority | task_type |
   due_date | call_time | end_time | primary_assignees | assist_assignees |
   is_confidential | allowed_viewers | status | sort_order`.

`assist_assignees` is required because the dialog edits primaries while
preserving stored assists and removes a promoted primary from the assist
array. `status` is required only for the database-controlled final-primary
reset from In Progress to To Do. `sort_order` is required only for
database-controlled destination-tail placement caused by that reset or a
phase change. Neither value is accepted from the caller, and an ordinary
same-phase content edit preserves both.

The non-postgres Admin/owning-Co-Admin and assignee-status-only branches remain
unchanged. `event_id`, `created_by`, dependency, backup, and the token are
never in either marker-specific content union.

### `set_task_destination_lane_order()`

Old let only Edit Event flow through the ordinary phase/status lane logic;
other postgres narrow writers could not change phase.

New lets Edit Event and Edit Active Task flow through the same lane logic.
Either phase/status change appends at the true destination lane tail through
the definer-visible helper, including rows hidden from the caller by RLS.
Unchanged-lane rank protection, dependency forward gate, overflow behavior,
owner, empty path, and grants remain unchanged.

### `edit_event_with_tasks(...)`

Old:

- Locked sorted discovered users, then the event row, then the event advisory
  key; task rows were acquired as loop statements reached them.
- Had the per-operation 200 payload length bounds but no event-total cap.
- Did not require per-task `updated_at` tokens.
- Used `40001` for a changed assignment lock set.

New:

- Retains the original sorted affected-user locks, event-row `FOR UPDATE`,
  event-advisory lock, and loop-acquired task-row order.
- Counts the all-status starting total while holding the event lock.
- Supplies a tightly bounded capacity-trigger context only during submitted
  additions, clears it before deletions, and performs the final total check.
  A final total above 200 is allowed only when it does not exceed a legacy
  starting total.
- Does not accept or inspect a per-task `updated_at` token. A zero-row task
  update retains the original `40001` / “The task changed. Refresh and try
  again.” behavior.
- Apart from the capacity context, starting count, and final-total check, Edit
  Event's validation, concurrency, lock acquisition, and task mutation
  behavior is unchanged.
- Event metadata validation, Draft→Active rules, deletion rules, final active-
  event invariant, exact event optimistic update, owner, empty path, and
  authenticated-only grant remain unchanged.

## New, not replaced

Migration A adds `set_task_updated_at()` and
`tasks_z4_set_updated_at`. Migration B adds
`count_event_tasks_for_capacity(uuid)`, `enforce_event_task_capacity()`,
`validate_active_event_task_payload(...)`, `create_active_event_task(...)`,
and `edit_active_event_task(...)`.
Their complete definitions are in the two migration files.

`count_event_tasks_for_capacity(uuid)` is the minimal RLS-crossing boundary:
postgres-owned, fixed-empty-path, `VOLATILE SECURITY DEFINER`, scalar count
only, and executable by `authenticated` solely so the invoker capacity trigger
can call it. A top-level call fails with `42501` when
`pg_trigger_depth() = 0`. Keeping it volatile makes its task count use a fresh
snapshot after the trigger's event-row and advisory-lock wait. `PUBLIC` and
`anon` have no execute privilege.

## Final lock order by path

Sorted assignee-user advisory locks, when needed, remain before the parent
locks. The shared parent order is always **event row → event advisory lock →
task rows**:

- **Create Event:** sorted proposed-assignee user locks → newly inserted event
  row owned by the transaction → capacity-trigger event `FOR SHARE` → event
  advisory lock → count and task inserts.
- **Edit Event:** sorted stored/proposed assignee user locks → event
  `FOR UPDATE` → event advisory lock → task updates/deletes as the original
  loops reach them. Capacity checks reacquire the parent locks reentrantly.
- **Template import:** read-only import followed by the unchanged Create Event
  save path.
- **Active-board Add Task:** sorted existing proposed-primary user locks only
  → event `FOR SHARE` → event advisory lock → task insert; the capacity
  trigger repeats the parent locks reentrantly.
- **Active-board Edit Task:** sorted existing union of discovered stored
  primaries, stored assists, and proposed primaries → event `FOR SHARE` →
  event advisory lock → task `FOR UPDATE` → authoritative recomputation of
  the same sorted union. A mismatch raises only `CCL01` before any write.
- **Direct task insert:** capacity-trigger event `FOR SHARE` → event advisory
  lock → definer helper's all-status, RLS-independent fresh count → row
  insertion. Later insert triggers reuse the same order; unapproved non-empty
  assignments still fail closed.

Viewers are validation inputs, not assignment-array writers, and are excluded
from both new user-lock sets.

For the one-task editor, a missing post-event-lock task is `42501` “The task
is unavailable.” A genuine recomputed assignment-lock-set mismatch is
`CCL01`. A stale expected token or zero-row optimistic update is `CCS01`
with “This task changed after you loaded it. Reload and try again.”

