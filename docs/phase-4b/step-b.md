# Phase 4B — Batch B: audit-log coverage

**Branch:** `feature/audit-log-coverage`  
**Status:** Stages 1, 2A, and 2B applied on Dev; Stage 3 closeout and the deletion-inventory follow-up are implemented locally and await Dev application/verification
**Run order:** after Batch A and before Batch D and Batch 14  
**Scope:** audit data and safe reader support; no Activity Log redesign

## Approved run structure

1. **Stage 1:** additive schema, protected payload contract, fixed-shape reader, system actor representation, tests and documentation.
2. **Stage 2A:** trigger writers for tasks, leave requests, volunteers, users and officer invites.
3. **Stage 2B:** event/phase/archive/delete wrappers, database-only event bulk RPC and Auth-backed former-member summary finalizer.
4. **Stage 3:** tiny copy/documentation-only closeout if browser verification finds a generic label that needs clarification.

Stage 2A and 2B were implemented in one run using two migration files so the owner can review and Dev-apply them separately. The real `docs/phase-4b/step-b-function-diff.md` compares every replacement side by side with its latest body, identifies full-body replacements versus rename-plus-wrapper replacements, and records before/after trigger order on `tasks`, `users`, `events`, `task_leave_requests`, `task_volunteers`, and `officer_invites`.

Stage 2 files:

- `20261106160000_activity_log_trigger_writers.sql`
- `20261106170000_activity_log_event_writers.sql`

Follow-up file:

- `20261107120000_event_phase_delete_lock_inventory.sql`

Stage 3 changes only Edit Event confirmation copy and documentation/tests. The form cannot move a task between phases: its task editor preserves the existing phase ID and exposes no cross-phase control. The phase-removal confirmation now says so explicitly while retaining the existing rule that persisted To Do tasks are deleted on save; no form, payload, writer, or authorization logic changes.

## Current coverage

Before Batch B, `activity_log` is task-shaped and `tasks_activity_log` records task inserts, deletes and material updates other than rank-only `sort_order`/`updated_at` changes. Task History calls the same `list_activity_log()` reader with `p_task_id`.

It does not provide semantic event, phase, leave-request, volunteer, people/officer or bulk-operation entries. `task_leave_requests` retains request state only while its task exists, `officer_invites` retains officer invitation state, and `task_volunteers` retains only current offers.

## Access confirmation

- `/activity-log` calls `requireUser()` and `getActiveProfileForRoles(["Admin", "Co-Admin"])`; only active Admins and active Co-Admins can open the page.
- Task History is rendered on a task page an active Admin, Co-Admin or Member can open. The reader additionally requires real task-content access; a Member must also be a primary or assist assignee.
- A direct global reader call by a Member is rejected with `CAL01`. A task-scoped call filters by the supplied `task_id`, so it cannot return people, officer, event-level, phase or bulk rows. This is the database-level Member safety net.
- Active Admins and active Co-Admins see all people, officer-role, Admin-on-Admin, event and bulk entries. There is no committee-based audience restriction.
- The existing committee filter stays. Person entries store both old and new committee IDs, and the filter matches either.
- Confidential task content remains masked for every caller without real task access, including Admins and Co-Admins.
- A masked task row keeps the old reader contract: `task_id`, `actor_name`, and `change_summary` are all null. Only an existing live task ID is returned; deleted and orphan task rows never receive a UI link target.
- Admins always see protected phase text. Co-Admins see it only with real access to at least one affected surviving task. Removed, orphaned and old-renamed phase text is Admin-only; otherwise the reader returns `Event phases updated`.

## Stage 1 delivered design

Migration: `20261106150000_activity_log_subjects.sql`.

The migration adds:

