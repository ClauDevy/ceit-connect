# Batch B Stage 2 — function and trigger diff

This file compares Stage 2 against the latest function body present immediately before each Batch B replacement. `pre_batch_b` functions are revoked implementation details; the public signature, caller grant, return shape, authorization, and established lock sequence remain at the wrapper.

## Replaced functions

| Function | Latest pre-B source | Before | Stage 2 after | Replacement form |
|---|---|---|---|---|
| `log_task_activity()` | `20261031130000_event_deletion.sql` | Wrote full legacy task JSON snapshots; ignored rank/`updated_at`-only updates; event-delete actor came from the private cascade context. | Calls private `write_activity`; emits ID-first semantic task rows, confidentiality evidence, changed-field codes, assignment UUIDs, and the approved proven deleted-title snapshot. Zero retained deletion evidence stores no title and is non-confidential; malformed or ever-confidential evidence fails closed. Per-person primary/assist role changes emit `assignees`, committee changes emit `committee`, and otherwise-unclassified material changes emit `other`. Only task phase changes matching the wrapper’s canonical rename pairs are suppressed. Missing actors become `actor_kind='unavailable'`. | Full-body replacement; existing `tasks_activity_log` trigger retained. |
| `create_event_with_tasks(text,text,date,date,text,jsonb)` | `20261106120000_event_phase_positions.sql` | Latest Batch A wrapper delegated to its hardened prior body, then locked event → event advisory and reconciled phase positions. | Renamed unchanged latest body to `create_event_with_tasks_pre_batch_b`; wrapper delegates first, writes `event_created`, then writes `event_launched` when the resulting requested status is Active. | Rename + wrapper. |
| `create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)` | `20261106120000_event_phase_positions.sql` | Latest Batch A wrapper delegated to the all-committee template writer, then retained its event/advisory lock and phase-position reconciliation. | Renamed unchanged latest body; wrapper delegates first, writes exactly one `event_created_from_template` with source UUID only, then writes `event_launched` for Active. The prior chain inserts directly and never calls the public create wrapper. | Rename + wrapper. |
| `edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)` | `20261106120000_event_phase_positions.sql` | Authorized active leadership before its existing editor; preserved event-end override context; reconciled rename/reorder phase positions after the prior writer. | Renamed unchanged latest body. New wrapper repeats the same pre-lock authorization and takes all event/task/phase before-snapshots **before the renamed body acquires any existing locks**. It passes canonical rename pairs through transaction-local private context, delegates through the unchanged lock path, clears that context on success and error, then writes actual-change event/phase rows while locks remain transaction-held. Phase moves use dense ranks among mapped survivors. | Rename + wrapper. |
| `archive_event(uuid,bigint,timestamptz)` | `20261016130000_transactional_archive_rpc.sql` | Authorized active Admin before event `FOR UPDATE`, checked expected version and incomplete count, then archived. | Renamed unchanged latest body; wrapper delegates and writes `event_archived` only after success. | Rename + wrapper. |
| `delete_event(uuid,uuid,timestamptz)` | `20261031130000_event_deletion.sql` | Dedicated `ceit_event_delete_executor` definer authorized the passed active Admin before creating the transaction-bound cascade context, then delegated to the generic locked delete executor. | The migration temporarily grants `postgres` membership in the NOLOGIN owner before renaming the unchanged latest body. The new executor-owned wrapper obtains an authorization-gated non-locking name/status snapshot, delegates to the prior body, then writes `event_deleted`; a nonblank name is capped with `left(name,150)`, while a blank name omits the key. Temporary executor `CREATE` and role membership are revoked in the same transaction, and the prior body remains ungranted. | Rename + wrapper; dedicated executor preserved. |

## Event-deletion locker follow-up: old versus new

`20261107120000_event_phase_delete_lock_inventory.sql` follows the applied Stage 2 files; it does not edit them. Batch A introduced a second event-referencing foreign key after Batch 13d pinned its exact inventory, so the old locker now fails closed with `CCE09` before any delete.

