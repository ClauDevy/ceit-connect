-- Batch E2: capability-authenticated backup worker, manifest-checked deletion,
-- Admin management RPCs, and environment-neutral scheduler helpers.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch E2 worker must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create function ceit_connect_private.cleanup_activity_log_backup_file_payloads()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'failed')
     and new.status is distinct from old.status then
    delete from ceit_connect_private.activity_log_backup_file_payloads as payload
    using ceit_connect_private.activity_log_backup_files as file_row
    where payload.file_id = file_row.id
      and file_row.backup_id = new.id;
  end if;
  return null;
end;
$$;

alter function ceit_connect_private.cleanup_activity_log_backup_file_payloads()
owner to postgres;
revoke all on function ceit_connect_private.cleanup_activity_log_backup_file_payloads()
from public, anon, authenticated, service_role;

create trigger activity_log_backups_cleanup_file_payloads
after update of status on ceit_connect_private.activity_log_backups
for each row execute function ceit_connect_private.cleanup_activity_log_backup_file_payloads();

create function ceit_connect_private.fail_stale_activity_log_snapshots()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update ceit_connect_private.activity_log_backups as backup
  set status = 'failed',
      last_error_code = case
        when backup.created_at <= pg_catalog.clock_timestamp() - interval '24 hours'
          then 'snapshot_expired'
        else 'snapshot_attempts_exhausted'
      end,
      completed_at = pg_catalog.clock_timestamp(),
      lease_token = null,
      lease_expires_at = null
  where backup.status in ('pending', 'snapshotting')
    and (
      backup.attempt_count >= 5
      or backup.created_at <= pg_catalog.clock_timestamp() - interval '24 hours'
    );
end;
$$;

alter function ceit_connect_private.fail_stale_activity_log_snapshots()
owner to postgres;
revoke all on function ceit_connect_private.fail_stale_activity_log_snapshots()
from public, anon, authenticated, service_role;

create function ceit_connect_private.assert_no_active_activity_log_backup()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform ceit_connect_private.fail_stale_activity_log_snapshots();
  update ceit_connect_private.activity_log_backups as backup
  set status = 'failed', last_error_code = 'deletion_window_expired',
      completed_at = pg_catalog.clock_timestamp()
  where backup.status = 'ready'
    and backup.delete_expires_at <= pg_catalog.clock_timestamp();
  if exists (
    select 1
    from ceit_connect_private.activity_log_backups as backup
    where backup.status in (
      'pending', 'snapshotting', 'ready', 'deletion_requested', 'deleting',
      'email_pending'
    )
  ) then
    raise exception using
      errcode = 'CAL06',
      message = 'Another Activity Log backup is still in progress.';
  end if;
end;
$$;

alter function ceit_connect_private.assert_no_active_activity_log_backup()
owner to postgres;
revoke all on function ceit_connect_private.assert_no_active_activity_log_backup()
from public, anon, authenticated, service_role;

create function ceit_connect_private.start_monthly_activity_log_backup()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_cycle date := pg_catalog.date_trunc(
    'month', v_now at time zone 'Asia/Manila'
  )::date;
  v_setting ceit_connect_private.activity_log_settings%rowtype;
  v_backup_id uuid;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;

  select backup.id into v_backup_id
  from ceit_connect_private.activity_log_backups as backup
  where backup.kind = 'monthly_retention'
    and backup.cycle_month = v_cycle;
  if found then return v_backup_id; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('activity-log-backup-active', 0)
  );

  select backup.id into v_backup_id
  from ceit_connect_private.activity_log_backups as backup
  where backup.kind = 'monthly_retention'
    and backup.cycle_month = v_cycle;
  if found then return v_backup_id; end if;

  perform ceit_connect_private.assert_no_active_activity_log_backup();

  select setting.* into v_setting
  from ceit_connect_private.activity_log_settings as setting
  where setting.singleton;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log retention setting is unavailable.';
  end if;

  insert into ceit_connect_private.activity_log_backups (
    kind, cycle_month, fixed_cutoff_at, retention_days, policy_setter_id
  ) values (
    'monthly_retention',
    v_cycle,
    v_now - pg_catalog.make_interval(days => v_setting.retention_days),
    v_setting.retention_days,
    v_setting.updated_by
  )
  returning id into v_backup_id;
  return v_backup_id;
end;
$$;

alter function ceit_connect_private.start_monthly_activity_log_backup()
owner to postgres;
revoke all on function ceit_connect_private.start_monthly_activity_log_backup()
from public, anon, authenticated, service_role;

create function public.create_activity_log_manual_backup(
  p_mode text,
  p_before_date date default null
)
returns table (backup_id uuid, backup_status text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_cutoff timestamptz;
  v_id uuid;
begin
  if not exists (
    select 1 from public.users as profile
    where profile.id = v_caller and profile.is_active and profile.role = 'Admin'
  ) then
    raise exception using errcode = 'CAL04', message = 'Activity Log administration is unavailable.';
  end if;

  if p_mode = 'before_date' and p_before_date is not null
     and p_before_date <= (pg_catalog.clock_timestamp() at time zone 'Asia/Manila')::date then
    v_cutoff := p_before_date::timestamp at time zone 'Asia/Manila';
  elsif p_mode = 'all' and p_before_date is null then
    v_cutoff := pg_catalog.clock_timestamp();
  else
    raise exception using errcode = 'CAL02', message = 'The Activity Log backup request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('activity-log-backup-active', 0)
  );
  perform ceit_connect_private.assert_no_active_activity_log_backup();

  insert into ceit_connect_private.activity_log_backups (
    kind, fixed_cutoff_at, requested_by
  ) values (
    case when p_mode = 'all' then 'manual_all' else 'manual_before_date' end,
    v_cutoff,
    v_caller
  ) returning id into v_id;

  return query select v_id, 'pending'::text;
