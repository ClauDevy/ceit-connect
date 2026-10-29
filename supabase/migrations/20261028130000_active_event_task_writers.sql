-- Batch 11B: race-safe task capacity and Active-event task writers.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 11B must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create function public.count_event_tasks_for_capacity(p_event_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if pg_catalog.pg_trigger_depth() = 0 then
    raise exception using errcode = '42501',
      message = 'This helper is available only to the task capacity trigger.';
  end if;

  select count(*)::integer
  into v_count
  from public.tasks task_row
  where task_row.event_id = p_event_id;

  return v_count;
end;
$$;

alter function public.count_event_tasks_for_capacity(uuid) owner to postgres;
revoke all on function public.count_event_tasks_for_capacity(uuid)
from public, anon, authenticated;
grant execute on function public.count_event_tasks_for_capacity(uuid)
to authenticated;

create function public.enforce_event_task_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_limit constant integer := 200;
  v_stored_count integer;
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.task_assignee_writer', true
  );
  v_context_event_id uuid;
  v_start_count integer;
  v_addition_limit integer;
begin
  if new.event_id is null then
    return new;
  end if;

  -- Preserve the global parent order: event row, then event advisory lock,
  -- then any task-row work.
  perform 1
  from public.events event_row
  where event_row.id = new.event_id
  for share;

  if not found then
    raise exception using errcode = '23503',
      message = 'The task event is unavailable.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(new.event_id)
  );

  -- The trigger stays invoker-security so current_user remains meaningful.
  -- Only this count crosses RLS, through a trigger-context-only definer helper
  -- that takes its fresh VOLATILE snapshot after the advisory-lock wait.
  v_stored_count := public.count_event_tasks_for_capacity(new.event_id);

  begin
    v_context_event_id := nullif(
      pg_catalog.current_setting(
        'ceit_connect.task_capacity_event_id', true
      ),
      ''
    )::uuid;
    v_start_count := nullif(
      pg_catalog.current_setting(
        'ceit_connect.task_capacity_start_count', true
      ),
      ''
    )::integer;
    v_addition_limit := nullif(
      pg_catalog.current_setting(
        'ceit_connect.task_capacity_addition_limit', true
      ),
      ''
    )::integer;
  exception when invalid_text_representation then
    v_start_count := null;
    v_addition_limit := null;
  end;

  if current_user = 'postgres'
     and v_writer = 'edit_event_with_tasks'
     and v_context_event_id is not distinct from new.event_id
     and v_start_count is not null
     and v_addition_limit is not null
     and v_start_count >= 0
     and v_addition_limit >= 0 then
    if v_stored_count >= v_start_count + v_addition_limit then
      raise exception using
        errcode = 'CCP01',
        message = 'This event already has the maximum of 200 tasks.';
    end if;
  elsif v_stored_count >= c_limit then
    raise exception using
      errcode = 'CCP01',
      message = 'This event already has the maximum of 200 tasks.';
  end if;

  return new;
end;
$$;

alter function public.enforce_event_task_capacity() owner to postgres;
revoke all on function public.enforce_event_task_capacity()
from public, anon, authenticated;

-- This sorts before every existing BEFORE INSERT trigger. It establishes the
-- event-row -> event-advisory order before capacity counting; later parent-row
-- and advisory acquisitions in the same transaction are reentrant.
create trigger tasks_a0_enforce_event_capacity
before insert on public.tasks
for each row execute function public.enforce_event_task_capacity();

create or replace function public.guard_task_assignee_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.task_assignee_writer', true
  );
  v_trusted boolean := current_user = 'postgres'
    and v_writer in (
      'create_event_with_tasks', 'edit_event_with_tasks',
      'create_active_event_task', 'edit_active_event_task',
      'assign_task_people', 'unassign_self', 'claim_task',
      'accept_task_volunteer'
    );
begin
  if tg_op = 'INSERT' then
    if (
      pg_catalog.cardinality(new.primary_assignees) > 0
      or pg_catalog.cardinality(new.assist_assignees) > 0
    ) and not v_trusted then
      raise exception using errcode = '42501',
        message = 'Task assignees must be written through an approved function.';
    end if;
    return new;
  end if;

  if (
    new.primary_assignees is distinct from old.primary_assignees
    or new.assist_assignees is distinct from old.assist_assignees
  ) and not v_trusted then
    raise exception using errcode = '42501',
      message = 'Task assignees must be written through an approved function.';
  end if;
  return new;