| Concern | Old locker | New locker |
|---|---|---|
| Exact inventory | Eight reviewed rows: `tasks_event_id_fkey`, the task self-reference, and six task-child foreign keys. | The same eight rows plus `event_phase_positions_event_id_fkey` as one `event_child_rows` entry at order 90. |
| Accepted kinds | `task_rows`, `task_child_rows`. | Adds only `event_child_rows`; the CHECK still rejects every unknown kind. |
| Task rows | Locks event tasks by sorted task UUID before the generic child loop. | Identical. |
| Task children | Iterates `task_child_rows` by orders 30–80 and locks rows whose FK is `ANY (v_task_ids)`. | Identical predicate and order. |
| Event children | None; the exact-count guard therefore rejects Batch A's new event FK. | The same ordered loop accepts `event_child_rows` and locks rows whose FK equals `p_event_id`; the phase-position row runs after task children at order 90. |
| Authorization/context | Requires the existing private transaction-bound deletion context before catalog or row work. | Identical first check and `CCE08` behavior. No authorization helper or public boundary is replaced. |
| Ownership/grants/path | `postgres`, volatile definer, empty `search_path`, executable by no exposed role or deletion executor. | Identical. |

The resulting deletion sequence remains: authorization -> event row -> event advisory -> task rows -> task-child rows -> phase-position event-child rows. No user lock is added or reordered; event writers that already take sorted user locks before the event row keep that outer order unchanged.

The complete tracked foreign-key inventory after the follow-up is:

- To `events`: `tasks_event_id_fkey`, `event_phase_positions_event_id_fkey`.
- To `tasks`: `tasks_depends_on_task_id_fkey`, `task_work_links_task_id_fkey`, `task_volunteers_task_id_fkey`, `task_comments_task_id_fkey`, `archived_task_viewers_task_id_fkey`, `notifications_task_id_fkey`, and `task_leave_requests_task_id_fkey`.

No other tracked table has a foreign key to `events` or `tasks`. Paste E compares the deployed catalog and inventory in both directions so an environment-only extra or stale entry also fails verification.

## New functions

| Function | Owner | Mode/path | Execute grants | Purpose |
|---|---|---|---|---|
| `ceit_connect_private.write_activity(...)` | `postgres` | volatile definer, empty path | none to browser/service roles; `ceit_event_delete_executor` only | Validates catalog type/action/subject, allowed payload keys, actor shape, table constraints, and 100-character protected phase text before insert. |
| `ceit_connect_private.log_task_leave_activity()` | `postgres` | volatile trigger definer, empty path | none | Writes requested/approved/rejected/cancelled task rows from stored request/task facts. |
| `ceit_connect_private.log_task_volunteer_activity()` | `postgres` | volatile trigger definer, empty path | none | Writes only real volunteer INSERTs; cleanup deletes write nothing. |
| `ceit_connect_private.log_user_lifecycle_activity()` | `postgres` | volatile trigger definer, empty path | none | Writes profile creation and lifecycle changes; ordinary name/avatar/Discord updates return without writing. |
| `ceit_connect_private.log_officer_invite_activity()` | `postgres` | volatile trigger definer, empty path | none | Writes invitation creation and cancellation without email or name. |
| `ceit_connect_private.event_delete_audit_snapshot(uuid,uuid)` | `postgres` | stable definer, empty path | executor only | Reauthorizes the passed Admin before reading the event name/status without locking. |
| `delete_events_bulk(jsonb,uuid)` | `ceit_event_delete_executor` | volatile definer, empty path | `service_role` | Sorts up to ten IDs, invokes one delete subtransaction per item, preserves partial results, and writes one successful-count summary in the same outer transaction. |
| `finalize_former_member_bulk_activity(uuid[])` | `postgres` | volatile definer, empty path | `authenticated` | Active-Admin-only, retry-idempotent proof/finalization of 2–50 completed person-removal rows. |

