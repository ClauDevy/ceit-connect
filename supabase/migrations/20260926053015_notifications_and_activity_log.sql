-- ========== NOTIFICATIONS ==========
-- The Bell Icon's source of truth (doc §4E) — a real table, not just
-- inferred from live Realtime events, so unread counts survive a refresh.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in
    ('mention', 'assignment', 'status_change', 'unlock', 'backup_request', 'heads_up')),
  task_id uuid references tasks(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

-- You can only ever see your OWN notifications — nobody else's, no
-- exceptions, not even Admins (this is personal inbox data).
create policy "notifications_select_own"
on notifications for select
to authenticated
using (user_id = auth.uid());

-- You can only mark your own notifications as read (an update, in
-- practice, is just setting read_at).
create policy "notifications_update_own"
on notifications for update
to authenticated
using (user_id = auth.uid());

-- Inserting a notification happens via backend logic (e.g. a trigger
-- reacting to a mention or assignment), not directly by end users —
-- so no insert policy is added here. Rows get created via a
-- security-definer function or server-side code, covered later
-- when the actual trigger logic is built in Phase 5.


-- ========== ACTIVITY LOG ==========
-- Immutable audit trail (doc §4D) — every task change gets logged here
-- automatically via a trigger (added below), and NOTHING can update or
-- delete a row once it exists, not even Admins.
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  changes jsonb,
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;

-- Anyone logged in can READ the activity log (doc says RLS permits
-- SELECT only — no insert/update/delete policy exists for any role,
-- which means nobody can write to it directly, only the trigger below
-- can, since it runs with elevated trigger privileges).
create policy "activity_log_select"
on activity_log for select
to authenticated
using (true);

-- The actual trigger: fires automatically on every task change and
-- writes a row here. This is what makes the log "immutable" in
-- practice — nobody writes to it by hand, only this function does.
create or replace function log_task_activity()
returns trigger
language plpgsql
security definer
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
    values (old.id, auth.uid(), 'DELETE', to_jsonb(old));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger tasks_activity_log
after insert or update or delete on tasks
for each row execute function log_task_activity();