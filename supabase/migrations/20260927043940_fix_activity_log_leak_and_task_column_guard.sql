-- ===== Fix 1: activity_log was readable by EVERYONE (critical leak) =====
-- Mirrors tasks_select's own visibility rules, applied through the
-- linked task. A deleted task's log row (task_id is null) is now
-- Admin-only, since there's no task left to check permissions against.
drop policy "activity_log_select" on activity_log;
create policy "activity_log_select"
on activity_log for select
to authenticated
using (
  my_role() = 'Admin'
  or exists (
    select 1 from tasks t
    where t.id = activity_log.task_id
      and (
        (my_role() = 'Co-Admin' and my_committee_id() = t.committee_id)
        or t.request_backup = true
        or auth.uid() = any(t.primary_assignees)
        or auth.uid() = any(t.assist_assignees)
      )
  )
);


-- ===== Fix 2: assignee-restriction trigger missed several columns =====
-- Replaced with a JSON-diff approach that automatically covers every
-- column except `status`, instead of a manually maintained list —
-- closes the allowed_viewers self-grant hole and the committee/event
-- reassignment hole, and can't silently miss a future new column.
create or replace function restrict_assignee_task_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if my_role() = 'Admin'
     or (my_role() = 'Co-Admin' and my_committee_id() = new.committee_id) then
    return new;
  end if;

  if (to_jsonb(new) - 'status' - 'updated_at') is distinct from
     (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'Assignees can only update a task''s status.';
  end if;

  return new;
end;
$$;


-- ===== Fix 3: events_insert let anyone forge created_by =====
drop policy "events_insert" on events;
create policy "events_insert"
on events for insert
to authenticated
with check (my_role() in ('Admin', 'Co-Admin') and created_by = auth.uid());


-- ===== Fix 4: pin search_path on the two functions that were missed =====
create or replace function log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (TG_OP = 'INSERT') then
    insert into activity_log (task_id, user_id, action, changes)
    values (new.id, auth.uid(), 'INSERT', to_jsonb(new));
  elsif (TG_OP = 'UPDATE') then
    insert into activity_log (task_id, user_id, action, changes)
    values (new.id, auth.uid(), 'UPDATE', jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
  elsif (TG_OP = 'DELETE') then
    insert into activity_log (task_id, user_id, action, changes)
    values (null, auth.uid(), 'DELETE', to_jsonb(old));
  end if;
  return coalesce(new, old);
end;
$$;


-- ===== Fix 5: Admins had no way to manage committees through the app =====
create policy "admin_manage_committees"
on committees for all
to authenticated
using (my_role() = 'Admin');


-- ===== Fix 6: get_task() edge case — no profile row yet =====
create or replace function get_task(p_task_id uuid)
returns table (id uuid, title text, description text)
language plpgsql
security definer
set search_path = public
as $$
declare
  can_view boolean;
begin
  select coalesce(
    (t.is_confidential = false)
    or (u.role = 'Admin')
    or (u.role = 'Co-Admin' and u.committee_id = t.committee_id)
    or (auth.uid() = any(t.primary_assignees))
    or (auth.uid() = any(t.assist_assignees))
    or (auth.uid() = any(t.allowed_viewers)),
    false
  )
  into can_view
  from tasks t left join users u on u.id = auth.uid()
  where t.id = p_task_id;

  if can_view then
    return query select t.id, t.title, t.description from tasks t where t.id = p_task_id;
  else
    return query select t.id, '🔒 Confidential Task', null from tasks t where t.id = p_task_id;
  end if;
end;
$$;


-- ===== Bonus: deactivated users (is_active = false) now lose all
-- role-based access everywhere in one place, instead of needing every
-- policy to remember to check is_active individually. =====
create or replace function my_role() returns text
language sql security definer stable
set search_path = public
as $$
  select role from users where id = auth.uid() and is_active = true
$$;

create or replace function my_committee_id() returns uuid
language sql security definer stable
set search_path = public
as $$
  select committee_id from users where id = auth.uid() and is_active = true
$$;