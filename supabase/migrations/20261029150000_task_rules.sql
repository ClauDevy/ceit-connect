-- Phase 4B Batch 13: task rules, leave requests, caps, and raw-boundary fixes.
-- Apply manually to Dev first. Never run this migration from an agent session.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 13 must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

-- Raw deletes retain the same role scopes but cannot bypass lifecycle rules.
drop policy "events_delete" on public.events;
create policy "events_delete" on public.events for delete to authenticated
using (public.my_role() = 'Admin' and status = 'Draft');

drop policy "tasks_delete" on public.tasks;
create policy "tasks_delete" on public.tasks for delete to authenticated
using (
  public.my_role() is not null
  and status = 'To Do'
  and (
    public.my_role() = 'Admin'
    or (public.my_role() = 'Co-Admin' and public.my_committee_id() = committee_id)
  )
);

-- A separate namespace keeps creator-cap locks distinct from Step 10 user locks.
create function public.draft_event_creator_lock_key(p_creator_id uuid)
returns bigint language sql immutable security invoker set search_path = ''
as $$
  select pg_catalog.hashtextextended('ceit-connect:draft-event-cap:' || p_creator_id::text, 0);
$$;
alter function public.draft_event_creator_lock_key(uuid) owner to postgres;
revoke all on function public.draft_event_creator_lock_key(uuid) from public, anon, authenticated;

