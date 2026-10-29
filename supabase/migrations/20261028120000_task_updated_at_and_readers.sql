-- Batch 11A: task content token, activity filtering, and restricted readers.
-- Existing rows receive this migration transaction's timestamp from the ADD
-- COLUMN default. No trigger is disabled and session_replication_role is not
-- changed; the DDL initialization is intentionally not an activity-producing
-- business update.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 11A must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (task_id, user_id, action, changes)
    values (
      new.id,
      auth.uid(),
      'INSERT',
      pg_catalog.to_jsonb(new) - 'updated_at'
    );
  elsif tg_op = 'UPDATE' then
    if (pg_catalog.to_jsonb(new) - 'sort_order' - 'updated_at') is distinct from
       (pg_catalog.to_jsonb(old) - 'sort_order' - 'updated_at') then
      insert into public.activity_log (task_id, user_id, action, changes)
      values (
        new.id,
        auth.uid(),
        'UPDATE',
        pg_catalog.jsonb_build_object(
          'old', pg_catalog.to_jsonb(old) - 'updated_at',
          'new', pg_catalog.to_jsonb(new) - 'updated_at'
        )
      );
    end if;
  elsif tg_op = 'DELETE' then
    insert into public.activity_log (task_id, user_id, action, changes)
    values (
      null,
      auth.uid(),
      'DELETE',
      pg_catalog.to_jsonb(old) - 'updated_at'
    );
  end if;

  return coalesce(new, old);
end;
$$;

alter function public.log_task_activity() owner to postgres;
revoke all on function public.log_task_activity()
from public, anon, authenticated;

alter table public.tasks
add column updated_at timestamptz
not null
default pg_catalog.transaction_timestamp();

alter table public.tasks
alter column updated_at set default pg_catalog.now();

create function public.set_task_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    pg_catalog.to_jsonb(new) - 'sort_order' - 'updated_at'
  ) is distinct from (
    pg_catalog.to_jsonb(old) - 'sort_order' - 'updated_at'
  ) then
    new.updated_at := greatest(
      pg_catalog.clock_timestamp(),
      old.updated_at + interval '1 microsecond'
    );
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

alter function public.set_task_updated_at() owner to postgres;
revoke all on function public.set_task_updated_at()
from public, anon, authenticated;

-- PostgreSQL fires same-kind triggers by name. z4 is deliberately after the
-- z2 lane-order trigger; prepare_unassigned_task_reset runs before the row
-- UPDATE, so z4 sees its final status/sort_order values as well.
create trigger tasks_z4_set_updated_at
before update on public.tasks
for each row execute function public.set_task_updated_at();

drop function public.get_task_detail(uuid);

create function public.get_task_detail(p_task_id uuid)
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
  updated_at timestamptz,
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
      t.updated_at,
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
    dr.updated_at,
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

drop function public.get_task_edit_controls(uuid);

