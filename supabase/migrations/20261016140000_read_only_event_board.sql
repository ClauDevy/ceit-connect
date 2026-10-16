-- Phase 4 Step 2: one shared content decision and one fixed-shape,
-- read-only event-board listing. Raw task and user RLS are unchanged.

create function public.task_content_access(p_task_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
  v_event_status text;
  v_task_committee_id uuid;
  v_is_confidential boolean;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_allowed_viewers uuid[];
begin
  select u.role, u.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users u
  where u.id = auth.uid()
    and u.is_active is true;

  if not found then
    return 'hidden';
  end if;

  select
    e.status,
    t.committee_id,
    t.is_confidential,
    t.primary_assignees,
    t.assist_assignees,
    t.allowed_viewers
  into
    v_event_status,
    v_task_committee_id,
    v_is_confidential,
    v_primary_assignees,
    v_assist_assignees,
    v_allowed_viewers
  from public.tasks t
  join public.events e on e.id = t.event_id
  where t.id = p_task_id;

  if not found then
    return 'hidden';
  end if;

  if v_event_status = 'Draft' then
    if v_caller_role = 'Admin'
       or (
         v_caller_role = 'Co-Admin'
         and v_caller_committee_id = v_task_committee_id
       ) then
      return 'real';
    end if;

    return 'hidden';
  end if;

  if v_is_confidential is false
     or v_caller_role = 'Admin'
     or (
       v_caller_role = 'Co-Admin'
       and v_caller_committee_id = v_task_committee_id
     )
     or auth.uid() = any(v_primary_assignees)
     or auth.uid() = any(v_assist_assignees)
     or auth.uid() = any(v_allowed_viewers) then
    return 'real';
  end if;

  return 'masked';
end;
$$;

revoke all on function public.task_content_access(uuid)
from public, anon, authenticated;

-- Preserve get_task's signature, columns, grants, and masked presentation.
-- The shared helper additionally makes inactive and missing-profile callers
-- fully hidden instead of returning an existence-revealing masked row.
create or replace function public.get_task(p_task_id uuid)
returns table (id uuid, title text, description text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access text;
begin
  v_access := public.task_content_access(p_task_id);

  if v_access = 'hidden' then
    return;
  end if;

  if v_access = 'real' then
    return query
    select t.id, t.title, t.description
    from public.tasks t
    where t.id = p_task_id;
    return;
  end if;

  return query
  select t.id, '🔒 Confidential Task', null::text
  from public.tasks t
  where t.id = p_task_id;
end;
$$;

revoke all on function public.get_task(uuid) from public, anon;
grant execute on function public.get_task(uuid) to authenticated;

-- Use an explicit timestamp supplied by the board RPC so every row in one
-- response crosses urgency boundaries against the same database instant.
create function public.calculate_effective_task_priority(
  p_priority text,
  p_due_date timestamptz,
  p_as_of timestamptz,
  p_status text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_priority is null
     or p_priority not in ('Low', 'Medium', 'High', 'Critical') then
    raise exception using
      errcode = '22023',
      message = 'Task priority must be Low, Medium, High, or Critical.';
  end if;

  if p_as_of is null then
    raise exception using
      errcode = '22023',
      message = 'Priority calculation timestamp is required.';
  end if;

  if p_status is null
     or p_status not in ('To Do', 'In Progress', 'Completed') then
    raise exception using
      errcode = '22023',
      message = 'Task status must be To Do, In Progress, or Completed.';
  end if;

  if p_status = 'Completed' then
    return p_priority;
  end if;

  if p_due_date < p_as_of then
    return 'Critical';
  end if;

  if p_due_date <= p_as_of + interval '24 hours'
     and p_priority in ('Low', 'Medium') then
    return 'High';
  end if;

  return p_priority;
end;
$$;

revoke all on function public.calculate_effective_task_priority(
  text, timestamptz, timestamptz, text
) from public, anon, authenticated;

create function public.list_event_board_tasks(
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
  select u.role
  into v_caller_role
  from public.users u
  where u.id = auth.uid()
    and u.is_active is true;

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
       from public.committees c
       where c.id = p_committee_id
     ) then
    raise exception using
      errcode = '22023',
      message = 'Unknown committee filter.';
  end if;

  select e.status
  into v_event_status
  from public.events e
  where e.id = p_event_id;

  -- Archived and unknown IDs deliberately share the same zero-row result.
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
      t.id,
      t.title,
      t.phase,
      t.status,
      t.priority,
      t.due_date,
      t.committee_id,
      c.name as committee_name,
      t.primary_assignees,
      t.assist_assignees,
      t.created_at,
      public.task_content_access(t.id) as content_access
    from public.tasks t
    join public.committees c on c.id = t.committee_id
    where t.event_id = p_event_id
      and (p_committee_id is null or t.committee_id = p_committee_id)
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
              'full_name', u.full_name,
              'avatar_url', u.avatar_url
            )
            order by assignee.position
          )
          from unnest(bt.primary_assignees)
            with ordinality as assignee(id, position)
          left join public.users u on u.id = assignee.id
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
              'full_name', u.full_name,
              'avatar_url', u.avatar_url
            )
            order by assignee.position
          )
          from unnest(bt.assist_assignees)
            with ordinality as assignee(id, position)
          left join public.users u on u.id = assignee.id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    cardinality(bt.primary_assignees) = 0
      and cardinality(bt.assist_assignees) = 0,
    bt.content_access = 'masked'
  from board_tasks bt
  where (
    v_event_status = 'Active'
    and bt.content_access in ('real', 'masked')
  ) or (
    v_event_status = 'Draft'
    and bt.content_access = 'real'
  )
  order by bt.created_at, bt.id;
end;
$$;

revoke all on function public.list_event_board_tasks(uuid, uuid)
from public, anon;
grant execute on function public.list_event_board_tasks(uuid, uuid)
to authenticated;
