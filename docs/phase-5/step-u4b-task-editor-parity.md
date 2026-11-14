# Phase 5 U4b — Task editor wording and behavior parity

## Status

Implemented locally. Application code, tests, and documentation only; no
migration, RPC, API route contract, validator, grant, policy, or President
guard changed.

## Shared editor behavior

- Admin Add Task starts with no committee in both editors and requires an
  explicit selection. Co-Admin keeps the single verified committee fixed.
- Switching Deliverable and Live Operation keeps every typed field in local
  form state. Submission blanks the schedule that does not apply to the final
  type.
- Due date is visible only for Deliverables. A new Live Operation submits the
  existing required board request key as an empty string, which remains a null
  RPC value. Event JSON likewise sends a null due date.
- Editing any existing task that finishes as a Live Operation resubmits its
  original stored due date. This includes a Deliverable whose Due date was
  edited in the form before switching type: the edited value stays in form
  state in case the user switches back, while the original stored value is
  intentionally submitted for the Live Operation.
- The V1 date-floor and event-end checks evaluate submitted values. A hidden
  kept-but-not-sent Due date on a new Live Operation cannot block saving.
- Existing same-day Live Operations reopen with blank End date; blank continues
  to mean the Duty date. Overnight End dates remain explicit.
- Untouched Event-editor tasks serialize to the same due/call/end payload as
  before, so this presentation normalization creates no spurious task update.

## Accepted behavior changes

1. New Live Operations no longer store a due date. They therefore receive no
   R2 `task_due_soon` reminder unless later changed through a separately
   reviewed surface.
2. A new Live Operation without Call/End and without a stored due date has no
   due-date fallback for the L1 Member leave-timing reference. This matches the
   existing deferred R2 decision to consider requiring Call time before launch.

Existing Live Operations keep their stored due dates, so their existing R2
targets, date display, effective-priority fallback, dashboard classification,
and leave-timing fallback are not erased by an edit.

## Wording

Both editors use `Details`, `Schedule`, and `People`; `Task title`, `Task type`,
`Duty date`, `Call time`, `End date`, `End time`, `Committee`, and `Primary
assignees`; and the dialog description `Set the task details, schedule, and
assignees.` UI copy never names a timezone.

Description, Deliverable Due date, End date, and End time retain consistent
optional hints. Duty date and Call time do not say Optional individually: the
shared helper explains that the whole Live Operation schedule may be blank,
but both start fields are required once a schedule is entered.

The title text states the real 200-character validator limit. Backlog guidance
is status-aware: new unassigned tasks start in the Backlog, while removing all
primary assignees from an In Progress task invokes the existing database rule
that resets it to To Do at the Backlog lane tail. Completed tasks are not
described as moving to Backlog.

## Deferred boundary

Event-editor confidentiality is not part of U4b. Adding `is_confidential` and
`allowed_viewers` there requires a separately reviewed database-backed reader
and writer batch.

## Verification

The required gate is `npx.cmd tsc --noEmit`, `npm.cmd run test`, `npm.cmd run
lint`, and `git diff --check`. No build or Supabase command is part of U4b.

