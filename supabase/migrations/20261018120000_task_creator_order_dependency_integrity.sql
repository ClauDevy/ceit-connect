-- Phase 4 Step 5a: task creator/order metadata, dependency integrity, and
-- immutable task parentage.
--
-- Every task mutation that must serialize per event uses this one key:
--   task_dependency_lock_key(event_id) = hashtextextended(event_id::text, 0)
-- Step 7's set_task_dependency must call this helper rather than reproduce the
-- expression. Hash collisions only serialize unrelated events; they cannot
-- weaken dependency or ordering integrity.
--
-- Final lock order:
--   edit RPC: stored event FOR UPDATE -> event advisory lock -> task rows;
--   raw insert: archive guard event FOR SHARE -> event advisory lock -> lane;
--   raw update: task row -> archive guard event FOR SHARE -> event advisory
--               lock -> dependency graph or destination lane.
-- The last order is the unavoidable raw-row inversion already documented in
-- PHASE-4-PLAN.md; SQLSTATE 40P01 is retryable and mapped by the app.

alter table public.tasks
  add column created_by uuid,
  add column sort_order bigint;

-- Refuse to install enforcement on a graph that is already invalid. Existing
-- dependencies are reported, never silently changed.
do $$
declare
  v_invalid_task_id uuid;
begin
  select t.id
  into v_invalid_task_id
  from public.tasks t
  join public.tasks dependency on dependency.id = t.depends_on_task_id
  where t.event_id is distinct from dependency.event_id
  order by t.id
  limit 1;

  if found then
    raise exception
      'Cannot enforce task dependencies: task % depends on a task in another event.',
      v_invalid_task_id;
  end if;

  with recursive dependency_walk as (
    select
      t.id as start_id,
      t.depends_on_task_id as current_id,
      array[t.id]::uuid[] as visited_ids,
      t.depends_on_task_id = t.id as has_cycle
    from public.tasks t
    where t.depends_on_task_id is not null

    union all

    select
      walk.start_id,
      current_task.depends_on_task_id,
      walk.visited_ids || walk.current_id,
      current_task.depends_on_task_id = any(walk.visited_ids || walk.current_id)
    from dependency_walk walk
    join public.tasks current_task on current_task.id = walk.current_id
    where not walk.has_cycle
      and current_task.depends_on_task_id is not null
  )
  select start_id
  into v_invalid_task_id
  from dependency_walk
  where has_cycle
  order by start_id
  limit 1;

  if found then
    raise exception
      'Cannot enforce task dependencies: the existing graph contains a cycle involving task %.',
      v_invalid_task_id;
  end if;
end
$$;

-- The disable/backfill/re-enable sequence is one atomic statement. If any
-- command or assertion fails, PostgreSQL rolls back both data updates and all
-- trigger-state changes, even under a runner that does not wrap the file.
do $$
declare
  v_expected_trigger_count integer;
begin
  select count(*)
  into v_expected_trigger_count
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.tasks'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgenabled = 'O'
    and trigger_row.tgname in (
      'tasks_guard_archived_event_writes',
      'tasks_restrict_assignee_updates',
      'tasks_activity_log'
    );

  if v_expected_trigger_count <> 3 then
    raise exception
      'Task metadata backfill requires all three named task guards to exist and be enabled.';
  end if;

  alter table public.tasks disable trigger tasks_guard_archived_event_writes;
  alter table public.tasks disable trigger tasks_restrict_assignee_updates;
  alter table public.tasks disable trigger tasks_activity_log;

  update public.tasks task_row
  set created_by = event_row.created_by
  from public.events event_row
  where event_row.id = task_row.event_id;

  with ranked_tasks as (
    select
      task_row.id,
      row_number() over (
        partition by task_row.event_id, task_row.phase, task_row.status
        order by task_row.created_at, task_row.id
      )::bigint * 1024::bigint as new_sort_order
    from public.tasks task_row
  )
  update public.tasks task_row
  set sort_order = ranked_tasks.new_sort_order
  from ranked_tasks
  where ranked_tasks.id = task_row.id;

  alter table public.tasks enable trigger tasks_guard_archived_event_writes;
  alter table public.tasks enable trigger tasks_restrict_assignee_updates;
  alter table public.tasks enable trigger tasks_activity_log;

  select count(*)
  into v_expected_trigger_count
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.tasks'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgenabled = 'O'
    and trigger_row.tgname in (
      'tasks_guard_archived_event_writes',
      'tasks_restrict_assignee_updates',
      'tasks_activity_log'
    );

  if v_expected_trigger_count <> 3 then
    raise exception
      'Task metadata backfill did not restore every named task guard.';
  end if;
