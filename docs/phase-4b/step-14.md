# Step 14: Hardening, cleanup, and Phase 4B gate

**Status:** Planned | **Branch:** `fix/hardening-gate` | **Reasoning level:** High for the privilege migration and final database gate; Medium for cleanup verification

## Goal

Close Phase 4B with privilege hardening, `/sandbox` cleanup, narrowly scoped documentation reconciliation, officer-cap enablement, and a Phase 4B gate modeled on Phase 4 Step 10. Inspect the real Dev and Prod grants, revoke the three excess privileges, tighten the Production email domain through the owner-performed Vercel step, enable the officer caps through a tracked migration before final release, verify Step 1's package/lint/root-script cleanup remains complete, and establish the authoritative Phase 4B catalog after Batch 13b.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 14 runs only after every preceding Phase 4B batch in the approved run order, including the Batch 7–13 implementation and test reruns plus all task, event, and activity dependencies; it remains the final gate before Phase 5.
- Remove effective `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `authenticated` on `events`, `tasks`, `notifications`, and `activity_log` by revoking each privilege from its confirmed direct, inherited, or `PUBLIC` grant source.
- Tighten the Production email-domain setting; clean up docs and `/sandbox`; verify Step 1's package/lint/root-script cleanup remains complete; enable officer caps; and update catalog tests and Step 10 allowlists.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Create a new authoritative Phase 4B catalog test after Batch 13b and expand the Phase 4 Step 10 allowlists. Old exact Phase 4 counts remain historical.
- Phase 4B completion covers Batches 0 through 14. Batch 15 runs after Phase 5 and is not part of this gate.

### Owner clarifications for Step 14

- “Tighten the Prod email domain” means changing the **Production Vercel environment variable** `ALLOWED_EMAIL_DOMAINS` to `cvsu.edu.ph` only. It does **not** mean buying, configuring, or changing a custom website domain. The custom domain remains parked.
- The email-domain change is a manual owner step, not code or a database migration.
- `/sandbox` cleanup removes `src/app/sandbox/page.tsx` and `src/components/tasks/drive-preview-demo.tsx`, but only after a repository search proves nothing else imports the demo component.
- Docs cleanup is limited to reconciling Phase 4B landing status, removing stale `/sandbox`/package/lint/domain items, and updating database and catalog references. Do not invent a broader rewrite.
- Enable `public.app_settings.enforce_officer_role_caps` through a new tracked migration before final release. Do not mutate the setting ad hoc in either dashboard.

## Current state

- The tracked migrations do not contain a later explicit revocation of the three targeted table privileges. The sandbox cannot inspect either remote database, so tracked SQL alone cannot prove today’s effective Dev or Prod grants.
- The Phase 4 10A catalog query reports effective authenticated table privileges, but its exact counts and function/policy allowlists predate all Phase 4B batches.
- `ALLOWED_EMAIL_DOMAINS` is read by application auth/invite boundaries. Dev intentionally allows test domains; Production is intended to become university-domain-only. Vercel environment changes require a fresh Production deployment.
- A custom website domain and Resend remain separately parked in `docs/PHASE-4B-PLAN.md`; neither is part of this batch.
- `/sandbox` is development-only and currently imports `DrivePreviewDemo`. Real task work-link preview is already implemented on task pages.
- Step 1 owns removal of the unused external `cn`/`p` packages, its exact three lint warnings, and the development-only root-layout script warning. Step 14 only verifies those fixes remain present and lint still reports zero warnings.
- Phase 4’s catalog counts, writer inventories, policies, and allowlists are historical baselines. Batches 7–13 add or replace security boundaries and must be represented in a new current catalog after Batch 13b.

## Scope: in / out

**In:** read-only privilege and grant-source preflight queries run separately on Dev and Prod; tracked least-privilege and cap-enablement migrations; exact post-migration assertions; Production-only `ALLOWED_EMAIL_DOMAINS=cvsu.edu.ph` Vercel change and redeploy; removal of the sandbox route/demo after reference verification; verification that Step 1's packages and four warning sources remain gone; limited docs reconciliation; new authoritative Phase 4B catalog test; expanded Step 10 allowlists; SQL/app/manual regression sessions; final gate ledger.

**Out:** any Supabase remote write by Codex; changing Dev’s allowed testing domains; a custom website domain; Resend; Phase 5 notifications/Discord/Executive Dashboard; Batch 15 dependencies v2; unrelated package upgrades; broad refactors; additional docs cleanup not named above; deleting real data; rewriting applied migrations; claiming Dev/Prod completion without owner evidence.

## Read-only grant preflight for the owner

Run this read-only effective-privilege query once in the Dev SQL Editor and once in the Prod SQL Editor before writing or applying the Batch 14 migration. Save both four-row results with the environment name. The direct-grant column is only the grant made to `authenticated`; the effective column can also include privileges supplied by `PUBLIC`, membership in another role, or ownership.

```sql
with target_tables(table_name) as (
  values ('events'), ('tasks'), ('notifications'), ('activity_log')
)
select
  format('public.%I', class_row.relname) as table_name,
  coalesce((
    select string_agg(grant_row.privilege_type, ', ' order by grant_row.privilege_type)
    from information_schema.role_table_grants grant_row
    where grant_row.table_schema = 'public'
      and grant_row.table_name = class_row.relname
      and grant_row.grantee = 'authenticated'
  ), 'NONE') as authenticated_direct_grants,
  nullif(concat_ws(', ',
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'SELECT') then 'SELECT' end,
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'INSERT') then 'INSERT' end,
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'UPDATE') then 'UPDATE' end,
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'DELETE') then 'DELETE' end,
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'TRUNCATE') then 'TRUNCATE' end,
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'REFERENCES') then 'REFERENCES' end,
    case when pg_catalog.has_table_privilege('authenticated', class_row.oid, 'TRIGGER') then 'TRIGGER' end
  ), '') as authenticated_effective_privileges
