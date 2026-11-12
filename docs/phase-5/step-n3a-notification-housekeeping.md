# Phase 5 N3a — notification housekeeping

Branch: `feature/notification-housekeeping`

N3a adds database-only owner deletion and bounded automatic cleanup. N3b UI is
separate and must start from updated `main` only after N3a is merged and live.
There is no P1 push, email, Discord, D1, D2, or O1 work here.

## Fixed decisions

- A signed-in active profile may delete one of its own notifications. A missing
  row or another user's row returns `false`; ownership is not disclosed.
- Clear-read selects read notifications owned by that caller in ID order with
  `FOR UPDATE SKIP LOCKED`, including unloaded pages, deletes the selected
  unlocked rows, and returns the number removed. It never waits on a row locked
  by a cascade and never touches unread rows; a concurrently locked read row
  remains for a later clear or automatic run.
- Read notifications become automatically eligible 60 days after `read_at`.
  Unread rows have no `read_at`, are never automatically removed, and can
  accumulate indefinitely. Revisit this only after measuring real Dev and Prod.
- Each automatic run deletes at most 500 eligible rows, oldest `read_at` first.
- Private aggregate run history is retained 30 days, with at most 500 old
  history rows removed per run.
- Prod runs daily at `15 16 * * *` UTC, ten minutes after the existing event
  auto-archive job. Dev has no cron job; the owner invokes the runner manually.
- Deletion is permanent and cannot be recovered. N3b must state that plainly.

## Latest old versus N3a

| Function or policy | Latest definition before N3a | N3a definition | Behavior difference |
| --- | --- | --- | --- |
| Policy `notifications_select_own` | N1 active-owner authenticated SELECT | Unchanged | None. |
| Policy `notifications_update_own` | N1 `USING (false) WITH CHECK (false)` | Unchanged | None; N3a adds no DELETE policy. |
| `public.delete_notification(uuid)` | Absent | Active-profile authenticated wrapper | Permanently deletes only a caller-owned row; absent/foreign returns `false`. |
| `ceit_connect_private.delete_notification_for_user(uuid,uuid)` | Absent | Ungranted private definer | Qualified owner-and-ID DELETE used only after public authorization. |
| `public.clear_read_notifications()` | Absent | Active-profile authenticated wrapper | Authorizes before mutation and returns the count of selected unlocked read rows removed. |
| `ceit_connect_private.clear_read_notifications_for_user(uuid)` | Absent | Ungranted private definer | Selects owner read rows in ID order with `SKIP LOCKED`, deletes only those victims, and never matches unread rows. |
| `public.notification_read_retention_days()` | Absent | Immutable ungranted constant `60` | Fixes automatic eligibility to 60 days after read time. |
| `public.notification_cleanup_run_retention_days()` | Absent | Immutable ungranted constant `30` | Fixes private run-history retention to 30 days. |
| `public.notification_cleanup_batch_size()` | Absent | Immutable ungranted constant `500` | Bounds both cleanup and history-purge work per invocation. |
| `ceit_connect_private.purge_old_read_notifications(timestamptz)` | Absent | Postgres-session-only private definer | Locks/deletes at most 500 oldest eligible read rows with `SKIP LOCKED`. |
| `ceit_connect_private.purge_notification_cleanup_runs()` | Absent | Postgres-session-only private definer | Deletes at most 500 finished private history rows older than 30 days. |
| `public.run_notification_cleanup()` | Absent | Postgres-session-only ungranted runner | Uses an advisory overlap guard, records aggregate results, and isolates fixed safe failures. |
| Raw table privileges | Authenticated has SELECT only | Unchanged | No browser role receives raw DELETE. |
| Cleanup index | N1 paging and unread indexes | Adds partial `(read_at,id) WHERE read_at IS NOT NULL` | Supports oldest-first eligible-row selection without changing readers. |

Every public browser wrapper derives `auth.uid()`, verifies an active profile,
and only then calls its private mutator. That authorization happens before the
DELETE can lock a notification row. All columns in mutators are qualified.
Only the two owner wrappers grant execute to `authenticated`; `anon` and
`service_role` are denied. The runner and private helpers grant no application
role execute permission and also require `session_user = 'postgres'`.

The latest `guard_officer_user_writes()` INSERT branch technically accepts a
Member with a null committee because it restricts only Admin/Co-Admin creation,
and `users.committee_id` is nullable. N3a nevertheless creates and assigns its
own fixture committee in both pastes, matching N1 and normal council data.

