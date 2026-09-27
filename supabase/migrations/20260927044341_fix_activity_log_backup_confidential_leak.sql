-- Closes an edge case: a task that's BOTH is_confidential=true AND
-- request_backup=true would previously still leak its real title/
-- description through activity_log's `changes` column to a user who
-- only has "Help Wanted" visibility, not real access — since
-- get_task()'s masking rules never treat request_backup as a reason
-- to bypass confidentiality. This policy is deliberately NOT a mirror
-- of tasks_select anymore (a bare `exists` against tasks would inherit
-- tasks_select's rules automatically, but those are the wrong rules for
-- what's safe to expose in a historical diff) — kept explicit on purpose.
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
        or auth.uid() = any(t.primary_assignees)
        or auth.uid() = any(t.assist_assignees)
        or (t.request_backup = true and t.is_confidential = false)
      )
  )
);

-- Removed the harmless-but-meaningless `- 'updated_at'` key subtraction
-- (tasks has no updated_at column).
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