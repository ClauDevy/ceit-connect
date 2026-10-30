# Batch 13c ? complete replaced-function review

Every old body below is copied from the latest pre-13c migration defining that signature. Every new body is copied from `20261030130000_draft_task_visibility.sql`. Renamed `*_pre13c` bodies are the old definitions and have no client grants.

## `task_content_access_for_user`

Behavior difference: Draft officers now receive real/masked/hidden; the Active/Archived tail is literal and unchanged.

<table><tr><th>Old ? 20261023160000_archived_task_viewers.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create or replace function public.task_content_access_for_user(
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
$$;</code></pre></td><td valign="top"><pre><code>create or replace function public.task_content_access_for_user(
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
$$;</code></pre></td></tr></table>

## `list_event_board_tasks`

Behavior difference: Inactive-first and committee-filter checks are preserved; Draft delegates to the fixed-shape editor reader; Active delegates to the literal revoked body.

<table><tr><th>Old ? 20261021130000_task_assignment_deletion_self_unassign.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create or replace function public.list_event_board_tasks(
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
  is_masked boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_caller_role text;
  v_event_status text;
  v_as_of timestamptz := statement_timestamp();
begin
  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = auth.uid()
    and user_row.is_active is true;

  if not found then
    return;
  end if;

  if p_committee_id is not null and v_caller_role &lt;&gt; 'Admin' then
    raise exception using
      errcode = '42501',
      message = 'Committee filtering is Admin-only.';
  end if;

  if p_committee_id is not null
     and not exists (
       select 1
       from public.committees committee_row
       where committee_row.id = p_committee_id
     ) then
    raise exception using
      errcode = '22023',
      message = 'Unknown committee filter.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = p_event_id;

  if not found or v_event_status not in ('Active', 'Draft') then
    return;
  end if;

  if v_event_status = 'Draft'
     and v_caller_role not in ('Admin', 'Co-Admin') then
    return;
  end if;

  return query
  with board_tasks as materialized (
    select
      task_row.id,
      task_row.title,
      task_row.phase,
      task_row.status,
      task_row.priority,
      task_row.due_date,
      task_row.committee_id,
      committee_row.name as committee_name,
      task_row.primary_assignees,
      task_row.assist_assignees,
      task_row.sort_order,
      public.task_content_access(task_row.id) as content_access
    from public.tasks task_row
    join public.committees committee_row
      on committee_row.id = task_row.committee_id
    where task_row.event_id = p_event_id
      and (
        p_committee_id is null
        or task_row.committee_id = p_committee_id
      )
  )
  select
    bt.id,
    case
      when bt.content_access = 'real' then bt.title
      else 'Confidential Task'
    end,
    bt.phase,
    bt.status,
    case
      when bt.content_access = 'real' then
        public.calculate_effective_task_priority(
          bt.priority,
          bt.due_date,
          v_as_of,
          bt.status
        )
      else null
    end,
    case when bt.content_access = 'real' then bt.due_date else null end,
    case when bt.content_access = 'real' then bt.committee_id else null end,
    case when bt.content_access = 'real' then bt.committee_name else null end,
    case
      when bt.content_access = 'real' then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', assignee.id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by assignee.position
          )
          from unnest(bt.primary_assignees)
            with ordinality as assignee(id, position)
          left join public.users user_row on user_row.id = assignee.id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    case
      when bt.content_access = 'real' then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', assignee.id,
              'full_name', user_row.full_name,
              'avatar_url', user_row.avatar_url
            )
            order by assignee.position
          )
          from unnest(bt.assist_assignees)
            with ordinality as assignee(id, position)
          left join public.users user_row on user_row.id = assignee.id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end,
    pg_catalog.cardinality(bt.primary_assignees) = 0
      and bt.status &lt;&gt; 'Completed',
    bt.content_access = 'masked'
  from board_tasks bt
  where (
    v_event_status = 'Active'
    and bt.content_access in ('real', 'masked')
  ) or (
    v_event_status = 'Draft'
    and bt.content_access = 'real'
  )
  order by bt.sort_order, bt.id;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.list_event_board_tasks(p_event_id uuid, p_committee_id uuid default null)
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
      and task_row.status &lt;&gt; 'Completed',
    editor_row.out_is_masked
  from public.list_draft_event_editor_tasks(p_event_id) as editor_row
  join public.tasks as task_row on task_row.id = editor_row.out_task_id
  where p_committee_id is null
    or editor_row.out_committee_id = p_committee_id
  order by task_row.sort_order, task_row.id;
end;
$$;</code></pre></td></tr></table>

## `edit_event_with_tasks`

Behavior difference: The ten-argument public boundary is replaced by the sole eleven-argument boundary; phase actions are validated before locks and rechecked after the Step 10 lock order; the Step 12 mutator remains unchanged/revoked.