The history table contains aggregate timing, status, counts, and fixed safe
errors only. It contains no notification, user, task, event, or comment ID; has
RLS enabled; has no policies; and grants no application role access.

## Safety and cascade inventory

N3a never deletes users and does not mutate tasks, events, comments, or their
children. Existing task/event cascades are unchanged. It adds no foreign key,
so CCE09 and the event-deletion lock inventory do not change. A user sees a
deleted notification disappear permanently; there is no restore operation.

## Real-size measurement

Run this same read-only statement once on Prod and once on Dev in the SQL
Editor. It returns one aggregate row, no contents, and no identities:

```sql
select
  pg_catalog.count(*)::bigint as total_rows,
  pg_catalog.count(*) filter (where notification_row.read_at is null)::bigint as unread_rows,
  pg_catalog.count(*) filter (where notification_row.read_at is not null)::bigint as read_rows,
  pg_catalog.count(*) filter (
    where notification_row.read_at < pg_catalog.now() - interval '60 days'
  )::bigint as read_older_than_60_days,
  pg_catalog.count(*) filter (
    where notification_row.read_at is null
      and notification_row.created_at < pg_catalog.now() - interval '60 days'
  )::bigint as unread_older_than_60_days,
  pg_catalog.min(notification_row.created_at) as oldest_created_at,
  pg_catalog.min(notification_row.read_at) filter (
    where notification_row.read_at is not null
  ) as oldest_read_at,
  pg_catalog.pg_relation_size('public.notifications'::regclass)::bigint as table_bytes,
  pg_catalog.pg_indexes_size('public.notifications'::regclass)::bigint as index_bytes,
  pg_catalog.pg_total_relation_size('public.notifications'::regclass)::bigint as total_bytes
from public.notifications as notification_row;
```

## Dev verification

- Paste A: `step-n3a-notification-housekeeping-catalog-tests.md`.
- Paste B: `step-n3a-notification-housekeeping-behavior-tests.md`.
- Paste A's SQL block is 226 lines and records 38 results; Paste B's SQL block
  is 212 lines and records 32 results.
- Both run on Dev only, with **Run without RLS**, own Auth/profile fixtures,
  ordinary in-transaction result tables, impersonation, and a final intentional
  matching `TEST RESULTS 38/38 PASS` or `TEST RESULTS 32/32 PASS` exception.
- Dev gets no cron row. After both pastes pass, the owner may manually run:

```sql
select * from public.run_notification_cleanup();
```

Verify the returned status is `completed`, `out_deleted_count <= 500`, and no
fixed safe error is present in its matching private history row.

### Existing assertion inventory

- N1 Paste A remains valid unchanged: N3a preserves authenticated SELECT-only
  table access and the exact two N1 policies.
- `notification-foundation-migration-contract.test.ts` is updated only so N1
  remains the latest migration that defines those policies rather than the
  latest migration overall.
- The frozen Phase 4 Step 10 and Phase 4B Step 14 Dev pastes are not edited;
  their header successor notes point to the N3a catalog and Paste A.
- `docs/phase-4/step-10-database-review.md` keeps its historical totals and now
  points to the N3a source-bound extension.
- New N3a Paste A is the authoritative current assertion for notification
  privileges, unchanged policies, function grants, private history, and catalog
  membership. Paste B owns behavior and bounded-retention proof.

### Expected-number reconciliation