create function public.lock_draft_event_creator(p_creator_id uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_creator_id is null then raise exception using errcode='22023', message='A creator is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(public.draft_event_creator_lock_key(p_creator_id));
end;
$$;
alter function public.lock_draft_event_creator(uuid) owner to postgres;
revoke all on function public.lock_draft_event_creator(uuid) from public, anon, authenticated;

create function public.count_creator_draft_events(p_creator_id uuid)
returns integer language sql volatile security definer set search_path = ''
as $$ select count(*)::integer from public.events where created_by = p_creator_id and status = 'Draft' $$;
alter function public.count_creator_draft_events(uuid) owner to postgres;
revoke all on function public.count_creator_draft_events(uuid) from public, anon, authenticated;

create function public.enforce_creator_draft_event_cap()
returns trigger language plpgsql volatile security definer set search_path = ''
as $$
declare v_count integer;
begin
  if new.status <> 'Draft' then return new; end if;
  perform public.lock_draft_event_creator(new.created_by);
  v_count := public.count_creator_draft_events(new.created_by);
  if (tg_op = 'INSERT' and v_count >= 10) or (tg_op = 'UPDATE' and v_count > 10) then
    raise exception using errcode='CCD01', message='The Draft event limit has been reached.';
  end if;
  return new;
end;
$$;
alter function public.enforce_creator_draft_event_cap() owner to postgres;
revoke all on function public.enforce_creator_draft_event_cap() from public, anon, authenticated;
create trigger events_enforce_creator_draft_cap
before insert or update on public.events for each row execute function public.enforce_creator_draft_event_cap();

-- Wrap the current event writers so the trigger's later cap-lock acquire is re-entrant.
alter function public.create_event_with_tasks(text,text,date,date,text,jsonb)
rename to create_event_with_tasks_step12;
revoke all on function public.create_event_with_tasks_step12(text,text,date,date,text,jsonb) from public, anon, authenticated;

create function public.create_event_with_tasks(
  p_name text, p_description text, p_start_date date, p_end_date date,
  p_status text, p_tasks jsonb default '[]'::jsonb
) returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare v_ids uuid[] := '{}'::uuid[]; v_task jsonb; v_value jsonb; v_role text;
begin
  select role into v_role from public.users where id=auth.uid() and is_active;
  if v_role is null or v_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only active Admins and Co-Admins can create events.';
  end if;
  if pg_catalog.jsonb_typeof(p_tasks) = 'array' then
    for v_task in select value from pg_catalog.jsonb_array_elements(p_tasks) loop
      if pg_catalog.jsonb_typeof(v_task->'assignee_ids') = 'array' then
        for v_value in select value from pg_catalog.jsonb_array_elements(v_task->'assignee_ids') loop
          begin v_ids := pg_catalog.array_append(v_ids, (v_value#>>'{}')::uuid); exception when others then null; end;
        end loop;
      end if;
    end loop;
  end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_ids
  from (select distinct id from pg_catalog.unnest(v_ids) x(id)) d join public.users using(id);
  perform public.lock_task_assignee_users(v_ids);
  perform public.lock_draft_event_creator(auth.uid());
  return public.create_event_with_tasks_step12(p_name,p_description,p_start_date,p_end_date,p_status,p_tasks);
end;
$$;
alter function public.create_event_with_tasks(text,text,date,date,text,jsonb) owner to postgres;
revoke all on function public.create_event_with_tasks(text,text,date,date,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_event_with_tasks(text,text,date,date,text,jsonb) to authenticated;

alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])
rename to edit_event_with_tasks_step12;
revoke all on function public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[]) from public, anon, authenticated;

create function public.edit_event_with_tasks(
  p_event_id uuid, p_expected_updated_at timestamptz, p_name text, p_description text,
  p_start_date date, p_end_date date, p_status text,
  p_tasks_to_add jsonb default '[]'::jsonb, p_tasks_to_update jsonb default '[]'::jsonb,
  p_task_ids_to_delete uuid[] default '{}'::uuid[]
) returns timestamptz language plpgsql volatile security definer set search_path = ''
as $$
declare v_ids uuid[] := '{}'::uuid[]; v_event_creator uuid; v_role text;
begin
  select role into v_role from public.users where id=auth.uid() and is_active;
  if v_role is null or v_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only active Admins and Co-Admins can edit events.';
  end if;
  with payload_tasks as (
    select 'add'::text as operation, value as task
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_tasks_to_add) = 'array'
        then p_tasks_to_add else '[]'::jsonb end
    )
    union all
    select 'update'::text, value
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_tasks_to_update) = 'array'
        then p_tasks_to_update else '[]'::jsonb end
    )
  ),
  valid_update_ids as (
    select public.task_assignee_uuid_or_null(task ->> 'id') as task_id
    from payload_tasks
    where operation = 'update'
      and pg_catalog.jsonb_typeof(task -> 'id') = 'string'
      and public.task_assignee_uuid_or_null(task ->> 'id') is not null
  ),
  proposed_ids as (
    select public.task_assignee_uuid_or_null(assignee.value #>> '{}') as user_id
    from payload_tasks
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(task -> 'assignee_ids') = 'array'
        then task -> 'assignee_ids' else '[]'::jsonb end
    ) as assignee(value)
    where pg_catalog.jsonb_typeof(assignee.value) = 'string'
      and public.task_assignee_uuid_or_null(assignee.value #>> '{}') is not null
  ),
  stored_ids as (
    select stored.user_id
    from public.tasks as task_row
    join valid_update_ids as update_id on update_id.task_id = task_row.id
    cross join lateral pg_catalog.unnest(
      task_row.primary_assignees || task_row.assist_assignees
    ) as stored(user_id)
    where task_row.event_id = p_event_id
  ),
  all_ids as (
    select user_id from proposed_ids
    union
    select user_id from stored_ids
  )
  select coalesce(pg_catalog.array_agg(user_id order by user_id), '{}'::uuid[])
  into v_ids
  from all_ids
  join public.users as lock_user on lock_user.id = all_ids.user_id;
  perform public.lock_task_assignee_users(v_ids);
  select created_by into v_event_creator from public.events where id=p_event_id for update;
  if not found then raise exception using errcode='42501', message='The event could not be edited.'; end if;
  perform public.lock_draft_event_creator(v_event_creator);
  return public.edit_event_with_tasks_step12(p_event_id,p_expected_updated_at,p_name,p_description,p_start_date,p_end_date,p_status,p_tasks_to_add,p_tasks_to_update,p_task_ids_to_delete);
end;
$$;
alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[]) owner to postgres;
revoke all on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[]) from public, anon, authenticated;
grant execute on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[]) to authenticated;

-- Confidential/viewer fields have the same trusted-marker boundary as assignee arrays.
create function public.guard_task_access_writes()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  v_writer text := coalesce(pg_catalog.current_setting('ceit_connect.task_access_writer', true),'');
  v_trusted boolean := current_user='postgres' and coalesce(v_writer,'') in ('set_task_confidentiality','create_active_event_task','edit_active_event_task');
  v_actor uuid := auth.uid();
  v_new_viewers uuid[];
begin
  if tg_op='INSERT' then
    if (new.is_confidential is true or cardinality(new.allowed_viewers)>0) and not v_trusted then
      raise exception using errcode='42501', message='Task access must be written through an approved function.';
    end if;
    v_new_viewers := new.allowed_viewers;
  elsif new.is_confidential is distinct from old.is_confidential or new.allowed_viewers is distinct from old.allowed_viewers then
    if not v_trusted then raise exception using errcode='42501', message='Task access must be written through an approved function.'; end if;
    v_new_viewers := array(select x from unnest(new.allowed_viewers) x where not x=any(old.allowed_viewers));
  else return new;
  end if;
  if v_actor=any(v_new_viewers)
     or exists(select 1 from unnest(v_new_viewers) x where x=any(new.primary_assignees) or x=any(new.assist_assignees))
     or exists(select 1 from public.task_volunteers v where v.task_id=new.id and v.user_id=any(v_new_viewers)) then
    raise exception using errcode='CCP01', message='The selected person is already covered by this task.';
  end if;
  return new;
