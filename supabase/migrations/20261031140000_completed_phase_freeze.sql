-- Phase 4B Batch 13b: derived phase completion, the completed-phase freeze,
-- one exact Reopen boundary, and phase-aware serialization.
--
-- Apply manually to Dev first. Never run this migration from an agent session.
--
-- Canonical lock order ("try" means fail with SQLSTATE 40001 instead of wait):
--
-- Path                                      Row already held       Event row       Event advisory       Phase lock
-- ----------------------------------------  ---------------------  --------------  -------------------  --------------------
-- raw task INSERT                           new row only           SHARE NOWAIT     EXCLUSIVE try        EXCLUSIVE try
-- raw task UPDATE                           task row               SHARE NOWAIT     EXCLUSIVE try        SHARED/EXCLUSIVE try
-- raw task DELETE                           task row               SHARE NOWAIT     EXCLUSIVE try        EXCLUSIVE try
-- event-first task RPCs                     none                   SHARE/UPDATE    blocking before task SHARED/EXCLUSIVE try
-- task-first claim/backup legacy RPCs       task row               SHARE           EXCLUSIVE try        SHARED try
-- move_task                                 none                   SHARE           blocking             EXCLUSIVE blocking, then task/lane
-- Reopen                                    none                   SHARE           blocking             EXCLUSIVE blocking, then task/lane
-- work-link/comment/volunteer child writes  child, then task       SHARE NOWAIT     none                 SHARED try
-- leave-request child writes                child, then task       SHARE NOWAIT     none                 SHARED try
-- automatic leave cleanup                   task/event already held SHARE/reentrant none                SHARED try/reentrant
-- Batch 13d event deletion                  event, advisory, tasks and children are prelocked; exact private context bypasses phase guards
--
-- No path waits for an event row or the event advisory key after it owns a
-- phase lock. Paths that necessarily enter with a task/child row already held
-- use try-locks for every later advisory acquisition. move_task and Reopen may
-- wait for the exclusive phase lock only because they hold no task/child row.
--
-- Exact task-trigger order (PostgreSQL alphabetic order for the same timing):
-- tasks_a0_enforce_event_capacity: new task -> event SHARE NOWAIT -> event
--   advisory try. INSERT then reaches the archive and phase guards re-entrantly.
-- tasks_guard_access_writes: task row only; no event/advisory/phase acquisition.
-- tasks_guard_archived_event_writes: task row -> event SHARE NOWAIT.
-- tasks_guard_assignee_writes: task row only; user advisory locks were already
--   taken by approved wrappers and are not event/phase locks.
-- tasks_guard_referenced_prerequisite_deletion: task row -> dependent task rows;
--   Batch 13d exact cascade context is its only bypass.
-- tasks_h0_guard_completed_phase_writes: task row -> re-entrant/try event
--   advisory -> shared phase for content-only UPDATE, exclusive phase for
--   INSERT/DELETE/status/phase/event change.
-- tasks_restrict_assignee_updates: task row only.
-- tasks_validate_dependency: task row -> re-entrant event advisory -> referenced
--   task; it cannot wait on the advisory because h0 already owns it.
-- tasks_z0_reject_event_id_changes / tasks_z1_reject_created_by_changes: task
--   row only.
-- tasks_z2_set_destination_lane_order: task row -> re-entrant event advisory ->
--   lane rows; h0 already owns the advisory and phase lock.
-- tasks_z3_assign_creation_metadata: INSERT row -> re-entrant event advisory;
--   h0 already owns both advisory and phase lock.
-- tasks_z4_set_updated_at: task row only.
-- tasks_activity_log and tasks_cancel_stale_leave_requests are AFTER triggers;
--   the latter's leave UPDATE re-enters the shared phase lock through its exact
--   private cleanup context. Deferred event/delete invariant triggers take no
--   later event or phase lock.
--
-- Exact mutable-child trigger order:
-- task_work_links_a0_guard_completed_phase_writes -> existing
--   task_work_links_guard_writes -> task_work_links_reject_updates;
-- task_comments_a0_guard_completed_phase_writes -> existing
--   task_comments_guard_writes;
-- task_volunteers_a0_guard_completed_phase_writes -> existing
--   task_volunteers_guard_writes;
-- task_leave_requests_a0_guard_completed_phase_writes (sole table trigger).
-- Each a0 guard enters with child row -> task row -> event SHARE NOWAIT ->
-- shared phase try. The later historical guard re-enters its task/event locks,
-- so it cannot wait for an event row after the shared phase lock is held.
-- Create Event, Edit Event additions, template copies, and Batch 11 additions
-- do not accept a caller-supplied status: every inserted task arrives To Do.
-- Therefore a multi-row create/edit cannot make its phase complete mid-insert.
-- Direct SQL attempting several already-Completed inserts is serialized; after
-- the first insert makes a non-Unphased phase complete, the next insert fails
-- CCQ01 and the statement/transaction rolls back atomically.

create or replace function public.canonical_task_phase(p_phase text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.btrim(p_phase), ''),
    'Unphased'
  );
