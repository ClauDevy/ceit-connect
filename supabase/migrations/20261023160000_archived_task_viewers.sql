-- Phase 4 Step 7B-DB: archive-only late sharing for confidential tasks.
-- Archived task/event rows remain frozen. This migration writes only the
-- separate deny-by-default archived_task_viewers child table.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Step 7B must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

create table public.archived_task_viewers (
  task_id uuid not null
    references public.tasks(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  granted_by uuid not null
    references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  constraint archived_task_viewers_pkey primary key (task_id, user_id)
);

alter table public.archived_task_viewers owner to postgres;

create index archived_task_viewers_user_task_idx
on public.archived_task_viewers (user_id, task_id);

create index archived_task_viewers_grantor_history_idx
on public.archived_task_viewers (
  granted_by,
  created_at desc,
  task_id,
  user_id
);

alter table public.archived_task_viewers enable row level security;

revoke all on table public.archived_task_viewers
from public, anon, authenticated;

-- There are deliberately no permissive policies. Authenticated reads and
-- writes are available only through the fixed-shape reader and narrow
-- mutators below.

create function public.guard_archived_task_viewer_writes()
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
      errcode = 'CCS07',
      message = 'Archive-only task shares cannot be updated.';
  end if;

  -- A valid row can exist only below an Archived task. Archived tasks and
  -- their parent events cannot be deleted, so there is no legitimate missing-
  -- task cascade exception: a missing parent always fails closed.
  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is unavailable for this task.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1
    from public.tasks task_row
    where task_row.id = v_task_id
      and task_row.event_id = v_event_id
  ) then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_event_status <> 'Archived' then
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is unavailable for this task.';
  end if;

  if TG_OP = 'INSERT' then
    new.granted_by := auth.uid();
    return new;
  end if;

  return old;
end;
$$;

alter function public.guard_archived_task_viewer_writes()
owner to postgres;

revoke all on function public.guard_archived_task_viewer_writes()
from public, anon, authenticated;

create trigger archived_task_viewers_guard_writes
before insert or update or delete on public.archived_task_viewers
for each row
execute function public.guard_archived_task_viewer_writes();

-- Preserve the complete current access contract while adding one explicit
-- Archived-only source of real access for confidential tasks.
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

  if not found then
    return 'hidden';
  end if;

  select
    event_row.status,
    task_row.committee_id,
    task_row.is_confidential,
    task_row.primary_assignees,
    task_row.assist_assignees,
    task_row.allowed_viewers
  into
    v_event_status,
    v_task_committee_id,
    v_is_confidential,
    v_primary_assignees,
    v_assist_assignees,
    v_allowed_viewers
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found then
    return 'hidden';
  end if;

  if v_event_status = 'Draft' then
    if v_user_role = 'Admin'
       or (
         v_user_role = 'Co-Admin'
         and v_user_committee_id = v_task_committee_id
       ) then
      return 'real';
    end if;

    return 'hidden';
  end if;

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

alter function public.task_content_access_for_user(uuid, uuid)
owner to postgres;

revoke all on function public.task_content_access_for_user(uuid, uuid)
from public, anon, authenticated;

