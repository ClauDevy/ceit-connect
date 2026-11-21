# Batch E step 2 — Activity Log backup and clearing

## Scope

Every automatic or manual Activity Log deletion is preceded by a complete,
private, viewer-independent CSV snapshot. There is one active backup at a time.
Prod checks at 8:00 AM Philippine time on days 1 through 7 so a missed wake or
temporarily blocked run can catch up; the per-month record makes every repeat
idempotent. The UI never names a timezone. Dev has no cron or Vault values and
uses a manual trigger and wake.

The private `activity-log-backups` bucket contains numbered, formula-safe CSVs
with UTF-8 BOMs. A file has at most 5,000 rows and 5 MiB raw bytes. One wake
creates at most four files. A backup continues across later wakes, then sends
one email with at most four/20 MiB raw attachments; additional files are listed
and remain available in the Admin-only UI.

## Storage policies

Exactly two `storage.objects` policies exist for this bucket:

1. `anon INSERT` only when the name exactly matches an unexpired private
   reservation for a leased snapshotting backup. There is no anonymous UPDATE,
   upsert, DELETE, or broad bucket policy.
2. `authenticated SELECT` only when
   `is_active_activity_log_backup_admin()` confirms the caller is an active
   Admin. Co-Admins and Members are denied.

There is no anonymous Storage SELECT, UPDATE, upsert, DELETE, or list path, and
the worker never reads from or deletes Storage objects. It only uploads a
reserved object and then sends the same bytes to the database for verification.
These policies restrict application roles; Supabase service credentials bypass
Storage RLS and this migration does not make service-credential access
Admin-only. This worker does not use service credentials. Application downloads
continue to use the caller's authenticated session and active-Admin Storage
SELECT policy through the guarded route, not a service credential, so a
successful server retrieval is recorded before manual deletion can be
requested. That record is a deliberate UX gate, not a security boundary:
deletion security comes from the private, verified manifest and exact IDs.

The guarded download route hashes the retrieved bytes with SHA-256 and compares
the result with the verified file metadata before it records the download or
returns the CSV. A mismatch returns an error and does not satisfy the UX gate.

After a blind reserved-path upload succeeds, the worker passes that same CSV as
base64 to the capability-authenticated verification RPC. The database decodes
it, checks its byte length against both `raw_byte_count` and Storage object
metadata, independently computes and compares SHA-256, and only then writes the
bytes to the private RLS-enabled payload table and marks the file verified. An
ambiguous upload failure is not read back: the worker releases the lease, the
expired reservation is later removed, and a later wake reserves a new part.
The payload table has no API grants and no event/task FK.

Email preparation returns verified file IDs. A separate capability RPC returns
base64 for exactly one verified file belonging to the currently leased
`email_pending` backup; the worker uses those bytes for attachments without
touching Storage. A maximum-size 5 MiB file becomes about 6.7 MiB of base64 and
roughly a 7 MiB JSON request or response, so backup RPCs use the dedicated
30-second buffered fetch within the route's 60-second maximum. The ordinary
important-email database client keeps its two-second timeout.

If an upload expires before it is verified, its private metadata reservation is
removed but the immutable Storage object can remain as an orphan CSV; cleanup
is deferred.

## Retry and terminal behavior

Every backup has an attempt count and a next-attempt time. Claim and kick
eligibility both honor that time, so the minute wrapper does not repeatedly
wake a failing backup. Pending or snapshotting work uses 5, 15, 60, and 240
minute spacing and becomes `failed` after five failed attempts or 24 hours
without completing. Its safe code is `snapshot_attempts_exhausted` or
`snapshot_expired`; no deletion has started, and the terminal record releases
the one-active slot.

Deletion uses the same bounded spacing but never transitions to `failed` or
widens its manifest. It remains active and keeps retrying exact stored IDs,
with `deletion_retry_pending` visible to Admins. Email uses 5, 15, 60, and 240
minute spacing, reaches `email_failed` after attempt five, and retains the
Admin Retry action and backup-UUID Idempotency-Key.

Private payload bytes are deleted when a backup reaches `completed` or `failed`.
They remain while email is `email_pending` or `email_failed`, so an Admin retry
can attach the same verified files. Age-based cleanup for abandoned terminal
`email_failed` payloads is deferred.

## Deletion authority

Deletion authority moved from **postgres session only** to the ungranted
`ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)`.
It accepts only a backup in `deleting`, requires every file to be verified,
targets only exact private manifest UUIDs, and sets the existing purger marker
only around a statement capped at 5,000 rows. TRUNCATE and raw DELETE remain
blocked. `public.purge_activity_log()` retains its postgres-session denial but
returns zero.

