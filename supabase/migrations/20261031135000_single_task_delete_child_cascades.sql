-- Phase 4B pre-13b correction: Batch 13d's child guards recognize the exact
-- whole-event deletion context, but not an ordinary ON DELETE CASCADE from one
-- approved task deletion. Keep that concern separate from phase completion.

create table ceit_connect_private.task_delete_cascade_context (
  transaction_id xid8 not null,
  task_id uuid not null,
  event_id uuid not null,
  primary key (transaction_id, task_id)
);

alter table ceit_connect_private.task_delete_cascade_context enable row level security;
revoke all on ceit_connect_private.task_delete_cascade_context
from public, anon, authenticated, service_role;

create function ceit_connect_private.task_delete_context_matches(p_task_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select p_task_id is not null and exists (
    select 1
    from ceit_connect_private.task_delete_cascade_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id()
      and context_row.task_id = p_task_id
  );
$$;

alter function ceit_connect_private.task_delete_context_matches(uuid)
owner to postgres;
revoke all on function ceit_connect_private.task_delete_context_matches(uuid)
from public, anon, authenticated, service_role;

create function ceit_connect_private.open_task_delete_cascade_context()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into ceit_connect_private.task_delete_cascade_context (
    transaction_id, task_id, event_id
  ) values (
    pg_catalog.pg_current_xact_id(), old.id, old.event_id
  ) on conflict (transaction_id, task_id) do nothing;
  return old;
end;
$$;

alter function ceit_connect_private.open_task_delete_cascade_context()
owner to postgres;
revoke all on function ceit_connect_private.open_task_delete_cascade_context()
from public, anon, authenticated, service_role;

create function ceit_connect_private.close_task_delete_cascade_context()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from ceit_connect_private.task_delete_cascade_context as context_row
  where context_row.transaction_id = pg_catalog.pg_current_xact_id()
    and context_row.task_id = old.id
    and context_row.event_id = old.event_id;
  return null;
end;
$$;

alter function ceit_connect_private.close_task_delete_cascade_context()
owner to postgres;
revoke all on function ceit_connect_private.close_task_delete_cascade_context()
from public, anon, authenticated, service_role;

drop trigger if exists tasks_b0_open_task_delete_cascade_context on public.tasks;
create trigger tasks_b0_open_task_delete_cascade_context
before delete on public.tasks
for each row execute function ceit_connect_private.open_task_delete_cascade_context();

drop trigger if exists tasks_close_task_delete_cascade_context on public.tasks;
create constraint trigger tasks_close_task_delete_cascade_context
after delete on public.tasks
deferrable initially deferred
for each row execute function ceit_connect_private.close_task_delete_cascade_context();

create or replace function public.guard_task_work_link_writes()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_task_id uuid := case when TG_OP='INSERT' then new.task_id else old.task_id end;
  v_event_id uuid; v_event_status text; v_primary_assignees uuid[];
  v_assist_assignees uuid[]; v_caller_role text; v_link_count integer;
begin
  if TG_OP='DELETE'
     and not exists (select 1 from public.tasks as task_row where task_row.id=old.task_id)
     and (
       ceit_connect_private.task_delete_context_matches(old.task_id)
       or (
         pg_catalog.pg_trigger_depth()>1
         and exists (
           select 1
           from ceit_connect_private.event_delete_cascade_context as context_row
           where context_row.transaction_id=pg_catalog.pg_current_xact_id()
         )
       )
     ) then return old; end if;
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
revoke all on function public.guard_task_work_link_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

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
  if TG_OP='DELETE'
     and not exists (select 1 from public.tasks as task_row where task_row.id=old.task_id)
     and (
       ceit_connect_private.task_delete_context_matches(old.task_id)
       or (
         pg_catalog.pg_trigger_depth()>1
         and exists (
           select 1
           from ceit_connect_private.event_delete_cascade_context as context_row
           where context_row.transaction_id=pg_catalog.pg_current_xact_id()
         )
       )
     ) then return old; end if;
  if public.draft_task_write_allowed_for_user(v_task_id,v_caller_id) is not true then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  select task_row.event_id into v_event_id from public.tasks as task_row
  where task_row.id=v_task_id for no key update;
  if not found then
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
revoke all on function public.guard_task_comment_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_task_volunteer_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
begin
  if TG_OP = 'UPDATE' then
    raise exception using
      errcode = 'CCB09',
      message = 'Volunteer offers cannot be updated; task_id is immutable.';
  end if;
  select task_row.event_id into v_event_id
  from public.tasks as task_row
  where task_row.id = v_task_id
  for no key update;
  if not found then
    if TG_OP='DELETE' and (
      ceit_connect_private.task_delete_context_matches(old.task_id)
      or (
        pg_catalog.pg_trigger_depth()>1
        and exists (
          select 1
          from ceit_connect_private.event_delete_cascade_context as context_row
          where context_row.transaction_id=pg_catalog.pg_current_xact_id()
        )
      )
    ) then return old; end if;
    raise exception using errcode='CCB01',message='The volunteer task is unavailable.';
  end if;
  select event_row.status into v_event_status
  from public.events as event_row
  where event_row.id=v_event_id for share;
  if not found or not exists (
    select 1 from public.tasks as task_row
    where task_row.id=v_task_id and task_row.event_id=v_event_id
  ) then
    raise exception using errcode='40001',message='The volunteer task changed. Refresh and try again.';
  end if;
  if v_event_status='Archived' then
    raise exception using errcode='CCB08',message='Volunteer offers in Archived events are read-only.';
  end if;
  if TG_OP='INSERT' and v_event_status<>'Active' then
    raise exception using errcode='CCB02',message='Volunteer offers are available only for Active events.';
  end if;
  if TG_OP='INSERT' then return new; end if;
  return old;
end;
$$;

alter function public.guard_task_volunteer_writes() owner to postgres;
revoke all on function public.guard_task_volunteer_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;