- private `ceit_connect_private.activity_type_catalog`;
- `actor_kind`: `user`, `system`, or `unavailable`;
- `subject_kind`: `task`, `event`, `phase`, `person`, or `bulk`;
- semantic `activity_type`;
- non-cascading `event_id` and `subject_user_id` (an officer invitation may use only its `invite_id` before an Auth/profile UUID exists);
- `task_was_confidential` on every new task-subject row;
- the narrowly constrained `task_title_snapshot` exception;
- the separately constrained event-delete name snapshot inside the protected payload;
- a private event-status visibility predicate matching effective `events_select`;
- an exact-signature/exact-output replacement of `list_activity_log()`.

The existing `action` remains `INSERT`, `UPDATE`, or `DELETE` for unchanged filters and badges. `activity_type` carries the semantic operation.

The system actor has no user ID and is presented as `System`. Stage 1 adds no activity writer, and no Batch B writer may impersonate a user. Batch D remains the first planned system writer.

Legacy task rows keep their existing reader branch. Paging remains keyset-based and scan-capped at 2,000 candidates plus the overflow sentinel. Philippine date handling, literal search, the fixed output shape, grants and the 30-day purge contract remain unchanged.

The existing Activity Log row component already tolerates `task_id = null`: `activityOpenTaskHref()` requires a canonical task UUID, real event name, unmasked row and non-DELETE action. Deleted, orphan and non-task rows therefore receive no task link. `Unavailable actor` already exists; Stage 1 supplies `System` from SQL. No component, restyle or layout change was needed.

## Deleted-task title exception

Every new task-subject row stores its confidentiality boolean.

The sole approved IDs-only exception is `task_deleted`:

- the Stage 2 writer may store the deleted title only when there is at least one retained activity row and every retained row proves the task was never confidential;
- the proof combines legacy snapshots and semantic `task_was_confidential` values and fails closed on malformed evidence;
- zero retained rows set `task_was_confidential=false`, store no title, and read as `Deleted task` to both active Admins and Co-Admins;
- only active Admins and Co-Admins receive that snapshot;
- a Member receives `Deleted task` if they can exercise a task-scoped test path;
- an ever-confidential task stores no title snapshot and displays `Deleted task`;
- no other new activity type stores a task title;
- event, phase and bulk entries never store task names;
- the snapshot is covered by the existing 30-day purge.

Per-task DELETE rows created by whole-event deletion are retained, not suppressed, and use this same rule.

## Event-delete name exception

`event_deleted` alone may store the former event name as `changes.event_name`, within the existing 1–150 character event-name limit. A CHECK rejects that key for every other activity type. Active Admins and Co-Admins may see the snapshot; a missing live event with no snapshot displays `Deleted event`. The value remains inside the protected payload, is covered by the 30-day purge, and is never copied into phase, bulk, or task rows. Event-level, phase, and bulk rows still never carry task names.

## Assignment and leave display names

No new column or name snapshot is used. `task_assigned` and `task_unassigned` store only a validated UUID array in `user_ids`; approved, rejected, and cancelled leave rows store only a validated `requester_id` UUID. The reader resolves current names only after the row is proven unmasked. Missing or anonymized profiles display as `Former member`; assignment summaries show at most three names and then `and N more`.

## Person payload contract

Every person entry stores in its protected payload:

- `old_committee_id` (UUID or JSON null);
- `new_committee_id` (UUID or JSON null);
- `target_role` at action time.

The reader never derives committee audience/filter facts from the live user row. This is required because anonymization can change profile data. Names and committee names are resolved only for display.

## Activity type contract

The Stage 1 SQL tests compare the database catalog with this table.

