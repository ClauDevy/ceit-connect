-- Keep per-link can_remove output strictly boolean after its creator profile is
-- deleted and the created_by foreign key is set to null.

create or replace function public.get_task_work_links(p_task_id uuid)
returns table (
  can_add boolean,
  links jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_can_add boolean;
begin
  if v_caller_id is null
     or public.task_content_access(p_task_id) <> 'real' then
    return;
  end if;

  select
    u.role,
    e.status,
    t.primary_assignees,
    t.assist_assignees
  into
    v_caller_role,
    v_event_status,
    v_primary_assignees,
    v_assist_assignees
  from public.users u
  join public.tasks t on t.id = p_task_id
  join public.events e on e.id = t.event_id
  where u.id = v_caller_id
    and u.is_active is true;

  if not found then
    return;
  end if;

  v_can_add := v_event_status <> 'Archived'
    and (
      coalesce(v_caller_id = any(v_primary_assignees), false)
      or coalesce(v_caller_id = any(v_assist_assignees), false)
    );

  return query
  select
    v_can_add,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'name', l.name,
          'url', l.url,
          'created_at', l.created_at,
          'can_remove',
            coalesce(
              v_event_status <> 'Archived'
              and (
                l.created_by = v_caller_id
                or v_caller_role in ('Admin', 'Co-Admin')
              ),
              false
            )
        )
        order by l.created_at, l.id
      ) filter (where l.id is not null),
      '[]'::jsonb
    )
  from public.task_work_links l
  where l.task_id = p_task_id;
end;
$$;

revoke all on function public.get_task_work_links(uuid)
from public, anon, authenticated;
grant execute on function public.get_task_work_links(uuid)
to authenticated;
