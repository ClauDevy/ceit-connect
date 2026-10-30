-- Batch 13e: let Co-Admins create an event from every non-confidential task
-- in an Archived template without granting a general cross-committee writer.
-- Apply manually to Dev first. Never run this migration from an agent session.

create or replace function public.get_archived_event_template(
  p_template_event_id uuid,
  p_new_start_date date
)
returns table (
  template_name text,
  template_start_date date,
  tasks jsonb,
  imported_task_count integer,
  skipped_confidential_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_template_name text;
  v_template_start_date date;
  v_shift_days integer;
  v_tasks jsonb;
  v_imported_task_count integer;
  v_skipped_confidential_count integer;
begin
  select user_row.role
  into v_caller_role
  from public.users as user_row
  where user_row.id = auth.uid()
    and user_row.is_active is true;

  if not found or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only active Admins and Co-Admins can import archive templates.';
  end if;

  if p_template_event_id is null or p_new_start_date is null then
    raise exception using
      errcode = 'CCT02',
      message = 'The Archived template is unavailable.';
  end if;

  select event_row.name, event_row.start_date
  into v_template_name, v_template_start_date
  from public.events as event_row
  where event_row.id = p_template_event_id
    and event_row.status = 'Archived';

  if not found then
    raise exception using
      errcode = 'CCT02',
      message = 'The Archived template is unavailable.';
  end if;

  v_shift_days := p_new_start_date - v_template_start_date;

  -- The aggregate count is the only deliberate disclosure about confidential
  -- source rows. No id, committee, title, description, or schedule is returned.
  select pg_catalog.count(*)::integer
  into v_skipped_confidential_count
  from public.tasks as task_row
  where task_row.event_id = p_template_event_id
    and task_row.is_confidential is true;

  select
    pg_catalog.count(*)::integer,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'source_task_id', task_row.id,
          'title', task_row.title,
          'description', task_row.description,
          'phase', task_row.phase,
          'committee_id', task_row.committee_id,
          'task_type', task_row.task_type,
          'priority', task_row.priority,
          'due_date', case
            when task_row.due_date is null then null
            else task_row.due_date + (v_shift_days * interval '1 day')
          end,
          'call_time', case
            when task_row.call_time is null then null
            else task_row.call_time + (v_shift_days * interval '1 day')
          end,
          'end_time', case
            when task_row.end_time is null then null
            else task_row.end_time + (v_shift_days * interval '1 day')
          end,
          'status', 'To Do',
          'assignee_ids', '[]'::jsonb
        )
        order by task_row.created_at, task_row.id
      ),
      '[]'::jsonb
    )
  into v_imported_task_count, v_tasks
  from public.tasks as task_row
  where task_row.event_id = p_template_event_id
    and task_row.is_confidential is false;

  if v_imported_task_count > 200 then
    raise exception using
      errcode = 'CCP01',
      message = 'An event cannot contain more than 200 tasks.';
  end if;

  return query
  select
    v_template_name,
    v_template_start_date,
    v_tasks,
    v_imported_task_count,
    v_skipped_confidential_count;
end;
$$;

alter function public.get_archived_event_template(uuid, date) owner to postgres;
revoke all on function public.get_archived_event_template(uuid, date)
from public, anon, authenticated;
grant execute on function public.get_archived_event_template(uuid, date)
to authenticated;

