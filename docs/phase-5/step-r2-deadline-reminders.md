# Phase 5 R2 — deadline reminders

## Outcome and qualification

R2 adds two scheduled, actorless notification types:

| Type | Target | Bell copy | Push copy |
| --- | --- | --- | --- |
| `task_due_soon` | Every distinct active primary or assist assignee of any non-Completed task in an Active event, once its stored `due_date` is inside `(run time, run time + 24 hours]` | `{task title} is due soon.` | `A task is due soon.` |
| `live_operation_prep` | The same recipient set, only for `LiveOperation` tasks with non-null `call_time` inside `(run time, run time + 2 hours]` | `Prepare for {task title}. Call time is soon.` | `A Live Operation call time is soon.` |

Only active profiles qualify. Primary and assist arrays are combined and
deduplicated. Backlog means no primary assignee; an active assist on a Backlog
task still qualifies. A task with no assignee notifies nobody. That is a known
gap surfaced by the existing D1b needs-attention readers, not repaired by R2.
Completed tasks and Draft/Archived parents never qualify. `end_time` never
triggers a reminder. A Live Operation can legitimately receive both kinds,
because `due_date` and `call_time` are separate targets and ledger kinds.

The actor concept does not apply to a clock-driven reminder. No assignee is
excluded as a self-actor. Confidentiality remains the N1 reader contract: a
current real viewer sees the title, while masked/hidden readers get
`Confidential Task` and hidden readers get no task link. Push is always generic
and receives neither the title nor any person/content field.

## Stored date meaning and Manila time

R2 compares the exact stored `due_date` timestamp, matching the existing
24-hour priority escalation. The app's date-only value is stored as midnight
UTC. Thus selected date `2026-11-20` is stored as
`2026-11-20 00:00:00+00`, which is **8:00 AM Manila on November 20**; R2 first
qualifies it at about **8:00 AM Manila on November 19**. R2 does not change
storage or reinterpret the timestamp as end of day.

All comparisons use `timestamptz` instants. The job's every-15-minute cadence
does not depend on the database/session timezone; Manila is relevant when the
stored instant is presented to members. A late-created task, newly assigned
person, or moved target is sent on the next run after it enters its window,
provided the target is still strictly in the future. Nothing is sent at or
after the target.

## Notification type integration

R2 uses two new types rather than reusing assignment or status types. Both are
added in every type-sensitive location established by R1:

1. `notifications_type_check`;
2. `push_delivery_queue_notification_type_check`;
3. `ceit_connect_private.insert_notifications`' accepted-type allowlist;
4. `public.claim_push_deliveries`' fixed generic-body `CASE`;
5. the bell TypeScript union/parser and exact sentence switch;
6. the Phase 5 catalog and notification documentation; and
7. database contract, catalog, behavior, bell parser, bell copy, and render
   coverage.

The N1 list reader remains the sole source of safe bell titles. R2 adds no
client writer and no new public reader.

## Exactly-once ledger and bootstrap

`ceit_connect_private.task_deadline_reminder_ledger` has the exact primary key
`(task_id, reminder_kind, target_at, user_id)`. It stores only UUIDs, target
instant, recorded time, and `bootstrap`/`sent` reason. It is postgres-owned,
RLS-enabled with zero policies, has no foreign key, and grants no access to
`PUBLIC`, `anon`, `authenticated`, or `service_role`.

The occurrence emitter rechecks the current Active parent, non-Completed task,
exact target, time window, task type, current assignment arrays, and active
profiles. The real-clock public runner also reads a fresh database clock at
that final recheck, so a target that expires during a run cannot create a late
ledger claim or notification; the private test worker continues to use its
injected clock. It inserts previously missing ledger claims and their
notification rows in one data-modifying statement and transaction. A failed
notification insert therefore cannot commit a claim by itself.

- Re-running the same task/kind/target/person sends nothing.
- Moving `due_date` or `call_time` creates a new target key and may send once
  to every currently eligible person when the new target enters its window.
- Returning to an exact target already in the ledger does not resend.
- A newly added active assignee inside the window has no ledger key and gets
  one reminder; removed assignees are absent at the emitter recheck; removing
  and readding a person for the same target does not resend.
- Due and prep reminders stay separate kinds even on the same Live Operation.
- Deleting/clearing a notification through N3a does not erase the ledger and
  cannot regenerate the reminder.

The migration invokes private
`bootstrap_deadline_reminders_at(clock_timestamp())` exactly once. This
clock-injected routine marks every then-current eligible recipient already
inside either window with `recorded_reason = 'bootstrap'`, creates no
notification, and uses `ON CONFLICT DO NOTHING`, so it is idempotent. A person
assigned after bootstrap is still missing and receives one reminder. The
routine is executable by no application role, including service role.

