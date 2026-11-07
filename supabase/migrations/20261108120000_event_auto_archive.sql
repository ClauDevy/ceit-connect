-- Phase 4B Batch D: owner-run automatic event archiving after three complete
-- Asia/Manila grace days. The environment-specific pg_cron job is created on
-- Prod by the owner only; this migration creates no scheduled job.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch D must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

create function public.event_auto_archive_grace_days()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 3::integer $$;
alter function public.event_auto_archive_grace_days() owner to postgres;
revoke all on function public.event_auto_archive_grace_days()
from public, anon, authenticated, service_role;

create function public.event_auto_archive_run_retention_days()
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$ select 30::integer $$;
alter function public.event_auto_archive_run_retention_days() owner to postgres;
revoke all on function public.event_auto_archive_run_retention_days()
from public, anon, authenticated, service_role;

alter table public.events
  add column archived_unfinished_task_count bigint;

alter table public.events
  add constraint events_archived_unfinished_task_count_nonnegative
    check (
      archived_unfinished_task_count is null
      or archived_unfinished_task_count >= 0
    );

-- Archived tasks are already frozen, so this is an exact one-time snapshot.
-- Suppress the ordinary lifecycle/update-time triggers so this data migration
-- neither trips the Archived freeze nor changes the concurrency token.
alter table public.events disable trigger guard_event_updates;
alter table public.events disable trigger events_set_updated_at;
update public.events as event_row
set archived_unfinished_task_count = (
  select pg_catalog.count(*)
  from public.tasks as task_row
  where task_row.event_id = event_row.id
    and task_row.status <> 'Completed'
)
where event_row.status = 'Archived';
alter table public.events enable trigger events_set_updated_at;
alter table public.events enable trigger guard_event_updates;

alter table public.events
  add constraint events_archived_unfinished_task_count_lifecycle
    check (
      (status = 'Archived' and archived_unfinished_task_count is not null)
      or (status <> 'Archived' and archived_unfinished_task_count is null)
    );

create function ceit_connect_private.capture_event_archive_snapshot()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  select pg_catalog.count(*)
  into new.archived_unfinished_task_count
  from public.tasks as task_row
  where task_row.event_id = new.id
    and task_row.status <> 'Completed';

  return new;
end;
$$;
alter function ceit_connect_private.capture_event_archive_snapshot() owner to postgres;
revoke all on function ceit_connect_private.capture_event_archive_snapshot()
from public, anon, authenticated, service_role;

-- The WHEN clause is the complete exception boundary: no Draft/Active edit,
-- repeated Archived value, or non-status update invokes this snapshot writer.
create trigger events_y0_capture_archive_snapshot
before update of status on public.events
for each row
when (old.status = 'Active' and new.status = 'Archived')
execute function ceit_connect_private.capture_event_archive_snapshot();

-- Preserve the latest Batch 13d guard body and close only the transition from
-- a present Active end date to null. A legacy null-end Active event remains
-- editable and can still become Archived.
create or replace function public.guard_event_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if not ceit_connect_private.event_delete_context_matches(old.id) then
      raise exception using
        errcode = 'CCE01',
        message = 'Events can be deleted only through the event deletion service.';
    end if;

    if old.status not in ('Draft', 'Archived') then
      raise exception using
        errcode = 'CCE04',
        message = 'Only Draft or Archived events can be deleted.';
    end if;

    delete from public.tasks
    where event_id = old.id;

    return old;
  end if;

  if old.status = 'Archived' then
    raise exception 'Archived events are read-only.';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  if new.status = 'Archived' and old.status <> 'Active' then
    raise exception 'Only Active events can be archived.';
  end if;

  if old.status = 'Active'
     and new.status = 'Active'
     and old.end_date is not null
     and new.end_date is null then
    raise exception using
      errcode = 'CCD06',
      message = 'An Active event requires an end date.';
  end if;

  if old.status = 'Draft' and new.status = 'Active' then
    if new.end_date is null then
      raise exception 'An Active event requires an end date.';
    end if;

    if not exists (
      select 1
      from public.tasks
      where event_id = old.id
    ) then
      raise exception 'An event requires at least one task before it can be launched.';
    end if;
  end if;

  return new;