-- This is the Batch 13 guard with one behavior change: the exact new writer
-- name is added to the trusted assignee-writer allowlist. Missing markers still
-- normalize to the empty string and trust still requires postgres execution.
create or replace function public.guard_task_assignee_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_writer text := coalesce(
    pg_catalog.current_setting('ceit_connect.task_assignee_writer', true), ''
  );
  v_self_writer text := coalesce(
    pg_catalog.current_setting(
      'ceit_connect.task_self_assignment_writer', true
    ), ''
  );
  v_trusted boolean := current_user = 'postgres'
    and coalesce(v_writer, '') in (
      'create_event_with_tasks',
      'create_event_from_archived_template',
      'edit_event_with_tasks',
      'assign_task_people',
      'unassign_self',
      'claim_task',
      'accept_task_volunteer',
      'create_active_event_task',
      'edit_active_event_task'
    );
  v_added uuid[];
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    v_added := new.primary_assignees || new.assist_assignees;
  else
    v_added := array(
      select added_id
      from pg_catalog.unnest(
        new.primary_assignees || new.assist_assignees
      ) as added(added_id)
      where not added_id = any(
        old.primary_assignees || old.assist_assignees
      )
    );
  end if;

  if pg_catalog.cardinality(v_added) > 0 and not v_trusted then
    raise exception using
      errcode = '42501',
      message = 'Task assignees must be written through an approved function.';
  end if;

  if pg_catalog.cardinality(v_added) > 0
     and coalesce(v_writer, '') <> 'claim_task'
     and coalesce(v_self_writer, '') <> 'volunteer_for_task'
     and v_actor = any(v_added) then
    raise exception using
      errcode = 'CCP01',
      message = 'The acting user cannot be newly selected.';
  end if;

  if pg_catalog.cardinality(v_added) > 0
     and (
       exists (
         select 1
         from pg_catalog.unnest(v_added) as added(added_id)
         where added_id = any(new.allowed_viewers)
       )
       or exists (
         select 1
         from public.task_volunteers as volunteer
         where volunteer.task_id = new.id
           and volunteer.user_id = any(v_added)
       )
     ) then
    raise exception using
      errcode = 'CCP01',
      message = 'The selected person is already covered by this task.';
  end if;

  return new;
end;
$$;

alter function public.guard_task_assignee_writes() owner to postgres;
revoke all on function public.guard_task_assignee_writes()
from public, anon, authenticated;

