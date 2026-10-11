-- Phase 3 Step 4: optimistic, atomic editing for events and their tasks.
-- The RPC intentionally runs as the caller so the existing event/task RLS
-- policies remain the final authority for every affected row.

alter table public.events
add column updated_at timestamptz not null default clock_timestamp();

create function public.set_event_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := greatest(
    clock_timestamp(),
    old.updated_at + interval '1 microsecond'
  );
  return new;
end;
$$;

create trigger events_set_updated_at
before update on public.events
for each row
execute function public.set_event_updated_at();

revoke execute on function public.set_event_updated_at()
from public, anon, authenticated;

create function public.edit_event_with_tasks(
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
security invoker
set search_path = ''
as $$
declare
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
begin
  v_role := public.my_role();
  v_my_committee_id := public.my_committee_id();

  if auth.uid() is null or v_role is null or v_role not in ('Admin', 'Co-Admin') then
    raise exception 'Only active Admins and Co-Admins can edit events.';
  end if;

  if p_event_id is null or p_expected_updated_at is null then
    raise exception 'The event ID and expected updated_at are required.';
  end if;

  select e.status, e.updated_at
  into v_event_status, v_event_updated_at
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'The event could not be edited.';
  end if;

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

  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 150 then
    raise exception 'Event name must be between 1 and 150 characters.';
  end if;

  if p_description is not null and char_length(p_description) > 300 then
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

  if jsonb_typeof(p_tasks_to_add) is distinct from 'array'
     or jsonb_typeof(p_tasks_to_update) is distinct from 'array' then
    raise exception 'Task additions and updates must be JSON arrays.';
  end if;

  if p_task_ids_to_delete is null then
    raise exception 'Task deletion IDs must be an array.';
  end if;

  if jsonb_array_length(p_tasks_to_add) > 200
     or jsonb_array_length(p_tasks_to_update) > 200
     or cardinality(p_task_ids_to_delete) > 200 then
    raise exception 'A save cannot add, update, or delete more than 200 tasks.';
  end if;

  if cardinality(p_task_ids_to_delete)
     <> cardinality(array(select distinct unnest(p_task_ids_to_delete))) then
    raise exception 'Task deletion IDs cannot contain duplicates.';
  end if;

  -- Additions and updates share the same validation. Updates additionally
  -- verify the real stored committee and check that exactly one row changed.
  for v_operation, v_task in
    select 'add', value from jsonb_array_elements(p_tasks_to_add)
    union all
    select 'update', value from jsonb_array_elements(p_tasks_to_update)
  loop
    if jsonb_typeof(v_task) is distinct from 'object' then
      raise exception 'Every task must be a JSON object.';
    end if;

    if v_operation = 'update' then
      if jsonb_typeof(v_task -> 'id') is distinct from 'string' then
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
      v_seen_update_ids := array_append(v_seen_update_ids, v_task_id);

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

    if jsonb_typeof(v_task -> 'title') is distinct from 'string' then
      raise exception 'Every task title must be a string.';
    end if;
    v_title := btrim(v_task ->> 'title');
    if v_title is null or v_title = '' or char_length(v_title) > 200 then
      raise exception 'Task titles must be between 1 and 200 characters.';
    end if;

    if v_task ? 'description'
       and jsonb_typeof(v_task -> 'description') not in ('string', 'null') then
      raise exception 'Task descriptions must be strings or null.';
    end if;
    v_description := nullif(btrim(v_task ->> 'description'), '');
    if v_description is not null and char_length(v_description) > 2000 then
      raise exception 'Task descriptions cannot exceed 2000 characters.';
    end if;

    if jsonb_typeof(v_task -> 'phase') is distinct from 'string' then
      raise exception 'Every task phase must be a string.';
    end if;
    v_phase := btrim(v_task ->> 'phase');
    if v_phase is null or v_phase = '' or char_length(v_phase) > 100 then
      raise exception 'Phase names must be between 1 and 100 characters.';
    end if;

    if jsonb_typeof(v_task -> 'committee_id') is distinct from 'string' then
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

    if jsonb_typeof(v_task -> 'task_type') is distinct from 'string' then
      raise exception 'Every task type must be a string.';
    end if;
    v_task_type := v_task ->> 'task_type';
    if v_task_type is null or v_task_type not in ('Deliverable', 'LiveOperation') then
      raise exception 'Task type must be Deliverable or LiveOperation.';
    end if;

    if jsonb_typeof(v_task -> 'priority') is distinct from 'string' then
      raise exception 'Every task priority must be a string.';
    end if;
    v_priority := v_task ->> 'priority';
    if v_priority is null or v_priority not in ('Low', 'Medium', 'High', 'Critical') then
      raise exception 'Task priority must be Low, Medium, High, or Critical.';
    end if;

    if v_task ? 'due_date'
       and jsonb_typeof(v_task -> 'due_date') not in ('string', 'null') then
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
       and jsonb_typeof(v_task -> 'call_time') not in ('string', 'null') then
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
       and jsonb_typeof(v_task -> 'end_time') not in ('string', 'null') then
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
       or jsonb_typeof(v_task -> 'assignee_ids') is distinct from 'array' then
      raise exception 'Every task assignee_ids value must be an array.';
    end if;

    if jsonb_array_length(v_task -> 'assignee_ids') > 100 then
      raise exception 'A task cannot have more than 100 assignees.';
    end if;

    v_assignees := '{}'::uuid[];
    for v_assignee in select value from jsonb_array_elements(v_task -> 'assignee_ids')
    loop
      if jsonb_typeof(v_assignee) is distinct from 'string' then
        raise exception 'Every assignee ID must be a UUID string.';
      end if;
      begin
        v_assignees := array_append(v_assignees, (v_assignee #>> '{}')::uuid);
      exception when invalid_text_representation then
        raise exception 'Every assignee ID must be a valid UUID.';
      end;
    end loop;

    if cardinality(v_assignees)
       <> cardinality(array(select distinct unnest(v_assignees))) then
      raise exception 'A task cannot contain duplicate assignees.';
    end if;

    if exists (
      select 1
      from unnest(v_assignees) as a(assignee_id)
      left join public.list_active_task_assignees() u on u.id = a.assignee_id
      where u.id is null
    ) then
      raise exception 'Every assignee must exist and be active.';
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
      update public.tasks
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
      where id = v_task_id and event_id = p_event_id;

      get diagnostics v_affected = row_count;
      if v_affected <> 1 then
        raise exception 'A requested task update was not permitted.';
      end if;
    end if;
  end loop;

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

  -- This update is deliberately last so Draft-to-Active sees all task
  -- mutations. It always runs, even for task-only saves, and its trigger
  -- always advances updated_at for optimistic concurrency.
  update public.events
  set name = btrim(p_name),
      description = nullif(btrim(p_description), ''),
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
end;
$$;

revoke all on function public.edit_event_with_tasks(
  uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]
)
from public, anon;

grant execute on function public.edit_event_with_tasks(
  uuid, timestamptz, text, text, date, date, text, jsonb, jsonb, uuid[]
)
to authenticated;
