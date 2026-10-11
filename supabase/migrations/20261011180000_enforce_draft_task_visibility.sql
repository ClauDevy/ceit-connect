-- Keep tasks belonging to Draft events private from Members until launch.
-- Active Admins retain council-wide access; active Co-Admins retain access
-- only to Draft tasks owned by their committee.
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
);

-- Members who are assigned to a task may update its status only after the
-- event is launched. The existing column-guard trigger still limits those
-- assignee updates to the status column.
drop policy "tasks_update" on public.tasks;

create policy "tasks_update"
on public.tasks for update
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
      auth.uid() = any(primary_assignees)
      or auth.uid() = any(assist_assignees)
    )
  )
)
with check (
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
      auth.uid() = any(primary_assignees)
      or auth.uid() = any(assist_assignees)
    )
  )
);

-- This function is SECURITY DEFINER and therefore must apply the Draft rule
-- explicitly instead of relying on tasks RLS. Returning no row for an
-- unauthorized Draft task prevents even its masked metadata from leaking.
create or replace function public.get_task(p_task_id uuid)
returns table (id uuid, title text, description text)
language plpgsql
security definer
set search_path = public
as $$
declare
  can_view boolean;
begin
  -- New Draft-only guard. my_role()/my_committee_id() return null for an
  -- inactive profile, and coalesce makes that fail closed.
  if exists (
    select 1
    from tasks t
    join events e on e.id = t.event_id
    where t.id = p_task_id
      and e.status = 'Draft'
      and not coalesce(
        my_role() = 'Admin'
        or (my_role() = 'Co-Admin' and my_committee_id() = t.committee_id),
        false
      )
  ) then
    return;
  end if;

  -- Existing confidentiality logic below is intentionally unchanged.
  select coalesce(
    (t.is_confidential = false)
    or (u.role = 'Admin')
    or (u.role = 'Co-Admin' and u.committee_id = t.committee_id)
    or (auth.uid() = any(t.primary_assignees))
    or (auth.uid() = any(t.assist_assignees))
    or (auth.uid() = any(t.allowed_viewers)),
    false
  )
  into can_view
  from tasks t left join users u on u.id = auth.uid()
  where t.id = p_task_id;

  if can_view then
    return query select t.id, t.title, t.description from tasks t where t.id = p_task_id;
  else
    return query select t.id, '🔒 Confidential Task', null from tasks t where t.id = p_task_id;
  end if;
end;
$$;

-- activity_log.changes contains complete task snapshots. Its policy must
-- repeat both the confidentiality and Draft checks rather than treating
-- task-row visibility alone as permission to inspect those snapshots.
drop policy "activity_log_select" on public.activity_log;

create policy "activity_log_select"
on public.activity_log for select
to authenticated
using (
  public.my_role() = 'Admin'
  or exists (
    select 1
    from public.tasks t
    join public.events e on e.id = t.event_id
    where t.id = activity_log.task_id
      and (
        (
          public.my_role() = 'Co-Admin'
          and public.my_committee_id() = t.committee_id
        )
        or (
          e.status <> 'Draft'
          and (
            auth.uid() = any(t.primary_assignees)
            or auth.uid() = any(t.assist_assignees)
            or (t.request_backup = true and t.is_confidential = false)
          )
        )
      )
  )
);
