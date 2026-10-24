# Step 10: Remove former member

**Status:** Planned | **Branch:** `feature/member-removal` | **Reasoning level:** High (security-critical migrations and tests)

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

The database operation must derive an active Admin caller, reject self-removal and all Admin targets, lock the target, require `is_active = false`, and check `anonymized_at`. Before first anonymization it must reject a target when any Draft/Active event has a task in `To Do` or `In Progress` with the target UUID in either assignee array. Archived assignments deliberately remain and do not block.

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
- Open-task blocking uses only Draft/Active parents and `To Do`/`In Progress` status with membership in primary or assist assignees. Archived tasks remain frozen historical references and do not block forever.
- Keep the UUID everywhere. Do not remove comments, mentions, assignment arrays, viewers, volunteers, notifications, work-link provenance, archived shares, creator fields, or activity snapshots merely to hide identity.
- Replace both profile and Auth email with the same deterministic non-routable value, keep `is_active = false`, set the exact name `Former member`, clear `avatar_url`, ban Auth login, and remove the Storage avatar object.
- Check every database, Auth, and Storage result. A partial outcome must be visible and safely retryable.

## Security risks

- Auth Admin update and Storage deletion require service role and bypass RLS. The route must verify logged-in state, active Admin role, target eligibility, and confirmation before privileged work.
- A client-supplied preview, target status, task count, or anonymized email is untrusted. Derive all authoritative values server-side.
- Open-task checks against UUID arrays have no foreign-key help. Test both primary and assist arrays, both open statuses, and parent event lifecycle under the target lock/transaction.
- A race can assign a task after a stale preview. Execution must re-check; any assignment writer introduced later must be regression-tested against removal’s eligibility contract.
- Auth, Postgres, and Storage cannot commit atomically. Hiding partial failures or retrying with a new email would strand accounts. Deterministic identity and explicit result states are mandatory.
- A ban alone does not retroactively invalidate an already issued access token. `is_active = false`, active-profile RLS/helpers, route guards, and the anonymized marker remain the immediate application boundary.
- Rewriting immutable activity snapshots would corrupt the audit trail. Their UUIDs are not personal-display fields and must remain unchanged.
- Leaving the public avatar object after a failed cleanup retains personal data. Report `cleanup-pending`, retry the fixed object path, and never report full success until removal is confirmed or the object is already absent.

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

Cover active target, Admin target, self target, already anonymized target, inactive eligible Member, inactive Co-Admin, 0/1/50/51 selections, duplicate IDs, stale preview, and unauthorized callers. For open-task eligibility, cross primary/assist assignment with To Do/In Progress/Completed and Draft/Active/Archived parents; only open Draft/Active combinations skip. Prove UUIDs and all listed foreign-key/array/history locations remain unchanged while profile PII changes.

Inject failure before database completion, during Auth update, and during Storage removal. Assert per-user `removed`, `skipped`, `failed`, or `cleanup-pending` results; deterministic retries; no duplicate identities; permanent reactivation denial; and no claim of cross-service rollback. Test mixed batches where every outcome appears without one user’s failure corrupting another.

## Manual checklist

- From the Deactivated tab, select individual rows and use select-all on visible filtered results. Confirm unseen rows are not selected and 51 selections are rejected before execution.
- Review the server-produced preview and type `REMOVE <count> MEMBERS` with the authoritative selected count. Change one target’s state after preview and confirm execution re-checks it.
- Remove an eligible former Member and verify the same UUID remains; profile name/email/avatar are anonymized; `is_active` stays false; `anonymized_at` is set; Auth login is banned; and the Storage avatar object is removed.
- Attempt reactivation through the UI and a direct request. Confirm an anonymized account can never be reactivated.
- Verify comments remain and display `Former member`; archived assignments/history remain linked; immutable activity snapshots are unchanged.
- Verify a To Do/In Progress primary or assist assignment in Draft or Active causes `skipped`. Verify Completed tasks and all Archived tasks do not block removal.
- Simulate Auth failure and Storage failure. Confirm `failed` or `cleanup-pending` appears for that user, other users continue, and retry completes the same deterministic identity.
- As Co-Admin, Member, inactive Admin, and profile-less user, attempt preview and execution directly; all must fail without revealing eligibility details.
- Confirm no event deletion control or behavior appears in this batch.

## Acceptance

An active Admin can preview and confirm at most 50 visible selected deactivated accounts by typing `REMOVE <count> MEMBERS`. Eligible accounts are anonymized in place under the same UUID, permanently non-reactivatable, banned from Auth login, renamed `Former member`, assigned matching deterministic non-routable Auth/profile emails, cleared of avatar URL, and stripped of the Storage avatar object. Open Draft/Active assignments are skipped, Archived history never blocks or changes, comments stay, partial failures are explicit and idempotently retryable, and no user or event is deleted.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-10-tests.md` and update the authoritative Phase 4B catalog/allowlists when scheduled.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with `anonymized_at`, permanent reactivation denial, UUID preservation, open-task eligibility, Auth ban/email replacement, and Storage cleanup.
- Keep event deletion documented only in Batch 13d materials.
