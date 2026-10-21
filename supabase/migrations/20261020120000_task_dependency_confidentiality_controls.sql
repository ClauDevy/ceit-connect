-- Phase 4 Step 7: narrow dependency and confidentiality controls.
-- Dependency writes share the Step 5a per-event advisory lock. Confidentiality
-- remains an invoker-security, RLS-backed write. No function in this migration
-- changes a task's event, assignment, content, status, or deliberate rank.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Step 7 must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

-- The invoker lane trigger needs one RLS-independent dependency-status read.
-- Authenticated receives EXECUTE only because the trigger is SECURITY INVOKER;
-- a direct call is rejected before any task row is read.
create function public.task_dependency_allows_forward_move(
  p_event_id uuid,
  p_depends_on_task_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dependency_status text;
begin
  if pg_catalog.pg_trigger_depth() = 0 then
    raise exception using
      errcode = '42501',
      message = 'This helper may only be used by a task trigger.';
  end if;

  if p_depends_on_task_id is null then
    return true;
  end if;

  select dependency.status
  into v_dependency_status
  from public.tasks dependency
  where dependency.id = p_depends_on_task_id
    and dependency.event_id = p_event_id;

  return found and v_dependency_status = 'Completed';
end;
$$;

alter function public.task_dependency_allows_forward_move(uuid, uuid)
owner to postgres;

revoke all on function public.task_dependency_allows_forward_move(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.task_dependency_allows_forward_move(uuid, uuid)
to authenticated;

-- OLD postgres allowance: status + sort_order.
-- NEW postgres allowance: status + sort_order + depends_on_task_id, which is
-- the exact union needed by move_task() and set_task_dependency(). Raw caller
-- behavior in the leadership and assignee branches is otherwise unchanged.
create or replace function public.restrict_assignee_task_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'postgres' then
    if (
      to_jsonb(new)
        - 'status'
        - 'sort_order'
        - 'depends_on_task_id'
    ) is distinct from (
      to_jsonb(old)
        - 'status'
        - 'sort_order'
        - 'depends_on_task_id'
    ) then
      raise exception
        'Privileged task writers may update only status, sort_order, and depends_on_task_id.';
    end if;

    return new;
  end if;

  if public.my_role() = 'Admin'
     or (
       public.my_role() = 'Co-Admin'
       and public.my_committee_id() = new.committee_id
     ) then
    return new;
  end if;

  if (to_jsonb(new) - 'status') is distinct from
     (to_jsonb(old) - 'status') then
    raise exception 'Assignees can only update a task''s status.';
  end if;

  return new;
end;
$$;

alter function public.restrict_assignee_task_updates()
owner to postgres;

revoke all on function public.restrict_assignee_task_updates()
from public, anon, authenticated;

-- Preserve the Step 5b postgres early return and the unchanged-lane return.
-- Only raw status changes reach the new dependency gate. The event advisory
-- lock is held before the helper reads the prerequisite, and the forward-only
-- comparison is exactly the rule enforced inside move_task().
create or replace function public.set_task_destination_lane_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lane_max bigint;
  v_destination_rank integer;
  v_source_rank integer;
begin
  if old.event_id is distinct from new.event_id then
    return new;
  end if;

  if current_user = 'postgres' then
    if old.phase is distinct from new.phase then
      raise exception 'The task-move writer cannot change a task''s phase.';
    end if;

    return new;
  end if;

  if old.phase is not distinct from new.phase
     and old.status is not distinct from new.status then
    if old.sort_order is distinct from new.sort_order then
      raise exception 'Task order can only be changed through the task-move function.';
    end if;

    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(old.event_id)
  );

  v_destination_rank := case new.status
    when 'To Do' then 1
    when 'In Progress' then 2
    when 'Completed' then 3
  end;
  v_source_rank := case old.status
    when 'To Do' then 1
    when 'In Progress' then 2
    when 'Completed' then 3
  end;

  if v_destination_rank > v_source_rank
     and new.depends_on_task_id is not null
     and not public.task_dependency_allows_forward_move(
       new.event_id,
       new.depends_on_task_id
     ) then
    raise exception 'Complete the prerequisite task before moving this task forward.';
  end if;

  v_lane_max := public.task_lane_tail_sort_order(
    old.event_id,
    new.phase,
    new.status,
    old.id
  );

  if v_lane_max > 9223372036854774783::bigint then
    raise exception 'Task order is exhausted for this lane.';
  end if;

  new.sort_order := v_lane_max + 1024::bigint;
  return new;
end;
$$;

alter function public.set_task_destination_lane_order()
owner to postgres;

revoke all on function public.set_task_destination_lane_order()
from public, anon, authenticated;

create function public.set_task_dependency(
  p_task_id uuid,
  p_depends_on_task_id uuid
)
returns table (
  task_id uuid,
  depends_on_task_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_discovered_event_id uuid;
  v_locked_event_id uuid;
  v_event_status text;
  v_task_event_id uuid;
  v_dependency_event_id uuid;
  v_cycle_exists boolean;
  v_affected integer;
  v_result_task_id uuid;
  v_result_dependency_id uuid;
begin
  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only an active Admin or Co-Admin can change a task dependency.';
  end if;

  -- task_content_access() returns exactly real, masked, or hidden. Dependency
  -- editing requires real access to the dependent task; masked prerequisites
  -- remain valid and are represented safely by the reader below.
  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its dependency.';
  end if;

  select task_row.event_id
  into v_discovered_event_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task is unavailable.';
  end if;

  select event_row.id, event_row.status
  into v_locked_event_id, v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task event is unavailable. Refresh and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if v_event_status not in ('Draft', 'Active') then
    raise exception 'The task''s event is not writable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_locked_event_id)
  );

  select task_row.event_id
  into v_task_event_id
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its dependency.';
  end if;

  if p_depends_on_task_id is not null then
    if p_depends_on_task_id = p_task_id then
      raise exception using
        errcode = '22023',
        message = 'A task cannot depend on itself.';
    end if;

    select dependency.event_id
    into v_dependency_event_id
    from public.tasks dependency
    where dependency.id = p_depends_on_task_id
    for share;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'The selected prerequisite task does not exist.';
    end if;

    if v_dependency_event_id is distinct from v_locked_event_id then
      raise exception using
        errcode = '22023',
        message = 'A task can depend only on another task in the same event.';
    end if;

    if public.task_content_access(p_depends_on_task_id) not in ('real', 'masked') then
      raise exception using
        errcode = '42501',
        message = 'The selected prerequisite task is unavailable.';
    end if;

    with recursive dependency_chain as (
      select
        dependency.id,
        dependency.depends_on_task_id,
        array[dependency.id]::uuid[] as visited_ids
      from public.tasks dependency
      where dependency.id = p_depends_on_task_id

      union all

      select
        dependency.id,
        dependency.depends_on_task_id,
        chain.visited_ids || dependency.id
      from dependency_chain chain
      join public.tasks dependency
        on dependency.id = chain.depends_on_task_id
      where not dependency.id = any(chain.visited_ids)
    )
    select exists (
      select 1
      from dependency_chain chain
      where chain.id = p_task_id
    )
    into v_cycle_exists;

    if v_cycle_exists then
      raise exception using
        errcode = '22023',
        message = 'This dependency would create a cycle.';
    end if;
  end if;

  update public.tasks as task_row
  set depends_on_task_id = p_depends_on_task_id
  where task_row.id = p_task_id
  returning task_row.id, task_row.depends_on_task_id
  into v_result_task_id, v_result_dependency_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  task_id := v_result_task_id;
  depends_on_task_id := v_result_dependency_id;
  return next;
end;
$$;

alter function public.set_task_dependency(uuid, uuid)
owner to postgres;

revoke all on function public.set_task_dependency(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.set_task_dependency(uuid, uuid)
to authenticated;

create function public.set_task_confidentiality(
  p_task_id uuid,
  p_is_confidential boolean,
  p_allowed_viewers uuid[]
)
returns table (
  task_id uuid,
  is_confidential boolean,
  allowed_viewers uuid[]
)
language plpgsql
volatile
security invoker
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
  v_old_allowed_viewers uuid[];
  v_event_status text;
  v_affected integer;
  v_result_task_id uuid;
  v_result_is_confidential boolean;
  v_result_allowed_viewers uuid[];
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only authorized active leadership can change task confidentiality.';
  end if;

  if p_task_id is null
     or p_is_confidential is null
     or p_allowed_viewers is null then
    raise exception using
      errcode = '22023',
      message = 'A task, confidentiality value, and viewer list are required.';
  end if;

  if pg_catalog.cardinality(p_allowed_viewers) > 50 then
    raise exception using
      errcode = '22023',
      message = 'A confidential task may have at most 50 additional viewers.';
  end if;

  if exists (
    select 1
    from unnest(p_allowed_viewers) proposed(viewer_id)
    where proposed.viewer_id is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'Viewer ids cannot be null.';
  end if;

  if (
    select count(*)
    from unnest(p_allowed_viewers) proposed(viewer_id)
  ) <> (
    select count(distinct proposed.viewer_id)
    from unnest(p_allowed_viewers) proposed(viewer_id)
  ) then
    raise exception using
      errcode = '22023',
      message = 'Each additional viewer may be selected only once.';
  end if;

  if p_is_confidential is false
     and pg_catalog.cardinality(p_allowed_viewers) <> 0 then
    raise exception using
      errcode = '22023',
      message = 'A non-confidential task cannot keep additional viewers.';
  end if;

  -- This discovery uses the caller's existing task RLS.
  select task_row.event_id, task_row.committee_id
  into v_discovered_event_id, v_discovered_committee_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'You are not allowed to change this task''s confidentiality.';
  end if;

  if v_caller_role = 'Co-Admin'
     and v_caller_committee_id is distinct from v_discovered_committee_id then
    raise exception using
      errcode = '42501',
      message = 'Co-Admins can change confidentiality only for their own committee''s tasks.';
  end if;

  -- SELECT FOR SHARE is subject to events_update RLS for this invoker-security
  -- function. Archived parents can therefore appear as no row; handle that
  -- explicitly instead of treating an unset status as writable.
  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task event is Archived or unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if v_event_status not in ('Draft', 'Active') then
    raise exception 'The task''s event is not writable.';
  end if;

  select
    task_row.event_id,
    task_row.committee_id,
    task_row.allowed_viewers
  into
    v_task_event_id,
    v_task_committee_id,
    v_old_allowed_viewers
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found
     or v_task_event_id is distinct from v_discovered_event_id
     or v_task_committee_id is distinct from v_discovered_committee_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_caller_role = 'Co-Admin'
     and v_caller_committee_id is distinct from v_task_committee_id then
    raise exception using
      errcode = '42501',
      message = 'Co-Admins can change confidentiality only for their own committee''s tasks.';
  end if;

  -- Inactive ids already stored on the task may be retained. Every newly
  -- added id must resolve to a currently active profile.
  if exists (
    select 1
    from unnest(p_allowed_viewers) proposed(viewer_id)
    where not proposed.viewer_id = any(v_old_allowed_viewers)
      and not exists (
        select 1
        from public.users user_row
        where user_row.id = proposed.viewer_id
          and user_row.is_active is true
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every newly added viewer must be an active user.';
  end if;

  update public.tasks as task_row
  set is_confidential = p_is_confidential,
      allowed_viewers = p_allowed_viewers
  where task_row.id = p_task_id
  returning
    task_row.id,
    task_row.is_confidential,
    task_row.allowed_viewers
  into
    v_result_task_id,
    v_result_is_confidential,
    v_result_allowed_viewers;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  task_id := v_result_task_id;
  is_confidential := v_result_is_confidential;
  allowed_viewers := v_result_allowed_viewers;
  return next;
end;
$$;

alter function public.set_task_confidentiality(uuid, boolean, uuid[])
owner to postgres;

revoke all on function public.set_task_confidentiality(uuid, boolean, uuid[])
from public, anon, authenticated;
grant execute on function public.set_task_confidentiality(uuid, boolean, uuid[])
to authenticated;

create function public.get_task_edit_controls(p_task_id uuid)
returns table (
  can_set_dependency boolean,
  can_set_confidentiality boolean,
  depends_on_task_id uuid,
  is_confidential boolean,
  allowed_viewers jsonb,
  dependency_options jsonb,
  viewer_options jsonb
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
  v_task_event_status text;
  v_task_committee_id uuid;
  v_task_dependency_id uuid;
  v_task_is_confidential boolean;
  v_task_allowed_viewers uuid[];
  v_can_set_confidentiality boolean;
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    return;
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    return;
  end if;

  select
    task_row.event_id,
    event_row.status,
    task_row.committee_id,
    task_row.depends_on_task_id,
    task_row.is_confidential,
    task_row.allowed_viewers
  into
    v_task_event_id,
    v_task_event_status,
    v_task_committee_id,
    v_task_dependency_id,
    v_task_is_confidential,
    v_task_allowed_viewers
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found or v_task_event_status not in ('Draft', 'Active') then
    return;
  end if;

  v_can_set_confidentiality :=
    v_caller_role = 'Admin'
    or (
      v_caller_role = 'Co-Admin'
      and v_caller_committee_id = v_task_committee_id
    );

  return query
  select
    true,
    v_can_set_confidentiality,
    v_task_dependency_id,
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
    coalesce(
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
    ),
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
    end;
end;
$$;

alter function public.get_task_edit_controls(uuid)
owner to postgres;

revoke all on function public.get_task_edit_controls(uuid)
from public, anon, authenticated;
grant execute on function public.get_task_edit_controls(uuid)
to authenticated;

-- Exact catalog query for the privileged task-writer allowlist. Trigger
-- functions are not counted merely because they return trigger: this query
-- selects only postgres-owned SECURITY DEFINER functions whose own body issues
-- a literal UPDATE public.tasks. Current task triggers validate or mutate NEW,
-- or write other tables; they do not issue that task-table UPDATE statement.
do $$
declare
  v_allowlist_is_exact boolean;
begin
  select
    count(*) = 2
    and count(*) filter (
      where p.oid = 'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure
    ) = 1
    and count(*) filter (
      where p.oid = 'public.set_task_dependency(uuid,uuid)'::regprocedure
    ) = 1
  into v_allowlist_is_exact
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef is true
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and pg_catalog.pg_get_functiondef(p.oid)
      ~* '\mupdate[[:space:]]+public\.tasks\M';

  if not coalesce(v_allowlist_is_exact, false) then
    raise exception
      'Unexpected postgres-owned SECURITY DEFINER function updates public.tasks.';
  end if;
end
$$;
