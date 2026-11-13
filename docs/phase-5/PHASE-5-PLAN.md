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
| N3a | Active-owner notification deletion, 60-day bounded read cleanup, private run history, catalog, database tests, and Prod schedule runbook | `feature/notification-housekeeping` | High | Merged and live on Dev and Prod; Prod cleanup job scheduled; first scheduled-run check pending and non-blocking |
| N3b | Notification-row Delete and inline-confirmed Clear read UI, cross-device refetch reconciliation, accessibility, motion, and UI tests | `feature/notification-housekeeping-ui` | Medium | Live on Dev and Prod (owner-confirmed 2026-11-11) |
| P1 | Web push | `feature/web-push-database` then `feature/web-push` | High | P1a and P1b live on Dev and Prod; production push proven end to end (owner-confirmed 2026-11-11) |
| D1 | Executive Dashboard database readers and authorization | `feature/executive-dashboard-data` | High | Live on Dev and Prod (owner-confirmed 2026-11-11) |
| D1b | Executive Dashboard extra database readers | `feature/executive-dashboard-extras-data` | High | Live on Dev and Prod (owner-confirmed 2026-11-11) |
| D2 | Executive Dashboard UI, empty state, discrepancy note, and shared motion | `feature/executive-dashboard` | Medium | Live on Dev and Prod (owner-confirmed 2026-11-12) |
| O1 | Simple backup runbook and proof of one real export | `feature/backup-runbook` | Medium | Done; real Prod export and matching 31-table proof recorded (owner-confirmed 2026-11-12) |
| R1 | Volunteer-offer and leave-request notifications across storage, bell, push, cleanup compatibility, tests, and docs | current feature branch | High | Live on Dev and Prod (owner-confirmed) |
| R2 | Scheduled 24-hour task due-soon and two-hour Live Operation prep reminders, private dedupe ledger, bounded runner, Prod cron runbook, Dev manual runner, tests, and docs | current feature branch | High | Live on Dev and Prod (owner-confirmed) |
| J1 | Bell and push jump-to-comment, bounded target-page loading, safe fallbacks, and stale push-target replacement | current feature branch | High | Live on Dev and Prod (owner-confirmed) |
| B2 | Local-only backup restore drill, count proof, cleanup, and disaster limitations | `docs/backup-restore-drill` | Medium | Merged; owner-run drill pending |
| U1 | Event-board initial phase, President picker exclusions, and archived-template deadline reset | `fix/event-board-template-and-picker-ux` | Medium | Implemented locally; no migration |
| U2 | Event board component split (refactor only, no behavior change) | planned UI branch | Medium | Implemented locally; UI-only, no migration |
| V1 | Manila-date Active-task deadline guard and Admin-only President committee invariant | planned database/UI branch | High | Planned; read-only Prod preflight required |
| H1 | In-app user manual at `/help`, role-aware guidance, FAQ search, and future screenshot slots | planned UI branch | Medium | Planned; UI-only, no migration |
| U3 | Optional event form component split (refactor only, no behavior change) | optional later UI branch | Medium | Optional later; UI-only, no migration |
| L1 | Live Operation START/END/running timing for priority, dashboard, and Member leave decisions | `feature/live-operation-call-time-rules` | High | Migration `20261119120000` live on Dev and Prod (owner-confirmed 2026-11-13) |
| G1 | Counts-only phone-push grouping for launch assignment, due-soon, Live Operation prep, and unlock bursts | `feature/alert-grouping` | High | Migration `20261120120000` live on Dev and Prod (owner-confirmed 2026-11-13) |

Owner-approved sequence: N1, N2, I1, N3a, N3b, P1, D1, D1b, D2, then O1. I1
started after the N2 notification UI gate and is now live. Every later batch
still completes its own plan, implementation, review, and rollout before the
next batch starts.

The approved post-J1 order is B2 (merged), U1, U2, V1, H1, then manifest
screenshots, the final release checklist, optional `discord_id` removal, and E1
only if needed. Optional U3 is a later refactor and is not part of that required
order. H1 describes the app only after U1, V1, L1, and G1 rules are in their
final state.

## Approved notification decisions

