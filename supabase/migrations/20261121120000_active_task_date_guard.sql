create or replace function public.create_active_event_task_step12(
  p_event_id uuid,
  p_title text,
  p_description text,
  p_phase text,
  p_committee_id uuid,
  p_task_type text,
  p_priority text,
  p_due_date timestamptz,
  p_call_time timestamptz,
  p_end_time timestamptz,
  p_primary_assignees uuid[],
  p_is_confidential boolean,
  p_allowed_viewers uuid[]
)
returns table (out_task_id uuid, out_updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_role text;
  v_my_committee_id uuid;
  v_event_status text;
  v_lock_user_ids uuid[];
  v_affected integer;
begin
  perform public.validate_active_event_task_payload(
    p_title, p_description, p_phase, p_task_type, p_priority,
    p_call_time, p_end_time, p_primary_assignees,
    p_is_confidential, p_allowed_viewers
  );

  select user_row.role, user_row.committee_id
  into v_role, v_my_committee_id
  from public.users user_row
  where user_row.id = v_caller_id and user_row.is_active is true;

  if v_caller_id is null or not found
     or v_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = '42501',
      message = 'Only an active Admin or Co-Admin can add tasks.';
  end if;

  select coalesce(pg_catalog.array_agg(id order by id), '{}'::uuid[])
  into v_lock_user_ids
  from (
    select id from pg_catalog.unnest(p_primary_assignees) proposed(id)
    group by id
  ) ids
  join public.users user_row using (id);

  perform public.lock_task_assignee_users(v_lock_user_ids);

  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = p_event_id
  for share;

  if not found or v_event_status <> 'Active' then
    raise exception using errcode = '42501',
      message = 'Tasks can be added here only while the event is Active.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(p_event_id)
  );

  select user_row.role, user_row.committee_id
  into v_role, v_my_committee_id
  from public.users user_row
  where user_row.id = v_caller_id and user_row.is_active is true;

  if not found or v_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = '42501',
      message = 'Your account no longer has permission to add tasks.';
  end if;

  if v_role = 'Co-Admin'
     and p_committee_id is distinct from v_my_committee_id then
    raise exception using errcode = '42501',
      message = 'Co-Admins may add tasks only for their current committee.';
  end if;

  if p_due_date is not null
     and (p_due_date at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD07',
      message = 'Choose today or a later due date.';
  end if;

  if p_call_time is not null
     and (p_call_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD08',
      message = 'Choose today or a later duty date.';
  end if;

  if p_end_time is not null
     and (p_end_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD09',
      message = 'Choose today or a later end date.';
  end if;

  if not exists (
    select 1 from public.committees c where c.id = p_committee_id
  ) then
    raise exception using errcode = '22023',
      message = 'The task committee is invalid.';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(
      p_primary_assignees || p_allowed_viewers
    ) proposed(id)
    left join public.users user_row
      on user_row.id = proposed.id and user_row.is_active is true
    where user_row.id is null
  ) then
    raise exception using errcode = '22023',
      message = 'Every assignee and additional viewer must be active.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'create_active_event_task', true
  );

  insert into public.tasks (
    event_id, committee_id, title, description, phase, priority,
    task_type, due_date, call_time, end_time, primary_assignees,
    assist_assignees, is_confidential, allowed_viewers
  ) values (
    p_event_id, p_committee_id, pg_catalog.btrim(p_title),
    nullif(pg_catalog.btrim(p_description), ''), pg_catalog.btrim(p_phase),
    p_priority, p_task_type, p_due_date, p_call_time, p_end_time,
    p_primary_assignees, '{}'::uuid[], p_is_confidential, p_allowed_viewers
  )
  returning id, updated_at into out_task_id, out_updated_at;

  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  if v_affected <> 1 then
    raise exception using errcode = '40001',
      message = 'The task could not be created safely.';
  end if;

  return next;
exception when others then
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  raise;
end;
$$;

alter function public.create_active_event_task_step12(
  uuid, text, text, text, uuid, text, text, timestamptz,
  timestamptz, timestamptz, uuid[], boolean, uuid[]
) owner to postgres;
revoke all on function public.create_active_event_task_step12(
  uuid, text, text, text, uuid, text, text, timestamptz,
  timestamptz, timestamptz, uuid[], boolean, uuid[]
) from public, anon, authenticated, service_role;

create or replace function public.edit_active_event_task_step12(
  p_task_id uuid,
  p_expected_updated_at timestamptz,
  p_title text,
  p_description text,
  p_phase text,
  p_committee_id uuid,
  p_task_type text,
  p_priority text,
  p_due_date timestamptz,
  p_call_time timestamptz,
  p_end_time timestamptz,
  p_primary_assignees uuid[],
  p_is_confidential boolean,
  p_allowed_viewers uuid[]
)
returns table (
  out_task_id uuid,
  out_updated_at timestamptz,
  out_status text,
  out_sort_order bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_role text;
  v_my_committee_id uuid;
  v_discovered_event_id uuid;
  v_stored_event_id uuid;
  v_event_status text;
  v_stored_committee_id uuid;
  v_stored_title text;
  v_stored_description text;
  v_stored_phase text;
  v_stored_task_type text;
  v_stored_priority text;
  v_stored_due_date timestamptz;
  v_stored_call_time timestamptz;
  v_stored_end_time timestamptz;
  v_stored_primary uuid[];
  v_stored_assists uuid[];
  v_stored_confidential boolean;
  v_stored_viewers uuid[];
  v_stored_status text;
  v_stored_sort_order bigint;
  v_stored_updated_at timestamptz;
  v_new_assists uuid[];
  v_new_status text;
  v_new_sort_order bigint;
  v_constraint_was_deferred boolean := false;
  v_lock_user_ids uuid[];
  v_authoritative_lock_user_ids uuid[];
  v_affected integer;
begin
  if p_task_id is null or p_expected_updated_at is null then
    raise exception using errcode = '22023',
      message = 'A task and its updated_at token are required.';
  end if;

  perform public.validate_active_event_task_payload(
    p_title, p_description, p_phase, p_task_type, p_priority,
    p_call_time, p_end_time, p_primary_assignees,
    p_is_confidential, p_allowed_viewers
  );

  select user_row.role, user_row.committee_id
  into v_role, v_my_committee_id
  from public.users user_row
  where user_row.id = v_caller_id and user_row.is_active is true;

  if v_caller_id is null or not found
     or v_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = '42501',
      message = 'Only an active Admin or Co-Admin can edit tasks.';
  end if;

  -- No confidential content or assignment arrays are read until the caller
  -- has real content access through the existing restricted reader model.
  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using errcode = '42501',
      message = 'You need full access to this task to edit it.';
  end if;

  select task_row.event_id, task_row.primary_assignees,
         task_row.assist_assignees
  into v_discovered_event_id, v_stored_primary, v_stored_assists
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using errcode = '42501',
      message = 'The task is unavailable.';
  end if;

  select coalesce(pg_catalog.array_agg(id order by id), '{}'::uuid[])
  into v_lock_user_ids
  from (
    select id
    from pg_catalog.unnest(
      p_primary_assignees || v_stored_primary || v_stored_assists
    ) proposed(id)
    group by id
  ) ids
  join public.users user_row using (id);

  perform public.lock_task_assignee_users(v_lock_user_ids);

  select event_row.id, event_row.status
  into v_stored_event_id, v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found or v_event_status <> 'Active' then
    raise exception using errcode = '42501',
      message = 'Tasks can be edited here only while the event is Active.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_stored_event_id)
  );

  select
    task_row.committee_id, task_row.title, task_row.description,
    task_row.phase, task_row.task_type, task_row.priority,
    task_row.due_date, task_row.call_time, task_row.end_time,
    task_row.primary_assignees, task_row.assist_assignees,
    task_row.is_confidential, task_row.allowed_viewers,
    task_row.status, task_row.sort_order, task_row.updated_at
  into
    v_stored_committee_id, v_stored_title, v_stored_description,
    v_stored_phase, v_stored_task_type, v_stored_priority,
    v_stored_due_date, v_stored_call_time, v_stored_end_time,
    v_stored_primary, v_stored_assists,
    v_stored_confidential, v_stored_viewers,
    v_stored_status, v_stored_sort_order, v_stored_updated_at
  from public.tasks task_row
  where task_row.id = p_task_id
    and task_row.event_id = v_stored_event_id
  for update;

  if not found then
    raise exception using errcode = '42501',
      message = 'The task is unavailable.';
  end if;

  select coalesce(pg_catalog.array_agg(id order by id), '{}'::uuid[])
  into v_authoritative_lock_user_ids
  from (
    select id
    from pg_catalog.unnest(
      p_primary_assignees || v_stored_primary || v_stored_assists
    ) proposed(id)
    group by id
  ) ids
  join public.users user_row using (id);

  if v_authoritative_lock_user_ids is distinct from v_lock_user_ids then
    raise exception using errcode = 'CCL01',
      message = 'Assignments changed while saving. Please try again.';
  end if;

  select user_row.role, user_row.committee_id
  into v_role, v_my_committee_id
  from public.users user_row
  where user_row.id = v_caller_id and user_row.is_active is true;

  if not found or v_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = '42501',
      message = 'Your account no longer has permission to edit tasks.';
  end if;

  if v_role = 'Co-Admin'
     and (
       v_stored_committee_id is distinct from v_my_committee_id
       or p_committee_id is distinct from v_my_committee_id
     ) then
    raise exception using errcode = '42501',
      message = 'Both the stored and proposed committee must be your current committee.';
  end if;

  if v_stored_updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'CCS01',
      message = 'This task changed after you loaded it. Reload and try again.';
  end if;

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using errcode = '42501',
      message = 'You need full access to this task to edit it.';
  end if;

  if p_due_date is not null
     and (p_due_date at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_due_date at time zone 'Asia/Manila')::date
       is distinct from (v_stored_due_date at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD07',
      message = 'Choose today or a later due date.';
  end if;

  if p_call_time is not null
     and (p_call_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_call_time at time zone 'Asia/Manila')::date
       is distinct from (v_stored_call_time at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD08',
      message = 'Choose today or a later duty date.';
  end if;

  if p_end_time is not null
     and (p_end_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_end_time at time zone 'Asia/Manila')::date
       is distinct from (v_stored_end_time at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD09',
      message = 'Choose today or a later end date.';
  end if;

  if not exists (
    select 1 from public.committees c where c.id = p_committee_id
  ) then
    raise exception using errcode = '22023',
      message = 'The task committee is invalid.';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_primary_assignees) proposed(id)
    left join public.users user_row on user_row.id = proposed.id
    where user_row.id is null
       or (
         user_row.is_active is not true
         and not proposed.id = any(v_stored_primary)
       )
  ) then
    raise exception using errcode = '22023',
      message = 'Every assignee must exist, and newly added assignees must be active.';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(p_allowed_viewers) proposed(id)
    where not proposed.id = any(v_stored_viewers)
      and not exists (
        select 1 from public.users user_row
        where user_row.id = proposed.id and user_row.is_active is true
      )
  ) then
    raise exception using errcode = '22023',
      message = 'Every newly added viewer must be an active user.';
  end if;

  -- The dialog edits only primaries. Existing assists survive, except that a
  -- person promoted to primary is removed from assists to prevent overlap.
  select coalesce(pg_catalog.array_agg(id order by position), '{}'::uuid[])
  into v_new_assists
  from pg_catalog.unnest(v_stored_assists)
    with ordinality stored(id, position)
  where not stored.id = any(p_primary_assignees);

  if pg_catalog.cardinality(p_primary_assignees)
       + pg_catalog.cardinality(v_new_assists) > 100 then
    raise exception using errcode = '22023',
      message = 'A task cannot have more than 100 primary and assist assignees.';
  end if;

  v_new_status := v_stored_status;
  v_new_sort_order := v_stored_sort_order;
  if v_stored_status not in ('To Do', 'Completed')
     and pg_catalog.cardinality(p_primary_assignees) = 0 then
    select reset_row.out_reset_status,
           reset_row.out_reset_sort_order,
           reset_row.out_constraint_was_deferred
    into v_new_status, v_new_sort_order, v_constraint_was_deferred
    from public.prepare_unassigned_task_reset(
      v_stored_event_id, p_task_id, pg_catalog.btrim(p_phase)
    ) reset_row;
  end if;

  if pg_catalog.btrim(p_title) is not distinct from v_stored_title
     and nullif(pg_catalog.btrim(p_description), '') is not distinct from v_stored_description
     and pg_catalog.btrim(p_phase) is not distinct from v_stored_phase
     and p_committee_id is not distinct from v_stored_committee_id
     and p_task_type is not distinct from v_stored_task_type
     and p_priority is not distinct from v_stored_priority
     and p_due_date is not distinct from v_stored_due_date
     and p_call_time is not distinct from v_stored_call_time
     and p_end_time is not distinct from v_stored_end_time
     and p_primary_assignees is not distinct from v_stored_primary
     and v_new_assists is not distinct from v_stored_assists
     and p_is_confidential is not distinct from v_stored_confidential
     and p_allowed_viewers is not distinct from v_stored_viewers
     and v_new_status is not distinct from v_stored_status then
    raise exception using errcode = 'CCN01',
      message = 'No changes to save.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_active_event_task', true
  );

  update public.tasks task_row
  set title = pg_catalog.btrim(p_title),
      description = nullif(pg_catalog.btrim(p_description), ''),
      phase = pg_catalog.btrim(p_phase),
      committee_id = p_committee_id,
      task_type = p_task_type,
      priority = p_priority,
      due_date = p_due_date,
      call_time = p_call_time,
      end_time = p_end_time,
      primary_assignees = p_primary_assignees,
      assist_assignees = v_new_assists,
      is_confidential = p_is_confidential,
      allowed_viewers = p_allowed_viewers,
      status = v_new_status,
      sort_order = v_new_sort_order
  where task_row.id = p_task_id
    and task_row.event_id = v_stored_event_id
    and task_row.updated_at = p_expected_updated_at
  returning task_row.id, task_row.updated_at,
            task_row.status, task_row.sort_order
  into out_task_id, out_updated_at, out_status, out_sort_order;

  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  if v_affected <> 1 then
    raise exception using errcode = 'CCS01',
      message = 'This task changed after you loaded it. Reload and try again.';
  end if;

  -- Any pending volunteer row is redundant once that user is assigned.
  delete from public.task_volunteers volunteer_row
  where volunteer_row.task_id = p_task_id
    and (
      volunteer_row.user_id = any(p_primary_assignees)
      or volunteer_row.user_id = any(v_new_assists)
    );

  if v_constraint_was_deferred then
    set constraints public.tasks_lane_sort_order_key immediate;
  end if;

  return next;
exception when others then
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  raise;
end;
$$;

alter function public.edit_active_event_task_step12(
  uuid, timestamptz, text, text, text, uuid, text, text,
  timestamptz, timestamptz, timestamptz, uuid[], boolean, uuid[]
) owner to postgres;
revoke all on function public.edit_active_event_task_step12(
  uuid, timestamptz, text, text, text, uuid, text, text,
  timestamptz, timestamptz, timestamptz, uuid[], boolean, uuid[]
) from public, anon, authenticated, service_role;
