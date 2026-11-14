create or replace function public.copy_archived_template_tasks(
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
    null::timestamptz,
    null::timestamptz,
    null::timestamptz,
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
) from public, anon, authenticated, service_role;
