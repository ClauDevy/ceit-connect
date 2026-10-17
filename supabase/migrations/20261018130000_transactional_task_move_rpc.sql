-- Phase 4 Step 5b: one transactional task-move writer. The RPC accepts
-- placement intent, never a client-selected rank, and serializes with every
-- Step 5a ordering/dependency writer on the same per-event advisory key.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Step 5b must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

-- The ordering trigger must remain SECURITY INVOKER so current_user tells a
-- raw authenticated write from a write made inside move_task(). Its tail read,
-- however, must see every row in the lane even when a Member cannot. This
-- minimal helper supplies only that internal scalar read. Authenticated has
-- EXECUTE because the invoker trigger calls it, but a top-level call fails
-- before reading anything; no task id, count, title, or rank is disclosed.
create function public.task_lane_tail_sort_order(
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
  if pg_catalog.pg_trigger_depth() = 0 then
    raise exception using
      errcode = '42501',
      message = 'This helper may only be used by a task trigger.';
  end if;

  select max(task_row.sort_order)
  into v_tail_sort_order
  from public.tasks task_row
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
from public, anon, authenticated;
grant execute on function public.task_lane_tail_sort_order(uuid, text, text, uuid)
to authenticated;

-- Raw authenticated callers retain the existing permissions: leadership may
-- use its existing committee-scoped update path, while an assignee may change
-- only status. The literal postgres branch is reachable only while a
-- postgres-owned SECURITY DEFINER task writer is active; a catalog assertion
-- below requires move_task() to be the only such function that updates tasks.
create or replace function public.restrict_assignee_task_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'postgres' then
    if (to_jsonb(new) - 'status' - 'sort_order') is distinct from
       (to_jsonb(old) - 'status' - 'sort_order') then
      raise exception 'The task-move writer may only update status and sort_order.';
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

-- Direct status changes still append to the true destination tail. The helper
-- performs the all-row read that RLS would otherwise hide from a Member. The
-- postgres branch accepts only values already validated by move_task(); the
-- earlier assignee guard rejects every other column difference.
create or replace function public.set_task_destination_lane_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lane_max bigint;
begin
  if old.event_id is distinct from new.event_id then
    return new;
  end if;

  if current_user = 'postgres' then
    if old.phase is distinct from new.phase then
      raise exception 'The task-move writer cannot change a task''s phase.';
    end if;

    return new;
  end if;

  if old.phase is not distinct from new.phase
     and old.status is not distinct from new.status then
    if old.sort_order is distinct from new.sort_order then
      raise exception 'Task order can only be changed through the task-move function.';
    end if;

    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(old.event_id)
  );

  v_lane_max := public.task_lane_tail_sort_order(
    old.event_id,
    new.phase,
    new.status,
    old.id
  );

  if v_lane_max > 9223372036854774783::bigint then
    raise exception 'Task order is exhausted for this lane.';
  end if;

  new.sort_order := v_lane_max + 1024::bigint;
  return new;
end;
$$;

alter function public.set_task_destination_lane_order()
owner to postgres;

revoke all on function public.set_task_destination_lane_order()
from public, anon, authenticated;

-- Rank-only writes are implementation detail, not business activity. Keep the
-- trigger SECURITY DEFINER because authenticated callers cannot insert into
-- activity_log themselves. Every non-rank task change retains the existing
-- full-row snapshot and auth.uid() attribution.
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (task_id, user_id, action, changes)
    values (new.id, auth.uid(), 'INSERT', to_jsonb(new));
  elsif TG_OP = 'UPDATE' then
    if (to_jsonb(new) - 'sort_order') is distinct from
       (to_jsonb(old) - 'sort_order') then
      insert into public.activity_log (task_id, user_id, action, changes)
      values (
        new.id,
        auth.uid(),
        'UPDATE',
        jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
      );
    end if;
  elsif TG_OP = 'DELETE' then
    insert into public.activity_log (task_id, user_id, action, changes)
    values (null, auth.uid(), 'DELETE', to_jsonb(old));
  end if;

  return coalesce(new, old);
end;
$$;

alter function public.log_task_activity()
owner to postgres;

revoke all on function public.log_task_activity()
from public, anon, authenticated;

