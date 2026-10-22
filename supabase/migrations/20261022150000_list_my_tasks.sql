-- Phase 4 Step 9A-DB: caller-scoped, read-only personal task feed.
-- This migration creates one new function and does not replace any existing
-- function or change raw table grants, policies, columns, or indexes.

create function public.list_my_tasks(
  p_status text default null,
  p_sort text default 'deadline',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  out_id uuid,
  out_title text,
  out_event_id uuid,
  out_event_name text,
  out_phase text,
  out_status text,
  out_effective_priority text,
  out_due_date timestamptz,
  out_committee_id uuid,
  out_committee_name text,
  out_is_primary boolean,
  out_is_assist boolean,
  out_request_backup boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_as_of timestamptz := statement_timestamp();
begin
  if v_caller_id is null or not exists (
    select 1
    from public.users caller
    where caller.id = v_caller_id
      and caller.is_active is true
  ) then
    raise exception using
      errcode = 'CCF01',
      message = 'An active account is required.';
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 then
    raise exception using
      errcode = 'CCF02',
      message = 'My Tasks pagination is invalid.';
  end if;

  if p_status is not null
     and p_status not in ('To Do', 'In Progress', 'Completed') then
    raise exception using
      errcode = 'CCF03',
      message = 'My Tasks status filter is invalid.';
  end if;

  if p_sort is null or p_sort not in ('deadline', 'priority', 'event') then
    raise exception using
      errcode = 'CCF04',
      message = 'My Tasks sort is invalid.';
  end if;

  return query
  with assigned_tasks as materialized (
    select
      task_row.id as task_id,
      task_row.title as task_title,
      event_row.id as event_id,
      event_row.name as event_name,
      task_row.phase as task_phase,
      task_row.status as task_status,
      public.calculate_effective_task_priority(
        task_row.priority,
        task_row.due_date,
        v_as_of,
        task_row.status
      ) as effective_priority,
      task_row.due_date as task_due_date,
      committee_row.id as committee_id,
      committee_row.name as committee_name,
      v_caller_id = any(task_row.primary_assignees) as is_primary,
      v_caller_id = any(task_row.assist_assignees) as is_assist,
      task_row.request_backup
    from public.tasks task_row
    join public.events event_row
      on event_row.id = task_row.event_id
     and event_row.status = 'Active'
    join public.committees committee_row
      on committee_row.id = task_row.committee_id
    where (
      v_caller_id = any(task_row.primary_assignees)
      or v_caller_id = any(task_row.assist_assignees)
    )
      and public.task_content_access(task_row.id) = 'real'
  )
  select
    assigned.task_id,
    assigned.task_title,
    assigned.event_id,
    assigned.event_name,
    assigned.task_phase,
    assigned.task_status,
    assigned.effective_priority,
    assigned.task_due_date,
    assigned.committee_id,
    assigned.committee_name,
    assigned.is_primary,
    assigned.is_assist,
    assigned.request_backup
  from assigned_tasks assigned
  where p_status is null or assigned.task_status = p_status
  order by
    (assigned.task_status = 'Completed') asc,
    case when p_sort = 'deadline' then assigned.task_due_date end asc nulls last,
    case when p_sort = 'priority' then
      case assigned.effective_priority
        when 'Critical' then 1
        when 'High' then 2
        when 'Medium' then 3
        when 'Low' then 4
        else 5
      end
    end asc,
    case when p_sort = 'event'
      then pg_catalog.lower(assigned.event_name)
    end asc,
    case when p_sort in ('priority', 'event')
      then assigned.task_due_date
    end asc nulls last,
    assigned.task_id asc
  limit p_limit
  offset p_offset;
end;
$$;

alter function public.list_my_tasks(text, text, integer, integer)
owner to postgres;

revoke all on function public.list_my_tasks(text, text, integer, integer)
from public, anon, authenticated;

grant execute on function public.list_my_tasks(text, text, integer, integer)
to authenticated;