| `activity_type` | Broad | Subject | Audience | Reader summary | Allowed payload keys |
|---|---|---|---|---|---|
| `event_created` | INSERT | event | Admin + Co-Admin, effective event visibility | Event created | `event_status` |
| `event_created_from_template` | INSERT | event | Admin + Co-Admin, effective event visibility | Event created from archived template | `event_status`, `source_event_id` |
| `event_edited` | UPDATE | event | Admin + Co-Admin, effective event visibility | Event edited | `event_status`, `changed_fields` |
| `event_launched` | UPDATE | event | Admin + Co-Admin, effective event visibility | Event launched | `event_status`, `old_status`, `new_status` |
| `event_archived` | UPDATE | event | Admin + Co-Admin, effective event visibility | Event archived | `event_status`, `old_status`, `new_status` |
| `event_deleted` | DELETE | event | Admin + Co-Admin, stored former visibility | Event deleted | `event_status`, optional `event_name` |
| `phase_added` | INSERT | phase | leadership; phase-text rule | Phase added | `event_status`, `phase`, `position`, `affected_task_ids` |
| `phase_renamed` | UPDATE | phase | leadership; phase-text rule | Phase renamed | `event_status`, `phase`, `old_phase`, `new_phase`, `old_position`, `new_position`, `affected_task_ids` |
| `phase_moved` | UPDATE | phase | leadership; phase-text rule | Phase moved | `event_status`, `phase`, `old_position`, `new_position`, `affected_task_ids` |
| `phase_removed` | DELETE | phase | leadership; Admin-only text | Phase removed | `event_status`, `phase`, `old_position`, `affected_task_ids` |
| `task_created` | INSERT | task | current real task access | Task created | `event_id`, `committee_id` |
| `task_updated` | UPDATE | task | current real task access | Task updated | `event_id`, `committee_id`, `changed_fields` |
| `task_deleted` | DELETE | task | task access; title exception above | Task deleted | `event_id`, `committee_id` |
| `task_assigned` | UPDATE | task | current real task access | Task assigned | `event_id`, `committee_id`, `user_ids` |
| `task_unassigned` | UPDATE | task | current real task access | Task unassigned | `event_id`, `committee_id`, `user_ids` |
| `task_left` | DELETE | task | current real task access | Left task | `event_id`, `committee_id`, `user_id` |
| `task_leave_requested` | INSERT | task | current real task access | Leave request sent | `event_id`, `committee_id`, `request_id`, `requester_id` |
| `task_leave_approved` | UPDATE | task | current real task access | Leave request approved | prior keys + `resolver_id` |
| `task_leave_rejected` | UPDATE | task | current real task access | Leave request rejected | prior keys + `resolver_id` |
| `task_leave_cancelled` | DELETE | task | current real task access | Leave request cancelled | prior keys + `resolver_id`, `reason_code` |
| `task_backup_requested` | INSERT | task | current real task access | Backup requested | `event_id`, `committee_id` |
| `task_backup_cancelled` | DELETE | task | current real task access | Backup request cancelled | `event_id`, `committee_id` |
| `task_volunteered` | INSERT | task | current real task access | Volunteered for task | `event_id`, `committee_id`, `user_id` |
| `task_status_changed` | UPDATE | task | current real task access | Task status changed | `event_id`, `committee_id`, `old_status`, `new_status` |
| `task_confidentiality_changed` | UPDATE | task | current real task access | Task confidentiality changed | `event_id`, `committee_id`, `old_confidential`, `new_confidential` |
| `member_invited` | INSERT | person | Admin + Co-Admin | Member invited | old/new committee, target role |
| `officer_invited` | INSERT | person | Admin + Co-Admin | Officer invited | old/new committee, target role, `invite_id` |
| `invitation_cancelled` | DELETE | person | Admin + Co-Admin | Invitation canceled | old/new committee, target role, `invite_id` |
| `officer_added` | INSERT | person | Admin + Co-Admin | Officer added | old/new committee, target role |
| `person_deactivated` | UPDATE | person | Admin + Co-Admin | Person deactivated | old/new committee, target role |
| `person_reactivated` | UPDATE | person | Admin + Co-Admin | Person reactivated | old/new committee, target role |
| `person_removed` | DELETE | person | Admin + Co-Admin | Former member removed | old/new committee, target role |
| `committee_changed` | UPDATE | person | Admin + Co-Admin | Committee changed | old/new committee, target role |
| `appointed_coadmin` | UPDATE | person | Admin + Co-Admin | Appointed Co-Admin | old/new committee, target role |
| `appointed_admin` | UPDATE | person | Admin + Co-Admin | Appointed Admin | old/new committee, target role |
| `returned_to_member` | UPDATE | person | Admin + Co-Admin | Returned to Member | old/new committee, target role |
| `admin_stepped_down` | UPDATE | person | Admin + Co-Admin | Admin stepped down | old/new committee, target role |
| `bulk_events_deleted` | DELETE | bulk | Admin + Co-Admin | `N events deleted` | `count`, `ids` |
| `bulk_members_removed` | DELETE | bulk | Admin + Co-Admin | `N members removed` | `count`, `ids` |

