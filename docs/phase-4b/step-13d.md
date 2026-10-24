# Step 13d: Event deletion

**Status:** Planned | **Branch:** `feature/event-deletion` | **Reasoning level:** High (security-critical event/task deletion, archive guards, and immutable history)

## Goal

Add one narrow Admin-only `delete_event()` RPC for deleting a Draft or Archived event through one Admin-only management page with a year filter. A single deletion requires the exact event name; bulk deletion requires `DELETE <count> EVENTS`. Keep Active deletion blocked, preserve immutable activity history with its original task UUID values after task rows are gone, handle task/child cascades without weakening ordinary Archived immutability, and clean up the event’s banner Storage object through the existing verified server boundary.

The stable run order for this group is **13, 13c, 13d, 13b**. Batch 13d runs after Draft visibility and before phase completion.

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

**In:** one caller-session `delete_event()` RPC; active-Admin re-verification; Draft/Archived-only lifecycle; Active denial; typed confirmation; multiple selected events with a year filter; safe per-event result reporting; event/task/child cascades; exact archive-guard exception; retained activity task UUIDs with no FK; Batch 12 reader compatibility; existing banner object cleanup and failure reporting; exact grants/catalogs; regression tests.

**Out:** Active deletion; unarchiving; restoring deleted events; deleting individual Archived tasks; weakening ordinary Archived task/child freezes; deleting or editing activity rows; a general service-role event-delete route; notification redesign; scheduled orphan cleanup; Realtime; completed-phase implementation.

## Database impact

Add one tracked security-critical migration; never edit the existing archive, activity-log, task-child, or event-lifecycle migrations.

### `delete_event()` boundary

Create exactly one authenticated mutation entry point named `delete_event()`. It must:

- derive the caller from `auth.uid()` and verify an active Admin before event lookup so unauthorized callers cannot probe ids;
- validate the supplied event id and any exact confirmation/version input approved during implementation;
- lock the stored event row and re-read status;
- accept only `Draft` or `Archived` and return a stable safe error for `Active`, unknown, stale, inactive, profile-less, or unauthorized cases;
- delete exactly one event per call and verify the affected-row count;
- return only the minimum safe result needed for UI reconciliation and post-commit banner cleanup; and
- use a fixed empty `search_path`, exact ownership, no overload, revoked default execute, and an authenticated-only execute grant.

The bulk UI calls this one-event RPC once for each confirmed selected event and reports each result. Do not add a broad client-controlled array delete RPC merely for bulk UX.

Raw authenticated event deletion must no longer be a second usable path. Narrow or remove the existing direct delete policy/grant as required so authenticated deletion goes only through `delete_event()`. The lifecycle/task guards need a non-forgeable exception for this exact RPC rather than a blanket `current_user = 'postgres'` exemption. If the existing owner model cannot identify the narrow path safely, use the Phase 4-approved fallback of a dedicated `NOLOGIN` executor role with only the exact privileges needed by `delete_event()` and pin it in catalog tests.

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

The database deletion and Storage deletion cannot be one transaction. `delete_event()` returns the already-validated banner object identity needed by a server-only route after the database commit. The route first re-verifies the active Admin and performs the ordinary deletion with the caller’s Supabase session. Only after database success may it use `createServiceRoleClient()` to remove that exact former event banner object; it must never trust a client-supplied URL or path.

A Storage cleanup failure does not recreate the deleted database rows. Report the event as deleted with a cleanup warning in the per-event result so the owner can address the orphan. Never delete a banner before the database deletion succeeds, and never broaden cleanup to another event’s folder or object.

## Deletion UI behavior

- Only active Admins receive event-deletion controls. Co-Admins, Members, inactive users, and profile-less callers do not.
- The selection surface includes Draft and Archived events, never Active events.
- A calendar-year filter narrows the displayed results before selection. Bulk Select all applies only to the currently visible filtered results.
- Every destructive run requires typed confirmation and shows the exact selected count and event names before submission.
- A single selected event requires its exact event name. A multi-event run requires `DELETE <count> EVENTS` using the authoritative selected count.
- Draft and Archived rows share one Admin-only management page and one year filter.
- Disable duplicate submission, preserve the selection on partial failure, and return a per-event success/failure/cleanup-warning report.
- The client treats the list as advisory. Each RPC call re-checks the real stored status and caller.
- A stale event that became Active is rejected even if it remained selected in the browser.
- Successful deletion invalidates Home, Archives, event, activity, and relevant task/feed queries. It does not claim that a failed banner cleanup also succeeded.

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
- Batch 13b’s later completed-phase guard must permit only this approved whole-event cascade and must not create another event deletion path.

