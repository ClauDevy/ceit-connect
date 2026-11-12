-- Phase 5 R2 follow-up: keep repeatedly failing occurrences from monopolizing
-- later deadline-reminder batches. The original R2 migration is already live
-- on Dev and remains immutable.

create table ceit_connect_private.deadline_reminder_retry_state (
  task_id uuid not null,
  reminder_kind text not null check (
    reminder_kind in ('task_due_soon', 'live_operation_prep')
  ),
  target_at timestamptz not null,
  user_id uuid not null,
  failure_count integer not null check (failure_count between 1 and 5),
  next_retry_at timestamptz not null,
  last_failed_at timestamptz not null,
  last_error_sqlstate text not null check (
    pg_catalog.length(last_error_sqlstate) = 5
  ),
  primary key (task_id, reminder_kind, target_at, user_id),
  check (last_failed_at < target_at),
  check (next_retry_at > last_failed_at and next_retry_at <= target_at)
);
alter table ceit_connect_private.deadline_reminder_retry_state owner to postgres;
alter table ceit_connect_private.deadline_reminder_retry_state enable row level security;
revoke all on table ceit_connect_private.deadline_reminder_retry_state
from public, anon, authenticated, service_role;

create index deadline_reminder_retry_state_cleanup_idx
on ceit_connect_private.deadline_reminder_retry_state (target_at, task_id, user_id);

create function ceit_connect_private.purge_deadline_reminder_retry_state(
  p_as_of timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  if p_as_of is null then
    raise exception using errcode = '22023', message = 'Reminder cleanup time is invalid.';
  end if;

  with victims as materialized (
    select retry_row.task_id,
           retry_row.reminder_kind,
           retry_row.target_at,
           retry_row.user_id
    from ceit_connect_private.deadline_reminder_retry_state as retry_row
    where retry_row.target_at < p_as_of - pg_catalog.make_interval(
      days => public.deadline_reminder_retention_days()
    )
    order by retry_row.target_at,
             retry_row.reminder_kind,
             retry_row.task_id,
             retry_row.user_id
    limit 500
    for update skip locked
  )
  delete from ceit_connect_private.deadline_reminder_retry_state as retry_row
  using victims
  where retry_row.task_id = victims.task_id
    and retry_row.reminder_kind = victims.reminder_kind
    and retry_row.target_at = victims.target_at
    and retry_row.user_id = victims.user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)
from public, anon, authenticated, service_role;