<table><tr><th>Old ? 20261029150000_task_rules.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.edit_event_with_tasks(
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
    select public.task_assignee_uuid_or_null(task -&gt;&gt; 'id') as task_id
    from payload_tasks
    where operation = 'update'
      and pg_catalog.jsonb_typeof(task -&gt; 'id') = 'string'
      and public.task_assignee_uuid_or_null(task -&gt;&gt; 'id') is not null
  ),
  proposed_ids as (
    select public.task_assignee_uuid_or_null(assignee.value #&gt;&gt; '{}') as user_id
    from payload_tasks
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(task -&gt; 'assignee_ids') = 'array'
        then task -&gt; 'assignee_ids' else '[]'::jsonb end
    ) as assignee(value)
    where pg_catalog.jsonb_typeof(assignee.value) = 'string'
      and public.task_assignee_uuid_or_null(assignee.value #&gt;&gt; '{}') is not null
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
$$;</code></pre></td><td valign="top"><pre><code>create function public.edit_event_with_tasks(
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
  if case
       when p_phase_actions is null then true
       when pg_catalog.jsonb_typeof(p_phase_actions) &lt;&gt; 'array' then true
       else pg_catalog.jsonb_array_length(p_phase_actions) &gt; 50
     end then
    raise exception using errcode='22023',message='Phase actions are invalid.';
  end if;
  for v_action in select action_row.value from pg_catalog.jsonb_array_elements(p_phase_actions) as action_row(value) loop
    if pg_catalog.jsonb_typeof(v_action)&lt;&gt;'object' then
      raise exception using errcode='22023',message='Phase actions are invalid.';
    end if;
    v_action_type:=v_action-&gt;&gt;'type'; v_phase:=nullif(pg_catalog.btrim(v_action-&gt;&gt;'phase'),'');
    if v_action_type is null or v_action_type not in ('rename','delete') or v_phase is null
       or (v_action_type='rename' and nullif(pg_catalog.btrim(v_action-&gt;&gt;'next_phase'),'') is null) then
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
    select public.task_assignee_uuid_or_null(task-&gt;&gt;'id') task_id from payload_tasks
    where operation='update' and pg_catalog.jsonb_typeof(task-&gt;'id')='string'
      and public.task_assignee_uuid_or_null(task-&gt;&gt;'id') is not null
  ), proposed_ids as (
    select public.task_assignee_uuid_or_null(a.value#&gt;&gt;'{}') user_id from payload_tasks
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(task-&gt;'assignee_ids')='array' then task-&gt;'assignee_ids' else '[]'::jsonb end) a(value)
    where pg_catalog.jsonb_typeof(a.value)='string' and public.task_assignee_uuid_or_null(a.value#&gt;&gt;'{}') is not null
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
      and coalesce(nullif(pg_catalog.btrim(t.phase),''),'Unphased')=nullif(pg_catalog.btrim(a.value-&gt;&gt;'phase'),'')
    join public.events e on e.id=t.event_id and e.status='Draft'
    where t.committee_id is distinct from v_committee
  ) then
    raise exception using errcode='42501',message='A phase containing read-only tasks cannot be renamed or removed.';
  end if;
  return public.edit_event_with_tasks_step12(p_event_id,p_expected_updated_at,p_name,p_description,
    p_start_date,p_end_date,p_status,p_tasks_to_add,p_tasks_to_update,p_task_ids_to_delete);
end;
$$;</code></pre></td></tr></table>

## `set_task_dependency`

Behavior difference: A pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261020120000_task_dependency_confidentiality_controls.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.set_task_dependency(
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
  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
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

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
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
  if v_affected &lt;&gt; 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  task_id := v_result_task_id;
  depends_on_task_id := v_result_dependency_id;
  return next;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.set_task_dependency(p_task_id uuid,p_depends_on_task_id uuid)
returns table(task_id uuid,depends_on_task_id uuid) language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='You are not allowed to change this Draft task.'; end if;
  return query select * from public.set_task_dependency_pre13c(p_task_id,p_depends_on_task_id);
end $$;</code></pre></td></tr></table>

## `assign_task_people`

Behavior difference: A pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261027130000_task_assignee_locking_hardening.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create or replace function public.assign_task_people(
  p_task_id uuid,
  p_primary_assignees uuid[],
  p_assist_assignees uuid[]
)
returns table (
  out_task_id uuid,
  out_status text,
  out_sort_order bigint,
  out_primary_assignees uuid[],
  out_assist_assignees uuid[]
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
  v_task_phase text;
  v_task_status text;
  v_task_sort_order bigint;
  v_stored_primary_assignees uuid[];
  v_stored_assist_assignees uuid[];
  v_new_status text;
  v_new_sort_order bigint;
  v_constraint_was_deferred boolean := false;
  v_affected integer;
  v_lock_user_ids uuid[] := '{}'::uuid[];
begin
  if p_task_id is null
     or p_primary_assignees is null
     or p_assist_assignees is null then
    raise exception using
      errcode = '22023',
      message = 'A task and both assignee lists are required.';
  end if;

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
      message = 'Only an active Admin or Co-Admin can assign task people.';
  end if;

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its assignees.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees)
       + pg_catalog.cardinality(p_assist_assignees) &gt; 100 then
    raise exception using
      errcode = '22023',
      message = 'A task cannot have more than 100 assignees.';
  end if;

  if pg_catalog.array_position(p_primary_assignees, null::uuid) is not null
     or pg_catalog.array_position(p_assist_assignees, null::uuid) is not null then
    raise exception using
      errcode = '22023',
      message = 'Assignee lists cannot contain null values.';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct user_id order by user_id), '{}'::uuid[]
  )
  into v_lock_user_ids
  from (
    select proposed.user_id
    from pg_catalog.unnest(
      p_primary_assignees || p_assist_assignees
    ) as proposed(user_id)
    union
    select stored.user_id
    from public.tasks as discovered_task
    cross join lateral pg_catalog.unnest(
      discovered_task.primary_assignees || discovered_task.assist_assignees
    ) as stored(user_id)
    where discovered_task.id = p_task_id
  ) as affected
  join public.users as lock_user on lock_user.id = affected.user_id;

  perform public.lock_task_assignee_users(v_lock_user_ids);

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

  select
    task_row.event_id,
    task_row.phase,
    task_row.status,
    task_row.sort_order,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    v_task_event_id,
    v_task_phase,
    v_task_status,
    v_task_sort_order,
    v_stored_primary_assignees,
    v_stored_assist_assignees
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(
      v_stored_primary_assignees || v_stored_assist_assignees
    ) as stored(user_id)
    join public.users as lock_user on lock_user.id = stored.user_id
    where not stored.user_id = any(v_lock_user_ids)
  ) then
    raise exception using
      errcode = '40001',
      message = 'The task assignments changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its assignees.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees) &lt;&gt;
       (select count(distinct proposed.id) from unnest(p_primary_assignees) proposed(id))
     or pg_catalog.cardinality(p_assist_assignees) &lt;&gt;
       (select count(distinct proposed.id) from unnest(p_assist_assignees) proposed(id)) then
    raise exception using
      errcode = '22023',
      message = 'Each assignee may appear only once in a list.';
  end if;

  if p_primary_assignees &amp;&amp; p_assist_assignees then
    raise exception using
      errcode = '22023',
      message = 'A person cannot be both a primary and assist assignee.';
  end if;

  if exists (
    select 1
    from unnest(p_primary_assignees) proposed(id)
    left join public.users user_row on user_row.id = proposed.id
    where user_row.id is null
       or (
         user_row.is_active is not true
         and not (proposed.id = any(v_stored_primary_assignees))
       )
  ) or exists (
    select 1
    from unnest(p_assist_assignees) proposed(id)
    left join public.users user_row on user_row.id = proposed.id
    where user_row.id is null
       or (
         user_row.is_active is not true
         and not (proposed.id = any(v_stored_assist_assignees))
       )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every assignee must exist, and newly added assignees must be active.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees) =
       pg_catalog.cardinality(v_stored_primary_assignees)
     and p_primary_assignees &lt;@ v_stored_primary_assignees
     and pg_catalog.cardinality(p_assist_assignees) =
       pg_catalog.cardinality(v_stored_assist_assignees)
     and p_assist_assignees &lt;@ v_stored_assist_assignees then
    raise exception using
      errcode = 'CCN01',
      message = 'Assignees are already up to date.';
  end if;

  v_new_status := v_task_status;
  v_new_sort_order := v_task_sort_order;

  if v_task_status not in ('To Do', 'Completed')
     and pg_catalog.cardinality(p_primary_assignees) = 0 then
    select
      reset_row.out_reset_status,
      reset_row.out_reset_sort_order,
      reset_row.out_constraint_was_deferred
    into
      v_new_status,
      v_new_sort_order,
      v_constraint_was_deferred
    from public.prepare_unassigned_task_reset(
      v_locked_event_id,
      p_task_id,
      v_task_phase
    ) reset_row;
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'assign_task_people', true
  );

  update public.tasks as task_row
  set primary_assignees = p_primary_assignees,
      assist_assignees = p_assist_assignees,
      status = v_new_status,
      sort_order = v_new_sort_order
  where task_row.id = p_task_id
    and task_row.event_id = v_locked_event_id
  returning
    task_row.id,
    task_row.status,
    task_row.sort_order,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    out_task_id,
    out_status,
    out_sort_order,
    out_primary_assignees,
    out_assist_assignees;

  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  if v_affected &lt;&gt; 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_constraint_was_deferred then
    set constraints public.tasks_lane_sort_order_key immediate;
  end if;

  return next;
