-- Keep event lifecycle invariants in the existing update trigger while making
-- the Draft-to-Active task check independent of the caller's task visibility.
create or replace function public.guard_event_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
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
