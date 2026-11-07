# Step 14: hardening, cleanup, and Phase 4B gate

**Status:** Part 1 passed on Dev; Part 2 implemented locally with its Dev gate pending | **Branch:** `fix/hardening-gate` | **Reasoning:** High for database boundaries

## Approved split and stop point

Part 1 is database first: three new migrations, SQL tests, catalog/Step 10 allowlists, and documentation/contract tests. The owner applied all three to Dev and confirmed the 33/33 Batch 14 paste plus the Step 8, Batch A, Batch B, and Batch D 46/46 Gate B reruns. Part 1 is not on Prod. After the owner replied **continue**, Part 2 added a fourth Batch 14 migration for the isolated session-revocation boundary, removed `/sandbox` and its sole demo after import proof, retained the unused legacy sidebar as a list-only item, and re-verified Step 1 cleanup. Prod therefore receives `20261109120000`, `20261109121000`, `20261109122000`, and `20261109123000` in timestamp order.

Never edit the eight A/B/D migrations already live on Dev and Prod. Never run a Supabase command or remote write. Do not run a build in this batch; use only `npx.cmd tsc --noEmit`, `npm.cmd run test`, `npm.cmd run lint`, and `git diff --check`.

## Owner preflight and Migration A

The owner ran the approved read-only ACL/effective-privilege queries on Dev and Prod. Results were identical: all relevant grants are direct from `authenticated`, granted by `postgres`, non-grantable; no target comes through `PUBLIC`, inheritance, or ownership. Before Migration A, `activity_log` already has none of the seven table privileges; `users` already lacks INSERT/UPDATE/DELETE. Migration A therefore revokes only TRUNCATE/REFERENCES/TRIGGER on all five tables (the `activity_log` revoke is an intentional no-op), and hard-fails if the live pre-state is not exactly:

Dev showed those target grants had already been revoked manually before the tracked migration was applied. The migration remains the record of truth and accepts either that absent state or the reviewed direct-postgres grant state. Prod's current pre-migration state still requires owner confirmation before the Prod sequence.

| Table | Before | After |
| --- | --- | --- |
| `events` | SELECT, INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER | SELECT, INSERT, UPDATE |
| `tasks` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER | SELECT, INSERT, UPDATE, DELETE |
| `notifications` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER | SELECT, INSERT, UPDATE, DELETE |
| `users` | SELECT, TRUNCATE, REFERENCES, TRIGGER | SELECT |
| `activity_log` | none | none |

The migration also enables non-forced RLS with zero policies on `ceit_connect_private.event_auto_archive_runs` and `event_auto_archive_run_items`. Both tables must have zero effective table privileges for `anon`, `authenticated`, and `service_role`. `run_event_auto_archive()` remains executable only by its `postgres` owner. Of the Batch D functions, only `get_event_auto_archive_warning(uuid)` is executable by `authenticated`.

## Migration B: inactive event visibility

Latest old policy:

```sql
create policy "events_select" on public.events for select to authenticated
using (status <> 'Draft' or public.my_role() in ('Admin', 'Co-Admin'));
```

New policy:

```sql
create policy "events_select" on public.events for select to authenticated
using (
  public.my_role() is not null
  and (status <> 'Draft' or public.my_role() in ('Admin', 'Co-Admin'))
);
```

Draft, active Member, active Co-Admin, and active Admin behavior is otherwise identical. The matching private reader `activity_event_status_visible_for_user(text,uuid)` and its comment are replaced in the same migration so the Activity Log mirror also requires `users.is_active`; `list_activity_log` retains its separate caller guard. The catalog/contract tests pin both readers. Impersonated tests cover inactive and profile-less callers plus active Member, Co-Admin, and Admin across Draft/non-Draft fixtures.

## Migration C: officer caps

The latest-timestamp migration updates only `public.app_settings` where `key = 'global'`, requires exactly one affected row, and asserts `enforce_officer_role_caps = true`. It does not rewrite accounts or invites. All Gate B tests now assume caps are ON; no suite leaves the singleton off.