from pg_catalog.pg_class class_row
join target_tables target on target.table_name = class_row.relname
where class_row.relnamespace = 'public'::regnamespace
  and class_row.relkind in ('r', 'p')
order by class_row.relname;
```

This query changes nothing. Do not use it to infer RLS behavior: table privileges and row policies are separate layers. Whenever an unwanted effective privilege is absent from `authenticated_direct_grants`, run this second read-only inspection before choosing a revoke:

```sql
with target_tables(table_name) as (
  values ('events'), ('tasks'), ('notifications'), ('activity_log')
), applicable_acl as (
  select
    class_row.oid,
    class_row.relname,
    class_row.relowner,
    acl_row.grantor,
    acl_row.grantee,
    acl_row.privilege_type,
    acl_row.is_grantable
  from pg_catalog.pg_class class_row
  join target_tables target on target.table_name = class_row.relname
  cross join lateral pg_catalog.aclexplode(
    coalesce(class_row.relacl, pg_catalog.acldefault('r', class_row.relowner))
  ) acl_row
  where class_row.relnamespace = 'public'::regnamespace
    and class_row.relkind in ('r', 'p')
)
select
  format('public.%I', applicable_acl.relname) as table_name,
  applicable_acl.privilege_type,
  case
    when applicable_acl.grantee = 0 then 'PUBLIC'
    else grantee_role.rolname
  end as grant_source,
  case
    when applicable_acl.grantee = 0 then 'PUBLIC'
    when applicable_acl.grantee = 'authenticated'::regrole::oid then 'authenticated direct'
    else 'role inherited by authenticated'
  end as source_kind,
  grantor_role.rolname as granted_by,
  applicable_acl.is_grantable
from applicable_acl
left join pg_catalog.pg_roles grantee_role on grantee_role.oid = applicable_acl.grantee
left join pg_catalog.pg_roles grantor_role on grantor_role.oid = applicable_acl.grantor
where applicable_acl.grantee = 0
   or applicable_acl.grantee = 'authenticated'::regrole::oid
   or (
     applicable_acl.grantee <> 0
     and pg_catalog.pg_has_role('authenticated', applicable_acl.grantee, 'USAGE')
   )
