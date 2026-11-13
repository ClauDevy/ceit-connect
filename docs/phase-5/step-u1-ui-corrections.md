# U1 — event-board, President-picker, and template-import corrections

## Status and boundaries

U1 is implemented locally on `fix/event-board-template-and-picker-ux`. It is
UI/app-code only: no migration, database function, RLS policy, API
authorization, Supabase setting, or mobile/motion contract changes.

The database enforcement for President membership and the remaining
Co-Admin template-copy schedule behavior belong to V1.

## Event-board initial phase

`initializePhaseDisclosure` now selects the first phase that is not complete.
If every phase is complete, it retains the first phase; if there are no phases,
the active phase is `null`. The existing set of completed named phases remains
collapsed, and `Unphased` retains its existing non-completing behavior.

The caller audit found:

- `EventBoard` changes on first mount and full reload because its state is
  initialized from `initialTasks`.
- `reconcilePhaseDisclosureAfterRefresh` is unchanged. Polling, focus refresh,
  task mutations, committee-filter data changes, and other board updates keep
  a selected phase while it still exists; the existing fallback remains the
  first available phase only when the selection disappears.
- The Draft event form shares the disclosure helper, but it consumes only the
  completed-phase collapse state, so its visible initial phase behavior does
  not change.
- Archived events use `ArchivedTaskList`, not `EventBoard`, so their grouped
  presentation does not change.
- Explicit phase selection, Reopen focus, mobile lanes, and shared motion are
  unchanged.

## President committee choices

All member/Co-Admin committee inventories now share
`getMemberCommitteeChoices`. It excludes the canonical unique lookup name
`President`. This name is the stable cross-environment key available in the
current schema: committee UUIDs are generated independently in each project,
and there is no separate slug column.

The filtered inventory is used by:

- the Admin Member-invite picker in `invite-user-form.tsx`;
- the Co-Admin row picker in `invite-officers-dialog.tsx`; and
- appoint, return-to-member, move-committee, and Admin step-down flows in
  `officer-transition-dialog.tsx`, including the users-table entry points.

An existing non-Admin who already holds President is handled safely. The
transition dialog shows `President` as a read-only current-committee value,
shows a separate empty normal-committee picker, and requires a normal choice
before submission. The hidden President ID is never silently resubmitted.

The Admin officer paths remain automatic: selecting Admin clears
`committeeId`, and the existing request submits `null`. Admin profiles retain
the established `committee_id = null` model; they do not select the President
lookup row. Task owning-committee pickers and event/task filters intentionally
keep President because work may legitimately belong to that committee.

This is a UI exclusion, not a security guard. V1 adds the database invariant
that only Admins may hold President.

## Archived-template schedules

The archive response remains strictly parsed. After parsing, every editable
imported row has `dueDate`, `callDate`, `callTime`, `endDate`, and `endTime`
reset to blank. This covers every Admin import and a Co-Admin's own-committee
rows. Title, description, committee, phase and source order, task type,
priority, `To Do` state, empty assignees/backlog behavior, source task ID, and
template editability/exclusion flags are unchanged. Existing stored events and
tasks are unaffected because the reset runs only during import.

Deliverable due dates are optional. A Live Operation with every schedule field
blank also passes the existing form validation; only a partial Live Operation
schedule is rejected. Draft save and launch both accept blank task schedules,
while launch still requires the event name, start/end dates, at least one task,
and valid phase names. The task editor already labels every schedule control
optional, so no new U1 warning is added. An imported editable task has no date
badge, and its editor opens with blank optional controls.

An unscheduled Live Operation never reaches L1 effective-time escalation and
never produces an R2 prep reminder until a call time is set. The separate
product decision “consider requiring a call time before launch for Live
Operations” is deferred.

### V1 database gap

Foreign-committee tasks imported by a Co-Admin still get shifted dates from the
database function `copy_archived_template_tasks`; the reset moves to V1
(database batch). U1 does not change that function and does not exclude any
task. Those foreign rows retain their shifted dates in the read-only preview so
the form does not pretend the database will save blank values.

The event-end audit found that `tasksAfterEventEnd` scans every imported row in
`phases`, including `templateEditable: false` foreign-committee rows. When a
shifted foreign schedule exceeds the proposed event end date, the Co-Admin
sees an alert on Fundamentals:

> The event cannot end on [date] because these tasks are scheduled later:

The list names the read-only task and shows each applicable `Due`, `Call`, or
`Ends` date. Save Draft and Launch Event then stop with:

> Move the listed task schedules on or before the new event end date before saving.

The Co-Admin cannot edit that foreign row. U1 deliberately preserves this
behavior; V1 removes the copied dates and therefore removes this conflict.

## Automated coverage

- `phase-completion.test.ts` covers first incomplete, middle incomplete, all
  complete, no phases, collapse preservation, Strict Mode determinism, and
  selection preservation across refresh.
- `committee-options.test.ts` covers the stable key, exclusion, and retained
  order. User UI contracts cover all three pickers, unchanged automatic Admin
  paths, and the safe legacy-President transition.
- `template-import.test.ts` covers blank schedules and exact preservation/order
  of every non-schedule parsed field. The event-form contract pins that only
  editable Admin/own-committee rows receive the reset and foreign read-only
  rows retain the server-derived schedule preview.

## Manual verification

1. Open Active boards whose first incomplete phase is first, middle, all
   complete, and absent; reload and allow a refetch, confirming manual phase
   selection is preserved after the initial choice.
2. On desktop and phone, check Member invite, officer invite, appoint,
   return-to-member, move-committee, and step-down paths. President must not be
   selectable for Member/Co-Admin results. An existing President-assigned
   non-Admin must show the read-only current value and accept a normal
   replacement. Admin must still submit without a committee.
3. Import an archive as Admin and confirm Deliverable and Live Operation
   schedule controls are blank while all other task content and order remain.
4. Import as Co-Admin and confirm own rows are blank; foreign rows remain
   present, read only, and scheduled until V1. Tighten the event end before one
   foreign schedule and confirm the exact alert/blocking behavior above.
5. Save a Draft and launch with an entirely blank Live Operation schedule.
   Confirm no new warning appears. Remember that it will not escalate or send
   a prep reminder until a call time is later supplied.
6. Confirm mobile layout, reduced motion, phase disclosures, and existing task
   and event committee filters are visually unchanged.

## Validation record

- `npx.cmd tsc --noEmit` — U1-clean; exits nonzero only for the documented
  missing Next-generated `PageProps`/`LayoutProps` globals in two existing
  pages and the root layout while `.next` is absent.
- `npm.cmd run test` — U1 passes; 1,373/1,376 tests pass across 130/131 files.
  The only failures are three unrelated, pre-existing CRLF-sensitive J1
  source assertions in
  `mention-comment-target-migration-contract.test.ts`. No J1 or migration file
  was changed.
- `npm.cmd run lint` — exits zero with the one unrelated existing unused `INK`
  warning in `src/components/ui/mascot.tsx`; U1 adds no warning.
- `git diff --check` — passes.

No build, Git operation, Supabase command, browser automation, or application
launch is part of U1 validation.

## Unrelated issues observed

- The three J1 source-contract assertions compare LF-only string fragments
  against CRLF checkout content. They remain outside U1.
- `src/components/ui/mascot.tsx` retains its pre-existing unused `INK` lint
  warning.
- The archived-task rendered test still prints its known non-failing
  `interactive` DOM-attribute warning.