N1 plus R1 and R2 generate thirteen persistent in-app types: `mention`, `heads_up`,
`assignment`, `status_change`, `unlock`, `backup_request`, `volunteer_offer`,
`leave_requested`, `leave_cancelled`, `leave_approved`, `leave_denied`,
`task_due_soon`, and `live_operation_prep`. Actor-driven N1/R1 in-app rows are
inserted set-wise and are never throttled, delayed, or dropped. R2 is a bounded
scheduled delivery: it handles at most 100 eligible occurrences per run, may
delay later occurrences behind earlier targets, and sends nothing after a
target expires. Nobody receives a notification for their own action, including
self-claims and volunteering.
Inactive users receive no notification. Actor exclusion applies to actor-driven
types; R2 is clock-driven and has no actor.

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
- `task_due_soon`: every active current primary or assist assignee of a
  non-Completed task in an Active event, once per exact stored due timestamp
  and person while the timestamp is inside the next 24 hours.
- `live_operation_prep`: the same active assignment set for non-Completed
  Live Operations, once per exact non-null call time and person while the call
  time is inside the next two hours. `end_time` never triggers a reminder.

R2 handles at most 100 earliest-target occurrences every 15 minutes: the
accepted delivery capacity is 800 occurrences within any two-hour window and
9,600 per day, with later targets waiting behind an earliest-target-first
backlog rather than displacing reminders that are closer to expiry. A reminder
can expire unsent if the bounded backlog does not reach it before its target.

Draft and Archived events generate nothing. No-op saves do not replay rows.
R1 reverses N1's silent request decision. Member volunteer submission notifies
active Admins, the active owning-committee Co-Admin, and current primary
assignees who retain real task access. Leave submission and caller cancellation
notify active Admins and the active owning-committee Co-Admin; approval and
denial notify the requester. The actor is always excluded. Withdrawal, backup
cancellation, stale-offer cleanup, failed/repeated operations, cancel after
resolution, system-driven leave closure, and other approvers after resolution
remain silent. Confidential
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

B2 documents a local-only restore into a throwaway version-matched PostgreSQL
container, the minimum Supabase stand-ins, schema/data error handling, restored
row and catalog-count comparisons, cleanup, and the honest Auth/Storage
disaster limitations. Its documentation is implemented locally; the owner-run
drill and real result are pending. See `docs/phase-5/step-b2-restore-drill.md`.

## Owner-reported follow-up batches

### U1 — UI corrections

U1 is UI-only, needs Medium reasoning, and adds no migration.

- The event board opens on the first incomplete phase. The current cause is
  `initializePhaseDisclosure` in
  `src/lib/tasks/phase-completion.ts`: it selects the first phase as active
  while merely collapsing completed phases. Choose the first phase that is not
  complete; when all phases are complete, retain the first phase.
- Members and Co-Admins must not be selectable into the President committee;
  President remains automatic for Admins. Audit
  `src/components/users/invite-user-form.tsx`,
  `invite-officers-dialog.tsx`, and `officer-transition-dialog.tsx`.
- Archived-template imports leave due dates, call times, and end times blank
  for every Admin-imported task and every Co-Admin-owned task. Blank schedules
  remain valid for Deliverables and Live Operations; no U1 warning is added.
  Foreign-committee tasks imported by a Co-Admin still get shifted dates from
  the database function `copy_archived_template_tasks`; the reset moves to V1
  (database batch). See `docs/phase-5/step-u1-ui-corrections.md`.

### U2 — Event board component split

U2 is UI-only, needs Medium reasoning, adds no migration, and changes no
behavior. `src/components/events/event-board.tsx` is about 1,744 lines and has
no board-level test (only the progress ring has one). U2 first adds tests that
pin today's board behavior, then moves code into smaller files while preserving
the same public props, behavior, mobile layout, and shared motion exactly.

### V1 — deadline and President-committee enforcement

V1 combines database and UI work and needs High reasoning.

- Add/Edit Task cannot set a due date before today's `Asia/Manila` date. The
  active-event task writers enforce the rule and the date picker exposes the
  same minimum. Creating an event with tasks may still use past dates. An
  existing task whose date is already old remains unchanged unless edited to a
  different past date. A Live Operation call date of today remains allowed
  even after its time has passed.