end;
$$;
alter function public.guard_task_access_writes() owner to postgres;
revoke all on function public.guard_task_access_writes() from public, anon, authenticated;
create trigger tasks_guard_access_writes before insert or update of is_confidential,allowed_viewers
on public.tasks for each row execute function public.guard_task_access_writes();

-- Existing writers are retained behind wrappers which set and clear the transaction-local marker.
alter function public.set_task_confidentiality(uuid,boolean,uuid[]) rename to set_task_confidentiality_step12;
revoke all on function public.set_task_confidentiality_step12(uuid,boolean,uuid[]) from public,anon,authenticated;
create function public.set_task_confidentiality(p_task_id uuid,p_is_confidential boolean,p_allowed_viewers uuid[])
returns table(task_id uuid,is_confidential boolean,allowed_viewers uuid[])
language plpgsql volatile security definer set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_committee uuid;
  v_task_committee uuid;
  v_event uuid;
  v_event_status text;
begin
  select role,committee_id into v_role,v_committee
  from public.users where id=v_actor and is_active;
  if v_role is null or v_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only authorized active leadership can change task confidentiality.';
  end if;
  select event_id,committee_id into v_event,v_task_committee
  from public.tasks where id=p_task_id;
  if not found
     or (v_role='Co-Admin' and v_committee is distinct from v_task_committee)
     or public.task_content_access_for_user(p_task_id,v_actor) is distinct from 'real' then
    raise exception using errcode='42501',message='You are not allowed to change this task''s confidentiality.';
  end if;
  select status into v_event_status from public.events where id=v_event;
  if not found or v_event_status not in ('Draft','Active') then
    raise exception using errcode='42501',message='You are not allowed to change this task''s confidentiality.';
  end if;
  perform set_config('ceit_connect.task_access_writer','set_task_confidentiality',true);
  return query select * from public.set_task_confidentiality_step12(p_task_id,p_is_confidential,p_allowed_viewers);
  perform set_config('ceit_connect.task_access_writer','',true);
exception when others then perform set_config('ceit_connect.task_access_writer','',true); raise; end $$;
alter function public.set_task_confidentiality(uuid,boolean,uuid[]) owner to postgres;
revoke all on function public.set_task_confidentiality(uuid,boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.set_task_confidentiality(uuid,boolean,uuid[]) to authenticated;

alter function public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])
rename to create_active_event_task_step12;
revoke all on function public.create_active_event_task_step12(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) from public,anon,authenticated;
create function public.create_active_event_task(p_event_id uuid,p_title text,p_description text,p_phase text,p_committee_id uuid,p_task_type text,p_priority text,p_due_date timestamptz,p_call_time timestamptz,p_end_time timestamptz,p_primary_assignees uuid[],p_is_confidential boolean,p_allowed_viewers uuid[])
returns table(out_task_id uuid,out_updated_at timestamptz) language plpgsql volatile security definer set search_path=''
as $$ begin
  perform set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  return query select * from public.create_active_event_task_step12(p_event_id,p_title,p_description,p_phase,p_committee_id,p_task_type,p_priority,p_due_date,p_call_time,p_end_time,p_primary_assignees,p_is_confidential,p_allowed_viewers);
  perform set_config('ceit_connect.task_access_writer','',true);
exception when others then perform set_config('ceit_connect.task_access_writer','',true); raise; end $$;
alter function public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) owner to postgres;
revoke all on function public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) to authenticated;

alter function public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])
rename to edit_active_event_task_step12;
revoke all on function public.edit_active_event_task_step12(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) from public,anon,authenticated;
create function public.edit_active_event_task(p_task_id uuid,p_expected_updated_at timestamptz,p_title text,p_description text,p_phase text,p_committee_id uuid,p_task_type text,p_priority text,p_due_date timestamptz,p_call_time timestamptz,p_end_time timestamptz,p_primary_assignees uuid[],p_is_confidential boolean,p_allowed_viewers uuid[])
returns table(out_task_id uuid,out_updated_at timestamptz,out_status text,out_sort_order bigint) language plpgsql volatile security definer set search_path=''
as $$ begin
  perform set_config('ceit_connect.task_access_writer','edit_active_event_task',true);
  return query select * from public.edit_active_event_task_step12(p_task_id,p_expected_updated_at,p_title,p_description,p_phase,p_committee_id,p_task_type,p_priority,p_due_date,p_call_time,p_end_time,p_primary_assignees,p_is_confidential,p_allowed_viewers);
  perform set_config('ceit_connect.task_access_writer','',true);
