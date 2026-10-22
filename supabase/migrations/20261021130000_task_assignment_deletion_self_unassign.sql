-- Phase 4 Step 7A: narrow assignment, deletion, and self-unassign controls.
-- The three public writers derive auth.uid(), re-read every authorization and
-- lifecycle fact, and never broaden raw task RLS. The internal reset helper is
-- invoker-security and has no client grant.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Step 7A must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

-- The owner branch is shared by the narrow postgres-owned task writers. Its
-- column union is exact: move_task needs status/sort_order,
-- set_task_dependency needs depends_on_task_id, and the Step 7A assignment
-- writers need both assignee arrays.
create or replace function public.restrict_assignee_task_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'postgres' then
    if (
      to_jsonb(new)
        - 'status'
        - 'sort_order'
        - 'depends_on_task_id'
        - 'primary_assignees'
        - 'assist_assignees'
    ) is distinct from (
      to_jsonb(old)
        - 'status'
        - 'sort_order'
        - 'depends_on_task_id'
        - 'primary_assignees'
        - 'assist_assignees'
    ) then
      raise exception
        'Privileged task writers may update only status, sort_order, depends_on_task_id, primary_assignees, and assist_assignees.';
    end if;

    return new;
  end if;

  if public.my_role() = 'Admin'
     or (
       public.my_role() = 'Co-Admin'
       and public.my_committee_id() = new.committee_id
     ) then
    return new;
  end if;

  if (to_jsonb(new) - 'status') is distinct from
     (to_jsonb(old) - 'status') then
    raise exception 'Assignees can only update a task''s status.';
  end if;

  return new;
end;
$$;

alter function public.restrict_assignee_task_updates()
owner to postgres;

revoke all on function public.restrict_assignee_task_updates()
from public, anon, authenticated;

