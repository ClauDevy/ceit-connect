# Phase 4B — Batch A: real-phone testing fixes

**Branch:** `fix/phone-testing-bugs`  
**Status:** Implemented locally; migrations unapplied  
**Run order:** after Batch 4, before B, D, and 14

## Delivered scope

1. Phase deletion now reports the true progressed/completed count, up to three task names plus `and N more`, beside the affected phase. Deletion stays blocked.
2. `ceit_connect_private.event_phase_positions` stores event-wide phase positions. Backfill uses current `sort_order,id` first-seen order. New phases append. Named phases and virtual `Unphased` can move; `Unphased` cannot be renamed/deleted/completed/locked.
3. Pending invitations expose Cancel only and are never removal-selectable. Inactive Admins can be reactivated or anonymized by row or bulk actions. Blocked/anonymized states have phone-readable text instead of an empty disabled menu.
4. An Admin can deactivate, reactivate, or anonymize another Admin, never self or the final other confirmed active Admin. Role changes are unchanged. Authorization precedes the officer advisory lock, which precedes sorted user locks.
5. New/changed task schedules cannot exceed the event’s Manila end date. Existing rows are grandfathered per field. End-date shortening or null → value is blocked when retained schedules exceed it; extensions are never blocked.

## Phase maintenance mechanism

`tasks_z9_reconcile_event_phase_positions` is a deferred constraint trigger. At transaction end it inserts the event id into a `pg_temp` primary-key seen-set; only the first firing per event proceeds. It locks the surviving event row `FOR SHARE`, then takes `task_dependency_lock_key(event_id)`, then reconciles. Every task writer already holds that compatible event share lock through the archive guard, so the maintenance path never attempts a deadlock-prone share-to-update lock upgrade. Missing event rows return immediately, so Batch 13d cascades are skipped. The helper schema-qualifies `ceit_connect_private.event_phase_positions_event_position_key` when deferring the unique position constraint because its definer search path is empty. The exact mechanism is also documented in the migration comments.

Consumers:

- Home: `list_home_event_progress` selects the lowest positioned incomplete phase.
- Board: its fixed-shape reader orders by phase position, then lane rank/id.
- Edit Event: initial load reads the complete authorized server sequence. New phases append; Move Up/Down and metadata-only saves submit that complete sequence, preserving committee-scoped phases absent from the editable task subset. Rename inherits the old stored position, merge keeps the destination position, and a same-save explicit reorder wins.
- Archives/template preview: rows use stored positions. Every active user may read Archived order, but a stored phase is returned only when that caller has real access to at least one task in it. Masked archive content remains in the safe `Unphased` presentation and never reveals its original phase.
- Completed-phase logic: definitions and locks are unchanged; reordering does not mutate tasks.

Archived reorder is rejected with `CCP06`. Existing Draft/Active authority is unchanged.

## Deadline details

- `end_date` is the whole `Asia/Manila` calendar day.
- Dates before `start_date` remain valid.
- Drafts with null `end_date` have no upper bound.
- Task INSERT validates every supplied schedule field.
- Task UPDATE validates only fields that are actually distinct: `due_date`, `call_time`, or `end_time`. Errors identify the field through `CCD05`/`CCD02`/`CCD03` and never include a task title. `CCD05` was selected after a repository-wide `CCD0x`/`CCPxx` audit; `CCD01` remains reserved for prerequisite deletion and the existing Draft event-limit paths.
- Because Edit Event updates tasks before the event row, its wrapper sets a transaction-local proposed-end marker only around the prior writer call. The task trigger honors it only for postgres execution, the exact writer name, and the matching event id. A separate `is_set` value distinguishes an explicit null end from no marker. Success and error paths clear all values immediately; the retained-task event trigger remains final authority when the event row is written.
- Event UPDATE scans tasks only for null → value or a strictly earlier date. Equal dates and extensions return before the scan.
- Template-copy inserts pass through the same atomic database trigger.
- Archived and completed-phase freezes retain precedence.

Read-only Dev/Prod report:

```sql
select e.id event_id,e.name event_name,e.status event_status,e.end_date,
  t.id task_id,t.title task_title,public.canonical_task_phase(t.phase) phase,t.status task_status,
  timezone('Asia/Manila',t.due_date)::date due_date_manila,
  timezone('Asia/Manila',t.call_time)::date call_time_manila,
  timezone('Asia/Manila',t.end_time)::date end_time_manila,
  array_remove(array[
    case when t.due_date is not null and timezone('Asia/Manila',t.due_date)::date>e.end_date then 'due_date' end,
    case when t.call_time is not null and timezone('Asia/Manila',t.call_time)::date>e.end_date then 'call_time' end,
    case when t.end_time is not null and timezone('Asia/Manila',t.end_time)::date>e.end_date then 'end_time' end
  ],null) violating_fields
from public.tasks t join public.events e on e.id=t.event_id
where e.end_date is not null and (
  (t.due_date is not null and timezone('Asia/Manila',t.due_date)::date>e.end_date) or
  (t.call_time is not null and timezone('Asia/Manila',t.call_time)::date>e.end_date) or
  (t.end_time is not null and timezone('Asia/Manila',t.end_time)::date>e.end_date))
order by e.end_date,e.name,t.title,t.id;
```

Run separately in the Dev and Prod SQL Editors. It writes nothing and exposes confidential titles to the dashboard owner; do not publish its output.

## Delete-action audit

- Event/Draft: correct count/names and dialog-local errors; unchanged.
- Former-member removal: correct snapshot count and dialog-local results; unchanged.
- Phase: inaccurate single-name/page-bottom warning fixed.
- Task: count is correct for one task, but a failed delete can render behind the open dialog; listed only, not fixed.
- Archive: correct incomplete count and local modal/card error; unchanged.

## Files and catalog handoff

Migrations:

- `20261106120000_event_phase_positions.sql`
- `20261106130000_peer_admin_lifecycle.sql`
- `20261106140000_event_deadline_bounds.sql`

Batch 14 must absorb the private table, helpers, three triggers, new reader/context RPCs, replaced same-signature bodies, grants/revokes, and revoked `*_pre_batch_a` implementations into its authoritative catalog/allowlists. No policy is added or replaced.

The repository-wide SQLSTATE audit found existing `CCD01` uses for prerequisite deletion and Draft-limit paths; `CCD02`–`CCD04` remain Batch A's call-time, end-time, and event-shortening codes; `CCD05` was free and is now the due-date code. For the `CCPxx` family, `CCP01`/`CCP02` already exist, `CCP03`–`CCP05` are free, and Batch A already owns `CCP06`. No existing `CCD01` route or UI mapping was changed; the active-task mapping and its test now use `CCD05`.

See `step-a-function-diff.md` and `step-a-tests.md`.

The three Dev SQL pastes now expect **20**, **16**, and **24** evaluated result lines (60 total). They create their fixtures, exercise public writers, and never count placeholder PASS rows.

## Out of scope retained

Audit logging, auto-archive, styling/cards/cropper, selected-user bottom-bar layout, ordinary-Member Auth ban/unban, Co-Admin avatar-policy follow-up, the Member zero-row success issue, raw Member backend errors, and all other Batch 14/Deferred work.

## Verification commands

Only:

```text
npx.cmd tsc --noEmit
npm.cmd run test
npm.cmd run lint
```

Never build, commit, or run a Supabase command for this batch.