$$;

alter function public.canonical_task_phase(text) owner to postgres;
revoke all on function public.canonical_task_phase(text)
from public, anon, authenticated, service_role;

create or replace function public.task_phase_lock_key(
  p_event_id uuid,
  p_phase text
)
returns bigint
language sql
immutable
security invoker
set search_path = ''
as $$
  select pg_catalog.hashtextextended(
    'ceit-connect:task-phase:' || p_event_id::text || ':' ||
    public.canonical_task_phase(p_phase),
    0
  );
$$;

alter function public.task_phase_lock_key(uuid, text) owner to postgres;
revoke all on function public.task_phase_lock_key(uuid, text)
from public, anon, authenticated, service_role;

create or replace function public.task_phase_is_complete(
  p_event_id uuid,
  p_phase text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select case
    when p_event_id is null
      or public.canonical_task_phase(p_phase) = 'Unphased'
      then false
    else exists (
      select 1
      from public.tasks as task_row
      where task_row.event_id = p_event_id
        and public.canonical_task_phase(task_row.phase)
          = public.canonical_task_phase(p_phase)
    ) and not exists (
      select 1
      from public.tasks as task_row
      where task_row.event_id = p_event_id
        and public.canonical_task_phase(task_row.phase)
          = public.canonical_task_phase(p_phase)
        and task_row.status is distinct from 'Completed'
    )
  end;
$$;

alter function public.task_phase_is_complete(uuid, text) owner to postgres;
revoke all on function public.task_phase_is_complete(uuid, text)
from public, anon, authenticated, service_role;

create or replace function public.try_task_event_advisory_lock(p_event_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_event_id is null
     or not pg_catalog.pg_try_advisory_xact_lock(
       public.task_dependency_lock_key(p_event_id)
     ) then
    raise exception using
      errcode = '40001',
      message = 'The phase changed while this request was being saved. Refresh and try again.';
  end if;
end;
$$;

alter function public.try_task_event_advisory_lock(uuid) owner to postgres;
revoke all on function public.try_task_event_advisory_lock(uuid)
from public, anon, authenticated, service_role;

create or replace function public.try_task_phase_lock(
  p_event_id uuid,
  p_phase text,
  p_exclusive boolean
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_locked boolean;
begin
  if p_event_id is null or p_exclusive is null then
    raise exception using errcode = '22023', message = 'A phase lock target is required.';
  end if;

  if p_exclusive then
    v_locked := pg_catalog.pg_try_advisory_xact_lock(
      public.task_phase_lock_key(p_event_id, p_phase)
    );
  else
    v_locked := pg_catalog.pg_try_advisory_xact_lock_shared(
      public.task_phase_lock_key(p_event_id, p_phase)
    );
  end if;

  if v_locked is not true then
    raise exception using
      errcode = '40001',
      message = 'The phase changed while this request was being saved. Refresh and try again.';
  end if;
end;
$$;

alter function public.try_task_phase_lock(uuid, text, boolean) owner to postgres;
revoke all on function public.try_task_phase_lock(uuid, text, boolean)
from public, anon, authenticated, service_role;

create table ceit_connect_private.completed_phase_reopen_context (
  transaction_id xid8 primary key,
  task_id uuid not null,
  event_id uuid not null,
  phase_key text not null
);

create table ceit_connect_private.task_leave_cleanup_context (
  transaction_id xid8 not null,
  task_id uuid,
  event_id uuid,
  reason text not null check (reason in ('task_stale', 'event_inactive')),
  primary key (transaction_id, reason),
  check (
    (reason = 'task_stale' and task_id is not null and event_id is null)
    or (reason = 'event_inactive' and task_id is null and event_id is not null)
  )
);

alter table ceit_connect_private.completed_phase_reopen_context enable row level security;
alter table ceit_connect_private.task_leave_cleanup_context enable row level security;

revoke all on ceit_connect_private.completed_phase_reopen_context
from public, anon, authenticated, service_role;
revoke all on ceit_connect_private.task_leave_cleanup_context
from public, anon, authenticated, service_role;

-- The pre-13b archive guard waited for an event row after PostgreSQL had
-- already locked the task row. That inversion is not allowed by the phase
-- protocol. Preserve its error precedence and behavior, but fail fast with the
-- common retryable 40001 message when the event row is busy.
create or replace function public.guard_archived_event_task_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parent_ids uuid[];
  v_parent_id uuid;
  v_locked_parent_count integer := 0;
begin
  if TG_OP = 'DELETE'
     and ceit_connect_private.event_delete_context_matches(old.event_id) then
    return old;
  end if;

  if TG_OP = 'INSERT' then
    v_parent_ids := array[new.event_id];
  elsif TG_OP = 'DELETE' then
    v_parent_ids := array[old.event_id];
  else
    select pg_catalog.array_agg(parent_id order by parent_id)
    into v_parent_ids
    from (
      select distinct parent_id
      from pg_catalog.unnest(array[old.event_id, new.event_id]) as parents(parent_id)
    ) as distinct_parents;
  end if;

  begin
    for v_parent_id in
      select event_row.id
      from public.events as event_row
      where event_row.id = any(v_parent_ids)
      order by event_row.id
      for share nowait
    loop
      v_locked_parent_count := v_locked_parent_count + 1;
    end loop;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'The phase changed while this request was being saved. Refresh and try again.';
  end;

  if v_locked_parent_count <> pg_catalog.cardinality(v_parent_ids) then
    raise exception 'Task write rejected because its parent event could not be verified.';
  end if;

  if exists (
    select 1 from public.events as event_row
    where event_row.id = any(v_parent_ids) and event_row.status = 'Archived'
  ) then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

alter function public.guard_archived_event_task_writes() owner to postgres;
revoke all on function public.guard_archived_event_task_writes()
from public, anon, authenticated, service_role;

-- This INSERT trigger sorts before the archive/completion guards and therefore
-- cannot rely on their re-entrant locks. It enters with the new task row and
-- converts both later acquisitions to fail-fast operations.
create or replace function public.enforce_event_task_capacity()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c_limit constant integer := 200;
  v_stored_count integer;
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.task_assignee_writer', true
  );
  v_context_event_id uuid;
  v_start_count integer;
  v_addition_limit integer;
begin
  if new.event_id is null then return new; end if;

  begin
    perform 1 from public.events as event_row
    where event_row.id = new.event_id
    for share nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'The phase changed while this request was being saved. Refresh and try again.';
  end;
  if not found then
    raise exception using errcode = '23503', message = 'The task event is unavailable.';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    public.task_dependency_lock_key(new.event_id)
  ) then
    raise exception using
      errcode = '40001',
      message = 'The phase changed while this request was being saved. Refresh and try again.';
  end if;
  v_stored_count := public.count_event_tasks_for_capacity(new.event_id);

  begin
    v_context_event_id := nullif(pg_catalog.current_setting(
      'ceit_connect.task_capacity_event_id', true
    ), '')::uuid;
    v_start_count := nullif(pg_catalog.current_setting(
      'ceit_connect.task_capacity_start_count', true
    ), '')::integer;
    v_addition_limit := nullif(pg_catalog.current_setting(
      'ceit_connect.task_capacity_addition_limit', true
    ), '')::integer;
  exception when invalid_text_representation then
    v_start_count := null;
    v_addition_limit := null;
  end;

  if current_user = 'postgres'
     and v_writer = 'edit_event_with_tasks'
     and v_context_event_id is not distinct from new.event_id
     and v_start_count is not null
     and v_addition_limit is not null
     and v_start_count >= 0
     and v_addition_limit >= 0 then
    if v_stored_count >= v_start_count + v_addition_limit then
      raise exception using errcode = 'CCP01',
        message = 'This event already has the maximum of 200 tasks.';
    end if;
  elsif v_stored_count >= c_limit then
    raise exception using errcode = 'CCP01',
      message = 'This event already has the maximum of 200 tasks.';
  end if;
  return new;
end;
$$;

alter function public.enforce_event_task_capacity() owner to postgres;
revoke all on function public.enforce_event_task_capacity()
from public, anon, authenticated, service_role;

create or replace function public.guard_completed_phase_task_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_exclusive boolean;
  v_event_id uuid;
  v_phase_key text;
  v_event_status text;
  v_reopen_exception boolean := false;
begin
  if TG_OP = 'DELETE'
     and ceit_connect_private.event_delete_context_matches(old.event_id) then
    return old;
  end if;

  v_exclusive := TG_OP in ('INSERT', 'DELETE')
    or (
      TG_OP = 'UPDATE'
      and (
        old.event_id is distinct from new.event_id
        or public.canonical_task_phase(old.phase)
          is distinct from public.canonical_task_phase(new.phase)
        or old.status is distinct from new.status
      )
    );

  -- Every event advisory lock is acquired before every phase lock. A raw or
  -- legacy task-first path fails fast here instead of waiting with its row held.
  for v_event_id in
    select distinct event_id
    from pg_catalog.unnest(
      case
        when TG_OP = 'INSERT' then array[new.event_id]
        when TG_OP = 'DELETE' then array[old.event_id]
        else array[old.event_id, new.event_id]
      end
    ) as event_ids(event_id)
    order by event_id
  loop
    perform public.try_task_event_advisory_lock(v_event_id);
  end loop;

  for v_event_id, v_phase_key in
    select distinct phase_row.event_id, phase_row.phase_key
    from (
      select new.event_id, public.canonical_task_phase(new.phase) as phase_key
      where TG_OP <> 'DELETE'
      union all
      select old.event_id, public.canonical_task_phase(old.phase)
      where TG_OP <> 'INSERT'
    ) as phase_row
    order by phase_row.event_id, phase_row.phase_key
  loop
    perform public.try_task_phase_lock(v_event_id, v_phase_key, v_exclusive);
  end loop;

  -- The Archived guard is alphabetically earlier and already holds the event
  -- row lock. Re-read after the advisory acquisitions so archive precedence is
  -- explicit even if trigger ordering is changed accidentally later.
  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = case when TG_OP = 'INSERT' then new.event_id else old.event_id end;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task parent event changed. Refresh and try again.';
  end if;
  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if TG_OP = 'UPDATE' then
    select exists (
      select 1
      from ceit_connect_private.completed_phase_reopen_context as context_row
      where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        and context_row.task_id = old.id
        and context_row.event_id = old.event_id
        and context_row.phase_key = public.canonical_task_phase(old.phase)
    ) and old.event_id is not distinct from new.event_id
      and public.canonical_task_phase(old.phase)
        is not distinct from public.canonical_task_phase(new.phase)
      and old.status = 'Completed'
      and new.status = 'In Progress'
      and (pg_catalog.to_jsonb(new) - 'status' - 'sort_order' - 'updated_at')
        is not distinct from
          (pg_catalog.to_jsonb(old) - 'status' - 'sort_order' - 'updated_at')
    into v_reopen_exception;
  end if;

  if TG_OP <> 'INSERT'
     and public.task_phase_is_complete(old.event_id, old.phase)
     and v_reopen_exception is not true then
    raise exception using
      errcode = 'CCQ01',
      message = 'This phase is complete and read-only.';
  end if;

  if TG_OP <> 'DELETE'
     and (
       TG_OP = 'INSERT'
       or old.event_id is distinct from new.event_id
       or public.canonical_task_phase(old.phase)
         is distinct from public.canonical_task_phase(new.phase)
     )
     and public.task_phase_is_complete(new.event_id, new.phase) then
    raise exception using
      errcode = 'CCQ01',
      message = 'This phase is complete and read-only.';
  end if;

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

alter function public.guard_completed_phase_task_writes() owner to postgres;
revoke all on function public.guard_completed_phase_task_writes()
from public, anon, authenticated, service_role;

drop trigger if exists tasks_h0_guard_completed_phase_writes on public.tasks;
create trigger tasks_h0_guard_completed_phase_writes
before insert or update or delete on public.tasks
for each row execute function public.guard_completed_phase_task_writes();

create or replace function public.guard_completed_phase_child_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_event_id uuid;
  v_phase text;
  v_event_status text;
  v_cleanup_allowed boolean := false;
begin
  v_task_id := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;

  select task_row.event_id, task_row.phase
  into v_event_id, v_phase
  from public.tasks as task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    if TG_OP = 'DELETE'
       and (
         ceit_connect_private.task_delete_context_matches(old.task_id)
         or (
           pg_catalog.pg_trigger_depth() > 1
           and exists (
             select 1
             from ceit_connect_private.event_delete_cascade_context as context_row
             where context_row.transaction_id = pg_catalog.pg_current_xact_id()
           )
         )
       ) then
      return old;
    end if;
    raise exception using
      errcode = '40001',
      message = 'The child task changed. Refresh and try again.';
  end if;

  begin
    select event_row.status
    into v_event_status
    from public.events as event_row
    where event_row.id = v_event_id
    for share nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'The phase changed while this request was being saved. Refresh and try again.';
  end;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The child task changed. Refresh and try again.';
  end if;

  -- Child paths never take the event advisory key. They already hold a child
  -- and/or task row, so the shared phase acquisition must be a try-lock.
  perform public.try_task_phase_lock(v_event_id, v_phase, false);

  if TG_TABLE_NAME = 'task_leave_requests' and TG_OP = 'UPDATE' then
    select exists (
      select 1
      from ceit_connect_private.task_leave_cleanup_context as context_row
      where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        and (
          (context_row.reason = 'task_stale' and context_row.task_id = v_task_id)
          or (context_row.reason = 'event_inactive' and context_row.event_id = v_event_id)
        )
    ) and new.id is not distinct from old.id
      and new.task_id is not distinct from old.task_id
      and new.requester_id is not distinct from old.requester_id
      and new.created_at is not distinct from old.created_at
      and old.status = 'pending'
      and new.status = 'cancelled'
      and new.resolved_at is not null
      and new.resolved_by is not distinct from old.resolved_by
      and new.stale_reason in ('no_longer_assigned', 'task_completed', 'event_inactive')
    into v_cleanup_allowed;
  end if;

  -- Work links, comments, and volunteers retain their established Archived
  -- SQLSTATE/message in their later table-specific guards. Leave requests have
  -- no historical guard, so this is their Archived boundary.
  if v_event_status = 'Archived' and v_cleanup_allowed is not true then
    if TG_TABLE_NAME = 'task_leave_requests' then
      raise exception using
        errcode = 'CCQ02',
        message = 'Task children in Archived events are read-only.';
    end if;
    return case when TG_OP = 'DELETE' then old else new end;
  end if;

  if public.task_phase_is_complete(v_event_id, v_phase)
     and v_cleanup_allowed is not true then
    raise exception using
      errcode = 'CCQ01',
      message = 'This phase is complete and read-only.';
  end if;

  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

alter function public.guard_completed_phase_child_writes() owner to postgres;
revoke all on function public.guard_completed_phase_child_writes()
from public, anon, authenticated, service_role;

drop trigger if exists task_work_links_a0_guard_completed_phase_writes on public.task_work_links;
create trigger task_work_links_a0_guard_completed_phase_writes
before insert or update or delete on public.task_work_links
for each row execute function public.guard_completed_phase_child_writes();

drop trigger if exists task_comments_a0_guard_completed_phase_writes on public.task_comments;
create trigger task_comments_a0_guard_completed_phase_writes
before insert or update or delete on public.task_comments
for each row execute function public.guard_completed_phase_child_writes();

drop trigger if exists task_volunteers_a0_guard_completed_phase_writes on public.task_volunteers;
create trigger task_volunteers_a0_guard_completed_phase_writes
before insert or update or delete on public.task_volunteers
for each row execute function public.guard_completed_phase_child_writes();

drop trigger if exists task_leave_requests_a0_guard_completed_phase_writes on public.task_leave_requests;
create trigger task_leave_requests_a0_guard_completed_phase_writes
before insert or update or delete on public.task_leave_requests
for each row execute function public.guard_completed_phase_child_writes();

-- Preserve automatic leave cleanup, but make the exception exact and
-- catalog-testable. No browser role can create either private context row.
create or replace function public.cancel_stale_task_leave_requests()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.task_leave_requests as request_row
    where request_row.task_id = new.id
      and request_row.status = 'pending'
      and (
        new.status = 'Completed'
        or not (
          request_row.requester_id = any(new.primary_assignees)
          or request_row.requester_id = any(new.assist_assignees)
        )
      )
  ) then
    return new;
  end if;

  insert into ceit_connect_private.task_leave_cleanup_context (
    transaction_id, task_id, event_id, reason
  ) values (
    pg_catalog.pg_current_xact_id(), new.id, null, 'task_stale'
  );

  begin
    update public.task_leave_requests as request_row
    set status = 'cancelled',
        resolved_at = pg_catalog.clock_timestamp(),
        stale_reason = case
          when new.status = 'Completed' then 'task_completed'
          else 'no_longer_assigned'
        end
    where request_row.task_id = new.id
      and request_row.status = 'pending'
      and (
        new.status = 'Completed'
        or not (
          request_row.requester_id = any(new.primary_assignees)
          or request_row.requester_id = any(new.assist_assignees)
        )
      );

    delete from ceit_connect_private.task_leave_cleanup_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id()
      and context_row.reason = 'task_stale';
  exception when others then
    delete from ceit_connect_private.task_leave_cleanup_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id()
      and context_row.reason = 'task_stale';
    raise;
  end;

  return new;
