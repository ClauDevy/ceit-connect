-- Add prerequisite selection to task creation without changing any existing writer.

create function ceit_connect_private.prepare_task_creation_dependencies(
  p_event_id uuid,
  p_tasks jsonb,
  p_allow_later_temporary_dependencies boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_task jsonb;
  v_client_key uuid;
  v_saved_dependency uuid;
  v_local_dependency uuid;
  v_all_keys uuid[] := '{}'::uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_pending jsonb;
  v_next_pending jsonb;
  v_ordered jsonb := '[]'::jsonb;
  v_progress boolean;
  v_clean jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from public.users
    where id = v_actor and is_active is true and role in ('Admin', 'Co-Admin')
  ) then
    raise exception using errcode = '42501', message = 'Only an active Admin or Co-Admin can create task dependencies.';
  end if;

  if p_event_id is not null and not exists (
    select 1 from public.events where id = p_event_id and status in ('Draft', 'Active')
  ) then
    raise exception using errcode = '42501', message = 'The event is unavailable or read-only.';
  end if;
  if pg_catalog.jsonb_typeof(p_tasks) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Task additions must be a JSON array.';
  end if;

  for v_task in select value from pg_catalog.jsonb_array_elements(p_tasks)
  loop
    if pg_catalog.jsonb_typeof(v_task) is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_task -> 'client_key') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Every new task requires a temporary client key.';
    end if;
    begin
      v_client_key := (v_task ->> 'client_key')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'Every temporary client key must be a valid UUID.';
    end;
    if v_client_key = any(v_all_keys) then
      raise exception using errcode = '22023', message = 'Temporary client keys must be unique.';
    end if;
    v_all_keys := pg_catalog.array_append(v_all_keys, v_client_key);
  end loop;

  for v_task in select value from pg_catalog.jsonb_array_elements(p_tasks)
  loop
    v_client_key := (v_task ->> 'client_key')::uuid;
    if p_event_id is not null
       and pg_catalog.jsonb_typeof(v_task -> 'phase') = 'string'
       and public.task_phase_is_complete(p_event_id, v_task ->> 'phase') then
      raise exception using errcode = 'CCQ01', message = 'This phase is complete and read-only.';
    end if;

    v_saved_dependency := null;
    v_local_dependency := null;
    if v_task ? 'depends_on_task_id' and pg_catalog.jsonb_typeof(v_task -> 'depends_on_task_id') <> 'null' then
      if pg_catalog.jsonb_typeof(v_task -> 'depends_on_task_id') is distinct from 'string' then
        raise exception using errcode = '22023', message = 'A saved prerequisite must be a UUID string or null.';
      end if;
      begin v_saved_dependency := (v_task ->> 'depends_on_task_id')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'A saved prerequisite must be a valid UUID.';
      end;
    end if;
    if v_task ? 'depends_on_client_key' and pg_catalog.jsonb_typeof(v_task -> 'depends_on_client_key') <> 'null' then
      if pg_catalog.jsonb_typeof(v_task -> 'depends_on_client_key') is distinct from 'string' then
        raise exception using errcode = '22023', message = 'A temporary prerequisite must be a UUID string or null.';
      end if;
      begin v_local_dependency := (v_task ->> 'depends_on_client_key')::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'A temporary prerequisite must be a valid UUID.';
      end;
    end if;
    if v_saved_dependency is not null and v_local_dependency is not null then
      raise exception using errcode = '22023', message = 'Choose only one prerequisite task.';
    end if;
    if v_local_dependency is not null then
      if p_allow_later_temporary_dependencies then
        if not (v_local_dependency = any(v_all_keys)) then
          raise exception using errcode = '22023', message = 'A temporary prerequisite must be another task in this form.';
        end if;
      elsif not (v_local_dependency = any(v_seen)) then
        raise exception using errcode = '22023', message = 'A temporary prerequisite must be a task added earlier in this form.';
      end if;
    end if;
    if v_saved_dependency is not null then
      if p_event_id is null then
        raise exception using errcode = '22023', message = 'A new event can use only tasks from the same unsaved form as prerequisites.';
      end if;
      if not exists (select 1 from public.tasks where id = v_saved_dependency and event_id = p_event_id) then
        raise exception using errcode = '22023', message = 'A task can depend only on another task in the same event.';
      end if;
      if coalesce(public.task_content_access(v_saved_dependency), 'hidden') not in ('real', 'masked') then
        raise exception using errcode = '42501', message = 'The selected prerequisite task is unavailable.';
      end if;
    end if;

    v_seen := pg_catalog.array_append(v_seen, v_client_key);
  end loop;

  if p_allow_later_temporary_dependencies then
    v_seen := '{}'::uuid[];
    v_pending := p_tasks;
    while pg_catalog.jsonb_array_length(v_pending) > 0 loop
      v_next_pending := '[]'::jsonb;
      v_progress := false;
      for v_task in select value from pg_catalog.jsonb_array_elements(v_pending)
      loop
        v_client_key := (v_task ->> 'client_key')::uuid;
        v_local_dependency := case
          when pg_catalog.jsonb_typeof(v_task -> 'depends_on_client_key') = 'string'
            then (v_task ->> 'depends_on_client_key')::uuid
          else null
        end;
        if v_local_dependency is null or v_local_dependency = any(v_seen) then
          v_ordered := v_ordered || pg_catalog.jsonb_build_array(v_task);
          v_seen := pg_catalog.array_append(v_seen, v_client_key);
          v_progress := true;
        else
          v_next_pending := v_next_pending || pg_catalog.jsonb_build_array(v_task);
        end if;
      end loop;
      if not v_progress then
        raise exception using errcode = '22023', message = 'This dependency would create a cycle.';
      end if;
      v_pending := v_next_pending;
    end loop;
  else
    v_ordered := p_tasks;
  end if;

  for v_task in select value from pg_catalog.jsonb_array_elements(v_ordered)
  loop
    v_clean := v_clean || pg_catalog.jsonb_build_array(
      v_task - 'client_key' - 'depends_on_task_id' - 'depends_on_client_key'
    );
  end loop;

  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_plan', v_ordered::text, true);
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_index', '0', true);
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_map', '{}', true);
  return v_clean;
