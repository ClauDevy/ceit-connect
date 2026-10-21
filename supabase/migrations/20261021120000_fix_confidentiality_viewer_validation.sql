create or replace function public.set_task_confidentiality(
  p_task_id uuid,
  p_is_confidential boolean,
  p_allowed_viewers uuid[]
)
returns table (
  task_id uuid,
  is_confidential boolean,
  allowed_viewers uuid[]
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_caller_committee_id uuid;
  v_discovered_event_id uuid;
  v_discovered_committee_id uuid;
  v_task_event_id uuid;
  v_task_committee_id uuid;
  v_old_allowed_viewers uuid[];
  v_event_status text;
  v_affected integer;
  v_result_task_id uuid;
  v_result_is_confidential boolean;
  v_result_allowed_viewers uuid[];
begin
  select user_row.role, user_row.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users user_row
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if v_caller_id is null
     or not found
     or v_caller_role not in ('Admin', 'Co-Admin') then
    raise exception using
      errcode = '42501',
      message = 'Only authorized active leadership can change task confidentiality.';
  end if;

  if p_task_id is null
     or p_is_confidential is null
     or p_allowed_viewers is null then
    raise exception using
      errcode = '22023',
      message = 'A task, confidentiality value, and viewer list are required.';
  end if;

  if pg_catalog.cardinality(p_allowed_viewers) > 50 then
    raise exception using
      errcode = '22023',
      message = 'A confidential task may have at most 50 additional viewers.';
  end if;

  if exists (
    select 1
    from unnest(p_allowed_viewers) proposed(viewer_id)
    where proposed.viewer_id is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'Viewer ids cannot be null.';
  end if;

  if (
    select count(*)
    from unnest(p_allowed_viewers) proposed(viewer_id)
  ) <> (
    select count(distinct proposed.viewer_id)
    from unnest(p_allowed_viewers) proposed(viewer_id)
  ) then
    raise exception using
      errcode = '22023',
      message = 'Each additional viewer may be selected only once.';
  end if;

  if p_is_confidential is false
     and pg_catalog.cardinality(p_allowed_viewers) <> 0 then
    raise exception using
      errcode = '22023',
      message = 'A non-confidential task cannot keep additional viewers.';
  end if;

  -- This discovery uses the caller's existing task RLS.
  select task_row.event_id, task_row.committee_id
  into v_discovered_event_id, v_discovered_committee_id
  from public.tasks task_row
  where task_row.id = p_task_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'You are not allowed to change this task''s confidentiality.';
  end if;

  if v_caller_role = 'Co-Admin'
     and v_caller_committee_id is distinct from v_discovered_committee_id then
    raise exception using
      errcode = '42501',
      message = 'Co-Admins can change confidentiality only for their own committee''s tasks.';
  end if;

  -- SELECT FOR SHARE is subject to events_update RLS for this invoker-security
  -- function. Archived parents can therefore appear as no row; handle that
  -- explicitly instead of treating an unset status as writable.
  select event_row.status
  into v_event_status
  from public.events event_row
  where event_row.id = v_discovered_event_id
  for share;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'The task event is Archived or unavailable.';
  end if;

  if v_event_status = 'Archived' then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if v_event_status not in ('Draft', 'Active') then
    raise exception 'The task''s event is not writable.';
  end if;

  select
    task_row.event_id,
    task_row.committee_id,
    task_row.allowed_viewers
  into
    v_task_event_id,
    v_task_committee_id,
    v_old_allowed_viewers
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found
     or v_task_event_id is distinct from v_discovered_event_id
     or v_task_committee_id is distinct from v_discovered_committee_id then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_caller_role = 'Co-Admin'
     and v_caller_committee_id is distinct from v_task_committee_id then
    raise exception using
      errcode = '42501',
      message = 'Co-Admins can change confidentiality only for their own committee''s tasks.';
  end if;

  -- Inactive ids already stored on the task may be retained. Every newly
  -- added id must resolve to a currently active profile.
  if exists (
    select 1
    from unnest(p_allowed_viewers) proposed(viewer_id)
    where not proposed.viewer_id = any(
      coalesce(v_old_allowed_viewers, '{}'::uuid[])
    )
      and not exists (
        select 1
        from public.list_active_task_assignees() user_option
        where user_option.id = proposed.viewer_id
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every newly added viewer must be an active user.';
  end if;

  update public.tasks as task_row
  set is_confidential = p_is_confidential,
      allowed_viewers = p_allowed_viewers
  where task_row.id = p_task_id
  returning
    task_row.id,
    task_row.is_confidential,
    task_row.allowed_viewers
  into
    v_result_task_id,
    v_result_is_confidential,
    v_result_allowed_viewers;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  task_id := v_result_task_id;
  is_confidential := v_result_is_confidential;
  allowed_viewers := v_result_allowed_viewers;
  return next;
end;
$$;

alter function public.set_task_confidentiality(uuid, boolean, uuid[])
owner to postgres;

revoke all on function public.set_task_confidentiality(uuid, boolean, uuid[])
from public, anon, authenticated;
grant execute on function public.set_task_confidentiality(uuid, boolean, uuid[])
to authenticated;