end;
$$;

alter function public.guard_task_assignee_writes() owner to postgres;
revoke all on function public.guard_task_assignee_writes()
from public, anon, authenticated;

create or replace function public.restrict_assignee_task_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.task_assignee_writer', true
  );
begin
  if current_user = 'postgres' then
    if v_writer = 'edit_event_with_tasks' then
      if (
        pg_catalog.to_jsonb(new)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees'
      ) is distinct from (
        pg_catalog.to_jsonb(old)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees'
      ) then
        raise exception 'The Edit Event writer attempted an out-of-scope task update.';
      end if;
      return new;
    elsif v_writer = 'edit_active_event_task' then
      if (
        pg_catalog.to_jsonb(new)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees' - 'assist_assignees'
          - 'is_confidential' - 'allowed_viewers' - 'status' - 'sort_order'
      ) is distinct from (
        pg_catalog.to_jsonb(old)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees' - 'assist_assignees'
          - 'is_confidential' - 'allowed_viewers' - 'status' - 'sort_order'
      ) then
        raise exception 'The Active-event task editor attempted an out-of-scope update.';
      end if;
      return new;
    elsif (
      pg_catalog.to_jsonb(new) - 'status' - 'sort_order'
        - 'depends_on_task_id' - 'primary_assignees'
        - 'assist_assignees' - 'request_backup'
    ) is distinct from (
      pg_catalog.to_jsonb(old) - 'status' - 'sort_order'
        - 'depends_on_task_id' - 'primary_assignees'
        - 'assist_assignees' - 'request_backup'
    ) then
      raise exception
        'Privileged task writers may update only status, sort_order, depends_on_task_id, primary_assignees, assist_assignees, and request_backup.';
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

  if (pg_catalog.to_jsonb(new) - 'status') is distinct from
     (pg_catalog.to_jsonb(old) - 'status') then
    raise exception 'Assignees can only update a task''s status.';
  end if;
  return new;
end;
$$;

alter function public.restrict_assignee_task_updates() owner to postgres;
revoke all on function public.restrict_assignee_task_updates()
from public, anon, authenticated;

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
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.task_assignee_writer', true
  );
begin
  if old.event_id is distinct from new.event_id then return new; end if;

  if current_user = 'postgres'
     and v_writer not in ('edit_event_with_tasks', 'edit_active_event_task') then
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
    when 'To Do' then 1 when 'In Progress' then 2 when 'Completed' then 3 end;
  v_source_rank := case old.status
    when 'To Do' then 1 when 'In Progress' then 2 when 'Completed' then 3 end;

  if v_destination_rank > v_source_rank
     and new.depends_on_task_id is not null
     and not public.task_dependency_allows_forward_move(
       new.event_id, new.depends_on_task_id
     ) then
    raise exception 'Complete the prerequisite task before moving this task forward.';
  end if;

  -- SECURITY DEFINER callers see every row, including rows hidden from the
  -- caller by RLS. A phase/status change always appends to the true lane tail.
  v_lane_max := public.task_lane_tail_sort_order(
    old.event_id, new.phase, new.status, old.id
  );
  if v_lane_max > 9223372036854774783::bigint then
    raise exception 'Task order is exhausted for this lane.';
  end if;
  new.sort_order := v_lane_max + 1024::bigint;
  return new;
end;
$$;

alter function public.set_task_destination_lane_order() owner to postgres;
revoke all on function public.set_task_destination_lane_order()
from public, anon, authenticated;

