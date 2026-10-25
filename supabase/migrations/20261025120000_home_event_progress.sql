-- Phase 4B Batch 3H: bounded, confidential-safe Home event summaries.
-- This reader is intentionally Active-only and returns no task identity or content.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Batch 3H must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

create function public.list_home_event_progress(p_event_ids uuid[])
returns table (
  out_event_id uuid,
  out_phase_label text,
  out_progress_percentage integer,
  out_visible_backup_request_count integer,
  out_backlog_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if p_event_ids is null
     or pg_catalog.cardinality(p_event_ids) = 0
     or pg_catalog.cardinality(p_event_ids) > 20
     or pg_catalog.array_position(p_event_ids, null::uuid) is not null then
    raise exception using
      errcode = '22023',
      message = 'Home event progress requires between 1 and 20 non-null event IDs.';
  end if;

  if v_caller_id is null or not exists (
    select 1
    from public.users caller
    where caller.id = v_caller_id
      and caller.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'An active profile is required.';
  end if;

  return query
  with requested_events as materialized (
    select
      requested.event_id,
      min(requested.position)::bigint as request_position
    from pg_catalog.unnest(p_event_ids) with ordinality
      as requested(event_id, position)
    group by requested.event_id
  ),
  visible_events as materialized (
    select requested.event_id, requested.request_position
    from requested_events requested
    join public.events event_row on event_row.id = requested.event_id
    where event_row.status = 'Active'
  ),
  task_access as materialized (
    select
      task_row.event_id,
      task_row.id as task_id,
      coalesce(
        nullif(pg_catalog.btrim(task_row.phase), ''),
        'Unphased'
      ) as phase_label,
      task_row.status,
      task_row.primary_assignees,
      task_row.request_backup,
      task_row.sort_order,
      public.task_content_access_for_user(task_row.id, v_caller_id)
        as content_access
    from public.tasks task_row
    join visible_events visible on visible.event_id = task_row.event_id
  ),
  summary_tasks as materialized (
    select access_row.*
    from task_access access_row
    where access_row.content_access in ('real', 'masked')
  ),
  event_totals as materialized (
    select
      visible.event_id,
      visible.request_position,
      count(summary.task_id)::integer as total_task_count,
      count(summary.task_id) filter (
        where summary.status = 'Completed'
      )::integer as completed_task_count,
      count(summary.task_id) filter (
        where summary.content_access = 'real'
          and summary.request_backup is true
          and summary.status <> 'Completed'
      )::integer as visible_backup_request_count,
      count(summary.task_id) filter (
        where coalesce(
          pg_catalog.cardinality(summary.primary_assignees),
          0
        ) = 0
          and summary.status <> 'Completed'
      )::integer as backlog_count
    from visible_events visible
    left join summary_tasks summary on summary.event_id = visible.event_id
    group by visible.event_id, visible.request_position
  ),
  incomplete_phases as materialized (
    select
      summary.event_id,
      summary.phase_label,
      min(summary.sort_order) as first_sort_order,
      (pg_catalog.array_agg(
        summary.task_id order by summary.sort_order, summary.task_id
      ))[1] as first_task_id
    from summary_tasks summary
    group by summary.event_id, summary.phase_label
    having pg_catalog.bool_or(summary.status <> 'Completed')
  ),
  current_phases as materialized (
    select distinct on (phase_row.event_id)
      phase_row.event_id,
      phase_row.phase_label
    from incomplete_phases phase_row
    order by
      phase_row.event_id,
      phase_row.first_sort_order,
      phase_row.first_task_id
  )
  select
    totals.event_id,
    case
      when totals.total_task_count = 0 then null::text
      when totals.completed_task_count = totals.total_task_count
        then 'All phases complete'::text
      else current_phase.phase_label
    end,
    case
      when totals.total_task_count = 0 then 0
      else pg_catalog.round(
        totals.completed_task_count::numeric * 100
          / totals.total_task_count
      )::integer
    end,
    totals.visible_backup_request_count,
    totals.backlog_count
  from event_totals totals
  left join current_phases current_phase
    on current_phase.event_id = totals.event_id
  order by totals.request_position;
end;
$$;

alter function public.list_home_event_progress(uuid[]) owner to postgres;

revoke all on function public.list_home_event_progress(uuid[])
from public, anon, authenticated;

grant execute on function public.list_home_event_progress(uuid[])
to authenticated;

comment on function public.list_home_event_progress(uuid[]) is
  'Returns bounded Active-event Home summaries. Real and masked tasks contribute to phase, progress, and Backlog; only real incomplete tasks contribute visible backup requests.';
