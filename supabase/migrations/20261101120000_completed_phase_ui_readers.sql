-- Phase-completion UI readers and capability suppression.
--
-- The private authority helper is shared by the readers and the real Reopen
-- writer.  Readers add the same stored-status and authoritative phase-complete
-- predicates that Reopen validates after locking.  Catalog and behavioral
-- tests pin both call sites so the authorization rule cannot drift silently.

create function ceit_connect_private.completed_phase_reopen_actor_allowed(
  p_task_id uuid,
  p_actor_id uuid,
  p_require_open_event boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.bool_or(
    user_row.is_active is true
    and user_row.role in ('Admin', 'Co-Admin')
    and (
      p_require_open_event is false
      or (
        p_require_open_event is true
        and event_row.status in ('Draft', 'Active')
      )
    )
    and public.task_content_access_for_user(task_row.id, user_row.id) = 'real'
    and (
      user_row.role = 'Admin'
      or (
        user_row.role = 'Co-Admin'
        and event_row.created_by = user_row.id
      )
    )
  ), false)
  from public.users as user_row
  join public.tasks as task_row on task_row.id = p_task_id
  join public.events as event_row on event_row.id = task_row.event_id
  where user_row.id = p_actor_id
$$;

alter function ceit_connect_private.completed_phase_reopen_actor_allowed(uuid, uuid, boolean)
owner to postgres;
revoke all on function ceit_connect_private.completed_phase_reopen_actor_allowed(uuid, uuid, boolean)
from public, anon, authenticated, service_role;

-- Draft editor reader.  The old body remains the source of row visibility,
-- masking, ordering, and committee edit scope.  The wrapper can only remove
-- edit capability and add the three phase-completion fields.
alter function public.list_draft_event_editor_tasks(uuid)
rename to list_draft_event_editor_tasks_pre13b_ui;
revoke all on function public.list_draft_event_editor_tasks_pre13b_ui(uuid)
from public, anon, authenticated, service_role;

