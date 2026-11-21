-- Batch E2: private Activity Log backup storage, permanent history, and
-- fail-safe retirement of the unbacked purge path.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch E2 foundation must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'activity-log-backups',
  'activity-log-backups',
  false,
  5242880,
  array['text/csv']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['text/csv']::text[];

create table ceit_connect_private.activity_log_backups (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'monthly_retention', 'manual_before_date', 'manual_all'
  )),
  status text not null default 'pending' check (status in (
    'pending', 'snapshotting', 'ready', 'deletion_requested', 'deleting',
    'email_pending', 'completed', 'email_failed', 'failed'
  )),
  cycle_month date,
  fixed_cutoff_at timestamptz not null,
  retention_days integer check (
    retention_days is null or retention_days between 30 and 730
  ),
  policy_setter_id uuid,
  requested_by uuid,
  deletion_requested_by uuid,
  delete_expires_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  file_count integer not null default 0 check (file_count >= 0),
  row_count integer not null default 0 check (row_count >= 0),
  deleted_count integer not null default 0 check (deleted_count >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  email_attempt_count integer not null default 0 check (email_attempt_count >= 0),
  email_http_status integer check (
    email_http_status is null or email_http_status between 100 and 599
  ),
  last_error_code text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  snapshot_completed_at timestamptz,
  deletion_completed_at timestamptz,
  email_sent_at timestamptz,
  completed_at timestamptz,
  check ((lease_token is null) = (lease_expires_at is null)),
  check (
    (kind = 'monthly_retention' and cycle_month is not null
      and retention_days is not null and requested_by is null)
    or
    (kind in ('manual_before_date', 'manual_all') and cycle_month is null
      and retention_days is null and requested_by is not null)
  )
);

alter table ceit_connect_private.activity_log_backups owner to postgres;
alter table ceit_connect_private.activity_log_backups enable row level security;
revoke all on table ceit_connect_private.activity_log_backups
from public, anon, authenticated, service_role;

create unique index activity_log_backups_cycle_month_key
on ceit_connect_private.activity_log_backups (cycle_month)
where kind = 'monthly_retention';

create unique index activity_log_backups_one_active_key
on ceit_connect_private.activity_log_backups ((true))
where status in (
  'pending', 'snapshotting', 'ready', 'deletion_requested', 'deleting',
  'email_pending'
);

create table ceit_connect_private.activity_log_backup_files (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null references ceit_connect_private.activity_log_backups(id)
    on delete restrict,
  part_number integer not null check (part_number > 0),
  object_path text not null unique,
  status text not null default 'reserved' check (status in ('reserved', 'verified')),
  reservation_expires_at timestamptz not null,
  row_count integer not null check (row_count between 1 and 5000),
  raw_byte_count integer check (raw_byte_count is null or raw_byte_count between 1 and 5242880),
  sha256_hex text check (sha256_hex is null or sha256_hex ~ '^[0-9a-f]{64}$'),
  first_created_at timestamptz not null,
  first_activity_id uuid not null,
  last_created_at timestamptz not null,
  last_activity_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  verified_at timestamptz,
  unique (backup_id, part_number),
  check (
    (status = 'reserved' and raw_byte_count is null and sha256_hex is null and verified_at is null)
    or
    (status = 'verified' and raw_byte_count is not null and sha256_hex is not null and verified_at is not null)
  )
);

alter table ceit_connect_private.activity_log_backup_files owner to postgres;
alter table ceit_connect_private.activity_log_backup_files enable row level security;
revoke all on table ceit_connect_private.activity_log_backup_files
from public, anon, authenticated, service_role;

create table ceit_connect_private.activity_log_backup_file_payloads (
  file_id uuid primary key
    references ceit_connect_private.activity_log_backup_files(id) on delete cascade,
  file_bytes bytea not null check (
    pg_catalog.octet_length(file_bytes) between 1 and 5242880
  )
);

alter table ceit_connect_private.activity_log_backup_file_payloads owner to postgres;
alter table ceit_connect_private.activity_log_backup_file_payloads enable row level security;
revoke all on table ceit_connect_private.activity_log_backup_file_payloads
from public, anon, authenticated, service_role;

create table ceit_connect_private.activity_log_backup_rows (
  backup_id uuid not null references ceit_connect_private.activity_log_backups(id)
    on delete restrict,
  file_id uuid not null references ceit_connect_private.activity_log_backup_files(id)
    on delete restrict,
  activity_id uuid not null,
  activity_created_at timestamptz not null,
  deleted_at timestamptz,
  primary key (backup_id, activity_id),
  unique (file_id, activity_id)
);

alter table ceit_connect_private.activity_log_backup_rows owner to postgres;
alter table ceit_connect_private.activity_log_backup_rows enable row level security;
revoke all on table ceit_connect_private.activity_log_backup_rows
from public, anon, authenticated, service_role;

create index activity_log_backup_rows_delete_idx
on ceit_connect_private.activity_log_backup_rows (backup_id, activity_created_at, activity_id)
where deleted_at is null;

