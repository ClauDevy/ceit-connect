-- Phase 4B Batch B, Stage 2B: event/phase wrappers, atomic database bulk
-- deletion, and the Auth-backed former-member bulk summary finalizer.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch B Stage 2B must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

alter function public.create_event_with_tasks(text,text,date,date,text,jsonb)
rename to create_event_with_tasks_pre_batch_b;
revoke all on function public.create_event_with_tasks_pre_batch_b(text,text,date,date,text,jsonb)
from public, anon, authenticated, service_role;

create function public.create_event_with_tasks(
  p_name text,p_description text,p_start_date date,p_end_date date,p_status text,p_tasks jsonb
)
returns uuid
language plpgsql volatile security definer set search_path=''
as $$
declare v_event_id uuid; v_actor uuid := auth.uid();
begin
  v_event_id := public.create_event_with_tasks_pre_batch_b(
    p_name,p_description,p_start_date,p_end_date,p_status,p_tasks
  );
  perform ceit_connect_private.write_activity(
    'event_created','user',v_actor,null,v_event_id,null,null,null,
    pg_catalog.jsonb_build_object('event_status',p_status)
  );
  if p_status = 'Active' then
    perform ceit_connect_private.write_activity(
      'event_launched','user',v_actor,null,v_event_id,null,null,null,
      pg_catalog.jsonb_build_object('event_status',p_status,'old_status','Draft','new_status','Active')
    );
  end if;
  return v_event_id;
end;
$$;
alter function public.create_event_with_tasks(text,text,date,date,text,jsonb) owner to postgres;
revoke all on function public.create_event_with_tasks(text,text,date,date,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_event_with_tasks(text,text,date,date,text,jsonb) to authenticated;

alter function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)
rename to create_event_from_archived_template_pre_batch_b;
revoke all on function public.create_event_from_archived_template_pre_batch_b(text,text,date,date,text,uuid,jsonb,jsonb)
from public,anon,authenticated,service_role;

create function public.create_event_from_archived_template(
  p_name text,p_description text,p_start_date date,p_end_date date,p_status text,
  p_template_event_id uuid,p_own_tasks jsonb,p_excluded_template_task_ids jsonb
)
returns uuid
language plpgsql volatile security definer set search_path=''
as $$
declare v_event_id uuid; v_actor uuid := auth.uid();
begin
  v_event_id := public.create_event_from_archived_template_pre_batch_b(
    p_name,p_description,p_start_date,p_end_date,p_status,
    p_template_event_id,p_own_tasks,p_excluded_template_task_ids
  );
  perform ceit_connect_private.write_activity(
    'event_created_from_template','user',v_actor,null,v_event_id,null,null,null,
    pg_catalog.jsonb_build_object('event_status',p_status,'source_event_id',p_template_event_id)
  );
  if p_status = 'Active' then
    perform ceit_connect_private.write_activity(
      'event_launched','user',v_actor,null,v_event_id,null,null,null,
      pg_catalog.jsonb_build_object('event_status',p_status,'old_status','Draft','new_status','Active')
    );
  end if;
  return v_event_id;
end;
$$;
alter function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb) to authenticated;

alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)
rename to edit_event_with_tasks_pre_batch_b;
revoke all on function public.edit_event_with_tasks_pre_batch_b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)
from public,anon,authenticated,service_role;

create function public.edit_event_with_tasks(
  p_event_id uuid,p_expected_updated_at timestamptz,p_name text,p_description text,
  p_start_date date,p_end_date date,p_status text,p_tasks_to_add jsonb default '[]'::jsonb,
  p_tasks_to_update jsonb default '[]'::jsonb,p_task_ids_to_delete uuid[] default '{}'::uuid[],
  p_phase_actions jsonb default '[]'::jsonb
)
returns timestamptz
language plpgsql volatile security definer set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_result timestamptz;
  v_before_event jsonb;
  v_after_event jsonb;
  v_before_tasks jsonb;
  v_after_tasks jsonb;
  v_before_phases jsonb;
  v_after_phases jsonb;
  v_before_status text;
  v_after_status text;
  v_changed_fields text[] := '{}'::text[];
  v_action jsonb;
  v_old_phase text;
  v_new_phase text;
  v_phase text;
  v_source_phase text;
  v_before_item jsonb;
  v_after_item jsonb;
  v_phase_renames jsonb := '[]'::jsonb;
  v_survivor_ranks jsonb := '{}'::jsonb;
  v_rename_destinations text[] := '{}'::text[];