-- The two assignment writers may call this only when a zero-primary task is
-- leaving a non-To-Do, non-Completed status, after locking event -> advisory
-- key -> task row. It mirrors move_task's destination-tail and exhausted-rank
-- rebalance pattern. The helper can rebalance other To Do rows, but the target
-- task remains a single combined UPDATE in the public caller so activity logs
-- exactly once.
create function public.prepare_unassigned_task_reset(
  p_event_id uuid,
  p_task_id uuid,
  p_phase text
)
returns table (
  out_reset_status text,
  out_reset_sort_order bigint,
  out_constraint_was_deferred boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_lane_count bigint;
  v_lane_max bigint;
  v_expected_rebalance_count bigint;
  v_affected bigint;
begin
  select count(*), max(task_row.sort_order)
  into v_lane_count, v_lane_max
  from public.tasks task_row
  where task_row.event_id = p_event_id
    and task_row.phase is not distinct from p_phase
    and task_row.status = 'To Do'
    and task_row.id <> p_task_id;

  out_reset_status := 'To Do';

  if v_lane_max is null or v_lane_max <= 9223372036854774783::bigint then
    out_reset_sort_order := coalesce(v_lane_max, 0::bigint) + 1024::bigint;
    out_constraint_was_deferred := false;
    return next;
    return;
  end if;

  if v_lane_count::numeric + 1::numeric
     > (9223372036854775807::numeric / 1024::numeric) then
    raise exception 'Task order is exhausted for this lane.';
  end if;

  set constraints public.tasks_lane_sort_order_key deferred;

  with ranked_rows as (
    select
      lane_task.id,
      row_number() over (
        order by lane_task.sort_order, lane_task.id
      )::bigint * 1024::bigint as new_sort_order
    from public.tasks lane_task
    where lane_task.event_id = p_event_id
      and lane_task.phase is not distinct from p_phase
      and lane_task.status = 'To Do'
      and lane_task.id <> p_task_id
  ), changed_rows as (
    select ranked_row.id, ranked_row.new_sort_order
    from ranked_rows ranked_row
    join public.tasks current_row on current_row.id = ranked_row.id
    where current_row.sort_order is distinct from ranked_row.new_sort_order
  )
  select count(*)
  into v_expected_rebalance_count
  from changed_rows;

  with ranked_rows as (
    select
      lane_task.id,
      row_number() over (
        order by lane_task.sort_order, lane_task.id
      )::bigint * 1024::bigint as new_sort_order
    from public.tasks lane_task
    where lane_task.event_id = p_event_id
      and lane_task.phase is not distinct from p_phase
      and lane_task.status = 'To Do'
      and lane_task.id <> p_task_id
  )
  update public.tasks as rebalance_target
  set sort_order = ranked_row.new_sort_order
  from ranked_rows ranked_row
  where rebalance_target.id = ranked_row.id
    and rebalance_target.sort_order is distinct from ranked_row.new_sort_order;

  get diagnostics v_affected = row_count;
  if v_affected <> v_expected_rebalance_count then
    raise exception 'The destination lane could not be rebalanced safely.';
  end if;

  out_reset_sort_order := (v_lane_count + 1::bigint) * 1024::bigint;
  out_constraint_was_deferred := true;
  return next;
end;
$$;

alter function public.prepare_unassigned_task_reset(uuid, uuid, text)
owner to postgres;

revoke all on function public.prepare_unassigned_task_reset(uuid, uuid, text)
from public, anon, authenticated;

create function public.assign_task_people(
  p_task_id uuid,
  p_primary_assignees uuid[],
  p_assist_assignees uuid[]
)
returns table (
  out_task_id uuid,
  out_status text,
  out_sort_order bigint,
  out_primary_assignees uuid[],
  out_assist_assignees uuid[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_discovered_event_id uuid;
  v_locked_event_id uuid;
  v_event_status text;
  v_task_event_id uuid;
  v_task_phase text;
  v_task_status text;
  v_task_sort_order bigint;
  v_stored_primary_assignees uuid[];
  v_stored_assist_assignees uuid[];
  v_new_status text;
  v_new_sort_order bigint;
  v_constraint_was_deferred boolean := false;
  v_affected integer;
begin
  if p_task_id is null
     or p_primary_assignees is null
     or p_assist_assignees is null then
    raise exception using
      errcode = '22023',
      message = 'A task and both assignee lists are required.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only an active Admin or Co-Admin can assign task people.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its assignees.';
  end if;

  select task_row.event_id
  into v_discovered_event_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task is unavailable.';
  end if;

  select event_row.id, event_row.status
  into v_locked_event_id, v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task event is unavailable. Refresh and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if v_event_status not in ('Draft', 'Active') then
    raise exception 'The task''s event is not writable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_locked_event_id)
  );

  select
    task_row.event_id,
    task_row.phase,
    task_row.status,
    task_row.sort_order,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    v_task_event_id,
    v_task_phase,
    v_task_status,
    v_task_sort_order,
    v_stored_primary_assignees,
    v_stored_assist_assignees
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its assignees.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees)
       + pg_catalog.cardinality(p_assist_assignees) > 100 then
    raise exception using
      errcode = '22023',
      message = 'A task cannot have more than 100 assignees.';
  end if;

  if pg_catalog.array_position(p_primary_assignees, null::uuid) is not null
     or pg_catalog.array_position(p_assist_assignees, null::uuid) is not null then
    raise exception using
      errcode = '22023',
      message = 'Assignee lists cannot contain null values.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees) <>
       (select count(distinct proposed.id) from unnest(p_primary_assignees) proposed(id))
     or pg_catalog.cardinality(p_assist_assignees) <>
       (select count(distinct proposed.id) from unnest(p_assist_assignees) proposed(id)) then
    raise exception using
      errcode = '22023',
      message = 'Each assignee may appear only once in a list.';
  end if;

  if p_primary_assignees && p_assist_assignees then
    raise exception using
      errcode = '22023',
      message = 'A person cannot be both a primary and assist assignee.';
  end if;

  if exists (
    select 1
    from unnest(p_primary_assignees) proposed(id)
    left join public.users user_row on user_row.id = proposed.id
    where user_row.id is null
       or (
         user_row.is_active is not true
         and not (proposed.id = any(v_stored_primary_assignees))
       )
  ) or exists (
    select 1
    from unnest(p_assist_assignees) proposed(id)
    left join public.users user_row on user_row.id = proposed.id
    where user_row.id is null
       or (
         user_row.is_active is not true
         and not (proposed.id = any(v_stored_assist_assignees))
       )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every assignee must exist, and newly added assignees must be active.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees) =
       pg_catalog.cardinality(v_stored_primary_assignees)
     and p_primary_assignees <@ v_stored_primary_assignees
     and pg_catalog.cardinality(p_assist_assignees) =
       pg_catalog.cardinality(v_stored_assist_assignees)
     and p_assist_assignees <@ v_stored_assist_assignees then
    raise exception using
      errcode = 'CCN01',
      message = 'Assignees are already up to date.';
  end if;

  v_new_status := v_task_status;
  v_new_sort_order := v_task_sort_order;

  if v_task_status not in ('To Do', 'Completed')
     and pg_catalog.cardinality(p_primary_assignees) = 0 then
    select
      reset_row.out_reset_status,
      reset_row.out_reset_sort_order,
      reset_row.out_constraint_was_deferred
    into
      v_new_status,
      v_new_sort_order,
      v_constraint_was_deferred
    from public.prepare_unassigned_task_reset(
      v_locked_event_id,
      p_task_id,
      v_task_phase
    ) reset_row;
  end if;

  update public.tasks as task_row
  set primary_assignees = p_primary_assignees,
      assist_assignees = p_assist_assignees,
      status = v_new_status,
      sort_order = v_new_sort_order
  where task_row.id = p_task_id
    and task_row.event_id = v_locked_event_id
  returning
    task_row.id,
    task_row.status,
    task_row.sort_order,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    out_task_id,
    out_status,
    out_sort_order,
    out_primary_assignees,
    out_assist_assignees;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_constraint_was_deferred then
    set constraints public.tasks_lane_sort_order_key immediate;
  end if;

  return next;
end;
$$;

alter function public.assign_task_people(uuid, uuid[], uuid[])
owner to postgres;

revoke all on function public.assign_task_people(uuid, uuid[], uuid[])
from public, anon, authenticated;
grant execute on function public.assign_task_people(uuid, uuid[], uuid[])
to authenticated;

create function public.delete_task(p_task_id uuid)
returns table (
  out_task_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_discovered_event_id uuid;
  v_locked_event_id uuid;
  v_event_status text;
  v_task_event_id uuid;
  v_task_status text;
  v_affected integer;
begin
  if p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'A task is required.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only an active Admin or Co-Admin can delete a task.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to delete it.';
  end if;

  select task_row.event_id
  into v_discovered_event_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task is unavailable.';
  end if;

  select event_row.id, event_row.status
  into v_locked_event_id, v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for update;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task event is unavailable. Refresh and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if v_event_status not in ('Draft', 'Active') then
    raise exception 'The task''s event is not writable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_locked_event_id)
  );

  select task_row.event_id, task_row.status
  into v_task_event_id, v_task_status
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to delete it.';
  end if;

  if v_task_status <> 'To Do' then
    raise exception using
      errcode = '22023',
      message = 'Only a To Do task can be deleted.';
  end if;

  if exists (
    select 1
    from public.tasks dependent
    where dependent.depends_on_task_id = p_task_id
  ) then
    raise exception using
      errcode = 'CCD01',
      message = 'This task cannot be deleted because another task depends on it.';
  end if;

  if v_event_status = 'Active'
     and not exists (
       select 1
       from public.tasks other_task
       where other_task.event_id = v_locked_event_id
         and other_task.id <> p_task_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'An Active event must have at least one task.';
  end if;

  delete from public.tasks as task_row
  where task_row.id = p_task_id
    and task_row.event_id = v_locked_event_id
  returning task_row.id into out_task_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  return next;
end;
$$;

alter function public.delete_task(uuid)
owner to postgres;

revoke all on function public.delete_task(uuid)
from public, anon, authenticated;
grant execute on function public.delete_task(uuid)
to authenticated;

create function public.unassign_self(p_task_id uuid)
returns table (
  out_task_id uuid,
  out_status text,
  out_sort_order bigint,
  out_primary_assignees uuid[],
  out_assist_assignees uuid[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_self_unassign_cutoff constant interval := interval '72 hours';
  v_caller_id uuid := auth.uid();
  v_discovered_event_id uuid;
  v_locked_event_id uuid;
  v_event_status text;
  v_task_event_id uuid;
  v_task_phase text;
  v_task_status text;
  v_task_sort_order bigint;
  v_task_due_date timestamptz;
  v_stored_primary_assignees uuid[];
  v_stored_assist_assignees uuid[];
  v_new_primary_assignees uuid[];
  v_new_assist_assignees uuid[];
  v_new_status text;
  v_new_sort_order bigint;
  v_constraint_was_deferred boolean := false;
  v_affected integer;
begin
  if p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'A task is required.';
  end if;

  perform 1
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null or not found then
    raise exception using
      errcode = '42501',
      message = 'Only an active assignee can leave a task.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to leave it.';
  end if;

  select task_row.event_id
  into v_discovered_event_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task is unavailable.';
  end if;

  select event_row.id, event_row.status
  into v_locked_event_id, v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task event is unavailable. Refresh and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if v_event_status <> 'Active' then
    raise exception using
      errcode = '42501',
      message = 'You can leave only a task in an Active event.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_locked_event_id)
  );

  select
    task_row.event_id,
    task_row.phase,
    task_row.status,
    task_row.sort_order,
    task_row.due_date,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    v_task_event_id,
    v_task_phase,
    v_task_status,
    v_task_sort_order,
    v_task_due_date,
    v_stored_primary_assignees,
    v_stored_assist_assignees
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to leave it.';
  end if;

  if not (
    v_caller_id = any(v_stored_primary_assignees)
    or v_caller_id = any(v_stored_assist_assignees)
  ) then
    raise exception using
      errcode = '42501',
      message = 'You are no longer assigned to this task.';
  end if;

  if v_task_status = 'Completed' then
    raise exception using
      errcode = 'CCU73',
      message = 'Completed tasks cannot be self-unassigned. Ask an Admin or Co-Admin to update the assignees.';
  end if;

  if v_task_due_date is not null
     and v_task_due_date <= pg_catalog.clock_timestamp() + c_self_unassign_cutoff then
    raise exception using
      errcode = 'CCU72',
      message = 'This task is due within 72 hours. Ask an Admin or Co-Admin to remove you.';
  end if;

  v_new_primary_assignees := pg_catalog.array_remove(
    v_stored_primary_assignees,
    v_caller_id
  );
  v_new_assist_assignees := pg_catalog.array_remove(
    v_stored_assist_assignees,
    v_caller_id
  );
  v_new_status := v_task_status;
  v_new_sort_order := v_task_sort_order;

  if v_task_status not in ('To Do', 'Completed')
     and pg_catalog.cardinality(v_new_primary_assignees) = 0 then
    select
      reset_row.out_reset_status,
      reset_row.out_reset_sort_order,
      reset_row.out_constraint_was_deferred
    into
      v_new_status,
      v_new_sort_order,
      v_constraint_was_deferred
    from public.prepare_unassigned_task_reset(
      v_locked_event_id,
      p_task_id,
      v_task_phase
    ) reset_row;
  end if;

  update public.tasks as task_row
  set primary_assignees = v_new_primary_assignees,
      assist_assignees = v_new_assist_assignees,
      status = v_new_status,
      sort_order = v_new_sort_order
  where task_row.id = p_task_id
    and task_row.event_id = v_locked_event_id
  returning
    task_row.id,
    task_row.status,
    task_row.sort_order,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    out_task_id,
    out_status,
    out_sort_order,
    out_primary_assignees,
    out_assist_assignees;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_constraint_was_deferred then
    set constraints public.tasks_lane_sort_order_key immediate;
  end if;

  return next;
end;
$$;

alter function public.unassign_self(uuid)
owner to postgres;

revoke all on function public.unassign_self(uuid)
from public, anon, authenticated;
grant execute on function public.unassign_self(uuid)
to authenticated;

-- Backlog means an incomplete task with no primary owner. Assist assignees
-- remain visible but do not keep a task out of Backlog. The 12-column contract,
-- masking, ordering, lifecycle behavior, security attributes, and grants stay
-- unchanged.
create or replace function public.list_event_board_tasks(
  p_event_id uuid,
  p_committee_id uuid default null
)
returns table (
  id uuid,
  title text,
  phase text,
  status text,
  effective_priority text,
  due_date timestamptz,
  committee_id uuid,
  committee_name text,
  primary_assignees jsonb,
  assist_assignees jsonb,
  is_backlog boolean,
  is_masked boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role text;
  v_event_status text;
  v_as_of timestamptz := statement_timestamp();
begin
  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = auth.uid()
    and user_row.is_active is true;

  if not found then
    return;
  end if;

  if p_committee_id is not null and v_caller_role <> 'Admin' then
    raise exception using
      errcode = '42501',
      message = 'Committee filtering is Admin-only.';
  end if;

  if p_committee_id is not null
     and not exists (
       select 1
       from public.committees committee_row
       where committee_row.id = p_committee_id
     ) then
    raise exception using
      errcode = '22023',
      message = 'Unknown committee filter.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = p_event_id;

  if not found or v_event_status not in ('Active', 'Draft') then
    return;
  end if;

  if v_event_status = 'Draft'
     and v_caller_role not in ('Admin', 'Co-Admin') then
    return;
  end if;

  return query
  with board_tasks as materialized (
    select
      task_row.id,
      task_row.title,
      task_row.phase,
      task_row.status,
      task_row.priority,
      task_row.due_date,
      task_row.committee_id,
      committee_row.name as committee_name,
      task_row.primary_assignees,
      task_row.assist_assignees,
      task_row.sort_order,
      public.task_content_access(task_row.id) as content_access
    from public.tasks task_row
    join public.committees committee_row
      on committee_row.id = task_row.committee_id
    where task_row.event_id = p_event_id
      and (
        p_committee_id is null
        or task_row.committee_id = p_committee_id
      )
  )
  select
    bt.id,
    case
      when bt.content_access = 'real' then bt.title
      else 'Confidential Task'
    end,
    bt.phase,
    bt.status,
    case
      when bt.content_access = 'real' then
        public.calculate_effective_task_priority(
          bt.priority,
          bt.due_date,
          v_as_of,
          bt.status
        )
      else null
    end,
    case when bt.content_access = 'real' then bt.due_date else null end,
    case when bt.content_access = 'real' then bt.committee_id else null end,
    case when bt.content_access = 'real' then bt.committee_name else null end,
    case
      when bt.content_access = 'real' then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', assignee.id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by assignee.position
          )
          from unnest(bt.primary_assignees)
            with ordinality as assignee(id, position)
          left join public.users user_row on user_row.id = assignee.id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when bt.content_access = 'real' then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', assignee.id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by assignee.position
          )
          from unnest(bt.assist_assignees)
            with ordinality as assignee(id, position)
          left join public.users user_row on user_row.id = assignee.id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    pg_catalog.cardinality(bt.primary_assignees) = 0
      and bt.status <> 'Completed',
    bt.content_access = 'masked'
  from board_tasks bt
  where (
    v_event_status = 'Active'
    and bt.content_access in ('real', 'masked')
  ) or (
    v_event_status = 'Draft'
    and bt.content_access = 'real'
  )
  order by bt.sort_order, bt.id;
end;
$$;

alter function public.list_event_board_tasks(uuid, uuid)
owner to postgres;

revoke all on function public.list_event_board_tasks(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.list_event_board_tasks(uuid, uuid)
to authenticated;

-- The Step 7 reader keeps dependency/confidentiality behavior and adds only
-- real-access assignment/deletion/self-unassign state. Masked callers still
-- receive zero rows, so no assignee or management state leaks.
drop function public.get_task_edit_controls(uuid);

create function public.get_task_edit_controls(p_task_id uuid)
returns table (
  can_set_dependency boolean,
  can_set_confidentiality boolean,
  can_assign_people boolean,
  can_delete boolean,
  can_unassign_self boolean,
  self_unassign_block_code text,
  self_unassign_will_lose_access boolean,
  depends_on_task_id uuid,
  is_confidential boolean,
  allowed_viewers jsonb,
  dependency_options jsonb,
  viewer_options jsonb,
  primary_assignees jsonb,
  assist_assignees jsonb,
  assignee_options jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_self_unassign_cutoff constant interval := interval '72 hours';
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_task_event_id uuid;
  v_task_event_status text;
  v_task_committee_id uuid;
  v_task_status text;
  v_task_due_date timestamptz;
  v_task_dependency_id uuid;
  v_task_is_confidential boolean;
  v_task_allowed_viewers uuid[];
  v_task_primary_assignees uuid[];
  v_task_assist_assignees uuid[];
  v_is_leader boolean;
  v_is_self_assigned boolean;
  v_can_set_confidentiality boolean;
  v_self_unassign_block_code text;
  v_self_unassign_will_lose_access boolean;
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null or not found then
    return;
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    return;
  end if;

  select
    task_row.event_id,
    event_row.status,
    task_row.committee_id,
    task_row.status,
    task_row.due_date,
    task_row.depends_on_task_id,
    task_row.is_confidential,
    task_row.allowed_viewers,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    v_task_event_id,
    v_task_event_status,
    v_task_committee_id,
    v_task_status,
    v_task_due_date,
    v_task_dependency_id,
    v_task_is_confidential,
    v_task_allowed_viewers,
    v_task_primary_assignees,
    v_task_assist_assignees
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found or v_task_event_status not in ('Draft', 'Active') then
    return;
  end if;

  v_is_leader := v_caller_role in ('Admin', 'Co-Admin');
  v_is_self_assigned :=
    v_caller_id = any(v_task_primary_assignees)
    or v_caller_id = any(v_task_assist_assignees);

  if not v_is_leader and not v_is_self_assigned then
    return;
  end if;

  v_can_set_confidentiality :=
    v_is_leader
    and (
      v_caller_role = 'Admin'
      or v_caller_committee_id = v_task_committee_id
    );

  v_self_unassign_block_code := case
    when not v_is_self_assigned or v_task_event_status <> 'Active' then null
    when v_task_status = 'Completed' then 'completed'
    when v_task_due_date is not null
         and v_task_due_date <= statement_timestamp() + c_self_unassign_cutoff
      then 'due'
    else null
  end;

  v_self_unassign_will_lose_access :=
    v_is_self_assigned
    and v_task_is_confidential
    and v_caller_role <> 'Admin'
    and not (
      v_caller_role = 'Co-Admin'
      and v_caller_committee_id = v_task_committee_id
    )
    and not (v_caller_id = any(v_task_allowed_viewers));

  return query
  select
    v_is_leader,
    v_can_set_confidentiality,
    v_is_leader,
    v_is_leader and v_task_status = 'To Do',
    v_is_self_assigned
      and v_task_event_status = 'Active'
      and v_self_unassign_block_code is null,
    v_self_unassign_block_code,
    v_self_unassign_will_lose_access,
    case when v_is_leader then v_task_dependency_id else null end,
    case when v_can_set_confidentiality then v_task_is_confidential else null end,
    case
      when v_can_set_confidentiality then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', stored.viewer_id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by stored.position
          )
          from unnest(v_task_allowed_viewers)
            with ordinality as stored(viewer_id, position)
          left join public.users user_row on user_row.id = stored.viewer_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', option_row.id,
              'label', option_row.safe_label,
              'status', option_row.status
            )
            order by option_row.sort_order, option_row.id
          )
          from (
            select
              candidate.id,
              candidate.status,
              candidate.sort_order,
              case candidate_access.content_access
                when 'real' then candidate.title
                when 'masked' then 'Confidential Task'
              end as safe_label
            from public.tasks candidate
            cross join lateral (
              select public.task_content_access(candidate.id) as content_access
            ) candidate_access
            where candidate.event_id = v_task_event_id
              and candidate.id <> p_task_id
              and candidate_access.content_access in ('real', 'masked')
          ) option_row
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_can_set_confidentiality then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', user_option.id,
              'full_name', user_option.full_name,
              'avatar_url', user_option.avatar_url
            )
            order by user_option.full_name, user_option.id
          )
          from public.list_active_task_assignees() user_option
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', stored.assignee_id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by stored.position
          )
          from unnest(v_task_primary_assignees)
            with ordinality as stored(assignee_id, position)
          left join public.users user_row on user_row.id = stored.assignee_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', stored.assignee_id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by stored.position
          )
          from unnest(v_task_assist_assignees)
            with ordinality as stored(assignee_id, position)
          left join public.users user_row on user_row.id = stored.assignee_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', user_option.id,
              'full_name', user_option.full_name,
              'avatar_url', user_option.avatar_url
            )
            order by user_option.full_name, user_option.id
          )
          from public.list_active_task_assignees() user_option
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end;
end;
$$;