end;
$$;

alter function public.cancel_stale_task_leave_requests() owner to postgres;
revoke all on function public.cancel_stale_task_leave_requests()
from public, anon, authenticated, service_role;

create or replace function public.cancel_inactive_event_leave_requests()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.status = 'Active' and new.status <> 'Active' then
    insert into ceit_connect_private.task_leave_cleanup_context (
      transaction_id, task_id, event_id, reason
    ) values (
      pg_catalog.pg_current_xact_id(), null, new.id, 'event_inactive'
    );

    begin
      update public.task_leave_requests as request_row
      set status = 'cancelled',
          resolved_at = pg_catalog.clock_timestamp(),
          stale_reason = 'event_inactive'
      from public.tasks as task_row
      where task_row.event_id = new.id
        and request_row.task_id = task_row.id
        and request_row.status = 'pending';

      delete from ceit_connect_private.task_leave_cleanup_context as context_row
      where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        and context_row.reason = 'event_inactive';
    exception when others then
      delete from ceit_connect_private.task_leave_cleanup_context as context_row
      where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        and context_row.reason = 'event_inactive';
      raise;
    end;
  end if;
  return new;
end;
$$;

alter function public.cancel_inactive_event_leave_requests() owner to postgres;
revoke all on function public.cancel_inactive_event_leave_requests()
from public, anon, authenticated, service_role;