end;
$$;

alter function public.create_activity_log_manual_backup(text, date) owner to postgres;
revoke all on function public.create_activity_log_manual_backup(text, date)
from public, anon, authenticated, service_role;
grant execute on function public.create_activity_log_manual_backup(text, date)
to authenticated;

create function public.list_activity_log_backups(p_limit integer default 20)
returns table (
  backup_id uuid,
  backup_kind text,
  backup_status text,
  fixed_cutoff_at timestamptz,
  file_count integer,
  row_count integer,
  deleted_count integer,
  delete_expires_at timestamptz,
  created_at timestamptz,
  completed_at timestamptz,
  attempt_count integer,
  next_attempt_at timestamptz,
  email_attempt_count integer,
  last_error_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.users as profile
    where profile.id = v_caller and profile.is_active and profile.role = 'Admin'
  ) then
    raise exception using errcode = 'CAL04', message = 'Activity Log administration is unavailable.';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = 'CAL02', message = 'The Activity Log backup request is invalid.';
  end if;
  return query
  select backup.id, backup.kind, backup.status, backup.fixed_cutoff_at,
    backup.file_count, backup.row_count, backup.deleted_count,
    backup.delete_expires_at, backup.created_at, backup.completed_at,
    backup.attempt_count, backup.next_attempt_at,
    backup.email_attempt_count, backup.last_error_code
  from ceit_connect_private.activity_log_backups as backup
  order by backup.created_at desc, backup.id desc
  limit p_limit;
end;
$$;

alter function public.list_activity_log_backups(integer) owner to postgres;
revoke all on function public.list_activity_log_backups(integer)
from public, anon, authenticated, service_role;
grant execute on function public.list_activity_log_backups(integer) to authenticated;

create function public.list_activity_log_backup_files(p_backup_id uuid)
returns table (
  file_id uuid,
  part_number integer,
  object_path text,
  row_count integer,
  raw_byte_count integer,
  sha256_hex text,
  downloaded_by_caller boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.users as profile
    where profile.id = v_caller and profile.is_active and profile.role = 'Admin'
  ) then
    raise exception using errcode = 'CAL04', message = 'Activity Log administration is unavailable.';
  end if;
  return query
  select file_row.id, file_row.part_number, file_row.object_path,
    file_row.row_count, file_row.raw_byte_count, file_row.sha256_hex,
    exists (
      select 1 from ceit_connect_private.activity_log_backup_downloads as download
      where download.file_id = file_row.id and download.admin_id = v_caller
    )
  from ceit_connect_private.activity_log_backup_files as file_row
  where file_row.backup_id = p_backup_id and file_row.status = 'verified'
  order by file_row.part_number;
end;
$$;

