-- Phase 4 Step 1: make archive confirmation and the final archive write one
-- serialized database operation. Raw authenticated event updates remain
-- available for Draft/Active editing, but archiving now goes through the RPC.
drop policy "events_update" on public.events;

create policy "events_update"
on public.events for update
to authenticated
using (
  status in ('Draft', 'Active')
  and public.my_role() in ('Admin', 'Co-Admin')
)
with check (
  status in ('Draft', 'Active')
  and public.my_role() in ('Admin', 'Co-Admin')
);

-- Lock every stored parent in deterministic UUID order before re-reading any
-- status. This covers INSERT/DELETE and both sides of a permitted reparent.
create or replace function public.guard_archived_event_task_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_ids uuid[];
  v_parent_id uuid;
  v_locked_parent_count integer := 0;
begin
  if TG_OP = 'INSERT' then
    v_parent_ids := array[new.event_id];
  elsif TG_OP = 'DELETE' then
    v_parent_ids := array[old.event_id];
  else
    select array_agg(parent_id order by parent_id)
    into v_parent_ids
    from (
      select distinct parent_id
      from unnest(array[old.event_id, new.event_id]) as parents(parent_id)
    ) distinct_parents;
  end if;

  for v_parent_id in
    select e.id
    from public.events e
    where e.id = any(v_parent_ids)
    order by e.id
    for share
  loop
    v_locked_parent_count := v_locked_parent_count + 1;
  end loop;

  if v_locked_parent_count <> cardinality(v_parent_ids) then
    raise exception 'Task write rejected because its parent event could not be verified.';
  end if;

  if exists (
    select 1
    from public.events e
    where e.id = any(v_parent_ids)
      and e.status = 'Archived'
  ) then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_archived_event_task_writes()
from public, anon, authenticated;

create function public.archive_event(
  p_event_id uuid,
  p_expected_incomplete_task_count bigint,
  p_expected_updated_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_status text;
  v_event_updated_at timestamptz;
  v_incomplete_task_count bigint;
  v_affected integer;
begin
  -- Authorization deliberately comes before event lookup so an unauthorized
  -- caller cannot use this function to learn whether an event id exists.
  if auth.uid() is null or not exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'Admin'
      and u.is_active is true
  ) then
    raise exception using
      errcode = 'CCA01',
      message = 'Only active Admins can archive events.';
  end if;

  if p_event_id is null or p_expected_updated_at is null then
    raise exception using
      errcode = 'CCA02',
      message = 'The event ID and expected version are required.';
  end if;

  if p_expected_incomplete_task_count is null
     or p_expected_incomplete_task_count < 0 then
    raise exception using
      errcode = 'CCA03',
      message = 'Expected incomplete task count must be a non-negative integer.';
  end if;

  select e.status, e.updated_at
  into v_event_status, v_event_updated_at
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception using
      errcode = 'CCA04',
      message = 'Event not found.';
  end if;

  if v_event_status = 'Draft' then
    raise exception using
      errcode = 'CCA05',
      message = 'Draft events cannot be archived. Launch the event first.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCA06',
      message = 'This event is already archived.';
  end if;

  if v_event_status <> 'Active' then
    raise exception using
      errcode = 'CCA07',
      message = 'Only Active events can be archived.';
  end if;

  -- This is intentionally identical to Home's `.neq("status", "Completed")`:
  -- both use SQL `status <> 'Completed'`, so a null status is excluded.
  select count(*)
  into v_incomplete_task_count
  from public.tasks t
  where t.event_id = p_event_id
    and t.status <> 'Completed';

  if v_event_updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = 'CCA08',
      message = 'This event changed after you opened the archive confirmation. Refresh and confirm again.';
  end if;

  if v_incomplete_task_count is distinct from p_expected_incomplete_task_count then
    raise exception using
      errcode = 'CCA09',
      message = 'The incomplete task count changed. Refresh and confirm the archive again.';
  end if;

  update public.events
  set status = 'Archived'
  where id = p_event_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCA10',
      message = 'The event could not be archived.';
  end if;
end;
$$;

revoke all on function public.archive_event(uuid, bigint, timestamptz)
from public, anon, authenticated;

grant execute on function public.archive_event(uuid, bigint, timestamptz)
to authenticated;
