# Batch A function and trigger diff

This compares every Batch A replacement with the latest body immediately before `20261106120000_event_phase_positions.sql` or `20261106130000_peer_admin_lifecycle.sql`. Historical migration bodies are not treated as current.

## Replaced functions

| Function | Latest pre-A source | Before Batch A | After Batch A |
|---|---|---|---|
| `create_event_with_tasks(text,text,date,date,text,jsonb)` | `20261029150000_task_rules.sql` wrapper over the hardened Step 10 body | Creates tasks in payload order but stores no phase order. | Same authorization, Draft-cap lock, validation, assignment marker, and return value through the renamed latest definer body; then locks event → event advisory and stores canonical payload first-seen phase order. |
| `edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)` | `20261030130000_draft_task_visibility.sql`, with its physical Step 12 body updated by `20261031140000_completed_phase_freeze.sql` | Accepts rename/delete only; performs active-officer authorization, assignee locks, event lock, Draft creator lock, then delegates. The prior writer updates tasks before the event row. | Same latest body and lock sequence. `IS DISTINCT FROM` keeps typeless/malformed actions for the prior validator. A postgres-only, event-bound marker supplies the proposed end date to task schedule triggers and is cleared after delegation on success or error. Stored rename positions are snapshotted before delegation; rename inherits the source position, merge keeps the destination, and an explicit reorder runs last and wins. Archived reorder remains rejected. |
| `create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)` | `20261031120000_template_import_all_committees.sql` | Safely copies retained foreign tasks and creates caller-owned tasks, but copy order is `created_at,id`. | Same latest writer; final reconciliation preserves stored source phase positions and appends destination-only phases. Deadline insert triggers atomically reject shifted dates beyond the new end date. |
| `get_archived_event_template(uuid,date)` | `20261031120000_template_import_all_committees.sql` | Returns safe non-confidential shifted rows ordered `created_at,id`. | Same authorization, masking, shape, shift, and counts; reorders returned JSON by stored source phase position and original JSON ordinality. |
| `list_draft_event_editor_tasks(uuid)` | `20261101120000_completed_phase_ui_readers.sql` | Latest visibility/masking/completion wrapper returns prior-row ordinality. | Same rows and shape, ordered by phase position then existing task lane order. |
| `list_event_board_tasks(uuid,uuid)` | `20261101120000_completed_phase_ui_readers.sql` | Latest visibility/masking/completion wrapper returns prior-row ordinality. | Same rows and shape, ordered by phase position then existing task lane order. |
| `list_home_event_progress(uuid[])` | `20261025120000_home_event_progress.sql` | Chooses current incomplete phase by its first task’s `sort_order,id`. | Preserves request, visibility, masking, progress, backup, and Backlog contracts; computes `task_content_access_for_user` once per task in a materialized CTE and chooses the lowest positioned incomplete phase. |
| `former_member_eligibility(uuid)` | `20261027150000_former_member_anonymization.sql` | Returns `admin` for every Admin target. | Removes role-based exclusion; inactive peer Admins pass through self, active, anonymized, and open-task checks. |
| `set_officer_active(uuid,boolean)` | `20261027150000_former_member_anonymization.sql` | Locks before authorization and accepts Co-Admin targets only. | Authorizes and rejects self before locking; then officer advisory → reauthorization → sorted user lock. Accepts Admin/Co-Admin, protects the last confirmed Admin, preserves invitation rules, applies role caps on reactivation, clears avatar on deactivation, and preserves role. |
| `anonymize_former_member(uuid)` | `20261027150000_former_member_anonymization.sql` | Takes a user lock and excludes Admin in its guarded update. | Authorizes/self-rejects before locking; then officer advisory → reauthorization → sorted user lock. Uses the same anonymization fields and open-task rule without excluding Admin, and verifies the role is unchanged. |

## Required latest-body comparisons

| Function | Latest old body | Final Batch A body |
|---|---|---|
| `anonymize_former_member` | `20261027150000_former_member_anonymization.sql`: excludes Admin and wraps the guarded update in an inner handler that clears `former_member_writer` and raises `CMR05`. | Replaces the target restriction and lock order, but retains that inner handler and exact error contract while verifying that the historical role is unchanged. |
| `list_home_event_progress` | `20261025120000_home_event_progress.sql`: current phase follows first task `sort_order,id`. | A materialized task CTE computes `task_content_access_for_user` once per task and the lowest stored incomplete phase drives progress; output and masking stay unchanged. |
| `list_event_board_tasks` | `20261101120000_completed_phase_ui_readers.sql`: 15-column completed-phase-aware prior order. | `SELECT prior.*` preserves the exact 15 columns/types; only ordering changes to phase position, then lane `sort_order,id`. |
| `list_draft_event_editor_tasks` | `20261101120000_completed_phase_ui_readers.sql`: 19-column masked/completion-aware prior order. | `SELECT prior.*` preserves the exact 19 columns/types; only ordering changes to phase position, then prior ordinality. |
| `get_archived_event_template` | `20261031120000_template_import_all_committees.sql`: five outputs with safe masking and shifted deadlines, ordered `created_at,id`. | The same five outputs/types are ordered by source phase position and original ordinality; the deadline trigger rejects an out-of-range shifted schedule. |

The final `anonymize_former_member` therefore keeps the old inner `CMR05` handler: update failures still become `Anonymization failed before its invariant could be verified.` No route or caller sees a changed error contract.

## New functions

