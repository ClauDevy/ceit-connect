# Step 10: Remove former member

**Status:** Stage A passed on Dev; Stage B Phases 1 and 1b applied/implemented; Phase 2 and its UX follow-up implemented locally with manual verification pending | **Branch:** `feature/member-removal` | **Reasoning level:** High (security-critical migrations and tests)

## Goal

Let an active Admin remove up to 50 eligible deactivated former members per run without deleting any account or history. Removal always anonymizes the existing UUID, permanently blocks reactivation, bans login, replaces Auth and profile email with a deterministic unique non-routable value, sets the name to `Former member`, clears the avatar URL, removes the Storage avatar object, preserves comments and historical references, skips users assigned to open Draft/Active tasks, and reports deterministic per-user outcomes across non-transactional Auth, database, and Storage work.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Decisions (made by the owner): Deleting

- Remove former member is Admin-only and applies only to deactivated accounts.
- The account is always anonymized, never deleted: keep the same UUID and `is_active = false`, ban login, replace Auth and profile email with a unique non-routable value, set the name to `Former member`, clear the avatar, and remove its Storage object.
- Comments stay, and anonymized accounts cannot be reactivated.
- Support bulk selection, select all visible results only, preview, typed confirmation, result report, and about 50 accounts per run. Users with open tasks are skipped.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Batch 10 is security-critical.
- Users are never deleted or hard-deleted. Golden rule 9 does not change.
- Event deletion is a separate Batch 13d concern.

### Owner clarifications for Step 10

- The batch maximum is exactly 50 selected accounts per run.
- Add nullable `anonymized_at` as the permanent marker. An anonymized account can never be reactivated.
- Replace or extend Batch 9's shared `reactivate_committee_member(uuid)` boundary so it rejects every non-null `anonymized_at`, then re-run the conditional `ANONYMIZED_CASE` in `docs/phase-4b/step-9-tests.md`. Batch 9 deliberately neither adds nor references the marker.
- An open task is a `To Do` or `In Progress` task in a Draft or Active event where the user appears in `primary_assignees` or `assist_assignees`.
- Archived tasks do not block removal because they are frozen and could never be closed; retaining those UUID references preserves their history.
- Cross-service work is not atomic. Use deterministic, idempotent per-user retries and report each user as `removed`, `skipped`, `failed`, or `cleanup-pending`.
- Typed confirmation is exactly `REMOVE <count> MEMBERS`, using the authoritative selected count.

## Current state

- `public.users.id` equals `auth.users.id` and currently has no anonymization marker. Deactivation sets `is_active = false`, clears `avatar_url`, and attempts to remove `avatars/<user_id>/avatar.webp`.
- `/api/toggle-user-active` can currently reactivate any non-self target that reaches its active-Admin route. It has no `anonymized_at` check.
- The callback and other login guards reject inactive profiles at application boundaries, but the Auth account is not banned and its Auth email is not anonymized by ordinary deactivation.
- The service-role helper exists only in server code. Supabase Auth’s Admin update API can change an Auth email directly and set a ban duration; it must never be called from a client component.
- User UUIDs live in more places than foreign keys. Keeping the UUID is therefore the history-preserving design, not an intermediate compromise.

Full UUID inventory to preserve:

- `auth.users.id` and `public.users.id` are the identity pair.
- `events.created_by` is a non-null foreign key to `users`.
- `tasks.created_by` is a non-null foreign key; `primary_assignees`, `assist_assignees`, and `allowed_viewers` are UUID arrays without foreign keys.
- `task_comments.created_by` is a non-null foreign key and `mentioned_user_ids` is a UUID array without foreign keys. Comment rows and bodies stay.
- `task_volunteers.user_id` is a foreign key. Pending rows are filtered from readers when the user is inactive; they are not a reason to delete the identity.
- `archived_task_viewers.user_id` and `granted_by` are foreign keys. Archived access history stays tied to the UUID.
- `task_work_links.created_by` is a nullable foreign key used for provenance.
- `notifications.user_id` is a foreign key. Existing notification rows remain private and inaccessible to the inactive account.
- `activity_log.user_id` is a nullable foreign key, and `activity_log.changes` stores immutable task snapshots that may contain `created_by`, assignee arrays, and viewer arrays. Snapshots are not rewritten.
- The public `avatars` bucket stores the profile object at `<user_id>/avatar.webp`; the database URL and object must both be removed.

