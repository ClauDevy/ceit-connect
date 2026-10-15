-- Read the parent lifecycle state independently of the caller's events RLS.
-- The boolean result reveals no more than events_select already reveals for
-- Archived events, while keeping the tasks policy's parent check fail-closed.
create function public.event_is_archived(p_event_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.status = 'Archived'
  )
$$;

revoke all on function public.event_is_archived(uuid)
from public, anon;

grant execute on function public.event_is_archived(uuid)
to authenticated;

-- Preserve every existing visibility path exactly, then add access for every
-- active user to non-confidential tasks whose real parent is Archived.
drop policy "tasks_select" on public.tasks;

create policy "tasks_select"
on public.tasks for select
to authenticated
using (
  public.my_role() = 'Admin'
  or (
    public.my_role() = 'Co-Admin'
    and public.my_committee_id() = committee_id
  )
  or (
    exists (
      select 1
      from public.events e
      where e.id = tasks.event_id
        and e.status <> 'Draft'
    )
    and (
      request_backup = true
      or auth.uid() = any(primary_assignees)
      or auth.uid() = any(assist_assignees)
    )
  )
  or (
    public.my_role() is not null
    and is_confidential = false
    and public.event_is_archived(event_id)
  )
);
