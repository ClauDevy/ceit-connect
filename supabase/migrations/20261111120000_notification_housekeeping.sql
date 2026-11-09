-- Phase 5 N3a: notification deletion and bounded read-notification cleanup.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Migration must run as postgres.';
  end if;
end
$$;

create or replace function public.notification_read_retention_days()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 60 $$;
alter function public.notification_read_retention_days() owner to postgres;
revoke all on function public.notification_read_retention_days()
from public, anon, authenticated, service_role;

create or replace function public.notification_cleanup_run_retention_days()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 30 $$;
alter function public.notification_cleanup_run_retention_days() owner to postgres;
revoke all on function public.notification_cleanup_run_retention_days()
from public, anon, authenticated, service_role;

create or replace function public.notification_cleanup_batch_size()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 500 $$;
alter function public.notification_cleanup_batch_size() owner to postgres;
revoke all on function public.notification_cleanup_batch_size()
from public, anon, authenticated, service_role;

create index notifications_read_cleanup_idx
on public.notifications(read_at, id)
where read_at is not null;

create function ceit_connect_private.delete_notification_for_user(
  p_user_id uuid,
  p_notification_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.notifications as notification_row
  where notification_row.id = p_notification_id
    and notification_row.user_id = p_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;
alter function ceit_connect_private.delete_notification_for_user(uuid, uuid)
owner to postgres;
revoke all on function ceit_connect_private.delete_notification_for_user(uuid, uuid)
from public, anon, authenticated, service_role;

create function public.delete_notification(p_notification_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if p_notification_id is null then
    raise exception using
      errcode = '22023',
      message = 'Notification ID is required.';
  end if;

  if v_caller_id is null or not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'An active profile is required.';
  end if;

  return ceit_connect_private.delete_notification_for_user(
    v_caller_id,
    p_notification_id
  );
end;
$$;
alter function public.delete_notification(uuid) owner to postgres;
revoke all on function public.delete_notification(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.delete_notification(uuid) to authenticated;

create function ceit_connect_private.clear_read_notifications_for_user(
  p_user_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  with victims as materialized (
    select notification_row.id
    from public.notifications as notification_row
    where notification_row.user_id = p_user_id
      and notification_row.read_at is not null
    order by notification_row.id
    for update of notification_row skip locked
  )
  delete from public.notifications as notification_row
  using victims
  where notification_row.id = victims.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.clear_read_notifications_for_user(uuid)
owner to postgres;
revoke all on function ceit_connect_private.clear_read_notifications_for_user(uuid)
from public, anon, authenticated, service_role;

create function public.clear_read_notifications()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if v_caller_id is null or not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active is true
  ) then
    raise exception using
      errcode = '42501',
      message = 'An active profile is required.';
  end if;

  return ceit_connect_private.clear_read_notifications_for_user(v_caller_id);
end;
$$;
alter function public.clear_read_notifications() owner to postgres;
revoke all on function public.clear_read_notifications()
from public, anon, authenticated, service_role;
grant execute on function public.clear_read_notifications() to authenticated;

create table ceit_connect_private.notification_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  cutoff_at timestamptz not null,
  status text not null check (
    status in ('running', 'completed', 'completed_with_failures', 'skipped_concurrent')
  ),
  eligible_count bigint not null default 0 check (eligible_count >= 0),
  deleted_count integer not null default 0 check (
    deleted_count between 0 and 500
  ),
  cleanup_error_sqlstate text check (
    cleanup_error_sqlstate is null
    or cleanup_error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  cleanup_error_message text check (
    cleanup_error_message is null
    or cleanup_error_message = 'Notification cleanup failed.'
  ),
  retention_deleted_count integer not null default 0 check (
    retention_deleted_count between 0 and 500
  ),
  retention_error_sqlstate text check (
    retention_error_sqlstate is null
    or retention_error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  retention_error_message text check (
    retention_error_message is null
    or retention_error_message = 'Run-history retention failed.'
  )
);
alter table ceit_connect_private.notification_cleanup_runs owner to postgres;
alter table ceit_connect_private.notification_cleanup_runs enable row level security;
revoke all on table ceit_connect_private.notification_cleanup_runs
from public, anon, authenticated, service_role;

create index notification_cleanup_runs_finished_at_id_idx
on ceit_connect_private.notification_cleanup_runs(finished_at, id);

create function ceit_connect_private.purge_old_read_notifications(
  p_cutoff_at timestamptz
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
    raise exception using
      errcode = '42501',
      message = 'Postgres session required.';
  end if;

  if p_cutoff_at is null then
    raise exception using
      errcode = '22023',
      message = 'Cleanup cutoff is required.';
  end if;

  with victims as materialized (
    select notification_row.id
    from public.notifications as notification_row
    where notification_row.read_at is not null
      and notification_row.read_at < p_cutoff_at
    order by notification_row.read_at, notification_row.id
    limit public.notification_cleanup_batch_size()
    for update of notification_row skip locked
  )
  delete from public.notifications as notification_row
  using victims
  where notification_row.id = victims.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.purge_old_read_notifications(timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.purge_old_read_notifications(timestamptz)
from public, anon, authenticated, service_role;

create function ceit_connect_private.purge_notification_cleanup_runs()
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
    raise exception using
      errcode = '42501',
      message = 'Postgres session required.';
  end if;

  with victims as materialized (
    select run_row.id
    from ceit_connect_private.notification_cleanup_runs as run_row
    where run_row.finished_at
      < pg_catalog.clock_timestamp() - pg_catalog.make_interval(
          days => public.notification_cleanup_run_retention_days()
        )
    order by run_row.finished_at, run_row.id
    limit public.notification_cleanup_batch_size()
    for update of run_row skip locked
  )
  delete from ceit_connect_private.notification_cleanup_runs as run_row
  using victims
  where run_row.id = victims.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.purge_notification_cleanup_runs()
owner to postgres;
revoke all on function ceit_connect_private.purge_notification_cleanup_runs()
from public, anon, authenticated, service_role;

create function public.run_notification_cleanup()
returns table (
  out_run_id uuid,
  out_started_at timestamptz,
  out_finished_at timestamptz,
  out_cutoff_at timestamptz,
  out_status text,
  out_eligible_count bigint,
  out_deleted_count integer,
  out_retention_deleted_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cleanup_sqlstate text;
  v_retention_sqlstate text;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'Postgres session required.';
  end if;

  out_run_id := gen_random_uuid();
  out_started_at := pg_catalog.clock_timestamp();
  out_cutoff_at := out_started_at - pg_catalog.make_interval(
    days => public.notification_read_retention_days()
  );
  out_status := 'running';
  out_eligible_count := 0;
  out_deleted_count := 0;
  out_retention_deleted_count := 0;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('ceit-connect:notification-cleanup', 0)
  ) then
    out_status := 'skipped_concurrent';
    out_finished_at := pg_catalog.clock_timestamp();
    insert into ceit_connect_private.notification_cleanup_runs(
      id, started_at, finished_at, cutoff_at, status
    ) values (
      out_run_id, out_started_at, out_finished_at, out_cutoff_at, out_status
    );
    return next;
    return;
  end if;

  select pg_catalog.count(*)
  into out_eligible_count
  from public.notifications as notification_row
  where notification_row.read_at is not null
    and notification_row.read_at < out_cutoff_at;

  insert into ceit_connect_private.notification_cleanup_runs(
    id, started_at, cutoff_at, status, eligible_count
  ) values (
    out_run_id, out_started_at, out_cutoff_at, out_status, out_eligible_count
  );

  begin
    out_deleted_count :=
      ceit_connect_private.purge_old_read_notifications(out_cutoff_at);
    out_status := 'completed';
  exception when others then
    get stacked diagnostics v_cleanup_sqlstate = returned_sqlstate;
    out_status := 'completed_with_failures';
  end;

  out_finished_at := pg_catalog.clock_timestamp();
  update ceit_connect_private.notification_cleanup_runs as run_row
  set finished_at = out_finished_at,
      status = out_status,
      deleted_count = out_deleted_count,
      cleanup_error_sqlstate = v_cleanup_sqlstate,
      cleanup_error_message = case
        when v_cleanup_sqlstate is null then null
        else 'Notification cleanup failed.'
      end
  where run_row.id = out_run_id;

  begin
    out_retention_deleted_count :=
      ceit_connect_private.purge_notification_cleanup_runs();
    update ceit_connect_private.notification_cleanup_runs as run_row
    set retention_deleted_count = out_retention_deleted_count
    where run_row.id = out_run_id;
  exception when others then
    get stacked diagnostics v_retention_sqlstate = returned_sqlstate;
    update ceit_connect_private.notification_cleanup_runs as run_row
    set retention_error_sqlstate = v_retention_sqlstate,
        retention_error_message = 'Run-history retention failed.'
    where run_row.id = out_run_id;
  end;

  return next;
end;
$$;
alter function public.run_notification_cleanup() owner to postgres;
revoke all on function public.run_notification_cleanup()
from public, anon, authenticated, service_role;

comment on function public.delete_notification(uuid) is
  'Deletes one notification only when it belongs to the active signed-in profile. Missing and foreign rows return false.';
comment on function public.clear_read_notifications() is
  'Deletes unlocked read notifications belonging to the active signed-in profile in ID order without waiting on locked rows. Unread notifications are never touched.';
comment on function public.run_notification_cleanup() is
  'Postgres-session-only cleanup runner. Deletes at most 500 oldest read notifications older than 60 days and retains private run history for 30 days.';
comment on table ceit_connect_private.notification_cleanup_runs is
  'Private aggregate notification-cleanup history. Contains no notification, user, task, event, or comment identifiers.';
