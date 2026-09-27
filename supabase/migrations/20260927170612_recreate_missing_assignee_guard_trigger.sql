-- The trigger itself was missing (function existed, but was never
-- actually attached to the table) — this is why a plain assignee could
-- edit `priority` freely despite the guard function existing.
-- CREATE OR REPLACE the function too, to guarantee its body is
-- definitely correct, not just assume the old version was fine.
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

  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'Assignees can only update a task''s status.';
  end if;

  return new;
end;
$$;

-- Drop first in case a stray/broken version exists under a different
-- name, then create fresh.
drop trigger if exists tasks_restrict_assignee_updates on tasks;
create trigger tasks_restrict_assignee_updates
before update on tasks
for each row execute function restrict_assignee_task_updates();