## Scope: in / out

**In:** Admin-only Deactivated-tab selection; select all visible results only; maximum 50 selected UUIDs; server preview; typed confirmation; authoritative eligibility re-check; deterministic anonymized email; `anonymized_at`; permanent reactivation denial; Auth email update and login ban through a server-only service-role route; profile name/email/avatar anonymization; Storage avatar deletion; open-task skip rule; per-user result report; retry of partially completed users.

**Out:** any hard delete of Auth or profile rows; rewriting UUID references, comments, immutable activity snapshots, Archived tasks, or historical creator/grantor fields; treating Archived task assignments as blockers; deleting events; Batch 13d event deletion; changing golden rule 9; promising a transaction across Auth, Postgres, and Storage.

## Database impact

Add a new tracked security-critical migration that adds `users.anonymized_at timestamptz null`, narrows reactivation so `anonymized_at is null` is mandatory, and adds fixed-search-path Admin-only functions for preview/eligibility and the database anonymization step. Do not edit any applied migration.

The database operation must derive an active Admin caller, reject self-removal and all Admin targets, and coordinate with every assignee-array writer through one shared per-user transaction-level advisory lock namespace. Collect all affected unique user ids, sort them by UUID, and take every per-user lock in that order before any task or event row lock; a writer assigning several people locks all of them first. Removal takes the target user's lock before locking or checking any task/event row, then locks and re-reads the target, requires `is_active = false`, checks `anonymized_at`, and re-checks open assignments. Before first anonymization it rejects a target when any Draft/Active event has a task in `To Do` or `In Progress` with the target UUID in either assignee array. Archived assignments deliberately remain and do not block.

Every current or future writer that can change `primary_assignees` or `assist_assignees` follows the same order: sorted per-user advisory locks first, then the established event lock, task lock, and child locks. This includes Create/Edit Event task payloads, `assign_task_people`, `unassign_self`, claim, volunteer acceptance, Batch 11 Add/Edit Task, and Batch 13 auto-helper and leave-request approval writers. A serializable transaction with bounded retry is acceptable only if implementation proves it provides the same assignment-versus-removal exclusion and documents the retry contract; mixing strategies or taking user locks after rows is forbidden.

Batch 13 final allowlist: the assignment-array marker names remain `accept_task_volunteer`, `assign_task_people`, `claim_task`, `create_active_event_task`, `create_event_with_tasks`, `edit_active_event_task`, `edit_event_with_tasks`, and `unassign_self`. `resolve_task_leave_request` and officer `volunteer_for_task` first take the affected sorted user locks, then delegate the physical array write to `assign_task_people`; they are indirect writers, not new marker names. The final Create/Edit Event order is user locks → existing event row for edit → creator-cap lock → existing event advisory/task locks. The wrapper-backed, ungranted `*_step12` implementations remain internal; the fully replaced and unused `accept_task_volunteer_step12(uuid,uuid)` is dropped.

Batch 13 leave approval follows user locks → Active event `FOR SHARE` → dependency advisory lock → task `FOR UPDATE` → request row. `accept_task_volunteer` keeps its Step 10 user → event → task → child-row order and deletes the selected locked offer before the guarded task-array update. Missing assignment/self-assignment GUCs are normalized to empty strings before every trust or exception comparison.

For an eligible first attempt, use a deterministic unique address derived from the immutable UUID, such as `<uuid>@former.invalid`; `.invalid` is non-routable and the UUID makes it unique. In one database transaction set profile email to that value, `full_name = 'Former member'`, `avatar_url = null`, `is_active = false`, and `anonymized_at` to the server timestamp. Leave role, committee, UUID, comments, arrays, foreign keys, notifications, volunteers, archived viewers, work-link provenance, and activity snapshots intact unless a later owner decision explicitly says otherwise.

The server route then uses `createServiceRoleClient()` to update the same Auth user to the deterministic email and ban login. It finally removes `avatars/<uuid>/avatar.webp`. It must re-verify the caller as an active Admin before any service-role call and validate every UUID/result at runtime.

Because these systems cannot share a transaction, retries inspect current profile, Auth, and Storage state. An already marked profile is not “reactivated” or anonymized again; it is eligible only for completion of the same deterministic Auth/Storage cleanup. Database-first anonymization ensures application PII is removed and RLS access stays inactive even if Auth update fails. Auth failure reports `failed`; Storage failure after Auth/database success reports `cleanup-pending`; a retry resumes idempotently.