alter function public.list_activity_log_backup_files(uuid) owner to postgres;
revoke all on function public.list_activity_log_backup_files(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_activity_log_backup_files(uuid) to authenticated;

create function public.record_activity_log_backup_download(p_file_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_caller uuid := auth.uid(); v_backup uuid;
begin
  if not exists (
    select 1 from public.users as profile
    where profile.id = v_caller and profile.is_active and profile.role = 'Admin'
  ) then
    raise exception using errcode = 'CAL04', message = 'Activity Log administration is unavailable.';
  end if;
  select file_row.backup_id into v_backup
  from ceit_connect_private.activity_log_backup_files as file_row
  where file_row.id = p_file_id and file_row.status = 'verified';
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup file is unavailable.';
  end if;
  insert into ceit_connect_private.activity_log_backup_downloads (
    backup_id, file_id, admin_id
  ) values (v_backup, p_file_id, v_caller)
  on conflict (file_id, admin_id) do update
  set downloaded_at = pg_catalog.clock_timestamp();
  return true;
end;
$$;

alter function public.record_activity_log_backup_download(uuid) owner to postgres;
revoke all on function public.record_activity_log_backup_download(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.record_activity_log_backup_download(uuid)
to authenticated;

create function public.request_activity_log_backup_deletion(
  p_backup_id uuid,
  p_confirmation text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_caller uuid := auth.uid(); v_backup ceit_connect_private.activity_log_backups%rowtype;
begin
  if not exists (
    select 1 from public.users as profile
    where profile.id = v_caller and profile.is_active and profile.role = 'Admin'
  ) then
    raise exception using errcode = 'CAL04', message = 'Activity Log administration is unavailable.';
  end if;
  if p_backup_id is null or p_confirmation is null then
    raise exception using errcode = 'CAL02', message = 'The Activity Log deletion request is invalid.';
  end if;
  select backup.* into v_backup
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id
  for update;
  if not found or v_backup.kind = 'monthly_retention' or v_backup.status <> 'ready'
     or v_backup.delete_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'CAL05', message = 'The Activity Log snapshot is no longer available for deletion.';
  end if;
  if p_confirmation <> 'DELETE ' || v_backup.row_count::text || ' LOG ENTRIES' then
    raise exception using errcode = 'CAL02', message = 'The Activity Log deletion confirmation does not match.';
  end if;
  if exists (
    select 1
    from ceit_connect_private.activity_log_backup_files as file_row
    where file_row.backup_id = v_backup.id
      and not exists (
        select 1
        from ceit_connect_private.activity_log_backup_downloads as download
        where download.file_id = file_row.id and download.admin_id = v_caller
      )
  ) then
    raise exception using errcode = 'CAL07', message = 'Download every snapshot file before deleting Activity Log entries.';
  end if;
  update ceit_connect_private.activity_log_backups as backup
  set status = 'deletion_requested',
      deletion_requested_by = v_caller,
      attempt_count = 0,
      next_attempt_at = pg_catalog.clock_timestamp(),
      last_error_code = null,
      lease_token = null,
      lease_expires_at = null
  where backup.id = v_backup.id;
  return true;
end;
$$;

alter function public.request_activity_log_backup_deletion(uuid, text) owner to postgres;
revoke all on function public.request_activity_log_backup_deletion(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.request_activity_log_backup_deletion(uuid, text)
to authenticated;

create function public.retry_activity_log_backup_email(p_backup_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.users as profile
    where profile.id = v_caller and profile.is_active and profile.role = 'Admin'
  ) then
    raise exception using errcode = 'CAL04', message = 'Activity Log administration is unavailable.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('activity-log-backup-active', 0)
  );
  perform ceit_connect_private.assert_no_active_activity_log_backup();
  update ceit_connect_private.activity_log_backups as backup
  set status = 'email_pending', email_attempt_count = 0,
      email_http_status = null, last_error_code = null,
      next_attempt_at = pg_catalog.clock_timestamp()
  where backup.id = p_backup_id and backup.status = 'email_failed'
    and backup.deleted_count > 0;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup email is unavailable for retry.';
  end if;
  return true;
end;
$$;

alter function public.retry_activity_log_backup_email(uuid) owner to postgres;
revoke all on function public.retry_activity_log_backup_email(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.retry_activity_log_backup_email(uuid)
to authenticated;

create function public.claim_activity_log_backup()
returns table (
  out_backup_id uuid,
  out_kind text,
  out_status text,
  out_fixed_cutoff_at timestamptz,
  out_lease_token uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_generation bigint; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  perform ceit_connect_private.fail_stale_activity_log_snapshots();
  delete from ceit_connect_private.activity_log_backup_rows as manifest
  using ceit_connect_private.activity_log_backup_files as file_row
  where manifest.file_id = file_row.id and file_row.status = 'reserved'
    and file_row.reservation_expires_at <= v_now;
  delete from ceit_connect_private.activity_log_backup_files as file_row
  where file_row.status = 'reserved' and file_row.reservation_expires_at <= v_now;

  return query
  with candidate as (
    select backup.id
    from ceit_connect_private.activity_log_backups as backup
    where backup.status in ('pending', 'snapshotting', 'deletion_requested', 'deleting', 'email_pending')
      and (backup.lease_expires_at is null or backup.lease_expires_at <= v_now)
      and backup.next_attempt_at <= v_now
    order by backup.created_at, backup.id
    limit 1 for update skip locked
  )
  update ceit_connect_private.activity_log_backups as backup
  set status = case
        when backup.status = 'pending' then 'snapshotting'
        when backup.status = 'deletion_requested' then 'deleting'
        else backup.status
      end,
      lease_token = gen_random_uuid(),
      lease_expires_at = v_now + interval '5 minutes'
  from candidate
  where backup.id = candidate.id
  returning backup.id, backup.kind, backup.status, backup.fixed_cutoff_at,
    backup.lease_token;
end;
$$;

alter function public.claim_activity_log_backup() owner to postgres;
revoke all on function public.claim_activity_log_backup()
from public, anon, authenticated, service_role;
grant execute on function public.claim_activity_log_backup() to anon;

create function public.list_activity_log_backup_candidates(
  p_backup_id uuid,
  p_lease_token uuid,
  p_limit integer
)
returns table (
  activity_id uuid,
  activity_created_at timestamptz,
  action text,
  task_title text,
  event_name text,
  committee_name text,
  actor_name text,
  change_summary text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_generation bigint;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'Activity Log backup candidate limit is invalid.';
  end if;
  if not exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.id = p_backup_id and backup.status = 'snapshotting'
      and backup.lease_token = p_lease_token
      and backup.lease_expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  return query
  select log_row.id, log_row.created_at, log_row.action,
    case
      when log_row.subject_kind = 'task' and (
        live_task.is_confidential is true or log_row.task_was_confidential is true
      ) then 'Confidential Task'
      when log_row.subject_kind = 'task' then
        case when live_task.id is null then
          case when log_row.task_title_snapshot is null then 'Deleted task' else log_row.task_title_snapshot end
        else live_task.title end
      when log_row.subject_kind = 'event' then 'Event'
      when log_row.subject_kind = 'phase' then 'Event phases'
      when log_row.subject_kind = 'person' then
        case when target.id is null or target.anonymized_at is not null then 'Former member' else target.full_name end
      else 'Bulk action'
    end,
    case
      when log_row.subject_kind = 'task' and (
        live_task.is_confidential is true or log_row.task_was_confidential is true
      ) then null
      when log_row.subject_kind in ('event', 'phase', 'task') then live_event.name
      else null
    end,
    case
      when log_row.subject_kind = 'task' and (
        live_task.is_confidential is true or log_row.task_was_confidential is true
      ) then null
      else committee.name
    end,
    case
      when log_row.subject_kind = 'task' and (
        live_task.is_confidential is true or log_row.task_was_confidential is true
      ) then null
      when actor.id is null or actor.anonymized_at is not null then 'Former member'
      else actor.full_name
    end,
    case
      when log_row.subject_kind = 'task' and (
        live_task.is_confidential is true or log_row.task_was_confidential is true
      ) then 'Confidential Task activity'
      when log_row.activity_type = 'activity_log_retention_changed' then
        'Retention changed from ' || (log_row.changes ->> 'old_days') || ' to '
          || (log_row.changes ->> 'new_days') || ' days'
      when log_row.activity_type = 'activity_log_cleared' then
        (log_row.changes ->> 'count') || ' log entries cleared'
      else catalog.summary_text
    end
  from public.activity_log as log_row
  left join ceit_connect_private.activity_type_catalog as catalog
    on catalog.activity_type = log_row.activity_type
  left join public.tasks as live_task on live_task.id = log_row.task_id
  left join public.events as live_event
    on live_event.id = case when log_row.event_id is null then live_task.event_id else log_row.event_id end
  left join public.committees as committee on committee.id = live_task.committee_id
  left join public.users as actor on actor.id = log_row.user_id
  left join public.users as target on target.id = log_row.subject_user_id
  join ceit_connect_private.activity_log_backups as backup on backup.id = p_backup_id
  where log_row.created_at < backup.fixed_cutoff_at
    and not exists (
      select 1 from ceit_connect_private.activity_log_backup_rows as covered
      where covered.backup_id = backup.id and covered.activity_id = log_row.id
    )
  order by log_row.created_at, log_row.id
  limit p_limit;
end;
$$;

alter function public.list_activity_log_backup_candidates(uuid, uuid, integer)
owner to postgres;
revoke all on function public.list_activity_log_backup_candidates(uuid, uuid, integer)
from public, anon, authenticated, service_role;
grant execute on function public.list_activity_log_backup_candidates(uuid, uuid, integer)
to anon;

create function public.reserve_activity_log_backup_file(
  p_backup_id uuid,
  p_lease_token uuid,
  p_activity_ids uuid[]
)
returns table (out_file_id uuid, out_object_path text, out_part_number integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_generation bigint; v_backup ceit_connect_private.activity_log_backups%rowtype;
  v_count integer; v_part integer; v_file uuid := gen_random_uuid(); v_path text;
  v_first record; v_last record;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  v_count := pg_catalog.cardinality(p_activity_ids);
  if p_backup_id is null or p_lease_token is null or v_count is null or v_count not between 1 and 5000
     or exists (select 1 from pg_catalog.unnest(p_activity_ids) as item(id) where item.id is null)
     or (select pg_catalog.count(distinct item.id) from pg_catalog.unnest(p_activity_ids) as item(id)) <> v_count then
    raise exception using errcode = '22023', message = 'Activity Log backup file reservation is invalid.';
  end if;
  select backup.* into v_backup
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.status = 'snapshotting'
    and backup.lease_token = p_lease_token
    and backup.lease_expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  if (select pg_catalog.count(*) from public.activity_log as log_row
      where log_row.id = any(p_activity_ids) and log_row.created_at < v_backup.fixed_cutoff_at) <> v_count
     or exists (
       select 1 from ceit_connect_private.activity_log_backup_rows as covered
       where covered.backup_id = p_backup_id and covered.activity_id = any(p_activity_ids)
     ) then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup rows changed before reservation.';
  end if;
  select log_row.id, log_row.created_at into v_first
  from public.activity_log as log_row where log_row.id = any(p_activity_ids)
  order by log_row.created_at, log_row.id limit 1;
  select log_row.id, log_row.created_at into v_last
  from public.activity_log as log_row where log_row.id = any(p_activity_ids)
  order by log_row.created_at desc, log_row.id desc limit 1;
  select COALESCE(pg_catalog.max(file_row.part_number), 0) + 1 into v_part
  from ceit_connect_private.activity_log_backup_files as file_row
  where file_row.backup_id = p_backup_id;
  v_path := case
    when v_backup.kind = 'monthly_retention' then
      'monthly/' || pg_catalog.to_char(v_backup.cycle_month, 'YYYY-MM') || '/'
    else 'manual/'
  end || p_backup_id::text || '/activity-log-'
    || pg_catalog.to_char(v_backup.fixed_cutoff_at at time zone 'Asia/Manila', 'YYYY-MM-DD')
    || '-part-' || pg_catalog.lpad(v_part::text, 4, '0') || '-' || v_file::text || '.csv';
  insert into ceit_connect_private.activity_log_backup_files (
    id, backup_id, part_number, object_path, reservation_expires_at, row_count,
    first_created_at, first_activity_id, last_created_at, last_activity_id
  ) values (
    v_file, p_backup_id, v_part, v_path,
    pg_catalog.clock_timestamp() + interval '5 minutes', v_count,
    v_first.created_at, v_first.id, v_last.created_at, v_last.id
  );
  insert into ceit_connect_private.activity_log_backup_rows (
    backup_id, file_id, activity_id, activity_created_at
  )
  select p_backup_id, v_file, log_row.id, log_row.created_at
  from public.activity_log as log_row
  where log_row.id = any(p_activity_ids);
  return query select v_file, v_path, v_part;
end;
$$;

alter function public.reserve_activity_log_backup_file(uuid, uuid, uuid[])
owner to postgres;
revoke all on function public.reserve_activity_log_backup_file(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.reserve_activity_log_backup_file(uuid, uuid, uuid[])
to anon;

create function public.verify_activity_log_backup_file(
  p_file_id uuid,
  p_backup_id uuid,
  p_lease_token uuid,
  p_raw_byte_count integer,
  p_sha256_hex text,
  p_file_bytes_base64 text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_path text;
  v_file_bytes bytea;
  v_storage_size bigint;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  if p_backup_id is null or p_lease_token is null or not exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.id = p_backup_id and backup.status = 'snapshotting'
      and backup.lease_token = p_lease_token
      and backup.lease_expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  select file_row.object_path into v_path
  from ceit_connect_private.activity_log_backup_files as file_row
  join ceit_connect_private.activity_log_backups as backup on backup.id = file_row.backup_id
  where file_row.id = p_file_id and file_row.backup_id = p_backup_id
    and file_row.status = 'reserved' and backup.status = 'snapshotting'
    and backup.lease_token = p_lease_token
    and backup.lease_expires_at > pg_catalog.clock_timestamp()
  for update of backup, file_row;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  if p_raw_byte_count is null or p_raw_byte_count not between 1 and 5242880
     or p_sha256_hex is null or p_sha256_hex !~ '^[0-9a-f]{64}$'
     or p_file_bytes_base64 is null then
    raise exception using errcode = '22023', message = 'Activity Log backup verification is invalid.';
  end if;
  begin
    v_file_bytes := pg_catalog.decode(p_file_bytes_base64, 'base64');
  exception when others then
    raise exception using errcode = '22023', message = 'Activity Log backup verification is invalid.';
  end;
  if pg_catalog.octet_length(v_file_bytes) <> p_raw_byte_count
     or pg_catalog.encode(extensions.digest(v_file_bytes, 'sha256'), 'hex') <> p_sha256_hex then
    raise exception using errcode = '22023', message = 'Activity Log backup verification is invalid.';
  end if;
  select (object_row.metadata ->> 'size')::bigint into v_storage_size
  from storage.objects as object_row
  where object_row.bucket_id = 'activity-log-backups'
    and object_row.name = v_path;
  if not found or v_storage_size is distinct from p_raw_byte_count then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup upload could not be verified.';
  end if;
  insert into ceit_connect_private.activity_log_backup_file_payloads (
    file_id, file_bytes
  ) values (
    p_file_id, v_file_bytes
  );
  update ceit_connect_private.activity_log_backup_files as file_row
  set status = 'verified', raw_byte_count = p_raw_byte_count,
      sha256_hex = p_sha256_hex, verified_at = pg_catalog.clock_timestamp()
  where file_row.id = p_file_id;
  update ceit_connect_private.activity_log_backups as backup
  set file_count = backup.file_count + 1,
      row_count = backup.row_count + file_row.row_count,
      attempt_count = 0,
      next_attempt_at = pg_catalog.clock_timestamp(),
      last_error_code = null
  from ceit_connect_private.activity_log_backup_files as file_row
  where backup.id = p_backup_id and file_row.id = p_file_id;
  return true;
end;
$$;

alter function public.verify_activity_log_backup_file(uuid, uuid, uuid, integer, text, text)
owner to postgres;
revoke all on function public.verify_activity_log_backup_file(uuid, uuid, uuid, integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.verify_activity_log_backup_file(uuid, uuid, uuid, integer, text, text)
to anon;

create function public.complete_activity_log_backup_snapshot(
  p_backup_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_generation bigint; v_kind text; v_cutoff timestamptz;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  select backup.kind, backup.fixed_cutoff_at into v_kind, v_cutoff
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.status = 'snapshotting'
    and backup.lease_token = p_lease_token
    and backup.lease_expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  if exists (
    select 1 from ceit_connect_private.activity_log_backup_files as file_row
    where file_row.backup_id = p_backup_id and file_row.status <> 'verified'
  ) or exists (
    select 1 from public.activity_log as log_row
    where log_row.created_at < v_cutoff
      and not exists (
        select 1 from ceit_connect_private.activity_log_backup_rows as covered
        where covered.backup_id = p_backup_id and covered.activity_id = log_row.id
      )
  ) then return false; end if;
  update ceit_connect_private.activity_log_backups as backup
  set status = case when v_kind = 'monthly_retention' then 'deleting' else 'ready' end,
      snapshot_completed_at = pg_catalog.clock_timestamp(),
      delete_expires_at = case when v_kind = 'monthly_retention' then null
        else pg_catalog.clock_timestamp() + interval '30 minutes' end,
      attempt_count = 0,
      next_attempt_at = pg_catalog.clock_timestamp(),
      last_error_code = null,
      lease_token = null, lease_expires_at = null,
      completed_at = case when backup.row_count = 0 then pg_catalog.clock_timestamp() else null end
  where backup.id = p_backup_id;
  if not exists (
    select 1 from ceit_connect_private.activity_log_backup_rows as covered
    where covered.backup_id = p_backup_id
  ) then
    update ceit_connect_private.activity_log_backups as backup
    set status = 'completed' where backup.id = p_backup_id;
  end if;
  return true;
end;
$$;

alter function public.complete_activity_log_backup_snapshot(uuid, uuid) owner to postgres;
revoke all on function public.complete_activity_log_backup_snapshot(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.complete_activity_log_backup_snapshot(uuid, uuid)
to anon;

create function ceit_connect_private.delete_activity_log_backup_manifest_batch(
  p_backup_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_backup ceit_connect_private.activity_log_backups%rowtype; v_deleted integer := 0;
begin
  select backup.* into v_backup
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.status = 'deleting'
  for update;
  if not found
     or exists (
       select 1 from ceit_connect_private.activity_log_backup_files as file_row
       where file_row.backup_id = p_backup_id and file_row.status <> 'verified'
     )
     or not exists (
       select 1 from ceit_connect_private.activity_log_backup_files as file_row
       where file_row.backup_id = p_backup_id
     ) then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup is not ready for deletion.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.activity_log_purger', 'purge_activity_log', true
  );
  with victims as materialized (
    select manifest.activity_id
    from ceit_connect_private.activity_log_backup_rows as manifest
    join ceit_connect_private.activity_log_backup_files as file_row
      on file_row.id = manifest.file_id and file_row.status = 'verified'
    where manifest.backup_id = p_backup_id and manifest.deleted_at is null
    order by manifest.activity_created_at, manifest.activity_id
    limit 5000
    for update of manifest skip locked
  ), deleted as (
    delete from public.activity_log as log_row
    using victims
    where log_row.id = victims.activity_id
    returning log_row.id
  )
  update ceit_connect_private.activity_log_backup_rows as manifest
  set deleted_at = pg_catalog.clock_timestamp()
  where manifest.backup_id = p_backup_id
    and manifest.activity_id in (select deleted.id from deleted);
  get diagnostics v_deleted = row_count;
  perform pg_catalog.set_config('ceit_connect.activity_log_purger', '', true);

  -- Rows may already be absent only after a previously committed retry. Mark
  -- those exact manifest IDs settled without widening deletion authority.
  update ceit_connect_private.activity_log_backup_rows as manifest
  set deleted_at = pg_catalog.clock_timestamp()
  where manifest.backup_id = p_backup_id and manifest.deleted_at is null
    and not exists (
      select 1 from public.activity_log as log_row where log_row.id = manifest.activity_id
    );

  update ceit_connect_private.activity_log_backups as backup
  set deleted_count = deleted_count + v_deleted
  where backup.id = p_backup_id;

  if not exists (
    select 1 from ceit_connect_private.activity_log_backup_rows as manifest
    where manifest.backup_id = p_backup_id and manifest.deleted_at is null
  ) then
    update ceit_connect_private.activity_log_backups as backup
    set status = case when backup.deleted_count > 0 then 'email_pending' else 'completed' end,
        deletion_completed_at = pg_catalog.clock_timestamp(),
        completed_at = case when backup.deleted_count > 0 then null else pg_catalog.clock_timestamp() end,
        attempt_count = 0,
        next_attempt_at = pg_catalog.clock_timestamp(),
        last_error_code = null,
        lease_token = null, lease_expires_at = null
    where backup.id = p_backup_id
    returning backup.* into v_backup;
    if v_backup.kind in ('manual_before_date', 'manual_all') then
      perform ceit_connect_private.write_activity(
        'activity_log_cleared', 'user', v_backup.deletion_requested_by,
        null, null, v_backup.deletion_requested_by, null, null,
        pg_catalog.jsonb_build_object(
          'count', v_backup.deleted_count,
          'backup_id', v_backup.id,
          'cutoff_at', v_backup.fixed_cutoff_at
        )
      );
    end if;
  end if;
  return v_deleted;
exception when others then
  perform pg_catalog.set_config('ceit_connect.activity_log_purger', '', true);
  raise;
end;
$$;

alter function ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)
owner to postgres;
revoke all on function ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)
from public, anon, authenticated, service_role;

create function public.run_activity_log_backup_delete_batch(
  p_backup_id uuid,
  p_lease_token uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_deleted integer;
  v_backup ceit_connect_private.activity_log_backups%rowtype;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  select backup.* into v_backup
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.status = 'deleting'
  for update;
  if not found
     or v_backup.lease_token is distinct from p_lease_token
     or v_backup.lease_expires_at is null
     or v_backup.lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  v_deleted := ceit_connect_private.delete_activity_log_backup_manifest_batch(p_backup_id);
  update ceit_connect_private.activity_log_backups as backup
  set attempt_count = 0,
      next_attempt_at = pg_catalog.clock_timestamp(),
      last_error_code = null
  where backup.id = p_backup_id and backup.status = 'deleting';
  return v_deleted;
end;
$$;

alter function public.run_activity_log_backup_delete_batch(uuid, uuid) owner to postgres;
revoke all on function public.run_activity_log_backup_delete_batch(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.run_activity_log_backup_delete_batch(uuid, uuid)
to anon;

create function public.prepare_activity_log_backup_email(
  p_backup_id uuid,
  p_lease_token uuid
)
returns table (
  out_recipients text[],
  out_file_ids uuid[],
  out_object_paths text[],
  out_filenames text[]
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_generation bigint; v_backup ceit_connect_private.activity_log_backups%rowtype;
  v_recipient_id uuid;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  select backup.* into v_backup
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.status = 'email_pending'
    and backup.lease_token = p_lease_token
    and backup.lease_expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  v_recipient_id := case when v_backup.kind = 'monthly_retention'
    then v_backup.policy_setter_id else v_backup.deletion_requested_by end;
  return query
  with preferred as (
    select pg_catalog.lower(pg_catalog.btrim(auth_user.email)) as email
    from public.users as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_recipient_id and profile.is_active and profile.role = 'Admin'
      and profile.anonymized_at is null and auth_user.email_confirmed_at is not null
      and auth_user.email is not null
      and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
          pg_catalog.lower(pg_catalog.btrim(profile.email))
  ), recipients as (
    select preferred.email from preferred
    union all
    select pg_catalog.lower(pg_catalog.btrim(auth_user.email))
    from public.users as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where not exists (select 1 from preferred)
      and profile.is_active and profile.role = 'Admin'
      and profile.anonymized_at is null and auth_user.email_confirmed_at is not null
      and auth_user.email is not null
      and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
          pg_catalog.lower(pg_catalog.btrim(profile.email))
  ), files as (
    select file_row.id, file_row.object_path,
      pg_catalog.regexp_replace(file_row.object_path, '^.*/', '') as filename,
      file_row.part_number
    from ceit_connect_private.activity_log_backup_files as file_row
    where file_row.backup_id = p_backup_id and file_row.status = 'verified'
    order by file_row.part_number
  )
  select
    (select pg_catalog.array_agg(recipient.email order by recipient.email) from recipients as recipient),
    (select pg_catalog.array_agg(file_row.id order by file_row.part_number) from files as file_row),
    (select pg_catalog.array_agg(file_row.object_path order by file_row.part_number) from files as file_row),
    (select pg_catalog.array_agg(file_row.filename order by file_row.part_number) from files as file_row);
end;
$$;

alter function public.prepare_activity_log_backup_email(uuid, uuid) owner to postgres;
revoke all on function public.prepare_activity_log_backup_email(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_activity_log_backup_email(uuid, uuid)
to anon;

create function public.read_activity_log_backup_file_payload(
  p_backup_id uuid,
  p_file_id uuid,
  p_lease_token uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_file_bytes_base64 text;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  select pg_catalog.encode(payload.file_bytes, 'base64')
  into v_file_bytes_base64
  from ceit_connect_private.activity_log_backups as backup
  join ceit_connect_private.activity_log_backup_files as file_row
    on file_row.backup_id = backup.id
  join ceit_connect_private.activity_log_backup_file_payloads as payload
    on payload.file_id = file_row.id
  where backup.id = p_backup_id and backup.status = 'email_pending'
    and backup.lease_token = p_lease_token
    and backup.lease_expires_at > pg_catalog.clock_timestamp()
    and file_row.id = p_file_id and file_row.status = 'verified'
  for update of backup;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup file is unavailable.';
  end if;
  return v_file_bytes_base64;
end;
$$;

alter function public.read_activity_log_backup_file_payload(uuid, uuid, uuid)
owner to postgres;
revoke all on function public.read_activity_log_backup_file_payload(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.read_activity_log_backup_file_payload(uuid, uuid, uuid)
to anon;

create function public.acknowledge_activity_log_backup_email(
  p_backup_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_http_status integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_generation bigint; v_attempts integer;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;
  if p_outcome is null
     or p_outcome not in ('success', 'transient', 'permanent')
     or (p_http_status is not null and p_http_status not between 100 and 599) then
    raise exception using errcode = '22023', message = 'Activity Log backup email acknowledgement is invalid.';
  end if;
  select backup.email_attempt_count into v_attempts
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.status = 'email_pending'
    and backup.lease_token = p_lease_token
  for update;
  if not found then
    raise exception using errcode = 'CAL05', message = 'The Activity Log backup lease is unavailable.';
  end if;
  update ceit_connect_private.activity_log_backups as backup
  set email_attempt_count = email_attempt_count + 1,
      email_http_status = p_http_status,
      status = case
        when p_outcome = 'success' then 'completed'
        when p_outcome = 'permanent' or v_attempts + 1 >= 5 then 'email_failed'
        else 'email_pending'
      end,
      next_attempt_at = case
        when p_outcome = 'transient' and v_attempts + 1 < 5 then
          pg_catalog.clock_timestamp() + case v_attempts + 1
            when 1 then interval '5 minutes'
            when 2 then interval '15 minutes'
            when 3 then interval '60 minutes'
            else interval '240 minutes'
          end
        else pg_catalog.clock_timestamp()
      end,
      last_error_code = case when p_outcome = 'success' then null else 'email_delivery_failed' end,
      email_sent_at = case when p_outcome = 'success' then pg_catalog.clock_timestamp() else null end,
      completed_at = case when p_outcome = 'success' then pg_catalog.clock_timestamp() else backup.completed_at end,
      lease_token = null, lease_expires_at = null
  where backup.id = p_backup_id;
  return true;
end;
$$;

alter function public.acknowledge_activity_log_backup_email(uuid, uuid, text, integer)
owner to postgres;
revoke all on function public.acknowledge_activity_log_backup_email(uuid, uuid, text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_activity_log_backup_email(uuid, uuid, text, integer)
to anon;

create function public.release_activity_log_backup_lease(
  p_backup_id uuid,
  p_lease_token uuid,
  p_error_code text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_backup ceit_connect_private.activity_log_backups%rowtype;
  v_attempts integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Activity Log backup worker authentication failed.';
  end if;

  select backup.* into v_backup
  from ceit_connect_private.activity_log_backups as backup
  where backup.id = p_backup_id and backup.lease_token = p_lease_token
  for update;
  if not found then return false; end if;

  if v_backup.status = 'email_pending' then
    v_attempts := v_backup.email_attempt_count + 1;
    update ceit_connect_private.activity_log_backups as backup
    set email_attempt_count = v_attempts,
        status = case when v_attempts >= 5 then 'email_failed' else 'email_pending' end,
        next_attempt_at = case when v_attempts >= 5 then v_now else
          v_now + case v_attempts
            when 1 then interval '5 minutes'
            when 2 then interval '15 minutes'
            when 3 then interval '60 minutes'
            else interval '240 minutes'
          end
        end,
        last_error_code = 'email_delivery_failed',
        lease_token = null,
        lease_expires_at = null
    where backup.id = p_backup_id;
  elsif v_backup.status in ('pending', 'snapshotting') then
    v_attempts := v_backup.attempt_count + 1;
    update ceit_connect_private.activity_log_backups as backup
    set attempt_count = v_attempts,
        status = case
          when v_attempts >= 5 or backup.created_at <= v_now - interval '24 hours'
            then 'failed'
          else backup.status
        end,
        next_attempt_at = case
          when v_attempts >= 5 or backup.created_at <= v_now - interval '24 hours'
            then v_now
          else v_now + case v_attempts
            when 1 then interval '5 minutes'
            when 2 then interval '15 minutes'
            when 3 then interval '60 minutes'
            else interval '240 minutes'
          end
        end,
        last_error_code = case
          when backup.created_at <= v_now - interval '24 hours' then 'snapshot_expired'
          when v_attempts >= 5 then 'snapshot_attempts_exhausted'
          else 'snapshot_retry_pending'
        end,
        completed_at = case
          when v_attempts >= 5 or backup.created_at <= v_now - interval '24 hours'
            then v_now
          else backup.completed_at
        end,
        lease_token = null,
        lease_expires_at = null
    where backup.id = p_backup_id;
  elsif v_backup.status in ('deletion_requested', 'deleting') then
    v_attempts := v_backup.attempt_count + 1;
    update ceit_connect_private.activity_log_backups as backup
    set attempt_count = v_attempts,
        next_attempt_at = v_now + case (
          case when v_attempts > 4 then 4 else v_attempts end
        )
          when 1 then interval '5 minutes'
          when 2 then interval '15 minutes'
          when 3 then interval '60 minutes'
          else interval '240 minutes'
        end,
        last_error_code = 'deletion_retry_pending',
        lease_token = null,
        lease_expires_at = null
    where backup.id = p_backup_id;
  else
    update ceit_connect_private.activity_log_backups as backup
    set lease_token = null, lease_expires_at = null
    where backup.id = p_backup_id;
  end if;
  return true;
end;
$$;

alter function public.release_activity_log_backup_lease(uuid, uuid, text) owner to postgres;
revoke all on function public.release_activity_log_backup_lease(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.release_activity_log_backup_lease(uuid, uuid, text)
to anon;

create function ceit_connect_private.request_activity_log_backup_kick_if_due()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_url_name text; v_wake_name text; v_url text; v_wake_secret text;
  v_request_id bigint;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  perform ceit_connect_private.fail_stale_activity_log_snapshots();
  if not exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.status in ('pending', 'snapshotting', 'deletion_requested', 'deleting', 'email_pending')
      and (backup.lease_expires_at is null or backup.lease_expires_at <= pg_catalog.clock_timestamp())
      and backup.next_attempt_at <= pg_catalog.clock_timestamp()
  ) then return false; end if;
  select config.kick_url_secret_name, config.wake_secret_name
  into v_url_name, v_wake_name
  from ceit_connect_private.email_delivery_config as config where config.singleton;
  select secret.decrypted_secret into v_url
  from vault.decrypted_secrets as secret where secret.name = v_url_name;
  select secret.decrypted_secret into v_wake_secret
  from vault.decrypted_secrets as secret where secret.name = v_wake_name;
  if coalesce(v_url, '') = '' or coalesce(v_wake_secret, '') = '' then return false; end if;
  select net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'content-type', 'application/json',
      'x-ceit-email-wake-secret', v_wake_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_request_id;
  update ceit_connect_private.email_kick_state
  set last_requested_at = pg_catalog.clock_timestamp(),
      request_count = request_count + 1,
      last_request_id = v_request_id
  where singleton;
  return true;
exception when others then
  begin
    update ceit_connect_private.email_kick_state
    set last_error_at = pg_catalog.clock_timestamp(), error_count = error_count + 1
    where singleton;
  exception when others then null;
  end;
  return false;
end;
$$;

alter function ceit_connect_private.request_activity_log_backup_kick_if_due()
owner to postgres;
revoke all on function ceit_connect_private.request_activity_log_backup_kick_if_due()
from public, anon, authenticated, service_role;

create function ceit_connect_private.request_email_and_activity_backup_kicks_if_due()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_email_requested boolean;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  v_email_requested := ceit_connect_private.request_email_kick_if_due();
  if v_email_requested then return true; end if;
  return ceit_connect_private.request_activity_log_backup_kick_if_due();
end;
$$;

alter function ceit_connect_private.request_email_and_activity_backup_kicks_if_due()
owner to postgres;
revoke all on function ceit_connect_private.request_email_and_activity_backup_kicks_if_due()
from public, anon, authenticated, service_role;

comment on function ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid) is
  'Sole Batch E2 deletion authority: private, ungranted, all-files-verified, exact-manifest, and at most 5,000 rows per statement.';
