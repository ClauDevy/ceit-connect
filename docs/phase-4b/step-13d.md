# Step 13d: Event deletion

**Status:** 13d-DB applied and SQL-verified on Dev; 13d-UI/routes implemented and automated locally; nothing applied on Prod and browser verification remains | **Branch:** `feature/event-deletion` | **Reasoning level:** High (security-critical event/task deletion, archive guards, and immutable history)

## Goal

Add one narrow server-only `delete_event()` RPC for deleting a Draft or Archived event through one Admin-only management page with a year filter. A single deletion requires the exact event name; bulk deletion requires `DELETE <count> EVENTS`. Keep Active deletion blocked, preserve immutable activity history with its original task UUID values after task rows are gone, handle task/child cascades without weakening ordinary Archived immutability, and durably track post-commit banner Storage cleanup through the verified server boundary.

The stable run order for this group is **13, 13c, 13e, 13d, 13b**. Batch 13d runs after Draft visibility and template import, and before phase completion.

## Local database implementation

Migration `20261031130000_event_deletion.sql` implements the database half. The owner applied it on Dev and confirmed rollback-safe Pastes A/B/C pass **64/64**, **58/58**, and **47/47**; Prod remains unapplied. The dedicated `ceit_event_delete_executor` role is created only when absent and catalog-checked as `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, `NOREPLICATION`, and `NOBYPASSRLS`. PostgreSQL 16+ must retain only its automatic creator membership for `postgres` with `ADMIN TRUE`, `INHERIT FALSE`, and `SET FALSE`; PostgreSQL 15 must retain no membership. Hosted Supabase's managed postgres migration role can create roles, as already documented for Phase 4; the migration preflight stops before schema changes if that authority is unavailable, so Dev and Prod use the same role creation and validation path. There is no GUC fallback.

The executor owns only `delete_event(uuid,uuid,timestamptz)`, has schema usage, exact SELECT/INSERT/DELETE access to the RLS-protected transaction-context table, and execute on the postgres-owned actor and deletion helpers. It receives no privilege on `public.users` and no users policy. The actor helper runs before context creation and every lock. The delete helper then locks event row → event dependency advisory key → sorted event task rows → every catalog-enumerated child FK row. Its FK inventory includes the task dependency self-reference and fails closed if `pg_constraint` contains any unreviewed FK referencing `events` or `tasks`.

Banner-job paths use the same event-folder/random-WebP rule as `event_banner_url_is_valid`. A null banner creates no job. A stored non-null banner that is invalid or already missing does not make the event undeletable: deletion succeeds, no cleanup job is inserted, and `out_cleanup_unavailable` is true. The route reports that warning. Cleanup retry work is separately committed and may never gate a confirmed deletion run, including on retry error or when its 20-job pass reaches the cap.

Repository audit found no application route, component, script, or fixture using raw/service-role event DELETE. The only current Batch 13 raw-Draft path is the SQL verification in `step-13-tests.md`; it is updated to assert denial. Older historical raw-delete fixtures are listed under reruns below and are superseded for whole-event cascade proof by Paste B's service-role RPC coverage. The UI part must not add a second delete control: `/event-management` and its verified route will be the only UI path, so there are no old buttons to retain or redirect. Both parts still ship in one PR before any Prod push.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Decisions (made by the owner): Deleting

- Delete archived events: Admin only, Archived events only, typed confirmation, bulk select with a year filter.
- Drafts can also be deleted.
- The immutable activity log must be handled in the plan.

### `docs/PHASE-4B-PLAN.md` — Batch and audit resolutions

- Batch 13d adds one Admin-only `delete_event()` RPC for Draft or Archived events.
- Active event deletion remains blocked.
- `activity_log` keeps task UUID values without a foreign key.
- Batch 13d is security-critical and uses High reasoning for migration and tests.

## Current state

- `events_delete` permits an active Admin to delete only a non-Archived event. The lifecycle trigger independently rejects every Archived event deletion, including service-role writes.
- `guard_event_updates()` manually deletes child tasks while a permitted parent still exists so the fail-closed task guard can verify its lifecycle before the event row is removed.
- `tasks_guard_archived_event_writes` rejects every task insert/update/delete beneath an Archived event. Existing work-link, comment, volunteer, and archive-viewer guards also freeze their ordinary Archived writes while permitting validated nested task cascades.
- Active events have a deferred at-least-one-task invariant, but whole-event deletion is already a recognized exception after the parent disappears in the same transaction.
- `activity_log.task_id` currently references `tasks(id) ON DELETE SET NULL`. Historical INSERT/UPDATE rows therefore lose their task UUID when a task is deleted, and the task activity trigger currently writes a null `task_id` for DELETE rows.
- `activity_log` is immutable to application callers and is written only by its task trigger. Batch 12 plans to remove raw authenticated SELECT and expose history through a masked fixed-shape reader.
- The repository has real event banners: `events.banner_url`, the `banners` Storage bucket, event-scoped banner policies/guards, the banner API route, and Create/Edit/Home/Archive banner UI. Deleting an event row does not automatically remove its Storage object.

## Scope: in / out

**In:** one service-role-only `delete_event()` RPC behind an Admin-authenticated server route; route and function active-Admin verification; Draft/Archived-only lifecycle; Active denial; typed confirmation; multiple selected events with a year filter; safe per-event result reporting; event/task/child cascades; exact archive-guard exception; retained activity task UUIDs with no FK; Batch 12 reader compatibility; private durable banner-cleanup jobs, Admin pending count and Retry action; exact grants/catalogs; regression tests.

**Out:** Active deletion; unarchiving; restoring deleted events; deleting individual Archived tasks; weakening ordinary Archived task/child freezes; deleting or editing activity rows; browser-executable event deletion; notification redesign; cron or scheduled orphan cleanup; Realtime; completed-phase implementation.

## Database impact

Add one tracked security-critical migration; never edit the existing archive, activity-log, task-child, or event-lifecycle migrations.

### `delete_event()` boundary

Create exactly one database deletion entry point named `delete_event()`. Browser sessions cannot execute it: revoke execute from `PUBLIC`, `anon`, and `authenticated`, and grant it only to the server role used by the route. It must:

- accept the event id and the actor id passed by the server route, and independently re-read the actor from `public.users` as an active Admin before event lookup so an invalid actor cannot probe ids;
- validate the supplied event id, actor id, and any exact confirmation/version input approved during implementation;
- lock the stored event row and re-read status;
- accept only `Draft` or `Archived` and return a stable safe error for `Active`, unknown, stale, inactive, profile-less, or unauthorized cases;
- when the event has a banner, upsert exactly one cleanup job for its server-derived bucket and exact stored object path in the same transaction as the event deletion;
- delete exactly one event per call and verify the affected-row count;
- return only the minimum safe deletion and cleanup-job identity needed by the route; and
- use a fixed empty `search_path`, exact ownership, no overload, revoked default execute, and a service-role-only execute grant.

The browser calls one server route. Before constructing or using `createServiceRoleClient()`, the route independently verifies that the real caller is logged in, has an active profile, and is an Admin. It passes that caller's UUID as the actor id and never accepts actor authority from the request body. The bulk route calls the one-event RPC once for each confirmed selected event and reports each result. Do not add a broad client-controlled array delete RPC merely for bulk UX.

Raw authenticated event deletion must no longer be a second usable path. Narrow or remove the existing direct delete policy/grant as required so authenticated sessions cannot delete an event or execute `delete_event()`. The lifecycle/task guards need a non-forgeable exception for this exact server-only RPC rather than a blanket `current_user = 'postgres'` exemption. If the existing owner model cannot identify the narrow path safely, use the Phase 4-approved fallback of a dedicated `NOLOGIN` executor role with only the exact privileges needed by `delete_event()` and pin it in catalog tests.

### Durable banner-cleanup jobs

Add private `public.event_storage_cleanup_jobs` in the same tracked migration. At minimum it contains a server-derived job id and deleted `event_id` value without a foreign key, `bucket_id`, exact `object_path`, `status` constrained to `pending`, `done`, or `failed`, nonnegative `attempt_count`, nullable `claim_token uuid`, nullable `lease_expires_at timestamptz`, nullable bounded `last_error` containing only a sanitized short message (never raw database, Storage, stack, or provider text), and `created_at`, `updated_at`, `last_attempt_at`, and `completed_at` timestamps with state-consistency checks. A unique constraint on `(bucket_id, object_path)` makes retry/upsert idempotent. Claim columns must be null together, and a `done` job cannot retain a claim.

Enable RLS and revoke all table privileges from `PUBLIC`, `anon`, and `authenticated`. Browser clients receive no policy, row count, or direct reader/writer. Only the verified server route, through the service role and narrowly cataloged atomic claim/finalize functions, may list retryable jobs, claim an attempt, or finalize `pending`/`failed` as `done`/`failed`. No cron job or scheduled worker is added.

`delete_event()` derives the bucket and exact object path from the locked stored event and writes/upserts the cleanup row in the same transaction as deletion. An event without a banner creates no job. Bulk deletion invokes the one-event boundary separately, so each deleted event with a banner has one unique job and one independently reportable outcome.

### Archived freeze and cascades

Ordinary Archived event, task, work-link, comment, volunteer, archive-viewer, and other guarded child writes remain rejected. The deletion exception applies only to the approved whole-event cascade initiated by `delete_event()`.

The event guard, task guard, prerequisite-deletion guard, child guards, and deferred Active-event invariant must agree on this cascade. They must not allow:

- a direct Archived task or child deletion;
- a raw Archived event deletion;
- moving a task into or out of the event before deletion;
- deleting an Active event; or
- forging the RPC’s executor context from an authenticated session.

Take the event row lock before child deletion. Do not introduce an event-delete path that waits on child rows while another writer holds a child/task lock and waits for an incompatible event lock without a documented retry contract. After any lock wait, re-read lifecycle and relationship state before allowing the cascade.

### Immutable activity history with retained UUIDs

Drop only the foreign-key constraint from `activity_log.task_id`; keep the column as nullable `uuid` and do not rewrite existing log rows. Replace the task activity trigger so future task DELETE entries store `old.id` instead of null. INSERT and UPDATE behavior, actor attribution, rank-only silence, and application immutability remain unchanged.

Existing historical null task ids cannot be reconstructed and are not backfilled. Dropping the FK permits a log row to retain its task UUID after a task or event is deleted; it does not permit arbitrary activity writes.

Batch 12’s masked reader must remain safe when the referenced task row no longer exists. For a deleted task/event, it derives any permitted display fields from the stored snapshot without trusting missing live rows. Active Admins follow the approved Activity Log scope; Co-Admins receive only the approved masked or own-committee-safe representation; Members have no task page after event deletion and gain no history through the orphaned UUID. Confidential snapshots must never become real merely because the FK is gone.

### Event banner cleanup

Because event banners and Storage objects exist in this repository, deletion must address them explicitly.

The database deletion and Storage deletion cannot be one transaction. `delete_event()` returns the already-validated cleanup-job identity needed by the server route after the database commit. Only after database success may the route use the Storage API with `createServiceRoleClient()` to remove that job's exact bucket/object path; it must never trust a client-supplied URL or path and must never delete from `storage.objects` with SQL.

Before every Storage attempt, the route must obtain the job through one atomic service-only claim function. The claim selects a `pending` row immediately, but a `failed` row only after `last_attempt_at <= now - 1 minute`; either row must have no claim or an expired claim. Candidates order by `last_attempt_at NULLS FIRST, created_at, id`. Claiming assigns a database-generated unpredictable token and a fixed five-minute lease, increments `attempt_count`, records `last_attempt_at`, and returns that token with the exact bucket/object path. Concurrent claimers cannot both receive the same job. An expired lease may be claimed again with a new token and another attempt increment; an unexpired claim is skipped rather than processed concurrently.

Only a finalize operation matching the job id, current claim token, and unexpired lease may mark it `done` or `failed`. On confirmed removal or Storage “object not found,” it marks the job `done`, clears the claim and `last_error`, and records `completed_at`; “object not found” is successful because deletion is idempotent. On an actual Storage failure, the current claimant marks `failed`, clears the claim and `completed_at`, and stores only the bounded sanitized error. A Storage failure does not recreate deleted database rows. Report the event as deleted with a pending-cleanup result, never false rollback or full success. Never delete a banner before the database deletion succeeds, and never broaden cleanup to another event’s folder or object.

If the Storage delete succeeds but finalization loses its lease, logs must record a sanitized operational warning and must not mark the job `failed` or overwrite a newer claim. The next claimant safely retries; Storage returns “object not found,” and that current claimant finalizes the job as `done`.

## Deletion UI behavior

- Only active Admins receive event-deletion controls. Co-Admins, Members, inactive users, and profile-less callers do not.
- The selection surface includes Draft and Archived events, never Active events.
- A calendar-year filter narrows the displayed results before selection. Bulk Select all applies only to the currently visible filtered results.
- Every destructive run requires typed confirmation and shows the exact selected count and event names before submission.
- A single selected event requires its exact event name. A multi-event run requires `DELETE <count> EVENTS` using the authoritative selected count.
- Draft and Archived rows share one Admin-only management page and one year filter.
- The page obtains an Admin-only pending-cleanup count through the server route and shows a **Retry** button when `pending` or `failed` jobs exist. It never reads the cleanup table directly.
- At the start of every confirmed deletion run, the route retries existing `pending` and `failed` jobs before processing newly selected events. The Retry button invokes the same bounded idempotent server workflow. There is no cron job.
- Disable duplicate submission, preserve the selection on partial failure, and return a per-event success/failure/cleanup-warning report.
- Bulk results list each event's deletion outcome and whether its banner cleanup is `done` or still pending/failed; the displayed pending count refreshes from the authoritative server result.
- The client treats the list as advisory. Each RPC call re-checks the real stored status and caller.
- A stale event that became Active is rejected even if it remained selected in the browser.
- Successful deletion invalidates Home, Archives, event, activity, and relevant task/feed queries. It does not claim that a failed banner cleanup also succeeded.

### Implemented UI and route boundary

- `/event-management` guards itself for an active Admin, reads only Draft/Archived event list fields through the caller session, and adds the Admin-only shared navigation entry. `events.start_date` is a PostgreSQL `date`, so the descending year list is built from unique canonical date-string years; `All years` is the default and a defensive null date appears only there.
- The management list uses the shared three-slot Task History/Activity Log pager at ten filtered rows per page. Selection persists across pages, remains capped at ten, snapshots each event version without silently adopting refreshed timestamps, and resets with the year filter. Desktop and mobile expose page-scoped tri-state checkboxes; whole-row pointer selection ignores checkbox bubbling and selected-text drags. Compact bulk actions remain clear of the mobile navigation, Draft and Archived use the same neutral readable badge treatment as Home/Archives, successful deletion focuses its result summary, and an authoritative refresh clamps a vanished last page.
- `POST /api/event-storage-cleanup` accepts exactly `{action:"status"}` or `{action:"retry"}`. Both actions verify the active Admin before service-role construction. Status returns only the pending/failed count; Retry sequentially claims at most 20 jobs.
- `POST /api/event-deletion` accepts 1-10 unique event ids with opaque formatted `expectedUpdatedAt` strings and the typed confirmation. Bulk confirmation uses the submitted count even when a row is already gone. The route re-reads names and versions, passes each untouched timestamp string and the authenticated actor id to the one-row RPC, and maps errors only by code.
- Every confirmed deletion run gives old cleanup work an **8-second** pre-pass budget under an explicit **60-second** route maximum. It then performs up to ten sequential deletions and attempts each returned cleanup job only after that deletion commits, for at most 20 old plus 10 new Storage attempts. Unfinished work stays durable for Retry.
- Activity Log orphan rows now display `Deleted event` and never render an Open task link when the retained task UUID has no live event name.

## Guards that must remain true

- Only a current active Admin may call the deletion boundary successfully.
- `Draft` and `Archived` are the only deletable stored statuses. `Active` always fails.
- Raw event DELETE is not an alternate authenticated path.
- Ordinary Archived rows remain frozen; only the exact whole-event delete cascade is exempt.
- Task `event_id` and `created_by` remain immutable before deletion.
- Deleting an event removes its tasks and ordinary FK children atomically or removes nothing.
- `activity_log` rows are never updated or deleted, and future deletion rows retain `old.id` in `task_id`.
- Removing the activity FK does not add INSERT/UPDATE/DELETE privileges or permissive policies on `activity_log`.
- Confidential history remains masked after live task/event rows disappear.
- Banner cleanup is server-only, path-derived from the deleted stored event, scoped to one exact object, and performed only after database success.
- `delete_event()` and every cleanup-job reader/writer are unavailable to `PUBLIC`, `anon`, and `authenticated`; the route verifies the caller before service-role use, and the function separately verifies the passed actor as an active Admin.
- Cleanup jobs are unique by bucket/object path, contain only sanitized bounded errors, and are retried idempotently through the Storage API. No SQL deletes `storage.objects`, no client reads the ledger, and no cron job is introduced.
- Every Storage attempt owns one current unexpired claim token. Claiming is atomic and increments the attempt count; only that claimant can finalize, expired claims are reclaimable, and a stale token cannot overwrite newer state.
- Batch 13b’s later completed-phase guard must permit only this approved whole-event cascade and must not create another event deletion path.

## Security risks

- A broad exception in the Archived trigger can turn permanent records writable. Bind the exception to the exact RPC execution boundary and assert it in the catalog.
- Allowing raw Admin DELETE alongside the RPC bypasses confirmation, stale checks, and result reporting. Make the RPC the only authenticated path.
- Dropping the activity FK without replacing DELETE logging leaves future delete entries null; changing snapshots or grants would weaken audit integrity.
- Reading orphaned activity by joining only live tasks can hide all history or accidentally unmask confidential snapshots. The reader needs an explicit deleted-record branch.
- A client-supplied banner path can delete another event’s object. Return/derive the exact stored identity server-side and validate the expected event folder.
- Deleting Storage first can lose a banner while a database rejection leaves the event intact. Database deletion must happen first.
- Granting `delete_event()` to `authenticated` would let browser sessions bypass the route's typed-confirmation and orchestration boundary. Keep execute service-only and re-verify the actor inside the function.
- Logging raw database, provider, or stack errors in the cleanup ledger can persist secrets or internals. Map failures to a short sanitized message before writing `last_error`.
- A non-unique job or blind retry can delete the wrong path twice or lose failure state. Use the exact unique bucket/path row, increment attempts, and treat already-absent Storage success as `done`.
- Without an atomic lease, concurrent deletion and Retry requests can process and finalize the same job. Claim before Storage, reject stale-token finalization, and allow recovery only after lease expiry.
- A delete can succeed just as its lease expires. Marking that job failed from the stale claimant could overwrite newer work; log the lost finalization, leave the row for reclaim, and let the next claimant convert the harmless not-found result to `done`.
- Bulk UI success can conceal partial failures. Report each RPC and cleanup result independently.
- Tests run as the SQL Editor owner bypass RLS. Role authorization requires impersonated direct-call tests.

## Earlier test docs to re-run or update

- `docs/PHASE-4-STEP-1-TESTS.md` for archive serialization, lifecycle guards, raw-policy narrowing, and event/task freeze behavior.
- `docs/PHASE-4-STEP-1A-TESTS.md` for raw task access after parent deletion.
- `docs/PHASE-4-STEP-3-TESTS.md` and `docs/PHASE-4-STEP-7B-TESTS.md` for Archived content and archive-only access before deletion.
- `docs/PHASE-4-STEP-4-TESTS.md`, `docs/PHASE-4-STEP-8-TESTS.md`, and `docs/PHASE-4-STEP-9-TESTS.md` for work-link, volunteer, and comment cascades/guards.
- `docs/PHASE-4-STEP-5A-TESTS.md` and `docs/PHASE-4-STEP-7A-TESTS.md` for dependency deletion, whole-event cascade, and Active-event task invariants.
- Phase 3 banner tests for exact object paths, Archived write denial, and cleanup ordering.
- Batch 12 tests for masked immutable activity after the referenced task/event is absent.
- Batch 13c tests for unchanged Draft read masking before deletion.
- Batch 13b tests must later include the approved whole-event deletion exception.
- `docs/PHASE-4-STEP-10-TESTS.md` and the post-13b Phase 4B catalog for constraints, policies, trigger bodies/order, function ownership/grants, and current counts.

## Test deliverable

`docs/phase-4b/step-13d-tests.md` contains independent rollback-safe Dev SQL Pastes A/B/C with **64**, **58**, and **47** named result lines, each ending in an intentional `TEST RESULTS` exception; the owner confirmed all three pass on Dev. Route, cleanup-worker, pure-helper, page-guard, navigation, Activity Log orphan, pagination, immutable selection-version, selection-cap, row-click, reduced-motion, App-entry export allowlist, and literal route-duration contracts are automated locally. Route duration literals are cross-checked against the plain `event-deletion-limits.ts` module so Next can statically analyze each segment without duplicating undocumented values. The manual destructive-flow/browser run remains pending.

Cover active/inactive/profile-less Admin, Co-Admin, Member, and unauthenticated route callers; direct `delete_event()` calls from `PUBLIC`/`anon`/`authenticated`; forged actor ids; Draft, Active, Archived, unknown, stale, and double-submit cases; raw DELETE denial; exact one-row effects; event/task/work-link/comment/volunteer/archive-viewer/notification cascades; dependency chains; completed and incomplete tasks; concurrent lifecycle change; Archived guard non-regression; retained UUIDs in INSERT/UPDATE/DELETE activity rows; historical null preservation; immutable log grants/policies; confidential orphan masking; year filtering; visible-only bulk selection; typed confirmation; partial results; exact banner object cleanup; wrong-path rejection; and Storage cleanup failure after successful database deletion.

For `event_storage_cleanup_jobs`, assert columns and bounds, status/timestamp/claim checks, RLS, zero `PUBLIC`/`anon`/`authenticated` privileges and policies, service-only claim/finalize functions and grants, one job written in the same transaction as each banner-bearing event deletion, no job for no-banner events, unique bucket/path rejection or idempotent upsert, one job per bulk event, sanitized-error length/content, atomic attempt increments, pending/failed retry at deletion-run start, Retry-button route behavior, already-absent success, `done`/`failed` transitions, pending-count accuracy, and no SQL deletion from `storage.objects`.

Race two claimers for one job and prove exactly one receives a token and path. Prove a stale or wrong token cannot finalize, an unexpired lease cannot be reclaimed, and an expired lease can be reclaimed with a different token and incremented attempt count. Simulate Storage success followed by lease expiry before finalization: the stale finalizer logs the sanitized warning without marking `failed`, the next claimant receives the job, “object not found” is treated as success, and only the current token finalizes `done`.

Pin `delete_event()` actor-bearing signature/owner/security/search path/service-only grant/no-overload status, cleanup-job functions and table grants, the exact deletion executor boundary, event/task/child trigger definitions and order, removal of only the activity task FK, retained activity indexes/immutability, raw event delete closure, and zero unintended task writers.

## Manual checklist

- As an Admin, use the single management page to filter disposable Draft and Archived fixtures by year. Type the exact event name for one deletion and `DELETE <count> EVENTS` for a bulk run; verify the per-event report.
- Confirm Draft and Archived fixtures disappear with their tasks/children while their activity rows retain task UUID values.
- Select or directly call deletion for an Active event; confirm it remains intact.
- As a Co-Admin, Member, inactive Admin, and profile-less caller, confirm controls are absent and direct calls fail without event probing.
- Attempt raw DELETE and direct Archived task/child deletes; confirm the RPC exception does not make them writable.
- Review deleted confidential history as each approved Activity Log role and confirm masking remains correct with no live task row.
- Delete an event with a banner and confirm only its exact object is removed after database success. Exercise a simulated cleanup failure and confirm the deletion result reports an orphan warning rather than false rollback or full success.
- Confirm the failed job persists with a sanitized short error and incremented attempt count, the Admin page shows the pending-cleanup count and Retry button, Retry marks it done, and the next deletion run retries outstanding jobs before new deletions.
- Start two concurrent retries and confirm only one holds the lease. Let a successful deleter's lease expire before finalization; confirm its stale token cannot write `failed`, the warning is sanitized, and the next claimant finishes the already-absent object as `done`.
- Delete several banner-bearing events in bulk and confirm one unique job/result per event. As `anon`, `authenticated`, and a direct browser caller, confirm the ledger and `delete_event()` are inaccessible. Inspect the Storage operation and confirm it uses the API rather than SQL against `storage.objects`.
- Confirm repeated submission is safely reported and cannot delete an unrelated event.

## Acceptance

One service-role-only `delete_event()` RPC behind the verified server route is the only application path for event deletion. Browser roles cannot execute it; the route verifies the logged-in active Admin before service-role use, passes the actor id, and the function re-verifies that actor. It deletes only real Draft or Archived events, rejects Active and every unauthorized/stale case, preserves ordinary Archived immutability, and cascades event children atomically. Immutable activity rows survive with retained task UUIDs and safe confidential masking after live rows disappear. One Admin-only management page provides the year filter, exact event-name confirmation for one deletion, `DELETE <count> EVENTS` for bulk, visible-result selection, pending-cleanup count/Retry, and per-event reporting. Banner jobs are written atomically with database deletion, private from browser roles, unique and idempotent by exact object, and processed through the Storage API only under an atomic expiring claim. Only the current token may finalize; expired work is safely reclaimable, object-not-found is success, and state/errors remain durable and sanitized.

## Open questions for the owner

None.

## Docs to update when this lands

- Do not claim Prod application until the owner applies and verifies the migration there.
- Complete the manual destructive-flow/browser matrix before merge.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with the final service-only deletion RPC, actor re-verification, raw-delete closure, guard exception, activity UUID/no-FK contract, cascade behavior, cleanup-job table, and Storage API retry boundary.
- Add Batch 13d objects, cleanup-job grants/RLS/constraints, and constraint/trigger changes to the post-13b authoritative Phase 4B catalog and Batch 14 allowlists.
