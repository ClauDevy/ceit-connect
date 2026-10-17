-- Phase 4 Step 4: RLS-backed Google Drive work links for task detail.
-- Existing task readers, content helpers, policies, and archive guards remain
-- unchanged. Authenticated callers use only the narrow functions below.

create function public.task_work_link_url_is_canonical(p_url text)
returns boolean
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select p_url ~
    '^https://(drive\.google\.com/(file/d/[A-Za-z0-9_-]{1,200}/view|drive/folders/[A-Za-z0-9_-]{1,200})|docs\.google\.com/(document|spreadsheets|presentation)/d/[A-Za-z0-9_-]{1,200}/edit)(\?resourcekey=[A-Za-z0-9_-]{1,200})?$';
$$;

revoke all on function public.task_work_link_url_is_canonical(text)
from public, anon, authenticated;

create table public.task_work_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null
    references public.tasks(id) on delete cascade,
  name text,
  url text not null,
  created_by uuid
    references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint task_work_links_name_valid check (
    name is null
    or (
      name = btrim(name)
      and char_length(name) between 1 and 120
    )
  ),
  constraint task_work_links_url_valid check (
    url = btrim(url)
    and char_length(url) <= 512
    and public.task_work_link_url_is_canonical(url)
  ),
  constraint task_work_links_task_url_unique unique (task_id, url)
);

create index task_work_links_task_created_idx
on public.task_work_links (task_id, created_at, id);

alter table public.task_work_links enable row level security;

revoke all on table public.task_work_links
from public, anon, authenticated;

-- Direct authenticated table access is intentionally deny-by-default: RLS is
-- enabled and there are no policies. The reader and mutators below are the only
-- authenticated paths, so every decision can use task_content_access().

create function public.guard_task_work_link_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_caller_role text;
  v_link_count integer;
begin
  -- A task FK cascade runs after the task row has been deleted, so that row can
  -- no longer be locked here. The task's own BEFORE DELETE archive guard has
  -- already locked and validated its parent. Only that nested trigger path may
  -- skip the child-level lookup; ordinary RPC deletes have trigger depth 1.
  if TG_OP = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  -- FOR NO KEY UPDATE serializes the per-task cap. It also follows the same
  -- task-row-before-event order as existing task update/move paths.
  select
    t.event_id,
    t.primary_assignees,
    t.assist_assignees
  into
    v_event_id,
    v_primary_assignees,
    v_assist_assignees
  from public.tasks t
  where t.id = v_task_id
  for no key update;

  if not found then
    raise exception using
      errcode = 'CCL02',
      message = 'Task not found.';
  end if;

  select e.status
  into v_event_status
  from public.events e
  where e.id = v_event_id
  for share;

  if not found then
    raise exception using
      errcode = 'CCL02',
      message = 'The task parent event could not be verified.';
  end if;

  -- Re-read both the relationship and status after all locks are held.
  if not exists (
    select 1
    from public.tasks t
    join public.events e on e.id = t.event_id
    where t.id = v_task_id
      and t.event_id = v_event_id
      and e.status = v_event_status
  ) then
    raise exception using
      errcode = 'CCL02',
      message = 'The task parent event changed during the work-link write.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCL03',
      message = 'Work links in Archived events are read-only.';
  end if;

  select u.role
  into v_caller_role
  from public.users u
  where u.id = auth.uid()
    and u.is_active is true;

  if not found
     or public.task_content_access(v_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'Work-link access is not allowed.';
  end if;

  if TG_OP = 'INSERT' then
    if not coalesce(auth.uid() = any(v_primary_assignees), false)
       and not coalesce(auth.uid() = any(v_assist_assignees), false) then
      raise exception using
        errcode = '42501',
        message = 'Only an active task assignee can add work links.';
    end if;

    select count(*)
    into v_link_count
    from public.task_work_links l
    where l.task_id = v_task_id;

    if v_link_count >= 20 then
      raise exception using
        errcode = 'CCL04',
        message = 'A task can have at most 20 work links.';
    end if;

    new.created_by := auth.uid();
    return new;
  end if;

  if old.created_by is distinct from auth.uid()
     and v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only the link creator, an active Admin, or an active Co-Admin can remove this work link.';
  end if;

  return old;
end;
$$;

revoke all on function public.guard_task_work_link_writes()
from public, anon, authenticated;

create trigger task_work_links_guard_writes
before insert or delete on public.task_work_links
for each row
execute function public.guard_task_work_link_writes();

-- User profiles are normally deactivated, not deleted. If a profile is removed,
-- its FK may set created_by to null without making any other link field mutable.
create function public.guard_task_work_link_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.created_by is not null
     and new.created_by is null
     and (
       new.id,
       new.task_id,
       new.name,
       new.url,
       new.created_at
     ) is not distinct from (
       old.id,
       old.task_id,
       old.name,
       old.url,
       old.created_at
     ) then
    return new;
  end if;

  raise exception using
    errcode = 'CCL05',
    message = 'Work links cannot be updated.';
end;
$$;

revoke all on function public.guard_task_work_link_updates()
from public, anon, authenticated;

create trigger task_work_links_reject_updates
before update on public.task_work_links
for each row
execute function public.guard_task_work_link_updates();

create function public.get_task_work_links(p_task_id uuid)
returns table (
  can_add boolean,
  links jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_can_add boolean;
begin
  if v_caller_id is null
     or public.task_content_access(p_task_id) <> 'real' then
    return;
  end if;

  select
    u.role,
    e.status,
    t.primary_assignees,
    t.assist_assignees
  into
    v_caller_role,
    v_event_status,
    v_primary_assignees,
    v_assist_assignees
  from public.users u
  join public.tasks t on t.id = p_task_id
  join public.events e on e.id = t.event_id
  where u.id = v_caller_id
    and u.is_active is true;

  if not found then
    return;
  end if;

  v_can_add := v_event_status <> 'Archived'
    and (
      coalesce(v_caller_id = any(v_primary_assignees), false)
      or coalesce(v_caller_id = any(v_assist_assignees), false)
    );

  return query
  select
    v_can_add,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', l.id,
          'name', l.name,
          'url', l.url,
          'created_at', l.created_at,
          'can_remove',
            v_event_status <> 'Archived'
            and (
              l.created_by = v_caller_id
              or v_caller_role in ('Admin', 'Co-Admin')
            )
        )
        order by l.created_at, l.id
      ) filter (where l.id is not null),
      '[]'::jsonb
    )
  from public.task_work_links l
  where l.task_id = p_task_id;