create table ceit_connect_private.activity_log_backup_downloads (
  backup_id uuid not null references ceit_connect_private.activity_log_backups(id)
    on delete restrict,
  file_id uuid not null references ceit_connect_private.activity_log_backup_files(id)
    on delete restrict,
  admin_id uuid not null,
  downloaded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (file_id, admin_id)
);

alter table ceit_connect_private.activity_log_backup_downloads owner to postgres;
alter table ceit_connect_private.activity_log_backup_downloads enable row level security;
revoke all on table ceit_connect_private.activity_log_backup_downloads
from public, anon, authenticated, service_role;

insert into ceit_connect_private.activity_type_catalog (
  activity_type, broad_action, subject_kind, audience, summary_text,
  allowed_payload_keys
)
values
  (
    'activity_log_retention_changed', 'UPDATE', 'person', 'leadership',
    'Activity Log retention changed', array['old_days', 'new_days']
  ),
  (
    'activity_log_cleared', 'DELETE', 'person', 'leadership',
    'Activity Log cleared', array['count', 'backup_id', 'cutoff_at']
  );

create or replace function public.set_activity_log_retention_days(
  p_retention_days integer
)
returns table (
  retention_days integer,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_setting ceit_connect_private.activity_log_settings%rowtype;
  v_old_days integer;
begin
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active
      and profile.role = 'Admin'
  ) then
    raise exception using
      errcode = 'CAL04',
      message = 'Activity Log administration is unavailable.';
  end if;

  if p_retention_days is null or p_retention_days not between 30 and 730 then
    raise exception using
      errcode = 'CAL02',
      message = 'The Activity Log retention value is invalid.';
  end if;

  select setting.* into v_setting
  from ceit_connect_private.activity_log_settings as setting
  where setting.singleton
  for update;

  if not found then
    raise exception using
      errcode = 'CAL05',
      message = 'The Activity Log retention setting is unavailable.';
  end if;

  if v_setting.retention_days is distinct from p_retention_days then
    v_old_days := v_setting.retention_days;
    update ceit_connect_private.activity_log_settings as setting
    set retention_days = p_retention_days,
        updated_at = pg_catalog.clock_timestamp(),
        updated_by = v_caller_id
    where setting.singleton
    returning setting.* into v_setting;

    perform ceit_connect_private.write_activity(
      'activity_log_retention_changed',
      'user',
      v_caller_id,
      null,
      null,
      v_caller_id,
      null,
      null,
      pg_catalog.jsonb_build_object(
        'old_days', v_old_days,
        'new_days', p_retention_days
      )
    );
  end if;

  return query
  select v_setting.retention_days, v_setting.updated_at, v_setting.updated_by;
end;
$$;

alter function public.set_activity_log_retention_days(integer) owner to postgres;
revoke all on function public.set_activity_log_retention_days(integer)
from public, anon, authenticated, service_role;
grant execute on function public.set_activity_log_retention_days(integer)
to authenticated;

create or replace function public.purge_activity_log()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if session_user <> 'postgres' then
    raise exception using
      errcode = 'CAL03',
      message = 'Activity log retention must run as postgres.';
  end if;
  return 0;
end;
$$;

alter function public.purge_activity_log() owner to postgres;
revoke all on function public.purge_activity_log()
from public, anon, authenticated, service_role;

create function public.is_active_activity_log_backup_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users as profile
    where profile.id = auth.uid()
      and profile.is_active
      and profile.role = 'Admin'
  );
$$;

alter function public.is_active_activity_log_backup_admin() owner to postgres;
revoke all on function public.is_active_activity_log_backup_admin()
from public, anon, authenticated, service_role;
grant execute on function public.is_active_activity_log_backup_admin()
to authenticated;

create function public.can_upload_activity_log_backup_object(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from ceit_connect_private.activity_log_backup_files as file_row
    join ceit_connect_private.activity_log_backups as backup
      on backup.id = file_row.backup_id
    where file_row.object_path = p_object_path
      and file_row.status = 'reserved'
      and file_row.reservation_expires_at > pg_catalog.clock_timestamp()
      and backup.status = 'snapshotting'
      and backup.lease_expires_at > pg_catalog.clock_timestamp()
  );
$$;

alter function public.can_upload_activity_log_backup_object(text) owner to postgres;
revoke all on function public.can_upload_activity_log_backup_object(text)
from public, anon, authenticated, service_role;
grant execute on function public.can_upload_activity_log_backup_object(text)
to anon;

create policy "Activity backup worker can upload reserved CSV"
on storage.objects for insert
to anon
with check (
  bucket_id = 'activity-log-backups'
  and public.can_upload_activity_log_backup_object(name)
);

create policy "Active Admins can read Activity Log backups"
on storage.objects for select
to authenticated
using (
  bucket_id = 'activity-log-backups'
  and public.is_active_activity_log_backup_admin()
);

comment on table ceit_connect_private.activity_log_backups is
  'Permanent Admin-only backup and clearing history. No event, task, or user foreign keys.';
comment on function public.purge_activity_log() is
  'Fail-safe retired entry point. Deletion authority moved to the manifest-checked private Batch E2 function.';