- Add a database invariant that only an Admin may hold the President
  committee. First run a read-only Prod check proving no existing non-Admin
  holds it; a nonzero result requires an owner decision before implementation.
- Replace the unchanged `copy_archived_template_tasks` shifted-date behavior so
  foreign-committee tasks imported by a Co-Admin also receive blank due, call,
  and end values. This closes U1's documented UI-only limitation and the
  read-only foreign-row event-end conflict without excluding imported tasks.

### H1 — in-app user manual

H1 is UI-only, needs Medium reasoning, and adds no migration. It creates a
role-aware `/help` manual inside the authenticated app shell after U1 and V1,
using the already-live L1 and G1 rules. Its decisions, required accuracy audit,
starting content outline, FAQ, proposed outline changes, and owner-confirmation
list are in `docs/phase-5/step-h1-user-manual.md`.

### U3 — optional Event form component split

U3 is an optional later UI-only refactor with Medium reasoning and no
migration. `src/components/events/event-form.tsx` is about 2,914 lines. If U3
is scheduled, it must first pin current behavior with tests and then split the
component without changing props, behavior, mobile layout, motion, validation,
or authorization boundaries. U3 is not a Phase 5 completion requirement.

## Postponed work

These are not part of the currently implemented N1/N2 behavior:

- daily digest email;
- R2 quiet hours (not part of the deadline-reminder batch);
- `pushsubscriptionchange` recovery; a rotated browser subscription currently
  requires the person to explicitly enable notifications again in Settings;
- signed-out return to a mentioned comment. Auth, Login, and the auth callback
  remain unchanged; signed-out recipients go to Login and then Home until a
  separately reviewed validated same-origin return-path flow exists.

G1 accepted constraints remain recorded with the deferred list: a partially
read window counts both read and unread alerts; opposite person-lock order in
two large concurrent transactions may deadlock and lose one best-effort push
while retaining its bell row; delivery-run counters count one logical
window/subscription delivery rather than each queue row; and migration 82 must
be applied only after L1 migration `20261119120000_live_operation_timing_rules.sql`.

## Open items

- N3a is merged and live on Dev and Prod, and the owner-created Prod cron row is
  scheduled. Only the first scheduled-run check remains; it does not block N3b.
- I1 remains separate and live; it does not absorb push, email, or
  notification housekeeping behavior.

Discord (X1) was cancelled by the owner on 2026-11-11 and will not be built.

## Approved secure-sender decision

P1 uses no service-role exception. The isolated sender reaches only narrow
anon-key RPCs and must additionally prove a separate random capability whose
salted hash is stored in the database. P1a implements the database half; P1b
implements the isolated wake route, VAPID sender, push-only worker, explicit
per-device Settings control, and best-effort current-device sign-out cleanup.
The worker only focuses an existing same-origin window without navigating it;
it opens fixed `/` only when no same-origin window exists or focusing fails.
J1 replaces P1a's stale `/notifications` target. Deploy the tolerant app and
service worker first, then apply migration 80: the app accepts a missing
`out_comment_id`, while an old worker ignores `targetPath` and opens `/`, which
is safe. Push stays generic and carries only a validated `/tasks/{UUID}` path
with an optional exact `#comment-{UUID}` fragment.

## Phase 5 gate checks

- Phase 5 cannot be marked complete until every approved item — N1, N2, I1,
  the bell correction, N3a, N3b, P1, D1, D1b, D2, O1, R1, R2, and J1 — has completed review and
  rollout. Completion also requires B2, U1, U2, V1, and H1; B2 includes a
  completed owner-run restore drill. Optional U3 is not part of this gate.
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
- `docs/BACKUP.md` contains the approved proof from one real export and the B2
  local restore runbook, including the completed owner-run drill result.

## Final release checklist

- Set Production `ALLOWED_EMAIL_DOMAINS=cvsu.edu.ph`, redeploy, and verify one
  allowed and one rejected domain.
- Make `/api/invite` fail closed when `ALLOWED_EMAIL_DOMAINS` is absent or empty,
  and verify that behavior before final release.