end;
$$;
alter function public.guard_event_updates() owner to postgres;
revoke all on function public.guard_event_updates()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create table ceit_connect_private.event_auto_archive_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  manila_run_date date not null,
  status text not null check (
    status in ('running', 'completed', 'completed_with_failures', 'skipped_concurrent')
  ),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  attempted_count integer not null default 0 check (attempted_count between 0 and 100),
  archived_count integer not null default 0 check (archived_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  retention_deleted_count integer not null default 0 check (retention_deleted_count >= 0),
  retention_error_sqlstate text check (
    retention_error_sqlstate is null
    or retention_error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  retention_error_message text check (
    retention_error_message is null
    or retention_error_message = 'Run-history retention failed.'
  ),
  constraint event_auto_archive_runs_totals check (
    attempted_count = archived_count + skipped_count + failed_count
  )
);

create index event_auto_archive_runs_finished_at_id_idx
on ceit_connect_private.event_auto_archive_runs(finished_at, id);

create table ceit_connect_private.event_auto_archive_run_items (
  run_id uuid not null
    references ceit_connect_private.event_auto_archive_runs(id)
    on delete cascade,
  event_id uuid not null,
  outcome text not null check (outcome in ('archived', 'skipped', 'failed')),
  unfinished_task_count bigint check (
    unfinished_task_count is null
    or unfinished_task_count >= 0
  ),
  error_sqlstate text check (
    error_sqlstate is null
    or error_sqlstate ~ '^[0-9A-Z]{5}$'
  ),
  error_message text check (
    error_message is null
    or error_message = 'Automatic archive failed.'
  ),
  processed_at timestamptz not null default clock_timestamp(),
  primary key (run_id, event_id),
  constraint event_auto_archive_run_items_shape check (
    (outcome = 'archived'
      and unfinished_task_count is not null
      and error_sqlstate is null
      and error_message is null)
    or (outcome = 'skipped'
      and unfinished_task_count is null
      and error_sqlstate is null
      and error_message is null)
    or (outcome = 'failed'
      and unfinished_task_count is null
      and error_sqlstate is not null
      and error_message = 'Automatic archive failed.')
  )
);

revoke all on table ceit_connect_private.event_auto_archive_runs
from public, anon, authenticated, service_role;
revoke all on table ceit_connect_private.event_auto_archive_run_items
from public, anon, authenticated, service_role;

create function ceit_connect_private.event_auto_archive_warning_values(
  p_end_date date,
  p_manila_today date
)
returns table (archive_on date, days_remaining integer)
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_end_date + public.event_auto_archive_grace_days() + 1,
    greatest(
      (p_end_date + public.event_auto_archive_grace_days() + 1) - p_manila_today,
      0
    )::integer
  where p_end_date is not null
    and p_manila_today > p_end_date
$$;
alter function ceit_connect_private.event_auto_archive_warning_values(date,date)
owner to postgres;
revoke all on function ceit_connect_private.event_auto_archive_warning_values(date,date)
from public, anon, authenticated, service_role;

create function public.get_event_auto_archive_warning(p_event_id uuid)
returns table (
  archive_on date,
  days_remaining integer,
  unfinished_task_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_end_date date;
  v_today date := pg_catalog.timezone(
    'Asia/Manila',
    pg_catalog.statement_timestamp()
  )::date;
begin
  if v_caller is null or not exists (
    select 1
    from public.users as caller
    where caller.id = v_caller
      and caller.is_active
      and caller.role in ('Admin', 'Co-Admin', 'Member')
  ) then
    raise exception using
      errcode = 'CDA01',
      message = 'Automatic archive warning is unavailable.';
  end if;

  select event_row.end_date
  into v_end_date
  from public.events as event_row
  where event_row.id = p_event_id
    and event_row.status = 'Active';

  if not found then return; end if;

  return query
  select
    warning.archive_on,
    warning.days_remaining,
    (
      select pg_catalog.count(*)
      from public.tasks as task_row
      where task_row.event_id = p_event_id
        and task_row.status <> 'Completed'
    )::bigint
  from ceit_connect_private.event_auto_archive_warning_values(
    v_end_date,
    v_today
  ) as warning;
end;
$$;
alter function public.get_event_auto_archive_warning(uuid) owner to postgres;
revoke all on function public.get_event_auto_archive_warning(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_event_auto_archive_warning(uuid)
to authenticated;

insert into ceit_connect_private.activity_type_catalog(
  activity_type,
  broad_action,
  subject_kind,
  audience,
  summary_text,
  allowed_payload_keys
) values (
  'event_auto_archived',
  'UPDATE',
  'event',
  'leadership',
  'Event archived automatically',
  array['event_status','old_status','new_status','unfinished_task_count']
);

create function ceit_connect_private.auto_archive_one_event(
  p_event_id uuid,
  p_manila_today date
)
returns table (out_outcome text, out_unfinished_task_count bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_end_date date;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = 'CDA02',
      message = 'Automatic archive must run in a postgres session.';
  end if;

  select event_row.status, event_row.end_date
  into v_status, v_end_date
  from public.events as event_row
  where event_row.id = p_event_id
  for update skip locked;

  if not found
     or v_status <> 'Active'
     or v_end_date is null
     or p_manila_today <= v_end_date + public.event_auto_archive_grace_days() then
    return query select 'skipped'::text, null::bigint;
    return;
  end if;

  update public.events as event_row
  set status = 'Archived'
  where event_row.id = p_event_id
    and event_row.status = 'Active'
  returning event_row.archived_unfinished_task_count
  into out_unfinished_task_count;

  if not found or out_unfinished_task_count is null then
    raise exception using
      errcode = 'CDA03',
      message = 'Automatic archive could not store its task count.';
  end if;

  perform ceit_connect_private.write_activity(
    'event_auto_archived',
    'system',
    null,
    null,
    p_event_id,
    null,
    null,
    null,
    pg_catalog.jsonb_build_object(
      'event_status', 'Archived',
      'old_status', 'Active',
      'new_status', 'Archived',
      'unfinished_task_count', out_unfinished_task_count
    )
  );

  out_outcome := 'archived';
  return next;
end;
$$;
alter function ceit_connect_private.auto_archive_one_event(uuid,date)
owner to postgres;
revoke all on function ceit_connect_private.auto_archive_one_event(uuid,date)
from public, anon, authenticated, service_role;

create function ceit_connect_private.purge_event_auto_archive_runs()
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
      errcode = 'CDA02',
      message = 'Automatic archive must run in a postgres session.';
  end if;

  with victims as materialized (
    select run_row.id
    from ceit_connect_private.event_auto_archive_runs as run_row
    where run_row.finished_at
      < pg_catalog.clock_timestamp() - pg_catalog.make_interval(
          days => public.event_auto_archive_run_retention_days()
        )
    order by run_row.finished_at, run_row.id
    limit 500
    for update of run_row skip locked
  )
  delete from ceit_connect_private.event_auto_archive_runs as run_row
  using victims
  where run_row.id = victims.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
alter function ceit_connect_private.purge_event_auto_archive_runs()
owner to postgres;
revoke all on function ceit_connect_private.purge_event_auto_archive_runs()
from public, anon, authenticated, service_role;

create function public.run_event_auto_archive()
returns table (
  out_run_id uuid,
  out_started_at timestamptz,
  out_finished_at timestamptz,
  out_eligible_count integer,
  out_attempted_count integer,
  out_archived_count integer,
  out_skipped_count integer,
  out_failed_count integer,
  out_retention_deleted_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := pg_catalog.timezone(
    'Asia/Manila',
    pg_catalog.clock_timestamp()
  )::date;
  v_candidate record;
  v_step record;
  v_sqlstate text;
  v_retention_sqlstate text;
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = 'CDA02',
      message = 'Automatic archive must run in a postgres session.';
  end if;

  out_started_at := pg_catalog.clock_timestamp();
  out_run_id := gen_random_uuid();
  out_eligible_count := 0;
  out_attempted_count := 0;
  out_archived_count := 0;
  out_skipped_count := 0;
  out_failed_count := 0;
  out_retention_deleted_count := 0;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('ceit-connect:event-auto-archive', 0)
  ) then
    out_finished_at := pg_catalog.clock_timestamp();
    insert into ceit_connect_private.event_auto_archive_runs(
      id, started_at, finished_at, manila_run_date, status
    ) values (
      out_run_id, out_started_at, out_finished_at, v_today, 'skipped_concurrent'
    );
    return next;
    return;
  end if;

  select pg_catalog.count(*)::integer
  into out_eligible_count
  from public.events as event_row
  where event_row.status = 'Active'
    and event_row.end_date is not null
    and v_today > event_row.end_date + public.event_auto_archive_grace_days();

  insert into ceit_connect_private.event_auto_archive_runs(
    id, started_at, manila_run_date, status, eligible_count
  ) values (
    out_run_id, out_started_at, v_today, 'running', out_eligible_count
  );

  for v_candidate in
    select event_row.id
    from public.events as event_row
    where event_row.status = 'Active'
      and event_row.end_date is not null
      and v_today > event_row.end_date + public.event_auto_archive_grace_days()
    order by event_row.end_date, event_row.id
    limit 100
  loop
    out_attempted_count := out_attempted_count + 1;
    begin
      select step.out_outcome, step.out_unfinished_task_count
      into strict v_step
      from ceit_connect_private.auto_archive_one_event(
        v_candidate.id,
        v_today
      ) as step;

      insert into ceit_connect_private.event_auto_archive_run_items(
        run_id, event_id, outcome, unfinished_task_count
      ) values (
        out_run_id,
        v_candidate.id,
        v_step.out_outcome,
        v_step.out_unfinished_task_count
      );

      if v_step.out_outcome = 'archived' then
        out_archived_count := out_archived_count + 1;
      else
        out_skipped_count := out_skipped_count + 1;
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      insert into ceit_connect_private.event_auto_archive_run_items(
        run_id, event_id, outcome, error_sqlstate, error_message
      ) values (
        out_run_id,
        v_candidate.id,
        'failed',
        v_sqlstate,
        'Automatic archive failed.'
      );
      out_failed_count := out_failed_count + 1;
    end;
  end loop;

  out_finished_at := pg_catalog.clock_timestamp();
  update ceit_connect_private.event_auto_archive_runs as run_row
  set finished_at = out_finished_at,
      status = case
        when out_failed_count > 0 then 'completed_with_failures'
        else 'completed'
      end,
      attempted_count = out_attempted_count,
      archived_count = out_archived_count,
      skipped_count = out_skipped_count,
      failed_count = out_failed_count
  where run_row.id = out_run_id;

  begin
    out_retention_deleted_count :=
      ceit_connect_private.purge_event_auto_archive_runs();
    update ceit_connect_private.event_auto_archive_runs as run_row
    set retention_deleted_count = out_retention_deleted_count
    where run_row.id = out_run_id;
  exception when others then
    get stacked diagnostics v_retention_sqlstate = returned_sqlstate;
    update ceit_connect_private.event_auto_archive_runs as run_row
    set retention_error_sqlstate = v_retention_sqlstate,
        retention_error_message = 'Run-history retention failed.'
    where run_row.id = out_run_id;
  end;

  return next;
end;
$$;
alter function public.run_event_auto_archive() owner to postgres;
revoke all on function public.run_event_auto_archive()
from public, anon, authenticated, service_role;

comment on function public.event_auto_archive_grace_days() is
  'Returns the fixed count of complete Asia/Manila grace days before an Active event becomes eligible for automatic archive.';
comment on function public.run_event_auto_archive() is
  'Postgres-session-only bounded automatic archive runner. Processes at most 100 events and isolates each event in a subtransaction.';
comment on table ceit_connect_private.event_auto_archive_run_items is
  'Operational automatic-archive outcomes. event_id is deliberately not a foreign key so history survives event deletion.';

