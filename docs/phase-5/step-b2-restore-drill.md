# Phase 5 B2 — backup restore drill

## Status

Implemented locally as documentation. The owner-run drill and its real result
remain pending. No migration, application code, Supabase command, cloud
project, or real Auth data is part of B2.

None of the drill commands has been executed by Codex or Claude. The first real
owner-run drill may expose environment-specific errors or command corrections;
update the runbook with what actually happens before treating it as proven.

## Contract

- Restore only into a throwaway local Docker PostgreSQL database on the
  owner's PC, never Dev, Prod, or another cloud project.
- Pin the Docker image to the PostgreSQL major version in the dump header.
- Publish no port, use Docker's `none` network and a generated throwaway
  password, then remove the container with its anonymous volume.
- Run `export MSYS_NO_PATHCONV=1` immediately after opening Git Bash so bare
  `/restore` paths remain container paths for `docker exec` commands.
- Wait for the first-start completion log, then wait for `pg_isready` again
  before the first `psql` command.
- Use a same-day backup and capture the live object counts before any migration
  or Prod push; otherwise catalog differences are expected and harmless.
- The recorded November 12, 2026 backup predates L1 and G1, so the first drill
  requires a fresh same-day backup and object-count proof.
- Keep dumps, logs, and results in the private backup folder outside the
  repository. They contain real member and confidential data and are never
  committed or shared.
- Paste one short command at a time in Git Bash. Use `docker cp` with explicit
  Windows path handling rather than a bind mount.
- Load schema first while collecting every error; classify those errors before
  loading data with stop-on-error.
- Success requires exact restored-versus-recorded-live row counts; exact live-
  versus-restored counts for tables, functions, policies, triggers, indexes,
  and constraints; healthy dependency checks; and all twelve committees.
- Run the drill once now and repeat it after every big database change.

The executable owner runbook is the **Restore drill** section of
`docs/BACKUP.md`.

## Known traps and decisions

### Plain PostgreSQL needs narrow stand-ins

Before schema loading, create roles `anon`, `authenticated`, and
`service_role`; schemas `auth` and `extensions`; minimal `auth.users`;
UUID-returning `auth.uid()`; text-returning `auth.role()`; and `pgcrypto` in
`extensions` because three functions call `extensions.digest`.

After data loading, copy only `public.users.id` values into the stand-in
`auth.users`. No real Auth row, email, identity, password hash, session, refresh
token, or provider data is restored. A local Supabase stack is heavier and is
not the recommended path.

The container uses no named volume. PostgreSQL image majors use different data
folder layouts, so the runbook relies on the container's anonymous volume and
removes it with `docker rm -fv`.

### Task data has a real self-reference

`public.tasks.depends_on_task_id` references `public.tasks.id`. COPY ordering
can place a dependent before its prerequisite, so trigger-backed foreign-key
checks are relaxed only for the scratch data-load session. A new session must
report normal trigger behavior. The runbook checks user/Auth orphans, task
dependency orphans and invalid edges, and constraint validation afterward.

Both foreign keys were created valid on empty tables during schema loading, so
running `VALIDATE CONSTRAINT` after the relaxed load would do nothing. The real
checks are the user/Auth orphan count, task-dependency orphan count, and invalid
task-dependency count. A zero unvalidated-constraint catalog count is only a
sanity check and does not scan restored rows. This limited proof is accepted
because the two dumps are one consistent snapshot, not edited recovery data.

### Error handling and silent-loss detection

Schema loading continues so every error is counted. Expected harmless
candidates are missing `pg_net`, `supabase_vault`, or `cron` objects and unused
Supabase-owned role/grant statements. Missing required schema objects or any
unexplained error fails the drill. The first owner run must update the runbook
with the exact harmless errors actually observed.

Data loading stops on its first error. The exact catalog-driven row-count query
already used by the export proof is rerun against the scratch database and
diffed with `live-row-counts.sorted.txt`. One read-only Prod SQL Editor SELECT
returns only table, function, policy, trigger, index, and constraint counts and
committee names. The same expression runs locally and the results must match,
which catches silent loss from tolerated schema errors without exposing
personal data.

### Mismatch and cleanup

Never repair a mismatch in place. First confirm the backup and live catalog
proof were taken on the same day with no intervening migration or Prod push;
otherwise differences are expected and harmless. Re-take the backup and stop
for review if a same-window proof still differs. Remove the isolated container
and its anonymous volume at the end. Retain or securely delete the whole
private folder under the existing retention rules.

## Out of scope and disaster limitation

Supabase Auth users, identities, sessions, password hashes, Storage files,
`pg_cron` jobs, dashboard configuration, and Vercel environment variables are
not in the dump. A disaster requires re-inviting members, re-uploading avatars,
and recreating cron jobs and settings.

Restored profiles retain old Auth UUIDs, while re-inviting a person may create
a new UUID. That identity-reconciliation limitation is a later decision; B2
does not invent an Auth export or production repair.

## Owner drill result

Do not replace `Pending` until the owner completes the real local drill.

| Date and Philippine time | Backup folder name | Row-count result | Error count | Notes |
| --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Owner-run drill not yet completed |
