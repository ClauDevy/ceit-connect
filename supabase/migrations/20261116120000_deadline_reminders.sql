-- Phase 5 R2: scheduled task deadline and Live Operation preparation reminders.
-- The environment-specific pg_cron job is created manually on Prod only.

do $$
declare
  v_notification_constraint text;
  v_queue_constraint text;
begin
  if current_user <> 'postgres' then
    raise exception 'R2 stopped: migration must run as postgres.';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_notification_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.notifications'::regclass
    and constraint_row.conname = 'notifications_type_check';

  if v_notification_constraint is null
     or pg_catalog.strpos(v_notification_constraint, '''leave_denied''') = 0
     or pg_catalog.strpos(v_notification_constraint, '''task_due_soon''') > 0
     or pg_catalog.strpos(v_notification_constraint, '''live_operation_prep''') > 0 then
    raise exception 'R2 stopped: notifications_type_check differs from the latest R1 definition.';
  end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_queue_constraint
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'ceit_connect_private.push_delivery_queue'::regclass
    and constraint_row.conname = 'push_delivery_queue_notification_type_check';

  if v_queue_constraint is null
     or pg_catalog.strpos(v_queue_constraint, '''leave_denied''') = 0
     or pg_catalog.strpos(v_queue_constraint, '''task_due_soon''') > 0
     or pg_catalog.strpos(v_queue_constraint, '''live_operation_prep''') > 0 then
    raise exception 'R2 stopped: push queue type constraint differs from the latest R1 definition.';
  end if;

  if pg_catalog.to_regprocedure(
       'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'
     ) is null
     or pg_catalog.to_regprocedure('public.claim_push_deliveries(integer)') is null then
    raise exception 'R2 stopped: latest R1 notification functions are unavailable.';
  end if;
end;
$$;

alter table public.notifications
drop constraint notifications_type_check;
alter table public.notifications
add constraint notifications_type_check check (type in (
  'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request',
  'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied',
  'task_due_soon', 'live_operation_prep'
));

alter table ceit_connect_private.push_delivery_queue
drop constraint push_delivery_queue_notification_type_check;
alter table ceit_connect_private.push_delivery_queue
add constraint push_delivery_queue_notification_type_check check (notification_type in (
  'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request',
  'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied',
  'task_due_soon', 'live_operation_prep'
));