- `ceit_connect_private.reconcile_event_phase_positions(uuid,text[])`
- `ceit_connect_private.defer_event_phase_reconciliation()`
- `public.list_event_phase_order(uuid)`
- `public.get_admin_lifecycle_context()`
- `ceit_connect_private.schedule_after_event_end(timestamptz,date)`
- `ceit_connect_private.guard_task_event_end()`
- `ceit_connect_private.guard_event_end_shortening()`

None of the new private functions or the private phase table is granted to browser or service roles. No RLS policy is replaced.

`list_event_phase_order` keeps Draft officer-only and Active behavior unchanged. Archived order is available to every active caller, matching `events_select`, but each phase requires at least one task for which that caller's content access is `real`; a confidential-only phase is therefore never disclosed.

## Dev push syntax correction and CREATE-time scan

The first Dev attempt rolled back before Batch A was recorded or left any objects. PostgreSQL rejected the unquoted keyword-like OUT name in `list_event_phase_order`; the public shape remains exactly `phase_key, position`, but the declaration is now `returns table (phase_key text, "position" bigint)`. No app contract changed.

The phase-position helper schema-qualifies `ceit_connect_private.event_phase_positions_event_position_key` in `SET CONSTRAINTS`, which is required under its empty definer search path. The revised SQL paste executes a real reorder through the public writer and verifies the stored result.

All three migrations were then rescanned as complete CREATE scripts:

| Check | Result |
|---|---|
| `RETURNS TABLE` and `WITH ORDINALITY` names | No other reserved/keyword-sensitive OUT or alias name requires quoting. A static test rejects any unquoted `position` output in all three Batch A migrations. |
| `list_draft_event_editor_tasks` SQL wrapper | Its 19 outputs, order, and types exactly match the latest `20261101120000_completed_phase_ui_readers.sql` body; `select prior.*` contributes exactly those 19 columns. |
| `list_event_board_tasks` SQL wrapper | Its 15 outputs, order, and types exactly match the latest `20261101120000_completed_phase_ui_readers.sql` body; `select prior.*` contributes exactly those 15 columns. |
| `get_archived_event_template` SQL wrapper | Its five explicit expressions match the latest five outputs and types in `20261031120000_template_import_all_committees.sql`. |
| Scalar writer wrappers | `create_event_with_tasks`, `edit_event_with_tasks`, and `create_event_from_archived_template` preserve the latest `uuid`, `timestamptz`, and `uuid` return types and exact argument signatures. |
| Other replaced table functions | `list_home_event_progress` preserves its five outputs from `20261025120000_home_event_progress.sql`; `former_member_eligibility` preserves ten outputs and `anonymize_former_member` five outputs from `20261027150000_former_member_anonymization.sql`; `set_officer_active` remains `void`. |
| New table-returning function | `get_admin_lifecycle_context` has four integer/boolean expressions matching its four declared outputs. |
| Ambiguity and PL/pgSQL syntax | Queries that join multiple relations use qualified references where names overlap; OUT variables do not collide with unqualified query columns; declarations, `RETURN QUERY`, loops, trigger `NEW`/`OLD`, exception blocks, dollar quotes, and statement terminators were checked across migrations 1–3. No second CREATE-time defect was found. |

## Trigger order

PostgreSQL fires same-kind triggers alphabetically. Constraint-trigger phase reconciliation is deferred until transaction end.

### Tasks before Batch A

| Effective point | Trigger | Purpose |
|---|---|---|
| BEFORE | `tasks_guard_archived_event_writes` | Archived freeze. |
| BEFORE | `tasks_h0_guard_completed_phase_writes` | Completed-phase freeze and event/phase locking. |
| BEFORE | `tasks_restrict_assignee_updates` and later access/assignee guards | Existing protected-column boundaries. |
| BEFORE/AFTER | Existing dependency, metadata, activity, and deletion-child triggers | Existing Step 5–13 behavior. |

### Tasks after Batch A

| Effective point | Trigger | Purpose |
|---|---|---|
| BEFORE | Existing archived/completed/access/assignee triggers | Unchanged and still precede deadline enforcement where applicable. |
| BEFORE | `tasks_i0_guard_event_end` | Validates only inserted or actually changed schedule fields; emits `CCD05`, `CCD02`, or `CCD03`. |
| BEFORE/AFTER | Existing dependency, metadata, activity, and deletion-child triggers | Unchanged. |
| DEFERRED AFTER | `tasks_z9_reconcile_event_phase_positions` | One reconciliation per surviving event per transaction using the documented `pg_temp` seen-set; takes the compatible event `FOR SHARE` lock before the event advisory lock, avoids share-to-update upgrades, and skips Batch 13d cascades. |

### Events before Batch A

| Effective point | Trigger | Purpose |
|---|---|---|
| BEFORE | `guard_event_updates` | Existing authorization and Archived freeze. |
| BEFORE | `events_set_updated_at` | Existing version token update. |

### Events after Batch A

| Effective point | Trigger | Purpose |
|---|---|---|
| BEFORE | `guard_event_updates` | Unchanged; Archived errors retain precedence. |
| BEFORE | `events_set_updated_at` | Unchanged. |
| BEFORE | `events_z0_guard_end_shortening` | Checks retained schedules only for null → value or a strictly earlier end date. Equal dates and extensions return immediately. |

## Audited but unchanged

- `guard_officer_user_writes()` and `users_guard_officer_writes`
- `preview_former_member_removal(uuid[])`
- `cleanup_former_member_auth(uuid)` from `20261027180000_former_member_auth_identity_cleanup.sql`
- `copy_archived_template_tasks(uuid,uuid,date,uuid[])`
- completed-phase helpers and phase locks
- every task/event RLS policy
