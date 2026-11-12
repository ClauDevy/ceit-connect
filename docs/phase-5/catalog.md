# Phase 5 migration-tied catalog

This catalog currently contains **N1, N3a, P1a, D1/D1b, R1, and R2 objects**. Historical Phase 4 and
Phase 4B counts remain unchanged; do not invent a new global total before the
owner supplies live Dev catalog output.

## `20261110120000_notification_foundation.sql`

### Table and indexes

- Private table `ceit_connect_private.notification_suppression_context`:
  `(transaction_id xid8, task_id uuid)` primary key, postgres-owned, RLS on,
  zero `PUBLIC`/`anon`/`authenticated`/`service_role` privileges, and no task or
  event FK.
- `public.notifications` keeps its existing shape and FKs.
- Index `notifications_user_page_idx(user_id,created_at DESC,id DESC)`.
- Partial index `notifications_user_unread_idx(user_id) WHERE read_at IS NULL`.

### Policies and privileges

- Replaced `notifications_select_own`: authenticated SELECT, exact owner plus
  active-profile condition.
- Replaced `notifications_update_own`: authenticated UPDATE policy with
  `USING (false) WITH CHECK (false)`.
- Effective authenticated table privilege is exactly `SELECT`; INSERT, UPDATE,
  DELETE, TRUNCATE, REFERENCES, and TRIGGER are absent.
- `public.notifications` is explicitly in `supabase_realtime`, unless that
  publication already covers all tables.

### Private functions — no browser or service-role execute grant

- `ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])`
- `ceit_connect_private.suppress_approved_leave_notifications()`
- `ceit_connect_private.notify_task_change()`
- `ceit_connect_private.notify_event_launch()`
- `ceit_connect_private.notify_task_comment()`
- `ceit_connect_private.notification_unread_count_for_user(uuid)`
- `ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)`

Every function is postgres-owned, fixed-empty-path, `SECURITY DEFINER`, and has
no overload. Trigger/mutation helpers are volatile; the two private readers are
stable.

### Public functions — authenticated execute only

- `public.get_notification_unread_count()` — stable thin reader wrapper.
- `public.list_notifications(integer,timestamptz,uuid)` — stable thin reader
  wrapper with a 1–50 bound and both-or-neither cursor validation.
- `public.mark_notification_read(uuid)` — volatile, idempotent owner mutation.
- `public.mark_all_notifications_read()` — volatile active-owner mutation.

The list reader's `out_task_id uuid` is nullable: `real` returns title and ID,
`masked` returns `Confidential Task` and the ID, and `hidden` returns
`Confidential Task` with no ID/link.

All are postgres-owned, fixed-empty-path, `SECURITY DEFINER`, denied to
`PUBLIC`, `anon`, and `service_role`, granted only to `authenticated`, and have
no overloads.

### Triggers

- `tasks_z8_notifications`: AFTER INSERT or relevant UPDATE on `tasks`.
- `events_z8_notification_launch`: AFTER status UPDATE on `events`.
- `task_comments_z8_notifications`: AFTER relevant INSERT/UPDATE on
  `task_comments`.
- `task_leave_requests_z8_notification_suppression`: AFTER status UPDATE on
  `task_leave_requests`; runs before the existing `z9` activity trigger.

### Unchanged authoritative objects used by N1

- Latest `public.task_content_access_for_user(uuid,uuid)` from
  `20261030130000_draft_task_visibility.sql`; N1 does not replace it.
- Existing `notifications_task_id_fkey` and CCE09 order-70 inventory row.
- Every task/event/comment/leave writer body and its established lock order.

Notification inserts take the normal light foreign-key key-share lock on the
recipient user row (and referenced task row). The unusual concurrent
deactivate-while-notifying sequence is deferred, not redesigned by N1. The
leave marker is deleted by the matching task trigger before its Active-event
early return and is scoped to the exact transaction and task.

## `20261111120000_notification_housekeeping.sql`

### Table and index

- Private table `ceit_connect_private.notification_cleanup_runs`: aggregate
  run timing/status/counts and fixed safe errors only; postgres-owned, RLS on,
  zero policies, zero application-role privileges, and no foreign key.
- Partial index `notifications_read_cleanup_idx(read_at,id) WHERE read_at IS
  NOT NULL` supports bounded oldest-first cleanup.

### Public authenticated-only owner wrappers

- `public.delete_notification(uuid)` returns true only when it deletes the
  active caller's own row; absent and foreign rows return false.
- `public.clear_read_notifications()` selects the active caller's read rows in
  ID order with `FOR UPDATE SKIP LOCKED`, deletes those selected rows, and
  returns the number removed. Concurrently locked rows remain for a later
  clear or automatic run; unread rows are never touched.

Both are postgres-owned, volatile, fixed-empty-path `SECURITY DEFINER`
functions granted only to `authenticated`. Raw notification DELETE remains
revoked and no DELETE policy is added.

### Postgres-session-only cleanup boundary