## Trigger order

PostgreSQL fires triggers of the same timing/event alphabetically. Constraint triggers retain their configured deferred behavior.

### `tasks`

| Timing | Before Stage 2 | After Stage 2 |
|---|---|---|
| BEFORE INSERT | `tasks_a0_enforce_event_capacity` → `tasks_guard_access_writes` → `tasks_guard_archived_event_writes` → `tasks_guard_assignee_writes` → `tasks_h0_guard_completed_phase_writes` → `tasks_i0_guard_event_end` → `tasks_validate_dependency` → `tasks_z0_reject_event_id_changes` → `tasks_z1_reject_created_by_changes` → `tasks_z2_set_destination_lane_order` → `tasks_z3_assign_creation_metadata` → `tasks_z4_set_updated_at` | Unchanged. |
| BEFORE UPDATE | Applicable guards above in alphabetical order, including completed-phase/end/dependency/immutable-field guards and `tasks_z4_set_updated_at`. | Unchanged. |
| BEFORE DELETE | `tasks_b0_open_task_delete_cascade_context` → archived/completed/dependency guards. | Unchanged. |
| AFTER row | `tasks_activity_log` → `tasks_cancel_stale_leave_requests`; deferred `tasks_close_task_delete_cascade_context`, active-event invariants, and `tasks_z9_reconcile_event_phase_positions`. | Same order and trigger names; only `tasks_activity_log` body becomes semantic. Leave-request updates then fire their own audit trigger. |

### `users`

| Timing | Before Stage 2 | After Stage 2 |
|---|---|---|
| BEFORE INSERT/UPDATE/DELETE | `users_guard_officer_writes` | Unchanged. |
| AFTER INSERT/UPDATE | none | `users_z9_activity_log` |

### `events`

| Timing | Before Stage 2 | After Stage 2 |
|---|---|---|
| BEFORE INSERT | `events_enforce_creator_draft_cap` → `events_guard_banner_url` → `events_set_updated_at` | Unchanged. |
| BEFORE UPDATE | applicable banner/timestamp/end-shortening guards in alphabetical order | Unchanged. |
| AFTER UPDATE | `events_cancel_inactive_leave_requests`; deferred Active-event requirement where applicable | Unchanged. Event semantic rows are written by successful public wrappers, not a broad table trigger. |

### `task_leave_requests`

| Timing | Before Stage 2 | After Stage 2 |
|---|---|---|
| BEFORE row | `task_leave_requests_a0_guard_completed_phase_writes` | Unchanged. |
| AFTER INSERT/UPDATE | none | `task_leave_requests_z9_activity_log` |

### `task_volunteers`

| Timing | Before Stage 2 | After Stage 2 |
|---|---|---|
| BEFORE row | `task_volunteers_a0_guard_completed_phase_writes` → `task_volunteers_guard_writes` | Unchanged. |
| AFTER INSERT | none | `task_volunteers_z9_activity_log` |

### `officer_invites`

| Timing | Before Stage 2 | After Stage 2 |
|---|---|---|
| AFTER INSERT/UPDATE | none | `officer_invites_z9_activity_log` |

## Route boundary changes

| Route | Before | After |
|---|---|---|
| `/api/event-deletion` | Verified active Admin, then called `delete_event` sequentially for each eligible item. | Keeps the same verification, authoritative reread, confirmation, cleanup, result ordering, and safe errors; sends eligible items once to `delete_events_bulk`, then performs returned cleanup jobs sequentially. |
| `/api/remove-former-members` | Completed each DB/Auth/identity/Storage workflow independently and returned results. | Same per-item workflow; when at least two newly anonymized items fully complete, calls the authenticated finalizer with only those UUIDs, excluding `already_anonymized` retries, retries once, and returns an explicit 500 error with retained results if both attempts fail. |