The two new semantic rows are leadership-only global Activity Log entries:

- `activity_log_retention_changed` — broad action `UPDATE`, so the existing
  Updated filter includes it.
- `activity_log_cleared` — broad action `DELETE`, so the existing Deleted
  filter includes it.

Both have nullable `task_id` and `event_id`, no task/event FK, and never appear
in task-scoped History. Active Admins and Co-Admins see them in the global
reader; Members cannot open that reader.

## Viewer-independent confidentiality

Backup projection never returns raw `changes`. A task that is currently or was
historically confidential is always exported as `Confidential Task`, with no
title, event, committee, actor, or task-specific summary, even though an Admin
requested the backup. This strict shape is identical for in-app downloads and
every email recipient.

## Replaced function bodies

### `set_activity_log_retention_days(integer)`

Old behavior: authorize, validate, then always update `retention_days`,
`updated_at`, and `updated_by`, returning the three-column row.

New behavior: authorize and validate in the same order, lock the singleton,
and retain the same three-column response. A different value atomically updates
the row and writes one ordinary semantic entry with old/new days and actor. A
same-value save returns the unchanged row, writes no activity, and does not
silently replace the policy setter. If `updated_by` remains null, monthly email
falls back to all active confirmed Admins.

```sql
-- Old core body
return query
update ceit_connect_private.activity_log_settings as setting
set retention_days = p_retention_days,
    updated_at = pg_catalog.clock_timestamp(),
    updated_by = v_caller_id
where setting.singleton
returning setting.retention_days, setting.updated_at, setting.updated_by;
```

```sql
-- New core body
select setting.* into v_setting
from ceit_connect_private.activity_log_settings as setting
where setting.singleton
for update;

if v_setting.retention_days is distinct from p_retention_days then
  v_old_days := v_setting.retention_days;
  update ceit_connect_private.activity_log_settings as setting
  set retention_days = p_retention_days,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = v_caller_id
  where setting.singleton
  returning setting.* into v_setting;
  perform ceit_connect_private.write_activity(
    'activity_log_retention_changed', 'user', v_caller_id,
    null, null, v_caller_id, null, null,
    pg_catalog.jsonb_build_object(
      'old_days', v_old_days, 'new_days', p_retention_days
    )
  );
end if;
return query
select v_setting.retention_days, v_setting.updated_at, v_setting.updated_by;
```

### `purge_activity_log()`

Old behavior: require a postgres session, set the purger marker, select the
oldest 5,000 rows older than the rolling cutoff, delete, clear the marker, and
return the count.

New body:

```sql
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = 'CAL03',
      message = 'Activity log retention must run as postgres.';
  end if;
  return 0;
end;
```

The latest full old body remains in
`20261029140000_activity_log_retention.sql`; the complete replacement is in
`20261127120000_activity_log_backup_foundation.sql`. The subsequent
`20261129120000_activity_log_person_payload_retention_and_cleared.sql` extends
the person-payload constraint for the two Activity Log backup and clearing
activity types.

## Environment variables

None. The worker reuses `EMAIL_DB_CAPABILITY`, `EMAIL_WAKE_SECRET`, the existing
email Vault secret names, Resend configuration, and the anonymous Supabase key.
Backup email ignores the personal email toggle and the 70/day important-email
allowance. A multi-recipient request uses the backup UUID alone as its
Idempotency-Key.

## Dev owner steps

All three migrations are already applied on Dev and both SQL pastes passed
there. The foundation migration establishes the backup schema and activity
types. The worker migration
`20261128120000_activity_log_backup_worker.sql` is the prerequisite for the
follow-up person-payload migration
`20261129120000_activity_log_person_payload_retention_and_cleared.sql`; that
worker prerequisite is already applied on Dev. To create or retrieve this
month's record manually:

```sql
select ceit_connect_private.start_monthly_activity_log_backup();
```

Repeating that line returns the same UUID and never creates a second record for
the month. Then manually POST `{}` to `/api/email/wake` with the existing
`x-ceit-email-wake-secret`. Repeat the wake while work remains due. Dev proves
normal email, failure, and same-idempotency-key retry. Multi-file behavior is
covered by the rollback-safe SQL fixture and injectable unit caps; no manual
5,001-row Dev exercise is required.

## Prod rollout — fixed order

None of the three migrations is applied on Prod yet. Before rollout, the Prod
dry run must show these three pending migrations in this order:

1. `20261127120000_activity_log_backup_foundation.sql`
2. `20261128120000_activity_log_backup_worker.sql`
3. `20261129120000_activity_log_person_payload_retention_and_cleared.sql`

