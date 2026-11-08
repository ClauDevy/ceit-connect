# Phase 5 N1: notification foundation

**Branch:** `feature/notification-foundation`  
**Reasoning:** High for database boundaries  
**Scope:** database generation, secure readers/mutations, Realtime table boundary,
catalog/tests/docs only. The bell UI belongs to N2.

## Goal

Create durable in-app rows for all six existing notification types while keeping
the table as the source of truth. Rows contain only recipient, type, task UUID,
read time, and creation time. Task text is resolved at read time and is always
`Confidential Task` unless the latest `task_content_access_for_user` result is
`real`.

N1 does not add a bell, email, Discord, push delivery, alert coalescing, or
retention cleanup. It does not change task Realtime.

## Current boundary and latest-policy replacement

Both policies below were created by
`20260926053015_notifications_and_activity_log.sql`; no later migration replaces
either policy before N1.

| Policy behavior | Latest definition before N1 | N1 definition |
| --- | --- | --- |
| `notifications_select_own` predicate | `USING (user_id = auth.uid())` | `USING (user_id = auth.uid() AND public.my_role() IS NOT NULL)` |
| Select effect | Any authenticated JWT could read rows for its UUID even when its profile was inactive or absent. Active users could read only their own rows. | An authenticated caller still sees only its own rows, and `my_role()` additionally requires a live active profile. Inactive/profile-less callers see zero raw rows. Authenticated table `SELECT` stays granted for personal Realtime. |
| `notifications_update_own` predicate | `USING (user_id = auth.uid())`; no explicit `WITH CHECK`, so PostgreSQL reused the `USING` expression as the update check. | `USING (false) WITH CHECK (false)` is an explicit fail-closed policy retained as a catalog boundary. |
| Update effect | Because authenticated also had table `UPDATE`, an active or inactive owner could change every mutable column on its own rows, not only `read_at`, provided the row still passed the owner check. | Authenticated table `UPDATE` is revoked, so raw updates cannot reach the policy. Only `mark_notification_read` and `mark_all_notifications_read` may change qualified own rows after an active-profile check. |
| Other DML | Authenticated had table `INSERT` and `DELETE` grants from the original default table-grant state, although RLS supplied no permissive insert/delete policies. | Authenticated `INSERT` and `DELETE` are explicitly revoked as defense in depth; trigger/private code creates rows and no application path deletes them. |

Authenticated keeps only table `SELECT` for a user-filtered Realtime
subscription. `INSERT`, `UPDATE`, and `DELETE` are revoked. The Realtime
publication change accepts both approved states: `supabase_realtime` already
publishes all tables/this table, or this table is not yet a member. The migration
adds explicit membership only when needed, so a rerun is safe.

Before applying on Dev or Prod, run this read-only preflight in that project's
SQL Editor and preserve the result:

```sql
select publication.pubname, publication.puballtables,
  count(publication_table.tablename) filter (
    where publication_table.schemaname='public'
      and publication_table.tablename='notifications'
  ) as notifications_membership_count
from pg_catalog.pg_publication as publication
left join pg_catalog.pg_publication_tables as publication_table
  on publication_table.pubname=publication.pubname
where publication.pubname='supabase_realtime'
group by publication.pubname,publication.puballtables;
```

Exactly one row is required. `notifications_membership_count` must be zero or
one; an all-tables publication is already sufficient.

## Writer-path inventory

Notification generation is attached to authoritative rows, not copied into the
many task writers. No existing task writer is replaced.

| Path | Authoritative mutation | N1 result |
| --- | --- | --- |
| Create Event with tasks | Inserts event/tasks | Draft: none. Active: one `assignment` per active assignee/task, excluding the actor. |
| Edit Event with tasks | Adds/updates/deletes tasks, then changes event status | Draft saves: none. Active task changes: assignment additions and real status changes. Draft→Active: launch trigger emits one `assignment` per active assignee/task from final stored arrays. No-op saves: none. |
| Archived template import | Creates event then copied/owned tasks | Draft: none. Active: assignment only for stored assignees; imported tasks whose assignees were wiped emit none. |
| `create_active_event_task` | Inserts one Active-event task | `assignment` for active assignees other than actor. |
| `edit_active_event_task` / `assign_task_people` | Updates assignment arrays and possibly resets status | Added people receive `assignment`; real status changes notify other remaining active assignees. Removal alone is silent. |
| `claim_task` | Adds caller as primary | Silent because the only newly assigned person is the actor. |
| Officer automatic volunteer | Adds caller as assist through `assign_task_people` | Silent because the only newly assigned person is the actor. |
| Member volunteer offer | Inserts `task_volunteers`, not tasks | Silent. |
| Volunteer acceptance | Adds the still-active volunteer as assist | `assignment` to the accepted volunteer; acceptor is excluded. |
| Backup request | `request_backup: false→true` | `backup_request` to active Admins and the active owning-committee Co-Admin, excluding requester. Cancel and no-op are silent. |
| `move_task` / raw authorized status move | Updates status/rank | Real status change emits `status_change` to other active assignees. Rank-only/no-op moves are silent. Completing a prerequisite may also emit `unlock`. |
| Reopen completed phase | Completed→In Progress | `status_change` to other active assignees; never `unlock`. Draft reopen is silent; Archived reopen remains blocked. |
| Prerequisite completion | Status becomes Completed | `unlock` only for active primary/assist assignees of non-Completed dependents in Active events. |
| Comment add/edit | Stores Heads Up and mention UUIDs | Active only. New mentions emit `mention`; Heads Up emits `heads_up` to other active assignees. Mention wins for the same recipient/comment. No-op edits and removed/unchanged mentions are silent. |
| Leave request/cancel/deny | Changes only leave-request rows | Silent. |
| Leave approval | Marks request approved then removes requester | Exact private transaction context suppresses task notifications for that task. |
| Immediate self-leave | Removes the actor | Removal itself is silent; an authoritative status reset can notify other remaining active assignees. |
| Former-member eligibility/anonymization | Refuses users with open task assignments; writes no task row | Silent. |
| Active→Archived / auto-archive | Changes event lifecycle only | Silent. Archived task/comment writes remain blocked. |

