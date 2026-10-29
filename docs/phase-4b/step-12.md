# Step 12: Activity Log page

**Status:** Batch 12 merged and live on Dev and Prod; Batch 12b retention implemented locally and awaiting owner-run Dev/Prod rollout | **Branches:** `feature/activity-log-page`, `feature/activity-log-retention` | **Reasoning level:** High (security-critical reader, raw-grant removal, confidential snapshots, and guarded retention)

## Goal

Build `/activity-log` as a read-only, paged view of the real task `INSERT`, `UPDATE`, and `DELETE` audit trail. Active Admins and Co-Admins see the whole log, but each entry exposes real task details only when current task-content access is `real`; otherwise it becomes a minimal `Confidential Task` entry. Members receive no global log and may read history only on a task page while they are currently a primary or assist assignee. Replace raw authenticated `activity_log` reads with a fixed-shape masked RPC so Draft and confidential snapshots cannot leak through `changes`.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Decisions (made by the owner): Activity Log

- Admins and Co-Admins see the whole log; confidential masking still applies.
- Members see only their own tasks’ history on the task page.
- The experience includes sorting, filters, search, 20-row cursor block pagination on the global page, and Load more in task History.

### `docs/PHASE-4B-PLAN.md` — Batches and Audit resolutions

- Batch 12 is `feature/activity-log-page` and runs after Batch 11.
- Batch 12 is security-critical.
- Add a masked `list_activity_log()` reader and revoke raw `activity_log` `SELECT` from `authenticated`.

### Owner clarifications for Step 12

- Show only real rows already written by the task activity trigger: task `INSERT`, `UPDATE`, and `DELETE`.
- Support newest/oldest sorting; action, committee, and Philippine-date filters; actor/task/event/committee search; and cursor-backed 20-row three-page blocks without a total count or guessed page cursors.
- Members have history only on `/tasks/[taskId]`, only while they are currently in `primary_assignees` or `assist_assignees`. Ordinary `allowed_viewers`, archive-only viewers, volunteers, and former assignees do not qualify. Access disappears on unassignment.
- Real details appear only when current `task_content_access` is `real`. Every other case returns a minimal `Confidential Task` entry containing only timestamp and action.
- Deleted confidential snapshots fail closed because no current task row remains against which to prove real access.

## Current state

- `activity_log` stores `id`, nullable `task_id`, nullable `user_id`, `action`, raw `changes jsonb`, and `created_at`. `changes` contains complete task snapshots: one row for INSERT/DELETE and `old`/`new` snapshots for UPDATE.
- `log_task_activity()` is a fixed-empty-path postgres-owned `SECURITY DEFINER` trigger function. It records every task insert/delete and every update except one whose only difference is `sort_order`.
- Earlier leak fixes narrowed the original policy for confidential, backup, and Draft snapshots. Batch 12 now removes that policy and all direct client table privileges rather than widening it.
- The fixed-shape reader performs masking in PostgreSQL and never serializes raw `changes`; whole-log cardinality for leadership is separated from current task-content authorization.
- A deleted task’s foreign key becomes null through `ON DELETE SET NULL`. Its old task data remains only inside immutable `changes`, so a reader cannot use a live task row to establish current content access.
- `/activity-log` is implemented for active Admins and Co-Admins with server-prefetched default results, safe filters/search, 20-row cursor block pagination, a mobile-navigation-aware sticky pager, solid semantic icon-and-text action badges and row accents, and accessible expandable real-row summaries with guarded task links. Compact rows align their shared header grid and show the first safe change summary with a remaining-count indicator. Task detail retains its separate task-scoped newest-first Load-more History section for eligible callers.
- The activity prototype contains many records and controls the database does not support. It is a visual reference for responsive table/cards, filters, and empty/loading states—not a source of new audit data.

## Scope: in / out

**In:** fixed-shape `list_activity_log()`; raw authenticated `SELECT` removal; active Admin/Co-Admin whole-log page; current-primary/current-assist task-page history for Members; current-access masking; fail-closed deleted confidential rows; Draft snapshot protection; safe actor/task/event/committee labels; newest/oldest sort; action/committee/Philippine-date filters; safe text search; 20-row global cursor block pagination; task-History Load more; semantic action badges; accessible plain-text change-summary expansion and guarded task links; refresh, loading, empty, and safe error states; desktop table and phone cards following the Design System.

**Original Batch 12 out-of-scope list:** auth failures; user-profile or role changes; invitations; event creation/launch/deletion audit; confidential-view audit; IP addresses; device details; fabricated “system” actors; statistics cards; CSV export; retention windows or automatic deletion; restore controls; “Live” or Realtime behavior; notification creation; rewriting historical snapshots; expanding `activity_log.action` beyond `INSERT | UPDATE | DELETE`. Batch 12b is the separately approved retention follow-up described below; the other exclusions remain unchanged.

## Database impact

Use the two tracked security-critical Batch 12 migrations: the reader/raw-read removal and the portable final all-privilege revoke. Do not edit either historical leak-fix migration.

Create one authenticated-only, fixed-empty-path, fixed-shape `STABLE SECURITY DEFINER` reader named `list_activity_log(...)`. It derives the caller from `auth.uid()`, requires an active profile, validates every sort/filter/search/limit/cursor input, caps each request at 21 rows, and returns only presentation-safe columns. It must never return the raw `changes` document or an arbitrary caller-selected JSON path.

The reader supports two server-derived scopes:

- **Admin/Co-Admin page scope:** every immutable log row is eligible, independent of committee. For a live task, real details are returned only when `task_content_access_for_user(task_id, caller_id) = 'real'`. `masked` and `hidden` decisions both produce the same minimal row: timestamp, action, and the literal `Confidential Task`, with task/event/committee/actor details and change summaries null. This keeps whole-log cardinality without leaking why access is absent.
- **Member task scope:** `p_task_id` is mandatory, the stored task must exist, the caller must currently appear in its primary or assist array, and current content access must be `real`. The reader then returns only that task’s rows. Any unassigned, formerly assigned, viewer-only, masked, hidden, unknown, or deleted task request fails with one non-distinguishing unavailable result/error and no row count.

For live real-access entries, build a deterministic safe projection from whitelisted snapshot fields and safe profile/event/committee joins. The projection may describe changes to approved task fields, but it must not expose raw arrays, hidden ids, arbitrary JSON, emails, roles, or fields unrelated to the visible summary. Actor display uses only safe profile fields; a null/missing actor is rendered as a neutral unavailable/former actor label without weakening `users` RLS.

