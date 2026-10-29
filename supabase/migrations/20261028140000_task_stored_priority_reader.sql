create function public.get_task_stored_priority(p_task_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
  v_task_committee_id uuid;
  v_event_status text;
  v_priority text;
begin
  select caller.role, caller.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users caller
  where caller.id = auth.uid()
    and caller.is_active is true;

  if not found or v_caller_role not in ('Admin', 'Co-Admin') then
    return null;
  end if;

  if public.task_content_access(p_task_id) is distinct from 'real' then
    return null;
  end if;

  select task_row.committee_id, event_row.status, task_row.priority
  into v_task_committee_id, v_event_status, v_priority
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found
     or v_event_status <> 'Active'
     or (
       v_caller_role = 'Co-Admin'
       and v_caller_committee_id is distinct from v_task_committee_id
     ) then
    return null;
  end if;

  return v_priority;
end;
$$;

alter function public.get_task_stored_priority(uuid) owner to postgres;

revoke all on function public.get_task_stored_priority(uuid)
from public, anon;

grant execute on function public.get_task_stored_priority(uuid)
to authenticated;

do $$
declare
  v_function_oid oid := 'public.get_task_stored_priority(uuid)'::regprocedure;
  v_body text;
begin
  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_task_stored_priority'
  ) <> 1 then
    raise exception 'get_task_stored_priority must have exactly one overload.';
  end if;

  select pg_catalog.pg_get_functiondef(v_function_oid)
  into v_body;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_function_oid
      and p.prosecdef
      and p.provolatile = 's'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
      and pg_catalog.has_function_privilege(
        'authenticated', p.oid, 'EXECUTE'
      )
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
  ) then
    raise exception 'get_task_stored_priority catalog contract is invalid.';
  end if;

  if lower(v_body) ~ '\mexecute\M'
     or lower(v_body) ~ 'pg_catalog\.(coalesce|greatest|least|nullif)' then
    raise exception 'get_task_stored_priority body contract is invalid.';
  end if;
end;
$$;