end
$$;

alter table public.tasks
  alter column created_by set not null,
  alter column sort_order set not null,
  add constraint tasks_created_by_fkey
    foreign key (created_by) references public.users(id),
  add constraint tasks_sort_order_positive
    check (sort_order > 0),
  add constraint tasks_lane_sort_order_key
    unique nulls not distinct (event_id, phase, status, sort_order)
    deferrable initially immediate;

create index tasks_created_by_idx
on public.tasks (created_by);

create index tasks_depends_on_task_id_idx
on public.tasks (depends_on_task_id)
where depends_on_task_id is not null;

create function public.task_dependency_lock_key(p_event_id uuid)
returns bigint
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.hashtextextended(p_event_id::text, 0)
$$;

revoke all on function public.task_dependency_lock_key(uuid)
from public, anon;
grant execute on function public.task_dependency_lock_key(uuid)
to authenticated;

-- This trigger is the authoritative source of task creation metadata. For an
-- authenticated app call, created_by is always auth.uid(). A null-auth
-- migration-owner fixture falls back to an explicitly supplied creator, then
-- to the stored event creator; authenticated callers can never use that path.
-- The event advisory lock is taken before the lane-tail query.
create function public.assign_task_creation_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_event_creator uuid;
  v_lane_max bigint;
begin
  select event_row.id, event_row.created_by
  into v_event_id, v_event_creator
  from public.events event_row
  where event_row.id = new.event_id;

  if not found then
    raise exception 'Task creation rejected because its parent event could not be verified.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_event_id)
  );

  new.created_by := case
    when auth.uid() is not null then auth.uid()
    else coalesce(new.created_by, v_event_creator)
  end;

  select max(task_row.sort_order)
  into v_lane_max
  from public.tasks task_row
  where task_row.event_id = v_event_id
    and task_row.phase is not distinct from new.phase
    and task_row.status = new.status;

  if v_lane_max is not null
     and v_lane_max > 9223372036854774783::bigint then
    raise exception 'Task order is exhausted for this lane.';
  end if;

  new.sort_order := coalesce(v_lane_max, 0::bigint) + 1024::bigint;
  return new;
end;
$$;

revoke all on function public.assign_task_creation_metadata()
from public, anon, authenticated;

-- The z-name makes the existing archive guard take its parent FOR SHARE lock
-- first. The metadata trigger then takes the advisory lock and reads the lane.
create trigger tasks_z3_assign_creation_metadata
before insert on public.tasks
for each row
execute function public.assign_task_creation_metadata();

-- This function is deliberately VOLATILE. The advisory lock and recursive
-- query are separate SQL statements, so under READ COMMITTED the graph query
-- receives a fresh statement snapshot after any lock wait.
create function public.validate_task_dependency()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_dependency_event_id uuid;
  v_cycle_exists boolean;
begin
  if TG_OP = 'UPDATE' then
    v_event_id := old.event_id;
  else
    select event_row.id
    into v_event_id
    from public.events event_row
    where event_row.id = new.event_id;

    if not found then
      raise exception 'Task dependency rejected because its parent event could not be verified.';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_event_id)
  );

  if new.depends_on_task_id is null then
    return new;
  end if;

  if new.depends_on_task_id = new.id then
    raise exception 'A task cannot depend on itself.';
  end if;

  select dependency.event_id
  into v_dependency_event_id
  from public.tasks dependency
  where dependency.id = new.depends_on_task_id;

  if not found then
    raise exception 'The selected prerequisite task does not exist.';
  end if;

  if v_dependency_event_id is distinct from v_event_id then
    raise exception 'A task can depend only on another task in the same event.';
  end if;

  with recursive dependency_chain as (
    select dependency.id, dependency.depends_on_task_id, array[dependency.id]::uuid[] as visited_ids
    from public.tasks dependency
    where dependency.id = new.depends_on_task_id

    union all

    select dependency.id,
           dependency.depends_on_task_id,
           chain.visited_ids || dependency.id
    from dependency_chain chain
    join public.tasks dependency on dependency.id = chain.depends_on_task_id
    where not dependency.id = any(chain.visited_ids)
  )
  select exists (
    select 1
    from dependency_chain chain
    where chain.id = new.id
  )
  into v_cycle_exists;

  if v_cycle_exists then
    raise exception 'This dependency would create a cycle.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_task_dependency()
from public, anon, authenticated;

