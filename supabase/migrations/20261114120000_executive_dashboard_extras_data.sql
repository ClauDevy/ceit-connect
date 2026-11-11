-- Phase 5 D1b: Executive Dashboard extra database readers.
-- Read-only functions only: no table, policy, trigger, foreign key, writer,
-- or existing function is added, replaced, or changed.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'D1b must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create function ceit_connect_private.classify_executive_dashboard_task(
  p_due_date timestamptz,
  p_status text,
  p_as_of timestamptz
)
returns table (
  out_is_overdue boolean,
  out_is_due_in_24_hours boolean,
  out_is_at_risk boolean,
  out_bucket text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_as_of is null
     or p_status is null
     or p_status not in ('To Do', 'In Progress', 'Completed') then
    raise exception using
      errcode = '22023',
      message = 'Task classification inputs are invalid.';
  end if;

  out_is_overdue := p_status <> 'Completed'
    and p_due_date is not null
    and p_due_date < p_as_of;
  out_is_due_in_24_hours := p_status <> 'Completed'
    and p_due_date is not null
    and p_due_date >= p_as_of
    and p_due_date <= p_as_of + interval '24 hours';
  out_is_at_risk := p_status = 'To Do'
    and p_due_date is not null
    and p_due_date > p_as_of + interval '24 hours'
    and p_due_date <= p_as_of + interval '48 hours';
  out_bucket := case
    when p_status = 'Completed' then 'Completed'
    when out_is_overdue then 'Overdue'
    when out_is_due_in_24_hours then 'Due in 24 hours'
    when p_status = 'In Progress' then 'In Progress'
    else 'To Do'
  end;

  return next;
end;
$$;

alter function ceit_connect_private.classify_executive_dashboard_task(
  timestamptz, text, timestamptz
) owner to postgres;
revoke all on function ceit_connect_private.classify_executive_dashboard_task(
  timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;

create function public.get_executive_dashboard_extras_overview(
  p_committee_id uuid default null
)
returns table (
  out_open_task_count bigint,
  out_overdue_task_count bigint,
  out_due_in_24_hours_task_count bigint,
  out_unassigned_task_count bigint,
  out_help_wanted_task_count bigint,
  out_needs_approval_count bigint,
  out_donut_overdue_count bigint,
  out_donut_due_in_24_hours_count bigint,
  out_donut_in_progress_count bigint,
  out_donut_to_do_count bigint,
  out_donut_completed_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
  v_as_of timestamptz := statement_timestamp();
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or (p_committee_id is null and v_caller_role <> 'Admin')
     or (
       p_committee_id is not null
       and not exists (
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
       )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  with selected_committees as materialized (
    select committee_row.id
    from public.committees as committee_row
    where p_committee_id is null or committee_row.id = p_committee_id
  ), d1_open as materialized (
    select coalesce(
      pg_catalog.sum(committee_counts.out_unique_active_task_count),
      0
    )::bigint as open_task_count
    from selected_committees as selected_committee
    cross join lateral
      ceit_connect_private.executive_dashboard_committee_counts(
        selected_committee.id
      ) as committee_counts
  ), scoped_tasks as materialized (
    select
      task_row.id,
      task_row.status,
      task_row.due_date,
      task_row.request_backup,
      task_row.primary_assignees,
      task_row.assist_assignees,
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
    where p_committee_id is null
       or task_row.committee_id = p_committee_id
  ), classified as materialized (
    select scoped_task.*,
      classification.out_is_overdue,
      classification.out_is_due_in_24_hours,
      classification.out_bucket
    from scoped_tasks as scoped_task
    cross join lateral ceit_connect_private.classify_executive_dashboard_task(
      scoped_task.due_date,
      scoped_task.status,
      v_as_of
    ) as classification
  ), task_counts as materialized (
    select
      pg_catalog.count(*) filter (
        where classified.status <> 'Completed'
          and classified.out_is_overdue
      )::bigint as overdue_task_count,
      pg_catalog.count(*) filter (
        where classified.status <> 'Completed'
          and classified.out_is_due_in_24_hours
      )::bigint as due_in_24_hours_task_count,
      pg_catalog.count(*) filter (
        where classified.status <> 'Completed'
          and pg_catalog.cardinality(classified.assignee_ids) = 0
      )::bigint as unassigned_task_count,
      pg_catalog.count(*) filter (
        where classified.status <> 'Completed'
          and classified.request_backup is true
      )::bigint as help_wanted_task_count,
      pg_catalog.count(*) filter (
        where classified.out_bucket = 'Overdue'
      )::bigint as donut_overdue_count,
      pg_catalog.count(*) filter (
        where classified.out_bucket = 'Due in 24 hours'
      )::bigint as donut_due_in_24_hours_count,
      pg_catalog.count(*) filter (
        where classified.out_bucket = 'In Progress'
      )::bigint as donut_in_progress_count,
      pg_catalog.count(*) filter (
        where classified.out_bucket = 'To Do'
      )::bigint as donut_to_do_count,
      pg_catalog.count(*) filter (
        where classified.out_bucket = 'Completed'
      )::bigint as donut_completed_count
    from classified
  ), approval_counts as materialized (
    select (
      select pg_catalog.count(*)::bigint
      from public.task_leave_requests as leave_request
      join scoped_tasks as scoped_task
        on scoped_task.id = leave_request.task_id
       and scoped_task.status <> 'Completed'
      where leave_request.status = 'pending'
        and (
          leave_request.requester_id = any(scoped_task.primary_assignees)
          or leave_request.requester_id = any(scoped_task.assist_assignees)
        )
    ) + (
      select pg_catalog.count(*)::bigint
      from public.task_volunteers as volunteer_offer
      join scoped_tasks as scoped_task
        on scoped_task.id = volunteer_offer.task_id
       and scoped_task.status <> 'Completed'
       and scoped_task.request_backup is true
      join public.users as volunteer_profile
        on volunteer_profile.id = volunteer_offer.user_id
       and volunteer_profile.is_active is true
      where not (
        volunteer_offer.user_id = any(scoped_task.primary_assignees)
        or volunteer_offer.user_id = any(scoped_task.assist_assignees)
      )
    ) as needs_approval_count
  )
  select
    d1_open.open_task_count,
    task_counts.overdue_task_count,
    task_counts.due_in_24_hours_task_count,
    task_counts.unassigned_task_count,
    task_counts.help_wanted_task_count,
    approval_counts.needs_approval_count,
    task_counts.donut_overdue_count,
    task_counts.donut_due_in_24_hours_count,
    task_counts.donut_in_progress_count,
    task_counts.donut_to_do_count,
    task_counts.donut_completed_count
  from d1_open
  cross join task_counts
  cross join approval_counts;
end;
$$;

alter function public.get_executive_dashboard_extras_overview(uuid)
owner to postgres;
revoke all on function public.get_executive_dashboard_extras_overview(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_executive_dashboard_extras_overview(uuid)
to authenticated;

create function public.list_executive_dashboard_needs_attention(
  p_committee_id uuid default null
)
returns table (
  out_category text,
  out_task_id uuid,
  out_label text,
  out_committee_id uuid,
  out_committee_name text,
  out_due_date timestamptz,
  out_source_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
  v_as_of timestamptz := statement_timestamp();
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or (p_committee_id is null and v_caller_role <> 'Admin')
     or (
       p_committee_id is not null
       and not exists (
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
       )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  with scoped_tasks as materialized (
    select
      task_row.id,
      task_row.title,
      task_row.status,
      task_row.due_date,
      task_row.request_backup,
      task_row.is_confidential,
      task_row.committee_id,
      committee_row.name as committee_name,
      task_row.primary_assignees,
      task_row.assist_assignees,
      task_row.created_at,
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
    join public.committees as committee_row
      on committee_row.id = task_row.committee_id
    where task_row.status <> 'Completed'
      and (
        p_committee_id is null
        or task_row.committee_id = p_committee_id
      )
  ), classified as materialized (
    select scoped_task.*,
      classification.out_is_overdue,
      classification.out_is_due_in_24_hours
    from scoped_tasks as scoped_task
    cross join lateral ceit_connect_private.classify_executive_dashboard_task(
      scoped_task.due_date,
      scoped_task.status,
      v_as_of
    ) as classification
  ), task_candidates as materialized (
    select
      case
        when classified.out_is_overdue then 'overdue'
        when classified.out_is_due_in_24_hours then 'due_in_24_hours'
        when classified.request_backup is true then 'help_wanted'
        when pg_catalog.cardinality(classified.assignee_ids) = 0 then 'unassigned'
        else 'needs_new_owner'
      end as category,
      case
        when classified.out_is_overdue then 1
        when classified.out_is_due_in_24_hours then 2
        when classified.request_backup is true then 4
        when pg_catalog.cardinality(classified.assignee_ids) = 0 then 6
        else 5
      end as category_rank,
      case when classified.is_confidential then null else classified.id end
        as visible_task_id,
      case
        when classified.is_confidential then 'Confidential task'
        else classified.title
      end as label,
      classified.committee_id,
      classified.committee_name,
      classified.due_date,
      classified.created_at as source_created_at,
      'task'::text as stable_kind,
      classified.id as stable_task_id,
      classified.id as stable_id
    from classified
    where classified.out_is_overdue
       or classified.out_is_due_in_24_hours
       or classified.request_backup is true
       or pg_catalog.cardinality(classified.assignee_ids) = 0
       or not exists (
         select 1
         from pg_catalog.unnest(classified.assignee_ids)
           as assignment(assignee_id)
         join public.users as assignee_profile
           on assignee_profile.id = assignment.assignee_id
          and assignee_profile.is_active is true
       )
  ), approval_candidates as materialized (
    select
      'needs_approval'::text as category,
      3 as category_rank,
      case when scoped_task.is_confidential then null else scoped_task.id end
        as visible_task_id,
      'Leave request'::text as label,
      scoped_task.committee_id,
      scoped_task.committee_name,
      scoped_task.due_date,
      leave_request.created_at as source_created_at,
      'leave'::text as stable_kind,
      scoped_task.id as stable_task_id,
      leave_request.id as stable_id
    from public.task_leave_requests as leave_request
    join scoped_tasks as scoped_task
      on scoped_task.id = leave_request.task_id
    where leave_request.status = 'pending'
      and (
        leave_request.requester_id = any(scoped_task.primary_assignees)
        or leave_request.requester_id = any(scoped_task.assist_assignees)
      )

    union all

    select
      'needs_approval'::text,
      3,
      case when scoped_task.is_confidential then null else scoped_task.id end,
      'Volunteer offer'::text,
      scoped_task.committee_id,
      scoped_task.committee_name,
      scoped_task.due_date,
      volunteer_offer.created_at,
      'volunteer'::text,
      scoped_task.id,
      volunteer_offer.user_id
    from public.task_volunteers as volunteer_offer
    join scoped_tasks as scoped_task
      on scoped_task.id = volunteer_offer.task_id
     and scoped_task.request_backup is true
    join public.users as volunteer_profile
      on volunteer_profile.id = volunteer_offer.user_id
     and volunteer_profile.is_active is true
    where not (
      volunteer_offer.user_id = any(scoped_task.primary_assignees)
      or volunteer_offer.user_id = any(scoped_task.assist_assignees)
    )
  ), ordered_candidates as materialized (
    select * from task_candidates
    union all
    select * from approval_candidates
    order by
      category_rank,
      due_date asc nulls last,
      source_created_at,
      stable_kind,
      stable_task_id,
      stable_id
    limit 20
  )
  select
    candidate.category,
    candidate.visible_task_id,
    candidate.label,
    candidate.committee_id,
    candidate.committee_name,
    candidate.due_date,
    candidate.source_created_at
  from ordered_candidates as candidate
  order by
    candidate.category_rank,
    candidate.due_date asc nulls last,
    candidate.source_created_at,
    candidate.stable_kind,
    candidate.stable_task_id,
    candidate.stable_id;
end;
$$;

alter function public.list_executive_dashboard_needs_attention(uuid)
owner to postgres;
revoke all on function public.list_executive_dashboard_needs_attention(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_executive_dashboard_needs_attention(uuid)
to authenticated;

create function public.list_executive_dashboard_deadlines(
  p_committee_id uuid default null
)
returns table (
  out_calendar_date date,
  out_open_task_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
  v_today date := (statement_timestamp() at time zone 'Asia/Manila')::date;
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or (p_committee_id is null and v_caller_role <> 'Admin')
     or (
       p_committee_id is not null
       and not exists (
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
       )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  with calendar_days as materialized (
    select (v_today + offset_row.day_offset)::date as calendar_date
    from pg_catalog.generate_series(0, 6) as offset_row(day_offset)
  ), task_counts as materialized (
    select
      (task_row.due_date at time zone 'Asia/Manila')::date as calendar_date,
      pg_catalog.count(*)::bigint as open_task_count
    from public.tasks as task_row
    join public.events as event_row
      on event_row.id = task_row.event_id
     and event_row.status = 'Active'
    where task_row.status <> 'Completed'
      and task_row.due_date is not null
      and (p_committee_id is null or task_row.committee_id = p_committee_id)
      and (task_row.due_date at time zone 'Asia/Manila')::date
        between v_today and v_today + 6
    group by (task_row.due_date at time zone 'Asia/Manila')::date
  )
  select
    calendar_day.calendar_date,
    coalesce(task_count.open_task_count, 0)::bigint
  from calendar_days as calendar_day
  left join task_counts as task_count
    on task_count.calendar_date = calendar_day.calendar_date
  order by calendar_day.calendar_date;
end;
$$;

alter function public.list_executive_dashboard_deadlines(uuid)
owner to postgres;
revoke all on function public.list_executive_dashboard_deadlines(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_executive_dashboard_deadlines(uuid)
to authenticated;

create function public.list_executive_dashboard_free_members(
  p_committee_id uuid default null
)
returns table (
  out_member_id uuid,
  out_full_name text,
  out_avatar_url text,
  out_role text,
  out_open_task_count bigint
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
     or (p_committee_id is null and v_caller_role <> 'Admin')
     or (
       p_committee_id is not null
       and not exists (
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
       )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  with eligible_profiles as materialized (
    select
      profile.id,
      profile.full_name,
      profile.avatar_url,
      profile.role
    from public.users as profile
    where profile.is_active is true
      and profile.role in ('Co-Admin', 'Member')
      and (
        p_committee_id is null
        or profile.committee_id = p_committee_id
      )
  ), workloads as materialized (
    select
      eligible_profile.id,
      eligible_profile.full_name,
      eligible_profile.avatar_url,
      eligible_profile.role,
      pg_catalog.count(distinct task_row.id) filter (
        where event_row.id is not null
      )::bigint as open_task_count
    from eligible_profiles as eligible_profile
    left join public.tasks as task_row
      on task_row.status <> 'Completed'
     and (
       eligible_profile.id = any(task_row.primary_assignees)
       or eligible_profile.id = any(task_row.assist_assignees)
     )
    left join public.events as event_row
      on event_row.id = task_row.event_id
     and event_row.status = 'Active'
    group by
      eligible_profile.id,
      eligible_profile.full_name,
      eligible_profile.avatar_url,
      eligible_profile.role
  )
  select
    workload.id,
    workload.full_name,
    workload.avatar_url,
    workload.role,
    workload.open_task_count
  from workloads as workload
  where workload.open_task_count <= 2
  order by workload.open_task_count, workload.full_name, workload.id;
end;
$$;

alter function public.list_executive_dashboard_free_members(uuid)
owner to postgres;
revoke all on function public.list_executive_dashboard_free_members(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_executive_dashboard_free_members(uuid)
to authenticated;

create function public.list_executive_dashboard_member_slipping_signals(
  p_committee_id uuid default null
)
returns table (
  out_committee_id uuid,
  out_member_id uuid,
  out_open_task_count bigint,
  out_overdue_task_count bigint,
  out_at_risk_task_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_caller_committee_id uuid;
  v_as_of timestamptz := statement_timestamp();
begin
  select profile.role, profile.committee_id
  into v_caller_role, v_caller_committee_id
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active is true;

  if not found
     or v_caller_role not in ('Admin', 'Co-Admin')
     or (p_committee_id is null and v_caller_role <> 'Admin')
     or (
       p_committee_id is not null
       and not exists (
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
       )
     ) then
    raise exception using
      errcode = '42501',
      message = 'Executive Dashboard access denied.';
  end if;

  return query
  with scoped_members as materialized (
    select
      committee_row.id as committee_id,
      committee_row.name as committee_name,
      profile.id as member_id,
      profile.full_name as member_name
    from public.users as profile
    join public.committees as committee_row
      on committee_row.id = profile.committee_id
    where profile.is_active is true
      and (
        p_committee_id is null
        or profile.committee_id = p_committee_id
      )
  ), member_tasks as materialized (
    select distinct
      scoped_member.member_id,
      task_row.id as task_id,
      classification.out_is_overdue,
      classification.out_is_at_risk
    from scoped_members as scoped_member
    join public.tasks as task_row
      on task_row.committee_id = scoped_member.committee_id
     and task_row.status <> 'Completed'
     and (
       scoped_member.member_id = any(task_row.primary_assignees)
       or scoped_member.member_id = any(task_row.assist_assignees)
     )
    join public.events as event_row
      on event_row.id = task_row.event_id
     and event_row.status = 'Active'
    cross join lateral ceit_connect_private.classify_executive_dashboard_task(
      task_row.due_date,
      task_row.status,
      v_as_of
    ) as classification
  ), member_counts as materialized (
    select
      member_task.member_id,
      pg_catalog.count(*)::bigint as open_task_count,
      pg_catalog.count(*) filter (
        where member_task.out_is_overdue
      )::bigint as overdue_task_count,
      pg_catalog.count(*) filter (
        where member_task.out_is_at_risk
      )::bigint as at_risk_task_count
    from member_tasks as member_task
    group by member_task.member_id
  )
  select
    scoped_member.committee_id,
    scoped_member.member_id,
    coalesce(member_count.open_task_count, 0)::bigint,
    coalesce(member_count.overdue_task_count, 0)::bigint,
    coalesce(member_count.at_risk_task_count, 0)::bigint
  from scoped_members as scoped_member
  left join member_counts as member_count
    on member_count.member_id = scoped_member.member_id
  order by
    scoped_member.committee_name,
    scoped_member.member_name,
    scoped_member.member_id;
end;
$$;

alter function public.list_executive_dashboard_member_slipping_signals(uuid)
owner to postgres;
revoke all on function public.list_executive_dashboard_member_slipping_signals(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_executive_dashboard_member_slipping_signals(uuid)
to authenticated;

create function public.get_executive_dashboard_push_adoption()
returns table (
  out_active_profiles_with_push_count bigint,
  out_active_profile_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_as_of timestamptz := statement_timestamp();
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
    pg_catalog.count(*) filter (
      where exists (
        select 1
        from public.push_subscriptions as subscription
        where subscription.user_id = profile.id
          and (
            subscription.expires_at is null
            or subscription.expires_at > v_as_of
          )
      )
    )::bigint,
    pg_catalog.count(*)::bigint
  from public.users as profile
  where profile.is_active is true;
end;
$$;

alter function public.get_executive_dashboard_push_adoption()
owner to postgres;
revoke all on function public.get_executive_dashboard_push_adoption()
from public, anon, authenticated, service_role;
grant execute on function public.get_executive_dashboard_push_adoption()
to authenticated;

comment on function ceit_connect_private.classify_executive_dashboard_task(
  timestamptz, text, timestamptz
) is 'D1b private clock-injected task classifier. It performs no authorization and has no application-role execute grant.';
comment on function public.get_executive_dashboard_extras_overview(uuid)
is 'D1b scoped KPI and mutually exclusive task-status donut counts.';
comment on function public.list_executive_dashboard_needs_attention(uuid)
is 'D1b scoped confidential-safe attention feed, deterministically capped at 20 rows.';
comment on function public.list_executive_dashboard_deadlines(uuid)
is 'D1b scoped open-task counts for seven consecutive Asia/Manila calendar dates including zero days.';
comment on function public.list_executive_dashboard_free_members(uuid)
is 'D1b scoped active Co-Admin and Member availability using council-wide open workloads of at most two.';
comment on function public.list_executive_dashboard_member_slipping_signals(uuid)
is 'D1b per-member Level 2 open, overdue, and at-risk signals using the D1 task-owning-committee scope.';
comment on function public.get_executive_dashboard_push_adoption()
is 'D1b active-Admin-only counts of active profiles with at least one non-expired push subscription and all active profiles.';