end;
$$;

alter function ceit_connect_private.prepare_task_creation_dependencies(uuid, jsonb, boolean) owner to postgres;
revoke all on function ceit_connect_private.prepare_task_creation_dependencies(uuid, jsonb, boolean) from public, anon, authenticated, service_role;

create function ceit_connect_private.capture_task_creation_dependency()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_plan jsonb := coalesce(nullif(pg_catalog.current_setting('ceit_connect.task_creation_dependency_plan', true), '')::jsonb, '[]'::jsonb);
  v_map jsonb := coalesce(nullif(pg_catalog.current_setting('ceit_connect.task_creation_dependency_map', true), '')::jsonb, '{}'::jsonb);
  v_index integer := coalesce(nullif(pg_catalog.current_setting('ceit_connect.task_creation_dependency_index', true), '')::integer, 0);
  v_item jsonb;
  v_client_key uuid;
  v_dependency uuid;
begin
  if current_user <> 'postgres' or pg_catalog.jsonb_array_length(v_plan) = 0 then return new; end if;
  if v_index >= pg_catalog.jsonb_array_length(v_plan) then
    raise exception using errcode = '22023', message = 'Task creation produced more rows than the dependency plan.';
  end if;
  v_item := v_plan -> v_index;
  v_client_key := (v_item ->> 'client_key')::uuid;
  if pg_catalog.jsonb_typeof(v_item -> 'depends_on_task_id') = 'string' then
    v_dependency := (v_item ->> 'depends_on_task_id')::uuid;
  elsif pg_catalog.jsonb_typeof(v_item -> 'depends_on_client_key') = 'string' then
    v_dependency := (v_map ->> ((v_item ->> 'depends_on_client_key')::uuid)::text)::uuid;
    if v_dependency is null then
      raise exception using errcode = '22023', message = 'The selected temporary prerequisite could not be resolved.';
    end if;
  else
    v_dependency := null;
  end if;
  new.depends_on_task_id := v_dependency;
  v_map := v_map || pg_catalog.jsonb_build_object(v_client_key::text, new.id);
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_map', v_map::text, true);
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_index', (v_index + 1)::text, true);
  return new;
end;
$$;

alter function ceit_connect_private.capture_task_creation_dependency() owner to postgres;
revoke all on function ceit_connect_private.capture_task_creation_dependency() from public, anon, authenticated, service_role;

create trigger tasks_set_creation_dependency
before insert on public.tasks
for each row execute function ceit_connect_private.capture_task_creation_dependency();

create function ceit_connect_private.clear_task_creation_dependency_context()
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_plan', '', true);
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_index', '', true);
  perform pg_catalog.set_config('ceit_connect.task_creation_dependency_map', '', true);
end;
$$;
alter function ceit_connect_private.clear_task_creation_dependency_context() owner to postgres;
revoke all on function ceit_connect_private.clear_task_creation_dependency_context() from public, anon, authenticated, service_role;