For deleted rows, recover only the minimum required classification from the stored delete snapshot. A deleted confidential task is always masked, including for Admin, because no current row exists to prove current real access. A deleted non-confidential row may expose only the whitelisted historical task/event/committee presentation fields that the reader validates from the snapshot; it may not return the full snapshot. Malformed or incomplete legacy JSON fails closed to the minimal masked shape.

Draft rows obey the same current access decision rather than trusting the log snapshot. A Co-Admin therefore cannot use the whole-log page to recover another committee’s Draft content. When Batch 13c later expands current Draft visibility for active Admins/Co-Admins, this reader must inherit only the approved current helper decision; it must not add a parallel Draft exception.

Use a stable `(created_at, id)` keyset cursor in the selected direction. Every query fetches at most 21 matching rows, returns 20, and exposes only a next cursor/`has_more` derived from the extra row. Changing sort, filter, search, scope, or task id resets the loaded pages. Date boundaries are interpreted as Asia/Manila calendar days and converted server-side or through one tested shared timezone contract.

After the function exists, drop the permissive `activity_log_select` policy and revoke direct `SELECT` on `public.activity_log` from `authenticated` (and ensure `PUBLIC`/`anon` have none). Keep table writes unavailable to clients. The trigger function alone retains the ability to insert; nobody receives update, delete, truncate, references, or trigger authority through this batch.

## Page and task-history behavior

- `/activity-log` guards itself with `requireUser()` and `getActiveProfileForRoles(['Admin', 'Co-Admin'])`; Members, inactive users, and profile-less callers are redirected or denied even if the layout also guards navigation.
- Desktop uses a responsive activity table; phones use readable cards. Both use the same server response, ordering, filters, masking, and loaded set.
- Activity Log must use the shared Batch 5 motion kit for stable-ID row reveal, user-selected filter panels, loading/content handoff, and reduced motion; it must add both an automated contract row and a manual browser row without exposing masked data during any transition.
- Search covers only safe normalized actor name, action label, real task title, real event name, and real committee name. Masked fields never enter the searchable document, so search cannot act as a confidential-content oracle.
- Action filters are the three stored values only. Committee filtering applies to real entries using the stored/live committee id; masked entries are included only when the chosen filter can be applied without revealing their hidden committee. Otherwise they remain absent from that filtered result without exposing a count distinction beyond the result itself.
- Date inputs use Philippine calendar dates. Newest is the default; Oldest is the only alternate sort.
- When the visible global page has more results, including the server-provided first page on initial load, the client sequentially prefetches at most two following 20-row pages while the tab is visible. Exact RPC cursor strings make only successfully discovered pages clickable; filter changes cancel the chain, and prefetch failures remain quiet.
- The global pager stays at the bottom of the viewport without overlapping the phone bottom navigation. Its stable-height solid surface keeps the 20-per-page label and known page controls available without scrolling the document or moving it on page changes.
- Manual Refresh and focus refresh refetch only the current global page. There is no Realtime, “Live” badge, or background audit-stream claim.
- `/tasks/[taskId]` adds a read-only History section. Leadership and current assigned Members use the same reader with the exact task scope. The section does not replace comments and has no mutation control.
- A successful assignment change, access change, or focus refresh invalidates/refetches history. If a Member is unassigned, cached rows are cleared before showing the safe unavailable state.

## Guards that must remain true

- Raw `activity_log.changes` never reaches an authenticated client. The RPC is the only client read path.
- Admins and Co-Admins receive the complete sequence of log entries, but not necessarily complete task content. `real`, `masked`, and `hidden` access remain distinct internally while `masked`/`hidden` share one non-leaking output.
- Members have no global log page or broad reader mode. They must be currently primary/assist assigned to the exact requested task and have real content access.
- `allowed_viewers`, archived shares, backup requests, volunteer offers, creator provenance, or earlier assignment do not grant Member history.
- Draft content is never authorized from a historical snapshot. Use the current centralized content-access decision.
- Deleted confidential rows are always minimal. Broken/malformed snapshots fail closed.
- Filters and search run before paging and cannot inspect masked values. Global three-page block navigation and task-History Load more preserve exact cursor strings and never duplicate or skip rows within a settled keyset ordering; the global pager never guesses an undiscovered page.
- Activity rows remain trigger-written and immutable to application roles. Batch 12b adds only the guarded postgres retention deletion path; there is still no update, restore, client delete, or client truncate path.
- Rank-only changes remain absent from the log. No activity reader or UI reconstructs them.
- Every database result and client request error is checked; UI mutations elsewhere cannot leave history loading indefinitely.

## Security risks

- Returning raw `changes` and masking in React is a direct confidential-data leak. Masking must happen inside the database reader before serialization.
- Granting Co-Admins table `SELECT` to obtain the whole log defeats both leak fixes. Whole-log cardinality and content authorization must be separated in the definer reader.
- Joining through caller-visible `tasks` can drop rows and reveal scope-dependent counts. The reader may inspect protected rows as definer only after authenticating the caller, then independently shapes each result.
- A search predicate evaluated against hidden titles, actors, events, or committees becomes a yes/no oracle. Search only the fields present in that caller’s final safe row.
- Delete snapshots are attacker-influenced historical JSON from legitimate task writes and may predate newer columns. Parse types defensively and fail closed.
- Offset paging can duplicate or skip entries when new audit rows arrive. Use an id-tiebroken keyset cursor and reset on query changes.
- A stale Member cache can preserve history after unassignment. Clear data on unavailable responses and refetch after assignment/access mutations and focus.
- Philippine date filters can shift entries if browser-local midnight is used. Use the shared Asia/Manila definition only.

## Earlier test docs to re-run or update

