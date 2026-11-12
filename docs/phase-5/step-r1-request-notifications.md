# Phase 5 R1 — request notifications

**Status:** Implemented locally; owner review and Dev rollout pending  
**Branch:** current feature branch  
**Reasoning:** High

## Goal and boundary

R1 reverses only N1's silence decision for member volunteer-offer submission
and member leave-request submission, requester cancellation, approval, and
denial. Acceptance keeps the existing `assignment` notification. Withdrawal,
backup cancellation, stale-offer sweeping, system-driven leave closure,
repeated/failed writes, and other approvers on resolution remain silent.

The tracked migration is
`20261115120000_request_notifications.sql`. The repository's latest prior
migration is `20261114120000_executive_dashboard_extras_data.sql`, documented
live on Dev and Prod. R1 is therefore later than both documented remote
boundaries. No Supabase command was used to establish or apply this state.

## Recipient and content contract

| Event | Active recipients at mutation time | Actor excluded |
| --- | --- | --- |
| Member volunteer offer submitted | All Admins, the owning-committee Co-Admin, and current primary assignees with `real` task access | Volunteer |
| Leave request submitted | All Admins and the owning-committee Co-Admin with `real` task access | Requester |
| Leave request cancelled | The same approver set, recalculated at cancellation time | Requester |
| Leave request approved | Requester only | Resolving officer |
| Leave request denied | Requester only | Resolving officer |

The shared insert helper deduplicates recipients, excludes the actor, and joins
only active profiles. Rows still contain only recipient, type, task UUID,
read time, and creation time. The unchanged N1 reader returns the actual title
only for current `real` access, exactly `Confidential Task` plus the task UUID
for `masked`, and exactly `Confidential Task` plus a null task UUID for
`hidden`. Push contains no task title, task ID, event name, or person name.

## Type decision and copies

Reusing an N1 type would make the event ambiguous and the visible copy false.
R1 therefore adds `volunteer_offer`, `leave_requested`, `leave_cancelled`,
`leave_approved`, and `leave_denied`, taking the final inventory from six to
eleven.

| Type | Bell | Generic push |
| --- | --- | --- |
| `volunteer_offer` | `{task title} has a new volunteer offer.` | `A task has a new volunteer offer.` |
| `leave_requested` | `{task title} has a new leave request.` | `A task has a new leave request.` |
| `leave_cancelled` | `A leave request was cancelled for {task title}.` | `A leave request was cancelled.` |
| `leave_approved` | `Your leave request for {task title} was approved.` | `Your leave request was approved.` |
| `leave_denied` | `Your leave request for {task title} was denied.` | `Your leave request was denied.` |

## Latest replacements: old versus new

Only two functions are replaced. No policy or public request/task writer is
replaced.

| Function | Latest definition before R1 | R1 definition | Every behavior difference |
| --- | --- | --- | --- |
| `ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])` | N1 postgres-owned `VOLATILE SECURITY DEFINER`, fixed empty path, no application-role execute; validates the six N1 types, requires a task UUID, deduplicates proposed recipients, excludes the actor, filters inactive profiles, inserts set-wise, and returns the inserted count. | Identical signature, body, owner, volatility, security, path, grants, filtering, insertion, return value, and fixed `Notification metadata is invalid.` error. The allowlist contains all eleven types. | The five R1 types are accepted. No old type, recipient, error, privilege, or insertion behavior changes. |
| `public.claim_push_deliveries(integer)` | P1 postgres-owned `VOLATILE SECURITY DEFINER`, fixed empty path; capability authentication occurs before limit validation and all queue locks/mutations; anon-only execution behind the separate capability; thirteen OUT columns; six generic-body `CASE` arms; existing cleanup, expiry, claim, lease, run-history, subscription, and active-recipient behavior. | Exact latest signature, return shape, authentication-first order, qualification, owner, security, path, grants, errors, cleanup, leasing, retry, and run behavior. Adds five generic-body `CASE` arms. | R1 queue rows now receive a non-null approved body and can be claimed. Nothing else changes; service role remains denied. |

The migration also widens, under their existing names,
`notifications_type_check` and
`push_delivery_queue_notification_type_check`. It creates private ungranted
`notify_task_volunteer_offer()` and `notify_task_leave_request()` trigger
functions plus one AFTER trigger on each authoritative child table. It adds no
table, column, index, policy, or foreign key.

## Trigger ordering and approval suppression

PostgreSQL fires same-kind triggers for the same event in trigger-name order.
For a leave approval, the relevant `AFTER UPDATE` order is:

1. `task_leave_requests_z8_notification_suppression`
2. `task_leave_requests_z8_request_notifications`
3. `task_leave_requests_z9_activity_log`

The first trigger records the exact transaction/task suppression marker. The
second independently inserts `leave_approved` for the active requester. Both
finish before the `UPDATE` statement returns to
`resolve_task_leave_request()`. That writer then calls `assign_task_people()`;
the later task update reaches `tasks_z8_notifications`, which consumes the
marker and returns before emitting assignment/status notifications. Thus the
outcome survives while the assignee-removal task notification stays silent.
R1 Paste B proves both halves and proves the marker is consumed.

## No-op, cleanup, push, and dashboard interaction

- INSERT-only volunteer generation means acceptance, withdrawal, backup
  cancellation, and stale DELETE paths are silent.
- Leave generation requires exact `pending` transitions. User cancellation
  additionally requires null `stale_reason` and `resolved_by = requester_id`.
  Machine cancellations therefore stay silent.
- Existing unique constraints reject double offers and double pending leave
  requests before an AFTER trigger can create a duplicate.
- P1's existing enqueue trigger copies the widened type into the widened queue.
  The sender payload remains exactly title/body/opaque tag.
- N3a/N3b select notifications by owner/read age, never type. Read R1 rows are
  clearable and automatically eligible after 60 days; unread rows are never
  automatically removed. Notification deletion still cascades queue work.
- D1b continues to read pending offers and leave requests directly. R1 observes
  those rows and does not change their validity, counts, ordering, or fields.

## Verification

- Paste A: `step-r1-request-notifications-catalog-tests.md` — **25/25**.
- Paste B: `step-r1-request-notifications-behavior-tests.md` — **38/38**.
- Both are single Dev-only rollback pastes with their own Auth/profile/task
  fixtures, explicit impersonation, **Run without RLS**, no temporary tables,
  and an intentional final exception.
- Local application verification uses only `npx.cmd tsc --noEmit`,
  `npm.cmd run test`, `npm.cmd run lint`, and `git diff --check`.

Local result on 2026-11-12: all **1,323/1,323** Vitest assertions pass across
128 files; lint passes with zero errors and the unrelated existing
`src/components/ui/mascot.tsx` unused-`INK` warning; and `git diff --check`
passes. The direct TypeScript check has no R1 error and remains blocked only by
the already-documented missing Next-generated `PageProps`/`LayoutProps`
globals while `.next` is absent. No build or type-generation command was run.

The owner reviews the full migration and both pastes before applying anything
to Dev. R1 does not authorize Codex to run a Supabase command.

## Files created or changed

- Migration: `supabase/migrations/20261115120000_request_notifications.sql`.
- SQL test pastes: `step-r1-request-notifications-catalog-tests.md` and
  `step-r1-request-notifications-behavior-tests.md`.
- Application/type tests: notification bell parsing/copy/rendering, push
  payload coverage, N1 migration ordering, and the R1 migration contract.
- Existing docs: N1 rows, Phase 5 notification rules/catalog, N2 bell, N3a
  cleanup, P1a/P1b push, `DATABASE.md`, `ARCHITECTURE.md`, and `PROGRESS.md`.