create function public.validate_active_event_task_payload(
  p_title text,
  p_description text,
  p_phase text,
  p_task_type text,
  p_priority text,
  p_call_time timestamptz,
  p_end_time timestamptz,
  p_primary_assignees uuid[],
  p_is_confidential boolean,
  p_allowed_viewers uuid[]
)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if p_title is null
     or pg_catalog.btrim(p_title) = ''
     or pg_catalog.char_length(pg_catalog.btrim(p_title)) > 200 then
    raise exception using errcode = '22023',
      message = 'Task titles must be between 1 and 200 characters.';
  end if;
  if p_description is not null
     and pg_catalog.char_length(p_description) > 2000 then
    raise exception using errcode = '22023',
      message = 'Task descriptions cannot exceed 2000 characters.';
  end if;
  if p_phase is null
     or pg_catalog.btrim(p_phase) = ''
     or pg_catalog.char_length(pg_catalog.btrim(p_phase)) > 100 then
    raise exception using errcode = '22023',
      message = 'Phase names must be between 1 and 100 characters.';
  end if;
  if p_task_type not in ('Deliverable', 'LiveOperation') then
    raise exception using errcode = '22023',
      message = 'Task type must be Deliverable or LiveOperation.';
  end if;
  if p_priority not in ('Low', 'Medium', 'High', 'Critical') then
    raise exception using errcode = '22023',
      message = 'Task priority must be Low, Medium, High, or Critical.';
  end if;
  if p_call_time is not null
     and p_end_time is not null
     and p_end_time < p_call_time then
    raise exception using errcode = '22023',
      message = 'Task end time cannot be before its call time.';
  end if;
  if p_primary_assignees is null
     or p_is_confidential is null
     or p_allowed_viewers is null then
    raise exception using errcode = '22023',
      message = 'Assignees, confidentiality, and viewers are required.';
  end if;
  if pg_catalog.cardinality(p_primary_assignees) > 100 then
    raise exception using errcode = '22023',
      message = 'A task cannot have more than 100 assignees.';
  end if;
  if pg_catalog.array_position(p_primary_assignees, null::uuid) is not null
     or pg_catalog.cardinality(p_primary_assignees) <> (
       select count(distinct proposed.id)
       from pg_catalog.unnest(p_primary_assignees) proposed(id)
     ) then
    raise exception using errcode = '22023',
      message = 'Primary assignees cannot contain nulls or duplicates.';
  end if;
  if pg_catalog.cardinality(p_allowed_viewers) > 50 then
    raise exception using errcode = '22023',
      message = 'A confidential task may have at most 50 additional viewers.';
  end if;
  if pg_catalog.array_position(p_allowed_viewers, null::uuid) is not null
     or pg_catalog.cardinality(p_allowed_viewers) <> (
       select count(distinct proposed.id)
       from pg_catalog.unnest(p_allowed_viewers) proposed(id)
     ) then
    raise exception using errcode = '22023',
      message = 'Additional viewers cannot contain nulls or duplicates.';
  end if;
  if not p_is_confidential
     and pg_catalog.cardinality(p_allowed_viewers) <> 0 then
    raise exception using errcode = '22023',
      message = 'A non-confidential task cannot keep additional viewers.';
  end if;
end;
$$;

alter function public.validate_active_event_task_payload(
  text, text, text, text, text, timestamptz, timestamptz,
  uuid[], boolean, uuid[]
) owner to postgres;
revoke all on function public.validate_active_event_task_payload(
  text, text, text, text, text, timestamptz, timestamptz,
  uuid[], boolean, uuid[]
) from public, anon, authenticated;

