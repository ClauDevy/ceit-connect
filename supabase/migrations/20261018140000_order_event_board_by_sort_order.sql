-- Keep the Step 2 board reader aligned with the server-owned lane order added
-- in Step 5a and written only through Step 5b's move_task function. The
-- public return shape deliberately remains unchanged: sort_order is used only
-- inside the reader and is not exposed to clients.

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
      t.sort_order,
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
  order by bt.sort_order, bt.id;
end;
$$;

revoke all on function public.list_event_board_tasks(uuid, uuid)
from public, anon;
grant execute on function public.list_event_board_tasks(uuid, uuid)
to authenticated;
