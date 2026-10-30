-- Phase 4B Batch 13c: safe all-committee Draft task visibility.
-- Raw task RLS is intentionally unchanged. Expanded reads flow only through
-- fixed-shape SECURITY DEFINER readers; Draft writes remain committee-scoped.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 13c must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

create or replace function public.task_content_access_for_user(
  p_task_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_role text;
  v_user_committee_id uuid;
  v_event_status text;
  v_task_committee_id uuid;
  v_is_confidential boolean;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_allowed_viewers uuid[];
begin
  select user_row.role, user_row.committee_id
  into v_user_role, v_user_committee_id
  from public.users user_row
  where user_row.id = p_user_id
    and user_row.is_active is true;

  if not found then return 'hidden'; end if;

  select event_row.status, task_row.committee_id, task_row.is_confidential,
    task_row.primary_assignees, task_row.assist_assignees, task_row.allowed_viewers
  into v_event_status, v_task_committee_id, v_is_confidential,
    v_primary_assignees, v_assist_assignees, v_allowed_viewers
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found then return 'hidden'; end if;

  if v_event_status = 'Draft' then
    if coalesce(v_user_role, '') not in ('Admin', 'Co-Admin') then return 'hidden'; end if;
    if v_is_confidential is false
       or v_user_role = 'Admin'
       or v_user_committee_id = v_task_committee_id
       or p_user_id = any(v_primary_assignees)
       or p_user_id = any(v_assist_assignees)
       or p_user_id = any(v_allowed_viewers) then
      return 'real';
    end if;
    return 'masked';
  end if;

  -- Active/Archived tail intentionally copied byte-for-byte from
  -- 20261023160000_archived_task_viewers.sql.
  if v_is_confidential is false
     or v_user_role = 'Admin'
     or (
       v_user_role = 'Co-Admin'
       and v_user_committee_id = v_task_committee_id
     )
     or p_user_id = any(v_primary_assignees)
     or p_user_id = any(v_assist_assignees)
     or p_user_id = any(v_allowed_viewers)
     or (
       v_event_status = 'Archived'
       and exists (
         select 1
         from public.archived_task_viewers archive_viewer
         where archive_viewer.task_id = p_task_id
           and archive_viewer.user_id = p_user_id
       )
     ) then
    return 'real';
  end if;

  return 'masked';
end;
$$;
alter function public.task_content_access_for_user(uuid, uuid) owner to postgres;
revoke all on function public.task_content_access_for_user(uuid, uuid) from public, anon, authenticated;

create function public.draft_task_write_allowed_for_user(p_task_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_event_status text;
  v_task_committee_id uuid;
  v_user_role text;
  v_user_committee_id uuid;
  v_user_is_active boolean;
begin
  select event_row.status, task_row.committee_id
  into v_event_status, v_task_committee_id
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found or v_event_status <> 'Draft' then
    return true;
  end if;

  select user_row.role, user_row.committee_id, user_row.is_active
  into v_user_role, v_user_committee_id, v_user_is_active
  from public.users as user_row
  where user_row.id = p_user_id;

  if not found
     or v_user_is_active is not true
     or coalesce(v_user_role, '') not in ('Admin', 'Co-Admin') then
    return false;
  end if;

  return v_user_role = 'Admin'
    or v_user_committee_id = v_task_committee_id;
end;
$$;
alter function public.draft_task_write_allowed_for_user(uuid, uuid) owner to postgres;
revoke all on function public.draft_task_write_allowed_for_user(uuid, uuid) from public, anon, authenticated;

create function public.list_draft_event_editor_tasks(p_event_id uuid)
returns table (
  out_task_id uuid, out_phase text, out_status text, out_title text,
  out_description text, out_priority text, out_task_type text,
  out_due_date timestamptz, out_call_time timestamptz, out_end_time timestamptz,
  out_committee_id uuid, out_committee_name text,
  out_primary_assignees jsonb, out_assist_assignees jsonb,
  out_is_masked boolean, out_is_editable boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_role text;
  v_committee_id uuid;
begin
  select role, committee_id into v_role, v_committee_id
  from public.users
  where id = v_caller_id and is_active is true;
  if not found or v_role not in ('Admin', 'Co-Admin') then return; end if;

  if not exists (
    select 1 from public.events
    where id = p_event_id and status = 'Draft'
  ) then return; end if;

  return query
  with safe_tasks as materialized (
    select t.*, c.name as committee_name,
      public.task_content_access_for_user(t.id, v_caller_id) as content_access
    from public.tasks t
    join public.committees c on c.id = t.committee_id
    where t.event_id = p_event_id
  )
  select s.id, coalesce(nullif(pg_catalog.btrim(s.phase), ''), 'Unphased'), s.status,
    case when s.content_access = 'real' then s.title else 'Confidential Task' end,
    case when s.content_access = 'real' then s.description end,
    case when s.content_access = 'real' then s.priority end,
    case when s.content_access = 'real' then s.task_type end,
    case when s.content_access = 'real' then s.due_date end,
    case when s.content_access = 'real' then s.call_time end,
    case when s.content_access = 'real' then s.end_time end,
    case when s.content_access = 'real' then s.committee_id end,
    case when s.content_access = 'real' then s.committee_name end,
    case when s.content_access='real' then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id,'full_name',u.full_name,'avatar_url',u.avatar_url) order by a.position)
      from pg_catalog.unnest(s.primary_assignees) with ordinality a(id,position)
      left join public.users u on u.id=a.id
    ),'[]'::jsonb) else '[]'::jsonb end,
    case when s.content_access='real' then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id,'full_name',u.full_name,'avatar_url',u.avatar_url) order by a.position)
      from pg_catalog.unnest(s.assist_assignees) with ordinality a(id,position)
      left join public.users u on u.id=a.id
    ),'[]'::jsonb) else '[]'::jsonb end,
    s.content_access = 'masked',
    v_role = 'Admin' or v_committee_id = s.committee_id
  from safe_tasks s
  where s.content_access in ('real', 'masked')
  order by s.sort_order, s.id;