-- Keep the proven Step 5b move body unchanged behind a wrapper that acquires
-- event -> event advisory -> exclusive phase before the old body locks tasks.
alter function public.move_task(uuid, text, text, text, uuid, uuid)
rename to move_task_pre13b;
revoke all on function public.move_task_pre13b(uuid, text, text, text, uuid, uuid)
from public, anon, authenticated, service_role;

create function public.move_task(
  p_task_id uuid,
  p_expected_phase text,
  p_expected_status text,
  p_destination_status text,
  p_previous_neighbor_id uuid,
  p_next_neighbor_id uuid
)
returns table (task_id uuid, status text, sort_order bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_event_id uuid;
  v_phase text;
  v_event_status text;
  v_task_committee_id uuid;
  v_task_status text;
  v_task_primary_assignees uuid[];
  v_task_assist_assignees uuid[];
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as user_row
  where user_row.id = v_caller_id and user_row.is_active is true;
  if v_caller_id is null or not found then
    raise exception using
      errcode = '42501',
      message = 'Only an active user can move a task.';
  end if;

  select task_row.event_id, task_row.phase
  into v_event_id, v_phase
  from public.tasks as task_row
  where task_row.id = p_task_id;
  if not found then
    raise exception using errcode = '42501', message = 'The task cannot be moved.';
  end if;

  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = v_event_id
  for share;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh the board and try again.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_event_id)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    public.task_phase_lock_key(v_event_id, v_phase)
  );

  -- The phase lock precedes the task row. This preflight repeats the old
  -- body's authorization and stale checks before exposing phase completion;
  -- the old body then re-enters the same task/event locks safely.
  select task_row.committee_id,
         task_row.phase,
         task_row.status,
         task_row.primary_assignees,
         task_row.assist_assignees
  into v_task_committee_id,
       v_phase,
       v_task_status,
       v_task_primary_assignees,
       v_task_assist_assignees
  from public.tasks as task_row
  where task_row.id = p_task_id and task_row.event_id = v_event_id
  for update;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh the board and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;
  if v_event_status not in ('Draft', 'Active') then
    raise exception 'The task''s event is not writable.';
  end if;
  if v_caller_role = 'Admin' then
    null;
  elsif v_caller_role = 'Co-Admin' then
    if v_caller_committee_id is distinct from v_task_committee_id then
      raise exception using
        errcode = '42501',
        message = 'Co-Admins can move only their own committee''s tasks.';
    end if;
  elsif not (
    v_caller_role = 'Member'
    and v_event_status = 'Active'
    and (
      v_caller_id = any(v_task_primary_assignees)
      or v_caller_id = any(v_task_assist_assignees)
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are not allowed to move this task.';
  end if;
  if v_phase is distinct from p_expected_phase
     or v_task_status is distinct from p_expected_status then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh the board and try again.';
  end if;
  if public.task_phase_is_complete(v_event_id, v_phase) then
    raise exception using
      errcode = 'CCQ01',
      message = 'This phase is complete and read-only.';
  end if;

  return query
  select moved.task_id, moved.status, moved.sort_order
  from public.move_task_pre13b(
    p_task_id,
    p_expected_phase,
    p_expected_status,
    p_destination_status,
    p_previous_neighbor_id,
    p_next_neighbor_id
  ) as moved;
end;
$$;

alter function public.move_task(uuid, text, text, text, uuid, uuid) owner to postgres;
revoke all on function public.move_task(uuid, text, text, text, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.move_task(uuid, text, text, text, uuid, uuid)
to authenticated;

-- A helper returns true only for a fully valid, authorized, semantically
-- unchanged Edit Event row. Invalid/unauthorized input returns false and is
-- delegated to the proven Step 12 body for its historical safe error.
create function ceit_connect_private.edit_event_task_payload_is_unchanged(
  p_event_id uuid,
  p_task jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_role text;
  v_committee uuid;
  v_stored public.tasks%rowtype;
  v_title text;
  v_description text;
  v_phase text;
  v_committee_id uuid;
  v_task_type text;
  v_priority text;
  v_due_date timestamptz;
  v_call_time timestamptz;
  v_end_time timestamptz;
  v_assignees uuid[] := '{}'::uuid[];
  v_value jsonb;
begin
  if pg_catalog.jsonb_typeof(p_task) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_task -> 'id') is distinct from 'string' then
    return false;
  end if;
  v_task_id := (p_task ->> 'id')::uuid;

  select user_row.role, user_row.committee_id
  into v_role, v_committee
  from public.users as user_row
  where user_row.id = auth.uid() and user_row.is_active is true;
  if v_role not in ('Admin', 'Co-Admin') then return false; end if;

  select task_row.* into v_stored
  from public.tasks as task_row
  where task_row.id = v_task_id and task_row.event_id = p_event_id;
  if not found then return false; end if;
  if v_role = 'Co-Admin' and v_stored.committee_id is distinct from v_committee then
    return false;
  end if;

  if pg_catalog.jsonb_typeof(p_task -> 'title') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_task -> 'phase') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_task -> 'committee_id') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_task -> 'task_type') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_task -> 'priority') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_task -> 'assignee_ids') is distinct from 'array' then
    return false;
  end if;

  if (p_task ? 'description'
      and pg_catalog.jsonb_typeof(p_task -> 'description') not in ('string', 'null'))
     or (p_task ? 'due_date'
      and pg_catalog.jsonb_typeof(p_task -> 'due_date') not in ('string', 'null'))
     or (p_task ? 'call_time'
      and pg_catalog.jsonb_typeof(p_task -> 'call_time') not in ('string', 'null'))
     or (p_task ? 'end_time'
      and pg_catalog.jsonb_typeof(p_task -> 'end_time') not in ('string', 'null')) then
    return false;
  end if;

  v_title := pg_catalog.btrim(p_task ->> 'title');
  v_description := nullif(pg_catalog.btrim(p_task ->> 'description'), '');
  v_phase := pg_catalog.btrim(p_task ->> 'phase');
  v_committee_id := (p_task ->> 'committee_id')::uuid;
  v_task_type := p_task ->> 'task_type';
  v_priority := p_task ->> 'priority';
  v_due_date := case when nullif(p_task ->> 'due_date', '') is null
    then null else ((p_task ->> 'due_date')::date)::timestamptz end;
  v_call_time := case when nullif(p_task ->> 'call_time', '') is null
    then null else (p_task ->> 'call_time')::timestamptz end;
  v_end_time := case when nullif(p_task ->> 'end_time', '') is null
    then null else (p_task ->> 'end_time')::timestamptz end;

  for v_value in
    select value from pg_catalog.jsonb_array_elements(p_task -> 'assignee_ids')
  loop
    if pg_catalog.jsonb_typeof(v_value) is distinct from 'string' then return false; end if;
    v_assignees := pg_catalog.array_append(v_assignees, (v_value #>> '{}')::uuid);
  end loop;

  return v_title is not null
    and v_title <> ''
    and v_phase is not null
    and v_phase <> ''
    and v_stored.committee_id is not distinct from v_committee_id
    and v_stored.title is not distinct from v_title
    and v_stored.description is not distinct from v_description
    and public.canonical_task_phase(v_stored.phase)
      is not distinct from public.canonical_task_phase(v_phase)
    and v_stored.priority is not distinct from v_priority
    and v_stored.task_type is not distinct from v_task_type
    and v_stored.due_date is not distinct from v_due_date
    and v_stored.call_time is not distinct from v_call_time
    and v_stored.end_time is not distinct from v_end_time
    and v_stored.primary_assignees is not distinct from v_assignees;
exception when others then
  return false;
end;
$$;

alter function ceit_connect_private.edit_event_task_payload_is_unchanged(uuid, jsonb)
owner to postgres;
revoke all on function ceit_connect_private.edit_event_task_payload_is_unchanged(uuid, jsonb)
from public, anon, authenticated, service_role;

alter function public.edit_event_with_tasks_step12(
  uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]
) rename to edit_event_with_tasks_step12_pre13b;
revoke all on function public.edit_event_with_tasks_step12_pre13b(
  uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]
) from public, anon, authenticated, service_role;

