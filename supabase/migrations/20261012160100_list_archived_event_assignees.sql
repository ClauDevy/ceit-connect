-- Return only the safe profile fields needed to label assignees on a
-- read-only Archived event. This deliberately includes inactive profiles so
-- historical records keep real names after offboarding.
create function public.list_archived_event_assignees(p_event_id uuid)
returns table (
  id uuid,
  full_name text,
  avatar_url text
)
language sql
security definer
stable
set search_path = ''
as $$
  select distinct
    u.id,
    u.full_name,
    u.avatar_url
  from public.events e
  join public.tasks t
    on t.event_id = e.id
   and t.is_confidential = false
  cross join lateral unnest(t.primary_assignees || t.assist_assignees) assigned(user_id)
  join public.users u on u.id = assigned.user_id
  where e.id = p_event_id
    and e.status = 'Archived'
    and public.my_role() is not null
  order by u.full_name, u.id
$$;

revoke all on function public.list_archived_event_assignees(uuid)
from public, anon;

grant execute on function public.list_archived_event_assignees(uuid)
to authenticated;