create function ceit_connect_private.finish_task_creation_dependencies()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_plan jsonb := coalesce(nullif(pg_catalog.current_setting('ceit_connect.task_creation_dependency_plan', true), '')::jsonb, '[]'::jsonb);
  v_index integer := coalesce(nullif(pg_catalog.current_setting('ceit_connect.task_creation_dependency_index', true), '')::integer, 0);
begin
  if v_index <> pg_catalog.jsonb_array_length(v_plan) then
    raise exception using errcode = '22023', message = 'Task creation did not consume the complete dependency plan.';
  end if;
  perform ceit_connect_private.clear_task_creation_dependency_context();
end;
$$;
alter function ceit_connect_private.finish_task_creation_dependencies() owner to postgres;
revoke all on function ceit_connect_private.finish_task_creation_dependencies() from public, anon, authenticated, service_role;

create function ceit_connect_private.order_task_dependency_deletions(p_event_id uuid, p_ids uuid[])
returns uuid[] language sql stable security definer set search_path = '' as $$
  with recursive descendants(root_id, task_id, depth) as (
    select id, id, 0 from pg_catalog.unnest(p_ids) ids(id)
    union all
    select d.root_id, t.id, d.depth + 1
    from descendants d join public.tasks t on t.depends_on_task_id = d.task_id
    where t.event_id = p_event_id and t.id = any(p_ids)
  ), ranked as (
    select root_id, max(depth) depth from descendants group by root_id
  )
  select coalesce(pg_catalog.array_agg(root_id order by depth, root_id), '{}'::uuid[]) from ranked
$$;
alter function ceit_connect_private.order_task_dependency_deletions(uuid, uuid[]) owner to postgres;
revoke all on function ceit_connect_private.order_task_dependency_deletions(uuid, uuid[]) from public, anon, authenticated, service_role;

create function public.create_event_with_task_dependencies(
  p_name text, p_description text, p_start_date date, p_end_date date, p_status text, p_tasks jsonb
) returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_clean jsonb; v_event uuid; v_phase_order text[];
begin
  v_clean := ceit_connect_private.prepare_task_creation_dependencies(null, p_tasks, true);
  select pg_catalog.array_agg(phase_key order by first_ordinality)
  into v_phase_order
  from (
    select public.canonical_task_phase(value ->> 'phase') as phase_key,
      min(ordinality) as first_ordinality
    from pg_catalog.jsonb_array_elements(p_tasks) with ordinality as task(value, ordinality)
    group by public.canonical_task_phase(value ->> 'phase')
  ) as phases;
  v_event := public.create_event_with_tasks(p_name,p_description,p_start_date,p_end_date,p_status,v_clean);
  perform 1 from public.events where id = v_event for update;
  perform pg_catalog.pg_advisory_xact_lock(public.task_dependency_lock_key(v_event));
  perform ceit_connect_private.reconcile_event_phase_positions(v_event, v_phase_order);
  perform ceit_connect_private.finish_task_creation_dependencies();
  return v_event;
exception when others then
  perform ceit_connect_private.clear_task_creation_dependency_context();
  raise;
end;
$$;
alter function public.create_event_with_task_dependencies(text,text,date,date,text,jsonb) owner to postgres;
revoke all on function public.create_event_with_task_dependencies(text,text,date,date,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_event_with_task_dependencies(text,text,date,date,text,jsonb) to authenticated;

create function public.create_active_event_task_with_dependency(
  p_event_id uuid,p_title text,p_description text,p_phase text,p_committee_id uuid,p_task_type text,p_priority text,
  p_due_date timestamptz,p_call_time timestamptz,p_end_time timestamptz,p_primary_assignees uuid[],p_is_confidential boolean,
  p_allowed_viewers uuid[],p_depends_on_task_id uuid
) returns table(out_task_id uuid,out_updated_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare v_clean jsonb;
begin
  v_clean := ceit_connect_private.prepare_task_creation_dependencies(p_event_id, pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'client_key',pg_catalog.gen_random_uuid(),'phase',p_phase,'depends_on_task_id',p_depends_on_task_id
  )), false);
  return query select * from public.create_active_event_task(p_event_id,p_title,p_description,p_phase,p_committee_id,p_task_type,p_priority,p_due_date,p_call_time,p_end_time,p_primary_assignees,p_is_confidential,p_allowed_viewers);
  perform ceit_connect_private.finish_task_creation_dependencies();
exception when others then
  perform ceit_connect_private.clear_task_creation_dependency_context();
  raise;