create or replace function ceit_connect_private.run_deadline_reminders_at(
  p_as_of timestamptz
)
returns table (
  out_occurrences_handled integer,
  out_notifications_created integer,
  out_skipped_concurrent boolean,
  out_ledger_rows_cleaned integer,
  out_run_history_rows_cleaned integer,
  out_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_started_at timestamptz := pg_catalog.clock_timestamp();
  v_finished_at timestamptz;
  v_candidate record;
  v_recipient record;
  v_created integer;
  v_recipient_sqlstate text;
  v_generation_sqlstate text;
  v_cleanup_sqlstate text;
  v_retry_cleanup_sqlstate text;
  v_run_history_sqlstate text;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  if p_as_of is null then
    raise exception using errcode = '22023', message = 'Reminder run time is invalid.';
  end if;

  out_occurrences_handled := 0;
  out_notifications_created := 0;
  out_skipped_concurrent := false;
  out_ledger_rows_cleaned := 0;
  out_run_history_rows_cleaned := 0;
  out_status := 'Completed.';

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('ceit-connect:deadline-reminders', 0)
  ) then
    out_skipped_concurrent := true;
    out_status := 'Skipped because another reminder run is active.';
    v_finished_at := pg_catalog.clock_timestamp();
    insert into ceit_connect_private.deadline_reminder_runs (
      id, started_at, finished_at, as_of, status
    ) values (
      v_run_id, v_started_at, v_finished_at, p_as_of, 'skipped_concurrent'
    );
    return next;
    return;
  end if;

  insert into ceit_connect_private.deadline_reminder_runs (
    id, started_at, as_of, status
  ) values (
    v_run_id, v_started_at, p_as_of, 'running'
  );

  for v_candidate in
    with occurrence as materialized (
      select task_row.id as task_id,
             'task_due_soon'::text as reminder_kind,
             task_row.due_date as target_at,
             task_row.primary_assignees,
             task_row.assist_assignees
      from public.tasks as task_row
      join public.events as event_row on event_row.id = task_row.event_id
      where event_row.status = 'Active'
        and task_row.status <> 'Completed'
        and task_row.due_date > p_as_of
        and task_row.due_date <= p_as_of + interval '24 hours'
      union all
      select task_row.id,
             'live_operation_prep'::text,
             task_row.call_time,
             task_row.primary_assignees,
             task_row.assist_assignees
      from public.tasks as task_row
      join public.events as event_row on event_row.id = task_row.event_id
      where event_row.status = 'Active'
        and task_row.status <> 'Completed'
        and task_row.task_type = 'LiveOperation'
        and task_row.call_time > p_as_of
        and task_row.call_time <= p_as_of + interval '2 hours'
    )
    select occurrence.task_id,
           occurrence.reminder_kind,
           occurrence.target_at
    from occurrence
    where exists (
      select 1
      from pg_catalog.unnest(
        coalesce(occurrence.primary_assignees, '{}'::uuid[])
        || coalesce(occurrence.assist_assignees, '{}'::uuid[])
      ) as proposed(user_id)
      join public.users as profile
        on profile.id = proposed.user_id
       and profile.is_active is true
      where proposed.user_id is not null
        and not exists (
          select 1
          from ceit_connect_private.task_deadline_reminder_ledger as ledger_row
          where ledger_row.task_id = occurrence.task_id
            and ledger_row.reminder_kind = occurrence.reminder_kind
            and ledger_row.target_at = occurrence.target_at
            and ledger_row.user_id = proposed.user_id
        )
        and not exists (
          select 1
          from ceit_connect_private.deadline_reminder_retry_state as retry_row
          where retry_row.task_id = occurrence.task_id
            and retry_row.reminder_kind = occurrence.reminder_kind
            and retry_row.target_at = occurrence.target_at
            and retry_row.user_id = proposed.user_id
            and (
              retry_row.failure_count >= 5
              or retry_row.next_retry_at > p_as_of
            )
        )
    )
    order by occurrence.target_at,
             occurrence.reminder_kind,
             occurrence.task_id
    limit public.deadline_reminder_batch_size()
  loop
    out_occurrences_handled := out_occurrences_handled + 1;
    for v_recipient in
      select distinct proposed.user_id
      from public.tasks as task_row
      join public.events as event_row on event_row.id = task_row.event_id
      cross join lateral pg_catalog.unnest(
        coalesce(task_row.primary_assignees, '{}'::uuid[])
        || coalesce(task_row.assist_assignees, '{}'::uuid[])
      ) as proposed(user_id)
      join public.users as profile
        on profile.id = proposed.user_id
       and profile.is_active is true
      where task_row.id = v_candidate.task_id
        and event_row.status = 'Active'
        and task_row.status <> 'Completed'
        and proposed.user_id is not null
        and (
          (
            v_candidate.reminder_kind = 'task_due_soon'
            and task_row.due_date = v_candidate.target_at
          )
          or (
            v_candidate.reminder_kind = 'live_operation_prep'
            and task_row.task_type = 'LiveOperation'
            and task_row.call_time = v_candidate.target_at
          )
        )
        and not exists (
          select 1
          from ceit_connect_private.task_deadline_reminder_ledger as ledger_row
          where ledger_row.task_id = v_candidate.task_id
            and ledger_row.reminder_kind = v_candidate.reminder_kind
            and ledger_row.target_at = v_candidate.target_at
            and ledger_row.user_id = proposed.user_id
        )
        and not exists (
          select 1
          from ceit_connect_private.deadline_reminder_retry_state as retry_row
          where retry_row.task_id = v_candidate.task_id
            and retry_row.reminder_kind = v_candidate.reminder_kind
            and retry_row.target_at = v_candidate.target_at
            and retry_row.user_id = proposed.user_id
            and (
              retry_row.failure_count >= 5
              or retry_row.next_retry_at > p_as_of
            )
        )
      order by proposed.user_id
    loop
      v_recipient_sqlstate := null;
      begin
        v_created := ceit_connect_private.emit_deadline_reminder_occurrence(
          v_candidate.task_id,
          v_candidate.reminder_kind,
          v_candidate.target_at,
          v_recipient.user_id,
          p_as_of
        );
        out_notifications_created := out_notifications_created + v_created;
      exception when others then
        get stacked diagnostics v_recipient_sqlstate = returned_sqlstate;
        if v_generation_sqlstate is null then
          v_generation_sqlstate := v_recipient_sqlstate;
        end if;
      end;

      if v_recipient_sqlstate is null then
        delete from ceit_connect_private.deadline_reminder_retry_state as retry_row
        where retry_row.task_id = v_candidate.task_id
          and retry_row.reminder_kind = v_candidate.reminder_kind
          and retry_row.target_at = v_candidate.target_at
          and retry_row.user_id = v_recipient.user_id
          and exists (
            select 1
            from ceit_connect_private.task_deadline_reminder_ledger as ledger_row
            where ledger_row.task_id = retry_row.task_id
              and ledger_row.reminder_kind = retry_row.reminder_kind
              and ledger_row.target_at = retry_row.target_at
              and ledger_row.user_id = retry_row.user_id
          );
      else
        insert into ceit_connect_private.deadline_reminder_retry_state (
          task_id,
          reminder_kind,
          target_at,
          user_id,
          failure_count,
          next_retry_at,
          last_failed_at,
          last_error_sqlstate
        ) values (
          v_candidate.task_id,
          v_candidate.reminder_kind,
          v_candidate.target_at,
          v_recipient.user_id,
          1,
          least(
            v_candidate.target_at,
            p_as_of + interval '15 minutes'
          ),
          p_as_of,
          v_recipient_sqlstate
        )
        on conflict (task_id, reminder_kind, target_at, user_id) do update
        set failure_count = least(
              ceit_connect_private.deadline_reminder_retry_state.failure_count + 1,
              5
            ),
            next_retry_at = least(
              excluded.target_at,
              excluded.last_failed_at + case
                when ceit_connect_private.deadline_reminder_retry_state.failure_count = 1
                  then interval '30 minutes'
                when ceit_connect_private.deadline_reminder_retry_state.failure_count = 2
                  then interval '1 hour'
                when ceit_connect_private.deadline_reminder_retry_state.failure_count = 3
                  then interval '2 hours'
                else excluded.target_at - excluded.last_failed_at
              end
            ),
            last_failed_at = excluded.last_failed_at,
            last_error_sqlstate = excluded.last_error_sqlstate;
      end if;
    end loop;
  end loop;

  begin
    out_ledger_rows_cleaned :=
      ceit_connect_private.purge_deadline_reminder_ledger(p_as_of);
  exception when others then
    get stacked diagnostics v_cleanup_sqlstate = returned_sqlstate;
  end;

  begin
    perform ceit_connect_private.purge_deadline_reminder_retry_state(p_as_of);
  exception when others then
    get stacked diagnostics v_retry_cleanup_sqlstate = returned_sqlstate;
  end;

  begin
    out_run_history_rows_cleaned :=
      ceit_connect_private.purge_deadline_reminder_runs(p_as_of, v_run_id);
  exception when others then
    get stacked diagnostics v_run_history_sqlstate = returned_sqlstate;
  end;

  if v_generation_sqlstate is not null
     or v_cleanup_sqlstate is not null
     or v_retry_cleanup_sqlstate is not null
     or v_run_history_sqlstate is not null then
    out_status := 'Completed with failures.';
  end if;
  v_finished_at := pg_catalog.clock_timestamp();

  update ceit_connect_private.deadline_reminder_runs as run_row
  set finished_at = v_finished_at,
      status = case
        when out_status = 'Completed.' then 'completed'
        else 'completed_with_failures'
      end,
      occurrences_handled = out_occurrences_handled,
      notifications_created = out_notifications_created,
      ledger_rows_cleaned = out_ledger_rows_cleaned,
      run_history_rows_cleaned = out_run_history_rows_cleaned,
      generation_error_sqlstate = v_generation_sqlstate,
      generation_error_message = case
        when v_generation_sqlstate is null then null
        else 'Deadline reminder generation failed.'
      end,
      cleanup_error_sqlstate = coalesce(v_cleanup_sqlstate, v_retry_cleanup_sqlstate),
      cleanup_error_message = case
        when v_cleanup_sqlstate is null and v_retry_cleanup_sqlstate is null then null
        else 'Deadline reminder cleanup failed.'
      end,
      run_history_error_sqlstate = v_run_history_sqlstate,
      run_history_error_message = case
        when v_run_history_sqlstate is null then null
        else 'Run-history retention failed.'
      end
  where run_row.id = v_run_id;

  return next;