- `public.run_notification_cleanup()`
- `ceit_connect_private.purge_old_read_notifications(timestamptz)`
- `ceit_connect_private.purge_notification_cleanup_runs()`

All three require `session_user = 'postgres'` and grant no application-role
execute. The runner uses an advisory transaction lock, captures a 60-day
`read_at` cutoff, and deletes at most 500 oldest eligible rows with `SKIP
LOCKED`. It retains aggregate history for 30 days. The immutable constants
`notification_read_retention_days()`,
`notification_cleanup_run_retention_days()`, and
`notification_cleanup_batch_size()` return 60, 30, and 500 and have no
application-role execute grants.

### Private owner mutators

- `ceit_connect_private.delete_notification_for_user(uuid,uuid)`
- `ceit_connect_private.clear_read_notifications_for_user(uuid)`

They are postgres-owned, volatile, fixed-empty-path `SECURITY DEFINER`
functions with no application-role execute. Public wrappers authorize the
active profile before calling them.

N3a replaces no N1 policy, reader, writer, trigger, or FK. CCE09 is unchanged.

## `20261112120000_web_push_database.sql`

### Public subscription boundary

- `public.push_subscriptions` is postgres-owned with RLS enabled. Authenticated
  callers may select only safe own metadata; endpoint, `p256dh`, and auth key
  columns have no browser SELECT grant. Registration/list/remove-one/remove-all
  RPCs require an active authenticated profile.
- One endpoint hash has one owner. Re-registration transfers a shared device
  only after deleting its old queued work. The per-person limit is five.
- `users_z9_remove_deactivated_push_subscriptions` deletes subscriptions and
  their queued rows after active-to-inactive profile transitions.

### Private sender boundary

- `ceit_connect_private.push_delivery_queue` has foreign keys only to
  `notifications` and `users`. Notification deletion cascades queued and leased
  work. `subscription_id` deliberately has no FK; subscription removal uses one
  private helper to remove its queue rows first.
- Credentials store only two 32-byte salted hashes (`current` and `next`). The
  three anon-executable sender RPCs run both fixed-length comparisons and deny
  service role. Wrong secrets receive the same generic denial and are not
  persisted.
- Claims lease at most 100 rows for two minutes, recheck active profile,
  subscription, and notification existence, and return endpoint material plus
  fixed generic copy. They never accept a recipient or message.
- Acknowledgement quietly returns false for missing/stale rows, retries only
  transient results, removes 404/410 subscriptions, and never extends past
  eight attempts or one hour.

### Wake, retention, and unchanged objects

- `notifications_z9_enqueue_push` is the only attachment to existing
  notification behavior. Queue and kick failures are contained and return the
  original row. Existing notification/task functions, policies, and CCE09 are
  unchanged.
- Vault names default to `push_kick_url` and `push_wake_secret`. The constant
  `{}` wake is sent through `pg_net`; a singleton row coalesces ordinary wake
  requests for exactly ten seconds and uses `FOR UPDATE SKIP LOCKED` so a
  concurrent kicker never waits. `request_push_kick_if_due()` enters that same
  coalescer only for due pending work or an expired lease.
- Counts-only run history retains 30 days. Delivered rows retain three days,
  and terminal rows seven days. The postgres-session-only cleanup runner is
  scheduled separately on Prod only.

## `20261113120000_executive_dashboard_data.sql`

### Functions

- `ceit_connect_private.executive_dashboard_committee_counts(uuid)` returns
  six `bigint` counts: unique active tasks, covered tasks, unassigned tasks,
  inactive-only tasks, active-outside-committee-only tasks, and tasks without a
  member bar. It performs no authorization. It is postgres-owned, stable,
  fixed-empty-path `SECURITY DEFINER`, has no overload, and grants execute to
  no application role, including `service_role`.
- `public.list_executive_dashboard_committee_totals()` returns committee UUID
  and name plus the same six counts. It is active-Admin-only and orders by
  committee name then UUID.
- `public.get_executive_dashboard_committee_summary(uuid)` returns one
  authorized committee plus the same six counts.
- `public.list_executive_dashboard_committee_members(uuid)` returns committee
  UUID, member UUID, full name, avatar URL, and true active-task count, ordered
  by full name then UUID. Active zero-task profiles remain present.

The three public functions are postgres-owned, stable, fixed-empty-path
`SECURITY DEFINER` readers with no overload. Execute is revoked from `PUBLIC`,
`anon`, `authenticated`, and `service_role`, then granted only to
`authenticated`. Level 2 permits an active Admin for any existing committee or
an active Co-Admin only for the committee derived from the caller profile.
Null, missing, unauthorized-committee, Member, inactive, and profile-less
authenticated cases use the same fixed `42501` denial inside the reader.

### Unchanged catalog

D1 creates no table, index, policy, trigger, or foreign key. It replaces no
existing function and does not alter `tasks`, `events`, `users`, `committees`,
`list_active_task_assignees_with_workload()`, or any task/event writer.

## `20261114120000_executive_dashboard_extras_data.sql`