create trigger tasks_validate_dependency
before insert or update of depends_on_task_id on public.tasks
for each row
execute function public.validate_task_dependency();

-- Direct prerequisite deletion receives a clear error. The existing event
-- BEFORE DELETE trigger deletes all child tasks from nested trigger depth, so
-- pg_trigger_depth() > 1 identifies that whole-event cascade path and lets the
-- FK remove prerequisites and dependents together.
create function public.guard_referenced_prerequisite_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;

  if exists (
    select 1
    from public.tasks dependent
    where dependent.depends_on_task_id = old.id
  ) then
    raise exception using
      errcode = 'CCD01',
      message = 'This task cannot be deleted because another task depends on it.';
  end if;

  return old;
end;
$$;

revoke all on function public.guard_referenced_prerequisite_deletion()
from public, anon, authenticated;

create trigger tasks_guard_referenced_prerequisite_deletion
before delete on public.tasks
for each row
execute function public.guard_referenced_prerequisite_deletion();

-- These UPDATE triggers intentionally sort after both existing BEFORE UPDATE
-- guards by name: tasks_guard_archived_event_writes and
-- tasks_restrict_assignee_updates. That lets the assignee guard inspect only
-- the caller's status change before the database assigns a destination rank.
create function public.reject_task_event_id_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.event_id is distinct from new.event_id then
    raise exception 'A task cannot be moved to another event.';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_task_event_id_changes()
from public, anon, authenticated;

create trigger tasks_z0_reject_event_id_changes
before update of event_id on public.tasks
for each row
execute function public.reject_task_event_id_changes();

create function public.reject_task_created_by_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.created_by is distinct from new.created_by then
    raise exception 'A task''s created_by cannot be changed.';
  end if;

  return new;
end;
$$;

revoke all on function public.reject_task_created_by_changes()
from public, anon, authenticated;

create trigger tasks_z1_reject_created_by_changes
before update of created_by on public.tasks
for each row
execute function public.reject_task_created_by_changes();

create function public.set_task_destination_lane_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_lane_max bigint;
begin
  if old.event_id is distinct from new.event_id then
    return new;
  end if;

  if old.phase is not distinct from new.phase
     and old.status is not distinct from new.status then
    if old.sort_order is distinct from new.sort_order then
      raise exception 'Task order can only be changed by moving the task to another lane.';
    end if;
    return new;
  end if;

  select event_row.id
  into v_event_id
  from public.events event_row
  where event_row.id = old.event_id;

  if not found then
    raise exception 'Task order rejected because its parent event could not be verified.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.task_dependency_lock_key(v_event_id)
  );

  select max(task_row.sort_order)
  into v_lane_max
  from public.tasks task_row
  where task_row.event_id = v_event_id
    and task_row.id <> old.id
    and task_row.phase is not distinct from new.phase
    and task_row.status = new.status;

  if v_lane_max is not null
     and v_lane_max > 9223372036854774783::bigint then
    raise exception 'Task order is exhausted for this lane.';
  end if;

  new.sort_order := coalesce(v_lane_max, 0::bigint) + 1024::bigint;
  return new;
end;
$$;

revoke all on function public.set_task_destination_lane_order()
from public, anon, authenticated;

create trigger tasks_z2_set_destination_lane_order
before update of phase, status, sort_order on public.tasks
for each row
execute function public.set_task_destination_lane_order();

-- This is the 20261015180000 definition with only the stored-event advisory
-- lock additions: one UUID variable, the locked row's id in the existing
-- SELECT, and the lock call immediately after the not-found check.
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
security invoker
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
begin
  v_role := public.my_role();
  v_my_committee_id := public.my_committee_id();

  if auth.uid() is null or v_role is null or v_role not in ('Admin', 'Co-Admin') then
    raise exception 'Only active Admins and Co-Admins can edit events.';
  end if;

  if p_event_id is null or p_expected_updated_at is null then
    raise exception 'The event ID and expected updated_at are required.';
  end if;

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

  if v_event_status = 'Draft'
     and p_status = 'Active'
     and p_end_date is null then
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

    if v_operation = 'add' and exists (
      select 1
      from unnest(v_assignees) as a(assignee_id)
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

  -- Check the real all-committee final state explicitly for the edit RPC.
  -- The deferred triggers below remain the database-wide enforcement for
  -- direct task writes and concurrent transactions.
  if p_status = 'Active'
     and cardinality(p_task_ids_to_delete) > 0
     and not public.event_has_tasks_for_editor(p_event_id) then
    raise exception 'An Active event must have at least one task.';
  end if;

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
