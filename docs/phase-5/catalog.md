# Phase 5 migration-tied catalog

This catalog currently contains **N1 and N3a objects**. Historical Phase 4 and
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

