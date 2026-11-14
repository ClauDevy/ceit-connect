# Phase 5 U4a — Task editor schedule and picker fixes

## Status

Implemented locally on `fix/task-editor-schedule-parity`. Never marked live.
Application code, tests, and documentation only; no migration or Supabase
command is part of this batch.

## Contract

- Board Live Operations accept Duty date/Call time plus optional End date/End
  time. A blank or omitted End date means the Duty date, preserving old browser
  tabs during deployment.
- Stored call/end timestamps are split in `Asia/Manila`. Same-day tasks keep a
  blank End date so moving only Duty date moves both timestamps together;
  overnight tasks preserve their distinct Manila End date, including year
  rollover.
- Both editors share the pure schedule validator. End date cannot precede Duty
  date; on the same date, End time cannot precede Call time.
- Board edit no-op detection and unrelated edits preserve the exact stored
  schedule. Due, Duty, and End event-bound checks are changed-only for existing
  grandfathered tasks.
- Event Edit safely handles a Co-Admin with no committee, caps single assignee
  picks at 100, and scopes bulk selection and its label to the selected
  committee.

## Event-editor behavior changes

- Partial live schedules now distinguish the missing field: a missing Duty
  date reports `Choose a duty date when adding a live-duty schedule.`, while a
  missing Call time reports `Choose a call time when adding a live-duty
  schedule.`
- An End date earlier than the Duty date now reports `End date cannot be before
  the duty date.` and focuses End date. The same-date End-time rule and wording
  remain unchanged.

## Unchanged boundaries

RPC signatures, database columns and validation, task types, priorities, L1
timing, confidentiality, authorization, and stored UTC timestamps are
unchanged. Labels/headings/banner wording, Admin committee defaults,
type-toggle behavior beyond clearing all Live Operation schedule fields,
V1's past-date minimum, Event-editor confidential fields, and redesign work are
outside U4a.

## U4b follow-up

- Audit and fix the Event form's same-day-prefill trap: an explicit same-day
  End date can prevent a Duty-date-only edit from moving the whole live
  schedule. This is intentionally not fixed in U4a.

## Manual checklist

No rendered `ActiveTaskDialog` tests were added. Manually verify:

1. Edit a same-day Live Operation, change only Duty date, and confirm both Call
   and End move to that date without creating an overnight End date.
2. Edit an overnight Live Operation, change only an unrelated field, and
   confirm both stored dates and times remain unchanged.
3. Submit an unchanged same-day task and confirm `No changes to save.`
4. Create and edit overnight schedules across midnight and Dec 31/Jan 1, then
   reopen them and confirm the Manila dates and times persist.
5. Trigger each partial and chronological schedule error and confirm the exact
   invalid field receives focus.
6. Switch a scheduled Live Operation to Deliverable and confirm Duty, Call,
   End date, and End time are cleared.

## Verification

The implementation gate is `npx.cmd tsc --noEmit`, `npm.cmd run test`,
`npm.cmd run lint`, and `git diff --check`. No build is run.