exception
  when others then
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', '', true
    );
    raise;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.assign_task_people(p_task_id uuid,p_primary_assignees uuid[],p_assist_assignees uuid[])
returns table(out_task_id uuid,out_status text,out_sort_order bigint,out_primary_assignees uuid[],out_assist_assignees uuid[])
language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='You are not allowed to change this Draft task.'; end if;
  return query select * from public.assign_task_people_pre13c(p_task_id,p_primary_assignees,p_assist_assignees);
end $$;</code></pre></td></tr></table>

## `delete_task`

Behavior difference: A pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261021130000_task_assignment_deletion_self_unassign.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.delete_task(p_task_id uuid)
returns table (
  out_task_id uuid
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
  v_task_status text;
  v_affected integer;
begin
  if p_task_id is null then
    raise exception using
      errcode = '22023',
      message = 'A task is required.';
  end if;

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
      message = 'Only an active Admin or Co-Admin can delete a task.';
  end if;

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to delete it.';
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
  for update;

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

  select task_row.event_id, task_row.status
  into v_task_event_id, v_task_status
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found or v_task_event_id is distinct from v_locked_event_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to delete it.';
  end if;

  if v_task_status &lt;&gt; 'To Do' then
    raise exception using
      errcode = '22023',
      message = 'Only a To Do task can be deleted.';
  end if;

  if exists (
    select 1
    from public.tasks dependent
    where dependent.depends_on_task_id = p_task_id
  ) then
    raise exception using
      errcode = 'CCD01',
      message = 'This task cannot be deleted because another task depends on it.';
  end if;

  if v_event_status = 'Active'
     and not exists (
       select 1
       from public.tasks other_task
       where other_task.event_id = v_locked_event_id
         and other_task.id &lt;&gt; p_task_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'An Active event must have at least one task.';
  end if;

  delete from public.tasks as task_row
  where task_row.id = p_task_id
    and task_row.event_id = v_locked_event_id
  returning task_row.id into out_task_id;

  get diagnostics v_affected = row_count;
  if v_affected &lt;&gt; 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  return next;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.delete_task(p_task_id uuid) returns table(out_task_id uuid)
language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='You are not allowed to change this Draft task.'; end if;
  return query select * from public.delete_task_pre13c(p_task_id);
end $$;</code></pre></td></tr></table>

## `add_task_work_link`

Behavior difference: A pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261017150000_task_work_links.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.add_task_work_link(
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

  if v_name is not null and char_length(v_name) &gt; 120 then
    raise exception using
      errcode = '22023',
      message = 'Work-link name must be 120 characters or fewer.';
  end if;

  if v_url is null
     or char_length(v_url) &gt; 512
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
$$;</code></pre></td><td valign="top"><pre><code>create function public.add_task_work_link(p_task_id uuid,p_name text,p_url text)
returns table(id uuid,name text,url text,created_at timestamptz)
language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  return query select prior_row.id,prior_row.name,prior_row.url,prior_row.created_at
  from public.add_task_work_link_pre13c(p_task_id,p_name,p_url) as prior_row;
end $$;</code></pre></td></tr></table>

## `remove_task_work_link`

Behavior difference: The link is resolved and a pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261017150000_task_work_links.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.remove_task_work_link(p_link_id uuid)
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
     or public.task_content_access(v_task_id) &lt;&gt; 'real' then
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
  if v_affected &lt;&gt; 1 then
    raise exception using
      errcode = 'CCL06',
      message = 'Work link not found.';
  end if;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.remove_task_work_link(p_link_id uuid) returns void
language plpgsql volatile security definer set search_path=''
as $$ declare v_task uuid; begin
  select task_id into v_task from public.task_work_links where id=p_link_id;
  if v_task is null or public.draft_task_write_allowed_for_user(v_task,auth.uid()) is not true then raise exception using errcode='42501',message='Work-link access is not allowed.'; end if;
  perform public.remove_task_work_link_pre13c(p_link_id);
end $$;</code></pre></td></tr></table>

## `add_task_comment`

Behavior difference: A pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261023130000_task_comments.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.add_task_comment(
  p_task_id uuid,
  p_body text,
  p_is_heads_up boolean default false,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns table (
  out_id uuid,
  out_created_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_event_id uuid;
  v_event_status text;
  v_body text;
  v_mentions uuid[];
  v_affected integer;
begin
  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = p_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1 from public.tasks task_row
    where task_row.id = p_task_id and task_row.event_id = v_event_id
  ) then
    raise exception using errcode = '40001', message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCC05', message = 'Archived task comments are read-only.';
  end if;

  v_body := public.task_comment_trim_body(p_body);
  if v_body is null or char_length(v_body) not between 1 and 4000
     or p_is_heads_up is null then
    raise exception using errcode = 'CCC03', message = 'A comment must contain between 1 and 4000 characters.';
  end if;

  v_mentions := public.normalize_task_comment_mentions(p_mentioned_user_ids);
  if not public.task_comment_mentions_are_valid(p_task_id, v_mentions) then
    raise exception using errcode = 'CCC04', message = 'Every mentioned user must be an available active user with full task access.';
  end if;

  insert into public.task_comments (
    task_id,
    created_by,
    body,
    is_heads_up,
    mentioned_user_ids
  )
  values (
    p_task_id,
    v_caller_id,
    v_body,
    p_is_heads_up,
    v_mentions
  )
  returning task_comments.id, task_comments.created_at
  into out_id, out_created_at;

  get diagnostics v_affected = row_count;
  if v_affected &lt;&gt; 1 then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  return next;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.add_task_comment(p_task_id uuid,p_body text,p_is_heads_up boolean default false,p_mentioned_user_ids uuid[] default '{}')
returns table(out_id uuid,out_created_at timestamptz) language plpgsql volatile security definer set search_path=''
as $$ begin
  if public.draft_task_write_allowed_for_user(p_task_id,auth.uid()) is not true then raise exception using errcode='42501',message='The task comments are unavailable.'; end if;
  return query select * from public.add_task_comment_pre13c(p_task_id,p_body,p_is_heads_up,p_mentioned_user_ids);
end $$;</code></pre></td></tr></table>

## `edit_task_comment`

Behavior difference: The comment task is resolved and a pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261023130000_task_comments.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.edit_task_comment(
  p_comment_id uuid,
  p_body text,
  p_is_heads_up boolean,
  p_mentioned_user_ids uuid[],
  p_expected_edited_at timestamptz
)
returns table (
  out_id uuid,
  out_edited_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_task_id uuid;
  v_event_id uuid;
  v_event_status text;
  v_creator_id uuid;
  v_stored_body text;
  v_stored_heads_up boolean;
  v_stored_mentions uuid[];
  v_stored_edited_at timestamptz;
  v_body text;
  v_mentions uuid[];
  v_affected integer;
begin
  select comment_row.task_id
  into v_task_id
  from public.task_comments comment_row
  where comment_row.id = p_comment_id;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if public.task_content_access(v_task_id) &lt;&gt; 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1 from public.tasks task_row
    where task_row.id = v_task_id and task_row.event_id = v_event_id
  ) then
    raise exception using errcode = '40001', message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(v_task_id) &lt;&gt; 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCC05', message = 'Archived task comments are read-only.';
  end if;

  select
    comment_row.created_by,
    comment_row.body,
    comment_row.is_heads_up,
    comment_row.mentioned_user_ids,
    comment_row.edited_at
  into
    v_creator_id,
    v_stored_body,
    v_stored_heads_up,
    v_stored_mentions,
    v_stored_edited_at
  from public.task_comments comment_row
  where comment_row.id = p_comment_id
    and comment_row.task_id = v_task_id
  for update;

  if not found then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  if v_creator_id is distinct from v_caller_id then
    raise exception using errcode = 'CCC06', message = 'Only the comment author can edit it.';
  end if;

  if v_stored_edited_at is distinct from p_expected_edited_at then
    raise exception using errcode = 'CCC08', message = 'The comment changed. Refresh and try again.';
  end if;

  v_body := public.task_comment_trim_body(p_body);
  if v_body is null or char_length(v_body) not between 1 and 4000
     or p_is_heads_up is null then
    raise exception using errcode = 'CCC03', message = 'A comment must contain between 1 and 4000 characters.';
  end if;

  v_mentions := public.normalize_task_comment_mentions(p_mentioned_user_ids);
  if not public.task_comment_mentions_are_valid(v_task_id, v_mentions) then
    raise exception using errcode = 'CCC04', message = 'Every mentioned user must be an available active user with full task access.';
  end if;

  if (v_body, p_is_heads_up, v_mentions)
     is not distinct from (v_stored_body, v_stored_heads_up, v_stored_mentions) then
    raise exception using errcode = 'CCC09', message = 'Make a change before saving the comment.';
  end if;

  update public.task_comments comment_row
  set
    body = v_body,
    is_heads_up = p_is_heads_up,
    mentioned_user_ids = v_mentions
  where comment_row.id = p_comment_id
    and comment_row.task_id = v_task_id
  returning comment_row.id, comment_row.edited_at
  into out_id, out_edited_at;

  get diagnostics v_affected = row_count;
  if v_affected &lt;&gt; 1 then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  return next;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.edit_task_comment(p_comment_id uuid,p_body text,p_is_heads_up boolean,p_mentioned_user_ids uuid[],p_expected_edited_at timestamptz)
returns table(out_id uuid,out_edited_at timestamptz) language plpgsql volatile security definer set search_path=''
as $$ declare v_task uuid; begin
  select task_id into v_task from public.task_comments where id=p_comment_id;
  if v_task is null or public.draft_task_write_allowed_for_user(v_task,auth.uid()) is not true then raise exception using errcode='42501',message='The task comments are unavailable.'; end if;
  return query select * from public.edit_task_comment_pre13c(p_comment_id,p_body,p_is_heads_up,p_mentioned_user_ids,p_expected_edited_at);
end $$;</code></pre></td></tr></table>

## `delete_task_comment`

Behavior difference: The comment task is resolved and a pre-lock Draft committee gate precedes the literal old body.

<table><tr><th>Old ? 20261023130000_task_comments.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.delete_task_comment(p_comment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_task_id uuid;
  v_event_id uuid;
  v_event_status text;
  v_creator_id uuid;
  v_affected integer;
begin
  select comment_row.task_id
  into v_task_id
  from public.task_comments comment_row
  where comment_row.id = p_comment_id;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if public.task_content_access(v_task_id) &lt;&gt; 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1 from public.tasks task_row
    where task_row.id = v_task_id and task_row.event_id = v_event_id
  ) then
    raise exception using errcode = '40001', message = 'The task changed. Refresh and try again.';
  end if;

  if public.task_content_access(v_task_id) &lt;&gt; 'real' then
    raise exception using errcode = 'CCC01', message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using errcode = 'CCC05', message = 'Archived task comments are read-only.';
  end if;

  select user_row.role, comment_row.created_by
  into v_caller_role, v_creator_id
  from public.users user_row
  join public.task_comments comment_row
    on comment_row.id = p_comment_id
   and comment_row.task_id = v_task_id
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;

  if v_creator_id is distinct from v_caller_id
     and v_caller_role &lt;&gt; 'Admin' then
    raise exception using errcode = 'CCC07', message = 'You cannot delete this comment.';
  end if;

  delete from public.task_comments comment_row
  where comment_row.id = p_comment_id
    and comment_row.task_id = v_task_id;

  get diagnostics v_affected = row_count;
  if v_affected &lt;&gt; 1 then
    raise exception using errcode = '40001', message = 'The comment changed. Refresh and try again.';
  end if;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.delete_task_comment(p_comment_id uuid) returns void
language plpgsql volatile security definer set search_path=''
as $$ declare v_task uuid; begin
  select task_id into v_task from public.task_comments where id=p_comment_id;
  if v_task is null or public.draft_task_write_allowed_for_user(v_task,auth.uid()) is not true then raise exception using errcode='42501',message='The task comments are unavailable.'; end if;
  perform public.delete_task_comment_pre13c(p_comment_id);
end $$;</code></pre></td></tr></table>

## `get_task_edit_controls`

Behavior difference: Draft cross-committee Co-Admins receive a fixed all-false/empty capability shape; all other calls delegate unchanged.

<table><tr><th>Old ? 20261028120000_task_updated_at_and_readers.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.get_task_edit_controls(p_task_id uuid)
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

  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
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
    when not v_is_self_assigned or v_task_event_status &lt;&gt; 'Active' then null
    when v_task_status = 'Completed' then 'completed'
    when v_task_due_date is not null
         and v_task_due_date &lt;= statement_timestamp() + c_self_unassign_cutoff
      then 'due'
    else null
  end;

  v_self_unassign_will_lose_access :=
    v_is_self_assigned
    and v_task_is_confidential
    and v_caller_role &lt;&gt; 'Admin'
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
              and candidate.id &lt;&gt; p_task_id
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
$$;</code></pre></td><td valign="top"><pre><code>create function public.get_task_edit_controls(p_task_id uuid)
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
    if v_content_access &lt;&gt; 'real' then
      return;
    end if;
    return query select false,false,false,false,false,false,null::text,false,
      null::uuid,null::boolean,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
      '[]'::jsonb,'[]'::jsonb,'[]'::jsonb;
    return;
  end if;

  return query select * from public.get_task_edit_controls_pre13c(p_task_id);
end $$;</code></pre></td></tr></table>

## `get_task_work_links`

Behavior difference: Draft cross-committee real rows retain safe links with can_add/can_remove false; masked rows receive no link content; all other calls delegate unchanged.

<table><tr><th>Old ? 20261017170000_work_link_can_remove_boolean.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create or replace function public.get_task_work_links(p_task_id uuid)
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
     or public.task_content_access(p_task_id) &lt;&gt; 'real' then
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

  v_can_add := v_event_status &lt;&gt; 'Archived'
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
            coalesce(
              v_event_status &lt;&gt; 'Archived'
              and (
                l.created_by = v_caller_id
                or v_caller_role in ('Admin', 'Co-Admin')
              ),
              false
            )
        )
        order by l.created_at, l.id
      ) filter (where l.id is not null),
      '[]'::jsonb
    )
  from public.task_work_links l
  where l.task_id = p_task_id;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.get_task_work_links(p_task_id uuid)
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
    if v_access &lt;&gt; 'real' then
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
end $$;</code></pre></td></tr></table>

## `list_task_comments`

Behavior difference: Draft cross-committee real rows retain comments but can_edit/can_delete are forced false; all other calls delegate unchanged.

<table><tr><th>Old ? 20261023130000_task_comments.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.list_task_comments(
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
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_status text;
begin
  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if p_limit is null or p_limit &lt; 1 or p_limit &gt; 50
     or ((p_before_created_at is null) &lt;&gt; (p_before_id is null)) then
    raise exception using
      errcode = 'CCC02',
      message = 'Comment pagination is invalid.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  return query
  with candidates as materialized (
    select comment_row.*
    from public.task_comments comment_row
    where comment_row.task_id = p_task_id
      and (
        p_before_created_at is null
        or (comment_row.created_at, comment_row.id)
          &lt; (p_before_created_at, p_before_id)
      )
    order by comment_row.created_at desc, comment_row.id desc
    limit p_limit + 1
  ),
  page as (
    select candidate.*
    from candidates candidate
    order by candidate.created_at desc, candidate.id desc
    limit p_limit
  )
  select
    page.id,
    page.body,
    page.is_heads_up,
    page.created_at,
    page.edited_at,
    author.id,
    author.full_name,
    author.avatar_url,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', mentioned_user.id,
            'full_name', mentioned_user.full_name
          )
          order by mentioned_user.full_name, mentioned_user.id
        )
        from unnest(page.mentioned_user_ids) mentions(mention_id)
        join public.users mentioned_user
          on mentioned_user.id = mentions.mention_id
      ),
      '[]'::jsonb
    ),
    v_event_status &lt;&gt; 'Archived' and page.created_by = v_caller_id,
    v_event_status &lt;&gt; 'Archived'
      and (page.created_by = v_caller_id or v_caller_role = 'Admin'),
    (select count(*) &gt; p_limit from candidates)
  from page
  join public.users author on author.id = page.created_by
  order by page.created_at desc, page.id desc;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.list_task_comments(
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
end $$;</code></pre></td></tr></table>

## `list_task_comment_mention_candidates`

Behavior difference: Draft callers without write scope receive zero candidates; all other calls delegate unchanged.

<table><tr><th>Old ? 20261023130000_task_comments.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.list_task_comment_mention_candidates(
  p_task_id uuid,
  p_search text default null,
  p_limit integer default 20
)
returns table (
  out_id uuid,
  out_full_name text,
  out_avatar_url text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := public.task_comment_trim_body(p_search);
begin
  if public.task_content_access(p_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if p_limit is null or p_limit &lt; 1 or p_limit &gt; 20
     or char_length(v_search) &gt; 100 then
    raise exception using
      errcode = 'CCC02',
      message = 'Mention search is invalid.';
  end if;

  return query
  select
    candidate.id,
    candidate.full_name,
    candidate.avatar_url
  from public.users candidate
  where candidate.is_active is true
    and public.task_content_access_for_user(
      p_task_id,
      candidate.id
    ) = 'real'
    and (
      v_search is null
      or v_search = ''
      or strpos(lower(candidate.full_name), lower(v_search)) &gt; 0
    )
  order by candidate.full_name, candidate.id
  limit p_limit;
end;
$$;</code></pre></td><td valign="top"><pre><code>create function public.list_task_comment_mention_candidates(
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
end $$;</code></pre></td></tr></table>

## `guard_task_work_link_writes`

Behavior difference: The same trigger function/binding adds the Draft committee check before locks and repeats it after locks.

<table><tr><th>Old ? 20261017150000_task_work_links.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.guard_task_work_link_writes()
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
  if TG_OP = 'DELETE' and pg_trigger_depth() &gt; 1 then
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
     or public.task_content_access(v_task_id) &lt;&gt; 'real' then
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

    if v_link_count &gt;= 20 then
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
$$;</code></pre></td><td valign="top"><pre><code>create or replace function public.guard_task_work_link_writes()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_task_id uuid := case when TG_OP='INSERT' then new.task_id else old.task_id end;
  v_event_id uuid; v_event_status text; v_primary_assignees uuid[];
  v_assist_assignees uuid[]; v_caller_role text; v_link_count integer;
begin
  if TG_OP='DELETE' and pg_catalog.pg_trigger_depth()&gt;1 then return old; end if;
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
  if not found or public.task_content_access(v_task_id)&lt;&gt;'real' then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  if TG_OP='INSERT' then
    if not coalesce(auth.uid()=any(v_primary_assignees),false)
       and not coalesce(auth.uid()=any(v_assist_assignees),false) then
      raise exception using errcode='42501',message='Only an active task assignee can add work links.';
    end if;
    select pg_catalog.count(*) into v_link_count from public.task_work_links as link_row
    where link_row.task_id=v_task_id;
    if v_link_count&gt;=20 then
      raise exception using errcode='CCL04',message='A task can have at most 20 work links.';
    end if;
    new.created_by:=auth.uid(); return new;
  end if;
  if old.created_by is distinct from auth.uid()
     and v_caller_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only the link creator, an active Admin, or an active Co-Admin can remove this work link.';
  end if;
  return old;
end $$;</code></pre></td></tr></table>

## `guard_task_comment_writes`

Behavior difference: The same trigger function/binding adds the Draft committee check before locks and repeats it after locks.

<table><tr><th>Old ? 20261023130000_task_comments.sql</th><th>New ? 20261030130000</th></tr><tr><td valign="top"><pre><code>create function public.guard_task_comment_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
  v_body text;
  v_mentions uuid[];
begin
  if TG_OP = 'UPDATE'
     and new.task_id is distinct from old.task_id then
    raise exception using
      errcode = 'CCC10',
      message = 'A comment cannot be moved to another task.';
  end if;

  -- Child-specific parent lock order: task first, then its stored event.
  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    if TG_OP = 'DELETE' and pg_trigger_depth() &gt; 1 then
      return old;
    end if;

    raise exception using
      errcode = '40001',
      message = 'The comment task changed. Refresh and try again.';
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
      message = 'The comment task changed. Refresh and try again.';
  end if;

  if public.task_content_access(v_task_id) &lt;&gt; 'real' then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCC05',
      message = 'Archived task comments are read-only.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found then
    raise exception using
      errcode = 'CCC01',
      message = 'The task comments are unavailable.';
  end if;

  if TG_OP = 'DELETE' then
    if old.created_by is distinct from v_caller_id
       and v_caller_role &lt;&gt; 'Admin' then
      raise exception using
        errcode = 'CCC07',
        message = 'You cannot delete this comment.';
    end if;

    return old;
  end if;

  v_body := public.task_comment_trim_body(new.body);
  if v_body is null or char_length(v_body) not between 1 and 4000
     or new.is_heads_up is null then
    raise exception using
      errcode = 'CCC03',
      message = 'A comment must contain between 1 and 4000 characters.';
  end if;

  v_mentions := public.normalize_task_comment_mentions(
    new.mentioned_user_ids
  );

  if not public.task_comment_mentions_are_valid(
    v_task_id,
    v_mentions
  ) then
    raise exception using
      errcode = 'CCC04',
      message = 'Every mentioned user must be an available active user with full task access.';
  end if;

  new.body := v_body;
  new.mentioned_user_ids := v_mentions;

  if TG_OP = 'INSERT' then
    new.created_by := v_caller_id;
    new.created_at := clock_timestamp();
    new.edited_at := null;
    return new;
  end if;

  if old.created_by is distinct from v_caller_id then
    raise exception using
      errcode = 'CCC06',
      message = 'Only the comment author can edit it.';
  end if;

  if (
    new.id,
    new.task_id,
    new.created_by,
    new.created_at
  ) is distinct from (
    old.id,
    old.task_id,
    old.created_by,
    old.created_at
  ) then
    raise exception using
      errcode = 'CCC10',
      message = 'Comment identity and creation fields are immutable.';
  end if;

  if (
    new.body,
    new.is_heads_up,
    new.mentioned_user_ids
  ) is not distinct from (
    old.body,
    old.is_heads_up,
    old.mentioned_user_ids
  ) then
    raise exception using
      errcode = 'CCC09',
      message = 'Make a change before saving the comment.';
  end if;

  new.edited_at := clock_timestamp();
  return new;
end;
$$;</code></pre></td><td valign="top"><pre><code>create or replace function public.guard_task_comment_writes()
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
    if TG_OP='DELETE' and pg_catalog.pg_trigger_depth()&gt;1 then return old; end if;
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
  if public.task_content_access(v_task_id)&lt;&gt;'real' then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  if v_event_status='Archived' then
    raise exception using errcode='CCC05',message='Archived task comments are read-only.';
  end if;
  select user_row.role into v_caller_role from public.users as user_row
  where user_row.id=v_caller_id and user_row.is_active is true;
  if not found then raise exception using errcode='CCC01',message='The task comments are unavailable.'; end if;
  if TG_OP='DELETE' then
    if old.created_by is distinct from v_caller_id and v_caller_role&lt;&gt;'Admin' then
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
end $$;</code></pre></td></tr></table>

## Literal Active/Archived tail diff ? `task_content_access_for_user`

```diff
Tail differs only in the closing dollar tag/comment context; the executable branch text above is copied literally.
```

## Literal delegated-body diffs

`list_event_board_tasks` Active calls and every gated writer Active/Archived call invoke the renamed `*_pre13c` catalog object with unchanged arguments. Renaming does not rewrite `prosrc`, so each delegated body has this literal diff:

```diff
 (no differences)
```