The rollout sequence is:

1. Merge and wait until the Vercel Production deployment is Ready.
2. During this app-before-database window, a missing backup RPC is an isolated
   backup-worker failure: important email continues and the wake stays `202`.
3. Push the three migrations in order:
   `20261127120000_activity_log_backup_foundation.sql`,
   `20261128120000_activity_log_backup_worker.sql`, then
   `20261129120000_activity_log_person_payload_retention_and_cleared.sql`.
4. Verify the bucket, grants, saved 30-day value, retry state, and SQL pastes.
5. Review and run the single Prod-only cron paste below.
   The day-1-through-7 checker returns the existing monthly UUID when present.
   If another backup owns the active slot, that day's cron invocation may fail
   harmlessly; the next day tries again before any monthly record exists.
6. Do not delete Prod history for a test. A zero-deletion backup sends no
   email. Prod email is verified by the first real monthly run.
7. Prod remains at 30 days until the owner deliberately saves 180.

### Before/after job list

```sql
select jobid, jobname, schedule, command, active
from cron.job
order by jobname, jobid;
```

### One Prod-only cron paste

The statements are deliberately ordered: create monthly first, switch the
minute wake second, unschedule the unsafe daily purge last.

```sql
begin;

select cron.schedule(
  'ceit-connect-activity-log-monthly-backup',
  '0 0 1-7 * *',
  'select ceit_connect_private.start_monthly_activity_log_backup();'
);

select cron.alter_job(
  (select jobid from cron.job where jobname = 'important-email-delivery'),
  command := 'select ceit_connect_private.request_email_and_activity_backup_kicks_if_due();'
);

select cron.unschedule(
  (select jobid from cron.job where jobname = 'ceit-connect-activity-log-retention')
);

commit;

select jobid, jobname, schedule, command, active
from cron.job
order by jobname, jobid;

select pg_catalog.count(*) = 7 as exactly_seven_prod_jobs
from cron.job
where active;
```

### Cron rollback lines

This rollback restores only the original important-email kick. It does **not**
restore automatic retention deletion: E2 deliberately makes
`public.purge_activity_log()` return `0`, so scheduling it would provide false
assurance. Never re-enable Activity Log deletion without the stored-backup
protection.

First stop new scheduled backup starts. This does not cancel a monthly checker
that was already running, so allow that invocation to finish before relying on
the final drain check:

```sql
select cron.unschedule(
  (select jobid from cron.job
   where jobname = 'ceit-connect-activity-log-monthly-backup')
);
```

Coordinate with Admins to pause manual snapshot starts, Admin email retries,
and new deletion requests during rollback. Allow any in-flight Admin action and
the possibly running monthly checker to finish before the final check. Keep the
existing wakes available for work that was already admitted, then check
unfinished work:

```sql
select id, status, next_attempt_at, lease_expires_at, delete_expires_at,
  case
    when status = 'ready' then delete_expires_at <= pg_catalog.clock_timestamp()
    else null
  end as ready_window_expired,
  last_error_code
from ceit_connect_private.activity_log_backups
where status in (
  'pending', 'snapshotting', 'ready', 'deletion_requested', 'deleting',
  'email_pending'
)
order by created_at, id;
```

`pending`, `snapshotting`, `deletion_requested`, `deleting`, and
`email_pending` are claimable by the existing worker. Keep the combined kick
installed, use only the existing authorized manual wake call when work is due,
and repeat the query until none of those states remain.

`ready` is different: wakes never claim it. It can leave `ready` only after the
Admin downloads every file and submits the existing deletion request, or when
its deletion window expires and the existing backup-start path next runs its
expiry check. If rollback leaves an expired `ready` row in place, it is not
claimable; do not invent a wake for it. If an operator deliberately uses an
ordinary backup start to apply that expiry, the resulting new backup must also
be drained. Repeat the query until no claimable row remains and every remaining
`ready` row has `delete_expires_at <= clock_timestamp()`. This also catches a
backup start that was already in progress when the monthly job was unscheduled.

Do not remove the combined kick until that final check passes. Then apply the
remaining rollback:

```sql
begin;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'important-email-delivery'),
  command := 'select ceit_connect_private.request_email_kick_if_due();'
);

commit;
```

If claimable work is found after the combined kick was removed, restore it
immediately, run authorized manual wakes, and leave it installed until the
final claimable/ready check above passes:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'important-email-delivery'),
  command := 'select ceit_connect_private.request_email_and_activity_backup_kicks_if_due();'
);
```