create or replace function public.edit_event_with_tasks(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_name text,
  p_description text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_tasks_to_add jsonb default '[]'::jsonb,
  p_tasks_to_update jsonb default '[]'::jsonb,
  p_task_ids_to_delete uuid[] default '{}'::uuid[]
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stored_event_id uuid;
  v_event_status text;
  v_event_updated_at timestamptz;
  v_starting_task_count integer;
  v_final_task_count integer;
  v_submitted_addition_count integer;
  v_saved_updated_at timestamptz;
  v_role text;
  v_my_committee_id uuid;
  v_operation text;
  v_task jsonb;
  v_task_id uuid;
  v_seen_update_ids uuid[] := '{}'::uuid[];
  v_delete_id uuid;
  v_existing_committee_id uuid;
  v_existing_status text;
  v_title text;
  v_description text;
  v_phase text;
  v_committee_id uuid;
  v_task_type text;
  v_priority text;
  v_due_date timestamptz;
  v_call_time timestamptz;
  v_end_time timestamptz;
  v_assignees uuid[];
  v_assignee jsonb;
  v_affected integer;
  v_lock_user_ids uuid[] := '{}'::uuid[];
begin
  v_role := public.my_role();
  v_my_committee_id := public.my_committee_id();

  if auth.uid() is null or v_role is null or v_role not in ('Admin', 'Co-Admin') then
    raise exception 'Only active Admins and Co-Admins can edit events.';
  end if;

  if p_event_id is null or p_expected_updated_at is null then
    raise exception 'The event ID and expected updated_at are required.';
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
    select public.task_assignee_uuid_or_null(
      assignee.value #>> '{}'
    ) as user_id
    from payload_tasks
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(task -> 'assignee_ids') = 'array'
        then task -> 'assignee_ids' else '[]'::jsonb end
    ) as assignee(value)
    where pg_catalog.jsonb_typeof(assignee.value) = 'string'
      and public.task_assignee_uuid_or_null(
        assignee.value #>> '{}'
      ) is not null
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
  select coalesce(
    pg_catalog.array_agg(user_id order by user_id),
    '{}'::uuid[]
  )
  into v_lock_user_ids
  from all_ids
  join public.users as lock_user on lock_user.id = all_ids.user_id;

  perform public.lock_task_assignee_users(v_lock_user_ids);

  select e.id, e.status, e.updated_at
  into v_stored_event_id, v_event_status, v_event_updated_at
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'The event could not be edited.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_stored_event_id)
  );

  if v_event_status = 'Archived' then
    raise exception 'Archived events are read-only.';
  end if;

  if v_event_updated_at is distinct from p_expected_updated_at then
    raise exception 'This event changed after you loaded it. Reload the page before saving.';
  end if;

  if p_status is null or p_status not in ('Draft', 'Active') then
    raise exception 'Event status must be Draft or Active.';
  end if;

  if v_event_status = 'Active' and p_status <> 'Active' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  if p_name is null or pg_catalog.btrim(p_name) = '' or pg_catalog.char_length(pg_catalog.btrim(p_name)) > 150 then
    raise exception 'Event name must be between 1 and 150 characters.';
  end if;

  if p_description is not null and pg_catalog.char_length(p_description) > 300 then
    raise exception 'Event description cannot exceed 300 characters.';
  end if;

  if p_start_date is null then
    raise exception 'An event start date is required.';
  end if;

  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'Event end date cannot be before its start date.';
  end if;

  if v_event_status = 'Draft'
     and p_status = 'Active'
     and p_end_date is null then
    raise exception 'An Active event requires an end date.';
  end if;

  if pg_catalog.jsonb_typeof(p_tasks_to_add) is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_tasks_to_update) is distinct from 'array' then
    raise exception 'Task additions and updates must be JSON arrays.';
  end if;

  if p_task_ids_to_delete is null then
    raise exception 'Task deletion IDs must be an array.';
  end if;

  if pg_catalog.jsonb_array_length(p_tasks_to_add) > 200
     or pg_catalog.jsonb_array_length(p_tasks_to_update) > 200
     or pg_catalog.cardinality(p_task_ids_to_delete) > 200 then
    raise exception 'A save cannot add, update, or delete more than 200 tasks.';
  end if;

  if pg_catalog.cardinality(p_task_ids_to_delete)
     <> pg_catalog.cardinality(array(select distinct pg_catalog.unnest(p_task_ids_to_delete))) then
    raise exception 'Task deletion IDs cannot contain duplicates.';
  end if;

  v_submitted_addition_count := pg_catalog.jsonb_array_length(p_tasks_to_add);

  select count(*)::integer
  into v_starting_task_count
  from public.tasks task_row
  where task_row.event_id = p_event_id;

  perform pg_catalog.set_config(
    'ceit_connect.task_capacity_event_id', p_event_id::text, true
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_capacity_start_count',
    v_starting_task_count::text,
    true
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_capacity_addition_limit',
    v_submitted_addition_count::text,
    true
  );

  -- Additions and updates share the same validation. Updates additionally
  -- verify the real stored committee and check that exactly one row changed.
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_event_with_tasks', true
  );

  for v_operation, v_task in
    select 'add', value from pg_catalog.jsonb_array_elements(p_tasks_to_add)
    union all
    select 'update', value from pg_catalog.jsonb_array_elements(p_tasks_to_update)
  loop
    if pg_catalog.jsonb_typeof(v_task) is distinct from 'object' then
      raise exception 'Every task must be a JSON object.';
    end if;

    if v_operation = 'update' then
      if pg_catalog.jsonb_typeof(v_task -> 'id') is distinct from 'string' then
        raise exception 'Every task update ID must be a UUID string.';
      end if;
      begin
        v_task_id := (v_task ->> 'id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Every task update ID must be a valid UUID.';
      end;

      if v_task_id = any(v_seen_update_ids) then
        raise exception 'Task update IDs cannot contain duplicates.';
      end if;
      v_seen_update_ids := pg_catalog.array_append(v_seen_update_ids, v_task_id);

      select t.committee_id
      into v_existing_committee_id
      from public.tasks t
      where t.id = v_task_id and t.event_id = p_event_id;

      if not found then
        raise exception 'A requested task update was not available for this event.';
      end if;

      if v_role = 'Co-Admin'
         and v_existing_committee_id is distinct from v_my_committee_id then
        raise exception 'Co-Admins may only update tasks for their own committee.';
      end if;
    else
      v_task_id := null;
    end if;

    if pg_catalog.jsonb_typeof(v_task -> 'title') is distinct from 'string' then
      raise exception 'Every task title must be a string.';
    end if;
    v_title := pg_catalog.btrim(v_task ->> 'title');
    if v_title is null or v_title = '' or pg_catalog.char_length(v_title) > 200 then
      raise exception 'Task titles must be between 1 and 200 characters.';
    end if;

    if v_task ? 'description'
       and pg_catalog.jsonb_typeof(v_task -> 'description') not in ('string', 'null') then
      raise exception 'Task descriptions must be strings or null.';
    end if;
    v_description := nullif(pg_catalog.btrim(v_task ->> 'description'), '');
    if v_description is not null and pg_catalog.char_length(v_description) > 2000 then
      raise exception 'Task descriptions cannot exceed 2000 characters.';
    end if;

    if pg_catalog.jsonb_typeof(v_task -> 'phase') is distinct from 'string' then
      raise exception 'Every task phase must be a string.';
    end if;
    v_phase := pg_catalog.btrim(v_task ->> 'phase');
    if v_phase is null or v_phase = '' or pg_catalog.char_length(v_phase) > 100 then
      raise exception 'Phase names must be between 1 and 100 characters.';
    end if;

    if pg_catalog.jsonb_typeof(v_task -> 'committee_id') is distinct from 'string' then
      raise exception 'Every task committee_id must be a UUID string.';
    end if;
    begin
      v_committee_id := (v_task ->> 'committee_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Every task committee_id must be a valid UUID.';
    end;

    if not exists (
      select 1 from public.committees c where c.id = v_committee_id
    ) then
      raise exception 'A task references an unknown committee.';
    end if;

    if v_role = 'Co-Admin' and v_committee_id is distinct from v_my_committee_id then
      raise exception 'Co-Admins may only create or edit tasks for their own committee.';
    end if;

    if pg_catalog.jsonb_typeof(v_task -> 'task_type') is distinct from 'string' then
      raise exception 'Every task type must be a string.';
    end if;
    v_task_type := v_task ->> 'task_type';
    if v_task_type is null or v_task_type not in ('Deliverable', 'LiveOperation') then
      raise exception 'Task type must be Deliverable or LiveOperation.';
    end if;

    if pg_catalog.jsonb_typeof(v_task -> 'priority') is distinct from 'string' then
      raise exception 'Every task priority must be a string.';
    end if;
    v_priority := v_task ->> 'priority';
    if v_priority is null or v_priority not in ('Low', 'Medium', 'High', 'Critical') then
      raise exception 'Task priority must be Low, Medium, High, or Critical.';
    end if;

    if v_task ? 'due_date'
       and pg_catalog.jsonb_typeof(v_task -> 'due_date') not in ('string', 'null') then
      raise exception 'Task due dates must be YYYY-MM-DD strings or null.';
    end if;
    begin
      v_due_date := case
        when nullif(v_task ->> 'due_date', '') is null then null
        else ((v_task ->> 'due_date')::date)::timestamptz
      end;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Task due dates must be valid YYYY-MM-DD dates.';
    end;

    if v_task ? 'call_time'
       and pg_catalog.jsonb_typeof(v_task -> 'call_time') not in ('string', 'null') then
      raise exception 'Task call times must be timestamp strings or null.';
    end if;
    begin
      v_call_time := case
        when nullif(v_task ->> 'call_time', '') is null then null
        else (v_task ->> 'call_time')::timestamptz
      end;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Task call times must be valid timestamps.';
    end;

    if v_task ? 'end_time'
       and pg_catalog.jsonb_typeof(v_task -> 'end_time') not in ('string', 'null') then
      raise exception 'Task end times must be timestamp strings or null.';
    end if;
    begin
      v_end_time := case
        when nullif(v_task ->> 'end_time', '') is null then null
        else (v_task ->> 'end_time')::timestamptz
      end;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Task end times must be valid timestamps.';
    end;

    if v_call_time is not null
       and v_end_time is not null
       and v_end_time < v_call_time then
      raise exception 'Task end time cannot be before its call time.';
    end if;

    if not (v_task ? 'assignee_ids')
       or pg_catalog.jsonb_typeof(v_task -> 'assignee_ids') is distinct from 'array' then
      raise exception 'Every task assignee_ids value must be an array.';
    end if;

    if pg_catalog.jsonb_array_length(v_task -> 'assignee_ids') > 100 then
      raise exception 'A task cannot have more than 100 assignees.';
    end if;

    v_assignees := '{}'::uuid[];
    for v_assignee in select value from pg_catalog.jsonb_array_elements(v_task -> 'assignee_ids')
    loop
      if pg_catalog.jsonb_typeof(v_assignee) is distinct from 'string' then
        raise exception 'Every assignee ID must be a UUID string.';
      end if;
      begin
        v_assignees := pg_catalog.array_append(v_assignees, (v_assignee #>> '{}')::uuid);
      exception when invalid_text_representation then
        raise exception 'Every assignee ID must be a valid UUID.';
      end;
    end loop;

    if pg_catalog.cardinality(v_assignees)
       <> pg_catalog.cardinality(array(select distinct pg_catalog.unnest(v_assignees))) then
      raise exception 'A task cannot contain duplicate assignees.';
    end if;

    if v_operation = 'add' and exists (
      select 1
      from pg_catalog.unnest(v_assignees) as a(assignee_id)
      left join public.list_active_task_assignees() u on u.id = a.assignee_id
      where u.id is null
    ) then
      raise exception 'Every assignee must exist and be active.';
    end if;

    if v_operation = 'update'
       and not public.task_update_assignees_are_valid(v_task_id, v_assignees) then
      raise exception 'Every assignee must exist, and newly added assignees must be active.';
    end if;

    if v_operation = 'add' then
      insert into public.tasks (
        event_id,
        committee_id,
        title,
        description,
        phase,
        priority,
        task_type,
        due_date,
        call_time,
        end_time,
        primary_assignees,
        assist_assignees
      ) values (
        p_event_id,
        v_committee_id,
        v_title,
        v_description,
        v_phase,
        v_priority,
        v_task_type,
        v_due_date,
        v_call_time,
        v_end_time,
        v_assignees,
        '{}'::uuid[]
      );
    else
      update public.tasks as task_row
      set committee_id = v_committee_id,
          title = v_title,
          description = v_description,
          phase = v_phase,
          priority = v_priority,
          task_type = v_task_type,
          due_date = v_due_date,
          call_time = v_call_time,
          end_time = v_end_time,
          primary_assignees = v_assignees
      where task_row.id = v_task_id
        and task_row.event_id = p_event_id
        and not exists (
          select 1
          from pg_catalog.unnest(
            task_row.primary_assignees || task_row.assist_assignees
          ) as stored(user_id)
          join public.users as lock_user on lock_user.id = stored.user_id
          where not stored.user_id = any(v_lock_user_ids)
        );

      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception using
          errcode = '40001',
          message = 'The task changed. Refresh and try again.';
      end if;
    end if;
  end loop;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  perform pg_catalog.set_config('ceit_connect.task_capacity_event_id', '', true);
  perform pg_catalog.set_config('ceit_connect.task_capacity_start_count', '', true);
  perform pg_catalog.set_config('ceit_connect.task_capacity_addition_limit', '', true);

  -- Deletions are explicit. Read status from the row under RLS immediately
  -- before deleting; client-provided status is never accepted.
  foreach v_delete_id in array p_task_ids_to_delete
  loop
    if v_delete_id = any(v_seen_update_ids) then
      raise exception 'A task cannot be updated and deleted in the same save.';
    end if;

    select t.status, t.committee_id
    into v_existing_status, v_existing_committee_id
    from public.tasks t
    where t.id = v_delete_id and t.event_id = p_event_id;

    if not found then
      raise exception 'A requested task deletion was not available for this event.';
    end if;

    if v_role = 'Co-Admin'
       and v_existing_committee_id is distinct from v_my_committee_id then
      raise exception 'Co-Admins may only delete tasks for their own committee.';
    end if;

    if v_existing_status <> 'To Do' then
      raise exception 'Only To Do tasks can be deleted.';
    end if;

    delete from public.tasks
    where id = v_delete_id and event_id = p_event_id;

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'A requested task deletion was not permitted.';
    end if;
  end loop;

  select count(*)::integer
  into v_final_task_count
  from public.tasks task_row
  where task_row.event_id = p_event_id;

  if v_final_task_count > 200
     and v_final_task_count > v_starting_task_count then
    raise exception using errcode = 'CCP01',
      message = 'This event already has the maximum of 200 tasks.';
  end if;

  -- Check the real all-committee final state explicitly for the edit RPC.
  -- The deferred triggers below remain the database-wide enforcement for
  -- direct task writes and concurrent transactions.
  if p_status = 'Active'
     and pg_catalog.cardinality(p_task_ids_to_delete) > 0
     and not public.event_has_tasks_for_editor(p_event_id) then
    raise exception 'An Active event must have at least one task.';
  end if;

  -- This update is deliberately last so Draft-to-Active sees all task
  -- mutations. It always runs, even for task-only saves, and its trigger
  -- always advances updated_at for optimistic concurrency.
  update public.events
  set name = pg_catalog.btrim(p_name),
      description = nullif(pg_catalog.btrim(p_description), ''),
      start_date = p_start_date,
      end_date = p_end_date,
      status = p_status
  where id = p_event_id
    and updated_at = p_expected_updated_at
  returning updated_at into v_saved_updated_at;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'This event changed after you loaded it. Reload the page before saving.';
  end if;

  return v_saved_updated_at;
exception
  when others then
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', '', true
    );
    perform pg_catalog.set_config('ceit_connect.task_capacity_event_id', '', true);
    perform pg_catalog.set_config('ceit_connect.task_capacity_start_count', '', true);
    perform pg_catalog.set_config('ceit_connect.task_capacity_addition_limit', '', true);
    raise;
end;
$$;

alter function public.edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]) owner to postgres;
revoke all on function public.edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]) to authenticated;