Bootstrap is the sole R2 session-guard exception: because Supabase CLI
`db push` connects through a temporary login role and then acts as postgres,
this migration-only function accepts a `session_user` that is a member of the
`postgres` role. The temporary role's exact membership mode is unverified. The
first Dev attempt rolled back, and the next dry-run listing
`20261116120000_deadline_reminders.sql` again will confirm it; a successful Dev
push is the real proof of the membership boundary. The bootstrap remains
ungranted to browser roles, service role, and authenticator.

Ledger rows whose target is more than 30 days old are removed oldest-first in
batches of 500 with `FOR UPDATE SKIP LOCKED`. This is long after the target, so
cleanup cannot make a still-sendable occurrence eligible again. The aggregate
run history uses the same retention and cap and contains only counts, timing,
SQLSTATE, and fixed safe failure text.

## Runner, cap, overlap, and cost

`ceit_connect_private.run_deadline_reminders_at(timestamptz)` is the private
controlled-clock worker used by tests. `public.run_deadline_reminders()` is a
thin real-clock wrapper. Both require a real postgres session before validating
input or taking locks. Execute is revoked from browser roles and service role;
there is no service-role exception. The emitter and both purge helpers retain
the same strict `session_user = 'postgres'` boundary.

The worker takes a transaction advisory lock. A concurrent invocation returns
one safe skipped row without scanning or mutating candidates. Each normal run
orders occurrences by target instant, kind, and task ID, then caps at 100.
Crucially, an occurrence enters that ordered/capped set only when at least one
currently eligible active recipient is missing its exact ledger key. Fully
ledgered occurrences still inside their windows consume no cap. Paste B proves
101 waiting occurrences: run 1 sends the earliest 100, run 2 sends the final
one while those first 100 remain in-window, and run 3 sends nothing.

The public runner returns exactly one readable row with occurrences handled,
notifications created, whether overlap caused a skip, ledger rows cleaned,
run-history rows cleaned, and one fixed safe status (`Completed.`,
`Completed with failures.`, or
`Skipped because another reminder run is active.`). Per-occurrence failures
are contained so one malformed/racing row does not prevent later candidates or
retention. Migration `20261117120000_deadline_reminder_retry_backoff.sql`
persists content-free occurrence retry state outside the caught exception,
backs failures off for 15, 30, 60, then 120 minutes, and stops selecting an
occurrence after five failed attempts or its target, whichever comes first.
Successful retry deletes that state; failed notifications never receive a
ledger row. Retry rows older than the same 30-day retention window are cleaned
500 at a time. Run history exposes no task/person/content value.

Prod runs every 15 minutes: 4 invocations/hour, 96/day, or about 2,880 in a
30-day month. Each scans indexed near-term targets, handles at most 100
qualifying occurrences, and deletes at most 500 rows from each retention table.
That bounded pattern is the approved free-tier cost. Dev has no cron job; the
owner manually runs `select * from public.run_deadline_reminders();` in the SQL
Editor when a real-clock pass is wanted. Tests use only the private injected
clock.

At 100 earliest-target occurrences per 15-minute run, the accepted delivery
capacity is 800 occurrences within any two-hour window and 9,600 per day. A
larger backlog remains earliest-target-first; the batch logic is intentionally
unchanged.

The intended 100-person combined primary-plus-assist ceiling is enforced in
the assignment-array writer and the create/edit event and task writer paths;
it is not a table-level constraint. Verification also found a pre-existing
edge case in `claim_task`: a zero-primary task that already has 100 assists can
gain one primary because that writer has no corresponding existing-assist cap
check. R2 therefore deduplicates and filters the arrays it actually reads and
does not rely on a table constraint; hardening that claim edge is separate
from this notification migration.

## Latest replacements: old versus new

No policy is added or replaced. R2 replaces exactly the two latest R1
functions below. Both definitions are copied from
`20261115120000_request_notifications.sql`; changes are limited to the shown
allowlist/`CASE` additions.

