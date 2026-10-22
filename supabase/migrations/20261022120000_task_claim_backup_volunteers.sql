-- Phase 4 Step 8A: Backlog claims, backup requests, volunteer offers,
-- Help Wanted, and leadership workload counts.
--
-- All task/child mutators use the Phase 4 child-specific lock order:
-- task row first, then its stored parent event row, then child rows. These
-- operations do not read or change dependency graphs or lane ranks, so the
-- per-event advisory key is intentionally not taken; the locked task row is
-- the single serialization point for claim/backup/volunteer races.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Step 8A must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

-- Step 8A adds request_backup to the exact union needed by postgres-owned
-- narrow task writers. Every non-owner branch is unchanged from Step 7A.
create or replace function public.restrict_assignee_task_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'postgres' then
    if (
      to_jsonb(new)
        - 'status'
        - 'sort_order'
        - 'depends_on_task_id'
        - 'primary_assignees'
        - 'assist_assignees'
        - 'request_backup'
    ) is distinct from (
      to_jsonb(old)
        - 'status'
        - 'sort_order'
        - 'depends_on_task_id'
        - 'primary_assignees'
        - 'assist_assignees'
        - 'request_backup'
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

  if (to_jsonb(new) - 'status') is distinct from
     (to_jsonb(old) - 'status') then
    raise exception 'Assignees can only update a task''s status.';
  end if;

  return new;
end;
$$;

alter function public.restrict_assignee_task_updates()
owner to postgres;

revoke all on function public.restrict_assignee_task_updates()
from public, anon, authenticated;

create table public.task_volunteers (
  task_id uuid not null
    references public.tasks(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  constraint task_volunteers_pkey primary key (task_id, user_id)
);

create index task_volunteers_user_created_idx
on public.task_volunteers (user_id, created_at desc, task_id);

create index tasks_help_wanted_active_idx
on public.tasks (event_id, due_date, id)
where request_backup is true and status <> 'Completed';

alter table public.task_volunteers enable row level security;

revoke all on table public.task_volunteers
from public, anon, authenticated;

-- There are deliberately no permissive policies. Authenticated access is
-- available only through the fixed-shape readers and narrow mutators below.

create function public.guard_task_volunteer_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
begin
  if TG_OP = 'UPDATE' then
    raise exception using
      errcode = 'CCB09',
      message = 'Volunteer offers cannot be updated; task_id is immutable.';
  end if;

  -- Child-specific order: stored task row, then stored parent event row. A
  -- task FK cascade reaches this trigger after the task has disappeared; its
  -- own task/event guards already validated the deletion, so allow only that
  -- nested cascade case.
  select task_row.event_id
  into v_event_id
  from public.tasks task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    if TG_OP = 'DELETE' and pg_trigger_depth() > 1 then
      return old;
    end if;

    raise exception using
      errcode = 'CCB01',
      message = 'The volunteer task is unavailable.';
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
      message = 'The volunteer task changed. Refresh and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCB08',
      message = 'Volunteer offers in Archived events are read-only.';
  end if;

  if TG_OP = 'INSERT' and v_event_status <> 'Active' then
    raise exception using
      errcode = 'CCB02',
      message = 'Volunteer offers are available only for Active events.';
  end if;

  if TG_OP = 'INSERT' then
    return new;
  end if;

  return old;
end;
$$;

alter function public.guard_task_volunteer_writes()
owner to postgres;

revoke all on function public.guard_task_volunteer_writes()
from public, anon, authenticated;

create trigger task_volunteers_guard_writes
before insert or update or delete on public.task_volunteers
for each row
execute function public.guard_task_volunteer_writes();

create function public.claim_task(p_task_id uuid)
returns table (
  out_task_id uuid,
  out_primary_assignees uuid[]
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
  v_task_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_affected integer;
begin
  if p_task_id is null then
    raise exception using errcode = '22023', message = 'A task ID is required.';
  end if;

  if v_caller_id is null or not exists (
    select 1 from public.users user_row
    where user_row.id = v_caller_id and user_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  select
    task_row.event_id,
    task_row.status,
    task_row.primary_assignees,
    task_row.assist_assignees
  into
    v_event_id,
    v_task_status,
    v_primary_assignees,
    v_assist_assignees
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'CCB01', message = 'The task is unavailable.';
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

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using errcode = '42501', message = 'You need full access to claim this task.';
  end if;

  if v_event_status <> 'Active' then
    raise exception using errcode = 'CCB02', message = 'Only Active-event tasks can be claimed.';
  end if;

  if v_caller_id = any(v_assist_assignees) then
    raise exception using
      errcode = 'CCB04',
      message = 'An assist assignee cannot claim the same task as primary.';
  end if;

  if v_task_status = 'Completed' or cardinality(v_primary_assignees) <> 0 then
    raise exception using
      errcode = 'CCB03',
      message = 'This task is no longer available to claim.';
  end if;

  update public.tasks task_row
  set primary_assignees = array[v_caller_id]::uuid[]
  where task_row.id = p_task_id
    and task_row.event_id = v_event_id
    and task_row.status <> 'Completed'
    and cardinality(task_row.primary_assignees) = 0
  returning task_row.id, task_row.primary_assignees
  into out_task_id, out_primary_assignees;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = 'CCB03', message = 'This task was claimed by someone else.';
  end if;

  return next;
end;
$$;

alter function public.claim_task(uuid) owner to postgres;
revoke all on function public.claim_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_task(uuid) to authenticated;

create function public.set_task_backup_request(
  p_task_id uuid,
  p_request_backup boolean
)
returns table (
  out_task_id uuid,
  out_request_backup boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_id uuid;
  v_event_status text;
  v_task_status text;
  v_primary_assignees uuid[];
  v_stored_request_backup boolean;
  v_affected integer;
begin
  if p_task_id is null or p_request_backup is null then
    raise exception using errcode = '22023', message = 'Task ID and backup state are required.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id and user_row.is_active is true;

  if v_caller_id is null or not found then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  select
    task_row.event_id,
    task_row.status,
    task_row.primary_assignees,
    task_row.request_backup
  into
    v_event_id,
    v_task_status,
    v_primary_assignees,
    v_stored_request_backup
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'CCB01', message = 'The task is unavailable.';
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

  if public.task_content_access(p_task_id) <> 'real'
     or not (
       v_caller_role in ('Admin', 'Co-Admin')
       or v_caller_id = any(v_primary_assignees)
     ) then
    raise exception using errcode = '42501', message = 'You cannot change this task''s backup request.';
  end if;

  if v_event_status <> 'Active' then
    raise exception using errcode = 'CCB02', message = 'Backup requests are available only for Active events.';
  end if;

  if v_task_status = 'Completed' then
    raise exception using errcode = 'CCB05', message = 'Completed tasks cannot request backup.';
  end if;

  if v_stored_request_backup = p_request_backup then
    raise exception using errcode = 'CCB05', message = 'The backup request already has that state.';
  end if;

  update public.tasks task_row
  set request_backup = p_request_backup
  where task_row.id = p_task_id
    and task_row.event_id = v_event_id
    and task_row.request_backup = v_stored_request_backup
  returning task_row.id, task_row.request_backup
  into out_task_id, out_request_backup;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '40001', message = 'The backup request changed. Refresh and try again.';
  end if;

  if not p_request_backup then
    delete from public.task_volunteers volunteer_row
    where volunteer_row.task_id = p_task_id;
  end if;

  return next;
end;
$$;

alter function public.set_task_backup_request(uuid, boolean) owner to postgres;
revoke all on function public.set_task_backup_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_task_backup_request(uuid, boolean) to authenticated;

create function public.volunteer_for_task(p_task_id uuid)
returns table (
  out_task_id uuid,
  out_user_id uuid,
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
  v_task_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_request_backup boolean;
begin
  if p_task_id is null then
    raise exception using errcode = '22023', message = 'A task ID is required.';
  end if;

  if v_caller_id is null or not exists (
    select 1 from public.users user_row
    where user_row.id = v_caller_id and user_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  select
    task_row.event_id,
    task_row.status,
    task_row.primary_assignees,
    task_row.assist_assignees,
    task_row.request_backup
  into
    v_event_id,
    v_task_status,
    v_primary_assignees,
    v_assist_assignees,
    v_request_backup
  from public.tasks task_row
  where task_row.id = p_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCB01', message = 'The task is unavailable.';
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

  if public.task_content_access(p_task_id) <> 'real' then
    raise exception using errcode = '42501', message = 'You need full access to volunteer for this task.';
  end if;

  if v_event_status <> 'Active' then
    raise exception using errcode = 'CCB02', message = 'Volunteering is available only for Active events.';
  end if;

  if v_task_status = 'Completed' or not v_request_backup then
    raise exception using errcode = 'CCB05', message = 'This task is not accepting volunteers.';
  end if;

  if v_caller_id = any(v_primary_assignees)
     or v_caller_id = any(v_assist_assignees) then
    raise exception using errcode = 'CCB07', message = 'An existing assignee cannot volunteer.';
  end if;

  begin
    insert into public.task_volunteers (task_id, user_id)
    values (p_task_id, v_caller_id)
    returning task_id, user_id, created_at
    into out_task_id, out_user_id, out_created_at;
  exception when unique_violation then
    raise exception using errcode = 'CCB06', message = 'You have already volunteered for this task.';
  end;

  return next;
end;
$$;

alter function public.volunteer_for_task(uuid) owner to postgres;
revoke all on function public.volunteer_for_task(uuid) from public, anon, authenticated;
grant execute on function public.volunteer_for_task(uuid) to authenticated;

create function public.withdraw_task_volunteer(p_task_id uuid)
returns table (
  out_task_id uuid,
  out_user_id uuid
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
  v_request_backup boolean;
begin
  if p_task_id is null then
    raise exception using errcode = '22023', message = 'A task ID is required.';
  end if;

  if v_caller_id is null or not exists (
    select 1 from public.users user_row
    where user_row.id = v_caller_id and user_row.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  select task_row.event_id, task_row.request_backup
  into v_event_id, v_request_backup
  from public.tasks task_row
  where task_row.id = p_task_id
  for no key update;

  if not found then
    raise exception using errcode = 'CCB01', message = 'The task is unavailable.';
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

  if v_event_status <> 'Active' then
    raise exception using errcode = 'CCB02', message = 'Volunteer offers are writable only for Active events.';
  end if;

  if not v_request_backup then
    raise exception using errcode = 'CCB05', message = 'This task is not accepting volunteers.';
  end if;

  delete from public.task_volunteers volunteer_row
  where volunteer_row.task_id = p_task_id
    and volunteer_row.user_id = v_caller_id
  returning volunteer_row.task_id, volunteer_row.user_id
  into out_task_id, out_user_id;

  if not found then
    raise exception using errcode = 'CCB06', message = 'No pending volunteer offer was found.';
  end if;

  return next;
end;
$$;

alter function public.withdraw_task_volunteer(uuid) owner to postgres;
revoke all on function public.withdraw_task_volunteer(uuid) from public, anon, authenticated;
grant execute on function public.withdraw_task_volunteer(uuid) to authenticated;

create function public.accept_task_volunteer(
  p_task_id uuid,
  p_user_id uuid
)
returns table (
  out_task_id uuid,
  out_user_id uuid,
  out_assist_assignees uuid[],
  out_outcome text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_id uuid;
  v_event_status text;
  v_task_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_request_backup boolean;
  v_target_offer_exists boolean;
  v_volunteer_is_active boolean;
  v_affected integer;
begin
  if p_task_id is null or p_user_id is null then
    raise exception using errcode = '22023', message = 'Task and volunteer IDs are required.';
  end if;

  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = v_caller_id and user_row.is_active is true;

  if v_caller_id is null or not found then
    raise exception using errcode = '42501', message = 'An active profile is required.';
  end if;

  select
    task_row.event_id,
    task_row.status,
    task_row.primary_assignees,
    task_row.assist_assignees,
    task_row.request_backup
  into
    v_event_id,
    v_task_status,
    v_primary_assignees,
    v_assist_assignees,
    v_request_backup
  from public.tasks task_row
  where task_row.id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'CCB01', message = 'The task is unavailable.';
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

  if public.task_content_access(p_task_id) <> 'real'
     or not (
       v_caller_role in ('Admin', 'Co-Admin')
       or v_caller_id = any(v_primary_assignees)
     ) then
    raise exception using errcode = '42501', message = 'You cannot accept volunteers for this task.';
  end if;

  if v_event_status <> 'Active' then
    raise exception using errcode = 'CCB02', message = 'Volunteers can be accepted only for Active events.';
  end if;

  if v_task_status = 'Completed' or not v_request_backup then
    raise exception using errcode = 'CCB05', message = 'This task is not accepting volunteers.';
  end if;

  -- Child rows come last. Lock every offer for this task in deterministic
  -- user order so this acceptance can sweep every stale offer, not only the
  -- selected one, without racing another accept/withdraw/cancel operation.
  perform 1
  from public.task_volunteers volunteer_row
  where volunteer_row.task_id = p_task_id
  order by volunteer_row.user_id
  for update;

  select exists (
    select 1
    from public.task_volunteers volunteer_row
    where volunteer_row.task_id = p_task_id
      and volunteer_row.user_id = p_user_id
  )
  into v_target_offer_exists;

  if not v_target_offer_exists then
    raise exception using errcode = 'CCB06', message = 'The volunteer offer is no longer pending.';
  end if;

  select user_row.is_active
  into v_volunteer_is_active
  from public.users user_row
  where user_row.id = p_user_id;

  delete from public.task_volunteers volunteer_row
  where volunteer_row.task_id = p_task_id
    and (
      volunteer_row.user_id = any(v_primary_assignees)
      or volunteer_row.user_id = any(v_assist_assignees)
      or not exists (
        select 1
        from public.users user_row
        where user_row.id = volunteer_row.user_id
          and user_row.is_active is true
      )
    );

  if not coalesce(v_volunteer_is_active, false) then
    out_task_id := p_task_id;
    out_user_id := p_user_id;
    out_assist_assignees := v_assist_assignees;
    out_outcome := 'inactive_removed';
    return next;
    return;
  end if;

  if p_user_id = any(v_primary_assignees)
     or p_user_id = any(v_assist_assignees) then
    out_task_id := p_task_id;
    out_user_id := p_user_id;
    out_assist_assignees := v_assist_assignees;
    out_outcome := 'already_assigned_removed';
    return next;
    return;
  end if;

  if pg_catalog.cardinality(v_primary_assignees)
       + pg_catalog.cardinality(v_assist_assignees) >= 100 then
    raise exception using
      errcode = 'CCB10',
      message = 'A task cannot have more than 100 assignees.';
  end if;

  update public.tasks task_row
  set assist_assignees = array_append(task_row.assist_assignees, p_user_id)
  where task_row.id = p_task_id
    and task_row.event_id = v_event_id
    and not p_user_id = any(task_row.primary_assignees)
    and not p_user_id = any(task_row.assist_assignees)
  returning task_row.id, task_row.assist_assignees
  into out_task_id, out_assist_assignees;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using errcode = '40001', message = 'The assignment changed. Refresh and try again.';
  end if;

  delete from public.task_volunteers volunteer_row
  where volunteer_row.task_id = p_task_id and volunteer_row.user_id = p_user_id;

  out_user_id := p_user_id;
  out_outcome := 'accepted';
  return next;
end;
$$;

alter function public.accept_task_volunteer(uuid, uuid) owner to postgres;
revoke all on function public.accept_task_volunteer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_task_volunteer(uuid, uuid) to authenticated;

create function public.get_task_backup_state(p_task_id uuid)
returns table (
  out_task_id uuid,
  out_request_backup boolean,
  out_can_toggle_backup boolean,
  out_can_volunteer boolean,
  out_has_volunteered boolean,
  out_can_accept boolean,
  out_volunteers jsonb
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
  v_task_status text;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_request_backup boolean;
  v_can_accept boolean;
begin
  if p_task_id is null then
    raise exception using errcode = '22023', message = 'A task ID is required.';
  end if;

  select
    user_row.role,
    event_row.status,
    task_row.status,
    task_row.primary_assignees,
    task_row.assist_assignees,
    task_row.request_backup
  into
    v_caller_role,
    v_event_status,
    v_task_status,
    v_primary_assignees,
    v_assist_assignees,
    v_request_backup
  from public.users user_row
  join public.tasks task_row on task_row.id = p_task_id
  join public.events event_row on event_row.id = task_row.event_id
  where user_row.id = v_caller_id
    and user_row.is_active is true;

  if not found
     or v_event_status <> 'Active'
     or public.task_content_access(p_task_id) <> 'real' then
    return;
  end if;

  v_can_accept := v_request_backup
    and v_task_status <> 'Completed'
    and (
      v_caller_role in ('Admin', 'Co-Admin')
      or v_caller_id = any(v_primary_assignees)
    );

  return query
  select
    p_task_id,
    v_request_backup,
    v_task_status <> 'Completed'
      and (
        v_caller_role in ('Admin', 'Co-Admin')
        or v_caller_id = any(v_primary_assignees)
      ),
    v_request_backup
      and v_task_status <> 'Completed'
      and not v_caller_id = any(v_primary_assignees)
      and not v_caller_id = any(v_assist_assignees),
    v_request_backup
      and v_task_status <> 'Completed'
      and not v_caller_id = any(v_primary_assignees)
      and not v_caller_id = any(v_assist_assignees)
      and exists (
        select 1
        from public.task_volunteers own_offer
        where own_offer.task_id = p_task_id
          and own_offer.user_id = v_caller_id
      ),
    v_can_accept,
    case when v_can_accept then
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', valid_offer.user_id,
              'full_name', valid_offer.full_name,
              'avatar_url', valid_offer.avatar_url,
              'created_at', valid_offer.created_at
            ) order by valid_offer.created_at, valid_offer.user_id
          )
          from (
            select
              volunteer_row.user_id,
              user_row.full_name,
              user_row.avatar_url,
              volunteer_row.created_at
            from public.task_volunteers volunteer_row
            join public.users user_row
              on user_row.id = volunteer_row.user_id
             and user_row.is_active is true
            where volunteer_row.task_id = p_task_id
              and not volunteer_row.user_id = any(v_primary_assignees)
              and not volunteer_row.user_id = any(v_assist_assignees)
          ) valid_offer
        ),
        '[]'::jsonb
      )
    else '[]'::jsonb end;
end;
$$;

alter function public.get_task_backup_state(uuid) owner to postgres;
revoke all on function public.get_task_backup_state(uuid) from public, anon, authenticated;
grant execute on function public.get_task_backup_state(uuid) to authenticated;

create function public.list_help_wanted_tasks(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  out_id uuid,
  out_title text,
  out_event_id uuid,
  out_event_name text,
  out_phase text,
  out_status text,
  out_effective_priority text,
  out_due_date timestamptz,
  out_committee_id uuid,
  out_committee_name text,
  out_has_volunteered boolean,
  out_can_volunteer boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Help Wanted pagination is invalid.';
  end if;

  if v_caller_id is null or not exists (
    select 1 from public.users caller
    where caller.id = v_caller_id and caller.is_active is true
  ) then
    return;
  end if;

  return query
  select
    task_row.id,
    task_row.title,
    event_row.id,
    event_row.name,
    task_row.phase,
    task_row.status,
    public.calculate_effective_task_priority(
      task_row.priority,
      task_row.due_date,
      statement_timestamp(),
      task_row.status
    ),
    task_row.due_date,
    committee_row.id,
    committee_row.name,
    exists (
      select 1
      from public.task_volunteers own_offer
      where own_offer.task_id = task_row.id
        and own_offer.user_id = v_caller_id
    ) and not v_caller_id = any(task_row.primary_assignees)
      and not v_caller_id = any(task_row.assist_assignees),
    not v_caller_id = any(task_row.primary_assignees)
      and not v_caller_id = any(task_row.assist_assignees)
  from public.tasks task_row
  join public.events event_row
    on event_row.id = task_row.event_id
   and event_row.status = 'Active'
  join public.committees committee_row on committee_row.id = task_row.committee_id
  where task_row.request_backup is true
    and task_row.status <> 'Completed'
    and public.task_content_access(task_row.id) = 'real'
  order by task_row.due_date nulls last, task_row.id
  limit p_limit
  offset p_offset;
end;
$$;

alter function public.list_help_wanted_tasks(integer, integer) owner to postgres;
revoke all on function public.list_help_wanted_tasks(integer, integer) from public, anon, authenticated;
grant execute on function public.list_help_wanted_tasks(integer, integer) to authenticated;

create function public.list_active_task_assignees_with_workload()
returns table (
  out_id uuid,
  out_full_name text,
  out_committee_id uuid,
  out_avatar_url text,
  out_active_task_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
begin
  select user_row.role
  into v_caller_role
  from public.users user_row
  where user_row.id = auth.uid()
    and user_row.is_active is true;

  if not found or v_caller_role not in ('Admin', 'Co-Admin') then
    return;
  end if;

  return query
  select
    user_row.id,
    user_row.full_name,
    user_row.committee_id,
    user_row.avatar_url,
    count(distinct task_row.id) filter (where event_row.id is not null)::bigint
  from public.users user_row
  left join public.tasks task_row
    on task_row.status <> 'Completed'
   and (
     user_row.id = any(task_row.primary_assignees)
     or user_row.id = any(task_row.assist_assignees)
   )
  left join public.events event_row
    on event_row.id = task_row.event_id
   and event_row.status = 'Active'
  where user_row.is_active is true
  group by user_row.id, user_row.full_name, user_row.committee_id, user_row.avatar_url
  order by user_row.full_name, user_row.id;
end;
$$;

alter function public.list_active_task_assignees_with_workload() owner to postgres;
revoke all on function public.list_active_task_assignees_with_workload() from public, anon, authenticated;
grant execute on function public.list_active_task_assignees_with_workload() to authenticated;

-- Catalog assertions pin the new surface before the migration can commit.
do $$
declare
  v_function regprocedure;
  v_body text;
  v_task_lock_pos integer;
  v_event_lock_pos integer;
  v_ok boolean;
  v_writer_names text[];
begin
  foreach v_function in array array[
    'public.claim_task(uuid)'::regprocedure,
    'public.set_task_backup_request(uuid,boolean)'::regprocedure,
    'public.volunteer_for_task(uuid)'::regprocedure,
    'public.withdraw_task_volunteer(uuid)'::regprocedure,
    'public.accept_task_volunteer(uuid,uuid)'::regprocedure
  ] loop
    select lower(pg_catalog.pg_get_functiondef(v_function)) into v_body;
    v_task_lock_pos := least(
      nullif(strpos(v_body, 'for update'), 0),
      nullif(strpos(v_body, 'for no key update'), 0)
    );
    if v_task_lock_pos is null then
      v_task_lock_pos := greatest(
        strpos(v_body, 'for update'),
        strpos(v_body, 'for no key update')
      );
    end if;
    v_event_lock_pos := strpos(v_body, 'for share');

    if v_task_lock_pos <= 0 or v_event_lock_pos <= v_task_lock_pos then
      raise exception 'Unexpected task/event lock order in %.', v_function;
    end if;
  end loop;

  select lower(pg_catalog.pg_get_functiondef(
    'public.restrict_assignee_task_updates()'::regprocedure
  )) into v_body;
  v_ok := v_body like '%- ''status''%'
    and v_body like '%- ''sort_order''%'
    and v_body like '%- ''depends_on_task_id''%'
    and v_body like '%- ''primary_assignees''%'
    and v_body like '%- ''assist_assignees''%'
    and v_body like '%- ''request_backup''%'
    and v_body not like '%- ''phase''%'
    and v_body not like '%- ''event_id''%'
    and v_body not like '%- ''is_confidential''%';
  if not v_ok then
    raise exception 'The postgres assignee-guard column union is not exact.';
  end if;

  select array_agg(writer.proname order by writer.proname)
  into v_writer_names
  from (
    select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef is true
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and (
        p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
        or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M'
      )
  ) writer;

  if v_writer_names is distinct from array[
    'accept_task_volunteer',
    'assign_task_people',
    'claim_task',
    'delete_task',
    'move_task',
    'set_task_backup_request',
    'set_task_dependency',
    'unassign_self'
  ]::text[] then
    raise exception 'Unexpected postgres owner-branch task writers: %.', v_writer_names;
  end if;

  select array_agg(writer.proname order by writer.proname)
  into v_writer_names
  from (
    select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and (
        p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
        or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M'
      )
  ) writer;

  if v_writer_names is distinct from array[
    'accept_task_volunteer',
    'assign_task_people',
    'claim_task',
    'delete_task',
    'edit_event_with_tasks',
    'guard_event_updates',
    'move_task',
    'prepare_unassigned_task_reset',
    'set_task_backup_request',
    'set_task_confidentiality',
    'set_task_dependency',
    'unassign_self'
  ]::text[] then
    raise exception 'Unexpected full postgres-owned task-writer set: %.', v_writer_names;
  end if;
end
$$;
