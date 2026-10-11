-- Return the minimum profile data needed by the task assignee picker without
-- loosening users RLS or exposing email, role, discord_id, or inactive users.
create or replace function public.list_active_task_assignees()
returns table (
  id uuid,
  full_name text,
  committee_id uuid,
  avatar_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select u.id, u.full_name, u.committee_id, u.avatar_url
  from users u
  where u.is_active = true
    and coalesce(my_role() in ('Admin', 'Co-Admin'), false)
  order by u.full_name, u.id
$$;

revoke all on function public.list_active_task_assignees()
from public, anon;
grant execute on function public.list_active_task_assignees()
to authenticated;

-- Create an event and all of its initial tasks in one transaction. This is
-- intentionally SECURITY INVOKER (the default) so events_insert/tasks_insert
-- RLS remains authoritative for the authenticated caller.
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
security invoker
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
begin
  v_role := public.my_role();

  if auth.uid() is null or v_role is null or v_role not in ('Admin', 'Co-Admin') then
    raise exception 'Only active Admins and Co-Admins can create events.';
  end if;

  if p_status is null or p_status not in ('Draft', 'Active') then
    raise exception 'Event status must be Draft or Active.';
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

  if jsonb_typeof(p_tasks) is distinct from 'array' then
    raise exception 'Tasks must be a JSON array.';
  end if;

  v_task_count := jsonb_array_length(p_tasks);

  if v_task_count > 200 then
    raise exception 'An event cannot contain more than 200 tasks.';
  end if;

  if p_status = 'Active' and v_task_count = 0 then
    raise exception 'An Active event requires at least one task.';
  end if;

  insert into public.events (
    name,
    description,
    start_date,
    end_date,
    status,
    created_by
  ) values (
    btrim(p_name),
    nullif(btrim(p_description), ''),
    p_start_date,
    p_end_date,
    p_status,
    auth.uid()
  )
  returning id into v_event_id;

  for v_task in select value from jsonb_array_elements(p_tasks)
  loop
    if jsonb_typeof(v_task) is distinct from 'object' then
      raise exception 'Every task must be a JSON object.';
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

    if v_role = 'Co-Admin' and public.my_committee_id() is distinct from v_committee_id then
      raise exception 'Co-Admins may only create tasks for their own committee.';
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

    if cardinality(v_assignees) <> cardinality(array(select distinct unnest(v_assignees))) then
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

  return v_event_id;
end;
$$;

revoke all on function public.create_event_with_tasks(text, text, date, date, text, jsonb)
from public, anon;
grant execute on function public.create_event_with_tasks(text, text, date, date, text, jsonb)
to authenticated;