alter function public.get_task_edit_controls(uuid)
owner to postgres;

revoke all on function public.get_task_edit_controls(uuid)
from public, anon, authenticated;
grant execute on function public.get_task_edit_controls(uuid)
to authenticated;

-- Owner-branch writers are the non-trigger SECURITY DEFINER functions that
-- execute task DML as postgres. The internal reset helper is checked
-- separately because it is intentionally SECURITY INVOKER.
do $$
declare
  v_writer_count integer;
  v_writer_names text[];
begin
  select count(*), array_agg(writer.proname order by writer.proname)
  into v_writer_count, v_writer_names
  from (
    select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef is true
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and (
        p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
        or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M'
      )
  ) writer;

  if v_writer_count <> 5
     or v_writer_names is distinct from array[
       'assign_task_people',
       'delete_task',
       'move_task',
       'set_task_dependency',
       'unassign_self'
     ]::text[] then
    raise exception
      'Unexpected postgres owner-branch task writers: %.', v_writer_names;
  end if;
end
$$;

-- Pin the internal helper's security/grants and ensure its only callers are
-- the two approved assignment-reset RPCs. prosrc is used so the helper's own
-- CREATE FUNCTION header cannot count as a reference.
do $$
declare
  v_helper_oid oid :=
    'public.prepare_unassigned_task_reset(uuid,uuid,text)'::regprocedure;
  v_helper_is_correct boolean;
  v_reference_count integer;
  v_reference_names text[];