There is no separately persisted pending ordinary-Member invitation to cancel: `finalize_member_invite()` creates the profile and writes `member_invited` transactionally. A pending officer invitation is cancelled through the existing officer-invite cancellation boundary; the resulting `officer_invites` status update writes `invitation_cancelled` with IDs, role and committee only, never the invitee email or name.

## Event visibility parity

No existing shared helper implements the full effective `events_select` predicate. Stage 1 therefore adds a private predicate that mirrors the live policy exactly:

- Draft requires an active Admin or Co-Admin through `my_role()`;
- Batch 14 supersedes the former independent `status <> 'Draft'` branch: every status now requires an active profile, while active Admins and Co-Admins retain Draft access;
- `list_activity_log()` separately rejects inactive and profile-less callers before evaluating any event row.

The SQL paste compares the helper against RLS results for Admin, Co-Admin, Member and inactive callers across Draft, Active and Archived fixtures, and separately proves the activity reader still rejects the inactive caller. The non-Draft inactive-policy gap remains a Batch 14 finding and is not fixed here.

## Stage 2 actor and write-path matrix

No actor value is accepted from a browser payload. Writers use `auth.uid()`, a locked row’s stored user ID, or an existing private deletion context.

Every Stage 2 writer sets a non-null `actor_kind`, including the rewritten legacy task trigger, `move_task` through that trigger, and the event-delete writers. The Stage 2 SQL paste executes representative writer paths and proves that none of their newly inserted rows has an empty `actor_kind`. The validated private `write_activity` insert helper and the 100-character protected phase-text cap land in Stage 2A.

| Table/path | Current write path | Actor | Stage 2 source |
|---|---|---|---|
| events create | `create_event_with_tasks`, `create_event_from_archived_template` | authenticated caller | `auth.uid()` in wrapper after authorization |
| events edit/launch | latest Batch A `edit_event_with_tasks` | authenticated caller | `auth.uid()` after authorization, inside retained locks |
| events archive | `archive_event` | authenticated Admin | `auth.uid()` after authorization/event lock |
| events delete | `delete_event` / private delete context | verified passed Admin | existing private event-delete actor context, never client-trusted |
| tasks create/update/delete through event writers | latest create/edit/template bodies | same authenticated event actor | exact private writer marker plus `auth.uid()` |
| tasks Active add/edit/delete | `create_active_event_task`, `edit_active_event_task`, `delete_task` | authenticated caller | `auth.uid()` observed by task trigger |
| tasks board/status/order | `move_task`, assignment/claim/backup/confidentiality writers | authenticated caller | `auth.uid()`; rank-only updates remain suppressed |
| tasks event cascade delete | private event-delete path | verified event-delete actor | existing private deletion context fallback |
| users Member invite | `finalize_member_invite` | authenticated Admin/Co-Admin | `auth.uid()` and AFTER users trigger |
| users officer add | officer finalization in `invite_new_officer` | authenticated Admin | `auth.uid()` and exact officer marker |
| users officer roles | appoint/return/move/step-down functions | authenticated authorized caller | `auth.uid()` and exact officer marker |
| users Co-Admin Member lifecycle | deactivate/reactivate committee-member RPCs | authenticated Co-Admin | `auth.uid()` |
| users Admin officer lifecycle | Batch A `set_officer_active` | authenticated Admin | `auth.uid()` after officer/user locks |
| users anonymization | Batch A `anonymize_former_member` | authenticated Admin | `auth.uid()` after officer/user locks |
| users ordinary-Member Admin branch | `/api/toggle-user-active` direct service-role update | unavailable | `actor_kind='unavailable'`; no route change in Batch B |
| users non-lifecycle profile edits | own/full-name/avatar/Discord paths | none | users trigger writes nothing |
| officer invites prepare/finalize | `invite_new_officer` | authenticated Admin | `auth.uid()`; never invite email/name |
| officer invite cancel | `cancel_officer_invite` | authenticated Admin | `auth.uid()` |
| leave request insert | `unassign_self` | authenticated requester | `auth.uid()` / stored requester ID |
| leave approve/reject/cancel | resolve/cancel RPCs | authenticated resolver/requester | `resolved_by` or authenticated caller |
| stale leave cancellation | task/event cleanup triggers | initiating authenticated action when present | `auth.uid()`; Batch B does not call this a system action |
| volunteers insert | `volunteer_for_task` | authenticated volunteer | `auth.uid()` / inserted `user_id` |
| volunteer cleanup | withdraw/accept/backup/task cleanup | initiating caller | no false new-volunteer entry; resulting task actions remain audited |