begin
  -- Repeat the latest boundary's authorization before snapshots and before
  -- its existing lock sequence. The renamed body authorizes again.
  if not exists(select 1 from public.users where id=v_actor and is_active and role in ('Admin','Co-Admin')) then
    raise exception using errcode='42501',message='Only active Admins and Co-Admins can edit events.';
  end if;

  select pg_catalog.jsonb_build_object(
    'name',event_row.name,'description',event_row.description,
    'start_date',event_row.start_date,'end_date',event_row.end_date
  ), event_row.status
  into v_before_event,v_before_status
  from public.events as event_row where event_row.id=p_event_id;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(task_row)-'updated_at'-'sort_order' order by task_row.id
  ),'[]'::jsonb) into v_before_tasks
  from public.tasks as task_row where task_row.event_id=p_event_id;

  select coalesce(pg_catalog.jsonb_object_agg(phase_row.phase_key,
    pg_catalog.jsonb_build_object(
      'position',phase_row.position,
      'ids',coalesce((select pg_catalog.jsonb_agg(task_row.id order by task_row.id)
        from public.tasks as task_row where task_row.event_id=p_event_id
          and public.canonical_task_phase(task_row.phase)=phase_row.phase_key),'[]'::jsonb)
    ) order by phase_row.phase_key),'{}'::jsonb)
  into v_before_phases
  from ceit_connect_private.event_phase_positions as phase_row
  where phase_row.event_id=p_event_id;

  for v_action in select value from pg_catalog.jsonb_array_elements(coalesce(p_phase_actions,'[]'::jsonb)) as actions(value)
  loop
    if v_action->>'type'='rename' then
      v_old_phase:=public.canonical_task_phase(v_action->>'phase');
      v_new_phase:=public.canonical_task_phase(v_action->>'next_phase');
      v_phase_renames:=v_phase_renames || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('from',v_old_phase,'to',v_new_phase)
      );
      v_rename_destinations:=pg_catalog.array_append(v_rename_destinations,v_new_phase);
    end if;
  end loop;

  perform pg_catalog.set_config('ceit_connect.activity_phase_renames',v_phase_renames::text,true);
  begin
    v_result := public.edit_event_with_tasks_pre_batch_b(
      p_event_id,p_expected_updated_at,p_name,p_description,p_start_date,p_end_date,p_status,
      p_tasks_to_add,p_tasks_to_update,p_task_ids_to_delete,p_phase_actions
    );
    perform pg_catalog.set_config('ceit_connect.activity_phase_renames','',true);
  exception when others then
    perform pg_catalog.set_config('ceit_connect.activity_phase_renames','',true);
    raise;
  end;

  select pg_catalog.jsonb_build_object(
    'name',event_row.name,'description',event_row.description,
    'start_date',event_row.start_date,'end_date',event_row.end_date
  ), event_row.status
  into v_after_event,v_after_status
  from public.events as event_row where event_row.id=p_event_id;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(task_row)-'updated_at'-'sort_order' order by task_row.id
  ),'[]'::jsonb) into v_after_tasks
  from public.tasks as task_row where task_row.event_id=p_event_id;
  select coalesce(pg_catalog.jsonb_object_agg(phase_row.phase_key,
    pg_catalog.jsonb_build_object(
      'position',phase_row.position,
      'ids',coalesce((select pg_catalog.jsonb_agg(task_row.id order by task_row.id)
        from public.tasks as task_row where task_row.event_id=p_event_id
          and public.canonical_task_phase(task_row.phase)=phase_row.phase_key),'[]'::jsonb)
    ) order by phase_row.phase_key),'{}'::jsonb)
  into v_after_phases
  from ceit_connect_private.event_phase_positions as phase_row
  where phase_row.event_id=p_event_id;

  with after_entries as (
    select after_phase.key as phase,
      after_phase.value as item,
      coalesce((
        select rename_pair.value->>'from'
        from pg_catalog.jsonb_array_elements(v_phase_renames) as rename_pair(value)
        where rename_pair.value->>'to'=after_phase.key
        limit 1
      ),after_phase.key) as source_phase
    from pg_catalog.jsonb_each(v_after_phases) as after_phase(key,value)
  ), survivors as (
    select phase,item,source_phase,
      pg_catalog.dense_rank() over (
        order by (v_before_phases->source_phase->>'position')::bigint,source_phase
      ) as old_rank,
      pg_catalog.dense_rank() over (
        order by (item->>'position')::bigint,phase
      ) as new_rank
    from after_entries
    where v_before_phases ? source_phase
  )
  select coalesce(pg_catalog.jsonb_object_agg(phase,
    pg_catalog.jsonb_build_object('old_rank',old_rank,'new_rank',new_rank)
  ),'{}'::jsonb)
  into v_survivor_ranks
  from survivors;

  if v_before_event is distinct from v_after_event then v_changed_fields:=pg_catalog.array_append(v_changed_fields,'metadata'); end if;
  if v_before_tasks is distinct from v_after_tasks then v_changed_fields:=pg_catalog.array_append(v_changed_fields,'tasks'); end if;
  if v_before_phases is distinct from v_after_phases then v_changed_fields:=pg_catalog.array_append(v_changed_fields,'phases'); end if;
  if pg_catalog.cardinality(v_changed_fields)>0 then
    perform ceit_connect_private.write_activity(
      'event_edited','user',v_actor,null,p_event_id,null,null,null,
      pg_catalog.jsonb_build_object('event_status',v_after_status,'changed_fields',pg_catalog.to_jsonb(v_changed_fields))
    );
  end if;
  if v_before_status='Draft' and v_after_status='Active' then
    perform ceit_connect_private.write_activity(
      'event_launched','user',v_actor,null,p_event_id,null,null,null,
      pg_catalog.jsonb_build_object('event_status',v_after_status,'old_status',v_before_status,'new_status',v_after_status)
    );
  end if;

  for v_action in select value from pg_catalog.jsonb_array_elements(coalesce(p_phase_actions,'[]'::jsonb)) as actions(value)
  loop
    if v_action->>'type'='rename' then
      v_old_phase:=public.canonical_task_phase(v_action->>'phase');
      v_new_phase:=public.canonical_task_phase(v_action->>'next_phase');
      v_before_item:=v_before_phases->v_old_phase; v_after_item:=v_after_phases->v_new_phase;
      if v_old_phase is distinct from v_new_phase and v_before_item is not null and v_after_item is not null then
        perform ceit_connect_private.write_activity(
          'phase_renamed','user',v_actor,null,p_event_id,null,null,null,
          pg_catalog.jsonb_build_object(
            'event_status',v_after_status,'phase',v_new_phase,'old_phase',v_old_phase,'new_phase',v_new_phase,
            'old_position',(v_before_item->>'position')::bigint,'new_position',(v_after_item->>'position')::bigint,
            'affected_task_ids',v_after_item->'ids'
          )
        );
      end if;
    elsif v_action->>'type'='delete' then
      v_phase:=public.canonical_task_phase(v_action->>'phase'); v_before_item:=v_before_phases->v_phase;
      if v_before_item is not null and not (v_after_phases ? v_phase) then
        perform ceit_connect_private.write_activity(
          'phase_removed','user',v_actor,null,p_event_id,null,null,null,
          pg_catalog.jsonb_build_object(
            'event_status',v_after_status,'phase',v_phase,'old_position',(v_before_item->>'position')::bigint,
            'affected_task_ids',v_before_item->'ids'
          )
        );
      end if;
    end if;
  end loop;

  for v_phase,v_after_item in select key,value from pg_catalog.jsonb_each(v_after_phases)
  loop
    if not (v_before_phases ? v_phase) and not (v_phase=any(v_rename_destinations)) then
      perform ceit_connect_private.write_activity(
        'phase_added','user',v_actor,null,p_event_id,null,null,null,
        pg_catalog.jsonb_build_object('event_status',v_after_status,'phase',v_phase,
          'position',(v_after_item->>'position')::bigint,'affected_task_ids',v_after_item->'ids')
      );
    end if;
    select public.canonical_task_phase(action.value->>'phase') into v_source_phase
    from pg_catalog.jsonb_array_elements(coalesce(p_phase_actions,'[]'::jsonb)) as action(value)
    where action.value->>'type'='rename'
      and public.canonical_task_phase(action.value->>'next_phase')=v_phase
    limit 1;
    v_source_phase:=coalesce(v_source_phase,v_phase);
    v_before_item:=v_before_phases->v_source_phase;
    if v_survivor_ranks ? v_phase
       and (v_survivor_ranks->v_phase->>'old_rank')::bigint
         is distinct from (v_survivor_ranks->v_phase->>'new_rank')::bigint then
      perform ceit_connect_private.write_activity(
        'phase_moved','user',v_actor,null,p_event_id,null,null,null,
        pg_catalog.jsonb_build_object('event_status',v_after_status,'phase',v_phase,
          'old_position',(v_survivor_ranks->v_phase->>'old_rank')::bigint,
          'new_position',(v_survivor_ranks->v_phase->>'new_rank')::bigint,
          'affected_task_ids',v_after_item->'ids')
      );
    end if;
    v_source_phase:=null;
  end loop;
  return v_result;