create function public.create_active_event_task(
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

alter function public.create_active_event_task(
  uuid, text, text, text, uuid, text, text, timestamptz,
  timestamptz, timestamptz, uuid[], boolean, uuid[]
) owner to postgres;
revoke all on function public.create_active_event_task(
  uuid, text, text, text, uuid, text, text, timestamptz,
  timestamptz, timestamptz, uuid[], boolean, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_active_event_task(
  uuid, text, text, text, uuid, text, text, timestamptz,
  timestamptz, timestamptz, uuid[], boolean, uuid[]
) to authenticated;

create function public.edit_active_event_task(
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

alter function public.edit_active_event_task(
  uuid, timestamptz, text, text, text, uuid, text, text,
  timestamptz, timestamptz, timestamptz, uuid[], boolean, uuid[]
) owner to postgres;
revoke all on function public.edit_active_event_task(
  uuid, timestamptz, text, text, text, uuid, text, text,
  timestamptz, timestamptz, timestamptz, uuid[], boolean, uuid[]
) from public, anon, authenticated;
grant execute on function public.edit_active_event_task(
  uuid, timestamptz, text, text, text, uuid, text, text,
  timestamptz, timestamptz, timestamptz, uuid[], boolean, uuid[]
) to authenticated;

do $$
declare
  v_create regprocedure := 'public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure;
  v_edit regprocedure := 'public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure;
  v_capacity_count regprocedure :=
    'public.count_event_tasks_for_capacity(uuid)'::regprocedure;
begin
  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'count_event_tasks_for_capacity',
        'create_active_event_task', 'edit_active_event_task'
      )
  ) <> 3 then
    raise exception 'Batch 11 task functions must not have overloads.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    where p.oid in (v_create, v_edit)
      and p.proowner = 'postgres'::regrole
      and p.prosecdef
      and p.provolatile = 'v'
      and coalesce(p.proconfig, '{}'::text[])
        @> array['search_path=""']
      and not pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) <> 2 then
    raise exception 'Active-event task writers have unexpected security attributes or grants.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = v_capacity_count
      and p.proowner = 'postgres'::regrole
      and p.prosecdef
      and p.provolatile = 'v'
      and coalesce(p.proconfig, '{}'::text[])
        @> array['search_path=""']
      and not pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'Task capacity count helper has unexpected security attributes or grants.';
  end if;
end;
$$;