exception when others then perform set_config('ceit_connect.task_access_writer','',true); raise; end $$;
alter function public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) owner to postgres;
revoke all on function public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[]) to authenticated;

-- Persistent leave history. No policies: all access is through narrow definers.
create table public.task_leave_requests(
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  requester_id uuid not null references public.users(id),
  status text not null default 'pending' check(status in ('pending','approved','denied','cancelled')),
  stale_reason text check(stale_reason is null or stale_reason in ('no_longer_assigned','task_completed','event_inactive')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  constraint task_leave_resolution_shape check(
    (status='pending' and resolved_at is null and resolved_by is null and stale_reason is null)
    or (status<>'pending' and resolved_at is not null)
  )
);
alter table public.task_leave_requests enable row level security;
revoke all on table public.task_leave_requests from public,anon,authenticated;
create unique index task_leave_requests_one_pending on public.task_leave_requests(task_id,requester_id) where status='pending';
create index task_leave_requests_pending_requester on public.task_leave_requests(requester_id,created_at) where status='pending';

create function public.cancel_stale_task_leave_requests()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  update public.task_leave_requests r set status='cancelled',resolved_at=clock_timestamp(),stale_reason=case when new.status='Completed' then 'task_completed' else 'no_longer_assigned' end
  where r.task_id=new.id and r.status='pending' and (new.status='Completed' or not (r.requester_id=any(new.primary_assignees) or r.requester_id=any(new.assist_assignees)));
  return new;
end $$;
alter function public.cancel_stale_task_leave_requests() owner to postgres;
revoke all on function public.cancel_stale_task_leave_requests() from public,anon,authenticated;
create trigger tasks_cancel_stale_leave_requests after update of status,primary_assignees,assist_assignees on public.tasks for each row execute function public.cancel_stale_task_leave_requests();

create function public.cancel_inactive_event_leave_requests()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  if old.status='Active' and new.status<>'Active' then
    update public.task_leave_requests r set status='cancelled',resolved_at=clock_timestamp(),stale_reason='event_inactive'
    from public.tasks t where t.event_id=new.id and r.task_id=t.id and r.status='pending';
  end if; return new;
end $$;
alter function public.cancel_inactive_event_leave_requests() owner to postgres;
revoke all on function public.cancel_inactive_event_leave_requests() from public,anon,authenticated;
create trigger events_cancel_inactive_leave_requests after update of status on public.events for each row execute function public.cancel_inactive_event_leave_requests();

alter function public.unassign_self(uuid) rename to unassign_self_step12;
revoke all on function public.unassign_self_step12(uuid) from public,anon,authenticated;
create function public.unassign_self(p_task_id uuid)
returns table(out_task_id uuid,out_status text,out_sort_order bigint,out_primary_assignees uuid[],out_assist_assignees uuid[])
language plpgsql volatile security definer set search_path=''
as $$
declare v_id uuid:=auth.uid(); v_role text; v_due timestamptz; v_status text; v_event uuid; v_event_status text; v_primary uuid[]; v_assist uuid[]; v_discovered_primary uuid[]; v_discovered_assist uuid[];
begin
  select role into v_role from public.users where id=v_id and is_active;
  if not found then raise exception using errcode='42501',message='Only an active assignee can leave a task.'; end if;
  select event_id,primary_assignees,assist_assignees into v_event,v_discovered_primary,v_discovered_assist
  from public.tasks where id=p_task_id;
  if not found then raise exception using errcode='42501',message='This task cannot be left.'; end if;
  perform public.lock_task_assignee_users(v_discovered_primary||v_discovered_assist||array[v_id]);
  select status into v_event_status from public.events where id=v_event for share;
  perform pg_catalog.pg_advisory_xact_lock(public.task_dependency_lock_key(v_event));
  select due_date,status,primary_assignees,assist_assignees into v_due,v_status,v_primary,v_assist from public.tasks where id=p_task_id and event_id=v_event for update;
  if not found then raise exception using errcode='42501',message='This task cannot be left.'; end if;
  if v_primary is distinct from v_discovered_primary or v_assist is distinct from v_discovered_assist then
    raise exception using errcode='40001',message='The task assignment changed. Refresh and try again.';
  end if;
  if v_event_status<>'Active' or v_status='Completed' or not(v_id=any(v_primary) or v_id=any(v_assist)) then raise exception using errcode='42501',message='This task cannot be left.'; end if;
  if v_role in ('Admin','Co-Admin') then
    return query select * from public.assign_task_people(p_task_id,array_remove(v_primary,v_id),array_remove(v_assist,v_id)); return;
  end if;
  if v_due is null or v_due>statement_timestamp()+interval '72 hours' then
    return query select * from public.unassign_self_step12(p_task_id); return;
  end if;
  if (select count(*) from public.task_leave_requests where requester_id=v_id and status='pending')>=20 then raise exception using errcode='CCL20',message='The pending leave-request limit has been reached.'; end if;
  begin insert into public.task_leave_requests(task_id,requester_id) values(p_task_id,v_id); exception when unique_violation then raise exception using errcode='CCL01',message='A leave request is already pending.'; end;
  return query select p_task_id,v_status,t.sort_order,v_primary,v_assist from public.tasks t where t.id=p_task_id;
end $$;
alter function public.unassign_self(uuid) owner to postgres;
revoke all on function public.unassign_self(uuid) from public,anon,authenticated;
grant execute on function public.unassign_self(uuid) to authenticated;

create function public.cancel_task_leave_request(p_task_id uuid)
returns void language plpgsql volatile security definer set search_path=''
as $$ declare v_id uuid:=auth.uid(); v_count integer; begin
  if not exists(select 1 from public.users where id=v_id and is_active) then raise exception using errcode='42501',message='An active profile is required.'; end if;
  perform public.lock_task_assignee_users(array[v_id]);
  update public.task_leave_requests r set status='cancelled',resolved_at=clock_timestamp(),resolved_by=v_id
  where r.task_id=p_task_id and r.requester_id=v_id and r.status='pending'
    and exists(select 1 from public.tasks t join public.events e on e.id=t.event_id
      where t.id=r.task_id and e.status='Active'
        and public.task_content_access_for_user(t.id,v_id)='real');
  get diagnostics v_count=row_count; if v_count<>1 then raise exception using errcode='CCL02',message='No pending leave request was found.'; end if;
end $$;
alter function public.cancel_task_leave_request(uuid) owner to postgres;
revoke all on function public.cancel_task_leave_request(uuid) from public,anon,authenticated;
grant execute on function public.cancel_task_leave_request(uuid) to authenticated;

create function public.resolve_task_leave_request(p_request_id uuid,p_decision text)
returns void language plpgsql volatile security definer set search_path=''
as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_committee uuid;
  v_requester uuid; v_task uuid; v_task_committee uuid; v_event uuid;
  v_locked_event uuid; v_task_event uuid; v_task_status text;
  v_primary uuid[]; v_assist uuid[]; v_current_primary uuid[]; v_current_assist uuid[];
  v_count integer;
begin
  if p_decision not in ('approved','denied') then raise exception using errcode='22023',message='A valid decision is required.'; end if;
  select role,committee_id into v_role,v_committee from public.users where id=v_actor and is_active;
  if v_role is null then raise exception using errcode='42501',message='You cannot resolve this leave request.'; end if;
  select r.requester_id,r.task_id,t.committee_id,t.event_id,t.primary_assignees,t.assist_assignees
  into v_requester,v_task,v_task_committee,v_event,v_primary,v_assist
  from public.task_leave_requests r join public.tasks t on t.id=r.task_id
  where r.id=p_request_id and r.status='pending';
  if not found
     or v_actor=v_requester
     or coalesce(v_role='Admin' or (v_role='Co-Admin' and v_committee=v_task_committee),false) is not true
     or public.task_content_access_for_user(v_task,v_actor) is distinct from 'real' then
    raise exception using errcode='42501',message='You cannot resolve this leave request.';
  end if;
  perform public.lock_task_assignee_users(v_primary||v_assist||array[v_requester]);
  select id into v_locked_event from public.events where id=v_event and status='Active' for share;
  if not found then raise exception using errcode='40001',message='The leave request changed. Refresh and try again.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(public.task_dependency_lock_key(v_locked_event));
  select event_id,committee_id,status,primary_assignees,assist_assignees
  into v_task_event,v_task_committee,v_task_status,v_current_primary,v_current_assist
  from public.tasks where id=v_task for update;
  if not found or v_task_event is distinct from v_locked_event
     or v_task_status='Completed'
     or v_current_primary is distinct from v_primary or v_current_assist is distinct from v_assist
     or not(v_requester=any(v_current_primary) or v_requester=any(v_current_assist))
     or coalesce(v_role='Admin' or (v_role='Co-Admin' and v_committee=v_task_committee),false) is not true
     or public.task_content_access_for_user(v_task,v_actor) is distinct from 'real' then
    raise exception using errcode='40001',message='The task assignment changed. Refresh and try again.';
  end if;
  update public.task_leave_requests set status=p_decision,resolved_at=clock_timestamp(),resolved_by=v_actor where id=p_request_id and status='pending'; get diagnostics v_count=row_count;
  if v_count<>1 then raise exception using errcode='40001',message='The leave request changed. Refresh and try again.'; end if;
  if p_decision='approved' then perform * from public.assign_task_people(v_task,array_remove(v_primary,v_requester),array_remove(v_assist,v_requester)); end if;
end $$;
alter function public.resolve_task_leave_request(uuid,text) owner to postgres;
revoke all on function public.resolve_task_leave_request(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_task_leave_request(uuid,text) to authenticated;

create function public.list_pending_task_leave_requests(p_task_id uuid default null)
returns table(out_id uuid,out_task_id uuid,out_task_title text,out_event_name text,out_requester_id uuid,out_requester_name text,out_due_date timestamptz,out_created_at timestamptz,out_can_resolve boolean,out_is_requester boolean)
language sql stable security definer set search_path=''
as $$
  select r.id,t.id,t.title,e.name,r.requester_id,u.full_name,t.due_date,r.created_at,
    c.id<>r.requester_id and (c.role='Admin' or (c.role='Co-Admin' and c.committee_id=t.committee_id)), c.id=r.requester_id
  from public.task_leave_requests r join public.tasks t on t.id=r.task_id join public.events e on e.id=t.event_id join public.users u on u.id=r.requester_id join public.users c on c.id=auth.uid() and c.is_active
  where r.status='pending' and e.status='Active' and (p_task_id is null or t.id=p_task_id)
    and (c.id=r.requester_id or c.role='Admin' or (c.role='Co-Admin' and c.committee_id=t.committee_id))
    and public.task_content_access_for_user(t.id,c.id)='real'
  order by r.created_at,r.id
$$;
alter function public.list_pending_task_leave_requests(uuid) owner to postgres;
revoke all on function public.list_pending_task_leave_requests(uuid) from public,anon,authenticated;
grant execute on function public.list_pending_task_leave_requests(uuid) to authenticated;

-- Volunteer cap and officer auto-helper. Member path keeps the known task/event inversion inside Step 12.
alter function public.volunteer_for_task(uuid) rename to volunteer_for_task_step12;
revoke all on function public.volunteer_for_task_step12(uuid) from public,anon,authenticated;
create function public.volunteer_for_task(p_task_id uuid)
returns table(out_task_id uuid,out_user_id uuid,out_created_at timestamptz)
language plpgsql volatile security definer set search_path=''
as $$
declare
  v_id uuid:=auth.uid();
  v_role text;
  v_primary uuid[];
  v_assist uuid[];
  v_task_status text;
  v_event_status text;
  v_request_backup boolean;
  v_discovered_primary uuid[];
  v_discovered_assist uuid[];
  v_event uuid;
begin
  select role into v_role from public.users where id=v_id and is_active;
  if not found then raise exception using errcode='42501',message='An active profile is required.'; end if;
  if v_role in ('Admin','Co-Admin') then
    select task_row.event_id, task_row.primary_assignees, task_row.assist_assignees,
      task_row.status, task_row.request_backup, event_row.status
    into v_event, v_discovered_primary, v_discovered_assist, v_task_status, v_request_backup, v_event_status
    from public.tasks task_row
    join public.events event_row on event_row.id = task_row.event_id
    where task_row.id = p_task_id;
    if not found or v_event_status <> 'Active' or v_task_status = 'Completed'
       or not v_request_backup
       or v_id = any(v_discovered_primary) or v_id = any(v_discovered_assist) then
      raise exception using errcode='42501',message='This task is not available for help.';
    end if;
    perform public.lock_task_assignee_users(v_discovered_primary||v_discovered_assist||array[v_id]);
    select status into v_event_status from public.events where id=v_event for share;
    if not found or v_event_status<>'Active' then raise exception using errcode='42501',message='This task is not available for help.'; end if;
    perform pg_catalog.pg_advisory_xact_lock(public.task_dependency_lock_key(v_event));
    select primary_assignees,assist_assignees,status,request_backup
    into v_primary,v_assist,v_task_status,v_request_backup
    from public.tasks where id=p_task_id and event_id=v_event for update;
    if not found or v_primary is distinct from v_discovered_primary or v_assist is distinct from v_discovered_assist
       or v_task_status='Completed' or not v_request_backup
       or v_id=any(v_primary) or v_id=any(v_assist) then
      raise exception using errcode='40001',message='The task assignment changed. Refresh and try again.';
    end if;
    perform set_config('ceit_connect.task_self_assignment_writer','volunteer_for_task',true);
    perform * from public.assign_task_people(p_task_id,v_primary,array_append(v_assist,v_id));
    perform set_config('ceit_connect.task_self_assignment_writer','',true);
    return query select p_task_id,v_id,clock_timestamp(); return;
  end if;
  perform public.lock_task_assignee_users(array[v_id]);
  if (select count(*) from public.task_volunteers v join public.tasks t on t.id=v.task_id join public.events e on e.id=t.event_id where v.user_id=v_id and e.status='Active' and t.status<>'Completed' and t.request_backup and not(v_id=any(t.primary_assignees) or v_id=any(t.assist_assignees)))>=20 then
    raise exception using errcode='CCB20',message='The pending volunteer-offer limit has been reached.';
  end if;
  return query select * from public.volunteer_for_task_step12(p_task_id);
exception when others then perform set_config('ceit_connect.task_self_assignment_writer','',true); raise;
end $$;
alter function public.volunteer_for_task(uuid) owner to postgres;
revoke all on function public.volunteer_for_task(uuid) from public,anon,authenticated;
grant execute on function public.volunteer_for_task(uuid) to authenticated;

alter function public.accept_task_volunteer(uuid,uuid) rename to accept_task_volunteer_step12;
revoke all on function public.accept_task_volunteer_step12(uuid,uuid) from public,anon,authenticated;
create function public.accept_task_volunteer(p_task_id uuid,p_user_id uuid)
returns table(out_task_id uuid,out_user_id uuid,out_assist_assignees uuid[],out_outcome text)
language plpgsql volatile security definer set search_path=''
as $$
declare
  v_caller_id uuid:=auth.uid();
  v_caller_role text;
  v_event_id uuid;
  v_task_event_id uuid;
  v_event_status text;
  v_task_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_request_backup boolean;
  v_target_offer_exists boolean;
  v_volunteer_is_active boolean;
  v_affected integer;
begin
  if p_task_id is null or p_user_id is null then
    raise exception using errcode='22023',message='Task and volunteer IDs are required.';
  end if;

  select user_row.role into v_caller_role
  from public.users user_row
  where user_row.id=v_caller_id and user_row.is_active is true;
  if v_caller_id is null or not found then
    raise exception using errcode='42501',message='An active profile is required.';
  end if;
  if v_caller_id=p_user_id then
    raise exception using errcode='CCB11',message='You cannot accept your own volunteer offer.';
  end if;

  if v_caller_role not in ('Admin','Co-Admin')
     and (public.task_content_access(p_task_id)<>'real'
       or not exists(select 1 from public.tasks task_row
         where task_row.id=p_task_id and v_caller_id=any(task_row.primary_assignees))) then
    raise exception using errcode='42501',message='You cannot accept volunteers for this task.';
  end if;

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);
  select task_row.event_id into v_event_id
  from public.tasks task_row where task_row.id=p_task_id;
  if not found then raise exception using errcode='CCB01',message='The task is unavailable.'; end if;

  select event_row.status into v_event_status
  from public.events event_row where event_row.id=v_event_id for share;
  if not found then raise exception using errcode='40001',message='The task changed. Refresh and try again.'; end if;

  select task_row.event_id,task_row.status,task_row.primary_assignees,
    task_row.assist_assignees,task_row.request_backup
  into v_task_event_id,v_task_status,v_primary_assignees,v_assist_assignees,v_request_backup
  from public.tasks task_row where task_row.id=p_task_id for update;
  if not found then raise exception using errcode='CCB01',message='The task is unavailable.'; end if;
  if v_task_event_id is distinct from v_event_id then
    raise exception using errcode='40001',message='The task changed. Refresh and try again.';
  end if;
  if public.task_content_access(p_task_id)<>'real'
     or not(v_caller_role in ('Admin','Co-Admin') or v_caller_id=any(v_primary_assignees)) then
    raise exception using errcode='42501',message='You cannot accept volunteers for this task.';
  end if;
  if v_event_status<>'Active' then
    raise exception using errcode='CCB02',message='Volunteers can be accepted only for Active events.';
  end if;
  if v_task_status='Completed' or not v_request_backup then
    raise exception using errcode='CCB05',message='This task is not accepting volunteers.';
  end if;

  perform 1 from public.task_volunteers volunteer_row
  where volunteer_row.task_id=p_task_id
  order by volunteer_row.user_id for update;
  select exists(select 1 from public.task_volunteers volunteer_row
    where volunteer_row.task_id=p_task_id and volunteer_row.user_id=p_user_id)
  into v_target_offer_exists;
  if not v_target_offer_exists then
    raise exception using errcode='CCB06',message='The volunteer offer is no longer pending.';
  end if;

  select user_row.is_active into v_volunteer_is_active
  from public.users user_row where user_row.id=p_user_id;
  delete from public.task_volunteers volunteer_row
  where volunteer_row.task_id=p_task_id
    and (volunteer_row.user_id=any(v_primary_assignees)
      or volunteer_row.user_id=any(v_assist_assignees)
      or not exists(select 1 from public.users user_row
        where user_row.id=volunteer_row.user_id and user_row.is_active is true));

  if not coalesce(v_volunteer_is_active,false) then
    out_task_id:=p_task_id; out_user_id:=p_user_id;
    out_assist_assignees:=v_assist_assignees; out_outcome:='inactive_removed';
    return next; return;
  end if;
  if p_user_id=any(v_primary_assignees) or p_user_id=any(v_assist_assignees) then
    out_task_id:=p_task_id; out_user_id:=p_user_id;
    out_assist_assignees:=v_assist_assignees; out_outcome:='already_assigned_removed';
    return next; return;
  end if;
  if cardinality(v_primary_assignees)+cardinality(v_assist_assignees)>=100 then
    raise exception using errcode='CCB10',message='A task cannot have more than 100 assignees.';
  end if;

  -- The selected offer must be gone before the guarded task update. If the
  -- update fails, transaction rollback restores this row automatically.
  delete from public.task_volunteers volunteer_row
  where volunteer_row.task_id=p_task_id and volunteer_row.user_id=p_user_id;

  perform set_config('ceit_connect.task_assignee_writer','accept_task_volunteer',true);
  update public.tasks task_row
  set assist_assignees=array_append(task_row.assist_assignees,p_user_id)
  where task_row.id=p_task_id and task_row.event_id=v_event_id
    and not p_user_id=any(task_row.primary_assignees)
    and not p_user_id=any(task_row.assist_assignees)
  returning task_row.id,task_row.assist_assignees into out_task_id,out_assist_assignees;
  get diagnostics v_affected=row_count;
  perform set_config('ceit_connect.task_assignee_writer','',true);
  if v_affected<>1 then
    raise exception using errcode='40001',message='The assignment changed. Refresh and try again.';
  end if;
  out_user_id:=p_user_id; out_outcome:='accepted'; return next;
exception when others then
  perform set_config('ceit_connect.task_assignee_writer','',true); raise;
end $$;

alter function public.accept_task_volunteer(uuid,uuid) owner to postgres;
revoke all on function public.accept_task_volunteer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_task_volunteer(uuid,uuid) to authenticated;

-- Extend the assignee guard with stored-state candidate checks and the officer-helper exception.
create or replace function public.guard_task_assignee_writes()
returns trigger language plpgsql security invoker set search_path=''
as $$
declare
  v_writer text:=coalesce(current_setting('ceit_connect.task_assignee_writer',true),'');
  v_self_writer text:=coalesce(current_setting('ceit_connect.task_self_assignment_writer',true),'');
  v_trusted boolean:=current_user='postgres' and coalesce(v_writer,'') in ('create_event_with_tasks','edit_event_with_tasks','assign_task_people','unassign_self','claim_task','accept_task_volunteer','create_active_event_task','edit_active_event_task');
  v_added uuid[]; v_actor uuid:=auth.uid();
begin
  if tg_op='INSERT' then v_added:=new.primary_assignees||new.assist_assignees;
  else v_added:=array(select x from unnest(new.primary_assignees||new.assist_assignees) x where not x=any(old.primary_assignees||old.assist_assignees)); end if;
  if cardinality(v_added)>0 and not v_trusted then raise exception using errcode='42501',message='Task assignees must be written through an approved function.'; end if;
  if cardinality(v_added)>0 and coalesce(v_writer,'')<>'claim_task' and coalesce(v_self_writer,'')<>'volunteer_for_task' and v_actor=any(v_added) then raise exception using errcode='CCP01',message='The acting user cannot be newly selected.'; end if;
  if cardinality(v_added)>0 and (exists(select 1 from unnest(v_added) x where x=any(new.allowed_viewers)) or exists(select 1 from public.task_volunteers v where v.task_id=new.id and v.user_id=any(v_added))) then raise exception using errcode='CCP01',message='The selected person is already covered by this task.'; end if;
  return new;
end $$;

-- The public implementation fully replaces the renamed Step 12 body.
drop function public.accept_task_volunteer_step12(uuid,uuid);