create function public.edit_event_with_tasks_step12(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_description text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_tasks_to_add jsonb default '[]'::jsonb,
  p_tasks_to_update jsonb default '[]'::jsonb,
  p_task_ids_to_delete uuid[] default '{}'::uuid[]
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_filtered_updates jsonb := p_tasks_to_update;
  v_has_duplicate_ids boolean := false;
begin
  if pg_catalog.jsonb_typeof(p_tasks_to_update) = 'array' then
    select exists (
      select 1
      from (
        select public.task_assignee_uuid_or_null(update_row.value ->> 'id') as task_id
        from pg_catalog.jsonb_array_elements(p_tasks_to_update) as update_row(value)
        where pg_catalog.jsonb_typeof(update_row.value -> 'id') = 'string'
      ) as parsed
      where parsed.task_id is not null
      group by parsed.task_id
      having pg_catalog.count(*) > 1
    ) into v_has_duplicate_ids;

    if not v_has_duplicate_ids then
      select coalesce(
        pg_catalog.jsonb_agg(update_row.value order by update_row.ordinality),
        '[]'::jsonb
      )
      into v_filtered_updates
      from pg_catalog.jsonb_array_elements(p_tasks_to_update)
        with ordinality as update_row(value, ordinality)
      where ceit_connect_private.edit_event_task_payload_is_unchanged(
        p_event_id,
        update_row.value
      ) is not true
      or public.task_assignee_uuid_or_null(update_row.value ->> 'id') = any(
        coalesce(p_task_ids_to_delete, '{}'::uuid[])
      );
    end if;
  end if;

  return public.edit_event_with_tasks_step12_pre13b(
    p_event_id,
    p_expected_updated_at,
    p_name,
    p_description,
    p_start_date,
    p_end_date,
    p_status,
    p_tasks_to_add,
    v_filtered_updates,
    p_task_ids_to_delete
  );
end;
$$;

alter function public.edit_event_with_tasks_step12(
  uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]
) owner to postgres;
revoke all on function public.edit_event_with_tasks_step12(
  uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]
) from public, anon, authenticated, service_role;

