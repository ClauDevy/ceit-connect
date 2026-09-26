-- ========== EVENTS ==========
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  banner_url text,
  start_date date not null,
  end_date date,
  status text not null default 'Draft' check (status in ('Draft', 'Active', 'Archived')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

alter table events enable row level security;

-- Anyone logged in can see a non-Draft event. A Draft is visible ONLY
-- to whoever created it, per the doc's Draft-events rule.
create policy "events_select"
on events for select
to authenticated
using (status != 'Draft' or created_by = auth.uid());

-- Only Admins and Co-Admins can create events.
create policy "events_insert"
on events for insert
to authenticated
with check (my_role() in ('Admin', 'Co-Admin'));

-- The creator or any Admin can update/launch/archive an event.
create policy "events_update"
on events for update
to authenticated
using (created_by = auth.uid() or my_role() = 'Admin');

-- Only Admins can delete an event outright.
create policy "events_delete"
on events for delete
to authenticated
using (my_role() = 'Admin');


-- ========== TASKS ==========
create table tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  committee_id uuid not null references committees(id),
  title text not null,
  description text,
  phase text,
  status text not null default 'To Do' check (status in ('To Do', 'In Progress', 'Completed')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Critical')),
  task_type text not null default 'Deliverable' check (task_type in ('Deliverable', 'LiveOperation')),
  due_date timestamptz,
  call_time timestamptz,
  end_time timestamptz,
  primary_assignees uuid[] not null default '{}',
  assist_assignees uuid[] not null default '{}',
  is_confidential boolean not null default false,
  request_backup boolean not null default false,
  depends_on_task_id uuid references tasks(id),
  allowed_viewers uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table tasks enable row level security;

-- Who can see a task ROW exists (not its confidential content — see
-- get_task() below for that): Admins see everything; Co-Admins see
-- their own committee's tasks; anyone can see a task flagged for
-- "Request Backup" (the council-wide Help Wanted tab); Members can
-- see tasks they're assigned to, primary or assist.
create policy "tasks_select"
on tasks for select
to authenticated
using (
  my_role() = 'Admin'
  or (my_role() = 'Co-Admin' and my_committee_id() = committee_id)
  or request_backup = true
  or auth.uid() = any(primary_assignees)
  or auth.uid() = any(assist_assignees)
);

-- Only Admins and Co-Admins (within their own committee) can create tasks.
create policy "tasks_insert"
on tasks for insert
to authenticated
with check (
  my_role() = 'Admin'
  or (my_role() = 'Co-Admin' and my_committee_id() = committee_id)
);

-- Admins, the owning Co-Admin, or an assignee can update a task
-- (assignees need this for status changes / drag-and-drop).
create policy "tasks_update"
on tasks for update
to authenticated
using (
  my_role() = 'Admin'
  or (my_role() = 'Co-Admin' and my_committee_id() = committee_id)
  or auth.uid() = any(primary_assignees)
  or auth.uid() = any(assist_assignees)
);

-- Deletion restricted to Admins and the owning Co-Admin only — per the
-- doc's "Safe Deletion" rule (confirmation-gated, not drag-to-delete).
create policy "tasks_delete"
on tasks for delete
to authenticated
using (
  my_role() = 'Admin'
  or (my_role() = 'Co-Admin' and my_committee_id() = committee_id)
);


-- ========== CONFIDENTIAL TASK MASKING (doc §6.3) ==========
-- Includes the allowed_viewers addition discussed and flagged earlier.
create or replace function get_task(p_task_id uuid)
returns table (id uuid, title text, description text)
language plpgsql
security definer
set search_path = public
as $$
declare
  can_view boolean;
begin
  select
    (t.is_confidential = false)
    or (u.role = 'Admin')
    or (u.role = 'Co-Admin' and u.committee_id = t.committee_id)
    or (auth.uid() = any(t.primary_assignees))
    or (auth.uid() = any(t.assist_assignees))
    or (auth.uid() = any(t.allowed_viewers))
  into can_view
  from tasks t join users u on u.id = auth.uid()
  where t.id = p_task_id;

  if can_view then
    return query select t.id, t.title, t.description from tasks t where t.id = p_task_id;
  else
    return query select t.id, '🔒 Confidential Task', null from tasks t where t.id = p_task_id;
  end if;
end;
$$;