end;
$$;

revoke all on function public.get_task_work_links(uuid)
from public, anon, authenticated;
grant execute on function public.get_task_work_links(uuid)
to authenticated;

create function public.add_task_work_link(
  p_task_id uuid,
  p_name text,
  p_url text
)
returns table (
  id uuid,
  name text,
  url text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_url text := btrim(p_url);
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  if p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'Task ID is required.';
  end if;

  if v_name is not null and char_length(v_name) > 120 then
    raise exception using
      errcode = '22023',
      message = 'Work-link name must be 120 characters or fewer.';
  end if;

  if v_url is null
     or char_length(v_url) > 512
     or not public.task_work_link_url_is_canonical(v_url) then
    raise exception using
      errcode = '22023',
      message = 'Work-link URL must be a canonical HTTPS Google Drive, Docs, Sheets, or Slides URL.';
  end if;

  return query
  insert into public.task_work_links (task_id, name, url, created_by)
  values (p_task_id, v_name, v_url, auth.uid())
  returning
    task_work_links.id,
    task_work_links.name,
    task_work_links.url,
    task_work_links.created_at;
end;
$$;

revoke all on function public.add_task_work_link(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.add_task_work_link(uuid, text, text)
to authenticated;

create function public.remove_task_work_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_event_id uuid;
  v_event_status text;
  v_caller_role text;
  v_creator_id uuid;
  v_affected integer;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required.';
  end if;

  select l.task_id
  into v_task_id
  from public.task_work_links l
  where l.id = p_link_id;

  if not found then
    raise exception using
      errcode = 'CCL06',
      message = 'Work link not found.';
  end if;

  -- Pre-lock the task before issuing DELETE so this narrow path never locks the
  -- child row and then waits on a task deletion/move holding the task row.
  select t.event_id
  into v_event_id
  from public.tasks t
  where t.id = v_task_id
  for no key update;

  if not found then
    raise exception using
      errcode = 'CCL02',
      message = 'Task not found.';
  end if;

  select e.status
  into v_event_status
  from public.events e
  where e.id = v_event_id
  for share;

  if not found or v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCL03',
      message = 'Work links in Archived events are read-only.';
  end if;

  select u.role, l.created_by
  into v_caller_role, v_creator_id
  from public.users u
  join public.task_work_links l
    on l.id = p_link_id
   and l.task_id = v_task_id
  where u.id = auth.uid()
    and u.is_active is true;

  if not found
     or public.task_content_access(v_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'Work-link access is not allowed.';
  end if;

  if v_creator_id is distinct from auth.uid()
     and v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only the link creator, an active Admin, or an active Co-Admin can remove this work link.';
  end if;

  delete from public.task_work_links l
  where l.id = p_link_id
    and l.task_id = v_task_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCL06',
      message = 'Work link not found.';
  end if;
end;
$$;

revoke all on function public.remove_task_work_link(uuid)
from public, anon, authenticated;
grant execute on function public.remove_task_work_link(uuid)
to authenticated;
