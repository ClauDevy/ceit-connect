-- Require an active application profile for every raw task read/write path.
-- Backup requests and allowed-viewer/content-sharing state deliberately do not
-- grant raw row visibility; restricted RPCs own those content paths.

drop policy "tasks_select" on public.tasks;

create policy "tasks_select"
on public.tasks for select
to authenticated
using (
  public.my_role() is not null
  and (
    public.my_role() = 'Admin'
    or (
      public.my_role() = 'Co-Admin'
      and public.my_committee_id() = tasks.committee_id
    )
    or (
      exists (
        select 1
        from public.events e
        where e.id = tasks.event_id
          and e.status <> 'Draft'
      )
      and (
        auth.uid() = any(tasks.primary_assignees)
        or auth.uid() = any(tasks.assist_assignees)
      )
    )
    or (
      tasks.is_confidential = false
      and public.event_is_archived(tasks.event_id)
    )
  )
);

drop policy "tasks_update" on public.tasks;

create policy "tasks_update"
on public.tasks for update
to authenticated
using (
  public.my_role() is not null
  and (
    public.my_role() = 'Admin'
    or (
      public.my_role() = 'Co-Admin'
      and public.my_committee_id() = tasks.committee_id
    )
    or (
      exists (
        select 1
        from public.events e
        where e.id = tasks.event_id
          and e.status <> 'Draft'
      )
      and (
        auth.uid() = any(tasks.primary_assignees)
        or auth.uid() = any(tasks.assist_assignees)
      )
    )
  )
)
with check (
  public.my_role() is not null
  and (
    public.my_role() = 'Admin'
    or (
      public.my_role() = 'Co-Admin'
      and public.my_committee_id() = tasks.committee_id
    )
    or (
      exists (
        select 1
        from public.events e
        where e.id = tasks.event_id
          and e.status <> 'Draft'
      )
      and (
        auth.uid() = any(tasks.primary_assignees)
        or auth.uid() = any(tasks.assist_assignees)
      )
    )
  )
);

drop policy "tasks_delete" on public.tasks;

create policy "tasks_delete"
on public.tasks for delete
to authenticated
using (
  public.my_role() is not null
  and (
    public.my_role() = 'Admin'
    or (
      public.my_role() = 'Co-Admin'
      and public.my_committee_id() = tasks.committee_id
    )
  )
);