end;
$$;
alter function public.list_draft_event_editor_tasks(uuid) owner to postgres;
revoke all on function public.list_draft_event_editor_tasks(uuid) from public, anon, authenticated;
grant execute on function public.list_draft_event_editor_tasks(uuid) to authenticated;

-- Keep the proven Active reader body intact behind a revoked internal name.
alter function public.list_event_board_tasks(uuid, uuid)
rename to list_event_board_tasks_pre13c;
revoke all on function public.list_event_board_tasks_pre13c(uuid, uuid) from public, anon, authenticated;

create function public.list_event_board_tasks(p_event_id uuid, p_committee_id uuid default null)
returns table (
  id uuid, title text, phase text, status text, effective_priority text,
  due_date timestamptz, committee_id uuid, committee_name text,
  primary_assignees jsonb, assist_assignees jsonb,
  is_backlog boolean, is_masked boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_is_active boolean;
  v_caller_is_admin boolean;
  v_event_status text;
begin
  select user_row.is_active is true, user_row.role = 'Admin'
  into v_caller_is_active, v_caller_is_admin
  from public.users as user_row
  where user_row.id = auth.uid();

  if not found or v_caller_is_active is not true then
    return;
  end if;

  if p_committee_id is not null then
    if v_caller_is_admin is not true then
      raise exception using errcode='42501',message='Committee filtering is Admin-only.';
    end if;
    if not exists(
      select 1
      from public.committees as committee_row
      where committee_row.id = p_committee_id
    ) then
      raise exception using errcode='22023',message='Unknown committee filter.';
    end if;
  end if;

  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = p_event_id;

  if not found or v_event_status not in ('Draft', 'Active') then return; end if;
  if v_event_status = 'Active' then
    return query
    select prior_row.id, prior_row.title, prior_row.phase, prior_row.status,
      prior_row.effective_priority, prior_row.due_date,
      prior_row.committee_id, prior_row.committee_name,
      prior_row.primary_assignees, prior_row.assist_assignees,
      prior_row.is_backlog, prior_row.is_masked
    from public.list_event_board_tasks_pre13c(p_event_id, p_committee_id) as prior_row;
    return;
  end if;
  return query
  select editor_row.out_task_id, editor_row.out_title, editor_row.out_phase,
    editor_row.out_status,
    case when not editor_row.out_is_masked then public.calculate_effective_task_priority(
      editor_row.out_priority, editor_row.out_due_date,
      pg_catalog.statement_timestamp(), editor_row.out_status) end,
    editor_row.out_due_date, editor_row.out_committee_id,
    editor_row.out_committee_name, editor_row.out_primary_assignees,
    editor_row.out_assist_assignees,
    pg_catalog.cardinality(task_row.primary_assignees) = 0
      and task_row.status <> 'Completed',
    editor_row.out_is_masked
  from public.list_draft_event_editor_tasks(p_event_id) as editor_row
  join public.tasks as task_row on task_row.id = editor_row.out_task_id
  where p_committee_id is null
    or editor_row.out_committee_id = p_committee_id
  order by task_row.sort_order, task_row.id;
end;
$$;
alter function public.list_event_board_tasks(uuid, uuid) owner to postgres;
revoke all on function public.list_event_board_tasks(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_event_board_tasks(uuid, uuid) to authenticated;

-- Replace the public Edit Event overload. The internal Step 12 body stays
-- ungranted and remains the only physical mutation implementation.
drop function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[]);

create function public.edit_event_with_tasks(
  p_event_id uuid, p_expected_updated_at timestamptz, p_name text, p_description text,
  p_start_date date, p_end_date date, p_status text,
  p_tasks_to_add jsonb default '[]'::jsonb,
  p_tasks_to_update jsonb default '[]'::jsonb,
  p_task_ids_to_delete uuid[] default '{}'::uuid[],
  p_phase_actions jsonb default '[]'::jsonb
) returns timestamptz language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ids uuid[] := '{}'::uuid[]; v_event_creator uuid; v_role text; v_committee uuid;
  v_action jsonb; v_action_type text; v_phase text;
begin
  select role,committee_id into v_role,v_committee
  from public.users where id=auth.uid() and is_active;
  if v_role is null or v_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only active Admins and Co-Admins can edit events.';
  end if;
  if (case
       when p_phase_actions is null then true
       when pg_catalog.jsonb_typeof(p_phase_actions) <> 'array' then true
       else pg_catalog.jsonb_array_length(p_phase_actions) > 50
     end) then
    raise exception using errcode='22023',message='Phase actions are invalid.';
  end if;
  for v_action in select action_row.value from pg_catalog.jsonb_array_elements(p_phase_actions) as action_row(value) loop
    if pg_catalog.jsonb_typeof(v_action)<>'object' then
      raise exception using errcode='22023',message='Phase actions are invalid.';
    end if;
    v_action_type:=v_action->>'type'; v_phase:=nullif(pg_catalog.btrim(v_action->>'phase'),'');
    if v_action_type is null or v_action_type not in ('rename','delete') or v_phase is null
       or (v_action_type='rename' and nullif(pg_catalog.btrim(v_action->>'next_phase'),'') is null) then
      raise exception using errcode='22023',message='Phase actions are invalid.';
    end if;
    if v_role='Co-Admin' and exists(
      select 1 from public.tasks t join public.events e on e.id=t.event_id
      where t.event_id=p_event_id and e.status='Draft'
        and coalesce(nullif(pg_catalog.btrim(t.phase),''),'Unphased')=v_phase
        and t.committee_id is distinct from v_committee
    ) then
      raise exception using errcode='42501',message='A phase containing read-only tasks cannot be renamed or removed.';
    end if;
  end loop;

  with payload_tasks as (
    select 'add'::text operation,add_row.value task from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_tasks_to_add)='array' then p_tasks_to_add else '[]'::jsonb end) as add_row(value)
    union all
    select 'update',update_row.value from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_tasks_to_update)='array' then p_tasks_to_update else '[]'::jsonb end) as update_row(value)
  ), valid_update_ids as (
    select public.task_assignee_uuid_or_null(task->>'id') task_id from payload_tasks
    where operation='update' and pg_catalog.jsonb_typeof(task->'id')='string'
      and public.task_assignee_uuid_or_null(task->>'id') is not null
  ), proposed_ids as (
    select public.task_assignee_uuid_or_null(a.value#>>'{}') user_id from payload_tasks
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(task->'assignee_ids')='array' then task->'assignee_ids' else '[]'::jsonb end) a(value)
    where pg_catalog.jsonb_typeof(a.value)='string' and public.task_assignee_uuid_or_null(a.value#>>'{}') is not null
  ), stored_ids as (
    select stored.user_id from public.tasks t join valid_update_ids u on u.task_id=t.id
    cross join lateral pg_catalog.unnest(t.primary_assignees||t.assist_assignees) stored(user_id)
    where t.event_id=p_event_id
  ), all_ids as (select user_id from proposed_ids union select user_id from stored_ids)
  select coalesce(pg_catalog.array_agg(user_id order by user_id),'{}'::uuid[]) into v_ids
  from all_ids join public.users lock_user on lock_user.id=all_ids.user_id;
  perform public.lock_task_assignee_users(v_ids);
  select created_by into v_event_creator from public.events where id=p_event_id for update;
  if not found then raise exception using errcode='42501',message='The event could not be edited.'; end if;
  perform public.lock_draft_event_creator(v_event_creator);

  if v_role='Co-Admin' and exists(
    select 1 from pg_catalog.jsonb_array_elements(p_phase_actions) a(value)
    join public.tasks t on t.event_id=p_event_id
      and coalesce(nullif(pg_catalog.btrim(t.phase),''),'Unphased')=nullif(pg_catalog.btrim(a.value->>'phase'),'')
    join public.events e on e.id=t.event_id and e.status='Draft'
    where t.committee_id is distinct from v_committee
  ) then
    raise exception using errcode='42501',message='A phase containing read-only tasks cannot be renamed or removed.';
  end if;
  return public.edit_event_with_tasks_step12(p_event_id,p_expected_updated_at,p_name,p_description,
    p_start_date,p_end_date,p_status,p_tasks_to_add,p_tasks_to_update,p_task_ids_to_delete);
end;
$$;
alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) owner to postgres;
revoke all on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) to authenticated;
revoke all on function public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[]) from public,anon,authenticated;

