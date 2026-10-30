-- Fix the Batch 13 confidentiality writer's postgres trigger branch.
-- Apply manually to Dev first. Never run this migration from an agent session.

create or replace function public.restrict_assignee_task_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.task_assignee_writer', true
  );
begin
  if current_user = 'postgres' then
    if v_writer = 'edit_event_with_tasks' then
      if (
        pg_catalog.to_jsonb(new)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees'
      ) is distinct from (
        pg_catalog.to_jsonb(old)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees'
      ) then
        raise exception 'The Edit Event writer attempted an out-of-scope task update.';
      end if;
      return new;
    elsif v_writer = 'edit_active_event_task' then
      if (
        pg_catalog.to_jsonb(new)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees' - 'assist_assignees'
          - 'is_confidential' - 'allowed_viewers' - 'status' - 'sort_order'
      ) is distinct from (
        pg_catalog.to_jsonb(old)
          - 'title' - 'description' - 'committee_id' - 'phase'
          - 'priority' - 'task_type' - 'due_date' - 'call_time'
          - 'end_time' - 'primary_assignees' - 'assist_assignees'
          - 'is_confidential' - 'allowed_viewers' - 'status' - 'sort_order'
      ) then
        raise exception 'The Active-event task editor attempted an out-of-scope update.';
      end if;
      return new;
    elsif coalesce(
      pg_catalog.current_setting('ceit_connect.task_access_writer', true), ''
    ) = 'set_task_confidentiality' then
      if (
        pg_catalog.to_jsonb(new) - 'is_confidential' - 'allowed_viewers'
      ) is distinct from (
        pg_catalog.to_jsonb(old) - 'is_confidential' - 'allowed_viewers'
      ) then
        raise exception 'The task confidentiality writer attempted an out-of-scope update.';
      end if;
      return new;
    elsif (
      pg_catalog.to_jsonb(new) - 'status' - 'sort_order'
        - 'depends_on_task_id' - 'primary_assignees'
        - 'assist_assignees' - 'request_backup'
    ) is distinct from (
      pg_catalog.to_jsonb(old) - 'status' - 'sort_order'
        - 'depends_on_task_id' - 'primary_assignees'
        - 'assist_assignees' - 'request_backup'
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

  if (pg_catalog.to_jsonb(new) - 'status') is distinct from
     (pg_catalog.to_jsonb(old) - 'status') then
    raise exception 'Assignees can only update a task''s status.';
  end if;
  return new;
end;
$$;

alter function public.restrict_assignee_task_updates() owner to postgres;
revoke all on function public.restrict_assignee_task_updates()
from public, anon, authenticated;
