# D1 Executive Dashboard data readers

D1 is database-only. Migration
`20261113120000_executive_dashboard_data.sql` adds three authenticated public
readers and one ungranted private aggregate. It adds no table, policy, trigger,
foreign key, service-role path, UI, route, or application code, and it replaces
no existing function.

## Reader contract

- `public.list_executive_dashboard_committee_totals()` is Level 1. It returns
  every retained committee, including zero-task committees, ordered by
  committee name and UUID. Only an active Admin may call it.
- `public.get_executive_dashboard_committee_summary(uuid)` is the Level 2
  summary. It returns the selected committee even when that committee has no
  active members.
- `public.list_executive_dashboard_committee_members(uuid)` is the Level 2
  member list. It returns one row per active profile currently belonging to
  the selected committee, including zero-task people, ordered by full name and
  UUID. The committee's Co-Admin is an ordinary active committee profile and
  receives a normal member bar.
- `ceit_connect_private.executive_dashboard_committee_counts(uuid)` is the
  single source of truth for the Level 1 and Level 2 summary totals. It performs
  no authorization and is not executable by `PUBLIC`, `anon`, `authenticated`,
  or `service_role`. Public readers authorize before calling it.

All functions are postgres-owned, `STABLE`, fixed-empty-path
`SECURITY DEFINER` functions. Each public function is executable only by
`authenticated`. The private helper has no application-role execute grant.
Readers take no explicit row or advisory lock, so authorization necessarily
precedes every lock.

## Authorization

Every denial reached inside a reader raises SQLSTATE `42501` with the exact
fixed message `Executive Dashboard access denied.` The message contains no
role or committee identifier. `anon` and `service_role` cannot enter the
reader because they have no execute grant; the catalog paste pins that outer
privilege boundary separately.

- Level 1 permits only an active Admin.
- Both Level 2 readers permit an active Admin for any existing committee.
- Both Level 2 readers permit an active Co-Admin only for the committee derived
  from that caller's active profile.
- A different committee, a missing committee, and a null committee argument
  are indistinguishable.
- Members, inactive profiles, and profile-less authenticated identities are
  blocked by the fixed in-reader denial. Anon and service role are blocked by
  the execute privilege boundary.

## Counting rules

An active task belongs to an Active event, is not Completed, and belongs to the
selected committee through `tasks.committee_id`. Draft and Archived events and
Completed tasks never contribute. Primary and assist arrays are combined into
one distinct non-null assignee set for each task.

The summary columns mean:

- `out_unique_active_task_count`: every qualifying task exactly once.
- `out_covered_task_count`: tasks with at least one assignee whose profile is
  active anywhere in the council.
- `out_unassigned_task_count`: tasks with no distinct non-null assignee ID.
- `out_inactive_only_task_count`: assigned tasks with no active assignee.
- `out_active_outside_committee_only_task_count`: covered tasks with no active
  assignee currently belonging to the task-owning committee.
- `out_tasks_without_member_bar_count`: the ready-made note number, equal to
  unassigned plus inactive-only plus active-outside-committee-only.

The disjoint top-level partition is always:

`covered + unassigned + inactive-only = unique active tasks`.

The outside-committee count is a subset of covered. An active Admin assignee
has a null committee, so an Admin-only assignment is deliberately counted as
active-outside-committee-only and has no local member bar. The same applies to
a task assigned only to active people from another committee. A task assigned
to both an active local person and an active outsider is covered and has a
local bar, so it is not outside-committee-only. A task assigned to both an
active and a deactivated person is covered, not inactive-only.

Member bars are true workloads, not a partition. One shared task appears once
in every active local assignee's bar, while overlap between that person's
primary and assist arrays is deduplicated. Consequently bar values may sum to
more than the unique total and must never be used to compute the note. An
unassigned task, a deactivated-only task, and a task assigned only outside the
committee create no synthetic member row.

Confidential tasks contribute numbers only. No D1 output includes a task ID,
event ID, title, description, phase, deadline, assignment arrays, or
confidentiality field.

## Committees and existing workload reader

The current schema has no retirement flag. Level 1 therefore returns every row
retained in `public.committees`; it does not infer retirement from zero tasks,
zero members, or a missing Co-Admin. A renamed retained committee remains a
normal row. A committee with no Co-Admin remains readable by an Admin and its
active Members still receive bars.

The latest `public.list_active_task_assignees_with_workload()` remains
unchanged. It counts each active person's work across all task committees and
returns every active profile to an active Admin or Co-Admin. D1 instead counts
only tasks owned by the selected committee, lists only active profiles
currently in that committee, and prevents a Co-Admin from selecting another
committee. Both definitions use Active-event, non-Completed tasks and count a
person only once per task.

## Verification and rollout

1. Review the full migration and both SQL test documents.
2. The owner applies the migration to Dev; Codex does not run a Supabase
   command.
3. In the Dev SQL Editor, use **Run without RLS** and run the single paste in
   `step-d1-executive-dashboard-behaviour-tests.md`. Its final exception is the
   rollback sentinel; use the real line count printed by that finished paste.
4. Run `step-d1-executive-dashboard-catalog-tests.md` the same way. Its final
   exception also intentionally rolls back.
5. Only after both Dev pastes pass should the owner repeat the reviewed
   migration rollout on Prod.

No production application or browser test belongs to D1. D2 owns the chart,
empty state, discrepancy note, shared motion, and reduced-motion coverage.