## Authoritative catalog and tests

`docs/phase-4b/step-14-tests.md` is the authoritative migration-tied A/B/D extension to Phase 4 Step 10. It maps every changed object to one of the eight source migrations, checks the Batch 14 state, uses rollback-only caller fixtures and impersonation, prints exactly 33 result lines, and intentionally raises `TEST RESULTS: 33/33 PASS — transaction intentionally rolled back`. It does not invent a new global total; the owner records totals only from live Dev catalog output.

Part 2 extends that migration-tied catalog with `20261109123000_revoke_inactive_user_sessions.sql` and `public.revoke_inactive_user_sessions(uuid)`. The function is postgres-owned, volatile, `SECURITY DEFINER`, fixed to an empty `search_path`, executable only by `service_role`, denied to `PUBLIC`, `anon`, and `authenticated`, and has no overloads. The already-passed Part 1 33-line paste remains unchanged; the separate Part 2 paste owns these new catalog checks.

Gate B rerun order after the Batch 14 paste:

1. `docs/phase-4b/step-8-tests.md` — caps-on singleton and all seven writers; empty-seat appointment/reactivation behavior; any setting update restores/keeps ON.
2. `docs/phase-4b/step-a-tests.md` — caps-on lifecycle baseline and A catalog/behavior.
3. `docs/phase-4b/step-b-tests.md` — inactive status-mirror denial plus A/B activity catalog and writers.
4. `docs/phase-4b/step-d-tests.md` — unchanged 46-line paste; must pass after private-table RLS is enabled.

The privilege revoke cannot affect these suites: none depends on TRUNCATE, REFERENCES, or TRIGGER. The policy change intentionally updates only the inactive Batch B expectations. The RLS change cannot break the D paste because its private-history setup/catalog work is owner-run and the paste already asserts application-role denial.

## Cron ledger (outside migrations and allowlists)

The `pg_cron` job is not a migrated catalog object. Owner verification on 2026-11-07 records Prod with exactly one active job: jobid `4`, name `ceit-connect-event-auto-archive`, schedule `5 16 * * *`, command `select * from public.run_event_auto_archive();`, database `postgres`, username `postgres`. Dev has no job. On a fresh Dev inspection, either zero rows or `relation cron.job does not exist` means no job. Prod must return the exact row. Owner read-only check:

```sql
select jobid, jobname, schedule, command, database, username, active
from cron.job
where jobname = 'ceit-connect-event-auto-archive';
```

## Part 2: reversible deactivation and cleanup

`20261109123000_revoke_inactive_user_sessions.sql` adds one postgres-owned, fixed-empty-path, service-role-only boundary. It requires the profile to be inactive and the Auth user to be banned, deletes `auth.sessions` and `auth.refresh_tokens`, verifies both are empty, and deliberately leaves identities and Auth metadata untouched. This differs from former-member removal: ordinary deactivation is reversible and must never anonymize the account.

`/api/toggle-user-active` now follows the same sequence for officer, Co-Admin Member, and Admin Member deactivation: commit the authorized profile transition, ban the Auth account, revoke refreshable sessions, and remove the avatar only on paths that already own avatar removal. Reactivation unbans the Auth account but does not restore an old session. If the profile transition succeeds but any Auth step fails, the route returns `502` with `cleanupPending: true`; it never reports false success. Co-Admin retries accept only the RPC's exact `CCM04` already-at-requested-state result, allowing interrupted Auth cleanup to be retried without broadening target authority.

Unit tests cover all three paths, ban/unban, session-revocation output validation, partial failures, zero-row Admin Member updates, and retry. The existing protected-route test proves an old access cookie receives `403` as soon as its profile is inactive; `docs/phase-4b/step-14-part-2-tests.md` proves the refresh session is gone and expects the exact intentional `TEST RESULTS: 13/13 PASS — transaction intentionally rolled back` sentinel after the Part 2 migration is applied to Dev. The 13 rows are counted mechanically as six catalog rows and seven behavior rows.

