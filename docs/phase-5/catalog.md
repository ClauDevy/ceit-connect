# Phase 5 migration-tied catalog

This catalog currently contains **N1 objects only**. Historical Phase 4 and
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