### Private classifier

- `ceit_connect_private.classify_executive_dashboard_task(timestamptz,text,timestamptz)`
  returns overdue, due-in-24-hours, and at-risk booleans plus one fixed bucket.
  It is postgres-owned, stable, fixed-empty-path `SECURITY DEFINER`, performs no
  authorization, has no overload, and grants execute to no application role.

### Public readers

- `public.get_executive_dashboard_extras_overview(uuid)` returns six KPI counts
  and five mutually exclusive donut counts. Its open total is read through the
  unchanged D1 committee aggregate.
- `public.list_executive_dashboard_needs_attention(uuid)` returns at most 20
  deterministic confidential-safe rows.
- `public.list_executive_dashboard_deadlines(uuid)` returns exactly seven
  ordered Asia/Manila dates including zero-count dates.
- `public.list_executive_dashboard_free_members(uuid)` returns scoped active
  Co-Admins/Members with at most two council-wide open assignments.
- `public.list_executive_dashboard_member_slipping_signals(uuid)` returns the
  D1 member population with committee-owned open, overdue, and at-risk counts.
- `public.get_executive_dashboard_push_adoption()` returns only two counts and
  is active-Admin-only.

All public D1b readers are postgres-owned, stable, fixed-empty-path `SECURITY
DEFINER` functions with no overload. Execute is revoked from `PUBLIC`, `anon`,
`authenticated`, and `service_role`, then granted only to `authenticated`.
Optional committee omission means Admin-only council scope; an active Co-Admin
must pass their own existing committee. D1b creates no table, index, policy,
trigger, or foreign key and replaces no D1 or other existing function.

## `20261115120000_request_notifications.sql`

### Type constraints and replaced functions

- `notifications_type_check` and
  `push_delivery_queue_notification_type_check` retain the original six types
  and add `volunteer_offer`, `leave_requested`, `leave_cancelled`,
  `leave_approved`, and `leave_denied`.
- `ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])` retains
  its active-recipient, actor-exclusion, set-wise deduplication, fixed error,
  owner, volatility, empty path, and zero application-role execute boundary;
  only the accepted type allowlist expands.
- `public.claim_push_deliveries(integer)` retains authentication before input
  validation, leases, retry/cleanup behavior, return shape, fixed errors, and
  anon-only capability boundary. Its only behavior change is five fixed generic
  bodies. Output-name collisions remain avoided through qualified columns.

### Private trigger functions and triggers

- `ceit_connect_private.notify_task_volunteer_offer()` and
  `task_volunteers_z8_notifications` emit submission-only offer rows to active
  Admins, the active owning Co-Admin, and current primary assignees with real
  access, excluding the volunteer.
- `ceit_connect_private.notify_task_leave_request()` and
  `task_leave_requests_z8_request_notifications` emit submit/cancel rows to
  active eligible approvers and approved/denied rows to the requester.
- Both functions are postgres-owned volatile fixed-empty-path `SECURITY
  DEFINER` functions with execute revoked from `PUBLIC`, `anon`,
  `authenticated`, and `service_role`.
- PostgreSQL's same-kind trigger-name ordering runs
  `task_leave_requests_z8_notification_suppression` before
  `task_leave_requests_z8_request_notifications`, then the existing `z9`
  activity trigger. Approval therefore creates `leave_approved`, while the
  marker still suppresses the subsequent assignee-removal task notification.

R1 adds no table, index, policy, foreign key, cleanup branch, dashboard reader,
or service-role exception. N3a remains type-agnostic, and D1b reads task state
rather than notification rows.

## `20261116120000_deadline_reminders.sql`

- Both notification constraints and the private insert-helper allowlist contain
  thirteen types. `claim_push_deliveries(integer)` retains its exact R1
  boundary and adds only the two fixed generic R2 bodies.
- `ceit_connect_private.task_deadline_reminder_ledger` is a postgres-owned,
  zero-policy RLS table keyed by `(task_id,reminder_kind,target_at,user_id)`;
  it has no foreign key and no application-role privileges.
- `ceit_connect_private.deadline_reminder_runs` is an aggregate-only,
  postgres-owned, zero-policy RLS table with no application-role privileges.
- Private ungranted functions are
  `bootstrap_deadline_reminders_at(timestamptz)`,
  `emit_deadline_reminder_occurrence(uuid,text,timestamptz,timestamptz)`,
  `purge_deadline_reminder_ledger(timestamptz)`,
  `purge_deadline_reminder_runs(timestamptz,uuid)`, and
  `run_deadline_reminders_at(timestamptz)`. All are postgres-owned volatile
  fixed-empty-path definers and require a postgres session.
- `public.run_deadline_reminders()` is the equally ungranted real-clock
  postgres-session wrapper. It returns one six-field safe aggregate row. The
  immutable ungranted constants fix the occurrence cap at 100 and retention at
  30 days.
- R2 adds four supporting indexes and no policy, FK, browser/service-role
  grant, dashboard reader, or cron catalog row.