## Security risks

- A broad exception in the Archived trigger can turn permanent records writable. Bind the exception to the exact RPC execution boundary and assert it in the catalog.
- Allowing raw Admin DELETE alongside the RPC bypasses confirmation, stale checks, and result reporting. Make the RPC the only authenticated path.
- Dropping the activity FK without replacing DELETE logging leaves future delete entries null; changing snapshots or grants would weaken audit integrity.
- Reading orphaned activity by joining only live tasks can hide all history or accidentally unmask confidential snapshots. The reader needs an explicit deleted-record branch.
- A client-supplied banner path can delete another event’s object. Return/derive the exact stored identity server-side and validate the expected event folder.
- Deleting Storage first can lose a banner while a database rejection leaves the event intact. Database deletion must happen first.
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

Create `docs/phase-4b/step-13d-tests.md` when the batch lands. Include independent rollback-safe Dev SQL pastes ending in the intentional `TEST RESULTS` exception, focused route/result tests, and a manual destructive-flow checklist using disposable Dev fixtures only.

Cover active/inactive/profile-less Admin, Co-Admin, and Member callers; Draft, Active, Archived, unknown, stale, and double-submit cases; raw DELETE denial; exact one-row effects; event/task/work-link/comment/volunteer/archive-viewer/notification cascades; dependency chains; completed and incomplete tasks; concurrent lifecycle change; Archived guard non-regression; retained UUIDs in INSERT/UPDATE/DELETE activity rows; historical null preservation; immutable log grants/policies; confidential orphan masking; year filtering; visible-only bulk selection; typed confirmation; partial results; exact banner object cleanup; wrong-path rejection; and Storage cleanup failure after successful database deletion.

Pin `delete_event()` signature/owner/security/search path/grant/no-overload status, the exact deletion executor boundary, event/task/child trigger definitions and order, removal of only the activity task FK, retained activity indexes/immutability, raw event delete closure, and zero unintended task writers.

## Manual checklist

- As an Admin, use the single management page to filter disposable Draft and Archived fixtures by year. Type the exact event name for one deletion and `DELETE <count> EVENTS` for a bulk run; verify the per-event report.
- Confirm Draft and Archived fixtures disappear with their tasks/children while their activity rows retain task UUID values.
- Select or directly call deletion for an Active event; confirm it remains intact.
- As a Co-Admin, Member, inactive Admin, and profile-less caller, confirm controls are absent and direct calls fail without event probing.
- Attempt raw DELETE and direct Archived task/child deletes; confirm the RPC exception does not make them writable.
- Review deleted confidential history as each approved Activity Log role and confirm masking remains correct with no live task row.
- Delete an event with a banner and confirm only its exact object is removed after database success. Exercise a simulated cleanup failure and confirm the deletion result reports an orphan warning rather than false rollback or full success.
- Confirm repeated submission is safely reported and cannot delete an unrelated event.

## Acceptance

One authenticated `delete_event()` RPC is the only application path for event deletion. It permits only active Admins deleting a real Draft or Archived event, rejects Active and every unauthorized/stale case, preserves ordinary Archived immutability, and cascades event children atomically. Immutable activity rows survive with retained task UUIDs and safe confidential masking after live rows disappear. One Admin-only management page provides the year filter, exact event-name confirmation for one deletion, `DELETE <count> EVENTS` for bulk, visible-result selection, and per-event reporting. Existing event banners receive exact server-only post-database cleanup with honest warning behavior on Storage failure.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod application without owner confirmation.
- Add `docs/phase-4b/step-13d-tests.md`.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with the final deletion RPC, raw-delete closure, guard exception, activity UUID/no-FK contract, cascade behavior, and banner cleanup boundary.
- Add Batch 13d objects and constraint/trigger changes to the post-13b authoritative Phase 4B catalog and Batch 14 allowlists.