create function public.get_task_edit_controls(p_task_id uuid)
returns table (
  can_set_dependency boolean,
  can_set_confidentiality boolean,
  can_edit_task boolean,
  can_assign_people boolean,
  can_delete boolean,
  can_unassign_self boolean,
  self_unassign_block_code text,
  self_unassign_will_lose_access boolean,
  depends_on_task_id uuid,
  is_confidential boolean,
  allowed_viewers jsonb,
  dependency_options jsonb,
  viewer_options jsonb,
  primary_assignees jsonb,
  assist_assignees jsonb,
  assignee_options jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_self_unassign_cutoff constant interval := interval '72 hours';
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_task_event_id uuid;
  v_task_event_status text;
  v_task_committee_id uuid;
  v_task_status text;
  v_task_due_date timestamptz;
  v_task_dependency_id uuid;
  v_task_is_confidential boolean;
  v_task_allowed_viewers uuid[];
  v_task_primary_assignees uuid[];
  v_task_assist_assignees uuid[];
  v_is_leader boolean;
  v_is_self_assigned boolean;
  v_can_set_confidentiality boolean;
  v_can_edit_task boolean;
  v_self_unassign_block_code text;
  v_self_unassign_will_lose_access boolean;
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null or not found then
    return;
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    return;
  end if;

  select
    task_row.event_id,
    event_row.status,
    task_row.committee_id,
    task_row.status,
    task_row.due_date,
    task_row.depends_on_task_id,
    task_row.is_confidential,
    task_row.allowed_viewers,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    v_task_event_id,
    v_task_event_status,
    v_task_committee_id,
    v_task_status,
    v_task_due_date,
    v_task_dependency_id,
    v_task_is_confidential,
    v_task_allowed_viewers,
    v_task_primary_assignees,
    v_task_assist_assignees
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found or v_task_event_status not in ('Draft', 'Active') then
    return;
  end if;

  v_is_leader := v_caller_role in ('Admin', 'Co-Admin');
  v_is_self_assigned :=
    v_caller_id = any(v_task_primary_assignees)
    or v_caller_id = any(v_task_assist_assignees);

  if not v_is_leader and not v_is_self_assigned then
    return;
  end if;

  v_can_set_confidentiality :=
    v_is_leader
    and (
      v_caller_role = 'Admin'
      or v_caller_committee_id = v_task_committee_id
    );

  v_can_edit_task :=
    v_task_event_status = 'Active'
    and (
      v_caller_role = 'Admin'
      or (
        v_caller_role = 'Co-Admin'
        and v_caller_committee_id = v_task_committee_id
      )
    );

  v_self_unassign_block_code := case
    when not v_is_self_assigned or v_task_event_status <> 'Active' then null
    when v_task_status = 'Completed' then 'completed'
    when v_task_due_date is not null
         and v_task_due_date <= statement_timestamp() + c_self_unassign_cutoff
      then 'due'
    else null
  end;

  v_self_unassign_will_lose_access :=
    v_is_self_assigned
    and v_task_is_confidential
    and v_caller_role <> 'Admin'
    and not (
      v_caller_role = 'Co-Admin'
      and v_caller_committee_id = v_task_committee_id
    )
    and not (v_caller_id = any(v_task_allowed_viewers));

  return query
  select
    v_is_leader,
    v_can_set_confidentiality,
    v_can_edit_task,
    v_is_leader,
    v_is_leader and v_task_status = 'To Do',
    v_is_self_assigned
      and v_task_event_status = 'Active'
      and v_self_unassign_block_code is null,
    v_self_unassign_block_code,
    v_self_unassign_will_lose_access,
    case when v_is_leader then v_task_dependency_id else null end,
    case when v_can_set_confidentiality then v_task_is_confidential else null end,
    case
      when v_can_set_confidentiality then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', stored.viewer_id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by stored.position
          )
          from unnest(v_task_allowed_viewers)
            with ordinality as stored(viewer_id, position)
          left join public.users user_row on user_row.id = stored.viewer_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', option_row.id,
              'label', option_row.safe_label,
              'status', option_row.status
            )
            order by option_row.sort_order, option_row.id
          )
          from (
            select
              candidate.id,
              candidate.status,
              candidate.sort_order,
              case candidate_access.content_access
                when 'real' then candidate.title
                when 'masked' then 'Confidential Task'
              end as safe_label
            from public.tasks candidate
            cross join lateral (
              select public.task_content_access(candidate.id) as content_access
            ) candidate_access
            where candidate.event_id = v_task_event_id
              and candidate.id <> p_task_id
              and candidate_access.content_access in ('real', 'masked')
          ) option_row
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_can_set_confidentiality then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', user_option.id,
              'full_name', user_option.full_name,
              'avatar_url', user_option.avatar_url
            )
            order by user_option.full_name, user_option.id
          )
          from public.list_active_task_assignees() user_option
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', stored.assignee_id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by stored.position
          )
          from unnest(v_task_primary_assignees)
            with ordinality as stored(assignee_id, position)
          left join public.users user_row on user_row.id = stored.assignee_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', stored.assignee_id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by stored.position
          )
          from unnest(v_task_assist_assignees)
            with ordinality as stored(assignee_id, position)
          left join public.users user_row on user_row.id = stored.assignee_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when v_is_leader then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', user_option.id,
              'full_name', user_option.full_name,
              'avatar_url', user_option.avatar_url
            )
            order by user_option.full_name, user_option.id
          )
          from public.list_active_task_assignees() user_option
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end;
end;
$$;

alter function public.get_task_edit_controls(uuid)
owner to postgres;

revoke all on function public.get_task_edit_controls(uuid)
from public, anon, authenticated;
grant execute on function public.get_task_edit_controls(uuid)
to authenticated;

do $$
declare
  v_detail regprocedure :=
    'public.get_task_detail(uuid)'::regprocedure;
  v_controls regprocedure :=
    'public.get_task_edit_controls(uuid)'::regprocedure;
begin
  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_task_detail'
  ) <> 1 then
    raise exception 'get_task_detail must have exactly one overload.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_task_edit_controls'
  ) <> 1 then
    raise exception 'get_task_edit_controls must have exactly one overload.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    where p.oid in (v_detail, v_controls)
      and p.proowner = 'postgres'::regrole
      and p.prosecdef
      and coalesce(p.proconfig, '{}'::text[])
        @> array['search_path=""']
  ) <> 2 then
    raise exception 'Restricted task readers have unexpected security attributes.';
  end if;
end;
$$;

