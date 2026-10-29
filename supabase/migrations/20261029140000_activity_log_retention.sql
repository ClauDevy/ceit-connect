-- Add a bounded, postgres-only retention path for the immutable activity log.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 12b must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create function public.activity_log_retention_days()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select 30::integer;
$$;

alter function public.activity_log_retention_days() owner to postgres;

revoke all on function public.activity_log_retention_days()
from public, anon, authenticated;

create function public.guard_activity_log_deletes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purger text := pg_catalog.current_setting(
    'ceit_connect.activity_log_purger',
    true
  );
begin
  if tg_op = 'TRUNCATE' then
    raise exception using
      errcode = 'CAL03',
      message = 'The activity log cannot be truncated.';
  end if;

  if current_user <> 'postgres'
     or v_purger is distinct from 'purge_activity_log' then
    raise exception using
      errcode = 'CAL03',
      message = 'Activity log rows may be deleted only by the retention function.';
  end if;

  return null;
end;
$$;

alter function public.guard_activity_log_deletes() owner to postgres;

revoke all on function public.guard_activity_log_deletes()
from public, anon, authenticated;

create trigger activity_log_guard_deletes
before delete or truncate on public.activity_log
for each statement
execute function public.guard_activity_log_deletes();

create function public.purge_activity_log()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = 'CAL03',
      message = 'Activity log retention must run as postgres.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.activity_log_purger',
    'purge_activity_log',
    true
  );

  with victims as materialized (
    select log_row.id
    from public.activity_log as log_row
    where log_row.created_at
      < pg_catalog.now() - pg_catalog.make_interval(
          days => public.activity_log_retention_days()
        )
    order by log_row.created_at, log_row.id
    limit 5000
    for update of log_row skip locked
  )
  delete from public.activity_log as log_row
  using victims
  where log_row.id = victims.id;

  get diagnostics v_deleted = row_count;

  perform pg_catalog.set_config(
    'ceit_connect.activity_log_purger',
    '',
    true
  );

  return v_deleted;
exception
  when others then
    perform pg_catalog.set_config(
      'ceit_connect.activity_log_purger',
      '',
      true
    );
    raise;
end;
$$;

alter function public.purge_activity_log() owner to postgres;

revoke all on function public.purge_activity_log()
from public, anon, authenticated;

-- PostgreSQL 17 includes MAINTAIN in ALL. Keep every direct table capability,
-- including DELETE and TRUNCATE, unavailable to application roles.
revoke all on table public.activity_log
from public, anon, authenticated;

comment on function public.activity_log_retention_days() is
  'Returns the fixed activity-log retention window in days. Change through a new migration together with the shared TypeScript constant.';

comment on function public.purge_activity_log() is
  'Deletes at most 5,000 activity rows older than the fixed retention window. Callable only in a postgres session.';

comment on function public.guard_activity_log_deletes() is
  'Rejects raw activity-log deletion and all truncation; only the guarded retention function may delete rows.';