create function public.move_task(
  p_task_id uuid,
  p_expected_phase text,
  p_expected_status text,
  p_destination_status text,
  p_previous_neighbor_id uuid,
  p_next_neighbor_id uuid
)
returns table (
  task_id uuid,
  status text,
  sort_order bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_discovered_event_id uuid;
  v_locked_event_id uuid;
  v_event_status text;
  v_task_event_id uuid;
  v_task_committee_id uuid;
  v_task_phase text;
  v_task_status text;
  v_destination_rank integer;
  v_source_rank integer;
  v_task_sort_order bigint;
  v_task_primary_assignees uuid[];
  v_task_assist_assignees uuid[];
  v_task_dependency_id uuid;
  v_dependency_event_id uuid;
  v_dependency_status text;
  v_previous_event_id uuid;
  v_previous_phase text;
  v_previous_status text;
  v_previous_sort_order bigint;
  v_next_event_id uuid;
  v_next_phase text;
  v_next_status text;
  v_next_sort_order bigint;
  v_lane_count integer := 0;
  v_expected_rebalance_count integer := 0;
  v_affected integer := 0;
  v_new_sort_order bigint;
  v_needs_rebalance boolean := false;
  v_is_assignee_move boolean := false;
  v_locked_lane_id uuid;
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null or not found then
    raise exception using
      errcode = '42501',
      message = 'Only an active user can move a task.';
  end if;

  if p_task_id is null
     or p_expected_status is null
     or p_destination_status is null
     or p_expected_status not in ('To Do', 'In Progress', 'Completed')
     or p_destination_status not in ('To Do', 'In Progress', 'Completed') then
    raise exception using
      errcode = '22023',
      message = 'A task and valid expected/destination statuses are required.';
  end if;

  if p_previous_neighbor_id = p_task_id
     or p_next_neighbor_id = p_task_id
     or (
       p_previous_neighbor_id is not null
       and p_previous_neighbor_id = p_next_neighbor_id
     ) then
    raise exception using
      errcode = '40001',
      message = 'Task placement changed. Refresh the board and try again.';
  end if;

  -- Discovery is deliberately unlocked. The event row is the first lock; the
  -- task is then re-read under lock after the shared event advisory lock.
  select task_row.event_id
  into v_discovered_event_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task cannot be moved.';
  end if;

  select event_row.id, event_row.status
  into v_locked_event_id, v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh the board and try again.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_locked_event_id)
  );

  select task_row.event_id,
         task_row.committee_id,
         task_row.phase,
         task_row.status,
         task_row.sort_order,
         task_row.primary_assignees,
         task_row.assist_assignees,
         task_row.depends_on_task_id
  into v_task_event_id,
       v_task_committee_id,
       v_task_phase,
       v_task_status,
       v_task_sort_order,
       v_task_primary_assignees,
       v_task_assist_assignees,
       v_task_dependency_id
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
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
  elsif v_caller_role = 'Member'
        and v_event_status = 'Active'
        and (
          v_caller_id = any(v_task_primary_assignees)
          or v_caller_id = any(v_task_assist_assignees)
        ) then
    v_is_assignee_move := true;
  else
    raise exception using
      errcode = '42501',
      message = 'You are not allowed to move this task.';
  end if;

  if v_task_phase is distinct from p_expected_phase
     or v_task_status is distinct from p_expected_status then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh the board and try again.';
  end if;

  if v_is_assignee_move then
    if p_destination_status = v_task_status then
      raise exception using
        errcode = '42501',
        message = 'Assignees can change status but cannot reorder tasks.';
    end if;

    if p_previous_neighbor_id is not null or p_next_neighbor_id is not null then
      raise exception using
        errcode = '42501',
        message = 'Assignee status changes always move to the destination tail.';
    end if;
  end if;

  if v_task_dependency_id is not null then
    select dependency_row.event_id, dependency_row.status
    into v_dependency_event_id, v_dependency_status
    from public.tasks dependency_row
    where dependency_row.id = v_task_dependency_id
    for share;

    if not found or v_dependency_event_id is distinct from v_locked_event_id then
      raise exception using
        errcode = '40001',
        message = 'The task dependency changed. Refresh the board and try again.';
    end if;
  end if;

  v_destination_rank := case p_destination_status when 'To Do' then 1 when 'In Progress' then 2 when 'Completed' then 3 end;
  v_source_rank := case v_task_status when 'To Do' then 1 when 'In Progress' then 2 when 'Completed' then 3 end;

  if v_destination_rank > v_source_rank
     and v_task_dependency_id is not null
     and v_dependency_status is distinct from 'Completed' then
    raise exception 'Complete the prerequisite task before moving this task forward.';
  end if;

  -- Every destination row is locked in one deterministic order. This includes
  -- hidden rows because the function is the narrow postgres-owned writer.
  for v_locked_lane_id in
    select lane_row.id
    from public.tasks lane_row
    where lane_row.event_id = v_locked_event_id
      and lane_row.phase is not distinct from v_task_phase
      and lane_row.status = p_destination_status
      and lane_row.id <> p_task_id
    order by lane_row.sort_order, lane_row.id
    for update
  loop
    v_lane_count := v_lane_count + 1;
  end loop;

  if p_previous_neighbor_id is not null then
    select previous_row.event_id,
           previous_row.phase,
           previous_row.status,
           previous_row.sort_order
    into v_previous_event_id,
         v_previous_phase,
         v_previous_status,
         v_previous_sort_order
    from public.tasks previous_row
    where previous_row.id = p_previous_neighbor_id;

    if not found
       or v_previous_event_id is distinct from v_locked_event_id
       or v_previous_phase is distinct from v_task_phase
       or v_previous_status is distinct from p_destination_status then
      raise exception using
        errcode = '40001',
        message = 'Task placement changed. Refresh the board and try again.';
    end if;
  end if;

  if p_next_neighbor_id is not null then
    select next_row.event_id,
           next_row.phase,
           next_row.status,
           next_row.sort_order
    into v_next_event_id,
         v_next_phase,
         v_next_status,
         v_next_sort_order
    from public.tasks next_row
    where next_row.id = p_next_neighbor_id;

    if not found
       or v_next_event_id is distinct from v_locked_event_id
       or v_next_phase is distinct from v_task_phase
       or v_next_status is distinct from p_destination_status then
      raise exception using
        errcode = '40001',
        message = 'Task placement changed. Refresh the board and try again.';
    end if;
  end if;

  if p_previous_neighbor_id is not null
     and p_next_neighbor_id is not null then
    if v_previous_sort_order >= v_next_sort_order
       or exists (
         select 1
         from public.tasks between_row
         where between_row.event_id = v_locked_event_id
           and between_row.phase is not distinct from v_task_phase
           and between_row.status = p_destination_status
           and between_row.id <> p_task_id
           and between_row.sort_order > v_previous_sort_order
           and between_row.sort_order < v_next_sort_order
       ) then
      raise exception using
        errcode = '40001',
        message = 'Task placement changed. Refresh the board and try again.';
    end if;
  elsif p_previous_neighbor_id is null
        and p_next_neighbor_id is not null then
    if exists (
      select 1
      from public.tasks earlier_row
      where earlier_row.event_id = v_locked_event_id
        and earlier_row.phase is not distinct from v_task_phase
        and earlier_row.status = p_destination_status
        and earlier_row.id <> p_task_id
        and earlier_row.sort_order < v_next_sort_order
    ) then
      raise exception using
        errcode = '40001',
        message = 'Task placement changed. Refresh the board and try again.';
    end if;
  elsif p_previous_neighbor_id is not null
        and p_next_neighbor_id is null then
    if exists (
      select 1
      from public.tasks later_row
      where later_row.event_id = v_locked_event_id
        and later_row.phase is not distinct from v_task_phase
        and later_row.status = p_destination_status
        and later_row.id <> p_task_id
        and later_row.sort_order > v_previous_sort_order
    ) then
      raise exception using
        errcode = '40001',
        message = 'Task placement changed. Refresh the board and try again.';
    end if;
  elsif p_destination_status = v_task_status and v_lane_count <> 0 then
    raise exception using
      errcode = '40001',
      message = 'Same-lane placement requires current neighbor hints.';
  end if;

  if p_previous_neighbor_id is null and p_next_neighbor_id is null then
    select max(tail_row.sort_order)
    into v_previous_sort_order
    from public.tasks tail_row
    where tail_row.event_id = v_locked_event_id
      and tail_row.phase is not distinct from v_task_phase
      and tail_row.status = p_destination_status
      and tail_row.id <> p_task_id;

    if v_previous_sort_order is null then
      v_new_sort_order := 1024::bigint;
    elsif v_previous_sort_order <= 9223372036854774783::bigint then
      v_new_sort_order := v_previous_sort_order + 1024::bigint;
    else
      v_needs_rebalance := true;
    end if;
  elsif p_previous_neighbor_id is null then
    if v_next_sort_order > 1::bigint then
      v_new_sort_order := v_next_sort_order / 2::bigint;
    else
      v_needs_rebalance := true;
    end if;
  elsif p_next_neighbor_id is null then
    if v_previous_sort_order <= 9223372036854774783::bigint then
      v_new_sort_order := v_previous_sort_order + 1024::bigint;
    else
      v_needs_rebalance := true;
    end if;
  elsif v_next_sort_order - v_previous_sort_order > 1::bigint then
    v_new_sort_order := v_previous_sort_order
      + ((v_next_sort_order - v_previous_sort_order) / 2::bigint);
  else
    v_needs_rebalance := true;
  end if;

  if v_needs_rebalance then
    if v_lane_count::numeric + 1::numeric
       > (9223372036854775807::numeric / 1024::numeric) then
      raise exception 'Task order is exhausted for this lane.';
    end if;

    set constraints public.tasks_lane_sort_order_key deferred;

    with ranked_rows as (
      select rebalance_source.id,
             row_number() over (
               order by rebalance_source.sort_order, rebalance_source.id
             )::bigint * 1024::bigint as new_sort_order
      from public.tasks rebalance_source
      where rebalance_source.event_id = v_locked_event_id
        and rebalance_source.phase is not distinct from v_task_phase
        and rebalance_source.status = p_destination_status
        and rebalance_source.id <> p_task_id
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
      select rebalance_source.id,
             row_number() over (
               order by rebalance_source.sort_order, rebalance_source.id
             )::bigint * 1024::bigint as new_sort_order
      from public.tasks rebalance_source
      where rebalance_source.event_id = v_locked_event_id
        and rebalance_source.phase is not distinct from v_task_phase
        and rebalance_source.status = p_destination_status
        and rebalance_source.id <> p_task_id
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

    if p_previous_neighbor_id is not null then
      select previous_row.sort_order
      into v_previous_sort_order
      from public.tasks previous_row
      where previous_row.id = p_previous_neighbor_id;
    end if;

    if p_next_neighbor_id is not null then
      select next_row.sort_order
      into v_next_sort_order
      from public.tasks next_row
      where next_row.id = p_next_neighbor_id;
    end if;

    if p_previous_neighbor_id is null and p_next_neighbor_id is null then
      select max(tail_row.sort_order)
      into v_previous_sort_order
      from public.tasks tail_row
      where tail_row.event_id = v_locked_event_id
        and tail_row.phase is not distinct from v_task_phase
        and tail_row.status = p_destination_status
        and tail_row.id <> p_task_id;

      v_new_sort_order := coalesce(v_previous_sort_order, 0::bigint)
        + 1024::bigint;
    elsif p_previous_neighbor_id is null then
      v_new_sort_order := v_next_sort_order / 2::bigint;
    elsif p_next_neighbor_id is null then
      v_new_sort_order := v_previous_sort_order + 1024::bigint;
    else
      v_new_sort_order := v_previous_sort_order
        + ((v_next_sort_order - v_previous_sort_order) / 2::bigint);
    end if;
  end if;

  if v_new_sort_order is null or v_new_sort_order <= 0 then
    raise exception 'The destination rank could not be calculated safely.';
  end if;

  update public.tasks as moved_task
  set status = p_destination_status,
      sort_order = v_new_sort_order
  where moved_task.id = p_task_id
    and moved_task.event_id = v_locked_event_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh the board and try again.';
  end if;

  if v_needs_rebalance then
    set constraints public.tasks_lane_sort_order_key immediate;
  end if;

  return query
  select moved_task.id,
         moved_task.status,
         moved_task.sort_order
  from public.tasks moved_task
  where moved_task.id = p_task_id
    and moved_task.event_id = v_locked_event_id;
end;
$$;

alter function public.move_task(uuid, text, text, text, uuid, uuid)
owner to postgres;

revoke all on function public.move_task(uuid, text, text, text, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.move_task(uuid, text, text, text, uuid, uuid)
to authenticated;

-- Fail closed if the literal owner exemption and the actual move-function
-- owner ever diverge, or if another postgres-owned definer function can reach
-- that exemption by issuing an UPDATE against public.tasks.
do $$
declare
  v_move_owner text;
  v_definer_task_updaters regprocedure[];
begin
  if current_user <> 'postgres' then
    raise exception
      'Step 5b ownership verification must run as postgres; current_user is %.',
      current_user;
  end if;

  select pg_catalog.pg_get_userbyid(function_row.proowner)
  into v_move_owner
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.oid = 'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure;

  if v_move_owner is distinct from 'postgres' then
    raise exception
      'move_task owner must match the postgres trigger exemption; found %.',
      coalesce(v_move_owner, '<missing>');
  end if;

  select array_agg(
           function_row.oid::regprocedure
           order by function_row.oid::regprocedure::text
         )
  into v_definer_task_updaters
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace namespace_row
    on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'public'
    and function_row.prosecdef is true
    and pg_catalog.pg_get_userbyid(function_row.proowner) = 'postgres'
    and pg_catalog.pg_get_functiondef(function_row.oid)
      ~* '\mupdate[[:space:]]+public\.tasks\M';

  if v_definer_task_updaters is distinct from
     array['public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure] then
    raise exception
      'move_task must be the only postgres-owned SECURITY DEFINER task updater; found %.',
      coalesce(v_definer_task_updaters::text, '{}');
  end if;
end
$$;
