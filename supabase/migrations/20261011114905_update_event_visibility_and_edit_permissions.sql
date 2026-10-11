-- Draft events are visible to every active Admin and Co-Admin.
-- my_role() returns null for inactive users, so Members and deactivated
-- privileged users cannot read Drafts.
drop policy "events_select" on public.events;

create policy "events_select"
on public.events for select
to authenticated
using (
  status <> 'Draft'
  or public.my_role() in ('Admin', 'Co-Admin')
);

-- Active Admins and Co-Admins may update any Draft or Active event.
-- Only an Admin may make the new row Archived. Because Archived rows fail
-- the USING clause, they cannot be updated or changed back to another status.
drop policy "events_update" on public.events;

create policy "events_update"
on public.events for update
to authenticated
using (
  status in ('Draft', 'Active')
  and public.my_role() in ('Admin', 'Co-Admin')
)
with check (
  public.my_role() in ('Admin', 'Co-Admin')
  and (
    status in ('Draft', 'Active')
    or (status = 'Archived' and public.my_role() = 'Admin')
  )
);

-- RLS cannot compare OLD and NEW values. Keep event ownership immutable and
-- prevent Active events from returning to Draft with an invoker-security
-- trigger function that resolves no database objects.
create function public.guard_event_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  return new;
end;
$$;

create trigger guard_event_updates
before update on public.events
for each row
execute function public.guard_event_updates();