- Update `docs/PHASE-4-STEP-1A-TESTS.md` activity-log coverage: raw authenticated reads must now be denied for every role, including Admin, and the safe reader replaces policy-based visibility.
- Update `docs/PHASE-4-STEP-10-TESTS.md` and `docs/phase-4/step-10-database-review.md` with the reader signature, raw-SELECT revocation, policy removal, grants, and current function/policy counts. Historical Phase 4 results remain historical.
- Rerun `docs/PHASE-4-STEP-2-TESTS.md` and `docs/PHASE-4-STEP-3-TESTS.md` for board/detail/access-helper and Draft/real/masked parity.
- Rerun `docs/PHASE-4-STEP-5B-TESTS.md` for rank-only activity silence and status activity.
- Rerun `docs/PHASE-4-STEP-7-TESTS.md`, `docs/PHASE-4-STEP-7A-TESTS.md`, and `docs/PHASE-4-STEP-8-TESTS.md` for current confidentiality, assignment/unassignment, backup non-authorization, and activity attribution.
- Rerun `docs/PHASE-4-STEP-7B-TESTS.md` to prove archive-only sharing does not give a Member task-history entitlement and deleted confidential snapshots remain masked.
- Rerun `docs/PHASE-4-STEP-9-TESTS.md` to prove task comments remain separate, do not create task activity rows, and current access changes still revoke child readers consistently.
- Add Batch 12 objects and removed raw grants/policies to the authoritative Phase 4B catalog test scheduled after Batch 13b and Batch 14’s expanded Step 10 allowlists.

## Test deliverable

Create `docs/phase-4b/step-12-tests.md` when the batch lands. Include one self-contained rollback-safe Dev SQL paste ending in the intentional `TEST RESULTS` exception, plus pure response/paging/filter tests and a three-role manual checklist.

Test exact function shape, owner, `STABLE SECURITY DEFINER`, empty `search_path`, authenticated-only execute grant, no overloads, raw table `SELECT` denial, no permissive SELECT policy, trigger-only inserts, and immutable update/delete behavior. Assert the reader returns no raw `changes` field.

Cover active Admin, active Co-Admin, Member, inactive, and profile-less callers across public/confidential tasks, own/other committees, Draft/Active/Archived parents, real/masked/hidden decisions, current primary/assist assignment, allowed-viewer-only access, archive-only access, backup/volunteer state, unassignment, unknown ids, deleted public tasks, deleted confidential tasks, missing actors, and malformed historical JSON.

For each allowed real entry, verify only whitelisted fields and summaries. For every masked case, verify exact nullability and the literal `Confidential Task` plus timestamp/action only. Prove search cannot match hidden task/event/committee/actor values, filters cannot leak masked values, Philippine day edges are correct, newest/oldest ordering is stable by `(created_at, id)`, and 20/21/large pages append without duplicates or gaps.

## Manual checklist

- As an Admin, open `/activity-log`; verify INSERT/UPDATE/DELETE rows across committees, solid semantic icon-and-text badges and row accents, expandable real-row summaries and guarded Open task links, newest/oldest sort, every approved filter, search, Refresh, and 20-row three-page block pagination.
- As a Co-Admin, confirm the page shows the whole sequence. Verify real public/currently authorized entries and minimal `Confidential Task` rows for unavailable confidential or Draft content.
- Search for a known hidden title, event, committee, or actor. Confirm it does not make the masked row discoverable through text matching.
- Create, edit, move, and delete disposable tasks. Confirm meaningful changes appear, rank-only reorder does not, and deleted confidential content is masked.
- On a task page as a currently assigned Member, confirm History appears. Remove the Member from both assignment arrays and confirm cached history disappears and direct reader calls fail.
- As an allowed-viewer-only Member, archive-only viewer, volunteer, former assignee, unassigned Member, inactive user, and profile-less user, confirm task history is unavailable.
- Verify date boundaries using records around Philippine midnight and confirm browser timezone changes do not shift the selected day.
- Confirm there are no statistics, export, restore, auth/user/event audit, IP/device, Realtime, or “Live” features. Confirm both surfaces show the quiet 30-day retention notice.

## Three-role browser checklist

### Admin

1. Sign in as an active Admin and open `/activity-log`; confirm the default newest-first 20-row page appears, then test oldest-first, each action, committee, date boundary, trimmed search, Clear filters, and Refresh.
2. Confirm entries from all committees appear. Open a real row's task link, and verify unavailable confidential/Draft content stays a minimal `Confidential Task` row with time and action only.
3. Search for a known hidden title, event, committee, and actor; confirm none discovers a masked row. Change several filters quickly and confirm an older response never replaces the current filter result.
4. Confirm Created/Updated/Deleted use equal-weight tonal success/brand/destructive icon-and-text badges and matching green/brand/destructive row accents. Verify the shared header grid aligns with compact rows, task metadata uses a quiet committee chip, masked changes say `Hidden`, and real rows preview the first summary plus any remaining count.
5. Confirm masked tasks remain neutral and cannot expand. Expand real rows by mouse and keyboard, verify plain-text change lists, and verify Open task appears only for valid live task ids and not for DELETE rows. Then open a task and confirm its unchanged History remains newest-first with only Refresh and Load more.
6. With at least 61 matching rows, confirm known page buttons 1-3 appear from the initial server page without first navigating, the right block arrow opens page 4 only after its exact cursor is known, and the next block fills as 4-6. Confirm the sticky pager stays above phone navigation, does not shift while prefetch completes, keeps the old page visible without scrolling while navigating, and resets to page 1 after a filter change.

### Co-Admin

1. Sign in as an active Co-Admin; confirm Activity Log appears in navigation and direct `/activity-log` access succeeds.
2. Confirm the whole-log sequence has the same cardinality as Admin while details are real only where currently authorized; other confidential/Draft rows must be minimal masked entries.
3. Apply committee and search filters and confirm masked rows cannot reveal hidden committee, task, event, or actor data. Verify Philippine date choices do not change after switching the browser timezone.
4. Verify the global pager keeps the current page visible while moving, handles short/empty `has_more` pages, resets on filters, exposes only known pages in three-page blocks, and never skips a page while the next block cursor is still loading. Open an accessible task and verify its unchanged History still uses Refresh and Load more with the same sentinel, cursor, dedupe, and quiet-error rules.

### Member

1. Sign in as an active Member; confirm Activity Log is absent from navigation and direct `/activity-log` access follows the existing denial redirect.
2. Open a task where the Member is currently primary or assist assigned; confirm History appears, is newest-first, and offers only Refresh and Load more.
3. Remove the Member from both assignment arrays in another authorized session, then refocus or refresh the Member tab; confirm cached History clears to the quiet unavailable state without breaking the rest of the task page.
4. Repeat with an allowed-viewer-only, archive-only viewer, volunteer, former-assignee, or unassigned account and confirm History stays unavailable. Confirm masked rows, when present for eligible leadership, show only `Confidential Task`, time, and action.

## Acceptance