## Guards that must remain true

- Golden rule 9 remains unchanged: users are never deleted, only deactivated; former-member removal is anonymization, not deletion.
- An anonymized account can never be reactivated. Every Admin and Co-Admin activation route/RPC must reject non-null `anonymized_at`, and raw writes must not bypass that rule.
- Only an active Admin may preview, confirm, or run removal. Co-Admins and Members cannot remove anyone.
- Only deactivated, non-Admin targets are eligible. Admin-to-Admin protection and the last-active-Admin invariant remain defense in depth even though an active Admin is already ineligible.
- Accept 1–50 unique UUIDs. “Select all” means only the currently visible filtered results, never unseen pages or the entire database.
- Preview is not authorization. Re-lock and re-check target state and open tasks during execution.
- Removal and all assignee-array writers take the same per-user advisory locks in sorted UUID order before every task/event row lock. Multi-person assignment locks the complete unique user set first; no writer may reverse or partially acquire that order.
- Open-task blocking uses only Draft/Active parents and `To Do`/`In Progress` status with membership in primary or assist assignees. Archived tasks remain frozen historical references and do not block forever.
- Keep the UUID everywhere. Do not remove comments, mentions, assignment arrays, viewers, volunteers, notifications, work-link provenance, archived shares, creator fields, or activity snapshots merely to hide identity.
- Replace both profile and Auth email with the same deterministic non-routable value, keep `is_active = false`, set the exact name `Former member`, clear `avatar_url`, ban Auth login, and remove the Storage avatar object.
- Check every database, Auth, and Storage result. A partial outcome must be visible and safely retryable.

## Security risks

- Auth Admin update and Storage deletion require service role and bypass RLS. The route must verify logged-in state, active Admin role, target eligibility, and confirmation before privileged work.
- A client-supplied preview, target status, task count, or anonymized email is untrusted. Derive all authoritative values server-side.
- Open-task checks against UUID arrays have no foreign-key help. Test both primary and assist arrays, both open statuses, and parent event lifecycle under the target lock/transaction.
- A race can assign a task after a stale preview. The shared per-user lock makes assignment and removal mutually exclusive; after waiting, both paths re-read target/anonymization/assignment state before writing. A missing writer, inconsistent lock key, partial multi-user lock set, or row-first lock order reopens the race or creates a deadlock.
- Auth, Postgres, and Storage cannot commit atomically. Hiding partial failures or retrying with a new email would strand accounts. Deterministic identity and explicit result states are mandatory.
- A ban alone does not retroactively invalidate an already issued access token. `is_active = false`, active-profile RLS/helpers, route guards, and the anonymized marker remain the immediate application boundary.
- Rewriting immutable activity snapshots would corrupt the audit trail. Their UUIDs are not personal-display fields and must remain unchanged.
- Leaving the public avatar object after a failed cleanup retains personal data. Report `cleanup-pending`, retry the fixed object path, and never report full success until removal is confirmed or the object is already absent.

## Stage B implementation notes

Stage B is split by an owner-required Dev gate. Phase 1 implements only the
strict route contracts, caller-session preview/removal orchestration,
service-role Auth/Storage cleanup, activation-route hardening, and automated
tests. No removal UI is built until the Google-linked re-invite gate below
passes and the owner explicitly approves continuing.