order by applicable_acl.relname, applicable_acl.privilege_type, grant_source;
```

Save the granting role, grantor, and whether the source is `PUBLIC`, direct, or inherited. If the effective result still has no matching ACL row, inspect the table owner and the usable membership path to that owner read-only and record it before proceeding. Do not guess, revoke from an unrelated role, or design the migration until the source is known.

Classify every targeted effective privilege before writing the migration. A direct `authenticated` source may be revoked from `authenticated`. An inherited source requires a read-only dependency inspection of the identified granting role and a source-role revoke reviewed for every role that can use it; do not revoke only from `authenticated`, because that leaves the inherited privilege effective. A `PUBLIC` source requires a read-only report enumerating roles that currently receive the target privilege solely through `PUBLIC`; proceed with a `PUBLIC` revoke only when the owner confirms that no approved role depends on it. If any source or dependency remains unresolved, stop before creating the migration.

## Database impact

After reviewing both preflight results, add one tracked migration that revokes only `TRUNCATE`, `REFERENCES`, and `TRIGGER` on the four named tables, with each `REVOKE` aimed at its confirmed source. Revoke a direct grant from `authenticated`; revoke an inherited grant from the identified source role only after its dependency review; revoke from `PUBLIC` only after the saved dependency report proves no approved role relies solely on that grant. If all present target privileges are confirmed direct, the migration may contain only the `authenticated` revokes. Do not edit earlier migrations and do not revoke ordinary DML privileges required by existing RLS-backed application paths unless a separately approved reader/writer migration already removed them.

The same Batch 14 migration, or a separate ordered Batch 14 migration if review is clearer, updates the singleton `public.app_settings.enforce_officer_role_caps` value from false to true. It must affect exactly one setting row and assert the final true value. It does not update any user, pending invite, role, committee, or active state. Existing over-limit accounts remain valid; the already-tested Step 8 officer functions block only new invites, appointments, and activations beyond the enabled caps.

The migration must assert before commit that all 12 targeted effective privilege checks for `authenticated` are false, that RLS remains enabled, and that the expected application privileges/policies/functions/triggers remain present. It must also assert the reviewed source-specific outcome and preserve every approved dependent role identified by preflight. Do not broaden the target table, privilege, or source-role list silently.

No remote command is part of implementation by Codex. The owner reviews the migration line by line, applies it to Dev, runs the Batch 14 SQL/gate tests, completes the app checklist, merges, then applies it to Prod under the established run order.

## Production `ALLOWED_EMAIL_DOMAINS` owner step

This is a Production Vercel setting change, not source code and not a custom-domain task:

1. In Vercel, open the CEIT Connect project, then **Settings → Environment Variables**.
2. Edit `ALLOWED_EMAIL_DOMAINS` for the **Production** environment only so its complete value is `cvsu.edu.ph`.
3. Save the variable and trigger a fresh Production redeploy; an already-built deployment does not receive the new value.
4. After deployment, verify a `cvsu.edu.ph` invitation reaches the established authorization checks and a non-university domain is rejected with the existing generic safe error.
5. Do not change Dev’s testing-domain configuration. Do not configure a custom website domain or Resend in this batch.

Never print, copy into docs, or commit any other environment variable value or secret. Record only the owner-confirmed setting name, environment, expected domain, redeploy, and verification status.

## Repository and docs cleanup

- Search the repository for `DrivePreviewDemo`, `drive-preview-demo`, and `/sandbox`. Remove `src/app/sandbox/page.tsx` and `src/components/tasks/drive-preview-demo.tsx` only after confirming the component has no other importer. Preserve the production `DrivePreview` component and all real task-page work-link behavior.
- Verify `cn` and `p` remain absent from `package.json` and `package-lock.json`, no source imports either external package, and the local `@/lib/utils` `cn()` helper remains intact.
- Verify Step 1's two auth navigation fixes, unused middleware-binding fix, and supported root-layout theme bootstrap remain in place; rerun sign-in, password-reset, back-button, session-refresh, theme-flash, and hydration checks rather than reimplementing them.
- Docs cleanup is limited to:
  - reconciling each actually landed Phase 4B batch status without claiming unconfirmed Dev/Prod application;
  - removing stale `/sandbox`, `cn`, `p`, three-warning, and Production email-domain open items after each is verified;
  - updating `docs/DATABASE.md` for the final grants, functions, policies, triggers, and authoritative inventories;
  - expanding Phase 4 Step 10 allowlists/catalog references and adding the final Phase 4B gate evidence;
  - reconciling the stale Drive-preview demo/test wording at `docs/PHASE-3-PLAN.md:58` after `/sandbox` is removed, while preserving Phase 3 as historical completed work;
  - correcting the volunteer-accept authorization summary at `docs/ARCHITECTURE.md:60` against the final live rule; this mismatch is intentionally recorded here rather than edited before Batch 14;
  - verify (a) whether deactivation invalidates all usable sessions and (b) whether the effective non-Draft `events_select` policy denies inactive callers; if either is unmet, Batch 14 schedules a tracked policy fix and a regression test rather than documentation alone;
  - preserving the parked custom domain, Resend, backup, calendar, and Realtime items unless the owner separately changes them.

Any other stale, contradictory, or desirable documentation cleanup discovered during the batch is listed for the owner and is not edited without approval.

## New authoritative Phase 4B catalog test

Create `docs/phase-4b/step-14-tests.md` after Batch 13b has landed and before declaring the gate complete. Its first paste is the new authoritative live Dev catalog inventory. It supersedes Phase 4’s exact *current-state* counts while keeping every Phase 4 result as historical evidence.

The catalog paste inventories and pins, at minimum:

- every Phase 4B function name/signature, owner, volatility, security mode, `search_path`, execute grant, and absence of overloads;
- tables, columns, constraints, indexes, RLS enablement, policies, trigger functions, attached trigger timing/order/enablement, and child-table boundaries added or replaced through Batch 13b;
- the exact current direct-task-writer set, postgres-owner-branch writer set, owner-branch column union, reset/helper callers, and completed-phase normal-writer block list;
- activity-log raw-SELECT revocation and the fixed-shape reader grant;
- event/task parent immutability, archive/event deletion behavior, anonymization/account guards, `app_settings` denial, enabled role caps, and every new deny-by-default child table;
- `event_storage_cleanup_jobs`: its exact columns, fixed status/attempt/timestamp and unique banner-object constraints, RLS state, policies, grants, service-only writers, cleanup functions, and zero access for `anon` or `authenticated`; include its pending/failed counts without exposing stored errors;
- proof that event-banner cleanup uses the Storage API rather than SQL writes to `storage.objects`, and that deletion produces one idempotent cleanup job per banner object;
- effective table grants, including explicit false assertions for `TRUNCATE`, `REFERENCES`, and `TRIGGER` on the four Batch 14 targets;
- zero unexpected service-role use in ordinary task, activity, account, or event flows.

Expand the allowlists in `docs/PHASE-4-STEP-10-TESTS.md` and the reviewed-object inventory in `docs/phase-4/step-10-database-review.md` to recognize every approved Phase 4B object through Batch 13b plus the Batch 14 privilege state. Do not overwrite the recorded Phase 4 `57 / 8 / 11 / 20 / 0` result; label it historical and record new Phase 4B counts only from the live Dev catalog output after the owner runs it.

## Phase 4B regression gate

Follow the Phase 4 Step 10 pattern: focused static/database review, independent rollback-safe SQL pastes on Dev, grouped earlier-suite re-runs, a three-role app review, command checks, and one final acceptance ledger. Each SQL paste ends in the required intentional `TEST RESULTS` exception. Tests run as impersonated users where authorization matters; owner-role catalog queries do not prove RLS.

### Gate A — database and application review

- Review every Phase 4B RPC, RLS policy, direct grant, service-role route, trigger exemption, task/event/child guard, confidentiality projection, lock order, affected-row check, paging cursor, and current-role/`is_active` check through Batch 13b.
- Review the event-cleanup job catalog, its same-transaction creation by `delete_event()`, service-only state changes, idempotent unique object key, sanitized errors, Admin retry boundary, and denial to browser roles.
- Verify no page relies only on layout authorization and no service-role route trusts client roles, ids, emails, committees, creators, state, counts, or previews.
- Verify Archived freezes, task `event_id` immutability, Active-event task preservation, total-event capacity, completed-phase freeze, enabled role caps, anonymization permanence, Draft scope, activity masking, and event deletion history behavior together.
- Confirm Batch 14 removes only the approved sandbox files and verifies Step 1's package/warning cleanup while preserving real Drive preview, auth, middleware refresh, theme bootstrap, and navigation behavior.
- Confirm the two deferred documentation mismatches are corrected in Batch 14 only after their final implementation sources are rechecked.

### Gate B — earlier Phase 4 test documents to re-run after Batches 7–13

Use the current files, with catalog/writer assertions updated where later approved batches supersede them. Do not copy their SQL into the gate document.

| Phase 4 test document | Why it is in the Phase 4B gate |
| --- | --- |
| `docs/PHASE-4-STEP-1A-TESTS.md` | Batches 7–12 touch active-account guards, raw task access assumptions, and activity-log reads. Re-run direct SELECT/write, inactive/profile-less, and activity boundaries. |
| `docs/PHASE-4-STEP-1-TESTS.md` | Batches 11, 13d, and 13b touch task writers, event deletion/lifecycle, archive serialization, and the Active-event task invariant. |
| `docs/PHASE-4-STEP-2-TESTS.md` | Batches 11, 12, 13c, and 13b touch board readers, Draft scope, masking, ordering, and phase presentation. |
| `docs/PHASE-4-STEP-3-TESTS.md` | Batches 11–13c touch task detail shape, edit capability, Member history, current access, Draft behavior, and completed-phase read-only state. |
| `docs/PHASE-4-STEP-4-TESTS.md` | Account/access changes and Batch 13b must not weaken real-access work-link readers or Archived child freezes. |
| `docs/PHASE-4-STEP-5A-TESTS.md` | Batch 11 task creation/editing and Batch 13b add guards around metadata, lane order, dependencies, parent immutability, and writer locks. |
| `docs/PHASE-4-STEP-5B-TESTS.md` | Batches 11, 12, 13, and 13b affect writer catalogs, updated-at/activity semantics, moves, dependencies, ordering, and completed-phase denial. |
| `docs/PHASE-4-STEP-6-TESTS.md` | Mobile/desktop board changes plus completed-phase behavior must preserve move authorization, masking, polling, Undo, and order. |
| `docs/PHASE-4-STEP-7-TESTS.md` | Batches 11, 13, 13c, and 13b touch writer allowlists, dependency/confidentiality controls, pickers, Draft visibility, and phase freeze. |
| `docs/PHASE-4-STEP-7A-TESTS.md` | Batches 10, 11, 13, and 13b touch preserved UUIDs, assignment/deletion/self-leave rules, exact writers, Backlog reset, and final-task protection. |
| `docs/PHASE-4-STEP-7B-TESTS.md` | Batches 10, 12, 13d, and 13b must preserve archive-only access/history, anonymized identities, and every Archived write denial. |
| `docs/PHASE-4-STEP-8-TESTS.md` | Batches 10, 11, 13, and 13b change current writer inventory, picker/volunteer/leave rules, assignment state, and completed-phase writes. This is the pre-4B authoritative writer suite and must be updated to the new inventory. |
| `docs/PHASE-4-STEP-9-TESTS.md` | Batches 10, 12, 13d, and 13b affect identity display, current-access parity, event deletion cascades/history, and completed-phase comment freeze. |
| `docs/PHASE-4-STEP-9A-TESTS.md` | Batches 10, 11, 13, 13c, and 13b can change assignment membership, task visibility, status, and feed paging without admitting Draft/Archived rows. |
| `docs/PHASE-4-STEP-10-TESTS.md` | Expand all current allowlists/counts and rerun 10B–10D equivalents for raw access, cross-feature/archive races, large results, paging, capacities, and invariants. |

The new Step 14 test document groups these into reviewable sessions, records expected result-line counts from current source, notes any intentionally historical/superseded assertion, and requires every current assertion to pass on Dev. It also references every Phase 4B Batch 7–13 test document and runs their current independent suites before the final ledger.

### Gate C — manual app review

- Active Admin: accounts/officer/removal flows; Active-board Add/Edit; whole activity log; task rules; Draft visibility; event deletion; completed-phase/reopen behavior; and every cleanup regression.
- Active Co-Admin: own-committee user/task authority, whole but masked activity log, own/other committee boundaries, Draft visibility after Batch 13c, leave/volunteer rules, and completed-phase permissions.
- Member: login/callback protections, task shell/real access, current-assignee-only history, leave/request rules, comments/work links, My Tasks, mobile board, and completed-phase read-only access.
- Inactive, profile-less, anonymized, wrong-domain, stale-role, and direct-request negative cases remain part of their owning batch suites and the final security spot-check.

### Gate D — commands and final ledger

Run the repository’s complete automated tests, production build, and lint after implementation. The final ledger records exact command results and requires zero lint warnings. This command requirement belongs to the future implementation batch; creating this planning document does not run those commands.

The final ledger separately records: catalog paste; privilege preflight and post-migration state on Dev; cap-setting migration and enabled-state verification; all Phase 4 and Phase 4B SQL sessions; three-role manual review; Step 1 cleanup verification and sandbox cleanup; Production `ALLOWED_EMAIL_DOMAINS` owner confirmation and redeploy; Prod migration owner confirmation; and command results. A missing manual Production setting or unconfirmed Prod migration is not reported as complete.

## Guards that must remain true

- The Batch 14 migration changes only the three named privileges on the four named tables and aims each revoke at the proven direct, inherited, or `PUBLIC` grant source. A `PUBLIC` revoke requires saved proof that no approved role depends solely on it; all 12 effective checks for `authenticated` must be false afterward.
- RLS, fixed-shape RPCs, table DML grants required by existing flows, and trigger execution remain functional after privilege revocation.
- `activity_log` remains immutable and readable only through the Batch 12 safe boundary.
- Archived events/tasks/children remain frozen; Draft and Active deletion rules remain as approved; activity history preserves task UUIDs after Batch 13d.
- Every Active event retains at least one task; task parentage and creator provenance remain immutable; the event total stays at or below 200.
- Completed phases block every normal writer added through Batch 13b, including Batch 11 Add/Edit, with only the approved reopen path.
- Production accepts only `cvsu.edu.ph` through `ALLOWED_EMAIL_DOMAINS`; Dev’s test-domain setting is unchanged. No custom website domain work occurs.
- Removing `/sandbox` does not remove or alter the real Drive preview component.
- Step 1 package/lint/root-script fixes remain complete and do not introduce unrelated dependency, auth, navigation, middleware, or theme changes.
- `public.app_settings.enforce_officer_role_caps` is true before final release; existing over-limit accounts, if any, are not rewritten, while new invites, appointments, and activations obey the caps.
- Historical Phase 4 counts/results remain labeled historical; the new Phase 4B catalog is authoritative only after the owner runs it on Dev.

## Security risks

- The sandbox cannot see remote grants. Designing revocations from migration text alone may miss inherited privileges or environment drift; the owner’s read-only preflight is mandatory.
- `REVOKE` from the wrong role or broad table set can either leave an inherited privilege effective or break legitimate application paths. Match every revoke to its recorded source, inventory inherited-role consumers, and never revoke `PUBLIC` without proving no approved role relies solely on it.
- Vercel environment values are deployment-specific. Editing Preview/Development or failing to redeploy would leave Production unchanged; printing other values could expose secrets.
- Treating `ALLOWED_EMAIL_DOMAINS` as a custom website-domain task would mix unrelated parked scope and fail to tighten invite/auth validation.
- Deleting the shared Drive preview instead of the demo-only component would break real task work links. Verify imports first.
- Broad package upgrades during removal create an unauditable diff. Remove only `cn` and `p`.
- Updating allowlists by merely accepting every observed object can bless an unauthorized function, policy, trigger, grant, or writer. Reconcile each object to an approved Batch 0–13 document.
- Tests run as the SQL Editor owner bypass RLS. Authorization gates still require impersonated callers and direct attack cases.
- Marking the gate complete from local commands alone would omit Dev SQL, three-role app, Production setting, and Prod migration evidence.

## Test deliverable

Create `docs/phase-4b/step-14-tests.md` after Batch 13b. It contains:

- the new authoritative Phase 4B catalog paste and expected live result sets, including `event_storage_cleanup_jobs` and its access boundary;
- exact effective-privilege, usable grant-source, inherited-role dependency, and any required `PUBLIC`-dependency checks before/after the Batch 14 migration;
- grouped re-run ledgers for every Phase 4 document listed above and every Phase 4B Batch 7–13 suite;
- new cross-batch tests for account/role changes against task access, Add/Edit against capacity/archive/completed phases, activity masking after assignment/role/event deletion, Draft expansion, anonymized historical actors, and final writer/guard allowlists;
- large-result and keyset paging coverage for Users, Home/Archives/Workspace, activity, comments, and pending requests as applicable;
- the three-role manual checklist, negative-account checklist, cleanup checklist, Production environment checklist, and final acceptance ledger.

Every SQL paste is independently rollback-safe on Dev and ends with the intentional `TEST RESULTS` exception. Prod receives only the owner-reviewed migration and read-only catalog/grant verification; destructive fixtures and impersonated regression suites stay on Dev.

## Manual checklist

- Run and save the read-only effective-privilege query on Dev and Prod before implementation. For every effective privilege, save its usable grant source; for inherited sources save the source-role dependency inspection, and for `PUBLIC` save proof that no approved role depends solely on it before approving that revoke.
- After the owner applies the migration to Dev, rerun the grant query and confirm all targeted effective privileges are absent on all four tables while approved application flows still work.
- Complete every Gate B session and the Admin/Co-Admin/Member review; record evidence and dates rather than checking items from earlier historical runs.
- Search imports, then confirm `/sandbox` returns 404 because the route is removed while real task Drive previews still work.
- Confirm `cn` and `p` are absent from both manifest and lockfile and that no unrelated dependency version changed.
- Exercise both fixed auth navigation flows, normal session refresh, and theme bootstrap after Step 1; confirm lint still reports zero warnings.
- Confirm `public.app_settings.enforce_officer_role_caps` is true after the Dev migration, existing accounts are unchanged, and Step 8's caps-on invite/appointment/activation checks still pass before final release.
- Confirm the cleanup-job catalog has one idempotent row per deleted banner object, no `anon`/`authenticated` access, sanitized failure text, accurate pending/failed counts, and successful Admin retry through the Storage API.
- Have the owner set Production `ALLOWED_EMAIL_DOMAINS` to exactly `cvsu.edu.ph`, redeploy, and verify allowed/rejected invite domains. Confirm Dev still permits its approved test domains.
- Confirm no custom website domain or Resend work appears in code, settings instructions, or completion claims.
- After merge, have the owner apply the migration to Prod, rerun the read-only query there, and record confirmation. Do not run the Dev regression fixtures on Prod.

## Acceptance

The owner's before/after evidence proves that `authenticated` lacks effective `TRUNCATE`, `REFERENCES`, and `TRIGGER` on `events`, `tasks`, `notifications`, and `activity_log` in both environments while all approved application paths remain intact. Production's Vercel `ALLOWED_EMAIL_DOMAINS` is exactly `cvsu.edu.ph` after redeploy, without custom-domain work. The obsolete sandbox/demo are gone; Step 1's package, lint, navigation, middleware, and root-script fixes remain verified; lint has zero warnings; and officer caps are enabled through the tracked setting migration before final release. Documentation is reconciled only within scope. The post-13b Phase 4B catalog and expanded Step 10 allowlists are current, every required regression/manual check passes on Dev, and no Dev/Prod completion is claimed without owner confirmation.

## Open questions for the owner

None. Any newly discovered cleanup candidate outside the approved scope is listed for separate owner approval rather than changed.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only from verified implementation and owner-provided Dev/Prod evidence.
- Add `docs/phase-4b/step-14-tests.md` as the authoritative Phase 4B catalog and gate ledger after Batch 13b.
- Update `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/phase-4/step-10-database-review.md`, `docs/PHASE-4-STEP-10-TESTS.md`, and `docs/PHASE-4-STEP-10E-GATE.md` only for the approved final objects, grants, allowlists, supersession notes, and gate evidence.
- Remove only verified stale `/sandbox`, Step 1 cleanup, cap-enablement, and Production `ALLOWED_EMAIL_DOMAINS` open items. Keep the custom website domain and other parked items.