begin
  select
    not p.prosecdef
    and p.provolatile = 'v'
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and not pg_catalog.has_function_privilege(
      'anon', v_helper_oid, 'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated', v_helper_oid, 'EXECUTE'
    )
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  into v_helper_is_correct
  from pg_catalog.pg_proc p
  where p.oid = v_helper_oid;

  if not coalesce(v_helper_is_correct, false) then
    raise exception
      'prepare_unassigned_task_reset has unexpected security attributes or grants.';
  end if;

  select count(*), array_agg(p.proname order by p.proname)
  into v_reference_count, v_reference_names
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ '\mpublic\.prepare_unassigned_task_reset\M';

  if v_reference_count <> 2
     or v_reference_names is distinct from array[
       'assign_task_people',
       'unassign_self'
     ]::text[] then
    raise exception
      'Unexpected reset-helper callers: %.', v_reference_names;
  end if;
end
$$;

-- Full direct-writer inventory. The last three names are established paths:
-- guard_event_updates is the event-cascade trigger, edit_event_with_tasks is
-- the Step 5 invoker/RLS editor, and set_task_confidentiality is the Step 7
-- invoker/RLS writer. Step 7A does not alter their behavior.
do $$
declare
  v_writer_count integer;
  v_writer_names text[];
begin
  select count(*), array_agg(writer.proname order by writer.proname)
  into v_writer_count, v_writer_names
  from (
    select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and (
        p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
        or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M'
      )
  ) writer;

  if v_writer_count <> 9
     or v_writer_names is distinct from array[
       'assign_task_people',
       'delete_task',
       'edit_event_with_tasks',
       'guard_event_updates',
       'move_task',
       'prepare_unassigned_task_reset',
       'set_task_confidentiality',
       'set_task_dependency',
       'unassign_self'
     ]::text[] then
    raise exception
      'Unexpected full postgres-owned task-writer set: %.', v_writer_names;
  end if;
end
$$;