-- Draft-only pre-lock gates around existing proven writers. Active and
-- Archived calls delegate to the exact previous bodies unchanged.
alter function public.set_task_dependency(uuid,uuid) rename to set_task_dependency_pre13c;
revoke all on function public.set_task_dependency_pre13c(uuid,uuid) from public,anon,authenticated;
create function public.set_task_dependency(p_task_id uuid,p_depends_on_task_id uuid)
returns table(task_id uuid,depends_on_task_id uuid) language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='You are not allowed to change this Draft task.'; end if;
  return query select * from public.set_task_dependency_pre13c(p_task_id,p_depends_on_task_id);
end $$;
alter function public.set_task_dependency(uuid,uuid) owner to postgres;
revoke all on function public.set_task_dependency(uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_task_dependency(uuid,uuid) to authenticated;

alter function public.assign_task_people(uuid,uuid[],uuid[]) rename to assign_task_people_pre13c;
revoke all on function public.assign_task_people_pre13c(uuid,uuid[],uuid[]) from public,anon,authenticated;
create function public.assign_task_people(p_task_id uuid,p_primary_assignees uuid[],p_assist_assignees uuid[])
returns table(out_task_id uuid,out_status text,out_sort_order bigint,out_primary_assignees uuid[],out_assist_assignees uuid[])
language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='You are not allowed to change this Draft task.'; end if;
  return query select * from public.assign_task_people_pre13c(p_task_id,p_primary_assignees,p_assist_assignees);
end $$;
alter function public.assign_task_people(uuid,uuid[],uuid[]) owner to postgres;
revoke all on function public.assign_task_people(uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.assign_task_people(uuid,uuid[],uuid[]) to authenticated;

alter function public.delete_task(uuid) rename to delete_task_pre13c;
revoke all on function public.delete_task_pre13c(uuid) from public,anon,authenticated;
create function public.delete_task(p_task_id uuid) returns table(out_task_id uuid)
language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='You are not allowed to change this Draft task.'; end if;
  return query select * from public.delete_task_pre13c(p_task_id);
end $$;
alter function public.delete_task(uuid) owner to postgres;
revoke all on function public.delete_task(uuid) from public,anon,authenticated;
grant execute on function public.delete_task(uuid) to authenticated;

alter function public.remove_task_work_link(uuid) rename to remove_task_work_link_pre13c;
revoke all on function public.remove_task_work_link_pre13c(uuid) from public,anon,authenticated;
create function public.remove_task_work_link(p_link_id uuid) returns void
language plpgsql volatile security definer set search_path=''
as $$ declare v_task uuid; begin
  select task_id into v_task from public.task_work_links where id=p_link_id;
  if v_task is null or public.draft_task_write_allowed_for_user(v_task,auth.uid()) is not true then raise exception using errcode='42501',message='Work-link access is not allowed.'; end if;
  perform public.remove_task_work_link_pre13c(p_link_id);
end $$;
alter function public.remove_task_work_link(uuid) owner to postgres;
revoke all on function public.remove_task_work_link(uuid) from public,anon,authenticated;
grant execute on function public.remove_task_work_link(uuid) to authenticated;

alter function public.add_task_work_link(uuid,text,text) rename to add_task_work_link_pre13c;
revoke all on function public.add_task_work_link_pre13c(uuid,text,text) from public,anon,authenticated;
create function public.add_task_work_link(p_task_id uuid,p_name text,p_url text)
returns table(id uuid,name text,url text,created_at timestamptz)
language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  return query select prior_row.id,prior_row.name,prior_row.url,prior_row.created_at
  from public.add_task_work_link_pre13c(p_task_id,p_name,p_url) as prior_row;
end $$;
alter function public.add_task_work_link(uuid,text,text) owner to postgres;
revoke all on function public.add_task_work_link(uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_task_work_link(uuid,text,text) to authenticated;

alter function public.add_task_comment(uuid,text,boolean,uuid[]) rename to add_task_comment_pre13c;
revoke all on function public.add_task_comment_pre13c(uuid,text,boolean,uuid[]) from public,anon,authenticated;
create function public.add_task_comment(p_task_id uuid,p_body text,p_is_heads_up boolean default false,p_mentioned_user_ids uuid[] default '{}')
returns table(out_id uuid,out_created_at timestamptz) language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='The task comments are unavailable.'; end if;
  return query select * from public.add_task_comment_pre13c(p_task_id,p_body,p_is_heads_up,p_mentioned_user_ids);
end $$;
alter function public.add_task_comment(uuid,text,boolean,uuid[]) owner to postgres;
revoke all on function public.add_task_comment(uuid,text,boolean,uuid[]) from public,anon,authenticated;
grant execute on function public.add_task_comment(uuid,text,boolean,uuid[]) to authenticated;

alter function public.edit_task_comment(uuid,text,boolean,uuid[],timestamptz) rename to edit_task_comment_pre13c;
revoke all on function public.edit_task_comment_pre13c(uuid,text,boolean,uuid[],timestamptz) from public,anon,authenticated;
create function public.edit_task_comment(p_comment_id uuid,p_body text,p_is_heads_up boolean,p_mentioned_user_ids uuid[],p_expected_edited_at timestamptz)
returns table(out_id uuid,out_edited_at timestamptz) language plpgsql volatile security definer set search_path=''
as $$ declare v_task uuid; begin
  select task_id into v_task from public.task_comments where id=p_comment_id;
  if v_task is null or public.draft_task_write_allowed_for_user(v_task,auth.uid()) is not true then raise exception using errcode='42501',message='The task comments are unavailable.'; end if;
  return query select * from public.edit_task_comment_pre13c(p_comment_id,p_body,p_is_heads_up,p_mentioned_user_ids,p_expected_edited_at);
end $$;
alter function public.edit_task_comment(uuid,text,boolean,uuid[],timestamptz) owner to postgres;
revoke all on function public.edit_task_comment(uuid,text,boolean,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.edit_task_comment(uuid,text,boolean,uuid[],timestamptz) to authenticated;

alter function public.delete_task_comment(uuid) rename to delete_task_comment_pre13c;
revoke all on function public.delete_task_comment_pre13c(uuid) from public,anon,authenticated;
create function public.delete_task_comment(p_comment_id uuid) returns void
language plpgsql volatile security definer set search_path=''
as $$ declare v_task uuid; begin
  select task_id into v_task from public.task_comments where id=p_comment_id;
  if v_task is null or public.draft_task_write_allowed_for_user(v_task,auth.uid()) is not true then raise exception using errcode='42501',message='The task comments are unavailable.'; end if;
  perform public.delete_task_comment_pre13c(p_comment_id);
end $$;
alter function public.delete_task_comment(uuid) owner to postgres;
revoke all on function public.delete_task_comment(uuid) from public,anon,authenticated;
grant execute on function public.delete_task_comment(uuid) to authenticated;

-- Fixed-shape capability readers. The previous bodies remain byte-identical
-- behind revoked names for every Active/Archived and in-scope Draft call.
alter function public.get_task_edit_controls(uuid) rename to get_task_edit_controls_pre13c;
revoke all on function public.get_task_edit_controls_pre13c(uuid) from public,anon,authenticated;
create function public.get_task_edit_controls(p_task_id uuid)
returns table (
  can_set_dependency boolean, can_set_confidentiality boolean,
  can_edit_task boolean, can_assign_people boolean, can_delete boolean,
  can_unassign_self boolean, self_unassign_block_code text,
  self_unassign_will_lose_access boolean, depends_on_task_id uuid,
  is_confidential boolean, allowed_viewers jsonb, dependency_options jsonb,
  viewer_options jsonb, primary_assignees jsonb, assist_assignees jsonb,
  assignee_options jsonb
)
language plpgsql stable security definer set search_path=''
as $$
declare
  v_is_draft boolean;
  v_is_active_coadmin boolean;
  v_content_access text;
begin
  v_content_access := public.task_content_access(p_task_id);

  select event_row.status = 'Draft'
  into v_is_draft
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  select user_row.is_active is true and user_row.role = 'Co-Admin'
  into v_is_active_coadmin
  from public.users as user_row
  where user_row.id = auth.uid();

  if v_is_draft is true
     and v_is_active_coadmin is true
     and public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then
    if v_content_access <> 'real' then
      return;
    end if;
    return query select false,false,false,false,false,false,null::text,false,
      null::uuid,null::boolean,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
      '[]'::jsonb,'[]'::jsonb,'[]'::jsonb;
    return;
  end if;

  return query select * from public.get_task_edit_controls_pre13c(p_task_id);
end $$;
alter function public.get_task_edit_controls(uuid) owner to postgres;
revoke all on function public.get_task_edit_controls(uuid) from public,anon,authenticated;
grant execute on function public.get_task_edit_controls(uuid) to authenticated;

alter function public.get_task_work_links(uuid) rename to get_task_work_links_pre13c;
revoke all on function public.get_task_work_links_pre13c(uuid) from public,anon,authenticated;
create function public.get_task_work_links(p_task_id uuid)
returns table(can_add boolean,links jsonb)
language plpgsql stable security definer set search_path=''
as $$
declare
  v_access text;
  v_is_draft_cross_committee boolean;
begin
  v_access := public.task_content_access(p_task_id);
  select event_row.status = 'Draft'
    and user_row.is_active is true
    and user_row.role = 'Co-Admin'
    and user_row.committee_id is distinct from task_row.committee_id
  into v_is_draft_cross_committee
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  join public.users as user_row on user_row.id = auth.uid()
  where task_row.id = p_task_id;

  if v_is_draft_cross_committee is true then
    if v_access <> 'real' then
      return query select false,'[]'::jsonb;
      return;
    end if;
    return query
    select false,
      coalesce(
        pg_catalog.jsonb_agg(
          (link_row.value - 'can_remove')
            || pg_catalog.jsonb_build_object('can_remove',false)
          order by link_row.position
        ),
        '[]'::jsonb
      )
    from public.get_task_work_links_pre13c(p_task_id) as prior_row
    cross join lateral pg_catalog.jsonb_array_elements(prior_row.links)
      with ordinality as link_row(value,position);
    return;
  end if;

  return query select * from public.get_task_work_links_pre13c(p_task_id);
end $$;
alter function public.get_task_work_links(uuid) owner to postgres;
revoke all on function public.get_task_work_links(uuid) from public,anon,authenticated;
grant execute on function public.get_task_work_links(uuid) to authenticated;

alter function public.list_task_comments(uuid,integer,timestamptz,uuid)
rename to list_task_comments_pre13c;
revoke all on function public.list_task_comments_pre13c(uuid,integer,timestamptz,uuid)
from public,anon,authenticated;
create function public.list_task_comments(
  p_task_id uuid,p_limit integer default 25,
  p_before_created_at timestamptz default null,p_before_id uuid default null
)
returns table (
  out_id uuid,out_body text,out_is_heads_up boolean,out_created_at timestamptz,
  out_edited_at timestamptz,out_author_id uuid,out_author_full_name text,
  out_author_avatar_url text,out_mentions jsonb,out_can_edit boolean,
  out_can_delete boolean,out_has_more boolean
)
language plpgsql stable security definer set search_path=''
as $$
declare v_has_draft_write_scope boolean;
begin
  v_has_draft_write_scope := public.draft_task_write_allowed_for_user(p_task_id,auth.uid());
  return query
  select prior_row.out_id,prior_row.out_body,prior_row.out_is_heads_up,
    prior_row.out_created_at,prior_row.out_edited_at,prior_row.out_author_id,
    prior_row.out_author_full_name,prior_row.out_author_avatar_url,
    prior_row.out_mentions,
    case when v_has_draft_write_scope is true then prior_row.out_can_edit else false end,
    case when v_has_draft_write_scope is true then prior_row.out_can_delete else false end,
    prior_row.out_has_more
  from public.list_task_comments_pre13c(
    p_task_id,p_limit,p_before_created_at,p_before_id
  ) as prior_row;
end $$;
alter function public.list_task_comments(uuid,integer,timestamptz,uuid) owner to postgres;
revoke all on function public.list_task_comments(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.list_task_comments(uuid,integer,timestamptz,uuid) to authenticated;

alter function public.list_task_comment_mention_candidates(uuid,text,integer)
rename to list_task_comment_mention_candidates_pre13c;
revoke all on function public.list_task_comment_mention_candidates_pre13c(uuid,text,integer)
from public,anon,authenticated;
create function public.list_task_comment_mention_candidates(
  p_task_id uuid,p_search text default null,p_limit integer default 20
)
returns table(out_id uuid,out_full_name text,out_avatar_url text)
language plpgsql stable security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then
    return;
  end if;
  return query select *
  from public.list_task_comment_mention_candidates_pre13c(p_task_id,p_search,p_limit);
end $$;
alter function public.list_task_comment_mention_candidates(uuid,text,integer) owner to postgres;
revoke all on function public.list_task_comment_mention_candidates(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_task_comment_mention_candidates(uuid,text,integer) to authenticated;

-- Trigger names and bindings are unchanged. Both guards reject out-of-scope
-- Draft writes before locks and repeat that decision after their lock chain.
create or replace function public.guard_task_work_link_writes()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_task_id uuid := case when TG_OP='INSERT' then new.task_id else old.task_id end;
  v_event_id uuid; v_event_status text; v_primary_assignees uuid[];
  v_assist_assignees uuid[]; v_caller_role text; v_link_count integer;
begin
  if TG_OP='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if public.draft_task_write_allowed_for_user(v_task_id,auth.uid()) is not true then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  select task_row.event_id,task_row.primary_assignees,task_row.assist_assignees
  into v_event_id,v_primary_assignees,v_assist_assignees
  from public.tasks as task_row where task_row.id=v_task_id for no key update;
  if not found then raise exception using errcode='CCL02',message='Task not found.'; end if;
  select event_row.status into v_event_status from public.events as event_row
  where event_row.id=v_event_id for share;
  if not found then raise exception using errcode='CCL02',message='The task parent event could not be verified.'; end if;
  if not exists(
    select 1 from public.tasks as task_row
    join public.events as event_row on event_row.id=task_row.event_id
    where task_row.id=v_task_id and task_row.event_id=v_event_id
      and event_row.status=v_event_status
  ) then
    raise exception using errcode='CCL02',message='The task parent event changed during the work-link write.';
  end if;
  if public.draft_task_write_allowed_for_user(v_task_id,auth.uid()) is not true then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  if v_event_status='Archived' then
    raise exception using errcode='CCL03',message='Work links in Archived events are read-only.';
  end if;
  select user_row.role into v_caller_role from public.users as user_row
  where user_row.id=auth.uid() and user_row.is_active is true;
  if not found or public.task_content_access(v_task_id)<>'real' then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  if TG_OP='INSERT' then
    if not coalesce(auth.uid()=any(v_primary_assignees),false)
       and not coalesce(auth.uid()=any(v_assist_assignees),false) then
      raise exception using errcode='42501',message='Only an active task assignee can add work links.';
    end if;
    select pg_catalog.count(*) into v_link_count from public.task_work_links as link_row
    where link_row.task_id=v_task_id;
    if v_link_count>=20 then
      raise exception using errcode='CCL04',message='A task can have at most 20 work links.';
    end if;
    new.created_by:=auth.uid(); return new;
  end if;
  if old.created_by is distinct from auth.uid()
     and v_caller_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only the link creator, an active Admin, or an active Co-Admin can remove this work link.';
  end if;
  return old;
end $$;
alter function public.guard_task_work_link_writes() owner to postgres;
revoke all on function public.guard_task_work_link_writes() from public,anon,authenticated;

create or replace function public.guard_task_comment_writes()
returns trigger language plpgsql volatile security definer set search_path=''
as $$
declare
  v_caller_id uuid:=auth.uid(); v_caller_role text;
  v_task_id uuid:=case when TG_OP='INSERT' then new.task_id else old.task_id end;
  v_event_id uuid; v_event_status text; v_body text; v_mentions uuid[];
begin
  if TG_OP='UPDATE' and new.task_id is distinct from old.task_id then
    raise exception using errcode='CCC10',message='A comment cannot be moved to another task.';
  end if;
  if public.draft_task_write_allowed_for_user(v_task_id,v_caller_id) is not true then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  select task_row.event_id into v_event_id from public.tasks as task_row
  where task_row.id=v_task_id for no key update;
  if not found then
    if TG_OP='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
    raise exception using errcode='40001',message='The comment task changed. Refresh and try again.';
  end if;
  select event_row.status into v_event_status from public.events as event_row
  where event_row.id=v_event_id for share;
  if not found or not exists(
    select 1 from public.tasks as task_row
    where task_row.id=v_task_id and task_row.event_id=v_event_id
  ) then
    raise exception using errcode='40001',message='The comment task changed. Refresh and try again.';
  end if;
  if public.draft_task_write_allowed_for_user(v_task_id,v_caller_id) is not true then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  if public.task_content_access(v_task_id)<>'real' then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  if v_event_status='Archived' then
    raise exception using errcode='CCC05',message='Archived task comments are read-only.';
  end if;
  select user_row.role into v_caller_role from public.users as user_row
  where user_row.id=v_caller_id and user_row.is_active is true;
  if not found then raise exception using errcode='CCC01',message='The task comments are unavailable.'; end if;
  if TG_OP='DELETE' then
    if old.created_by is distinct from v_caller_id and v_caller_role<>'Admin' then
      raise exception using errcode='CCC07',message='You cannot delete this comment.';
    end if;
    return old;
  end if;
  v_body:=public.task_comment_trim_body(new.body);
  if v_body is null or pg_catalog.char_length(v_body) not between 1 and 4000
     or new.is_heads_up is null then
    raise exception using errcode='CCC03',message='A comment must contain between 1 and 4000 characters.';
  end if;
  v_mentions:=public.normalize_task_comment_mentions(new.mentioned_user_ids);
  if public.task_comment_mentions_are_valid(v_task_id,v_mentions) is not true then
    raise exception using errcode='CCC04',message='Every mentioned user must be an available active user with full task access.';
  end if;
  new.body:=v_body; new.mentioned_user_ids:=v_mentions;
  if TG_OP='INSERT' then
    new.created_by:=v_caller_id; new.created_at:=pg_catalog.clock_timestamp();
    new.edited_at:=null; return new;
  end if;
  if old.created_by is distinct from v_caller_id then
    raise exception using errcode='CCC06',message='Only the comment author can edit it.';
  end if;
  if (new.id,new.task_id,new.created_by,new.created_at)
     is distinct from (old.id,old.task_id,old.created_by,old.created_at) then
    raise exception using errcode='CCC10',message='Comment identity and creation fields are immutable.';
  end if;
  if (new.body,new.is_heads_up,new.mentioned_user_ids)
     is not distinct from (old.body,old.is_heads_up,old.mentioned_user_ids) then
    raise exception using errcode='CCC09',message='Make a change before saving the comment.';
  end if;
  new.edited_at:=pg_catalog.clock_timestamp(); return new;
end $$;
alter function public.guard_task_comment_writes() owner to postgres;
revoke all on function public.guard_task_comment_writes() from public,anon,authenticated;

-- Mention validation intentionally remains access-based, not writer-based:
-- a real-content Draft viewer may be mentioned, while masked/hidden users may not.
