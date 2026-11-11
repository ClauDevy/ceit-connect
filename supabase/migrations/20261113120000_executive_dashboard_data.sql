-- Phase 5 D1: confidential-safe Executive Dashboard workload readers.
-- This migration adds read-only functions only: no table, policy, trigger,
-- foreign key, task/event writer, or existing function is replaced.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'D1 must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create function ceit_connect_private.executive_dashboard_committee_counts(
  p_committee_id uuid
)
returns table (
  out_unique_active_task_count bigint,
  out_covered_task_count bigint,
  out_unassigned_task_count bigint,
  out_inactive_only_task_count bigint,
  out_active_outside_committee_only_task_count bigint,
  out_tasks_without_member_bar_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with active_tasks as materialized (
    select
      task_row.id as task_id,
      array(
        select distinct assignment.assignee_id
        from pg_catalog.unnest(
          task_row.primary_assignees || task_row.assist_assignees
        ) as assignment(assignee_id)
        where assignment.assignee_id is not null
        order by assignment.assignee_id
      ) as assignee_ids
    from public.tasks as task_row
    join public.events as event_row
      on event_row.id = task_row.event_id
     and event_row.status = 'Active'
    where task_row.committee_id = p_committee_id
      and task_row.status <> 'Completed'
  ), classified as materialized (
    select
      active_task.task_id,
      pg_catalog.cardinality(active_task.assignee_ids) = 0 as is_unassigned,
      exists (
        select 1
        from pg_catalog.unnest(active_task.assignee_ids) as assignment(assignee_id)
        join public.users as profile
          on profile.id = assignment.assignee_id
         and profile.is_active is true
      ) as has_active_assignee,
      exists (
        select 1
        from pg_catalog.unnest(active_task.assignee_ids) as assignment(assignee_id)
        join public.users as profile
          on profile.id = assignment.assignee_id
         and profile.is_active is true
         and profile.committee_id = p_committee_id
      ) as has_active_committee_member
    from active_tasks as active_task
  )
  select
    pg_catalog.count(*)::bigint,
    pg_catalog.count(*) filter (
      where classified.has_active_assignee
    )::bigint,
    pg_catalog.count(*) filter (
      where classified.is_unassigned
    )::bigint,
    pg_catalog.count(*) filter (
      where not classified.is_unassigned
        and not classified.has_active_assignee
    )::bigint,
    pg_catalog.count(*) filter (
      where classified.has_active_assignee
        and not classified.has_active_committee_member
    )::bigint,
    pg_catalog.count(*) filter (
      where classified.is_unassigned
         or not classified.has_active_assignee
         or (
           classified.has_active_assignee
           and not classified.has_active_committee_member
         )
    )::bigint
  from classified
$$;

alter function ceit_connect_private.executive_dashboard_committee_counts(uuid)
owner to postgres;
revoke all on function ceit_connect_private.executive_dashboard_committee_counts(uuid)
from public, anon, authenticated, service_role;

create function public.list_executive_dashboard_committee_totals()
returns table (
  out_committee_id uuid,
  out_committee_name text,
  out_unique_active_task_count bigint,
  out_covered_task_count bigint,
  out_unassigned_task_count bigint,
  out_inactive_only_task_count bigint,
  out_active_outside_committee_only_task_count bigint,
  out_tasks_without_member_bar_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
begin
  select profile.role
  into v_caller_role
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found or v_caller_role <> 'Admin' then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  select
    committee_row.id,
    committee_row.name,
    committee_counts.out_unique_active_task_count,
    committee_counts.out_covered_task_count,
    committee_counts.out_unassigned_task_count,
    committee_counts.out_inactive_only_task_count,
    committee_counts.out_active_outside_committee_only_task_count,
    committee_counts.out_tasks_without_member_bar_count
  from public.committees as committee_row
  cross join lateral
    ceit_connect_private.executive_dashboard_committee_counts(committee_row.id)
      as committee_counts
  order by committee_row.name, committee_row.id;
end;
$$;

alter function public.list_executive_dashboard_committee_totals()
owner to postgres;
revoke all on function public.list_executive_dashboard_committee_totals()
from public, anon, authenticated, service_role;
grant execute on function public.list_executive_dashboard_committee_totals()
to authenticated;

create function public.get_executive_dashboard_committee_summary(
  p_committee_id uuid
)
returns table (
  out_committee_id uuid,
  out_committee_name text,
  out_unique_active_task_count bigint,
  out_covered_task_count bigint,
  out_unassigned_task_count bigint,
  out_inactive_only_task_count bigint,
  out_active_outside_committee_only_task_count bigint,
  out_tasks_without_member_bar_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or p_committee_id is null
     or not exists (
       select 1
       from public.committees as committee_row
       where committee_row.id = p_committee_id
         and (
           v_caller_role = 'Admin'
           or (
             v_caller_role = 'Co-Admin'
             and v_caller_committee_id = committee_row.id
           )
         )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  select
    committee_row.id,
    committee_row.name,
    committee_counts.out_unique_active_task_count,
    committee_counts.out_covered_task_count,
    committee_counts.out_unassigned_task_count,
    committee_counts.out_inactive_only_task_count,
    committee_counts.out_active_outside_committee_only_task_count,
    committee_counts.out_tasks_without_member_bar_count
  from public.committees as committee_row
  cross join lateral
    ceit_connect_private.executive_dashboard_committee_counts(committee_row.id)
      as committee_counts
  where committee_row.id = p_committee_id;
end;
$$;

alter function public.get_executive_dashboard_committee_summary(uuid)
owner to postgres;
revoke all on function public.get_executive_dashboard_committee_summary(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_executive_dashboard_committee_summary(uuid)
to authenticated;

create function public.list_executive_dashboard_committee_members(
  p_committee_id uuid
)
returns table (
  out_committee_id uuid,
  out_member_id uuid,
  out_full_name text,
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
  v_caller_committee_id uuid;
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or p_committee_id is null
     or not exists (
       select 1
       from public.committees as committee_row
       where committee_row.id = p_committee_id
         and (
           v_caller_role = 'Admin'
           or (
             v_caller_role = 'Co-Admin'
             and v_caller_committee_id = committee_row.id
           )
         )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  select
    profile.committee_id,
    profile.id,
    profile.full_name,
    profile.avatar_url,
    pg_catalog.count(distinct task_row.id) filter (
      where event_row.id is not null
    )::bigint
  from public.users as profile
  left join public.tasks as task_row
    on task_row.committee_id = p_committee_id
   and task_row.status <> 'Completed'
   and (
     profile.id = any(task_row.primary_assignees)
     or profile.id = any(task_row.assist_assignees)
   )
  left join public.events as event_row
    on event_row.id = task_row.event_id
   and event_row.status = 'Active'
  where profile.is_active is true
    and profile.committee_id = p_committee_id
  group by profile.committee_id, profile.id, profile.full_name, profile.avatar_url
  order by profile.full_name, profile.id;
end;
$$;

alter function public.list_executive_dashboard_committee_members(uuid)
owner to postgres;
revoke all on function public.list_executive_dashboard_committee_members(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_executive_dashboard_committee_members(uuid)
to authenticated;

comment on function ceit_connect_private.executive_dashboard_committee_counts(uuid)
is 'D1 shared aggregate for one task-owning committee. It performs no authorization and has no application-role execute grant.';
comment on function public.list_executive_dashboard_committee_totals()
is 'D1 active-Admin-only Level 1 totals for every retained committee, including zero-task committees.';
comment on function public.get_executive_dashboard_committee_summary(uuid)
is 'D1 Level 2 summary for an active Admin or the active owning Co-Admin; unavailable and unauthorized committees share one denial.';
comment on function public.list_executive_dashboard_committee_members(uuid)
is 'D1 Level 2 true workload bars for active profiles currently belonging to the authorized task-owning committee.';
