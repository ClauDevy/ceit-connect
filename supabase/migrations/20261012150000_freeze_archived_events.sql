-- Archived events are permanent read-only records. Keep the existing event
-- lifecycle invariants and extend them to cover archive transitions/deletes.
create or replace function public.guard_event_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if old.status = 'Archived' then
      raise exception 'Archived events cannot be deleted.';
    end if;

    -- Delete child tasks while the parent still exists so the fail-closed task
    -- guard can verify that this is not an Archived event. The FK cascade then
    -- has no remaining task rows to process.
    delete from public.tasks
    where event_id = old.id;

    return old;
  end if;

  if old.status = 'Archived' then
    raise exception 'Archived events are read-only.';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  if new.status = 'Archived' and old.status <> 'Active' then
    raise exception 'Only Active events can be archived.';
  end if;

  if old.status = 'Draft' and new.status = 'Active'
     and not exists (
       select 1
       from public.tasks
       where event_id = old.id
     ) then
    raise exception 'An event requires at least one task before it can be launched.';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_event_updates()
from public, anon;

drop trigger if exists guard_event_updates on public.events;

create trigger guard_event_updates
before update or delete on public.events
for each row
execute function public.guard_event_updates();

-- RLS remains useful defense in depth, while the trigger above is the
-- enforcement that also applies to service-role writes.
drop policy "events_delete" on public.events;

create policy "events_delete"
on public.events for delete
to authenticated
using (
  public.my_role() = 'Admin'
  and status <> 'Archived'
);

-- Freeze every direct and indirect task write. Checking both OLD and NEW on
-- updates prevents moving a task out of or into an Archived event. Missing
-- parents fail closed instead of relying on the caller's RLS visibility.
create function public.guard_archived_event_task_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_status text;
begin
  if TG_OP in ('UPDATE', 'DELETE') then
    select e.status
    into v_parent_status
    from public.events e
    where e.id = old.event_id
    for share;

    if not found then
      raise exception 'Task write rejected because its parent event could not be verified.';
    end if;

    if v_parent_status = 'Archived' then
      raise exception 'Tasks in Archived events are read-only.';
    end if;
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    select e.status
    into v_parent_status
    from public.events e
    where e.id = new.event_id
    for share;

    if not found then
      raise exception 'Task write rejected because its parent event could not be verified.';
    end if;

    if v_parent_status = 'Archived' then
      raise exception 'Tasks in Archived events are read-only.';
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_archived_event_task_writes()
from public, anon;

drop trigger if exists tasks_guard_archived_event_writes on public.tasks;

create trigger tasks_guard_archived_event_writes
before insert or update or delete on public.tasks
for each row
execute function public.guard_archived_event_task_writes();
