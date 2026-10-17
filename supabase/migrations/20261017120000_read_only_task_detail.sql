-- Phase 4 Step 3: one fixed-shape, read-only task-detail reader.
-- The Step 2 helper remains the single real/masked/hidden authority. Raw task
-- and user RLS, get_task(), and the event-board reader are unchanged.

create function public.get_task_detail(p_task_id uuid)
returns table (
  id uuid,
  event_id uuid,
  event_name text,
  event_status text,
  title text,
  description text,
  phase text,
  status text,
  effective_priority text,
  task_type text,
  due_date timestamptz,
  call_time timestamptz,
  end_time timestamptz,
  created_at timestamptz,
  committee_id uuid,
  committee_name text,
  primary_assignees jsonb,
  assist_assignees jsonb,
  is_confidential boolean,
  is_masked boolean,
  has_dependency boolean,
  is_blocked boolean,
  dependency_label text,
  access_list jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_access text;
  v_as_of timestamptz := statement_timestamp();
begin
  if v_caller_id is null then
    return;
  end if;

  perform 1
  from public.users u
  where u.id = v_caller_id
    and u.is_active is true;

  if not found then
    return;
  end if;

  v_access := public.task_content_access(p_task_id);

  if v_access = 'hidden' then
    return;
  end if;

  if v_access = 'masked' then
    return query
    select
      t.id,
      null::uuid,
      null::text,
      null::text,
      'Confidential Task'::text,
      null::text,
      t.phase,
      t.status,
      null::text,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz,
      null::uuid,
      null::text,
      '[]'::jsonb,
      '[]'::jsonb,
      null::boolean,
      true,
      null::boolean,
      null::boolean,
      null::text,
      '[]'::jsonb
    from public.tasks t
    where t.id = p_task_id;
    return;
  end if;

  return query
  with task_row as materialized (
    select
      t.id,
      t.event_id,
      e.name as event_name,
      e.status as event_status,
      t.title,
      t.description,
      t.phase,
      t.status,
      t.priority,
      t.task_type,
      t.due_date,
      t.call_time,
      t.end_time,
      t.created_at,
      t.committee_id,
      c.name as committee_name,
      t.primary_assignees,
      t.assist_assignees,
      t.is_confidential,
      t.allowed_viewers,
      dependency.id as dependency_id,
      dependency.title as dependency_title,
      dependency.status as dependency_status
    from public.tasks t
    join public.events e on e.id = t.event_id
    join public.committees c on c.id = t.committee_id
    left join public.tasks dependency on dependency.id = t.depends_on_task_id
    where t.id = p_task_id
  ),
  detail_row as materialized (
    select
      tr.*,
      case
        when tr.dependency_id is null then null
        else public.task_content_access(tr.dependency_id)
      end as dependency_access
    from task_row tr
  )
  select
    dr.id,
    dr.event_id,
    dr.event_name,
    dr.event_status,
    dr.title,
    dr.description,
    dr.phase,
    dr.status,
    public.calculate_effective_task_priority(
      dr.priority,
      dr.due_date,
      v_as_of,
      dr.status
    ),
    dr.task_type,
    dr.due_date,
    dr.call_time,
    dr.end_time,
    dr.created_at,
    dr.committee_id,
    dr.committee_name,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignee.id,
            'full_name', u.full_name,
            'avatar_url', u.avatar_url
          )
          order by assignee.position
        )
        from unnest(dr.primary_assignees)
          with ordinality as assignee(id, position)
        left join public.users u on u.id = assignee.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignee.id,
            'full_name', u.full_name,
            'avatar_url', u.avatar_url
          )
          order by assignee.position
        )
        from unnest(dr.assist_assignees)
          with ordinality as assignee(id, position)
        left join public.users u on u.id = assignee.id
      ),
      '[]'::jsonb
    ),
    dr.is_confidential,
    false,
    dr.dependency_id is not null,
    dr.dependency_id is not null
      and dr.dependency_status <> 'Completed',
    case dr.dependency_access
      when 'real' then dr.dependency_title
      when 'masked' then 'Confidential Task'
      else null
    end,
    case
      when dr.is_confidential then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', viewer.id,
              'full_name', viewer.full_name,
              'avatar_url', viewer.avatar_url
            )
            order by viewer.position
          )
          from (
            select
              u.id,
              u.full_name,
              u.avatar_url,
              min(allowed.position) as position
            from unnest(dr.allowed_viewers)
              with ordinality as allowed(id, position)
            join public.users u
              on u.id = allowed.id
             and u.is_active is true
            where not (allowed.id = any(dr.primary_assignees))
              and not (allowed.id = any(dr.assist_assignees))
            group by u.id, u.full_name, u.avatar_url
          ) viewer
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end
  from detail_row dr;
end;
$$;

revoke all on function public.get_task_detail(uuid)
from public, anon, authenticated;
grant execute on function public.get_task_detail(uuid)
to authenticated;
