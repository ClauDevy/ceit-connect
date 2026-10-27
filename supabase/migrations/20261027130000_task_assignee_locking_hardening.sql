-- Phase 4B Batch 10, Stage A1 hardening follow-up.
-- A1 (20261027120000) is already applied to Dev; do not edit it.
-- Replace only the three affected functions. Signatures, authorization,
-- ownership, fixed empty search paths, writer markers, and grants remain.
--
-- Changes:
-- * lock only assignee UUIDs that currently exist in public.users;
-- * make Edit Event's lock-set race return retryable SQLSTATE 40001;
-- * reject assign_task_people's over-cap/null inputs before user locks.

create or replace function public.create_event_with_tasks(
  p_name text,
  p_description text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_tasks jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_task jsonb;
  v_task_count integer;
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
  v_role text;
  v_lock_user_ids uuid[] := '{}'::uuid[];
begin
  v_role := public.my_role();

  if auth.uid() is null or v_role is null or v_role not in ('Admin', 'Co-Admin') then
    raise exception 'Only active Admins and Co-Admins can create events.';
  end if;

  if p_status is null or p_status not in ('Draft', 'Active') then
    raise exception 'Event status must be Draft or Active.';
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

  if p_status = 'Active' and p_end_date is null then
    raise exception 'An Active event requires an end date.';
  end if;

  if pg_catalog.jsonb_typeof(p_tasks) is distinct from 'array' then
    raise exception 'Tasks must be a JSON array.';
  end if;

  v_task_count := pg_catalog.jsonb_array_length(p_tasks);

  if v_task_count > 200 then
    raise exception 'An event cannot contain more than 200 tasks.';
  end if;

  if p_status = 'Active' and v_task_count = 0 then
    raise exception 'An Active event requires at least one task.';
  end if;

  select coalesce(
    pg_catalog.array_agg(
      distinct public.task_assignee_uuid_or_null(assignee.value #>> '{}')
      order by public.task_assignee_uuid_or_null(assignee.value #>> '{}')
    ),
    '{}'::uuid[]
  )
  into v_lock_user_ids
  from pg_catalog.jsonb_array_elements(p_tasks) as task(value)
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(task.value -> 'assignee_ids') = 'array'
      then task.value -> 'assignee_ids' else '[]'::jsonb end
  ) as assignee(value)
  join public.users as lock_user
    on lock_user.id = public.task_assignee_uuid_or_null(
      assignee.value #>> '{}'
    )
  where pg_catalog.jsonb_typeof(assignee.value) = 'string'
    and public.task_assignee_uuid_or_null(assignee.value #>> '{}') is not null;

  perform public.lock_task_assignee_users(v_lock_user_ids);

  insert into public.events (
    name,
    description,
    start_date,
    end_date,
    status,
    created_by
  ) values (
    pg_catalog.btrim(p_name),
    nullif(pg_catalog.btrim(p_description), ''),
    p_start_date,
    p_end_date,
    p_status,
    auth.uid()
  )
  returning id into v_event_id;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'create_event_with_tasks', true
  );

  for v_task in select value from pg_catalog.jsonb_array_elements(p_tasks)
  loop
    if pg_catalog.jsonb_typeof(v_task) is distinct from 'object' then
      raise exception 'Every task must be a JSON object.';
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

    if v_role = 'Co-Admin' and public.my_committee_id() is distinct from v_committee_id then
      raise exception 'Co-Admins may only create tasks for their own committee.';
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

    if pg_catalog.cardinality(v_assignees) <> pg_catalog.cardinality(array(select distinct pg_catalog.unnest(v_assignees))) then
      raise exception 'A task cannot contain duplicate assignees.';
    end if;

    if exists (
      select 1
      from pg_catalog.unnest(v_assignees) as a(assignee_id)
      left join public.list_active_task_assignees() u on u.id = a.assignee_id
      where u.id is null
    ) then
      raise exception 'Every assignee must exist and be active.';
    end if;

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
      v_event_id,
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
  end loop;

  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', '', true
  );
  return v_event_id;
exception
  when others then
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', '', true
    );
    raise;
end;
$$;

alter function public.create_event_with_tasks(text, text, date, date, text, jsonb) owner to postgres;
revoke all on function public.create_event_with_tasks(text, text, date, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_event_with_tasks(text, text, date, date, text, jsonb) to authenticated;

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
        and task_row.primary_assignees <@ v_lock_user_ids
        and task_row.assist_assignees <@ v_lock_user_ids;

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
    raise;
end;
$$;

alter function public.edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]) owner to postgres;
revoke all on function public.edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.edit_event_with_tasks(uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]) to authenticated;

create or replace function public.assign_task_people(
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

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its assignees.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees)
       + pg_catalog.cardinality(p_assist_assignees) > 100 then
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

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using
      errcode = '42501',
      message = 'You need full access to this task to change its assignees.';
  end if;

  if pg_catalog.cardinality(p_primary_assignees) <>
       (select count(distinct proposed.id) from unnest(p_primary_assignees) proposed(id))
     or pg_catalog.cardinality(p_assist_assignees) <>
       (select count(distinct proposed.id) from unnest(p_assist_assignees) proposed(id)) then
    raise exception using
      errcode = '22023',
      message = 'Each assignee may appear only once in a list.';
  end if;

  if p_primary_assignees && p_assist_assignees then
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
     and p_primary_assignees <@ v_stored_primary_assignees
     and pg_catalog.cardinality(p_assist_assignees) =
       pg_catalog.cardinality(v_stored_assist_assignees)
     and p_assist_assignees <@ v_stored_assist_assignees then
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
  if v_affected <> 1 then
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
$$;

alter function public.assign_task_people(uuid, uuid[], uuid[]) owner to postgres;
revoke all on function public.assign_task_people(uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.assign_task_people(uuid, uuid[], uuid[]) to authenticated;