create function public.list_draft_event_editor_tasks(p_event_id uuid)
returns table (
  out_task_id uuid,
  out_phase text,
  out_status text,
  out_title text,
  out_description text,
  out_priority text,
  out_task_type text,
  out_due_date timestamptz,
  out_call_time timestamptz,
  out_end_time timestamptz,
  out_committee_id uuid,
  out_committee_name text,
  out_primary_assignees jsonb,
  out_assist_assignees jsonb,
  out_is_masked boolean,
  out_is_editable boolean,
  out_phase_complete boolean,
  out_can_reopen boolean,
  out_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  return query
  with prior_rows as materialized (
    select prior_row.*
    from public.list_draft_event_editor_tasks_pre13b_ui(p_event_id)
      with ordinality as prior_row
  ),
  phase_keys as materialized (
    select public.canonical_task_phase(prior_row.out_phase) as phase_key
    from prior_rows as prior_row
    group by public.canonical_task_phase(prior_row.out_phase)
  ),
  phase_states as materialized (
    select phase_key_row.phase_key,
      public.task_phase_is_complete(p_event_id, phase_key_row.phase_key)
        as phase_complete
    from phase_keys as phase_key_row
  ),
  decorated as materialized (
    select prior_row.*,
      phase_state.phase_complete,
      phase_state.phase_complete
        and prior_row.out_status = 'Completed'
        and ceit_connect_private.completed_phase_reopen_actor_allowed(
          prior_row.out_task_id,
          v_actor_id,
          true
        ) as can_reopen
    from prior_rows as prior_row
    join phase_states as phase_state
      on phase_state.phase_key = public.canonical_task_phase(prior_row.out_phase)
  )
  select decorated.out_task_id,
    decorated.out_phase,
    decorated.out_status,
    decorated.out_title,
    decorated.out_description,
    decorated.out_priority,
    decorated.out_task_type,
    decorated.out_due_date,
    decorated.out_call_time,
    decorated.out_end_time,
    decorated.out_committee_id,
    decorated.out_committee_name,
    decorated.out_primary_assignees,
    decorated.out_assist_assignees,
    decorated.out_is_masked,
    decorated.out_is_editable and not decorated.phase_complete,
    decorated.phase_complete,
    decorated.can_reopen,
    case when decorated.can_reopen then task_row.updated_at end
  from decorated
  join public.tasks as task_row on task_row.id = decorated.out_task_id
  order by decorated.ordinality;
end;
$$;

alter function public.list_draft_event_editor_tasks(uuid) owner to postgres;
revoke all on function public.list_draft_event_editor_tasks(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_draft_event_editor_tasks(uuid)
to authenticated;

-- Board reader.  The prior reader remains authoritative for row visibility,
-- masks, committee filtering, lifecycle filtering, and lane ordering.
alter function public.list_event_board_tasks(uuid, uuid)
rename to list_event_board_tasks_pre13b_ui;
revoke all on function public.list_event_board_tasks_pre13b_ui(uuid, uuid)
from public, anon, authenticated, service_role;

create function public.list_event_board_tasks(
  p_event_id uuid,
  p_committee_id uuid default null
)
returns table (
  id uuid,
  title text,
  phase text,
  status text,
  effective_priority text,
  due_date timestamptz,
  committee_id uuid,
  committee_name text,
  primary_assignees jsonb,
  assist_assignees jsonb,
  is_backlog boolean,
  is_masked boolean,
  phase_complete boolean,
  can_reopen boolean,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
begin
  return query
  with prior_rows as materialized (
    select prior_row.*
    from public.list_event_board_tasks_pre13b_ui(
      p_event_id,
      p_committee_id
    ) with ordinality as prior_row
  ),
  phase_keys as materialized (
    select public.canonical_task_phase(prior_row.phase) as phase_key
    from prior_rows as prior_row
    group by public.canonical_task_phase(prior_row.phase)
  ),
  phase_states as materialized (
    select phase_key_row.phase_key,
      public.task_phase_is_complete(p_event_id, phase_key_row.phase_key)
        as phase_complete
    from phase_keys as phase_key_row
  ),
  decorated as materialized (
    select prior_row.*,
      phase_state.phase_complete,
      phase_state.phase_complete
        and prior_row.status = 'Completed'
        and ceit_connect_private.completed_phase_reopen_actor_allowed(
          prior_row.id,
          v_actor_id,
          true
        ) as can_reopen
    from prior_rows as prior_row
    join phase_states as phase_state
      on phase_state.phase_key = public.canonical_task_phase(prior_row.phase)
  )
  select decorated.id,
    decorated.title,
    decorated.phase,
    decorated.status,
    decorated.effective_priority,
    decorated.due_date,
    decorated.committee_id,
    decorated.committee_name,
    decorated.primary_assignees,
    decorated.assist_assignees,
    decorated.is_backlog,
    decorated.is_masked,
    decorated.phase_complete,
    decorated.can_reopen,
    case when decorated.can_reopen then task_row.updated_at end
  from decorated
  join public.tasks as task_row on task_row.id = decorated.id
  order by decorated.ordinality;
end;
$$;

alter function public.list_event_board_tasks(uuid, uuid) owner to postgres;
revoke all on function public.list_event_board_tasks(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_event_board_tasks(uuid, uuid)
to authenticated;

-- Task detail.  The prior body still decides real/masked/hidden content.
alter function public.get_task_detail(uuid)
rename to get_task_detail_pre13b_ui;
revoke all on function public.get_task_detail_pre13b_ui(uuid)
from public, anon, authenticated, service_role;

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
  access_list jsonb,
  phase_complete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with prior_rows as materialized (
    select prior_row.*
    from public.get_task_detail_pre13b_ui(p_task_id) as prior_row
  ),
  phase_state as materialized (
    select public.task_phase_is_complete(
      task_row.event_id,
      public.canonical_task_phase(task_row.phase)
    ) as phase_complete
    from public.tasks as task_row
    where task_row.id = p_task_id
      and exists (select 1 from prior_rows)
  )
  select prior_row.id,
    prior_row.event_id,
    prior_row.event_name,
    prior_row.event_status,
    prior_row.title,
    prior_row.description,
    prior_row.phase,
    prior_row.status,
    prior_row.effective_priority,
    prior_row.task_type,
    prior_row.due_date,
    prior_row.call_time,
    prior_row.end_time,
    prior_row.created_at,
    prior_row.updated_at,
    prior_row.committee_id,
    prior_row.committee_name,
    prior_row.primary_assignees,
    prior_row.assist_assignees,
    prior_row.is_confidential,
    prior_row.is_masked,
    prior_row.has_dependency,
    prior_row.is_blocked,
    prior_row.dependency_label,
    prior_row.access_list,
    phase_state.phase_complete
  from prior_rows as prior_row
  cross join phase_state;
end;
$$;

alter function public.get_task_detail(uuid) owner to postgres;
revoke all on function public.get_task_detail(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_task_detail(uuid) to authenticated;

-- Edit controls: same row visibility and response shape; completion can only
-- turn capabilities off and remove mutation option data.
alter function public.get_task_edit_controls(uuid)
rename to get_task_edit_controls_pre13b_ui;
revoke all on function public.get_task_edit_controls_pre13b_ui(uuid)
from public, anon, authenticated, service_role;

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
  v_phase_complete boolean;
begin
  select public.task_phase_is_complete(
    task_row.event_id,
    public.canonical_task_phase(task_row.phase)
  ) into v_phase_complete
  from public.tasks as task_row
  where task_row.id = p_task_id;

  return query
  select
    case when v_phase_complete then false else prior_row.can_set_dependency end,
    case when v_phase_complete then false else prior_row.can_set_confidentiality end,
    case when v_phase_complete then false else prior_row.can_edit_task end,
    case when v_phase_complete then false else prior_row.can_assign_people end,
    case when v_phase_complete then false else prior_row.can_delete end,
    case when v_phase_complete then false else prior_row.can_unassign_self end,
    case when v_phase_complete then null else prior_row.self_unassign_block_code end,
    case when v_phase_complete then false else prior_row.self_unassign_will_lose_access end,
    case when v_phase_complete then null else prior_row.depends_on_task_id end,
    prior_row.is_confidential,
    case when v_phase_complete then '[]'::jsonb else prior_row.allowed_viewers end,
    case when v_phase_complete then '[]'::jsonb else prior_row.dependency_options end,
    case when v_phase_complete then '[]'::jsonb else prior_row.viewer_options end,
    case when v_phase_complete then '[]'::jsonb else prior_row.primary_assignees end,
    case when v_phase_complete then '[]'::jsonb else prior_row.assist_assignees end,
    case when v_phase_complete then '[]'::jsonb else prior_row.assignee_options end
  from public.get_task_edit_controls_pre13b_ui(p_task_id) as prior_row;
end;
$$;

alter function public.get_task_edit_controls(uuid) owner to postgres;
revoke all on function public.get_task_edit_controls(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_task_edit_controls(uuid) to authenticated;

-- Work links stay readable while add/remove capabilities are stripped.
alter function public.get_task_work_links(uuid)
rename to get_task_work_links_pre13b_ui;
revoke all on function public.get_task_work_links_pre13b_ui(uuid)
from public, anon, authenticated, service_role;

create function public.get_task_work_links(p_task_id uuid)
returns table (can_add boolean, links jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phase_complete boolean;
begin
  select public.task_phase_is_complete(
    task_row.event_id,
    public.canonical_task_phase(task_row.phase)
  ) into v_phase_complete
  from public.tasks as task_row
  where task_row.id = p_task_id;

  return query
  select case when v_phase_complete then false else prior_row.can_add end,
    case when v_phase_complete then coalesce((
      select pg_catalog.jsonb_agg(
        (link_row.value - 'can_remove')
          || pg_catalog.jsonb_build_object('can_remove', false)
        order by link_row.position
      )
      from pg_catalog.jsonb_array_elements(prior_row.links)
        with ordinality as link_row(value, position)
    ), '[]'::jsonb) else prior_row.links end
  from public.get_task_work_links_pre13b_ui(p_task_id) as prior_row;
end;
$$;

alter function public.get_task_work_links(uuid) owner to postgres;
revoke all on function public.get_task_work_links(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_task_work_links(uuid) to authenticated;

-- Comments remain readable and page exactly as before; only edit/delete flags
-- are removed.  Defaults are repeated exactly on the public signature.
alter function public.list_task_comments(uuid, integer, timestamptz, uuid)
rename to list_task_comments_pre13b_ui;
revoke all on function public.list_task_comments_pre13b_ui(
  uuid, integer, timestamptz, uuid
)
from public, anon, authenticated, service_role;

create function public.list_task_comments(
  p_task_id uuid,
  p_limit integer default 25,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  out_id uuid,
  out_body text,
  out_is_heads_up boolean,
  out_created_at timestamptz,
  out_edited_at timestamptz,
  out_author_id uuid,
  out_author_full_name text,
  out_author_avatar_url text,
  out_mentions jsonb,
  out_can_edit boolean,
  out_can_delete boolean,
  out_has_more boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phase_complete boolean;
begin
  select public.task_phase_is_complete(
    task_row.event_id,
    public.canonical_task_phase(task_row.phase)
  ) into v_phase_complete
  from public.tasks as task_row
  where task_row.id = p_task_id;

  return query
  select prior_row.out_id,
    prior_row.out_body,
    prior_row.out_is_heads_up,
    prior_row.out_created_at,
    prior_row.out_edited_at,
    prior_row.out_author_id,
    prior_row.out_author_full_name,
    prior_row.out_author_avatar_url,
    prior_row.out_mentions,
    case when v_phase_complete then false else prior_row.out_can_edit end,
    case when v_phase_complete then false else prior_row.out_can_delete end,
    prior_row.out_has_more
  from public.list_task_comments_pre13b_ui(
    p_task_id,
    p_limit,
    p_before_created_at,
    p_before_id
  ) with ordinality as prior_row
  order by prior_row.ordinality;
end;
$$;

alter function public.list_task_comments(uuid, integer, timestamptz, uuid)
owner to postgres;
revoke all on function public.list_task_comments(
  uuid, integer, timestamptz, uuid
)
from public, anon, authenticated, service_role;
grant execute on function public.list_task_comments(
  uuid, integer, timestamptz, uuid
)
to authenticated;

-- Backup state remains visible but no completed-phase action is exposed.
alter function public.get_task_backup_state(uuid)
rename to get_task_backup_state_pre13b_ui;
revoke all on function public.get_task_backup_state_pre13b_ui(uuid)
from public, anon, authenticated, service_role;

create function public.get_task_backup_state(p_task_id uuid)
returns table (
  out_task_id uuid,
  out_request_backup boolean,
  out_can_toggle_backup boolean,
  out_can_volunteer boolean,
  out_has_volunteered boolean,
  out_can_accept boolean,
  out_volunteers jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phase_complete boolean;
begin
  select public.task_phase_is_complete(
    task_row.event_id,
    public.canonical_task_phase(task_row.phase)
  ) into v_phase_complete
  from public.tasks as task_row
  where task_row.id = p_task_id;

  return query
  select prior_row.out_task_id,
    prior_row.out_request_backup,
    case when v_phase_complete then false else prior_row.out_can_toggle_backup end,
    case when v_phase_complete then false else prior_row.out_can_volunteer end,
    prior_row.out_has_volunteered,
    case when v_phase_complete then false else prior_row.out_can_accept end,
    prior_row.out_volunteers
  from public.get_task_backup_state_pre13b_ui(p_task_id) as prior_row;
end;
$$;

alter function public.get_task_backup_state(uuid) owner to postgres;
revoke all on function public.get_task_backup_state(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_task_backup_state(uuid) to authenticated;

-- Leave rows keep their visibility, but a completed phase cannot expose
-- requester cancellation or leadership resolution capability.
alter function public.list_pending_task_leave_requests(uuid)
rename to list_pending_task_leave_requests_pre13b_ui;
revoke all on function public.list_pending_task_leave_requests_pre13b_ui(uuid)
from public, anon, authenticated, service_role;

create function public.list_pending_task_leave_requests(
  p_task_id uuid default null
)
returns table (
  out_id uuid,
  out_task_id uuid,
  out_task_title text,
  out_event_name text,
  out_requester_id uuid,
  out_requester_name text,
  out_due_date timestamptz,
  out_created_at timestamptz,
  out_can_resolve boolean,
  out_is_requester boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with prior_rows as materialized (
    select prior_row.*
    from public.list_pending_task_leave_requests_pre13b_ui(p_task_id)
      with ordinality as prior_row
  ),
  task_phases as materialized (
    select task_row.id as task_id,
      task_row.event_id,
      public.canonical_task_phase(task_row.phase) as phase_key
    from public.tasks as task_row
    join (
      select distinct prior_row.out_task_id
      from prior_rows as prior_row
    ) as visible_task
      on visible_task.out_task_id = task_row.id
  ),
  phase_keys as materialized (
    select task_phase.event_id, task_phase.phase_key
    from task_phases as task_phase
    group by task_phase.event_id, task_phase.phase_key
  ),
  phase_states as materialized (
    select phase_key.event_id,
      phase_key.phase_key,
      public.task_phase_is_complete(phase_key.event_id, phase_key.phase_key)
        as phase_complete
    from phase_keys as phase_key
  )
  select prior_row.out_id,
    prior_row.out_task_id,
    prior_row.out_task_title,
    prior_row.out_event_name,
    prior_row.out_requester_id,
    prior_row.out_requester_name,
    prior_row.out_due_date,
    prior_row.out_created_at,
    case when phase_state.phase_complete then false else prior_row.out_can_resolve end,
    case when phase_state.phase_complete then false else prior_row.out_is_requester end
  from prior_rows as prior_row
  join task_phases as task_phase on task_phase.task_id = prior_row.out_task_id
  join phase_states as phase_state
    on phase_state.event_id = task_phase.event_id
   and phase_state.phase_key = task_phase.phase_key
  order by prior_row.ordinality;
end;
$$;

alter function public.list_pending_task_leave_requests(uuid) owner to postgres;
revoke all on function public.list_pending_task_leave_requests(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_pending_task_leave_requests(uuid)
to authenticated;

-- Authorize actor/owner/content access before taking any lock so an
-- unauthorized caller always receives CCQ03 and cannot probe Archived state.
-- Recheck the same shared predicate after locking, then require an open event.
-- Readers call that same helper with p_require_open_event = true.
create or replace function public.reopen_completed_phase_task(
  p_task_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  task_id uuid,
  status text,
  sort_order bigint,
  phase_key text,
  phase_complete boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_event_id uuid;
  v_event_creator uuid;
  v_event_status text;
  v_phase text;
  v_phase_key text;
  v_task_status text;
  v_updated_at timestamptz;
  v_new_sort_order bigint;
  v_affected integer;
begin
  if p_task_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'A task and exact version are required.';
  end if;

  select user_row.role into v_role
  from public.users as user_row
  where user_row.id = v_actor and user_row.is_active is true;
  if v_actor is null or not found or v_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  select task_row.event_id, task_row.phase
  into v_event_id, v_phase
  from public.tasks as task_row
  where task_row.id = p_task_id;
  if not found then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;
  v_phase_key := public.canonical_task_phase(v_phase);

  if ceit_connect_private.completed_phase_reopen_actor_allowed(
    p_task_id,
    v_actor,
    false
  ) is not true then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  select event_row.created_by, event_row.status
  into v_event_creator, v_event_status
  from public.events as event_row
  where event_row.id = v_event_id
  for share;
  if not found then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_event_id)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    public.task_phase_lock_key(v_event_id, v_phase_key)
  );

  select task_row.event_id, task_row.phase, task_row.status, task_row.updated_at
  into v_event_id, v_phase, v_task_status, v_updated_at
  from public.tasks as task_row
  where task_row.id = p_task_id
  for update;
  if not found
     or public.canonical_task_phase(v_phase) is distinct from v_phase_key then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  select event_row.created_by, event_row.status
  into v_event_creator, v_event_status
  from public.events as event_row
  where event_row.id = v_event_id;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if ceit_connect_private.completed_phase_reopen_actor_allowed(
    p_task_id,
    v_actor,
    false
  ) is not true then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;
  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCQ04', message = 'Archived tasks cannot be reopened.';
  end if;
  if v_event_status not in ('Draft', 'Active') then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;

  if ceit_connect_private.completed_phase_reopen_actor_allowed(
    p_task_id,
    v_actor,
    true
  ) is not true then
    raise exception using errcode = 'CCQ03', message = 'This task cannot be reopened.';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = 'CCQ05',
      message = 'This task changed after it was loaded. Refresh and try again.';
  end if;
  if v_task_status is distinct from 'Completed' then
    raise exception using errcode = 'CCQ06', message = 'Only a completed task can reopen its phase.';
  end if;
  if public.task_phase_is_complete(v_event_id, v_phase_key) is not true then
    raise exception using errcode = 'CCQ07', message = 'This phase is no longer complete.';
  end if;

  insert into ceit_connect_private.completed_phase_reopen_context (
    transaction_id, task_id, event_id, phase_key
  ) values (
    pg_catalog.pg_current_xact_id(), p_task_id, v_event_id, v_phase_key
  );

  begin
    v_new_sort_order := public.task_lane_tail_sort_order(
      v_event_id,
      v_phase,
      'In Progress',
      p_task_id
    ) + 1024::bigint;
    if v_new_sort_order <= 0 then
      raise exception 'The destination rank could not be calculated safely.';
    end if;

    update public.tasks as task_row
    set status = 'In Progress', sort_order = v_new_sort_order
    where task_row.id = p_task_id
      and task_row.event_id = v_event_id
      and task_row.status = 'Completed'
      and task_row.updated_at = p_expected_updated_at;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using
        errcode = '40001',
        message = 'The task changed. Refresh and try again.';
    end if;

    delete from ceit_connect_private.completed_phase_reopen_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id();
  exception when others then
    delete from ceit_connect_private.completed_phase_reopen_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id();
    raise;
  end;

  if public.task_phase_is_complete(v_event_id, v_phase_key) then
    raise exception 'The phase did not reopen safely.';
  end if;

  return query
  select task_row.id,
         task_row.status,
         task_row.sort_order,
         v_phase_key,
         false
  from public.tasks as task_row
  where task_row.id = p_task_id and task_row.event_id = v_event_id;
end;
$$;

alter function public.reopen_completed_phase_task(uuid, timestamptz)
owner to postgres;
revoke all on function public.reopen_completed_phase_task(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.reopen_completed_phase_task(uuid, timestamptz)
to authenticated;