| Function | Latest R1 definition (old) | R2 definition (new) | Every behavior difference |
| --- | --- | --- | --- |
| `ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])` | Postgres-owned `VOLATILE SECURITY DEFINER`, fixed empty path, no application-role execute. The allowlist is the six N1 types plus R1's five request types. It requires non-null task ID, deduplicates recipients, excludes `p_actor_id`, filters inactive profiles, inserts set-wise, returns the inserted count, and raises exact `Notification metadata is invalid.` for invalid metadata. | Byte-for-byte equivalent signature, owner, volatility, security, path, grants, fixed error, qualification, insertion, and return behavior. Its allowlist appends `task_due_soon` and `live_operation_prep`. | Only the two R2 values become valid inputs. Actor exclusion remains available for actor-driven callers; R2's scheduled emitter does not call this actor-shaped helper. No prior type or recipient behavior changes. |
| `public.claim_push_deliveries(integer)` | P1/R1 postgres-owned `VOLATILE SECURITY DEFINER`, fixed empty path, anon-only capability execution, thirteen OUT columns. Capability authentication precedes limit validation and every lock/mutation. It retains bounded cleanup, active-recipient/subscription rechecks, retry expiry, `SKIP LOCKED` claiming, two-minute leases, aggregate run history, qualified output columns, and exact fixed errors. Its generic-body `CASE` has eleven arms through R1. | Exact latest R1 signature, owner, volatility, security, path, grants, authentication-first order, return shape, fixed errors, cleanup, retry, lock, lease, qualification, and run behavior. Two `CASE` arms are appended: `task_due_soon → A task is due soon.` and `live_operation_prep → A Live Operation call time is soon.` | Only R2 queue rows now resolve to non-null approved bodies and can be claimed. No title/person/task content is added; service role remains denied. |

For clarity, the only source-level deltas are:

```sql
-- insert_notifications old R1 allowlist tail
'leave_cancelled', 'leave_approved', 'leave_denied'
-- new R2 allowlist tail
'leave_cancelled', 'leave_approved', 'leave_denied',
'task_due_soon', 'live_operation_prep'

-- claim_push_deliveries old R1 CASE tail
when 'leave_denied' then 'Your leave request was denied.'
-- new R2 CASE tail
when 'leave_denied' then 'Your leave request was denied.'
when 'task_due_soon' then 'A task is due soon.'
when 'live_operation_prep' then 'A Live Operation call time is soon.'
```

The migration authorizes `session_user = 'postgres'` before either advisory or
row lock. All replacement and new definers retain `SET search_path = ''`,
postgres ownership, schema-qualified objects, and fixed safe errors. Columns
that can collide with OUT parameters are referenced through aliases such as
`queue.notification_type`, `occurrence.target_at`, and
`internal_result.out_status`.

## Existing-system interaction

- P1 web push receives the two widened queue types through the unchanged
  enqueue trigger and exposes only the fixed generic copies above.
- N3a remains type-agnostic: read R2 rows can be manually cleared and old read
  R2 rows can be auto-removed; unread rows remain protected. Queue cascade
  behavior is unchanged. The separate R2 ledger intentionally survives.
- D1b dashboard readers continue reading task/event state, not notification or
  ledger rows. They still surface unassigned/no-active-owner work.
- The existing 24-hour priority escalation and R2 compare the same exact
  stored `due_date`. They are independent effects; neither calls or suppresses
  the other.
- R1 triggers and five request types are unchanged. Their actor exclusion and
  outcome/suppression rules do not apply to the actorless scheduled pass.
- Quiet hours are explicitly deferred.

## Prod rollout — owner only

Do not enable R2 generation until the tolerant bell-parser release is deployed.
It skips unknown notification types instead of rejecting the notification page,
so a later notification type cannot lock a compatible client out of its list.
Deploying a new Vercel version or hard-refreshing the owner's browser does not
prove that another member's already-open tab or installed app has updated.

Before continuing, deploy this tolerant-parser release and use the normal
browser/PWA refresh path for open clients. Until that release is deployed, do
not manually invoke the runner or create the Prod cron job.

Once that protection is verified, use this order:

1. Merge the application change so Vercel deploys the new client, and wait
   until that deployment is **Ready**.
2. Use the verified update mechanism for browser tabs and installed apps, and
   confirm clients run the compatible bell parser.
3. Only then push `20261116120000_deadline_reminders.sql` and
   `20261117120000_deadline_reminder_retry_backoff.sql` through the owner's
   normal Prod migration process and confirm the R2 Dev pastes have passed.
4. Create `ceit-connect-deadline-reminders` last with the owner-run paste below.

The migration deliberately never creates or changes a `cron.job` row. With no
manual invocation of the runner, no R2 notification can exist before the cron
job runs. That delay alone is not client compatibility: do not activate cron
until the protection above is verified.

After the migration is live on Prod, run this complete paste once in the Prod
SQL Editor. It refuses to create a duplicate name and then displays the stored
schedule and command:

```sql
do $$
declare
  v_job_id bigint;
begin
  if exists (
    select 1 from cron.job as job_row
    where job_row.jobname = 'ceit-connect-deadline-reminders'
  ) then
    raise exception 'Cron job ceit-connect-deadline-reminders already exists.';
  end if;

  select cron.schedule(
    'ceit-connect-deadline-reminders',
    '*/15 * * * *',
    'select * from public.run_deadline_reminders();'
  ) into v_job_id;

  raise notice 'Created ceit-connect-deadline-reminders as job %.', v_job_id;
end;
$$;

select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'ceit-connect-deadline-reminders';
```

After the next quarter-hour boundary, verify the first scheduled execution with
both read-only queries below. The `cron.job_run_details` row confirms that cron
invoked the SQL, but its `status = 'succeeded'` and `return_message` do **not**
prove reminder generation succeeded: the runner catches generation and cleanup
failures and records them in its own private run table. Retain both outputs for
the rollout record.

```sql
select
  job_row.jobid,
  job_row.jobname,
  detail.status,
  detail.return_message,
  detail.start_time,
  detail.end_time
from cron.job as job_row
join cron.job_run_details as detail on detail.jobid = job_row.jobid
where job_row.jobname = 'ceit-connect-deadline-reminders'
order by detail.start_time desc
limit 5;

with latest_cron as materialized (
  select detail.runid,
         detail.start_time,
         detail.end_time,
         detail.status as cron_status,
         detail.return_message
  from cron.job as job_row
  join cron.job_run_details as detail on detail.jobid = job_row.jobid
  where job_row.jobname = 'ceit-connect-deadline-reminders'
  order by detail.start_time desc
  limit 1
), matching_runs as materialized (
  select run_row.*
  from ceit_connect_private.deadline_reminder_runs as run_row
  cross join latest_cron
  where run_row.started_at >= latest_cron.start_time
    and run_row.finished_at is not null
    and latest_cron.end_time is not null
    and run_row.finished_at <= latest_cron.end_time
)
select
  latest_cron.runid as cron_run_id,
  latest_cron.cron_status,
  run_row.id,
  run_row.started_at,
  run_row.finished_at,
  run_row.as_of,
  run_row.status,
  run_row.occurrences_handled,
  run_row.notifications_created,
  run_row.ledger_rows_cleaned,
  run_row.run_history_rows_cleaned,
  run_row.generation_error_sqlstate,
  run_row.generation_error_message,
  run_row.cleanup_error_sqlstate,
  run_row.cleanup_error_message,
  run_row.run_history_error_sqlstate,
  run_row.run_history_error_message
from matching_runs as run_row
cross join latest_cron
where (select count(*) from matching_runs) = 1;
```

Accept the rollout only when this correlated query returns exactly one row and
that row has `cron_status = 'succeeded'` and private `status = 'completed'`.
Zero rows means no private run matched that cron execution or the cron run has
not finished; more than one candidate is deliberately collapsed to zero and
means overlapping/manual activity made verification ambiguous. Never approve a
failed scheduled rollout from a later manual run.

If the owner must remove the schedule, run this separate paste. It is
idempotent and does not delete reminder data:

```sql
do $$
declare
  v_job_id bigint;
begin
  select job_row.jobid into v_job_id
  from cron.job as job_row
  where job_row.jobname = 'ceit-connect-deadline-reminders';

  if v_job_id is null then
    raise notice 'Cron job ceit-connect-deadline-reminders is already absent.';
  else
    perform cron.unschedule(v_job_id);
    raise notice 'Removed ceit-connect-deadline-reminders.';
  end if;
end;
$$;

select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'ceit-connect-deadline-reminders';
```

## Verification and files

- Paste A: `step-r2-deadline-reminders-catalog-tests.md` — **25/25**.
- Paste B: `step-r2-deadline-reminders-behavior-tests.md` — **26/26**.
- Retry follow-up: `step-r2-deadline-reminder-retry-tests.md` — **12/12**.
- Each is one Dev-only rollback paste with its own `auth.users` rows, explicit
  impersonation, **Run without RLS**, no temporary table, controlled time where
  behavior depends on a window, and one intentional final exception.
- Local verification is limited to `npx.cmd tsc --noEmit`, `npm.cmd run test`,
  `npm.cmd run lint`, and `git diff --check`. No build or Supabase command is
  part of R2 implementation.

Created or changed: the R2 migration, its retry-backoff follow-up, and SQL-paste docs; this step doc;
the bell type/parser/copy and tests; an R2 migration contract test; the Phase 5
plan/catalog and N1/N2/N3a/P1 interaction docs; `DATABASE.md`; and
`PROGRESS.md`. No already-applied migration is edited.