`/activity-log` gives active Admins and Co-Admins a stable, searchable, filterable, sorted, 20-row block-paged view of every retained task audit row without exposing raw snapshots. Current real access controls details; every unavailable entry is a minimal `Confidential Task` row, and deleted confidential history fails closed. Members have no global page and can read only the selected task’s retained history while currently primary/assist assigned. Draft content, raw `changes`, rank-only noise, and unsupported prototype features remain absent.

## Batch 12b: 30-day retention

Batch 12b adds migration `20261029140000_activity_log_retention.sql` without editing either live Batch 12 migration. `activity_log_retention_days()` is the single SQL definition of the fixed 30-day window. `purge_activity_log()` is a fixed-empty-path, postgres-owned `VOLATILE SECURITY DEFINER` function that deletes at most 5,000 eligible rows per call in `(created_at, id)` order. It sets the exact transaction-local `ceit_connect.activity_log_purger = 'purge_activity_log'` marker only around its bounded `DELETE`; the statement trigger `activity_log_guard_deletes` rejects raw deletion, a missing/wrong marker, and every `TRUNCATE`. The purge clears its marker before returning, so a later raw delete in the same transaction fails again. `PUBLIC`, `anon`, and `authenticated` receive neither function execution nor table deletion authority, and the portable final `REVOKE ALL` also covers PostgreSQL 17 `MAINTAIN`.

Retention is uniform for `INSERT`, `UPDATE`, and `DELETE` rows, including confidential-task snapshots. The cutoff is strictly `created_at < now() - 30 days`, so the exact boundary remains until a later run. Purging never writes a new activity row because it does not mutate `tasks`. It is irreversible: old task History disappears, and after 30 days the record of who deleted a task disappears with its DELETE row. `TRUNCATE public.tasks CASCADE` now reaches the Activity Log through the task foreign key and fails on the Activity Log truncate guard. Changing N requires a new migration replacing `activity_log_retention_days()` and the shared `ACTIVITY_LOG_RETENTION_DAYS` TypeScript constant together.

The Activity Log page and task History both show the quiet shared line `Activity is kept for 30 days.` No other UI behavior changes. A pure helper test pins the shared TypeScript constant and text without jsdom.

### Scheduler boundary and environment order

`pg_cron` remains **UNVERIFIED separately on Dev and Prod** until the owner runs the read-only check below in each SQL Editor. The migration creates only the retention functions and guard; it neither enables the extension nor creates an environment-specific job. The selected job name is `ceit-connect-activity-log-retention`, its command is `select public.purge_activity_log();`, and its schedule is `0 19 * * *`: 19:00 UTC, or 3:00 AM Philippine time the following day. A job created as `postgres` runs as `postgres`. This database-local scheduler decision is reusable for the Phase 5 email queue, but that queue must receive its own function, guard, job name, schedule, and tests.

Run this read-only check separately in Dev and Prod. It returns exactly one row with one JSONB value and does not reference `cron` relations directly when the extension is absent:

```sql
select pg_catalog.jsonb_build_object(
  'identity', pg_catalog.jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'database', current_database(),
    'timezone', current_setting('TimeZone')
  ),
  'available_extension', coalesce((
    select pg_catalog.to_jsonb(available_row)
    from (
      select name, default_version, installed_version, comment
      from pg_catalog.pg_available_extensions
      where name = 'pg_cron'
    ) as available_row
  ), 'null'::jsonb),
  'installed_extension', coalesce((
    select pg_catalog.jsonb_build_object(
      'name', extension_row.extname,
      'version', extension_row.extversion,
      'schema', namespace_row.nspname,
      'owner', pg_catalog.pg_get_userbyid(extension_row.extowner)
    )
    from pg_catalog.pg_extension as extension_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = extension_row.extnamespace
    where extension_row.extname = 'pg_cron'
  ), 'null'::jsonb),
  'cron_schema', coalesce((
    select pg_catalog.jsonb_build_object(
      'name', namespace_row.nspname,
      'owner', pg_catalog.pg_get_userbyid(namespace_row.nspowner),
      'acl', pg_catalog.to_jsonb(namespace_row.nspacl),
      'current_user_has_usage', pg_catalog.has_schema_privilege(
        current_user, namespace_row.oid, 'USAGE'
      ),
      'current_user_has_create', pg_catalog.has_schema_privilege(
        current_user, namespace_row.oid, 'CREATE'
      )
    )
    from pg_catalog.pg_namespace as namespace_row
    where namespace_row.nspname = 'cron'
  ), 'null'::jsonb),
  'cron_functions', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'function', procedure_row.oid::regprocedure::text,
        'owner', pg_catalog.pg_get_userbyid(procedure_row.proowner),
        'acl', pg_catalog.to_jsonb(procedure_row.proacl),
        'current_user_can_execute', pg_catalog.has_function_privilege(
          current_user, procedure_row.oid, 'EXECUTE'
        )
      )
      order by procedure_row.oid::regprocedure::text
    )
    from pg_catalog.pg_proc as procedure_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'cron'
      and procedure_row.proname in (
        'schedule', 'schedule_in_database', 'alter_job', 'unschedule'
      )
  ), '[]'::jsonb),
  'cron_relations', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'relation', class_row.oid::regclass::text,
        'kind', class_row.relkind,
        'acl', pg_catalog.to_jsonb(class_row.relacl),
        'current_user_can_select', pg_catalog.has_table_privilege(
          current_user, class_row.oid, 'SELECT'
        ),
        'current_user_can_insert', pg_catalog.has_table_privilege(
          current_user, class_row.oid, 'INSERT'
        ),
        'current_user_can_update', pg_catalog.has_table_privilege(
          current_user, class_row.oid, 'UPDATE'
        ),
        'current_user_can_delete', pg_catalog.has_table_privilege(
          current_user, class_row.oid, 'DELETE'
        )
      )
      order by class_row.oid::regclass::text
    )
    from pg_catalog.pg_class as class_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = class_row.relnamespace
    where namespace_row.nspname = 'cron'
      and class_row.relname in ('job', 'job_run_details')
  ), '[]'::jsonb),
  'scheduler_processes', coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'pid', activity.pid,
        'user', activity.usename,
        'application_name', activity.application_name,
        'backend_start', activity.backend_start,
        'state', activity.state
      )
      order by activity.pid
    )
    from pg_catalog.pg_stat_activity as activity
    where activity.application_name ilike 'pg_cron scheduler'
  ), '[]'::jsonb)
) as pg_cron_check;
```