-- Reuse move_task's authoritative lane-tail helper and its 1024 gap. The
-- helper remains unavailable to top-level callers except while the exact,
-- non-forgeable Reopen context names the same task/event/canonical phase.
create or replace function public.task_lane_tail_sort_order(
  p_event_id uuid,
  p_phase text,
  p_status text,
  p_exclude_task_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tail_sort_order bigint;
begin
  if pg_catalog.pg_trigger_depth() = 0
     and not exists (
       select 1
       from ceit_connect_private.completed_phase_reopen_context as context_row
       where context_row.transaction_id = pg_catalog.pg_current_xact_id()
         and context_row.task_id = p_exclude_task_id
         and context_row.event_id = p_event_id
         and context_row.phase_key = public.canonical_task_phase(p_phase)
         and p_status = 'In Progress'
     ) then
    raise exception using
      errcode = '42501',
      message = 'This helper may only be used by a task trigger.';
  end if;

  select pg_catalog.max(task_row.sort_order)
  into v_tail_sort_order
  from public.tasks as task_row
  where task_row.event_id = p_event_id
    and task_row.phase is not distinct from p_phase
    and task_row.status = p_status
    and task_row.id is distinct from p_exclude_task_id;

  return coalesce(v_tail_sort_order, 0::bigint);
end;
$$;

alter function public.task_lane_tail_sort_order(uuid, text, text, uuid)
owner to postgres;
revoke all on function public.task_lane_tail_sort_order(uuid, text, text, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.task_lane_tail_sort_order(uuid, text, text, uuid)
to authenticated;

-- Reopen is the sole manual completed-phase exception. The UI must pass the
-- exact updated_at string returned by the database reader without constructing
-- a JavaScript Date: Date round-tripping loses PostgreSQL microseconds, exactly
-- as documented for Batch 13d event deletion.
create function public.reopen_completed_phase_task(
  p_task_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  task_id uuid,
  status text,
  sort_order bigint,
  phase_key text,
  phase_complete boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_event_id uuid;
  v_event_creator uuid;
  v_event_status text;
  v_phase text;
  v_phase_key text;
  v_task_status text;
  v_updated_at timestamptz;
  v_new_sort_order bigint;
  v_affected integer;
begin
  if p_task_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'A task and exact version are required.';
  end if;

  select user_row.role into v_role
  from public.users as user_row
  where user_row.id = v_actor and user_row.is_active is true;
  if v_actor is null or not found or v_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  select task_row.event_id, task_row.phase
  into v_event_id, v_phase
  from public.tasks as task_row
  where task_row.id = p_task_id;
  if not found then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;
  v_phase_key := public.canonical_task_phase(v_phase);

  select event_row.created_by, event_row.status
  into v_event_creator, v_event_status
  from public.events as event_row
  where event_row.id = v_event_id
  for share;
  if not found then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_event_id)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    public.task_phase_lock_key(v_event_id, v_phase_key)
  );

  select task_row.event_id, task_row.phase, task_row.status, task_row.updated_at
  into v_event_id, v_phase, v_task_status, v_updated_at
  from public.tasks as task_row
  where task_row.id = p_task_id
  for update;
  if not found
     or public.canonical_task_phase(v_phase) is distinct from v_phase_key then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  select event_row.created_by, event_row.status
  into v_event_creator, v_event_status
  from public.events as event_row
  where event_row.id = v_event_id;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;
  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCQ04', message = 'Archived tasks cannot be reopened.';
  end if;
  if v_event_status not in ('Draft', 'Active') then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  if v_role = 'Co-Admin' and (
    v_event_creator is distinct from v_actor
    or public.task_content_access_for_user(p_task_id, v_actor) is distinct from 'real'
  ) then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = 'CCQ05',
      message = 'This task changed after it was loaded. Refresh and try again.';
  end if;
  if v_task_status is distinct from 'Completed' then
    raise exception using errcode = 'CCQ06', message = 'Only a completed task can reopen its phase.';
  end if;
  if public.task_phase_is_complete(v_event_id, v_phase_key) is not true then
    raise exception using errcode = 'CCQ07', message = 'This phase is no longer complete.';
  end if;

  insert into ceit_connect_private.completed_phase_reopen_context (
    transaction_id, task_id, event_id, phase_key
  ) values (
    pg_catalog.pg_current_xact_id(), p_task_id, v_event_id, v_phase_key
  );

  begin
    v_new_sort_order := public.task_lane_tail_sort_order(
      v_event_id,
      v_phase,
      'In Progress',
      p_task_id
    ) + 1024::bigint;
    if v_new_sort_order <= 0 then
      raise exception 'The destination rank could not be calculated safely.';
    end if;

    update public.tasks as task_row
    set status = 'In Progress', sort_order = v_new_sort_order
    where task_row.id = p_task_id
      and task_row.event_id = v_event_id
      and task_row.status = 'Completed'
      and task_row.updated_at = p_expected_updated_at;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using
        errcode = '40001',
        message = 'The task changed. Refresh and try again.';
    end if;

    delete from ceit_connect_private.completed_phase_reopen_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id();
  exception when others then
    delete from ceit_connect_private.completed_phase_reopen_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id();
    raise;
  end;

  if public.task_phase_is_complete(v_event_id, v_phase_key) then
    raise exception 'The phase did not reopen safely.';
  end if;

  return query
  select task_row.id,
         task_row.status,
         task_row.sort_order,
         v_phase_key,
         false
  from public.tasks as task_row
  where task_row.id = p_task_id and task_row.event_id = v_event_id;
end;
$$;

alter function public.reopen_completed_phase_task(uuid, timestamptz) owner to postgres;
revoke all on function public.reopen_completed_phase_task(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.reopen_completed_phase_task(uuid, timestamptz)
to authenticated;