end;
$$;
alter function ceit_connect_private.run_deadline_reminders_at(timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.run_deadline_reminders_at(timestamptz)
from public, anon, authenticated, service_role;

comment on table ceit_connect_private.deadline_reminder_retry_state is
  'Private R2 per-recipient occurrence retry state. Stores no task content and expires failed recipient occurrences at their target.';
comment on function ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz) is
  'Postgres-session-only bounded cleanup for expired R2 retry state.';

-- The private clock-injected worker remains deterministic for Dev verification.
-- The ungranted public production wrapper marks its invocation so the emitter
-- obtains a fresh clock immediately before it claims a recipient.
create or replace function ceit_connect_private.emit_deadline_reminder_occurrence(
  p_task_id uuid,
  p_reminder_kind text,
  p_target_at timestamptz,
  p_user_id uuid,
  p_as_of timestamptz
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  if p_task_id is null
     or p_reminder_kind not in ('task_due_soon', 'live_operation_prep')
     or p_target_at is null
     or p_user_id is null
     or p_as_of is null then
    raise exception using errcode = '22023', message = 'Reminder occurrence is invalid.';
  end if;

  with stored_occurrence as materialized (
    select task_row.id,
           task_row.primary_assignees,
           task_row.assist_assignees
    from public.tasks as task_row
    join public.events as event_row on event_row.id = task_row.event_id
    where task_row.id = p_task_id
      and event_row.status = 'Active'
      and task_row.status <> 'Completed'
      and (
        (
          p_reminder_kind = 'task_due_soon'
          and task_row.due_date = p_target_at
          and p_target_at > case
            when pg_catalog.current_setting('ceit_connect.deadline_reminder_live_clock', true) = 'on'
              then pg_catalog.clock_timestamp()
            else p_as_of
          end
          and p_target_at <= p_as_of + interval '24 hours'
        )
        or (
          p_reminder_kind = 'live_operation_prep'
          and task_row.task_type = 'LiveOperation'
          and task_row.call_time = p_target_at
          and p_target_at > case
            when pg_catalog.current_setting('ceit_connect.deadline_reminder_live_clock', true) = 'on'
              then pg_catalog.clock_timestamp()
            else p_as_of
          end
          and p_target_at <= p_as_of + interval '2 hours'
        )
      )
  ), eligible_recipient as materialized (
    select profile.id as user_id
    from stored_occurrence
    join public.users as profile
      on profile.id = p_user_id
     and profile.is_active is true
    where p_user_id = any(
      coalesce(stored_occurrence.primary_assignees, '{}'::uuid[])
      || coalesce(stored_occurrence.assist_assignees, '{}'::uuid[])
    )
      and not exists (
        select 1
        from ceit_connect_private.deadline_reminder_retry_state as retry_row
        where retry_row.task_id = p_task_id
          and retry_row.reminder_kind = p_reminder_kind
          and retry_row.target_at = p_target_at
          and retry_row.user_id = p_user_id
          and (
            retry_row.failure_count >= 5
            or retry_row.next_retry_at > p_as_of
          )
      )
  ), claimed as (
    insert into ceit_connect_private.task_deadline_reminder_ledger (
      task_id, reminder_kind, target_at, user_id, recorded_at, recorded_reason
    )
    select p_task_id,
           p_reminder_kind,
           p_target_at,
           eligible_recipient.user_id,
           p_as_of,
           'sent'
    from eligible_recipient
    on conflict (task_id, reminder_kind, target_at, user_id) do nothing
    returning user_id
  ), inserted as (
    insert into public.notifications (user_id, type, task_id)
    select claimed.user_id, p_reminder_kind, p_task_id
    from claimed
    returning id
  )
  select pg_catalog.count(*)::integer
  into v_inserted
  from inserted;

  return coalesce(v_inserted, 0);
end;
$$;
alter function ceit_connect_private.emit_deadline_reminder_occurrence(
  uuid, text, timestamptz, uuid, timestamptz
) owner to postgres;
revoke all on function ceit_connect_private.emit_deadline_reminder_occurrence(
  uuid, text, timestamptz, uuid, timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.run_deadline_reminders()
returns table (
  out_occurrences_handled integer,
  out_notifications_created integer,
  out_skipped_concurrent boolean,
  out_ledger_rows_cleaned integer,
  out_run_history_rows_cleaned integer,
  out_status text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_previous_live_clock text := pg_catalog.current_setting(
    'ceit_connect.deadline_reminder_live_clock',
    true
  );
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;

  perform pg_catalog.set_config('ceit_connect.deadline_reminder_live_clock', 'on', true);

  begin
    return query
    select internal_result.out_occurrences_handled,
           internal_result.out_notifications_created,
           internal_result.out_skipped_concurrent,
           internal_result.out_ledger_rows_cleaned,
           internal_result.out_run_history_rows_cleaned,
           internal_result.out_status
    from ceit_connect_private.run_deadline_reminders_at(
      pg_catalog.clock_timestamp()
    ) as internal_result;
  exception when others then
    if v_previous_live_clock is null then
      execute 'reset ceit_connect.deadline_reminder_live_clock';
    else
      perform pg_catalog.set_config(
        'ceit_connect.deadline_reminder_live_clock',
        v_previous_live_clock,
        true
      );
    end if;
    raise;
  end;

  if v_previous_live_clock is null then
    execute 'reset ceit_connect.deadline_reminder_live_clock';
  else
    perform pg_catalog.set_config(
      'ceit_connect.deadline_reminder_live_clock',
      v_previous_live_clock,
      true
    );
  end if;
end;
$$;
alter function public.run_deadline_reminders() owner to postgres;
revoke all on function public.run_deadline_reminders()
from public, anon, authenticated, service_role;
