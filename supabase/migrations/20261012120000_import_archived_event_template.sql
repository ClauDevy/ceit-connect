-- Return an Archived event's visible, non-confidential tasks as an editable
-- template. This is intentionally SECURITY INVOKER so tasks_select remains
-- authoritative. An additional explicit committee predicate prevents a
-- Co-Admin from importing another committee's backup-requested or assigned
-- task even when tasks_select allows that row to be read.
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
security invoker
set search_path = ''
as $$
declare
  v_role text;
  v_template_name text;
  v_template_start_date date;
  v_template_status text;
  v_shift_days integer;
  v_tasks jsonb;
  v_imported_task_count integer;
  v_skipped_confidential_count integer;
begin
  v_role := public.my_role();

  if auth.uid() is null
     or v_role is null
     or v_role not in ('Admin', 'Co-Admin') then
    raise exception 'Only active Admins and Co-Admins can import archive templates.';
  end if;

  if p_template_event_id is null then
    raise exception 'Choose an Archived event to use as a template.';
  end if;

  if p_new_start_date is null then
    raise exception 'Set the new event start date before importing a template.';
  end if;

  select e.name, e.start_date, e.status
  into v_template_name, v_template_start_date, v_template_status
  from public.events e
  where e.id = p_template_event_id;

  if not found then
    raise exception 'The selected template event was not found.';
  end if;

  if v_template_status <> 'Archived' then
    raise exception 'Only Archived events can be used as templates.';
  end if;

  v_shift_days := p_new_start_date - v_template_start_date;

  -- Count confidential rows within the caller's existing RLS scope without
  -- selecting any of their content into the result.
  select count(*)::integer
  into v_skipped_confidential_count
  from public.tasks t
  where t.event_id = p_template_event_id
    and t.is_confidential = true
    and (
      v_role = 'Admin'
      or t.committee_id = public.my_committee_id()
    );

  -- Confidential rows are excluded before title/description JSON is built.
  select
    count(*)::integer,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'title', t.title,
          'description', t.description,
          'phase', t.phase,
          'committee_id', t.committee_id,
          'task_type', t.task_type,
          'priority', t.priority,
          'due_date', case
            when t.due_date is null then null
            else t.due_date + (v_shift_days * interval '1 day')
          end,
          'call_time', case
            when t.call_time is null then null
            else t.call_time + (v_shift_days * interval '1 day')
          end,
          'end_time', case
            when t.end_time is null then null
            else t.end_time + (v_shift_days * interval '1 day')
          end,
          'status', 'To Do',
          'assignee_ids', '[]'::jsonb
        )
        order by t.created_at, t.id
      ),
      '[]'::jsonb
    )
  into v_imported_task_count, v_tasks
  from public.tasks t
  where t.event_id = p_template_event_id
    and t.is_confidential = false
    and (
      v_role = 'Admin'
      or t.committee_id = public.my_committee_id()
    );

  if v_imported_task_count > 200 then
    raise exception 'This template has % importable tasks. An event can contain at most 200 tasks.',
      v_imported_task_count;
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

revoke all on function public.get_archived_event_template(uuid, date)
from public, anon;
grant execute on function public.get_archived_event_template(uuid, date)
to authenticated;
