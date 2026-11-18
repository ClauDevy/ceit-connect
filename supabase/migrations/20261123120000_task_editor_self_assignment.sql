-- Allow active leadership to select themselves only through the five task-editor
-- writers. All other assignee, viewer, claim, volunteer, and raw-write rules stay
-- unchanged.

create function public.task_editor_self_assignment_allowed(
  p_actor_id uuid,
  p_old_committee_id uuid,
  p_new_committee_id uuid,
  p_operation text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_writer text := coalesce(
    pg_catalog.current_setting('ceit_connect.task_assignee_writer', true), ''
  );
  v_role text;
  v_committee_id uuid;
begin
  if current_user <> 'postgres'
     or v_writer not in (
       'create_event_with_tasks',
       'create_event_from_archived_template',
       'edit_event_with_tasks',
       'create_active_event_task',
       'edit_active_event_task'
     )
     or p_actor_id is null
     or p_operation not in ('INSERT', 'UPDATE') then
    return false;
  end if;

  select profile.role, profile.committee_id
  into v_role, v_committee_id
  from public.users as profile
  where profile.id = p_actor_id
    and profile.is_active is true
    and profile.role in ('Admin', 'Co-Admin');

  if not found then
    return false;
  end if;

  if v_role = 'Admin' then
    return true;
  end if;

  return v_committee_id is not null
    and v_committee_id is not distinct from p_new_committee_id
    and (
      p_operation = 'INSERT'
      or v_committee_id is not distinct from p_old_committee_id
    );
end;
$$;

alter function public.task_editor_self_assignment_allowed(uuid, uuid, uuid, text)
owner to postgres;
revoke all on function public.task_editor_self_assignment_allowed(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

-- This is the exact 20261031120000 guard with one predicate addition: the
-- read-only helper may allow the acting user for the five task-editor markers.
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
     and v_actor = any(v_added)
     and not public.task_editor_self_assignment_allowed(
       v_actor,
       case when tg_op = 'UPDATE' then old.committee_id else null::uuid end,
       new.committee_id,
       tg_op
     ) then
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