The new POST route follows the repository's existing same-origin cookie-auth
convention: browser callers use a relative `/api/...` URL (and therefore the
browser's normal same-origin cookie behavior), while the route calls
`getAuthUser()`, rechecks the active Admin profile through a caller-session
client, and relies on RPC/RLS authorization. The repository has no shared
explicit `Origin`, `Referer`, or `Sec-Fetch-Site` validator; Stage B does not
invent a different one for this route.

The route exports `maxDuration = 60` as a conservative deployment hint. This
does not assume or override any hosting plan's actual limit. A 50-user request
can therefore end without a complete response if the platform stops it. Work
is database-first and per UUID, so a retry of the same UUIDs is safe. The
implemented UI refreshes the Deactivated list after a request-level timeout,
keeps marked rows hidden by default, and lets the Admin reveal them as `Former
member` with a `Removed` badge and `Re-run cleanup`; that action reruns the same
database outcome, Auth/identity cleanup, and fixed-path Storage deletion.

Stage B Phase 2 is implemented locally. The Deactivated reader now enriches
only its already-authorized returned UUIDs with `anonymized_at` through the
caller session and fails the whole page closed on an incomplete or malformed
enrichment. Marked rows are hidden by default behind a client-only `Show
removed members` toggle available to Admins and Co-Admins; paging, the hidden
lookahead, loaded UUID identity, and Load more remain unchanged. Admins can
select at most 50 currently rendered non-Admin, non-terminal rows, while marked
rows, the hidden lookahead, and unloaded pages remain outside selection.
Single, bulk, row-retry, and incomplete-result retry paths
share the same authoritative preview and exact typed confirmation flow.
Preview requests abort after 20 seconds; removal requests abort after 65
seconds and report an unknown outcome rather than inventing per-user failures,
then refresh the Deactivated list. Tab and search changes immediately replace
stale rows and controls with shared roster skeletons, while the toggle itself
never requests or resets paging. Co-Admins can reveal terminal labels but
receive no removal, retry, reactivation, selection, or other profile-changing
controls for those rows. Manual browser verification remains pending.

The Phase 1 Auth Admin update changes only `email`, `email_confirm`, and
`ban_duration`. It sends no email. The owner-confirmed Google gate proved that
this leaves personal data in `auth.users.raw_user_meta_data`, provider data in
`raw_app_meta_data`, and the linked Google row in `auth.identities`. Google
sign-in with the original address then resolves to the old banned UUID and
blocks the re-invited user.

Phase 1b therefore keeps the Admin update as the email/confirmation/ban step,
then calls the service-role-only `cleanup_former_member_auth(uuid)` database
boundary before Storage cleanup. The installed `@supabase/auth-js` 2.116 API
supports `admin.updateUserById()` metadata updates, but `GoTrueAdminApi` has no
Admin identity-list or identity-delete method. Its only `unlinkIdentity()` is
a caller-session method: it requires the affected user to be signed in, manual
linking enabled, and at least two identities. It cannot safely clean another
user after that user is banned. A fixed-search-path `SECURITY DEFINER` function
is therefore the one approved mechanism.

The function deletes every non-email identity, canonicalizes zero or one email
identity without manufacturing a missing identity, clears user/app metadata,
phone and change-token state, sessions and refresh tokens, and optional MFA,
one-time-token, and OAuth flow-state rows. More than one email identity or a
provider-ID collision fails the whole statement atomically. It never changes
the Auth UUID, deterministic email, confirmed timestamp, password hash, ban,
or operational timestamps. `auth.audit_log_entries` is deliberately untouched
and is a known retained Auth audit record.

Auth success is accepted only when the Admin API returns the same UUID, the
deterministic `<uuid>@former.invalid` email, a confirmed-email timestamp, and a
future ban timestamp. If Auth fails or cannot prove that state after the DB
profile was anonymized, the item is `failed`, never `removed`, and reports that
the original email is not free yet. Identity cleanup failure after proven Auth
success is `cleanup-pending`, never `removed`; its safe message says the email
is free for re-invite but Google sign-in may still resolve to the old banned
account until cleanup finishes. Storage failure after proven Auth and identity
cleanup is `cleanup-pending`.

### Google-linked Dev gate (required before UI)

Prepare a throwaway Gmail controlled by the owner, invite it as a Dev Member,
sign in with Google once, confirm the Google identity in the Dev Auth dashboard,
then deactivate it. While signed in to the Dev application as an Admin, open
the browser console and paste this preview snippet:

```js
window.step10FormerMemberId = prompt("Paste the deactivated Member UUID")?.trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(window.step10FormerMemberId ?? "")) {
  throw new Error("A valid deactivated Member UUID is required.");
}
window.step10PreviewResponse = await fetch("/api/remove-former-members", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "preview",
    userIds: [window.step10FormerMemberId],
  }),
});
window.step10PreviewBody = await window.step10PreviewResponse.json();
console.log("Preview status:", window.step10PreviewResponse.status);
console.table(window.step10PreviewBody.users ?? []);
console.log(window.step10PreviewBody);
```

Confirm that the preview is HTTP 200, count 1, and the target is the intended
inactive non-Admin with `outcome: "eligible"`. Then paste the removal snippet:

```js
window.step10RemoveResponse = await fetch("/api/remove-former-members", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "remove",
    userIds: [window.step10FormerMemberId],
    confirmation: "REMOVE 1 MEMBERS",
  }),
});
window.step10RemoveBody = await window.step10RemoveResponse.json();
console.log("Removal status:", window.step10RemoveResponse.status);
console.table(window.step10RemoveBody.results ?? []);
console.log(window.step10RemoveBody);
```

The gate checklist is:

1. The removal response is HTTP 200 with the intended UUID and state `removed`.
2. `public.users` keeps that UUID and role/committee/history links; it has
   `Former member`, `<uuid>@former.invalid`, `is_active = false`, null avatar
   and Discord fields, and a non-null `anonymized_at`.
3. The old Auth row keeps the same UUID, has `<uuid>@former.invalid` as its
   confirmed email, the same password hash and operational timestamps, and a
   future ban timestamp. Its user metadata is empty and its app metadata names
   only the email provider.
4. `avatars/<uuid>/avatar.webp` is absent.
5. Direct reactivation returns the safe permanent-denial response and performs
   no Auth, profile, or Storage write.
6. Invite the original Gmail again through the normal Dev Member invitation
   flow and verify it receives a new Auth/profile UUID.
7. Sign in with Google using that Gmail. The new UUID must reach the app as the
   active Member; the old UUID must remain banned and anonymized.
8. Verify the old Auth row has no non-email identity, zero or one canonical
   email identity, no phone/change-token state, no sessions/refresh tokens, and
   no optional MFA, one-time-token, or flow-state rows.

### Phase 1b Dev catalog comparison (run before applying the migration)

(Historical: this gate ran and the migration is applied to Dev. Pending Prod push at the end of Batch 10.)

Run this read-only query in the Dev SQL editor and compare its output with
`20261027180000_former_member_auth_identity_cleanup.sql`. It reads
`pg_catalog.pg_attribute` rather than `information_schema.columns`, includes
generated-column status and types, and exposes the constraints needed to
confirm identity uniqueness and session/MFA deletion behavior. Do not apply the
migration until every referenced column and comparison type matches.

(Historical: this gate ran and the migration is applied to Dev. Pending Prod push at the end of Batch 10.)

The rollback-only 42-line function gate and its numbered expected output are
in `docs/phase-4b/step-10-phase-1b-tests.md`.

```sql
with inspected_tables(table_name) as (
  values
    ('users'),
    ('identities'),
    ('sessions'),
    ('refresh_tokens'),
    ('mfa_factors'),
    ('mfa_challenges'),
    ('mfa_amr_claims'),
    ('one_time_tokens'),
    ('flow_state'),
    ('audit_log_entries')
),
relations as (
  select
    inspected_tables.table_name,
    relation.oid as relation_id,
    relation.relkind
  from inspected_tables
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = 'auth'
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
   and relation.relname = inspected_tables.table_name
),
table_inventory as (
  select pg_catalog.jsonb_object_agg(
    relations.table_name,
    pg_catalog.jsonb_build_object(
      'present', relations.relation_id is not null,
      'relkind', relations.relkind
    )
    order by relations.table_name
  ) as value
  from relations
),
column_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'table', relations.table_name,
        'position', attribute.attnum,
        'column', attribute.attname,
        'data_type', pg_catalog.format_type(
          attribute.atttypid, attribute.atttypmod
        ),
        'not_null', attribute.attnotnull,
        'is_generated', attribute.attgenerated <> '',
        'generation_expression', case
          when attribute.attgenerated <> '' then
            pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
          else null
        end,
        'identity_kind', nullif(attribute.attidentity, '')
      )
      order by relations.table_name, attribute.attnum
    ),
    '[]'::jsonb
  ) as value
  from relations
  join pg_catalog.pg_attribute as attribute
    on attribute.attrelid = relations.relation_id
   and attribute.attnum > 0
   and not attribute.attisdropped
  left join pg_catalog.pg_attrdef as default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
),
constraint_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'table', relations.table_name,
        'name', constraint_row.conname,
        'type', constraint_row.contype,
        'definition', pg_catalog.pg_get_constraintdef(
          constraint_row.oid, true
        )
      )
      order by relations.table_name, constraint_row.conname
    ),
    '[]'::jsonb
  ) as value
  from relations
  join pg_catalog.pg_constraint as constraint_row
    on constraint_row.conrelid = relations.relation_id
),
index_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'table', relations.table_name,
        'name', index_relation.relname,
        'is_unique', index_row.indisunique,
        'definition', pg_catalog.pg_get_indexdef(index_row.indexrelid)
      )
      order by relations.table_name, index_relation.relname
    ),
    '[]'::jsonb
  ) as value
  from relations
  join pg_catalog.pg_index as index_row
    on index_row.indrelid = relations.relation_id
  join pg_catalog.pg_class as index_relation
    on index_relation.oid = index_row.indexrelid
),
identity_email as (
  select coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'present', true,
        'is_generated', attribute.attgenerated <> '',
        'generation_expression', case
          when attribute.attgenerated <> '' then
            pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
          else null
        end,
        'data_type', pg_catalog.format_type(
          attribute.atttypid, attribute.atttypmod
        )
      )
      from pg_catalog.pg_attribute as attribute
      left join pg_catalog.pg_attrdef as default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attrelid = pg_catalog.to_regclass('auth.identities')
        and attribute.attname = 'email'
        and attribute.attnum > 0
        and not attribute.attisdropped
    ),
    pg_catalog.jsonb_build_object(
      'present', false,
      'is_generated', false,
      'generation_expression', null,
      'data_type', null
    )
  ) as value
),
refresh_tokens_user_id as (
  select coalesce(
    (
      select pg_catalog.jsonb_build_object(
        'present', true,
        'data_type', pg_catalog.format_type(
          attribute.atttypid, attribute.atttypmod
        )
      )
      from pg_catalog.pg_attribute as attribute
      where attribute.attrelid = pg_catalog.to_regclass(
        'auth.refresh_tokens'
      )
        and attribute.attname = 'user_id'
        and attribute.attnum > 0
        and not attribute.attisdropped
    ),
    pg_catalog.jsonb_build_object(
      'present', false,
      'data_type', null
    )
  ) as value
),
trigger_inventory as (
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'table', relation.relname,
        'name', trigger_row.tgname,
        'enabled', trigger_row.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, true)
      )
      order by relation.relname, trigger_row.tgname
    ),
    '[]'::jsonb
  ) as value
  from pg_catalog.pg_namespace as namespace
  join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
  join pg_catalog.pg_trigger as trigger_row
    on trigger_row.tgrelid = relation.oid
   and not trigger_row.tgisinternal
  where namespace.nspname = 'auth'
    and relation.relname in (
      'users', 'identities', 'sessions', 'refresh_tokens'
    )
)
select pg_catalog.jsonb_build_object(
  'auth_role', pg_catalog.jsonb_build_object(
    'present', pg_catalog.to_regprocedure('auth.role()') is not null
  ),
  'identities_email', identity_email.value,
  'refresh_tokens_user_id', refresh_tokens_user_id.value,
  'tables', table_inventory.value,
  'columns', column_inventory.value,
  'constraints', constraint_inventory.value,
  'indexes', index_inventory.value,
  'non_internal_triggers', trigger_inventory.value
) as auth_catalog
from table_inventory
cross join column_inventory
cross join constraint_inventory
cross join index_inventory
cross join identity_email
cross join refresh_tokens_user_id
cross join trigger_inventory;
```

## Earlier test docs to re-run or update

- Re-run Batch 0 users-policy tests and Batch 9 activation/deactivation tests with `anonymized_at` added to every reactivation guard.
- Re-run Batch 7 callback negatives to prove the replaced Auth/profile email, inactive state, and ban cannot regain a session.
- Re-run Batch 8 Admin protections and last-active-Admin tests.
- Re-run task assignment and archive tests in `docs/PHASE-4-STEP-7A-TESTS.md`, `docs/PHASE-4-STEP-8-TESTS.md`, `docs/PHASE-3-STEP-6-ARCHIVE-VISIBILITY-TESTS.md`, and `docs/PHASE-4-STEP-7B-TESTS.md` for preserved UUID/history behavior.
- Re-run comment tests in `docs/PHASE-4-STEP-9-TESTS.md` to prove comments remain and render through the current profile identity.
- Re-run Activity Log immutability/catalog coverage from `docs/PHASE-4-STEP-1A-TESTS.md` and the Step 10 gate; no snapshot may be rewritten.
- Extend the future authoritative Phase 4B catalog test and allowlists for the new column, constraints, functions, policies, and grants; keep historical Phase 4 counts historical.

## Test deliverable

Create `docs/phase-4b/step-10-tests.md` when the batch lands. Include one self-contained rollback-safe Dev SQL paste ending in the required intentional `TEST RESULTS` exception, plus route/orchestration tests using mocked Auth and Storage boundaries.

Cover active target, Admin target, self target, already anonymized target, inactive eligible Member, inactive Co-Admin, 0/1/50/51 selections, duplicate IDs, stale preview, and unauthorized callers. For open-task eligibility, cross primary/assist assignment with To Do/In Progress/Completed and Draft/Active/Archived parents; only open Draft/Active combinations skip. Prove UUIDs and all listed foreign-key/array/history locations remain unchanged while profile PII changes. Pin the shared per-user lock-key helper and inventory every direct or indirect writer of either assignee array. The counted live-catalog line must require the broad body search to equal exactly `accept_task_volunteer`, `assign_task_people`, `claim_task`, `create_event_with_tasks`, `edit_event_with_tasks`, `move_task`, `set_task_backup_request`, and `unassign_self`, while separately requiring the true array-writing subset to equal the same list without `move_task` and `set_task_backup_request`; those two only read the arrays for authorization. Fold into the existing Edit Event race/result line a rollback-safe case that inserts a task as postgres under an approved task-assignee writer marker with an orphan UUID in either stored assignee array, then proves `edit_event_with_tasks` can save that task when the payload does not re-send the orphan. These assertions do not add a result line, so the planned total remains 190.

Add genuine overlapping-transaction tests for assignment racing with removal in both arrival orders. Cover a one-person and multi-person assignment with deliberately reversed input order, and prove locks are acquired in sorted unique user-id order before task/event rows. Exactly one valid outcome wins: a committed open assignment makes removal return `skipped`, or committed removal makes assignment reject the inactive/anonymized target. Assert no deadlock, partial array update, removed-but-assigned account, duplicate assignee, or retry without authoritative re-read.

Inject failure before database completion, during Auth update, and during Storage removal. Assert per-user `removed`, `skipped`, `failed`, or `cleanup-pending` results; deterministic retries; no duplicate identities; permanent reactivation denial; and no claim of cross-service rollback. Test mixed batches where every outcome appears without one user’s failure corrupting another.

## Manual checklist

- From the Deactivated tab, select individual rows and use select-all on visible filtered results. Confirm unseen rows are not selected and 51 selections are rejected before execution.
- Review the server-produced preview and type `REMOVE <count> MEMBERS` with the authoritative selected count. Change one target’s state after preview and confirm execution re-checks it.
- Remove an eligible former Member and verify the same UUID remains; profile name/email/avatar are anonymized; `is_active` stays false; `anonymized_at` is set; Auth login is banned; and the Storage avatar object is removed.
- Attempt reactivation through the UI and a direct request. Confirm an anonymized account can never be reactivated.
- Verify comments remain and display `Former member`; archived assignments/history remain linked; immutable activity snapshots are unchanged.
- Verify a To Do/In Progress primary or assist assignment in Draft or Active causes `skipped`. Verify Completed tasks and all Archived tasks do not block removal.
- Run the assignment-versus-removal overlap in both orders, including a multi-person assignment whose submitted ids are unsorted. Confirm sorted user-lock acquisition, one valid winner, and no partial assignments or deadlock.
- Simulate Auth failure and Storage failure. Confirm `failed` or `cleanup-pending` appears for that user, other users continue, and retry completes the same deterministic identity.
- As Co-Admin, Member, inactive Admin, and profile-less user, attempt preview and execution directly; all must fail without revealing eligibility details.
- Confirm no event deletion control or behavior appears in this batch.

## Acceptance

An active Admin can preview and confirm at most 50 visible selected deactivated accounts by typing `REMOVE <count> MEMBERS`. Eligible accounts are anonymized in place under the same UUID, permanently non-reactivatable, banned from Auth login, renamed `Former member`, assigned matching deterministic non-routable Auth/profile emails, cleared of avatar URL, and stripped of the Storage avatar object. Removal and every assignee-array writer share sorted per-user locks taken before task/event rows, so an account cannot become removed while concurrently entering an open assignment. Open Draft/Active assignments are skipped, Archived history never blocks or changes, comments stay, partial failures are explicit and idempotently retryable, and no user or event is deleted.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-10-tests.md` and update the authoritative Phase 4B catalog/allowlists when scheduled.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with `anonymized_at`, permanent reactivation denial, UUID preservation, open-task eligibility, Auth ban/email replacement, and Storage cleanup.
- Keep event deletion documented only in Batch 13d materials.