If `pg_cron` is available but disabled, use **Dashboard → Integrations → Cron → Enable `pg_cron`**, then rerun the read-only check. Do not grant `cron` access to app roles. If it cannot be used, the only fallback is one owner-run daily SQL Editor call to `select public.purge_activity_log();` as `postgres`; do not add an app route or service-role execution grant.

The SQL Editor may underline `cron` as unknown because its autocomplete metadata is stale; that warning alone is not an execution failure. An actual `schema "cron" does not exist` or missing-relation error means pg_cron is not enabled, so run only the catalog-based single-row check above until it is enabled. Do not run the `cron.job` verification until the extension is enabled and the job is scheduled, or the `cron.job_run_details` check until after scheduling.

The per-environment order is:

1. **Dev first:** apply the migration; run the 19-line rollback-safe paste below; run the single-row scheduler check; enable Cron if needed; create the job as `postgres`; verify its stored role/schedule; then inspect its latest run rows.
2. **Prod second:** before any Prod purge, run the read-only past-retention count and record it; proceed only after the Dev test passed; apply the migration; run the scheduler check; enable Cron if needed; create the job as `postgres`; verify it; then inspect its latest run rows. The first Prod purge—manual or scheduled—must happen only after both prerequisites are satisfied.

Read-only Prod count before its first purge:

```sql
select count(*)::bigint as rows_older_than_30_days
from public.activity_log
where created_at < now() - interval '30 days';
```

Create the daily job as `postgres` only after the environment gates pass:

```sql
select cron.schedule(
  'ceit-connect-activity-log-retention',
  '0 19 * * *',
  $$select public.purge_activity_log();$$
);
```

Verify the job definition read-only:

```sql
select jobid, jobname, schedule, command, username, active
from cron.job
where jobname = 'ceit-connect-activity-log-retention';
```

After it has run, inspect the latest failures and durations read-only:

```sql
select
  details.runid,
  details.jobid,
  details.status,
  details.return_message,
  details.start_time,
  details.end_time,
  details.end_time - details.start_time as duration
from cron.job_run_details as details
where details.jobid = (
  select job.jobid
  from cron.job as job
  where job.jobname = 'ceit-connect-activity-log-retention'
)
order by details.start_time desc nulls last
limit 20;
```

Stop and remove the job when necessary:

```sql
select cron.unschedule('ceit-connect-activity-log-retention');
```

For a first-run backlog, run `select public.purge_activity_log() as deleted_rows;` as a separate postgres SQL Editor execution. Repeat until the result is **less than 5,000**, then run it once more; a final `0` confirms the backlog is drained. Never replace the bounded calls with raw deletion, truncation, or one unbounded loop.

The SQL Editor cannot exercise the purge function's `session_user <> 'postgres'` defense because the Editor session itself is `postgres`. Tests 6 and 7 below instead prove that `anon` and `authenticated` cannot reach the function at all because `EXECUTE` is revoked.

The historical Batch 12 paste in `step-12-tests.md` contains a raw postgres Activity Log cleanup delete. That statement is expected to fail after Batch 12b because the new guard deliberately rejects it; do not treat that historical cleanup as a current retention test or loosen the guard to preserve it. Local code validation for Batch 12b passes `npx tsc --noEmit`, all 670 Vitest cases across 67 files, and lint; no build was requested.

### Batch 12b Dev SQL test — Run without RLS

Run this as **one self-contained paste on Dev only**, after applying `20261029140000_activity_log_retention.sql`. It creates unique Auth/profile/event/task fixtures, inserts at least 5,003 crafted old rows as postgres, computes the pre-existing past-retention baseline, impersonates both client roles, and intentionally ends with `TEST RESULTS: 19/19 PASS` so the transaction rolls back. PASS/FAIL lines name the same numbered subcase. Do not run it on Prod.

