-- Phase 4 Step 9-DB (part 1): centralize the existing task-content decision
-- so comment mention validation can evaluate a specific active user without
-- changing the public task_content_access(uuid) contract.

create function public.task_content_access_for_user(
  p_task_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user_role text;
  v_user_committee_id uuid;
  v_event_status text;
  v_task_committee_id uuid;
  v_is_confidential boolean;
  v_primary_assignees uuid[];
  v_assist_assignees uuid[];
  v_allowed_viewers uuid[];
begin
  select user_row.role, user_row.committee_id
  into v_user_role, v_user_committee_id
  from public.users user_row
  where user_row.id = p_user_id
    and user_row.is_active is true;

  if not found then
    return 'hidden';
  end if;

  select
    event_row.status,
    task_row.committee_id,
    task_row.is_confidential,
    task_row.primary_assignees,
    task_row.assist_assignees,
    task_row.allowed_viewers
  into
    v_event_status,
    v_task_committee_id,
    v_is_confidential,
    v_primary_assignees,
    v_assist_assignees,
    v_allowed_viewers
  from public.tasks task_row
  join public.events event_row on event_row.id = task_row.event_id
  where task_row.id = p_task_id;

  if not found then
    return 'hidden';
  end if;

  if v_event_status = 'Draft' then
    if v_user_role = 'Admin'
       or (
         v_user_role = 'Co-Admin'
         and v_user_committee_id = v_task_committee_id
       ) then
      return 'real';
    end if;

    return 'hidden';
  end if;

  if v_is_confidential is false
     or v_user_role = 'Admin'
     or (
       v_user_role = 'Co-Admin'
       and v_user_committee_id = v_task_committee_id
     )
     or p_user_id = any(v_primary_assignees)
     or p_user_id = any(v_assist_assignees)
     or p_user_id = any(v_allowed_viewers) then
    return 'real';
  end if;

  return 'masked';
end;
$$;

alter function public.task_content_access_for_user(uuid, uuid)
owner to postgres;

revoke all on function public.task_content_access_for_user(uuid, uuid)
from public, anon, authenticated;

-- Keep the original signature, attributes, owner, and no-client-execute grant.
-- Null, inactive, and profile-less callers still resolve to hidden through the
-- user-aware helper.
create or replace function public.task_content_access(p_task_id uuid)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  return public.task_content_access_for_user(p_task_id, auth.uid());
end;
$$;

alter function public.task_content_access(uuid)
owner to postgres;

revoke all on function public.task_content_access(uuid)
from public, anon, authenticated;