end;
$$;
alter function public.create_active_event_task_with_dependency(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[],uuid) owner to postgres;
revoke all on function public.create_active_event_task_with_dependency(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_active_event_task_with_dependency(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[],uuid) to authenticated;

create function public.edit_event_with_task_dependencies(
  p_event_id uuid,p_expected_updated_at timestamptz,p_name text,p_description text,p_start_date date,p_end_date date,p_status text,
  p_tasks_to_add jsonb default '[]'::jsonb,p_tasks_to_update jsonb default '[]'::jsonb,p_task_ids_to_delete uuid[] default '{}'::uuid[],p_phase_actions jsonb default '[]'::jsonb
) returns timestamptz language plpgsql volatile security definer set search_path = '' as $$
declare v_clean_add jsonb; v_clean_update jsonb; v_result timestamptz; v_item jsonb; v_dependency uuid; v_map jsonb; v_ordered uuid[];
begin
  v_clean_add := ceit_connect_private.prepare_task_creation_dependencies(p_event_id,p_tasks_to_add,false);
  select coalesce(pg_catalog.jsonb_agg(value - 'depends_on_task_id' - 'depends_on_client_key'),'[]'::jsonb)
  into v_clean_update from pg_catalog.jsonb_array_elements(p_tasks_to_update);

  -- Explicit null clears before deletion; absent means unchanged.
  for v_item in select value from pg_catalog.jsonb_array_elements(p_tasks_to_update)
  loop
    if v_item ? 'depends_on_task_id' and pg_catalog.jsonb_typeof(v_item->'depends_on_task_id') = 'null' then
      perform public.set_task_dependency((v_item->>'id')::uuid,null);
    end if;
  end loop;
  v_ordered := ceit_connect_private.order_task_dependency_deletions(p_event_id,p_task_ids_to_delete);
  v_result := public.edit_event_with_tasks(p_event_id,p_expected_updated_at,p_name,p_description,p_start_date,p_end_date,p_status,v_clean_add,v_clean_update,v_ordered,p_phase_actions);
  v_map := coalesce(nullif(pg_catalog.current_setting('ceit_connect.task_creation_dependency_map',true),'')::jsonb,'{}'::jsonb);
  perform ceit_connect_private.finish_task_creation_dependencies();

  for v_item in select value from pg_catalog.jsonb_array_elements(p_tasks_to_update)
  loop
    if v_item ? 'depends_on_task_id' and pg_catalog.jsonb_typeof(v_item->'depends_on_task_id') = 'string' then
      perform public.set_task_dependency((v_item->>'id')::uuid,(v_item->>'depends_on_task_id')::uuid);
    elsif v_item ? 'depends_on_client_key' and pg_catalog.jsonb_typeof(v_item->'depends_on_client_key') = 'string' then
      v_dependency := (v_map->>(((v_item->>'depends_on_client_key')::uuid)::text))::uuid;
      if v_dependency is null then raise exception using errcode='22023',message='The selected temporary prerequisite could not be resolved.'; end if;
      perform public.set_task_dependency((v_item->>'id')::uuid,v_dependency);
    end if;
  end loop;
  return v_result;
exception when others then
  perform ceit_connect_private.clear_task_creation_dependency_context();
  raise;
end;
$$;
alter function public.edit_event_with_task_dependencies(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) owner to postgres;
revoke all on function public.edit_event_with_task_dependencies(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated,service_role;
grant execute on function public.edit_event_with_task_dependencies(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) to authenticated;

create function public.list_event_task_dependency_choices(p_event_id uuid)
returns table(out_task_id uuid,out_label text,out_status text,out_depends_on_task_id uuid,out_can_edit boolean)
language sql stable security definer set search_path = '' as $$
  select t.id,
    case public.task_content_access(t.id) when 'real' then t.title else 'Confidential Task' end,
    t.status,
    case when public.task_content_access(t.id) = 'real' then t.depends_on_task_id else null end,
    public.task_content_access(t.id) = 'real'
      and public.draft_task_write_allowed_for_user(t.id,auth.uid())
      and not public.task_phase_is_complete(t.event_id,t.phase)
  from public.tasks t join public.events e on e.id=t.event_id
  where t.event_id=p_event_id and e.status in ('Draft','Active')
    and exists(select 1 from public.users u where u.id=auth.uid() and u.is_active and u.role in ('Admin','Co-Admin'))
    and public.task_content_access(t.id) in ('real','masked')
  order by t.sort_order,t.id
$$;
alter function public.list_event_task_dependency_choices(uuid) owner to postgres;
revoke all on function public.list_event_task_dependency_choices(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_event_task_dependency_choices(uuid) to authenticated;

comment on function ceit_connect_private.capture_task_creation_dependency() is
'Creation dependencies are set before INSERT so task_created records the final task state and no separate Dependency updated activity row is emitted. In these postgres-owned definer chains current_user is postgres, so the current_user trigger guard is always true; the non-empty transaction-local plan is the actual activation boundary.';