The direct service-role ordinary-Member branch is confirmed in `src/app/api/toggle-user-active/route.ts`. It updates `users` without a database RPC or private actor context. Batch B does not change that route and records its lifecycle entry with `actor_kind='unavailable'` so the live action does not begin failing.

This is the second narrow exception to perfect actor/summary attribution:

1. an Auth-backed former-member bulk can complete external work while its aggregate summary finalizer fails twice; individual `person_removed` rows still exist and the route surfaces the aggregate failure;
2. the existing direct service-role ordinary-Member active-state branch has no trustworthy database actor and is logged as `Unavailable actor`.

Known limitation of the first approved exception: the finalizer considers only newly anonymized IDs from the current route run. Batch B deliberately does not reconcile an earlier run whose `person_removed` rows committed but whose summary finalizer failed twice; those earlier rows remain individually auditable without a later aggregate summary.

Batch 14 must close the second exception by moving that service-role profile update behind a narrow actor-aware database boundary. Batch B records the handoff here but does not edit the Batch 14 list.

## Stage 2 Edit Event output

- `event_edited` is written only when event metadata or submitted task/phase content actually changes. Its payload contains changed-field codes only.
- Phase positions are read after Batch A’s explicit reconciliation call, never from the deferred trigger.
- The wrapper passes transaction-local canonical `{from,to}` rename pairs to the task trigger and clears them on success and error. Only a task phase change matching a pair is suppressed; a task moved to a different phase in the same save still writes `task_updated` with `phase`.
- `phase_moved` compares dense ranks among surviving phases before and after the save, mapping rename destinations back to their sources. Removing a phase does not falsely mark later survivors as moved.
- One save that renames `A` to `B` and then reorders it writes:
  - one `event_edited` if the save changed persisted state;
  - one `phase_renamed` for `A` → `B`;
  - one `phase_moved` for each surviving phase whose dense survivor rank changes;
  - no duplicate phase-only `task_updated` rows.
- A single-task phase edit on an Active event does not create an event-wide `phase_added` entry; the accepted record is the task’s `task_updated` row with the `phase` field.

## Stage 2 bulk behavior

Database-only event bulk deletion keeps the existing per-item success/failure states and route response shape. Up to ten event IDs are sorted before locking; successful item subtransactions and the one summary commit together. The transaction holds every successful item’s event, advisory, task and child locks until the outer call commits, increasing lock duration compared with today’s sequential RPCs but preventing a summary from committing separately. Paste D times one call deleting 10 events with 200 tasks each and prints `elapsed_ms`. The same ten-event timing must also be run once through the real `/api/event-deletion` route because SQL Editor and API-role timeouts differ. If either Dev result is close to its statement/route limit, the implementation must be revised to keep deletions sequential and write the summary afterward, matching the member-bulk pattern, before approval.

Bulk summaries are additional to per-item rows:

- Removing 10 members writes exactly 10 `person_removed` rows plus 1 `bulk_members_removed` row: **11 rows**.
- Deleting 10 events writes exactly 10 `event_deleted` rows, 1 `bulk_events_deleted` row, and one `task_deleted` row for every deleted task: **11 + the total task count across those events**. Ten empty events therefore write 11 rows.

`finalize_former_member_bulk_activity` must:

- require 2–50 unique IDs;
- prove each ID has a `person_removed` entry by the same actor in the last 15 minutes;
- reject an ID already covered by `bulk_members_removed`;
- be retry-idempotent and reject forged/duplicate summaries;
- retry once in the route and surface a clear error after the second failure.

## Retention and immutability

The 30-day scalar, guarded 5,000-row purge, delete/truncate guard and all direct table revokes remain unchanged. Event/person IDs have no cascading foreign keys. Event deletion retains both the event row and its per-task DELETE rows in activity.

## Event-deletion inventory follow-up

Batch A added `ceit_connect_private.event_phase_positions.event_id -> public.events.id ON DELETE CASCADE` after Batch 13d had pinned its fail-closed deletion inventory. With Batch A present, the old exact-count check correctly raises `CCE09` before deletion because that ninth foreign key is not registered. This affects Prod event deletion today wherever Batch A is applied but the follow-up is not: Batch B is not required to trigger the failure, because the Batch 13d single-delete locker already performs the exact inventory check.

`20261107120000_event_phase_delete_lock_inventory.sql` adds only the reviewed `event_child_rows` inventory kind and the phase-position row at order 90, then replaces the private locker so event-child rows are locked by `event_id`. It changes no public function, role, grant, authorization predicate, or caller input. The established outer sequence remains authorization before locks, then event row -> event advisory -> task rows. Existing task-child locks remain orders 30–80; the new phase-position lock is appended at order 90. The tracked schema contains no other unregistered foreign key to `events` or `tasks`; Paste E proves both directions of exact catalog parity on the target database before exercising a real delete.

## Verification

Only these local commands are allowed:

```text
npx.cmd tsc --noEmit
npm.cmd run test
npm.cmd run lint
```

Never build, commit, push or run a Supabase command for Batch B.

All SQL verification is in `step-b-tests.md`: Paste A expects 41 lines, B 31, C 38, D 32, and follow-up Paste E 12, for 154 evaluated result lines. Paste D also prints the measured 10-large-event elapsed time. The revised pastes and follow-up have not yet been rerun on Dev.

## Unrelated findings — listed, not fixed

1. `move_task()` takes event/advisory/phase locks before caller authorization.
2. `notifications_update_own` does not limit changed columns to `read_at`.
3. A failed single-task delete can render its error behind the confirmation dialog.
4. `/api/toggle-user-active` can report success after a zero-row service-role Member update.
5. That route may expose raw backend error text.
6. Ordinary-Member Auth ban/unban and Co-Admin avatar-policy behavior remain separate follow-ups.
7. First-sign-in/invitation-acceptance activity is intentionally deferred.
8. Batch 14 closes the former inactive authenticated non-Draft read and replaces this batch's private event-status helper with the same active-profile predicate.
9. The archived-task-list test emits React’s warning for a non-boolean `interactive=true` DOM attribute.
10. `src/components/ui/mascot.tsx` retains the pre-existing unused `INK` constant lint warning.
11. The local `.next/dev/types` cache contains duplicated/truncated generated fragments, so `npx.cmd tsc --noEmit` currently stops on three parser errors in generated `routes.d.ts`/`validator.ts` before checking project source. Stage 3 does not delete or regenerate build output.

## Catalog handoff

Batch 14 must later absorb the additive columns/constraints, every new catalog object, the event-visibility helper, replaced reader, Stage 2 writers/triggers/wrappers, grants/revokes (including `write_activity` execute for `ceit_event_delete_executor`), revoked prior bodies, and the direct service-role unavailable-actor exception. Batch B records that handoff here but does not edit the Batch 14 or Deferred lists.