Repository proof found `DrivePreviewDemo` imported only by `/sandbox`; both were removed while the real `DrivePreview` and `YourWorkCard` remain. Import searches found no importer for `src/components/layout/sidebar.tsx`, but it is retained unchanged as an unused legacy, list-only item; the mounted `AppShell` is unchanged. Step 1 cleanup remains intact: `cn` and `p` are absent as top-level dependencies/imports, the local `@/lib/utils` `cn()` remains, and the root theme bootstrap stays covered by its layout test.

Separate test-maintenance edits normalize CRLF to LF after reading migration/paste source in `activity-log-stage-one-migration-contract.test.ts`, `activity-log-stage-two-migration-contract.test.ts`, and `events/batch-a-migration-contracts.test.ts`. The Batch A cleanup pin was loosened only from an exact deparser substring to `event_end_override_writer[^;]*''[^;]*true`: it permits PostgreSQL-added casts or spacing, but still requires the exact setting name, an empty-string clear, local `true`, no semicolon crossing, and exactly two cleanup calls for success and exception paths.

## Part 2 owner Dev gate and browser checklist

Use this one sequence:

1. Review and apply only `20261109123000_revoke_inactive_user_sessions.sql` to Dev, then run `step-14-part-2-tests.md`. Its intentional final exception must say `TEST RESULTS: 13/13 PASS — transaction intentionally rolled back`.
2. Start the local app against Dev. Keep an active Admin signed in in one browser profile and the target account signed in in a separate private window. Use disposable Dev accounts, not the owner account.
3. Admin-deactivate an active officer. In the target window, retry the leadership-only Users request or reload `/users`; the old access cookie must not produce an authenticated leadership response. A fresh sign-in must be rejected while banned. Reactivate from the Admin window; the previous session must not revive, while a new sign-in succeeds.
4. Repeat with an active ordinary Member deactivated by an Admin. In the target window, submit a Settings name/avatar action after deactivation; it must be rejected rather than mutate data. Fresh sign-in must fail while banned. Reactivate, then confirm a fresh sign-in works and the old session was not restored.
5. Repeat with a Co-Admin deactivating a Member from that Co-Admin's own committee. Confirm the same session/sign-in behavior, then reactivate and fresh-sign-in again. The Co-Admin path intentionally preserves the Member's avatar; Admin deactivation retains its existing avatar removal behavior.
6. Confirm the browser never reports success for an induced cleanup failure. The automated route suite owns deterministic ban/revoke failure injection; do not damage Dev Auth rows merely to reproduce it manually.
7. Confirm `/sandbox` returns 404 and the real Drive preview on a task still opens normally. Smoke-test desktop and phone navigation to confirm the current `AppShell` is unchanged; the unused legacy sidebar remains unmounted and is not part of this cleanup.

Do not continue to Prod from this checklist. Prod starts later with its read-only preflight, then the four Batch 14 migrations in timestamp order, the SQL gates, and the external cron recheck.

## Gate ledger

- A, B, and D: live on Dev and Prod (owner-confirmed).
- Batch 14 Part 1: three migrations live on Dev with 33/33 plus all required Gate B reruns passed; not yet on Prod.
- Batch 14 Part 2: one later session-revocation migration and app cleanup implemented locally; Dev 13/13 SQL and browser checks remain owner gates.
- Prod cron: owner-verified exact job on 2026-11-07; Dev: none; external to migrations/catalog.
- Production ALLOWED_EMAIL_DOMAINS: deferred to the final release checklist after Phase 5.
- `/api/invite` fail-open behavior when `ALLOWED_EMAIL_DOMAINS` is absent: deferred beside the Production domain step in the final release checklist after Phase 5.
- The Phase 4B gate is not a claim that the post-Phase-5 release checklist is complete.