create function public.grant_archived_task_viewer(
  p_task_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_discovered_event_id uuid;
  v_discovered_committee_id uuid;
  v_task_event_id uuid;
  v_task_committee_id uuid;
  v_task_is_confidential boolean;
  v_event_status text;
  v_affected integer;
begin
  select caller.role, caller.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users caller
  where caller.id = v_caller_id
    and caller.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = 'CCS01',
      message = 'Archive-only sharing is unavailable.';
  end if;

  select task_row.event_id, task_row.committee_id
  into v_discovered_event_id, v_discovered_committee_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found
     or (
       v_caller_role = 'Co-Admin'
       and v_caller_committee_id is distinct from v_discovered_committee_id
     ) then
    raise exception using
      errcode = 'CCS01',
      message = 'Archive-only sharing is unavailable.';
  end if;

  select
    task_row.event_id,
    task_row.committee_id,
    task_row.is_confidential
  into
    v_task_event_id,
    v_task_committee_id,
    v_task_is_confidential
  from public.tasks task_row
  where task_row.id = p_task_id
  for no key update;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_task_event_id
  for share;

  if not found
     or v_task_event_id is distinct from v_discovered_event_id
     or v_task_committee_id is distinct from v_discovered_committee_id
     or not exists (
       select 1
       from public.tasks task_row
       where task_row.id = p_task_id
         and task_row.event_id = v_task_event_id
         and task_row.committee_id = v_task_committee_id
     ) then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if not exists (
    select 1
    from public.users caller
    where caller.id = v_caller_id
      and caller.is_active is true
      and (
        caller.role = 'Admin'
        or (
          caller.role = 'Co-Admin'
          and caller.committee_id = v_task_committee_id
        )
      )
  ) then
    raise exception using
      errcode = '40001',
      message = 'Your access changed. Refresh and try again.';
  end if;

  if v_event_status <> 'Archived'
     or v_task_is_confidential is not true then
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is available only for Archived confidential tasks.';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = 'CCS03',
      message = 'The selected active user is unavailable.';
  end if;

  perform 1
  from public.users target
  where target.id = p_user_id
    and target.is_active is true
  for share;

  if not found then
    raise exception using
      errcode = 'CCS03',
      message = 'The selected active user is unavailable.';
  end if;

  if public.task_content_access_for_user(p_task_id, p_user_id) = 'real' then
    raise exception using
      errcode = 'CCS04',
      message = 'The selected user already has full task access.';
  end if;

  begin
    insert into public.archived_task_viewers (
      task_id,
      user_id,
      granted_by
    )
    values (
      p_task_id,
      p_user_id,
      v_caller_id
    );

    get diagnostics v_affected = row_count;
  exception
    when unique_violation then
      raise exception using
        errcode = 'CCS04',
        message = 'The selected user already has full task access.';
  end;

  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The archive-only share changed. Refresh and try again.';
  end if;
end;
$$;

alter function public.grant_archived_task_viewer(uuid, uuid)
owner to postgres;

revoke all on function public.grant_archived_task_viewer(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.grant_archived_task_viewer(uuid, uuid)
to authenticated;

create function public.revoke_archived_task_viewer(
  p_task_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_discovered_event_id uuid;
  v_discovered_committee_id uuid;
  v_task_event_id uuid;
  v_task_committee_id uuid;
  v_task_is_confidential boolean;
  v_event_status text;
  v_affected integer;
begin
  select caller.role, caller.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users caller
  where caller.id = v_caller_id
    and caller.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = 'CCS01',
      message = 'Archive-only sharing is unavailable.';
  end if;

  select task_row.event_id, task_row.committee_id
  into v_discovered_event_id, v_discovered_committee_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found
     or (
       v_caller_role = 'Co-Admin'
       and v_caller_committee_id is distinct from v_discovered_committee_id
     ) then
    raise exception using
      errcode = 'CCS01',
      message = 'Archive-only sharing is unavailable.';
  end if;

  select
    task_row.event_id,
    task_row.committee_id,
    task_row.is_confidential
  into
    v_task_event_id,
    v_task_committee_id,
    v_task_is_confidential
  from public.tasks task_row
  where task_row.id = p_task_id
  for no key update;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_task_event_id
  for share;

  if not found
     or v_task_event_id is distinct from v_discovered_event_id
     or v_task_committee_id is distinct from v_discovered_committee_id
     or not exists (
       select 1
       from public.tasks task_row
       where task_row.id = p_task_id
         and task_row.event_id = v_task_event_id
         and task_row.committee_id = v_task_committee_id
     ) then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if not exists (
    select 1
    from public.users caller
    where caller.id = v_caller_id
      and caller.is_active is true
      and (
        caller.role = 'Admin'
        or (
          caller.role = 'Co-Admin'
          and caller.committee_id = v_task_committee_id
        )
      )
  ) then
    raise exception using
      errcode = '40001',
      message = 'Your access changed. Refresh and try again.';
  end if;

  if v_event_status <> 'Archived'
     or v_task_is_confidential is not true then
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is available only for Archived confidential tasks.';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = 'CCS05',
      message = 'The archive-only share does not exist.';
  end if;

  delete from public.archived_task_viewers archive_viewer
  where archive_viewer.task_id = p_task_id
    and archive_viewer.user_id = p_user_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCS05',
      message = 'The archive-only share does not exist.';
  end if;
end;
$$;

alter function public.revoke_archived_task_viewer(uuid, uuid)
owner to postgres;

revoke all on function public.revoke_archived_task_viewer(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.revoke_archived_task_viewer(uuid, uuid)
to authenticated;

create function public.get_archived_task_share_controls(
  p_task_id uuid,
  p_search text default null
)
returns table (
  out_id uuid,
  out_full_name text,
  out_avatar_url text,
  out_is_archive_only boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_task_event_id uuid;
  v_task_committee_id uuid;
  v_task_is_confidential boolean;
  v_event_status text;
  v_search text;
begin
  select caller.role, caller.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users caller
  where caller.id = v_caller_id
    and caller.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = 'CCS01',
      message = 'Archive-only sharing is unavailable.';
  end if;

  select
    task_row.event_id,
    task_row.committee_id,
    task_row.is_confidential
  into
    v_task_event_id,
    v_task_committee_id,
    v_task_is_confidential
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found
     or (
       v_caller_role = 'Co-Admin'
       and v_caller_committee_id is distinct from v_task_committee_id
     ) then
    raise exception using
      errcode = 'CCS01',
      message = 'Archive-only sharing is unavailable.';
  end if;

  v_search := pg_catalog.btrim(p_search);
  if char_length(v_search) > 100 then
    raise exception using
      errcode = 'CCS06',
      message = 'Archive-only viewer search is invalid.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_task_event_id;

  if not found
     or v_event_status <> 'Archived'
     or v_task_is_confidential is not true then
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is available only for Archived confidential tasks.';
  end if;

  return query
  select
    candidate.id,
    candidate.full_name,
    candidate.avatar_url,
    exists (
      select 1
      from public.archived_task_viewers archive_viewer
      where archive_viewer.task_id = p_task_id
        and archive_viewer.user_id = candidate.id
    )
  from public.users candidate
  where candidate.is_active is true
    and (
      v_search is null
      or v_search = ''
      or pg_catalog.strpos(
        pg_catalog.lower(candidate.full_name),
        pg_catalog.lower(v_search)
      ) > 0
    )
    and (
      exists (
        select 1
        from public.archived_task_viewers archive_viewer
        where archive_viewer.task_id = p_task_id
          and archive_viewer.user_id = candidate.id
      )
      or public.task_content_access_for_user(
        p_task_id,
        candidate.id
      ) <> 'real'
    )
  order by candidate.full_name, candidate.id
  limit 20;
end;
$$;

alter function public.get_archived_task_share_controls(uuid, text)
owner to postgres;

revoke all on function public.get_archived_task_share_controls(uuid, text)
from public, anon, authenticated;

grant execute on function public.get_archived_task_share_controls(uuid, text)
to authenticated;

-- Copy the Step 3 task-detail reader unchanged except for the confidential
-- access_list source. Archived real-content viewers receive a deterministic,
-- de-duplicated union of ordinary and archive-only viewers.
create or replace function public.get_task_detail(p_task_id uuid)
returns table (
  id uuid,
  event_id uuid,
  event_name text,
  event_status text,
  title text,
  description text,
  phase text,
  status text,
  effective_priority text,
  task_type text,
  due_date timestamptz,
  call_time timestamptz,
  end_time timestamptz,
  created_at timestamptz,
  committee_id uuid,
  committee_name text,
  primary_assignees jsonb,
  assist_assignees jsonb,
  is_confidential boolean,
  is_masked boolean,
  has_dependency boolean,
  is_blocked boolean,
  dependency_label text,
  access_list jsonb
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_access text;
  v_as_of timestamptz := statement_timestamp();
begin
  if v_caller_id is null then
    return;
  end if;

  perform 1
  from public.users u
  where u.id = v_caller_id
    and u.is_active is true;

  if not found then
    return;
  end if;

  v_access := public.task_content_access(p_task_id);

  if v_access = 'hidden' then
    return;
  end if;

  if v_access = 'masked' then
    return query
    select
      t.id,
      null::uuid,
      null::text,
      null::text,
      'Confidential Task'::text,
      null::text,
      t.phase,
      t.status,
      null::text,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz,
      null::timestamptz,
      null::uuid,
      null::text,
      '[]'::jsonb,
      '[]'::jsonb,
      null::boolean,
      true,
      null::boolean,
      null::boolean,
      null::text,
      '[]'::jsonb
    from public.tasks t
    where t.id = p_task_id;
    return;
  end if;

  return query
  with task_row as materialized (
    select
      t.id,
      t.event_id,
      e.name as event_name,
      e.status as event_status,
      t.title,
      t.description,
      t.phase,
      t.status,
      t.priority,
      t.task_type,
      t.due_date,
      t.call_time,
      t.end_time,
      t.created_at,
      t.committee_id,
      c.name as committee_name,
      t.primary_assignees,
      t.assist_assignees,
      t.is_confidential,
      t.allowed_viewers,
      dependency.id as dependency_id,
      dependency.title as dependency_title,
      dependency.status as dependency_status
    from public.tasks t
    join public.events e on e.id = t.event_id
    join public.committees c on c.id = t.committee_id
    left join public.tasks dependency on dependency.id = t.depends_on_task_id
    where t.id = p_task_id
  ),
  detail_row as materialized (
    select
      tr.*,
      case
        when tr.dependency_id is null then null
        else public.task_content_access(tr.dependency_id)
      end as dependency_access
    from task_row tr
  )
  select
    dr.id,
    dr.event_id,
    dr.event_name,
    dr.event_status,
    dr.title,
    dr.description,
    dr.phase,
    dr.status,
    public.calculate_effective_task_priority(
      dr.priority,
      dr.due_date,
      v_as_of,
      dr.status
    ),
    dr.task_type,
    dr.due_date,
    dr.call_time,
    dr.end_time,
    dr.created_at,
    dr.committee_id,
    dr.committee_name,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignee.id,
            'full_name', u.full_name,
            'avatar_url', u.avatar_url
          )
          order by assignee.position
        )
        from unnest(dr.primary_assignees)
          with ordinality as assignee(id, position)
        left join public.users u on u.id = assignee.id
      ),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', assignee.id,
            'full_name', u.full_name,
            'avatar_url', u.avatar_url
          )
          order by assignee.position
        )
        from unnest(dr.assist_assignees)
          with ordinality as assignee(id, position)
        left join public.users u on u.id = assignee.id
      ),
      '[]'::jsonb
    ),
    dr.is_confidential,
    false,
    dr.dependency_id is not null,
    dr.dependency_id is not null
      and dr.dependency_status <> 'Completed',
    case dr.dependency_access
      when 'real' then dr.dependency_title
      when 'masked' then 'Confidential Task'
      else null
    end,
    case
      when dr.is_confidential then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', viewer.id,
              'full_name', viewer.full_name,
              'avatar_url', viewer.avatar_url
            )
            order by viewer.source_order, viewer.position, viewer.id
          )
          from (
            select distinct on (u.id)
              u.id,
              u.full_name,
              u.avatar_url,
              candidate.source_order,
              candidate.position
            from (
              select
                allowed.id,
                0::integer as source_order,
                allowed.position::bigint as position
              from unnest(dr.allowed_viewers)
                with ordinality as allowed(id, position)

              union all

              select
                archive_viewer.user_id,
                1::integer,
                row_number() over (
                  order by archive_viewer.created_at, archive_viewer.user_id
                )::bigint
              from public.archived_task_viewers archive_viewer
              where dr.event_status = 'Archived'
                and archive_viewer.task_id = dr.id
            ) candidate
            join public.users u
              on u.id = candidate.id
             and u.is_active is true
            where not (candidate.id = any(dr.primary_assignees))
              and not (candidate.id = any(dr.assist_assignees))
            order by
              u.id,
              candidate.source_order,
              candidate.position
          ) viewer
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end
  from detail_row dr;
end;
$$;

alter function public.get_task_detail(uuid)
owner to postgres;

revoke all on function public.get_task_detail(uuid)
from public, anon, authenticated;

grant execute on function public.get_task_detail(uuid)
to authenticated;
