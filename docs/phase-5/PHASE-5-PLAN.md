# Phase 5 plan

This is the approved Phase 5 run map. Each batch gets its own plan, branch,
implementation run, review, and rollout. A later batch does not start until the
current batch completes its full stage order.

## Batch order

| ID | Scope | Branch | Reasoning | Status |
| --- | --- | --- | --- | --- |
| N1 | Persistent notification generation, secure readers, read-state writers, Realtime boundary, catalog, and database tests | `feature/notification-foundation` | High | Live on Dev and Prod; N1 smoke tests passed (owner-confirmed) |
| N2 | Notification bell, paged list, unread badge, individual mark-read, mark-all-read, current-user Realtime refresh, offline/refresh behavior, and shared motion | `feature/notification-bell` | Medium | Live on Dev and Prod; list/badge correction also live with no recurrence (owner-confirmed) |
| I1 | Installable app basics | `feature/installable-app` | Medium | Live on Prod (owner-confirmed) |
| N3a | Active-owner notification deletion, 60-day bounded read cleanup, private run history, catalog, database tests, and Prod schedule runbook | `feature/notification-housekeeping` | High | Applied on Dev; Paste A 38/38 and Paste B 32/32 passed; manual runner, merge, Prod application, and Prod cron pending |
| N3b | Notification-row Delete and inline-confirmed Clear read UI, cross-device refetch reconciliation, accessibility, motion, and UI tests | `feature/notification-housekeeping-ui` | Medium | Not started; begins only after N3a is merged and live |
| P1 | Web push | `feature/web-push` | High | Not started; blocked on the secure-sender decision below |
| D1 | Executive Dashboard database readers and authorization | `feature/executive-dashboard-data` | High | Not started |
| D2 | Executive Dashboard UI, empty state, discrepancy note, and shared motion | `feature/executive-dashboard` | Medium | Not started |
| O1 | Simple backup runbook and proof of one real export | `feature/backup-runbook` | Medium | Not started |

Owner-approved sequence: N1, N2, I1, N3a, N3b, P1, D1, D2, then O1. I1
started after the N2 notification UI gate and is now live. Every later batch
still completes its own plan, implementation, review, and rollout before the
next batch starts.

## Approved notification decisions

N1 generates six persistent in-app types: `mention`, `heads_up`, `assignment`,
`status_change`, `unlock`, and `backup_request`. In-app rows are inserted
set-wise and are never throttled, delayed, or dropped. Nobody receives a
notification for their own action, including self-claims and volunteering.
Inactive users receive no notification.

N3a deletes read notifications automatically 60 days after `read_at`, never
auto-removes unread notifications, processes at most 500 oldest eligible rows
per run, and retains private aggregate history for 30 days. Prod schedules the
postgres-owned runner at `15 16 * * *` UTC; Dev has no cron job. Delete-one is
active-owner-only and idempotent for absent/foreign rows; clear-read targets
account-wide caller-owned read rows, deletes unlocked rows in ID order with
`SKIP LOCKED`, and returns the removed count. N3b is a later UI-only
batch and cannot start until N3a is merged and live.

The recipient rules are:

- `mention`: each newly mentioned active person who is eligible for the task;
  the actor is excluded.
- `heads_up`: the other active primary and assist assignees. A mention wins when
  the same comment would produce both types for one person.
- `assignment`: each newly assigned active primary or assist assignee. On a
  Draft-to-Active launch, send one assignment per active person per task,
  counting a person once across both arrays.
- `status_change`: all other active primary and assist assignees.
- `unlock`: active primary and assist assignees of each newly unlocked
  dependent task, only when its prerequisite moves to Completed, the dependent
  is not Completed, and the event is Active.
- `backup_request`: all active Admins and the active Co-Admin of the task's
  committee, excluding the requester.

Draft and Archived events generate nothing. No-op saves do not replay rows.
Leave requests, cancellation, approval, and denial remain silent. Confidential
task text is resolved at read time: real access receives the title, masked
access receives a generic title with a usable task ID, and hidden access
receives the generic title with no task ID or link.

## Approved dashboard decisions

An active task belongs to an Active event and is not Completed. Count each
person once per task across primary and assist arrays. Include active members
who have zero tasks.

Level 1 is Admin-only and shows committee totals. Unassigned tasks count only
in these committee totals. Admins can see all committees. Level 2 shows
per-member bars; a Co-Admin lands on Level 2 for their own committee and cannot
receive other committees. Members have no link and are blocked by the database
or server, not only by the UI. Names and avatars remain visible, including zero
counts, and an all-zero view uses the sleeping-tiger empty state.

Tasks assigned only to deactivated people still count in the committee total
but have no member bar. The UI shows a small note when that makes the bars add
up to less than the total. Confidential tasks contribute numbers only and never
expose content.

## Approved backup proof

O1 chooses one simple export method and does not require a local PostgreSQL
installation unless no simpler safe method works. `docs/BACKUP.md` records the
date, environment, method, filename, size, operator, a successful local
open/integrity check, and a comparison of exported row counts with live row
counts. The dump stays outside the repository in a private location.

## Postponed work

These are not part of the currently implemented N1/N2 behavior:

- daily digest email;
- council-wide Discord webhook;
- Live Operation call-time rules;
- two-hour preparation reminder;
- alert grouping or coalescing;
- backup restore drill.

## Open items

- N3a requires manual Dev runner verification, merge/Prod application, and the
  owner-created Prod cron row. N3b remains blocked until N3a is merged and live.
- I1 remains separate and live; it does not absorb push, email, Discord, or
  notification housekeeping behavior.

## Open secure-sender decision

P1 cannot be designed until the owner approves a secure server-side sender
pattern that also works for any later email or Discord queue. `AGENTS.md` permits
the service-role client only in server-only code after the route or action
re-verifies a logged-in, active caller with the correct role. Background
delivery has no interactive caller, so the plan must resolve that conflict
without putting a service-role key in a client or weakening the existing rule.

## Phase 5 gate checks

- Phase 5 cannot be marked complete until every approved item — N1, N2, I1,
  the bell correction, N3a, N3b, P1, D1, D2, and O1 — has completed review and
  rollout.
- A burst of at least 40 mentions across at least three comments creates every
  persistent in-app row without loss or delay.
- After an offline notification, refresh restores the correct unread count and
  paged list from the database. Realtime listens only for new rows belonging to
  the current user.
- Draft, Archived, no-op, inactive-recipient, revoked-access, self-action, and
  leave-silence cases pass their documented checks.
- Installable app basics and web push pass their batch-specific browser,
  permission, reduced-motion, and security checks.
- Admin, Co-Admin, and Member dashboard authorization and every approved
  counting edge case pass database and manual tests. Confidential content never
  appears in bars, counts, labels, or names.
- The bell and dashboard use the shared motion kit and have documented,
  tested reduced-motion states.
- `docs/BACKUP.md` contains the approved proof from one real export, while the
  restore drill remains postponed.

## Final release checklist

- Set Production `ALLOWED_EMAIL_DOMAINS=cvsu.edu.ph`, redeploy, and verify one
  allowed and one rejected domain.
- Make `/api/invite` fail closed when `ALLOWED_EMAIL_DOMAINS` is absent or empty,
  and verify that behavior before final release.