-- Internal, ungranted copier. It never accepts client task rows and re-derives
-- every copied value from the locked Archived source event.
create function public.copy_archived_template_tasks(
  p_new_event_id uuid,
  p_template_event_id uuid,
  p_new_start_date date,
  p_excluded_task_ids uuid[]
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_committee_id uuid;
  v_template_start_date date;
  v_shift_days integer;
  v_copied_count integer;
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'The Archived template cannot be copied.';
  end if;

  select user_row.committee_id
  into v_caller_committee_id
  from public.users as user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true
    and user_row.role = 'Co-Admin'
    and user_row.committee_id is not null;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The Archived template cannot be copied.';
  end if;

  if not exists (
    select 1
    from public.events as destination_event
    where destination_event.id = p_new_event_id
      and destination_event.created_by = v_caller_id
      and destination_event.start_date = p_new_start_date
      and destination_event.status in ('Draft', 'Active')
  ) then
    raise exception using
      errcode = '42501',
      message = 'The Archived template cannot be copied.';
  end if;

  select source_event.start_date
  into v_template_start_date
  from public.events as source_event
  where source_event.id = p_template_event_id
    and source_event.status = 'Archived';

  if not found then
    raise exception using
      errcode = 'CCT02',
      message = 'The Archived template is unavailable.';
  end if;

  v_shift_days := p_new_start_date - v_template_start_date;

  insert into public.tasks (
    event_id,
    committee_id,
    title,
    description,
    phase,
    status,
    priority,
    task_type,
    due_date,
    call_time,
    end_time,
    primary_assignees,
    assist_assignees,
    is_confidential,
    request_backup,
    depends_on_task_id,
    allowed_viewers
  )
  select
    p_new_event_id,
    source_task.committee_id,
    source_task.title,
    source_task.description,
    source_task.phase,
    'To Do',
    source_task.priority,
    source_task.task_type,
    case
      when source_task.due_date is null then null
      else source_task.due_date + (v_shift_days * interval '1 day')
    end,
    case
      when source_task.call_time is null then null
      else source_task.call_time + (v_shift_days * interval '1 day')
    end,
    case
      when source_task.end_time is null then null
      else source_task.end_time + (v_shift_days * interval '1 day')
    end,
    '{}'::uuid[],
    '{}'::uuid[],
    false,
    false,
    null,
    '{}'::uuid[]
  from public.tasks as source_task
  where source_task.event_id = p_template_event_id
    and source_task.is_confidential is false
    and source_task.committee_id is distinct from v_caller_committee_id
    and not (
      source_task.id = any(
        coalesce(p_excluded_task_ids, '{}'::uuid[])
      )
    )
  order by source_task.created_at, source_task.id;

  get diagnostics v_copied_count = row_count;
  return v_copied_count;
end;
$$;

alter function public.copy_archived_template_tasks(uuid, uuid, date, uuid[])
owner to postgres;
revoke all on function public.copy_archived_template_tasks(
  uuid, uuid, date, uuid[]
) from public, anon, authenticated;

create function public.create_event_from_archived_template(
  p_name text,
  p_description text,
  p_start_date date,
  p_end_date date,
  p_status text,
  p_template_event_id uuid,
  p_own_tasks jsonb,
  p_excluded_template_task_ids jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_committee_id uuid;
  v_template_start_date date;
  v_template_status text;
  v_task jsonb;
  v_assignee jsonb;
  v_exclusion jsonb;
  v_excluded_task_ids uuid[] := '{}'::uuid[];
  v_lock_user_ids uuid[] := '{}'::uuid[];
  v_task_assignees uuid[];
  v_own_task_count integer;
  v_retained_copy_count integer;
  v_copied_count integer;
  v_draft_count integer;
  v_event_id uuid;
  v_title text;
  v_task_description text;
  v_phase text;
  v_task_type text;
  v_priority text;
  v_due_date timestamptz;
  v_call_time timestamptz;
  v_end_time timestamptz;
  v_marker_set boolean := false;
begin
  -- Authorization is deliberately first and precedes every advisory/row lock.
  select user_row.committee_id
  into v_caller_committee_id
  from public.users as user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true
    and user_row.role = 'Co-Admin'
    and user_row.committee_id is not null;

  if not found then
    raise exception using
      errcode = 'CCT01',
      message = 'Only an active Co-Admin can create an event from an Archived template.';
  end if;

  if p_template_event_id is null then
    raise exception using
      errcode = 'CCT02',
      message = 'The Archived template is unavailable.';
  end if;

  -- Preliminary, lock-free availability check. The authoritative check is
  -- repeated under FOR SHARE after the Step 10 assignee-user locks.
  select source_event.start_date, source_event.status
  into v_template_start_date, v_template_status
  from public.events as source_event
  where source_event.id = p_template_event_id;

  if not found or v_template_status <> 'Archived' then
    raise exception using
      errcode = 'CCT02',
      message = 'The Archived template is unavailable.';
  end if;

  if p_status is null or p_status not in ('Draft', 'Active') then
    raise exception 'Event status must be Draft or Active.';
  end if;
  if p_name is null
     or pg_catalog.btrim(p_name) = ''
     or pg_catalog.char_length(pg_catalog.btrim(p_name)) > 150 then
    raise exception 'Event name must be between 1 and 150 characters.';
  end if;
  if p_description is not null
     and pg_catalog.char_length(p_description) > 300 then
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
  if pg_catalog.jsonb_typeof(p_own_tasks) is distinct from 'array' then
    raise exception 'Tasks must be a JSON array.';
  end if;

  v_own_task_count := pg_catalog.jsonb_array_length(p_own_tasks);
  if v_own_task_count > 200 then
    raise exception using
      errcode = 'CCP01',
      message = 'An event cannot contain more than 200 tasks.';
  end if;

  if pg_catalog.jsonb_typeof(
    p_excluded_template_task_ids
  ) is distinct from 'array'
     or pg_catalog.jsonb_array_length(
       p_excluded_template_task_ids
     ) > 200 then
    raise exception using
      errcode = 'CCT03',
      message = 'The template task selection is invalid.';
  end if;

  for v_exclusion in
    select value
    from pg_catalog.jsonb_array_elements(p_excluded_template_task_ids)
  loop
    if pg_catalog.jsonb_typeof(v_exclusion) is distinct from 'string'
       or (v_exclusion #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using
        errcode = 'CCT03',
        message = 'The template task selection is invalid.';
    end if;
    v_excluded_task_ids := pg_catalog.array_append(
      v_excluded_task_ids,
      (v_exclusion #>> '{}')::uuid
    );
  end loop;

  select coalesce(
    pg_catalog.array_agg(distinct excluded_id order by excluded_id),
    '{}'::uuid[]
  )
  into v_excluded_task_ids
  from pg_catalog.unnest(v_excluded_task_ids) as excluded(excluded_id);

  -- Full pre-insert validation mirrors create_event_with_tasks. Because this
  -- function runs as postgres, no task RLS check is relied upon.
  for v_task in
    select value from pg_catalog.jsonb_array_elements(p_own_tasks)
  loop
    if pg_catalog.jsonb_typeof(v_task) is distinct from 'object' then
      raise exception 'Every task must be a JSON object.';
    end if;
    if pg_catalog.jsonb_typeof(v_task -> 'title') is distinct from 'string' then
      raise exception 'Every task title must be a string.';
    end if;
    v_title := pg_catalog.btrim(v_task ->> 'title');
    if v_title is null
       or v_title = ''
       or pg_catalog.char_length(v_title) > 200 then
      raise exception 'Task titles must be between 1 and 200 characters.';
    end if;
    if v_task ? 'description'
       and pg_catalog.jsonb_typeof(
         v_task -> 'description'
       ) not in ('string', 'null') then
      raise exception 'Task descriptions must be strings or null.';
    end if;
    v_task_description := nullif(
      pg_catalog.btrim(v_task ->> 'description'), ''
    );
    if v_task_description is not null
       and pg_catalog.char_length(v_task_description) > 2000 then
      raise exception 'Task descriptions cannot exceed 2000 characters.';
    end if;
    if pg_catalog.jsonb_typeof(v_task -> 'phase') is distinct from 'string' then
      raise exception 'Every task phase must be a string.';
    end if;
    v_phase := pg_catalog.btrim(v_task ->> 'phase');
    if v_phase is null
       or v_phase = ''
       or pg_catalog.char_length(v_phase) > 100 then
      raise exception 'Phase names must be between 1 and 100 characters.';
    end if;
    if pg_catalog.jsonb_typeof(
      v_task -> 'committee_id'
    ) is distinct from 'string' then
      raise exception using
        errcode = '42501',
        message = 'Template task data is invalid.';
    end if;
    begin
      if (v_task ->> 'committee_id')::uuid is distinct from
         v_caller_committee_id then
        raise exception using
          errcode = '42501',
          message = 'Template task data is invalid.';
      end if;
    exception
      when invalid_text_representation then
        raise exception using
          errcode = '42501',
          message = 'Template task data is invalid.';
    end;
    if pg_catalog.jsonb_typeof(
      v_task -> 'task_type'
    ) is distinct from 'string' then
      raise exception 'Every task type must be a string.';
    end if;
    v_task_type := v_task ->> 'task_type';
    if v_task_type not in ('Deliverable', 'LiveOperation') then
      raise exception 'Task type must be Deliverable or LiveOperation.';
    end if;
    if pg_catalog.jsonb_typeof(
      v_task -> 'priority'
    ) is distinct from 'string' then
      raise exception 'Every task priority must be a string.';
    end if;
    v_priority := v_task ->> 'priority';
    if v_priority not in ('Low', 'Medium', 'High', 'Critical') then
      raise exception 'Task priority must be Low, Medium, High, or Critical.';
    end if;
    if v_task ? 'due_date'
       and pg_catalog.jsonb_typeof(
         v_task -> 'due_date'
       ) not in ('string', 'null') then
      raise exception 'Task due dates must be YYYY-MM-DD strings or null.';
    end if;
    begin
      v_due_date := case
        when nullif(v_task ->> 'due_date', '') is null then null
        else ((v_task ->> 'due_date')::date)::timestamptz
      end;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Task due dates must be valid YYYY-MM-DD dates.';
    end;
    if v_task ? 'call_time'
       and pg_catalog.jsonb_typeof(
         v_task -> 'call_time'
       ) not in ('string', 'null') then
      raise exception 'Task call times must be timestamp strings or null.';
    end if;
    begin
      v_call_time := case
        when nullif(v_task ->> 'call_time', '') is null then null
        else (v_task ->> 'call_time')::timestamptz
      end;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Task call times must be valid timestamps.';
    end;
    if v_task ? 'end_time'
       and pg_catalog.jsonb_typeof(
         v_task -> 'end_time'
       ) not in ('string', 'null') then
      raise exception 'Task end times must be timestamp strings or null.';
    end if;
    begin
      v_end_time := case
        when nullif(v_task ->> 'end_time', '') is null then null
        else (v_task ->> 'end_time')::timestamptz
      end;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Task end times must be valid timestamps.';
    end;
    if v_call_time is not null
       and v_end_time is not null
       and v_end_time < v_call_time then
      raise exception 'Task end time cannot be before its call time.';
    end if;
    if not (v_task ? 'assignee_ids')
       or pg_catalog.jsonb_typeof(
         v_task -> 'assignee_ids'
       ) is distinct from 'array' then
      raise exception 'Every task assignee_ids value must be an array.';
    end if;
    if pg_catalog.jsonb_array_length(v_task -> 'assignee_ids') > 100 then
      raise exception 'A task cannot have more than 100 assignees.';
    end if;

    v_task_assignees := '{}'::uuid[];
    for v_assignee in
      select value
      from pg_catalog.jsonb_array_elements(v_task -> 'assignee_ids')
    loop
      if pg_catalog.jsonb_typeof(v_assignee) is distinct from 'string' then
        raise exception 'Every assignee ID must be a UUID string.';
      end if;
      begin
        v_task_assignees := pg_catalog.array_append(
          v_task_assignees,
          (v_assignee #>> '{}')::uuid
        );
      exception
        when invalid_text_representation then
          raise exception 'Every assignee ID must be a valid UUID.';
      end;
    end loop;
    if pg_catalog.cardinality(v_task_assignees) <>
       pg_catalog.cardinality(array(
         select distinct assignee_id
         from pg_catalog.unnest(v_task_assignees) as assignee(assignee_id)
       )) then
      raise exception 'A task cannot contain duplicate assignees.';
    end if;
    if exists (
      select 1
      from pg_catalog.unnest(v_task_assignees) as assignee(assignee_id)
      left join public.users as active_user
        on active_user.id = assignee.assignee_id
       and active_user.is_active is true
      where active_user.id is null
    ) then
      raise exception 'Every assignee must exist and be active.';
    end if;
    v_lock_user_ids := v_lock_user_ids || v_task_assignees;
  end loop;

  select coalesce(
    pg_catalog.array_agg(distinct user_id order by user_id),
    '{}'::uuid[]
  )
  into v_lock_user_ids
  from pg_catalog.unnest(v_lock_user_ids) as locked_user(user_id);

  -- Global order: assignee-user locks -> existing source event row -> creator
  -- cap lock -> destination event/task locks taken by existing triggers.
  perform public.lock_task_assignee_users(v_lock_user_ids);

  select source_event.start_date, source_event.status
  into v_template_start_date, v_template_status
  from public.events as source_event
  where source_event.id = p_template_event_id
  for share;

  if not found or v_template_status <> 'Archived' then
    raise exception using
      errcode = 'CCT02',
      message = 'The Archived template is unavailable.';
  end if;

  perform public.lock_draft_event_creator(v_caller_id);

  -- Both caps are authoritative only after the creator-cap lock.
  if p_status = 'Draft' then
    v_draft_count := public.count_creator_draft_events(v_caller_id);
    if v_draft_count >= 10 then
      raise exception using
        errcode = 'CCD01',
        message = 'The Draft event limit has been reached.';
    end if;
  end if;

  select pg_catalog.count(*)::integer
  into v_retained_copy_count
  from public.tasks as source_task
  where source_task.event_id = p_template_event_id
    and source_task.is_confidential is false
    and source_task.committee_id is distinct from v_caller_committee_id
    and not (source_task.id = any(v_excluded_task_ids));

  if v_own_task_count + v_retained_copy_count > 200 then
    raise exception using
      errcode = 'CCP01',
      message = 'An event cannot contain more than 200 tasks.';
  end if;
  if p_status = 'Active'
     and v_own_task_count + v_retained_copy_count = 0 then
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
    pg_catalog.btrim(p_name),
    nullif(pg_catalog.btrim(p_description), ''),
    p_start_date,
    p_end_date,
    p_status,
    v_caller_id
  )
  returning id into v_event_id;

  -- Only own drafts with non-empty assignee arrays need the marker. Copied
  -- rows always have empty arrays and are inserted after it is cleared.
  if pg_catalog.cardinality(v_lock_user_ids) > 0 then
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer',
      'create_event_from_archived_template',
      true
    );
    v_marker_set := true;
  end if;

  for v_task in
    select value from pg_catalog.jsonb_array_elements(p_own_tasks)
  loop
    v_task_assignees := array(
      select (assignee.value #>> '{}')::uuid
      from pg_catalog.jsonb_array_elements(
        v_task -> 'assignee_ids'
      ) as assignee(value)
    );

    insert into public.tasks (
      event_id,
      committee_id,
      title,
      description,
      phase,
      status,
      priority,
      task_type,
      due_date,
      call_time,
      end_time,
      primary_assignees,
      assist_assignees,
      is_confidential,
      request_backup,
      depends_on_task_id,
      allowed_viewers
    ) values (
      v_event_id,
      v_caller_committee_id,
      pg_catalog.btrim(v_task ->> 'title'),
      nullif(pg_catalog.btrim(v_task ->> 'description'), ''),
      pg_catalog.btrim(v_task ->> 'phase'),
      'To Do',
      v_task ->> 'priority',
      v_task ->> 'task_type',
      case
        when nullif(v_task ->> 'due_date', '') is null then null
        else ((v_task ->> 'due_date')::date)::timestamptz
      end,
      case
        when nullif(v_task ->> 'call_time', '') is null then null
        else (v_task ->> 'call_time')::timestamptz
      end,
      case
        when nullif(v_task ->> 'end_time', '') is null then null
        else (v_task ->> 'end_time')::timestamptz
      end,
      v_task_assignees,
      '{}'::uuid[],
      false,
      false,
      null,
      '{}'::uuid[]
    );
  end loop;

  if v_marker_set then
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', '', true
    );
    v_marker_set := false;
  end if;

  v_copied_count := public.copy_archived_template_tasks(
    v_event_id,
    p_template_event_id,
    p_start_date,
    v_excluded_task_ids
  );

  if v_copied_count <> v_retained_copy_count then
    raise exception using
      errcode = '40001',
      message = 'The Archived template changed. Refresh and try again.';
  end if;

  return v_event_id;
exception
  when others then
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', '', true
    );
    raise;
end;
$$;

alter function public.create_event_from_archived_template(
  text, text, date, date, text, uuid, jsonb, jsonb
) owner to postgres;
revoke all on function public.create_event_from_archived_template(
  text, text, date, date, text, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_event_from_archived_template(
  text, text, date, date, text, uuid, jsonb, jsonb
) to authenticated;

-- Fail the migration if any protected boundary accidentally has an overload.
do $$
begin
  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    where procedure.pronamespace = 'public'::regnamespace
      and procedure.proname = 'get_archived_event_template'
  ) <> 1 then
    raise exception 'get_archived_event_template must have exactly one signature.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    where procedure.pronamespace = 'public'::regnamespace
      and procedure.proname = 'create_event_from_archived_template'
  ) <> 1 then
    raise exception 'create_event_from_archived_template must have exactly one signature.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    where procedure.pronamespace = 'public'::regnamespace
      and procedure.proname = 'copy_archived_template_tasks'
  ) <> 1 then
    raise exception 'copy_archived_template_tasks must have exactly one signature.';
  end if;
end;
$$;