end;
$$;
alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) owner to postgres;
revoke all on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated,service_role;
grant execute on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) to authenticated;

alter function public.archive_event(uuid,bigint,timestamptz) rename to archive_event_pre_batch_b;
revoke all on function public.archive_event_pre_batch_b(uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
create function public.archive_event(p_event_id uuid,p_expected_incomplete_task_count bigint,p_expected_updated_at timestamptz)
returns void language plpgsql volatile security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();
begin
  perform public.archive_event_pre_batch_b(p_event_id,p_expected_incomplete_task_count,p_expected_updated_at);
  perform ceit_connect_private.write_activity(
    'event_archived','user',v_actor,null,p_event_id,null,null,null,
    pg_catalog.jsonb_build_object('event_status','Archived','old_status','Active','new_status','Archived')
  );
end;
$$;
alter function public.archive_event(uuid,bigint,timestamptz) owner to postgres;
revoke all on function public.archive_event(uuid,bigint,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.archive_event(uuid,bigint,timestamptz) to authenticated;

create function ceit_connect_private.event_delete_audit_snapshot(p_event_id uuid,p_actor_id uuid)
returns table(event_name text,event_status text)
language plpgsql stable security definer set search_path=''
as $$
begin
  if ceit_connect_private.event_delete_actor_is_active_admin(p_actor_id) is not true then
    raise exception using errcode='CCE01',message='Only an active Admin can delete events.';
  end if;
  return query select event_row.name,event_row.status from public.events as event_row where event_row.id=p_event_id;
end;
$$;
alter function ceit_connect_private.event_delete_audit_snapshot(uuid,uuid) owner to postgres;
revoke all on function ceit_connect_private.event_delete_audit_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function ceit_connect_private.event_delete_audit_snapshot(uuid,uuid) to ceit_event_delete_executor;
grant execute on function ceit_connect_private.write_activity(text,text,uuid,uuid,uuid,uuid,boolean,text,jsonb) to ceit_event_delete_executor;

-- delete_event is intentionally owned by the NOLOGIN executor. Temporarily
-- make postgres a member so it can rename and revoke the existing body.
grant ceit_event_delete_executor to postgres;
grant create on schema public to ceit_event_delete_executor;
set local role ceit_event_delete_executor;
alter function public.delete_event(uuid,uuid,timestamptz) rename to delete_event_pre_batch_b;
revoke all on function public.delete_event_pre_batch_b(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
reset role;

create function public.delete_event(p_event_id uuid,p_actor_id uuid,p_expected_updated_at timestamptz)
returns table(out_event_id uuid,out_cleanup_job_id uuid,out_cleanup_unavailable boolean)
language plpgsql volatile security definer set search_path=''
as $$
declare v_name text;v_status text;v_row record;v_changes jsonb;
begin
  select snapshot.event_name,snapshot.event_status into v_name,v_status
  from ceit_connect_private.event_delete_audit_snapshot(p_event_id,p_actor_id) as snapshot;
  select deletion.* into v_row
  from public.delete_event_pre_batch_b(p_event_id,p_actor_id,p_expected_updated_at) as deletion;
  if not found then return; end if;
  v_changes:=pg_catalog.jsonb_build_object('event_status',v_status);
  if pg_catalog.btrim(pg_catalog.left(coalesce(v_name,''),150)) <> '' then
    v_changes:=v_changes||pg_catalog.jsonb_build_object('event_name',pg_catalog.left(v_name,150));
  end if;
  perform ceit_connect_private.write_activity(
    'event_deleted','user',p_actor_id,null,p_event_id,null,null,null,v_changes
  );
  return query select v_row.out_event_id,v_row.out_cleanup_job_id,v_row.out_cleanup_unavailable;
end;
$$;
revoke all on function public.delete_event(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.delete_event(uuid,uuid,timestamptz) to service_role;
alter function public.delete_event(uuid,uuid,timestamptz) owner to ceit_event_delete_executor;
revoke create on schema public from ceit_event_delete_executor;
revoke ceit_event_delete_executor from postgres;

create function public.delete_events_bulk(p_events jsonb,p_actor_id uuid)
returns table(out_event_id uuid,out_cleanup_job_id uuid,out_cleanup_unavailable boolean,out_error_code text)
language plpgsql volatile security definer set search_path=''
as $$
declare v_item record;v_deleted record;v_success_ids uuid[]:='{}'::uuid[];v_requested integer;v_expected_version timestamptz;
begin
  if ceit_connect_private.event_delete_actor_is_active_admin(p_actor_id) is not true then
    raise exception using errcode='CCE01',message='Only an active Admin can delete events.';
  end if;
  if pg_catalog.jsonb_typeof(p_events) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_events) not between 1 and 10
     or exists(select 1 from pg_catalog.jsonb_array_elements(p_events) item
       where pg_catalog.jsonb_typeof(item) is distinct from 'object'
         or not (item ? 'id' and item ? 'expected_updated_at')
         or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item))<>2
         or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or pg_catalog.jsonb_typeof(item->'expected_updated_at') is distinct from 'string')
     or (select pg_catalog.count(distinct item->>'id') from pg_catalog.jsonb_array_elements(p_events) item)
        <> pg_catalog.jsonb_array_length(p_events) then
    raise exception using errcode='CCE02',message='The bulk deletion request is invalid.';
  end if;
  v_requested:=pg_catalog.jsonb_array_length(p_events);
  for v_item in select (item->>'id')::uuid event_id,item->>'expected_updated_at' expected_version_text
    from pg_catalog.jsonb_array_elements(p_events) item order by (item->>'id')::uuid
  loop
    out_event_id:=v_item.event_id;out_cleanup_job_id:=null;out_cleanup_unavailable:=false;out_error_code:=null;
    begin
      begin
        v_expected_version:=v_item.expected_version_text::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='CCE02',message='The bulk deletion request is invalid.';
      end;
      select deletion.* into v_deleted from public.delete_event(v_item.event_id,p_actor_id,v_expected_version) deletion;
      if not found then raise exception using errcode='CCE07',message='The event could not be deleted safely.'; end if;
      out_cleanup_job_id:=v_deleted.out_cleanup_job_id;
      out_cleanup_unavailable:=v_deleted.out_cleanup_unavailable;
      v_success_ids:=pg_catalog.array_append(v_success_ids,v_item.event_id);
    exception when others then
      get stacked diagnostics out_error_code=returned_sqlstate;
    end;
    return next;
  end loop;
  if v_requested>=2 and pg_catalog.cardinality(v_success_ids)>0 then
    perform ceit_connect_private.write_activity(
      'bulk_events_deleted','user',p_actor_id,null,null,null,null,null,
      pg_catalog.jsonb_build_object('count',pg_catalog.cardinality(v_success_ids),'ids',pg_catalog.to_jsonb(v_success_ids))
    );
  end if;
end;
$$;
revoke all on function public.delete_events_bulk(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_events_bulk(jsonb,uuid) to service_role;
grant ceit_event_delete_executor to postgres;
grant create on schema public to ceit_event_delete_executor;
alter function public.delete_events_bulk(jsonb,uuid) owner to ceit_event_delete_executor;
revoke create on schema public from ceit_event_delete_executor;
revoke ceit_event_delete_executor from postgres;

create function public.finalize_former_member_bulk_activity(p_user_ids uuid[])
returns uuid
language plpgsql volatile security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();v_ids uuid[];v_existing uuid;v_activity uuid;
begin
  if not exists(select 1 from public.users where id=v_actor and is_active and role='Admin') then
    raise exception using errcode='42501',message='Only an active Admin can finalize member activity.';
  end if;
  select pg_catalog.array_agg(person_id order by person_id) into v_ids
  from (select distinct person_id from pg_catalog.unnest(p_user_ids) person_id) ids;
  if p_user_ids is null or pg_catalog.cardinality(p_user_ids) not between 2 and 50
     or pg_catalog.cardinality(v_ids)<>pg_catalog.cardinality(p_user_ids)
     or exists(select 1 from pg_catalog.unnest(v_ids) person_id where person_id is null) then
    raise exception using errcode='CAL04',message='The bulk activity finalizer input is invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('batch-b-member-bulk:'||v_actor::text,0));
  select log_row.id into v_existing from public.activity_log log_row
  where log_row.activity_type='bulk_members_removed' and log_row.user_id=v_actor
    and log_row.changes->'ids'=pg_catalog.to_jsonb(v_ids)
    and (log_row.changes->>'count')::integer=pg_catalog.cardinality(v_ids)
    and log_row.created_at>=pg_catalog.clock_timestamp()-interval '15 minutes'
  order by log_row.created_at desc limit 1;
  if found then return v_existing; end if;
  if exists(select 1 from pg_catalog.unnest(v_ids) person_id where not exists(
    select 1 from public.activity_log log_row where log_row.activity_type='person_removed'
      and log_row.subject_user_id=person_id and log_row.user_id=v_actor and log_row.actor_kind='user'
      and log_row.created_at>=pg_catalog.clock_timestamp()-interval '15 minutes'
  )) then
    raise exception using errcode='CAL04',message='The completed member activity could not be proven.';
  end if;
  if exists(select 1 from public.activity_log log_row
    cross join lateral pg_catalog.jsonb_array_elements_text(case when pg_catalog.jsonb_typeof(log_row.changes->'ids')='array' then log_row.changes->'ids' else '[]'::jsonb end) covered(person_id)
    where log_row.activity_type='bulk_members_removed'
      and covered.person_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and covered.person_id::uuid=any(v_ids)) then
    raise exception using errcode='CAL04',message='The member activity is already covered by another summary.';
  end if;
  v_activity:=ceit_connect_private.write_activity(
    'bulk_members_removed','user',v_actor,null,null,null,null,null,
    pg_catalog.jsonb_build_object('count',pg_catalog.cardinality(v_ids),'ids',pg_catalog.to_jsonb(v_ids))
  );
  return v_activity;
end;
$$;
alter function public.finalize_former_member_bulk_activity(uuid[]) owner to postgres;
revoke all on function public.finalize_former_member_bulk_activity(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.finalize_former_member_bulk_activity(uuid[]) to authenticated;

revoke all on table public.activity_log from public,anon,authenticated,service_role;
