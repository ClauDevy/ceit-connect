# Batch E step 1 — Activity Log retention and CSV export

## Scope

Active Admins can save a rolling Activity Log retention value from 30 through
730 whole days and export the currently filtered and sorted safe reader result
as CSV. Co-Admins keep the existing global reader but receive neither the
setting nor export controls. Members keep their existing task-scoped History
access only.

The migration seeds **30 days** so rollout does not silently change deletion
behavior. The recommended 180-day value is never saved automatically. Prod
must remain at 30 until the owner gives a separate explicit confirmation and
then saves 180 deliberately.

## Database contract

`ceit_connect_private.activity_log_settings` is one private row containing
`retention_days`, `updated_at`, and nullable plain UUID `updated_by`. It has no
foreign key to users, events, or tasks. It therefore cannot join the CCE09
event/task lock inventory, block user anonymization, or change the existing
users hard-delete protection.

The active-Admin-only getter and setter expose the setting without granting
table access. The setter authorizes first, validates 30–730, records the caller,
and does not invoke retention. `activity_log_retention_days()` now reads the
private row. `purge_activity_log()` and its DELETE/TRUNCATE trigger are not
replaced: postgres-session enforcement, the transaction-local marker,
oldest-first locking, strict older-than cutoff, and 5,000-row cap are unchanged.

The Admin-only export reader authorizes first and delegates every filter,
search, cursor, masking, and projection decision to `list_activity_log()`.
It exposes no raw `changes`. Each call returns at most 500 safe rows and caps
internal continuation work. The browser follows exact cursors and refuses to
create a file when a 5,001st matching row exists.

## CSV contract

The file contains date/time, action, task, event, committee, actor, and change
summary only. Masked entries remain `Confidential Task`. Every cell is quoted;
quotes are doubled; values beginning with `=`, `+`, `-`, `@`, tab, or carriage
return receive a leading apostrophe. Files include a UTF-8 BOM.

## Scheduler boundary

**No migration schedules the daily Activity Log purge job.** Saving retention
only changes the cutoff that a future call to `purge_activity_log()` will use.
The setting has no deletion effect until the owner separately creates the
`pg_cron` job on Dev and on Prod.

The environment-specific job remains:

- Name: `ceit-connect-activity-log-retention`
- Daily schedule: 3:00 AM Philippine time (`0 19 * * *` in `pg_cron`)
- Command: `select public.purge_activity_log();`
- Database role: `postgres`

The owner checks `cron.job` in each environment, enables the Supabase Cron
integration if needed, creates the job in the SQL Editor if it is absent, and
verifies its command, role, active state, and later run history. No application
role receives cron or purge authority.

## Rollout order

1. Before the new migration, rerun the original Batch 12b 19-case Dev paste and
   record `19/19 PASS`.
2. Apply the new migration on Dev and run the Batch E SQL paste.
3. Complete Admin, Co-Admin, Member, CSV, and reduced-motion checks on Dev.
4. Review and merge the app change, then apply the migration on Prod.
5. Verify both environments still contain 30 days after migration.
6. Check or create the cron job separately in both environments.
7. Leave Prod at 30 until the owner explicitly confirms changing it to 180.

The older `docs/phase-4b/step-b-tests.md` and `step-13d-tests.md` pastes still
assert 30. Before rerunning either on Dev, the owner must save the setting back
to 30. Those historical pastes are not edited.

## Manual checks

- Admin sees the real saved value, can save valid bounds, and cannot save 29 or
  731. Saving never immediately removes rows.
- The 180 notice says “about 6 months (180 days)”; other notices show exact days.
- Export follows the current filters and sort, retains masking, safely opens in
  spreadsheet software, and refuses more than 5,000 rows without a partial file.
- Co-Admin sees the ordinary log but no numeric retention, metadata, setting
  form, or export action; direct setting/export calls receive the fixed denial.
- Member still cannot open the global Activity Log.
- After the separately created job runs, only rows strictly older than the saved
  number of days are eligible and no call removes more than 5,000 rows.