All task/comment triggers return without writing unless the parent event is
currently Active. Assignment comparisons are set-based, so order-only array
changes do not notify. Status, backup, mention, Heads Up, and launch paths all
require a real old/new transition.

## Database objects

The exact N1 object list, ownership, grants, policies, triggers, indexes, and
publication rule is in `docs/phase-5/catalog.md`.

Public readers authorize the active caller and then delegate to private
user-parameterized readers. They take no locks. Public mutations authorize the
active caller before their qualified UPDATE acquires a notification-row lock.
All functions use an empty search path; every table and ambiguous column name is
qualified.

## Confidentiality and inactive users

- Rows never store titles, descriptions, comment bodies, names, emails, or
  assignee arrays.
- `list_notifications` calls the latest
  `task_content_access_for_user(task_id,caller)` decision for every row.
- `real` returns the current title and task UUID. `masked` returns
  `Confidential Task` and keeps the task UUID so the caller can open the masked
  task. `hidden` returns `Confidential Task` with a null task UUID, so no link
  can point at a task the caller cannot open. The stored row does not change.
- Inactive recipients are filtered at insert time.
- Inactive callers cannot select through RLS or call readers/mutations.
- Admin/Co-Admin status never bypasses the personal-inbox `user_id` boundary.
- Users are never deleted by N1.

## Locks and event deletion

Notification triggers execute after already-authorized business mutations and
take no explicit application row locks. Inserting a notification still checks
its foreign keys: PostgreSQL takes a light foreign-key key-share lock on the
recipient `users` row (and the referenced task row) until the transaction ends.
This is normally compatible with other readers, but a very unusual concurrent
deactivate-while-notifying sequence may wait on that user-row lock. Reviewing
that sequence is deferred; N1 does not redesign the established lock order.

The approved leave context uses `(transaction_id,task_id)` without an
event/task foreign key. The leave-approval trigger creates the marker, and the
task notification trigger deletes that exact marker before any event-lifecycle
early return. The authoritative approval path always performs the matching
task update in the same transaction; a failure rolls back both writes. The
transaction ID and task ID prevent the marker from silencing another task or a
later transaction. It silences only notification types that would have arisen
from that task update; unrelated task/comment/event changes in the transaction
remain eligible.

No new FK references events or tasks. The existing
`notifications_task_id_fkey` remains the CCE09 inventory row at lock order 70.

## Tests and historical paste disposition

N1 owns two new self-contained Dev-only rollback pastes:

1. `step-n1-notification-foundation-catalog-tests.md`: **30/30**.
2. `step-n1-notification-foundation-behavior-tests.md`: **48/48**.

Paste B directly seeds and later removes one notification for its inactive
fixture so the owner-only raw-SELECT assertion is non-vacuous. Its mark-all
writer runs in its own statement before the separate stable unread-count check.
Its direct postgres task fixtures use the latest accepted access-writer marker
for the confidential row, independently of the assignee-writer marker. Paste A
casts `information_schema` identifiers to text before comparing its exact
suppression-context column list and checks that the latest access helper blocks
browser roles, not the intentionally server-trusted `service_role`. Paste B's
valid Draft mention targets the same-committee Co-Admin, who has real Draft
access; the trigger still writes no notification for Draft.

Frozen pastes are not edited:

- `docs/phase-4b/step-14-tests.md` is historical and expects authenticated
  notification DML. Do not rerun it after N1; replace its current-boundary role
  with N1 Paste A. Its confirmed 33/33 result remains historical evidence.
- `docs/phase-4b/step-13b-tests.md` Paste D asserts that no task notification
  trigger exists. Do not rerun Paste D after N1. N1 Paste A pins coexistence
  with the completion/leave triggers and N1 Paste B owns completion/unlock
  behavior. The other Step 13b pastes remain valid.
- `docs/PHASE-4-STEP-10-TESTS.md` retains historical counts and old current-state
  expectations. Do not use its old aggregate paste as the post-N1 catalog gate;
  use N1 Paste A and `docs/phase-5/catalog.md`.
- Step 9 TEST 5 remains valid: its ordinary comments contain neither Heads Up
  nor mentions, so they still create zero notification rows.
- Step 7B's sharing-only no-notification assertion remains valid.
- Step 13d's owner fixture insert and notification cascade checks remain valid.
- Step 10's former-member body check remains valid because anonymization still
  writes no notifications.
- Batch 14 TypeScript contracts remain historical source tests. N1 adds a later
  migration contract for the new final state rather than rewriting Batch 14.

Deferred N1 concurrency review: exercise the unusual case where one transaction
deactivates a recipient while another inserts that recipient's notification and
therefore holds the foreign-key key-share lock. No lock redesign is approved in
N1.

## Acceptance

- Paste A ends with `TEST RESULTS 30/30 PASS — transaction intentionally rolled back`.
- Paste B ends with `TEST RESULTS 48/48 PASS — transaction intentionally rolled back`.
- A 45-recipient burst across three comments creates exactly 45 mention rows.
- Refresh/offline correctness is database-backed; N2 may only invalidate and
  refetch this source of truth.
- Local verification uses only `npx.cmd tsc --noEmit`, `npm.cmd run test`,
  `npm.cmd run lint`, and `git diff --check`.