create or replace function ceit_connect_private.insert_notifications(
  p_type text,
  p_task_id uuid,
  p_actor_id uuid,
  p_recipient_ids uuid[]
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
  if p_type not in (
    'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request',
    'volunteer_offer', 'leave_requested', 'leave_cancelled', 'leave_approved', 'leave_denied',
    'task_due_soon', 'live_operation_prep'
  ) or p_task_id is null then
    raise exception 'Notification metadata is invalid.';
  end if;

  insert into public.notifications (user_id, type, task_id)
  select recipient.user_id, p_type, p_task_id
  from (
    select distinct proposed.user_id
    from pg_catalog.unnest(coalesce(p_recipient_ids, '{}'::uuid[]))
      as proposed(user_id)
    where proposed.user_id is not null
      and proposed.user_id is distinct from p_actor_id
  ) as recipient
  join public.users as profile
    on profile.id = recipient.user_id
   and profile.is_active is true;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

alter function ceit_connect_private.insert_notifications(text, uuid, uuid, uuid[])
owner to postgres;
revoke all on function ceit_connect_private.insert_notifications(text, uuid, uuid, uuid[])
from public, anon, authenticated, service_role;

create table ceit_connect_private.task_deadline_reminder_ledger (
  task_id uuid not null,
  reminder_kind text not null check (
    reminder_kind in ('task_due_soon', 'live_operation_prep')
  ),
  target_at timestamptz not null,
  user_id uuid not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  recorded_reason text not null check (recorded_reason in ('bootstrap', 'sent')),
  primary key (task_id, reminder_kind, target_at, user_id)
);
alter table ceit_connect_private.task_deadline_reminder_ledger owner to postgres;
alter table ceit_connect_private.task_deadline_reminder_ledger enable row level security;
revoke all on table ceit_connect_private.task_deadline_reminder_ledger
from public, anon, authenticated, service_role;

create index task_deadline_reminder_ledger_cleanup_idx
on ceit_connect_private.task_deadline_reminder_ledger
  (target_at, task_id, reminder_kind, user_id);

create table ceit_connect_private.deadline_reminder_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz,
  as_of timestamptz not null,
  status text not null check (
    status in ('running', 'completed', 'completed_with_failures', 'skipped_concurrent')
  ),
  occurrences_handled integer not null default 0 check (
    occurrences_handled between 0 and 100
  ),
  notifications_created integer not null default 0 check (
    notifications_created >= 0
  ),
  ledger_rows_cleaned integer not null default 0 check (
    ledger_rows_cleaned between 0 and 500
  ),
  run_history_rows_cleaned integer not null default 0 check (
    run_history_rows_cleaned between 0 and 500
  ),
  generation_error_sqlstate text check (
    generation_error_sqlstate is null
    or generation_error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  generation_error_message text check (
    generation_error_message is null
    or generation_error_message = 'Deadline reminder generation failed.'
  ),
  cleanup_error_sqlstate text check (
    cleanup_error_sqlstate is null
    or cleanup_error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  cleanup_error_message text check (
    cleanup_error_message is null
    or cleanup_error_message = 'Deadline reminder cleanup failed.'
  ),
  run_history_error_sqlstate text check (
    run_history_error_sqlstate is null
    or run_history_error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  run_history_error_message text check (
    run_history_error_message is null
    or run_history_error_message = 'Run-history retention failed.'
  )
);
alter table ceit_connect_private.deadline_reminder_runs owner to postgres;
alter table ceit_connect_private.deadline_reminder_runs enable row level security;
revoke all on table ceit_connect_private.deadline_reminder_runs
from public, anon, authenticated, service_role;

create index deadline_reminder_runs_finished_idx
on ceit_connect_private.deadline_reminder_runs (finished_at, id)
where finished_at is not null;

create index tasks_deadline_reminder_due_idx
on public.tasks (due_date, id)
where status <> 'Completed' and due_date is not null;

create index tasks_live_operation_reminder_call_idx
on public.tasks (call_time, id)
where status <> 'Completed'
  and task_type = 'LiveOperation'
  and call_time is not null;

create function public.deadline_reminder_batch_size()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 100;
$$;
alter function public.deadline_reminder_batch_size() owner to postgres;
revoke all on function public.deadline_reminder_batch_size()
from public, anon, authenticated, service_role;

create function public.deadline_reminder_retention_days()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 30;
$$;
alter function public.deadline_reminder_retention_days() owner to postgres;
revoke all on function public.deadline_reminder_retention_days()
from public, anon, authenticated, service_role;

create function ceit_connect_private.bootstrap_deadline_reminders_at(
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
  if p_as_of is null then
    raise exception using errcode = '22023', message = 'Reminder run time is invalid.';
  end if;

  insert into ceit_connect_private.task_deadline_reminder_ledger (
    task_id, reminder_kind, target_at, user_id, recorded_at, recorded_reason
  )
  select occurrence.task_id,
         occurrence.reminder_kind,
         occurrence.target_at,
         recipient.user_id,
         p_as_of,
         'bootstrap'
  from (
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
  ) as occurrence
  cross join lateral (
    select distinct proposed.user_id
    from pg_catalog.unnest(
      coalesce(occurrence.primary_assignees, '{}'::uuid[])
      || coalesce(occurrence.assist_assignees, '{}'::uuid[])
    ) as proposed(user_id)
    join public.users as profile
      on profile.id = proposed.user_id
     and profile.is_active is true
    where proposed.user_id is not null
  ) as recipient
  on conflict (task_id, reminder_kind, target_at, user_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
alter function ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)
from public, anon, authenticated, service_role;

create function ceit_connect_private.emit_deadline_reminder_occurrence(
  p_task_id uuid,
  p_reminder_kind text,
  p_target_at timestamptz,
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
          and p_target_at > p_as_of
          and p_target_at <= p_as_of + interval '24 hours'
        )
        or (
          p_reminder_kind = 'live_operation_prep'
          and task_row.task_type = 'LiveOperation'
          and task_row.call_time = p_target_at
          and p_target_at > p_as_of
          and p_target_at <= p_as_of + interval '2 hours'
        )
      )
  ), eligible_recipient as materialized (
    select distinct proposed.user_id
    from stored_occurrence
    cross join lateral pg_catalog.unnest(
      coalesce(stored_occurrence.primary_assignees, '{}'::uuid[])
      || coalesce(stored_occurrence.assist_assignees, '{}'::uuid[])
    ) as proposed(user_id)
    join public.users as profile
      on profile.id = proposed.user_id
     and profile.is_active is true
    where proposed.user_id is not null
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
  uuid, text, timestamptz, timestamptz
) owner to postgres;
revoke all on function ceit_connect_private.emit_deadline_reminder_occurrence(
  uuid, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

create function ceit_connect_private.purge_deadline_reminder_ledger(
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
    raise exception using errcode = '22023', message = 'Reminder run time is invalid.';
  end if;

  with victims as materialized (
    select ledger_row.task_id,
           ledger_row.reminder_kind,
           ledger_row.target_at,
           ledger_row.user_id
    from ceit_connect_private.task_deadline_reminder_ledger as ledger_row
    where ledger_row.target_at < p_as_of - pg_catalog.make_interval(
      days => public.deadline_reminder_retention_days()
    )
    order by ledger_row.target_at,
             ledger_row.task_id,
             ledger_row.reminder_kind,
             ledger_row.user_id
    limit 500
    for update skip locked
  )
  delete from ceit_connect_private.task_deadline_reminder_ledger as ledger_row
  using victims
  where ledger_row.task_id = victims.task_id
    and ledger_row.reminder_kind = victims.reminder_kind
    and ledger_row.target_at = victims.target_at
    and ledger_row.user_id = victims.user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.purge_deadline_reminder_ledger(timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.purge_deadline_reminder_ledger(timestamptz)
from public, anon, authenticated, service_role;

create function ceit_connect_private.purge_deadline_reminder_runs(
  p_as_of timestamptz,
  p_current_run_id uuid
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
  if p_as_of is null or p_current_run_id is null then
    raise exception using errcode = '22023', message = 'Reminder run time is invalid.';
  end if;

  with victims as materialized (
    select run_row.id
    from ceit_connect_private.deadline_reminder_runs as run_row
    where run_row.id <> p_current_run_id
      and run_row.finished_at is not null
      and run_row.finished_at < p_as_of - pg_catalog.make_interval(
        days => public.deadline_reminder_retention_days()
      )
    order by run_row.finished_at, run_row.id
    limit 500
    for update skip locked
  )
  delete from ceit_connect_private.deadline_reminder_runs as run_row
  using victims
  where run_row.id = victims.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.purge_deadline_reminder_runs(timestamptz, uuid)
owner to postgres;
revoke all on function ceit_connect_private.purge_deadline_reminder_runs(timestamptz, uuid)
from public, anon, authenticated, service_role;

create function ceit_connect_private.run_deadline_reminders_at(
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
  v_created integer;
  v_generation_sqlstate text;
  v_cleanup_sqlstate text;
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
    )
    order by occurrence.target_at,
             occurrence.reminder_kind,
             occurrence.task_id
    limit public.deadline_reminder_batch_size()
  loop
    out_occurrences_handled := out_occurrences_handled + 1;
    begin
      v_created := ceit_connect_private.emit_deadline_reminder_occurrence(
        v_candidate.task_id,
        v_candidate.reminder_kind,
        v_candidate.target_at,
        p_as_of
      );
      out_notifications_created := out_notifications_created + v_created;
    exception when others then
      if v_generation_sqlstate is null then
        get stacked diagnostics v_generation_sqlstate = returned_sqlstate;
      end if;
    end;
  end loop;

  begin
    out_ledger_rows_cleaned :=
      ceit_connect_private.purge_deadline_reminder_ledger(p_as_of);
  exception when others then
    get stacked diagnostics v_cleanup_sqlstate = returned_sqlstate;
  end;

  begin
    out_run_history_rows_cleaned :=
      ceit_connect_private.purge_deadline_reminder_runs(p_as_of, v_run_id);
  exception when others then
    get stacked diagnostics v_run_history_sqlstate = returned_sqlstate;
  end;

  if v_generation_sqlstate is not null
     or v_cleanup_sqlstate is not null
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
      cleanup_error_sqlstate = v_cleanup_sqlstate,
      cleanup_error_message = case
        when v_cleanup_sqlstate is null then null
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

create function public.run_deadline_reminders()
returns table (
  out_occurrences_handled integer,
  out_notifications_created integer,
  out_skipped_concurrent boolean,
  out_ledger_rows_cleaned integer,
  out_run_history_rows_cleaned integer,
  out_status text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select internal_result.out_occurrences_handled,
         internal_result.out_notifications_created,
         internal_result.out_skipped_concurrent,
         internal_result.out_ledger_rows_cleaned,
         internal_result.out_run_history_rows_cleaned,
         internal_result.out_status
  from ceit_connect_private.run_deadline_reminders_at(
    pg_catalog.clock_timestamp()
  ) as internal_result;
$$;
alter function public.run_deadline_reminders() owner to postgres;
revoke all on function public.run_deadline_reminders()
from public, anon, authenticated, service_role;

do $$
begin
  perform ceit_connect_private.bootstrap_deadline_reminders_at(
    pg_catalog.clock_timestamp()
  );
end;
$$;

create or replace function public.claim_push_deliveries(p_limit integer default 50)
returns table (
  out_delivery_id uuid,
  out_lease_token uuid,
  out_run_id uuid,
  out_run_token uuid,
  out_endpoint text,
  out_p256dh text,
  out_auth_secret text,
  out_title text,
  out_body text,
  out_target_path text,
  out_notification_type text,
  out_attempt integer,
  out_lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_run_id uuid := gen_random_uuid();
  v_run_token uuid := gen_random_uuid();
  v_claimed integer;
begin
  v_generation := ceit_connect_private.authenticate_push_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Push sender authentication failed.';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 100.';
  end if;

  delete from ceit_connect_private.push_delivery_queue as queue
  where not exists (
    select 1
    from public.notifications as notification
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id and profile.is_active
    where notification.id = queue.notification_id
  );

  update ceit_connect_private.push_delivery_queue as queue
  set state = case
        when queue.attempt_count >= 8 then 'terminal'
        when queue.retry_deadline_at <= v_now then 'terminal'
        else 'pending'
      end,
      terminal_at = case
        when queue.attempt_count >= 8 or queue.retry_deadline_at <= v_now then v_now else null
      end,
      terminal_reason = case
        when queue.attempt_count >= 8 then 'attempts_exhausted'
        when queue.retry_deadline_at <= v_now then 'retry_window_exhausted'
        else null
      end,
      next_attempt_at = case
        when queue.attempt_count < 8 and queue.retry_deadline_at > v_now then v_now
        else queue.next_attempt_at
      end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where queue.state = 'leased' and queue.lease_expires_at <= v_now;

  insert into ceit_connect_private.push_delivery_runs(
    id, run_token, started_at
  ) values (
    v_run_id, v_run_token, v_now
  );

  return query
  with candidates as materialized (
    select queue.id
    from ceit_connect_private.push_delivery_queue as queue
    join public.notifications as notification
      on notification.id = queue.notification_id
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id and profile.is_active
    where queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.retry_deadline_at > v_now
      and queue.attempt_count < 8
      and (subscription.expires_at is null or subscription.expires_at > v_now)
    order by queue.next_attempt_at, queue.created_at, queue.id
    limit p_limit
    for update of queue skip locked
  ), leased as (
    update ceit_connect_private.push_delivery_queue as queue
    set state = 'leased',
        attempt_count = queue.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = v_now + interval '2 minutes',
        run_id = v_run_id,
        updated_at = v_now
    from candidates
    where queue.id = candidates.id
    returning queue.*
  )
  select leased.id,
         leased.lease_token,
         v_run_id,
         v_run_token,
         subscription.endpoint,
         subscription.p256dh,
         subscription.auth_secret,
         'CEIT Connect'::text,
         case leased.notification_type
           when 'mention' then 'You were mentioned in a task.'
           when 'heads_up' then 'A task you’re assigned to has a new heads-up.'
           when 'assignment' then 'You were assigned to a task.'
           when 'status_change' then 'A task you’re assigned to changed status.'
           when 'unlock' then 'A task you’re assigned to is now unlocked.'
           when 'backup_request' then 'A task needs backup help.'
           when 'volunteer_offer' then 'A task has a new volunteer offer.'
           when 'leave_requested' then 'A task has a new leave request.'
           when 'leave_cancelled' then 'A leave request was cancelled.'
           when 'leave_approved' then 'Your leave request was approved.'
           when 'leave_denied' then 'Your leave request was denied.'
           when 'task_due_soon' then 'A task is due soon.'
           when 'live_operation_prep' then 'A Live Operation call time is soon.'
         end,
         '/notifications'::text,
         leased.notification_type,
         leased.attempt_count,
         leased.lease_expires_at
  from leased
  join public.push_subscriptions as subscription
    on subscription.id = leased.subscription_id;

  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    delete from ceit_connect_private.push_delivery_runs as run_row
    where run_row.id = v_run_id;
  else
    update ceit_connect_private.push_delivery_runs as run_row
    set claimed_count = v_claimed
    where run_row.id = v_run_id;
  end if;
end;
$$;

alter function public.claim_push_deliveries(integer) owner to postgres;
revoke all on function public.claim_push_deliveries(integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_push_deliveries(integer) to anon;

comment on table ceit_connect_private.task_deadline_reminder_ledger is
  'Private R2 exactly-once proof keyed by task, reminder kind, exact target timestamp, and recipient. Contains no task content.';
comment on table ceit_connect_private.deadline_reminder_runs is
  'Private aggregate R2 run history with fixed safe failures and no task, event, notification, or user identifiers.';
comment on function ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz) is
  'Postgres-session-only idempotent deployment bootstrap. Records currently in-window recipients without creating notifications.';
comment on function ceit_connect_private.run_deadline_reminders_at(timestamptz) is
  'Postgres-session-only clock-injected R2 worker for deterministic verification.';
comment on function public.run_deadline_reminders() is
  'Postgres-session-only real-clock R2 runner. Handles at most 100 earliest occurrences that still have an active unreminded recipient.';