```sql
begin;
set local statement_timeout = '180s';

do $setup$
declare
  v_token text := gen_random_uuid()::text;
  v_admin_id uuid := gen_random_uuid();
  v_committee_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_empty_task_id uuid := gen_random_uuid();
  v_live_task_id uuid := gen_random_uuid();
  v_boundary_id uuid := gen_random_uuid();
  v_newer_id uuid := gen_random_uuid();
  v_baseline_old bigint;
  v_inserted_old bigint;
  v_snapshot jsonb;
begin
  if current_user <> 'postgres' then
    raise exception 'FAIL [SETUP] Run without RLS as postgres; current_user is %.', current_user;
  end if;

  select count(*)
  into v_baseline_old
  from public.activity_log
  where created_at
    < now() - pg_catalog.make_interval(
        days => public.activity_log_retention_days()
      );

  perform pg_catalog.set_config('ceit_connect.test_token', v_token, true);
  perform pg_catalog.set_config('ceit_connect.test_admin_id', v_admin_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_committee_id', v_committee_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_event_id', v_event_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_empty_task_id', v_empty_task_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_live_task_id', v_live_task_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_boundary_id', v_boundary_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_newer_id', v_newer_id::text, true);
  perform pg_catalog.set_config('ceit_connect.test_baseline_old', v_baseline_old::text, true);
  perform pg_catalog.set_config(
    'ceit_connect.test_absent_search',
    'absent-' || gen_random_uuid()::text,
    true
  );

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    v_admin_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated',
    'authenticated',
    'retention-' || v_token || '@example.test',
    crypt('Retention-test-1!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    pg_catalog.jsonb_build_object('test_token', v_token),
    now(),
    now()
  );

  insert into public.committees (id, name)
  values (v_committee_id, 'Retention ' || v_token);

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer',
    'invite_new_officer',
    true
  );
  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  ) values (
    v_admin_id,
    'retention-' || v_token || '@example.test',
    'Retention Admin ' || v_token,
    'Admin',
    null,
    true
  );
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.events (
    id, name, start_date, status, created_by
  ) values (
    v_event_id,
    'Retention Event ' || v_token,
    current_date,
    'Draft',
    v_admin_id
  );

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer',
    'create_event_with_tasks',
    true
  );
  insert into public.tasks (
    id,
    event_id,
    committee_id,
    title,
    phase,
    primary_assignees,
    assist_assignees,
    created_by
  ) values
    (
      v_empty_task_id,
      v_event_id,
      v_committee_id,
      'Entirely purged ' || v_token,
      'Retention',
      '{}'::uuid[],
      '{}'::uuid[],
      v_admin_id
    ),
    (
      v_live_task_id,
      v_event_id,
      v_committee_id,
      'Live retained ' || v_token,
      'Retention',
      '{}'::uuid[],
      '{}'::uuid[],
      v_admin_id
    );
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);

  update public.activity_log
  set created_at = now() - interval '31 days'
  where task_id in (v_empty_task_id, v_live_task_id)
    and action = 'INSERT';

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  select
    gen_random_uuid(),
    v_live_task_id,
    v_admin_id,
    case series_row.value % 3
      when 0 then 'INSERT'
      when 1 then 'UPDATE'
      else 'DELETE'
    end,
    case series_row.value % 3
      when 1 then pg_catalog.jsonb_build_object(
        'old', pg_catalog.jsonb_build_object(
          'id', v_live_task_id::text,
          'event_id', v_event_id::text,
          'committee_id', v_committee_id::text,
          'title', 'bulk-old-' || v_token || '-' || series_row.value,
          'is_confidential', series_row.value % 2 = 0
        ),
        'new', pg_catalog.jsonb_build_object(
          'id', v_live_task_id::text,
          'event_id', v_event_id::text,
          'committee_id', v_committee_id::text,
          'title', 'bulk-new-' || v_token || '-' || series_row.value,
          'is_confidential', series_row.value % 2 = 0
        )
      )
      else pg_catalog.jsonb_build_object(
        'id', v_live_task_id::text,
        'event_id', v_event_id::text,
        'committee_id', v_committee_id::text,
        'title', 'bulk-' || v_token || '-' || series_row.value,
        'is_confidential', series_row.value % 2 = 0
      )
    end,
    now() - interval '31 days' - series_row.value * interval '1 microsecond'
  from pg_catalog.generate_series(1, 5003) as series_row(value);

  v_snapshot := pg_catalog.jsonb_build_object(
    'id', v_live_task_id::text,
    'event_id', v_event_id::text,
    'committee_id', v_committee_id::text,
    'title', 'Boundary ' || v_token,
    'is_confidential', false
  );

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  ) values
    (
      v_boundary_id,
      null,
      v_admin_id,
      'DELETE',
      v_snapshot,
      now() - pg_catalog.make_interval(
        days => public.activity_log_retention_days()
      )
    ),
    (
      v_newer_id,
      null,
      v_admin_id,
      'DELETE',
      v_snapshot || pg_catalog.jsonb_build_object(
        'title', 'Newer ' || v_token
      ),
      now() - interval '29 days'
    );

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  select
    gen_random_uuid(),
    v_live_task_id,
    v_admin_id,
    'UPDATE',
    pg_catalog.jsonb_build_object(
      'old', pg_catalog.jsonb_build_object(
        'id', v_live_task_id::text,
        'event_id', v_event_id::text,
        'committee_id', v_committee_id::text,
        'title', 'page-' || v_token || '-' || series_row.value,
        'is_confidential', false
      ),
      'new', pg_catalog.jsonb_build_object(
        'id', v_live_task_id::text,
        'event_id', v_event_id::text,
        'committee_id', v_committee_id::text,
        'title', 'page-' || v_token || '-' || series_row.value,
        'is_confidential', false
      )
    ),
    now() - interval '1 day' + series_row.value * interval '1 microsecond'
  from pg_catalog.generate_series(1, 25) as series_row(value);

  insert into public.activity_log (
    id, task_id, user_id, action, changes, created_at
  )
  select
    gen_random_uuid(),
    null,
    v_admin_id,
    'DELETE',
    pg_catalog.jsonb_build_object(
      'id', gen_random_uuid()::text,
      'event_id', v_event_id::text,
      'committee_id', v_committee_id::text,
      'title', 'scan-candidate-' || series_row.value,
      'is_confidential', false
    ),
    now() + interval '1 day' + series_row.value * interval '1 microsecond'
  from pg_catalog.generate_series(1, 2001) as series_row(value);

  select count(*) - v_baseline_old
  into v_inserted_old
  from public.activity_log
  where created_at
    < now() - pg_catalog.make_interval(
        days => public.activity_log_retention_days()
      );

  if v_inserted_old < 5003 then
    raise exception 'FAIL [SETUP] Expected at least 5003 crafted old rows, found %.',
      v_inserted_old;
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.test_inserted_old',
    v_inserted_old::text,
    true
  );
end;
$setup$;

do $catalog$
declare
  v_ok boolean;
  v_rejected boolean;
  v_boundary_id uuid := current_setting('ceit_connect.test_boundary_id')::uuid;
begin
  select
    public.activity_log_retention_days() = 30
    and procedure_row.proowner = 'postgres'::regrole
    and procedure_row.provolatile = 'i'
    and procedure_row.prosecdef is false
    and procedure_row.proconfig @> array['search_path=""']::text[]
  into v_ok
  from pg_catalog.pg_proc as procedure_row
  where procedure_row.oid = 'public.activity_log_retention_days()'::regprocedure;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL [01 retention contract] Expected postgres-owned immutable invoker function returning 30 with empty search_path.';
  end if;
  raise notice 'PASS [01 retention contract] fixed retention function returns 30 and has the required catalog shape';

  select
    purge_row.proowner = 'postgres'::regrole
    and purge_row.provolatile = 'v'
    and purge_row.prosecdef
    and purge_row.proconfig @> array['search_path=""']::text[]
    and guard_row.proowner = 'postgres'::regrole
    and guard_row.prosecdef is false
    and guard_row.proconfig @> array['search_path=""']::text[]
    and trigger_row.tgenabled = 'O'
    and (trigger_row.tgtype & 1) = 0
    and (trigger_row.tgtype & 2) = 2
    and (trigger_row.tgtype & 8) = 8
    and (trigger_row.tgtype & 32) = 32
    and index_row.indisvalid
    and index_row.indisready
    and pg_catalog.pg_get_indexdef(index_row.indexrelid)
      like '%(created_at, id)%'
  into v_ok
  from pg_catalog.pg_proc as purge_row
  cross join pg_catalog.pg_proc as guard_row
  cross join pg_catalog.pg_trigger as trigger_row
  cross join pg_catalog.pg_index as index_row
  where purge_row.oid = 'public.purge_activity_log()'::regprocedure
    and guard_row.oid = 'public.guard_activity_log_deletes()'::regprocedure
    and trigger_row.tgrelid = 'public.activity_log'::regclass
    and trigger_row.tgname = 'activity_log_guard_deletes'
    and not trigger_row.tgisinternal
    and trigger_row.tgfoid = guard_row.oid
    and index_row.indexrelid = 'public.activity_log_created_at_id_idx'::regclass;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL [02 purge guard and index] Catalog shape, trigger events, or (created_at, id) index changed.';
  end if;
  raise notice 'PASS [02 purge guard and index] purge, statement guard, trigger events, and ordered index match the contract';

  select not exists (
    select 1
    from pg_catalog.pg_class as class_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        class_row.relacl,
        pg_catalog.acldefault('r', class_row.relowner)
      )
    ) as privilege_row
    where class_row.oid = 'public.activity_log'::regclass
      and privilege_row.grantee in (
        0::oid,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid
      )
  ) and not exists (
    select 1
    from pg_catalog.pg_proc as procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) as privilege_row
    where procedure_row.oid in (
      'public.activity_log_retention_days()'::regprocedure,
      'public.guard_activity_log_deletes()'::regprocedure,
      'public.purge_activity_log()'::regprocedure
    )
      and privilege_row.grantee in (
        0::oid,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid
      )
  ) and not pg_catalog.has_function_privilege(
    'anon', 'public.purge_activity_log()', 'EXECUTE'
  ) and not pg_catalog.has_function_privilege(
    'authenticated', 'public.purge_activity_log()', 'EXECUTE'
  )
  into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'FAIL [03 privilege closure] PUBLIC/anon/authenticated retain a table privilege or retention-function EXECUTE.';
  end if;
  raise notice 'PASS [03 privilege closure] PUBLIC, anon, and authenticated have no direct table privilege or retention-function EXECUTE';

  v_rejected := false;
  begin
    delete from public.activity_log where id = v_boundary_id;
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [04 raw postgres delete] DELETE without the maintenance guard unexpectedly succeeded.';
  end if;
  raise notice 'PASS [04 raw postgres delete] postgres DELETE without the guard is rejected';

  perform pg_catalog.set_config(
    'ceit_connect.activity_log_purger',
    'x',
    true
  );
  v_rejected := false;
  begin
    delete from public.activity_log where id = v_boundary_id;
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  perform pg_catalog.set_config('ceit_connect.activity_log_purger', '', true);
  if not v_rejected then
    raise exception 'FAIL [05 wrong guard] DELETE with an incorrect guard value unexpectedly succeeded.';
  end if;
  raise notice 'PASS [05 wrong guard] postgres DELETE with an incorrect guard value is rejected';
end;
$catalog$;

set local role anon;
do $anon_execute$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.purge_activity_log();
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [06 anon EXECUTE revoke] anon reached purge_activity_log().';
  end if;
  raise notice 'PASS [06 anon EXECUTE revoke] anon cannot execute purge_activity_log()';
end;
$anon_execute$;
reset role;

set local role authenticated;
do $authenticated_execute$
declare
  v_rejected boolean := false;
begin
  begin
    perform public.purge_activity_log();
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [07 authenticated EXECUTE revoke] authenticated reached purge_activity_log().';
  end if;
  raise notice 'PASS [07 authenticated EXECUTE revoke] authenticated cannot execute purge_activity_log()';
end;
$authenticated_execute$;
reset role;

do $client_delete_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('ceit_connect.test_admin_id'),
      'role', 'authenticated'
    )::text,
    true
  );
end;
$client_delete_claims$;

set local role anon;
do $anon_delete$
declare
  v_rejected boolean := false;
begin
  begin
    delete from public.activity_log
    where id = current_setting('ceit_connect.test_boundary_id')::uuid;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [08 client DELETE revoke] anon DELETE unexpectedly succeeded.';
  end if;
end;
$anon_delete$;
reset role;

set local role authenticated;
do $authenticated_delete$
declare
  v_rejected boolean := false;
begin
  begin
    delete from public.activity_log
    where id = current_setting('ceit_connect.test_boundary_id')::uuid;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [08 client DELETE revoke] authenticated DELETE unexpectedly succeeded.';
  end if;
  raise notice 'PASS [08 client DELETE revoke] anon and authenticated cannot delete activity rows directly';
end;
$authenticated_delete$;
reset role;

do $truncate$
declare
  v_rejected boolean := false;
begin
  begin
    execute 'truncate table public.activity_log';
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [09 postgres TRUNCATE] Activity Log truncation unexpectedly succeeded.';
  end if;
  raise notice 'PASS [09 postgres TRUNCATE] Activity Log truncation is rejected';
end;
$truncate$;

do $purge$
declare
  v_token text := current_setting('ceit_connect.test_token');
  v_baseline_old bigint := current_setting('ceit_connect.test_baseline_old')::bigint;
  v_inserted_old bigint := current_setting('ceit_connect.test_inserted_old')::bigint;
  v_expected_deleted bigint := v_baseline_old + v_inserted_old;
  v_before_count bigint;
  v_after_count bigint;
  v_first integer;
  v_batch integer;
  v_total_deleted bigint;
  v_zero integer;
  v_remaining bigint;
  v_rejected boolean := false;
begin
  select count(*) into v_before_count from public.activity_log;

  v_first := public.purge_activity_log();
  if v_first <> 5000 then
    raise exception 'FAIL [10 first batch cap] Expected exactly 5000 deletions, got %.', v_first;
  end if;
  raise notice 'PASS [10 first batch cap] first purge deletes exactly 5000 rows';

  v_total_deleted := v_first;
  loop
    v_batch := public.purge_activity_log();
    v_total_deleted := v_total_deleted + v_batch;
    exit when v_batch < 5000;
  end loop;

  if v_total_deleted <> v_expected_deleted then
    raise exception 'FAIL [11 relative drain] Expected baseline % + inserted % = % total deletions, got %.',
      v_baseline_old, v_inserted_old, v_expected_deleted, v_total_deleted;
  end if;
  raise notice 'PASS [11 relative drain] total deleted equals baseline plus inserted rows and the drain ends below 5000';

  v_zero := public.purge_activity_log();
  if v_zero <> 0 then
    raise exception 'FAIL [12 final idempotent run] Expected 0 after the sub-cap batch, got %.', v_zero;
  end if;
  raise notice 'PASS [12 final idempotent run] one more purge returns 0';

  select count(*)
  into v_remaining
  from public.activity_log
  where created_at
      < now() - pg_catalog.make_interval(
          days => public.activity_log_retention_days()
        )
    and changes::text like '%' || v_token || '%';

  if v_remaining <> 0 then
    raise exception 'FAIL [13 uniform retention] % token-owned old INSERT/UPDATE/DELETE or confidential/public rows remain.', v_remaining;
  end if;
  raise notice 'PASS [13 uniform retention] old INSERT, UPDATE, DELETE, public, and confidential rows are all purged';

  if not exists (
       select 1 from public.activity_log
       where id = current_setting('ceit_connect.test_boundary_id')::uuid
     ) or not exists (
       select 1 from public.activity_log
       where id = current_setting('ceit_connect.test_newer_id')::uuid
     ) then
    raise exception 'FAIL [14 boundary and newer rows] Exact-boundary or newer fixture was deleted.';
  end if;
  raise notice 'PASS [14 boundary and newer rows] exact 30-day boundary and newer rows are retained';

  select count(*) into v_after_count from public.activity_log;
  if v_before_count - v_after_count <> v_total_deleted then
    raise exception 'FAIL [15 purge silence] Row-count delta % differs from returned deletions %.',
      v_before_count - v_after_count, v_total_deleted;
  end if;
  raise notice 'PASS [15 purge silence] purge writes no replacement activity row';

  begin
    delete from public.activity_log
    where id = current_setting('ceit_connect.test_boundary_id')::uuid;
  exception when sqlstate 'CAL03' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL [16 guard reset after purge] Raw DELETE succeeded after purge_activity_log() in the same transaction.';
  end if;
  raise notice 'PASS [16 guard reset after purge] raw postgres DELETE fails again after purge_activity_log() in the same transaction';
end;
$purge$;

do $reader_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', current_setting('ceit_connect.test_admin_id'),
      'role', 'authenticated'
    )::text,
    true
  );
end;
$reader_claims$;

set local role authenticated;
do $reader$
declare
  v_token text := current_setting('ceit_connect.test_token');
  v_first_ids uuid[];
  v_second_ids uuid[];
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_first_count integer;
  v_second_count integer;
  v_first_has_more boolean;
  v_second_has_more boolean;
  v_empty_count integer;
  v_sentinel_count integer;
  v_sentinel_ok boolean;
begin
  select count(*)
  into v_empty_count
  from public.list_activity_log(
    p_task_id => current_setting('ceit_connect.test_empty_task_id')::uuid
  );

  if v_empty_count <> 0 then
    raise exception 'FAIL [17 entirely purged History] Expected an empty reader result, got % rows.', v_empty_count;
  end if;
  raise notice 'PASS [17 entirely purged History] a task whose whole history aged out returns an ordinary empty result';

  select
    pg_catalog.array_agg(page.activity_id order by page.activity_created_at desc, page.activity_id desc),
    count(*)::integer,
    pg_catalog.bool_and(page.has_more),
    (pg_catalog.array_agg(page.next_cursor_created_at))[1],
    (pg_catalog.array_agg(page.next_cursor_id))[1]
  into
    v_first_ids,
    v_first_count,
    v_first_has_more,
    v_cursor_created_at,
    v_cursor_id
  from public.list_activity_log(
    p_task_id => current_setting('ceit_connect.test_live_task_id')::uuid,
    p_sort => 'newest',
    p_search => 'page-' || v_token,
    p_page_size => 20
  ) as page;

  select
    pg_catalog.array_agg(page.activity_id order by page.activity_created_at desc, page.activity_id desc),
    count(*)::integer,
    coalesce(pg_catalog.bool_or(page.has_more), false)
  into v_second_ids, v_second_count, v_second_has_more
  from public.list_activity_log(
    p_task_id => current_setting('ceit_connect.test_live_task_id')::uuid,
    p_sort => 'newest',
    p_search => 'page-' || v_token,
    p_cursor_created_at => v_cursor_created_at,
    p_cursor_id => v_cursor_id,
    p_page_size => 20
  ) as page;

  if v_first_count <> 20
     or not coalesce(v_first_has_more, false)
     or v_cursor_created_at is null
     or v_cursor_id is null
     or v_second_count <> 5
     or v_second_has_more
     or exists (
       select 1
       from pg_catalog.unnest(v_first_ids) as first_id(id)
       join pg_catalog.unnest(v_second_ids) as second_id(id)
         using (id)
     )
     or exists (
       select 1
       from public.list_activity_log(
         p_task_id => current_setting('ceit_connect.test_live_task_id')::uuid,
         p_search => 'page-' || v_token
       ) as page
       where page.action <> 'UPDATE'
     ) then
    raise exception 'FAIL [18 retained live-task paging] Expected 20+5 duplicate-free UPDATE rows after the INSERT aged out.';
  end if;
  raise notice 'PASS [18 retained live-task paging] a live task works without its INSERT row and retained keyset pages are 20 plus 5 without duplicates';

  select
    count(*)::integer,
    pg_catalog.bool_and(
      page.activity_id is null
      and page.activity_created_at is null
      and page.action is null
      and page.has_more
      and page.next_cursor_created_at is not null
      and page.next_cursor_id is not null
    )
  into v_sentinel_count, v_sentinel_ok
  from public.list_activity_log(
    p_sort => 'newest',
    p_action => 'DELETE',
    p_search => current_setting('ceit_connect.test_absent_search'),
    p_page_size => 20
  ) as page;

  if v_sentinel_count <> 1 or not coalesce(v_sentinel_ok, false) then
    raise exception 'FAIL [19 scan-cap sentinel] Expected one null-activity sentinel with an exact continuation cursor.';
  end if;
  raise notice 'PASS [19 scan-cap sentinel] the 2000-candidate cap still returns one safe sentinel and continuation cursor';
end;
$reader$;
reset role;

do $results$
begin
  raise exception 'TEST RESULTS: 19/19 PASS — transaction intentionally rolled back';
end;
$results$;
```

## Open questions for the owner

- None. Any request to add prototype statistics, export, restore, non-task audit categories, or Realtime is new scope and requires a later owner decision.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-12-tests.md`.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` to replace the raw activity-log policy description with the fixed-shape reader, exact scopes, masking, paging, and grants.
- Update the named Phase 4 activity/catalog tests, then include Batch 12 in the authoritative Phase 4B catalog and final Batch 14 gate.