| Existing file or assertion | Before N3a | After N3a | Reason |
| --- | --- | --- | --- |
| `notification-foundation-migration-contract.test.ts` latest migration | `20261110120000_notification_foundation.sql` | `20261111120000_notification_housekeeping.sql` | N3a is later, while N1 remains the latest migration that defines the two notification policies. N1's 8 contract tests and its Paste A/B expectations of 30/48 are unchanged. |
| `PHASE-4-STEP-10-TESTS.md` historical gate | 65 functions, 8 tables, 11 policies, 22 triggers, 0 overloads | Unchanged historical values; add successor pointer to N3a Paste A 38/38 | The frozen paste is not a current post-N1/N3a catalog gate. |
| `step-10-database-review.md` historical review | N1 Paste A 30/30 successor | N1 remains 30/30; N3a successor is 38/38 | No historical aggregate is rewritten. |
| `step-14-tests.md` frozen Batch 14 paste | 33/33; N1 successor 30/30 | 33/33 and N1 30/30 unchanged; add N3a successor 38/38 | Its historical notification CRUD expectation must not be rerun. |
| `DATABASE.md` migration ledger | Latest ordinal 72 | Add N3a as ordinal 73 | One new tracked migration; no old schema count is reinterpreted. |
| `ARCHITECTURE.md` notification summary | N1/N2 state; no housekeeping numbers | Add 60-day read retention and maximum 500 per run | These are new N3a constants, not changes to an older expected count. |
| `catalog.md` phase coverage | N1 objects only | N1 and N3a; constants 60/30/500 | Adds a source-bound N3a section without inventing a global object total. |
| N3a Paste A plan/result ledger | Planned 38; first draft 30 | **38/38 final** | Restores eight omitted catalog checks: history owner, non-forced RLS, history index, no overloads, automatic-purge shape, clear-read lock shape, clear victim boundary, and exact deletion return/volatility. |
| N3a Paste B plan/result ledger | Planned 32; first draft 30 | **32/32 final** | Adds two explicit clear-read checks for ID-order/`SKIP LOCKED` selection and victim-only deletion. |

After applying N3a on Dev, rerun the older **N1 Paste A (30/30)** because it
owns the notification policy and table-privilege baseline. Then run N3a Paste A
(38/38) and N3a Paste B (32/32). Do not rerun N1 Paste B, the frozen Phase 4
Step 10 paste, or the frozen Phase 4B Step 14 paste: N3a replaces no generation,
reader, policy, task/event/comment, or Batch 14 behavior covered by those pastes.

## Prod owner scheduling and verification

After the migration is applied to Prod and the smoke checks pass:

1. Confirm the name does not already exist:

   ```sql
   select jobid,jobname,schedule,command,database,username,active
   from cron.job
   where jobname='ceit-connect-notification-cleanup';
   ```

2. Only when that returns zero rows, create the one postgres-owned job:

   ```sql
   select cron.schedule(
     'ceit-connect-notification-cleanup',
     '15 16 * * *',
     'select * from public.run_notification_cleanup();'
   );
   ```

3. Re-run the query from step 1. Require exactly one active row with schedule
   `15 16 * * *`, exact command `select * from public.run_notification_cleanup();`,
   the Prod database, and username `postgres`.
4. After its first scheduled time, verify execution and the private aggregate:

   ```sql
   select status,return_message,start_time,end_time
   from cron.job_run_details
   where jobid=(
     select jobid from cron.job
     where jobname='ceit-connect-notification-cleanup'
   )
   order by start_time desc
   limit 5;

   select started_at,finished_at,cutoff_at,status,eligible_count,deleted_count,
     retention_deleted_count,cleanup_error_sqlstate,cleanup_error_message,
     retention_error_sqlstate,retention_error_message
   from ceit_connect_private.notification_cleanup_runs
   order by started_at desc
   limit 5;
   ```

Require a successful cron result, a completed aggregate row, and
`deleted_count <= 500`. Never create this cron job on Dev.

## N3b outline (later branch only)

Branch `feature/notification-housekeeping-ui`, after N3a is merged and live:

- Add a no-dialog Delete action per row and an inline two-step Clear read /
  Confirm clear read / Cancel control.
- Clear-read applies account-wide, not only to the visible page; rows locked by
  concurrent cascades are skipped without waiting and remain for a later run.
- Keep failures visible with fixed safe copy and settle every busy state.
- State accessibly that deleted notifications cannot be recovered.
- Reconcile another-device deletions by first-page refetch on panel open, window
  focus, and visibility return; do not add a DELETE Realtime subscription.
- After delete-one, remove that ID locally, reset/refetch the first-page cursor,
  and preserve the badge from the count reader only. After clear-read, reset the
  loaded pages/cursor and refetch both list and count. Reduced motion removes
  transitions without delaying state settlement.
- Ship its own step document, unit tests, and phone/desktop manual checklist.

## Risks and deferred observations

- R1's five request types need no cleanup-function change: N3a selects by
  ownership, `read_at`, age, and stable ID rather than by notification type.
  Read request notifications therefore age out under the same 60-day bound,
  while unread request notifications remain protected.
- Unread rows are retained forever and may grow without bound; measurements
  decide whether a later, separately approved policy is needed.
- Cleanup drains a large read backlog over multiple daily runs by design.
- Deletion is irreversible; the UI must not imply undo or recovery.
- Existing unrelated deferred findings remain in `docs/PROGRESS.md`; N3a does
  not repair them.
