# Batch E step 2 — Activity Log backup and clearing tests

Run with RLS disabled in Dev SQL Editor. The behavior paste is rollback-safe.

## Catalog paste

```sql
select
  (select public from storage.buckets where id = 'activity-log-backups') is false
    as private_bucket,
  (select file_size_limit from storage.buckets where id = 'activity-log-backups') = 5242880
    as five_mib_cap,
  (select pg_catalog.count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and pg_catalog.concat_ws(' ', qual, with_check)
        like '%activity-log-backups%') = 2 as exact_storage_policies,
  (select class.relrowsecurity
   from pg_class as class
   join pg_namespace as namespace on namespace.oid = class.relnamespace
   where namespace.nspname = 'ceit_connect_private'
     and class.relname = 'activity_log_backup_file_payloads') is true
    as payload_rls_enabled,
  not has_table_privilege(
    'anon', 'ceit_connect_private.activity_log_backup_file_payloads',
    'SELECT,INSERT,UPDATE,DELETE'
  ) as payload_denied_to_anon,
  not has_table_privilege(
    'authenticated', 'ceit_connect_private.activity_log_backup_file_payloads',
    'SELECT,INSERT,UPDATE,DELETE'
  ) as payload_denied_to_authenticated,
  not has_table_privilege(
    'service_role', 'ceit_connect_private.activity_log_backup_file_payloads',
    'SELECT,INSERT,UPDATE,DELETE'
  ) as payload_denied_to_service_role,
  not exists (
    select 1 from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where pg_catalog.strpos(procedure.prosrc, 'set_config') > 0
      and pg_catalog.strpos(
        procedure.prosrc, 'ceit_connect.activity_log_purger'
      ) > 0
      and not (
        namespace.nspname = 'ceit_connect_private'
        and procedure.proname = 'delete_activity_log_backup_manifest_batch'
      )
  ) as sole_marker_setter,
  not has_function_privilege(
    'anon',
    'ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)',
    'EXECUTE'
  ) as private_delete_not_anon,
  not has_function_privilege(
    'authenticated',
    'ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)',
    'EXECUTE'
  ) as private_delete_not_authenticated,
  not has_function_privilege(
    'service_role',
    'ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)',
    'EXECUTE'
  ) as private_delete_not_service_role,
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef('public.claim_activity_log_backup()'::regprocedure),
    'backup.next_attempt_at <= v_now'
  ) > 0 as claim_respects_retry_spacing,
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'ceit_connect_private.request_activity_log_backup_kick_if_due()'::regprocedure
    ),
    'backup.next_attempt_at <= pg_catalog.clock_timestamp()'
  ) > 0 as kick_respects_retry_spacing,
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.acknowledge_activity_log_backup_email(uuid,uuid,text,integer)'::regprocedure
    ),
    'interval ''240 minutes'''
  ) > 0 as email_has_240_minute_spacing,
  pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'activity_log_retention_changed'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'activity_log_cleared'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'old_days'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'new_days'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'count'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'backup_id'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (
        select constraint_row.oid
        from pg_catalog.pg_constraint as constraint_row
        where constraint_row.conrelid = 'public.activity_log'::regclass
          and constraint_row.conname = 'activity_log_person_payload_check'
      )
    ),
    'cutoff_at'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_constraintdef(
        (
          select constraint_row.oid
          from pg_catalog.pg_constraint as constraint_row
          where constraint_row.conrelid = 'public.activity_log'::regclass
            and constraint_row.conname = 'activity_log_person_payload_check'
        )
      ),
      '[[:space:]()]|::text', '', 'g'
    ),
    'changes-''old_days''-''new_days''=''{}''::jsonb'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.regexp_replace(
      pg_catalog.pg_get_constraintdef(
        (
          select constraint_row.oid
          from pg_catalog.pg_constraint as constraint_row
          where constraint_row.conrelid = 'public.activity_log'::regclass
            and constraint_row.conname = 'activity_log_person_payload_check'
        )
      ),
      '[[:space:]()]|::text', '', 'g'
    ),
    'changes-''count''-''backup_id''-''cutoff_at''=''{}''::jsonb'
  ) > 0 as person_payload_constraint_has_strict_backup_and_clearing_branches;

-- This result set must be empty. It reports broad anonymous/public read
-- policies that do not name a bucket boundary.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd in ('SELECT', 'ALL')
  and ('anon' = any(roles) or 'public' = any(roles))
  and pg_catalog.concat_ws(' ', qual, with_check) not like '%bucket_id%'
order by policyname;
```

## Rollback-safe behavior paste

This paste is self-contained and expects **66/66 PASS**. It creates its own
confirmed Auth identities and matching Admin, Co-Admin, and Member profiles,
plus its own committee, event, confidential task, backups, files, manifests,
and activity rows. It impersonates each application role for authenticated
cases. All assertions accumulate in a regular in-transaction results table;
individual expected failures are caught so the paste does not stop at the
first failed check. The final exception lists every failed label and rolls the
whole transaction back. Do not add an explicit `ROLLBACK`.

```sql
begin;
set local timezone = 'Asia/Manila';
set local statement_timeout = '180s';

create table ceit_connect_private.e2_test_results (
  label text primary key,
  passed boolean not null
);

do $$
begin
  if not pg_catalog.has_schema_privilege(
    'anon', 'ceit_connect_private', 'USAGE'
  ) then
    grant usage on schema ceit_connect_private to anon;
  end if;
  if not pg_catalog.has_schema_privilege(
    'authenticated', 'ceit_connect_private', 'USAGE'
  ) then
    grant usage on schema ceit_connect_private to authenticated;
  end if;
end;
$$;

create function ceit_connect_private.e2_test_record(
  p_label text,
  p_passed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ceit_connect_private.e2_test_results(label, passed)
  values (p_label, coalesce(p_passed, false))
  on conflict (label) do update
  set passed = excluded.passed;
end;
$$;
grant execute on function ceit_connect_private.e2_test_record(text, boolean)
to anon, authenticated;

create function public.e2_test_expect_error(
  p_label text,
  p_statement text,
  p_state text,
  p_message text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  execute p_statement;
  perform ceit_connect_private.e2_test_record(p_label, false);
exception when others then
  perform ceit_connect_private.e2_test_record(
    p_label,
    sqlstate = p_state and sqlerrm = p_message
  );
end;
$$;
grant execute on function public.e2_test_expect_error(text, text, text, text)
to anon, authenticated;

create function public.e2_test_expect_success(
  p_label text,
  p_statement text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  execute p_statement;
  perform ceit_connect_private.e2_test_record(p_label, true);
exception when others then
  perform ceit_connect_private.e2_test_record(p_label, false);
end;
$$;
grant execute on function public.e2_test_expect_success(text, text)
to authenticated;

create function public.e2_test_expect_true(
  p_label text,
  p_statement text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_result boolean;
begin
  execute p_statement into v_result;
  perform ceit_connect_private.e2_test_record(p_label, v_result is true);
exception when others then
  perform ceit_connect_private.e2_test_record(p_label, false);
end;
$$;
grant execute on function public.e2_test_expect_true(text, text)
to anon, authenticated;

create function public.e2_test_try(p_statement text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  execute p_statement;
  return true;
exception when others then
  return false;
end;
$$;
grant execute on function public.e2_test_try(text) to authenticated;

create function public.e2_test_activity_backup_object_count()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare v_count bigint;
begin
  select pg_catalog.count(*) into v_count
  from storage.objects as object_row
  where object_row.bucket_id = 'activity-log-backups';
  return v_count;
exception when others then
  return -1;
end;
$$;
grant execute on function public.e2_test_activity_backup_object_count()
to anon, authenticated;

create function public.e2_test_expect_capability_denial(
  p_label text,
  p_statement text,
  p_procedure regprocedure
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text := pg_catalog.lower(pg_catalog.pg_get_functiondef(p_procedure));
  v_auth_position integer;
  v_sensitive_position integer := 2147483647;
  v_position integer;
  v_token text;
begin
  foreach v_token in array array[
    'for update',
    'delete from',
    'insert into ceit_connect_private',
    'update ceit_connect_private'
  ] loop
    v_position := pg_catalog.strpos(v_body, v_token);
    if v_position > 0 and v_position < v_sensitive_position then
      v_sensitive_position := v_position;
    end if;
  end loop;
  v_auth_position := pg_catalog.strpos(v_body, 'authenticate_email_sender()');

  execute p_statement;
  perform ceit_connect_private.e2_test_record(p_label, false);
exception when others then
  perform ceit_connect_private.e2_test_record(
    p_label,
    sqlstate = '42501'
    and sqlerrm = 'Activity Log backup worker authentication failed.'
    and v_auth_position > 0
    and v_auth_position < v_sensitive_position
  );
end;
$$;
grant execute on function public.e2_test_expect_capability_denial(
  text, text, regprocedure
) to anon;

create function public.e2_test_recipient_resolution(
  p_label text,
  p_backup_id uuid,
  p_lease_token uuid,
  p_expected text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_actual text;
begin
  select pg_catalog.array_to_string(prepared.out_recipients, ',')
  into v_actual
  from public.prepare_activity_log_backup_email(
    p_backup_id, p_lease_token
  ) as prepared;
  perform ceit_connect_private.e2_test_record(
    p_label, v_actual is not distinct from p_expected
  );
exception when others then
  perform ceit_connect_private.e2_test_record(p_label, false);
end;
$$;
grant execute on function public.e2_test_recipient_resolution(
  text, uuid, uuid, text
) to anon;

create function public.e2_test_confidential_masking(
  p_label text,
  p_backup_id uuid,
  p_lease_token uuid,
  p_activity_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_passed boolean;
begin
  select exists (
    select 1
    from public.list_activity_log_backup_candidates(
      p_backup_id, p_lease_token, 5000
    ) as candidate
    where candidate.activity_id = p_activity_id
      and candidate.task_title = 'Confidential Task'
      and candidate.event_name is null
      and candidate.committee_name is null
      and candidate.actor_name is null
      and candidate.change_summary = 'Confidential Task activity'
      and pg_catalog.concat_ws(
        '|', candidate.task_title, candidate.event_name,
        candidate.committee_name, candidate.actor_name,
        candidate.change_summary
      ) not like '%E2 RAW SECRET%'
  ) into v_passed;
  perform ceit_connect_private.e2_test_record(p_label, v_passed);
exception when others then
  perform ceit_connect_private.e2_test_record(p_label, false);
end;
$$;
grant execute on function public.e2_test_confidential_masking(
  text, uuid, uuid, uuid
) to anon;

-- Self-contained identity and task fixtures.
insert into public.committees(id, name) values
('92000000-0000-4000-8000-000000000001', 'E2 Test Committee');

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', email, '', pg_catalog.clock_timestamp(),
  '{}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from (values
  ('92000000-0000-4000-8000-000000000011'::uuid, 'e2-admin@test.local'),
  ('92000000-0000-4000-8000-000000000012'::uuid, 'e2-coadmin@test.local'),
  ('92000000-0000-4000-8000-000000000013'::uuid, 'e2-member@test.local'),
  ('92000000-0000-4000-8000-000000000014'::uuid, 'e2-backup-admin@test.local')
) as fixture(id, email);

select pg_catalog.set_config(
  'ceit_connect.officer_writer', 'invite_new_officer', true
);
insert into public.users(
  id, email, full_name, role, committee_id, is_active
) values
('92000000-0000-4000-8000-000000000011', 'e2-admin@test.local',
 'E2 Admin', 'Admin', null, true),
('92000000-0000-4000-8000-000000000012', 'e2-coadmin@test.local',
 'E2 Co-Admin', 'Co-Admin', '92000000-0000-4000-8000-000000000001', true),
('92000000-0000-4000-8000-000000000013', 'e2-member@test.local',
 'E2 Member', 'Member', '92000000-0000-4000-8000-000000000001', true),
('92000000-0000-4000-8000-000000000014', 'e2-backup-admin@test.local',
 'E2 Backup Admin', 'Admin', null, true);
select pg_catalog.set_config('ceit_connect.officer_writer', '', true);

-- Effective Storage access: one real object is invisible to anon, Co-Admin,
-- and Member application roles but visible to the active Admin. The insert is
-- transaction-local; do not delete directly from storage.objects.
insert into storage.objects(bucket_id, name, metadata) values (
  'activity-log-backups',
  'manual/92000000-0000-4000-8000-000000000011/e2-access-fixture-'
    || gen_random_uuid()::text || '.csv',
  pg_catalog.jsonb_build_object('size', 1, 'mimetype', 'text/csv')
);

set local role anon;
select pg_catalog.set_config(
  'e2.storage_anon_count',
  public.e2_test_activity_backup_object_count()::text,
  true
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000012","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_catalog.set_config(
  'e2.storage_coadmin_count',
  public.e2_test_activity_backup_object_count()::text,
  true
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000013","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_catalog.set_config(
  'e2.storage_member_count',
  public.e2_test_activity_backup_object_count()::text,
  true
);
reset role;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);
set local role authenticated;
select pg_catalog.set_config(
  'e2.storage_admin_count',
  public.e2_test_activity_backup_object_count()::text,
  true
);
reset role;

select ceit_connect_private.e2_test_record(
  '00 Storage effective read access matches roles',
  pg_catalog.current_setting('e2.storage_anon_count')::bigint = 0
  and pg_catalog.current_setting('e2.storage_coadmin_count')::bigint = 0
  and pg_catalog.current_setting('e2.storage_member_count')::bigint = 0
  and pg_catalog.current_setting('e2.storage_admin_count')::bigint > 0
);

set local session_replication_role = replica;
insert into public.events(
  id, name, start_date, end_date, status, created_by
) values (
  '92000000-0000-4000-8000-000000000101', 'E2 Test Event',
  current_date, current_date, 'Active',
  '92000000-0000-4000-8000-000000000011'
);
insert into public.tasks(
  id, event_id, committee_id, title, phase, status, priority, task_type,
  created_by, is_confidential, primary_assignees, assist_assignees,
  allowed_viewers, sort_order
) values (
  '92000000-0000-4000-8000-000000000201',
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000001',
  'E2 RAW SECRET TASK TITLE', 'Planning', 'To Do', 'Medium', 'Deliverable',
  '92000000-0000-4000-8000-000000000011', true,
  '{}'::uuid[], '{}'::uuid[], '{}'::uuid[], 1024
);
set local session_replication_role = origin;

-- Existing unfinished Dev rows are terminalized only inside this transaction
-- so the unique active slot cannot make the fixtures depend on Dev state.
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_isolation',
    completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where status in (
  'pending', 'snapshotting', 'ready', 'deletion_requested', 'deleting',
  'email_pending'
);

-- 01-09 plus 09b: every anon-granted worker function denies a missing capability with
-- the fixed text, and its body authenticates before its first lock/mutation.
select pg_catalog.set_config('request.headers', '{}'::jsonb::text, true);
set local role anon;
select public.e2_test_expect_capability_denial(
  '01 capability claim denied before lock',
  'select * from public.claim_activity_log_backup()',
  'public.claim_activity_log_backup()'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '02 capability candidates denied before lock',
  'select * from public.list_activity_log_backup_candidates(null,null,0)',
  'public.list_activity_log_backup_candidates(uuid,uuid,integer)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '03 capability reserve denied before lock',
  'select * from public.reserve_activity_log_backup_file(null,null,null)',
  'public.reserve_activity_log_backup_file(uuid,uuid,uuid[])'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '04 capability verify denied before lock',
  'select public.verify_activity_log_backup_file(null,null,null,null,null,null)',
  'public.verify_activity_log_backup_file(uuid,uuid,uuid,integer,text,text)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '05 capability complete denied before lock',
  'select public.complete_activity_log_backup_snapshot(null,null)',
  'public.complete_activity_log_backup_snapshot(uuid,uuid)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '06 capability deletion denied before lock',
  'select public.run_activity_log_backup_delete_batch(null,null)',
  'public.run_activity_log_backup_delete_batch(uuid,uuid)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '07 capability email prepare denied before lock',
  'select * from public.prepare_activity_log_backup_email(null,null)',
  'public.prepare_activity_log_backup_email(uuid,uuid)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '08 capability email ack denied before lock',
  'select public.acknowledge_activity_log_backup_email(null,null,null,null)',
  'public.acknowledge_activity_log_backup_email(uuid,uuid,text,integer)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '09 capability release denied before lock',
  'select public.release_activity_log_backup_lease(null,null,null)',
  'public.release_activity_log_backup_lease(uuid,uuid,text)'::regprocedure
);
select public.e2_test_expect_capability_denial(
  '09b capability payload read denied before lock',
  'select public.read_activity_log_backup_file_payload(null,null,null)',
  'public.read_activity_log_backup_file_payload(uuid,uuid,uuid)'::regprocedure
);
reset role;

-- 10-21: every Admin RPC denies Co-Admin and Member impersonations.
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000012","role":"authenticated"}',
  true
);
set local role authenticated;
select public.e2_test_expect_error('10 Co-Admin create denied',
  'select * from public.create_activity_log_manual_backup(''all'',null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('11 Co-Admin list denied',
  'select * from public.list_activity_log_backups(20)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('12 Co-Admin list files denied',
  'select * from public.list_activity_log_backup_files(null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('13 Co-Admin record download denied',
  'select public.record_activity_log_backup_download(null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('14 Co-Admin request deletion denied',
  'select public.request_activity_log_backup_deletion(null,null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('15 Co-Admin retry email denied',
  'select public.retry_activity_log_backup_email(null)',
  'CAL04', 'Activity Log administration is unavailable.');
reset role;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000013","role":"authenticated"}',
  true
);
set local role authenticated;
select public.e2_test_expect_error('16 Member create denied',
  'select * from public.create_activity_log_manual_backup(''all'',null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('17 Member list denied',
  'select * from public.list_activity_log_backups(20)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('18 Member list files denied',
  'select * from public.list_activity_log_backup_files(null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('19 Member record download denied',
  'select public.record_activity_log_backup_download(null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('20 Member request deletion denied',
  'select public.request_activity_log_backup_deletion(null,null)',
  'CAL04', 'Activity Log administration is unavailable.');
select public.e2_test_expect_error('21 Member retry email denied',
  'select public.retry_activity_log_backup_email(null)',
  'CAL04', 'Activity Log administration is unavailable.');
reset role;

-- Admin impersonation used by every allowed Admin RPC below.
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);
set local role authenticated;
select public.e2_test_expect_success('22 Admin create allowed',
  'select * from public.create_activity_log_manual_backup(''all'',null)');
select public.e2_test_expect_success('23 Admin list allowed',
  'select * from public.list_activity_log_backups(20)');
reset role;
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp()
where requested_by = '92000000-0000-4000-8000-000000000011'
  and status = 'pending';

-- 24-25: real setter no-op and real semantic write.
select pg_catalog.set_config('e2.old_days', setting.retention_days::text, true),
       pg_catalog.set_config('e2.old_at', setting.updated_at::text, true),
       pg_catalog.set_config('e2.old_by', coalesce(setting.updated_by::text, ''), true),
       pg_catalog.set_config('e2.old_log_count', (
         select pg_catalog.count(*)::text from public.activity_log
         where activity_type = 'activity_log_retention_changed'
       ), true)
from ceit_connect_private.activity_log_settings as setting
where setting.singleton;

set local role authenticated;
select pg_catalog.set_config(
  'e2.same_call_ok',
  public.e2_test_try(pg_catalog.format(
    'select * from public.set_activity_log_retention_days(%s)',
    pg_catalog.current_setting('e2.old_days')
  ))::text,
  true
);
reset role;
select ceit_connect_private.e2_test_record(
  '24 same-value setter is exact no-op',
  pg_catalog.current_setting('e2.same_call_ok')::boolean
  and exists (
    select 1 from ceit_connect_private.activity_log_settings as setting
    where setting.singleton
      and setting.retention_days = pg_catalog.current_setting('e2.old_days')::integer
      and setting.updated_at::text = pg_catalog.current_setting('e2.old_at')
      and coalesce(setting.updated_by::text, '') = pg_catalog.current_setting('e2.old_by')
  )
  and (select pg_catalog.count(*) from public.activity_log
       where activity_type = 'activity_log_retention_changed')
      = pg_catalog.current_setting('e2.old_log_count')::bigint
);

select pg_catalog.set_config(
  'e2.new_days',
  (case when pg_catalog.current_setting('e2.old_days')::integer = 30
    then 31 else 30 end)::text,
  true
);
set local role authenticated;
select pg_catalog.set_config(
  'e2.changed_call_ok',
  public.e2_test_try(pg_catalog.format(
    'select * from public.set_activity_log_retention_days(%s)',
    pg_catalog.current_setting('e2.new_days')
  ))::text,
  true
);
reset role;
select ceit_connect_private.e2_test_record(
  '25 changed setter writes exactly one semantic row',
  pg_catalog.current_setting('e2.changed_call_ok')::boolean
  and (select pg_catalog.count(*) from public.activity_log
       where activity_type = 'activity_log_retention_changed')
      = pg_catalog.current_setting('e2.old_log_count')::bigint + 1
  and exists (
    select 1 from public.activity_log as log_row
    where log_row.activity_type = 'activity_log_retention_changed'
      and log_row.user_id = '92000000-0000-4000-8000-000000000011'
      and log_row.changes ->> 'old_days' = pg_catalog.current_setting('e2.old_days')
      and log_row.changes ->> 'new_days' = pg_catalog.current_setting('e2.new_days')
  )
);

-- 25a-25h: both new person payload shapes insert only with exact keys and types.
do $$
declare fixture record;
begin
  for fixture in
    select * from (values
      ('25a valid retention payload inserts', 'activity_log_retention_changed',
       'UPDATE', '{"old_days":30,"new_days":31}', true),
      ('25b retention extra key is rejected', 'activity_log_retention_changed',
       'UPDATE', '{"old_days":30,"new_days":31,"unexpected":true}', false),
      ('25c retention missing key is rejected', 'activity_log_retention_changed',
       'UPDATE', '{"old_days":30}', false),
      ('25d retention wrong type is rejected', 'activity_log_retention_changed',
       'UPDATE', '{"old_days":"30","new_days":31}', false),
      ('25e valid clearing payload inserts', 'activity_log_cleared', 'DELETE',
       '{"count":1,"backup_id":"92000000-0000-4000-8000-000000000506","cutoff_at":"2026-11-21T00:00:00+08:00"}', true),
      ('25f clearing extra key is rejected', 'activity_log_cleared', 'DELETE',
       '{"count":1,"backup_id":"92000000-0000-4000-8000-000000000506","cutoff_at":"2026-11-21T00:00:00+08:00","unexpected":true}', false),
      ('25g clearing missing key is rejected', 'activity_log_cleared', 'DELETE',
       '{"count":1,"backup_id":"92000000-0000-4000-8000-000000000506"}', false),
      ('25h clearing wrong type is rejected', 'activity_log_cleared', 'DELETE',
       '{"count":"1","backup_id":"92000000-0000-4000-8000-000000000506","cutoff_at":"2026-11-21T00:00:00+08:00"}', false)
    ) as cases(label, activity_type, action, payload, should_insert)
  loop
    begin
      execute pg_catalog.format(
        'insert into public.activity_log (user_id, actor_kind, subject_kind, activity_type, subject_user_id, action, changes) values (%L::uuid, %L, %L, %L, %L::uuid, %L, %L::jsonb)',
        '92000000-0000-4000-8000-000000000011', 'user', 'person',
        fixture.activity_type, '92000000-0000-4000-8000-000000000011',
        fixture.action, fixture.payload
      );
      perform ceit_connect_private.e2_test_record(
        fixture.label, fixture.should_insert
      );
    exception when check_violation then
      perform ceit_connect_private.e2_test_record(
        fixture.label,
        not fixture.should_insert
          and pg_catalog.strpos(sqlerrm, 'activity_log_person_payload_check') > 0
      );
    when others then
      perform ceit_connect_private.e2_test_record(fixture.label, false);
    end;
  end loop;
end;
$$;

-- 26: one active backup rejects another real create with CAL06.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by
) values (
  '92000000-0000-4000-8000-000000000301', 'manual_all', 'pending',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011'
);
set local role authenticated;
select public.e2_test_expect_error(
  '26 one active backup returns CAL06',
  'select * from public.create_activity_log_manual_backup(''all'',null)',
  'CAL06', 'Another Activity Log backup is still in progress.'
);
reset role;
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp()
where id = '92000000-0000-4000-8000-000000000301';

-- 27: expired ready snapshots cannot enter deletion.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by, row_count, delete_expires_at
) values (
  '92000000-0000-4000-8000-000000000302', 'manual_all', 'ready',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011',
  0, pg_catalog.clock_timestamp() - interval '1 minute'
);
set local role authenticated;
select public.e2_test_expect_error(
  '27 expired ready snapshot rejects deletion',
  'select public.request_activity_log_backup_deletion(''92000000-0000-4000-8000-000000000302'',''DELETE 0 LOG ENTRIES'')',
  'CAL05', 'The Activity Log snapshot is no longer available for deletion.'
);
reset role;
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'deletion_window_expired',
    completed_at = pg_catalog.clock_timestamp()
where id = '92000000-0000-4000-8000-000000000302';

-- 28-34: Admin file access, confirmation, and every-file download gate.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  row_count, file_count, delete_expires_at
) values (
  '92000000-0000-4000-8000-000000000303', 'manual_all', 'ready',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011',
  2, 2, pg_catalog.clock_timestamp() + interval '30 minutes'
);
insert into ceit_connect_private.activity_log_backup_files(
  id, backup_id, part_number, object_path, status, reservation_expires_at,
  row_count, raw_byte_count, sha256_hex, first_created_at,
  first_activity_id, last_created_at, last_activity_id, verified_at
) values
('92000000-0000-4000-8000-000000000311',
 '92000000-0000-4000-8000-000000000303', 1,
 '92000000-0000-4000-8000-000000000303/part-0001.csv', 'verified',
 pg_catalog.clock_timestamp(), 1, 100, pg_catalog.repeat('a',64),
 pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000321',
 pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000321',
 pg_catalog.clock_timestamp()),
('92000000-0000-4000-8000-000000000312',
 '92000000-0000-4000-8000-000000000303', 2,
 '92000000-0000-4000-8000-000000000303/part-0002.csv', 'verified',
 pg_catalog.clock_timestamp(), 1, 100, pg_catalog.repeat('b',64),
 pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000322',
 pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000322',
 pg_catalog.clock_timestamp());

set local role authenticated;
select public.e2_test_expect_success(
  '28 Admin list files allowed',
  'select * from public.list_activity_log_backup_files(''92000000-0000-4000-8000-000000000303'')'
);
select public.e2_test_expect_error(
  '29 no downloads returns CAL07',
  'select public.request_activity_log_backup_deletion(''92000000-0000-4000-8000-000000000303'',''DELETE 2 LOG ENTRIES'')',
  'CAL07', 'Download every snapshot file before deleting Activity Log entries.'
);
select public.e2_test_expect_error(
  '30 typed confirmation mismatch returns CAL02',
  'select public.request_activity_log_backup_deletion(''92000000-0000-4000-8000-000000000303'',''DELETE 1 LOG ENTRIES'')',
  'CAL02', 'The Activity Log deletion confirmation does not match.'
);
select public.e2_test_expect_success(
  '31 Admin record download allowed',
  'select public.record_activity_log_backup_download(''92000000-0000-4000-8000-000000000311'')'
);
select public.e2_test_expect_error(
  '32 one of two downloads still returns CAL07',
  'select public.request_activity_log_backup_deletion(''92000000-0000-4000-8000-000000000303'',''DELETE 2 LOG ENTRIES'')',
  'CAL07', 'Download every snapshot file before deleting Activity Log entries.'
);
select public.record_activity_log_backup_download(
  '92000000-0000-4000-8000-000000000312'
);
select public.e2_test_expect_true(
  '33 all downloads allow deletion request',
  'select public.request_activity_log_backup_deletion(''92000000-0000-4000-8000-000000000303'',''DELETE 2 LOG ENTRIES'')'
);
reset role;
select ceit_connect_private.e2_test_record(
  '33 all downloads allow deletion request',
  coalesce((select result.passed
    from ceit_connect_private.e2_test_results as result
    where result.label = '33 all downloads allow deletion request'), false)
  and exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.id = '92000000-0000-4000-8000-000000000303'
      and backup.status = 'deletion_requested'
  )
);
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000303';

-- 34: Admin retry-email RPC is allowed and resets the due state.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by, deletion_requested_by,
  deleted_count, email_attempt_count, last_error_code
) values (
  '92000000-0000-4000-8000-000000000304', 'manual_all', 'email_failed',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011',
  '92000000-0000-4000-8000-000000000011', 1, 5, 'email_delivery_failed'
);
set local role authenticated;
select public.e2_test_expect_true(
  '34 Admin retry email allowed',
  'select public.retry_activity_log_backup_email(''92000000-0000-4000-8000-000000000304'')'
);
reset role;
select ceit_connect_private.e2_test_record(
  '34 Admin retry email allowed',
  coalesce((select result.passed
    from ceit_connect_private.e2_test_results as result
    where result.label = '34 Admin retry email allowed'), false)
  and exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.id = '92000000-0000-4000-8000-000000000304'
      and backup.status = 'email_pending'
      and backup.email_attempt_count = 0
      and backup.next_attempt_at <= pg_catalog.clock_timestamp()
  )
);
update ceit_connect_private.activity_log_backups
set status = 'completed', completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000304';

-- Install a transaction-local test sender credential for positive anon cases.
delete from ceit_connect_private.email_sender_credentials;
insert into ceit_connect_private.email_sender_credentials(
  slot, generation, salt, secret_hash
) values (
  'current', 1, decode(pg_catalog.repeat('92',32),'hex'),
  extensions.digest(
    decode(pg_catalog.repeat('92',32),'hex')
      || pg_catalog.convert_to('e2-email-secret','UTF8'),
    'sha256'
  )
);
select pg_catalog.set_config(
  'request.headers',
  '{"x-ceit-email-capability":"e2-email-secret"}',
  true
);

-- 34a-34d: verification rejects mismatches, stores exact bytes, and the
-- completed terminal transition removes the private payload.
select
  pg_catalog.set_config(
    'e2.payload_base64',
    pg_catalog.encode(pg_catalog.convert_to('E2 payload bytes', 'UTF8'), 'base64'),
    true
  ),
  pg_catalog.set_config(
    'e2.payload_size',
    pg_catalog.octet_length(pg_catalog.convert_to('E2 payload bytes', 'UTF8'))::text,
    true
  ),
  pg_catalog.set_config(
    'e2.payload_hash',
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to('E2 payload bytes', 'UTF8'), 'sha256'),
      'hex'
    ),
    true
  );
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  lease_token, lease_expires_at
) values (
  '92000000-0000-4000-8000-000000000420', 'manual_all', 'snapshotting',
  '-infinity', '92000000-0000-4000-8000-000000000011',
  '92000000-0000-4000-8000-000000000422',
  pg_catalog.clock_timestamp() + interval '5 minutes'
);
insert into ceit_connect_private.activity_log_backup_files(
  id, backup_id, part_number, object_path, status, reservation_expires_at,
  row_count, first_created_at, first_activity_id,
  last_created_at, last_activity_id
) values (
  '92000000-0000-4000-8000-000000000421',
  '92000000-0000-4000-8000-000000000420', 1,
  'manual/92000000-0000-4000-8000-000000000420/e2-payload.csv',
  'reserved', pg_catalog.clock_timestamp() + interval '5 minutes', 1,
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000423',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000423'
);
insert into storage.objects(bucket_id, name, metadata) values (
  'activity-log-backups',
  'manual/92000000-0000-4000-8000-000000000420/e2-payload.csv',
  pg_catalog.jsonb_build_object(
    'size', pg_catalog.current_setting('e2.payload_size')::integer,
    'mimetype', 'text/csv'
  )
);

set local role anon;
select public.e2_test_expect_error(
  '34a payload hash mismatch is rejected',
  'select public.verify_activity_log_backup_file(''92000000-0000-4000-8000-000000000421'',''92000000-0000-4000-8000-000000000420'',''92000000-0000-4000-8000-000000000422'',pg_catalog.current_setting(''e2.payload_size'')::integer,pg_catalog.repeat(''0'',64),pg_catalog.current_setting(''e2.payload_base64''))',
  '22023', 'Activity Log backup verification is invalid.'
);
select public.e2_test_expect_error(
  '34b payload size mismatch is rejected',
  'select public.verify_activity_log_backup_file(''92000000-0000-4000-8000-000000000421'',''92000000-0000-4000-8000-000000000420'',''92000000-0000-4000-8000-000000000422'',pg_catalog.current_setting(''e2.payload_size'')::integer + 1,pg_catalog.current_setting(''e2.payload_hash''),pg_catalog.current_setting(''e2.payload_base64''))',
  '22023', 'Activity Log backup verification is invalid.'
);
select public.e2_test_expect_true(
  '34c verified payload row exists',
  'select public.verify_activity_log_backup_file(''92000000-0000-4000-8000-000000000421'',''92000000-0000-4000-8000-000000000420'',''92000000-0000-4000-8000-000000000422'',pg_catalog.current_setting(''e2.payload_size'')::integer,pg_catalog.current_setting(''e2.payload_hash''),pg_catalog.current_setting(''e2.payload_base64''))'
);
reset role;
select ceit_connect_private.e2_test_record(
  '34c verified payload row exists',
  coalesce((select result.passed
    from ceit_connect_private.e2_test_results as result
    where result.label = '34c verified payload row exists'), false)
  and exists (
    select 1
    from ceit_connect_private.activity_log_backup_file_payloads as payload
    where payload.file_id = '92000000-0000-4000-8000-000000000421'
      and payload.file_bytes = pg_catalog.decode(
        pg_catalog.current_setting('e2.payload_base64'), 'base64'
      )
  )
);
set local role anon;
select public.e2_test_expect_true(
  '34d completed backup removes payload row',
  'select public.complete_activity_log_backup_snapshot(''92000000-0000-4000-8000-000000000420'',''92000000-0000-4000-8000-000000000422'')'
);
reset role;
select ceit_connect_private.e2_test_record(
  '34d completed backup removes payload row',
  coalesce((select result.passed
    from ceit_connect_private.e2_test_results as result
    where result.label = '34d completed backup removes payload row'), false)
  and exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.id = '92000000-0000-4000-8000-000000000420'
      and backup.status = 'completed'
  )
  and not exists (
    select 1 from ceit_connect_private.activity_log_backup_file_payloads as payload
    where payload.file_id = '92000000-0000-4000-8000-000000000421'
  )
);

-- 34e: an expired snapshot lease cannot promote work to ready or deleting.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  lease_token, lease_expires_at
) values (
  '92000000-0000-4000-8000-000000000424', 'manual_all', 'snapshotting',
  '-infinity', '92000000-0000-4000-8000-000000000011',
  '92000000-0000-4000-8000-000000000425',
  pg_catalog.clock_timestamp() - interval '1 minute'
);
set local role anon;
select public.e2_test_expect_error(
  '34e expired completion lease is rejected',
  'select public.complete_activity_log_backup_snapshot(''92000000-0000-4000-8000-000000000424'',''92000000-0000-4000-8000-000000000425'')',
  'CAL05', 'The Activity Log backup lease is unavailable.'
);
reset role;
select ceit_connect_private.e2_test_record(
  '34e expired completion lease is rejected',
  coalesce((select result.passed
    from ceit_connect_private.e2_test_results as result
    where result.label = '34e expired completion lease is rejected'), false)
  and exists (
    select 1 from ceit_connect_private.activity_log_backups as backup
    where backup.id = '92000000-0000-4000-8000-000000000424'
      and backup.status = 'snapshotting'
  )
);
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000424';

-- 34f: a gap in existing part numbers allocates max(part_number) + 1.
set local session_replication_role = replica;
insert into public.activity_log(
  id, user_id, actor_kind, subject_kind, activity_type, subject_user_id,
  action, changes, created_at
) values (
  '92000000-0000-4000-8000-000000000426',
  '92000000-0000-4000-8000-000000000011', 'user', 'person',
  'activity_log_retention_changed',
  '92000000-0000-4000-8000-000000000011', 'UPDATE',
  pg_catalog.jsonb_build_object('old_days',30,'new_days',31),
  '-infinity'::timestamptz
);
set local session_replication_role = origin;
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  lease_token, lease_expires_at
) values (
  '92000000-0000-4000-8000-000000000427', 'manual_all', 'snapshotting',
  '2000-01-01 00:00:00+08'::timestamptz,
  '92000000-0000-4000-8000-000000000011',
  '92000000-0000-4000-8000-000000000428',
  pg_catalog.clock_timestamp() + interval '5 minutes'
);
insert into ceit_connect_private.activity_log_backup_files(
  id, backup_id, part_number, object_path, reservation_expires_at,
  row_count, first_created_at, first_activity_id,
  last_created_at, last_activity_id
) values
(
  '92000000-0000-4000-8000-000000000429',
  '92000000-0000-4000-8000-000000000427', 1,
  'manual/92000000-0000-4000-8000-000000000427/e2-part-0001.csv',
  pg_catalog.clock_timestamp() + interval '5 minutes', 1,
  pg_catalog.clock_timestamp() - interval '3 hours', gen_random_uuid(),
  pg_catalog.clock_timestamp() - interval '3 hours', gen_random_uuid()
),
(
  '92000000-0000-4000-8000-000000000430',
  '92000000-0000-4000-8000-000000000427', 3,
  'manual/92000000-0000-4000-8000-000000000427/e2-part-0003.csv',
  pg_catalog.clock_timestamp() + interval '5 minutes', 1,
  pg_catalog.clock_timestamp() - interval '3 hours', gen_random_uuid(),
  pg_catalog.clock_timestamp() - interval '3 hours', gen_random_uuid()
);
set local role anon;
select public.e2_test_expect_true(
  '34f reserve uses maximum part plus one',
  'select out_part_number = 4 from public.reserve_activity_log_backup_file(''92000000-0000-4000-8000-000000000427'',''92000000-0000-4000-8000-000000000428'',array[''92000000-0000-4000-8000-000000000426''::uuid])'
);
reset role;
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000427';

-- 35: confidential task output is viewer-independent and contains no raw text.
set local session_replication_role = replica;
insert into public.activity_log(
  id, task_id, event_id, user_id, actor_kind, subject_kind,
  activity_type, action, changes, task_was_confidential, created_at
) values (
  '92000000-0000-4000-8000-000000000401',
  '92000000-0000-4000-8000-000000000201',
  '92000000-0000-4000-8000-000000000101',
  '92000000-0000-4000-8000-000000000011',
  'user', 'task', 'task_updated', 'UPDATE',
  '{"raw":"E2 RAW SECRET CHANGES"}'::jsonb, true,
  pg_catalog.clock_timestamp() - interval '2 hours'
);
set local session_replication_role = origin;
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  lease_token, lease_expires_at
) values (
  '92000000-0000-4000-8000-000000000402', 'manual_all', 'snapshotting',
  pg_catalog.clock_timestamp() - interval '1 hour',
  '92000000-0000-4000-8000-000000000011',
  '92000000-0000-4000-8000-000000000403',
  pg_catalog.clock_timestamp() + interval '5 minutes'
);
set local role anon;
select public.e2_test_confidential_masking(
  '35 confidential candidate is strictly masked',
  '92000000-0000-4000-8000-000000000402',
  '92000000-0000-4000-8000-000000000403',
  '92000000-0000-4000-8000-000000000401'
);
reset role;
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000402';

-- Resolve the dynamic expected set so pre-existing Dev Admins cannot affect
-- fixture independence.
select pg_catalog.set_config(
  'e2.expected_admin_emails',
  coalesce((
    select pg_catalog.string_agg(
      pg_catalog.lower(pg_catalog.btrim(auth_user.email)), ','
      order by pg_catalog.lower(pg_catalog.btrim(auth_user.email))
    )
    from public.users as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.is_active and profile.role = 'Admin'
      and profile.anonymized_at is null
      and auth_user.email_confirmed_at is not null
      and auth_user.email is not null
      and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
          pg_catalog.lower(pg_catalog.btrim(profile.email))
  ), ''),
  true
);

-- 36: null policy setter falls back to every active confirmed Admin.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, cycle_month, fixed_cutoff_at, retention_days,
  policy_setter_id, deleted_count, lease_token, lease_expires_at
) values (
  '92000000-0000-4000-8000-000000000411', 'monthly_retention',
  'email_pending', date '2091-01-01', pg_catalog.clock_timestamp(),
  30, null, 1, '92000000-0000-4000-8000-000000000412',
  pg_catalog.clock_timestamp() + interval '5 minutes'
);
set local role anon;
select public.e2_test_recipient_resolution(
  '36 null setter falls back to all Admins',
  '92000000-0000-4000-8000-000000000411',
  '92000000-0000-4000-8000-000000000412',
  pg_catalog.current_setting('e2.expected_admin_emails')
);
reset role;
update ceit_connect_private.activity_log_backups
set status = 'completed', completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000411';

-- 37: a current non-Admin policy setter uses the same fallback.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, cycle_month, fixed_cutoff_at, retention_days,
  policy_setter_id, deleted_count, lease_token, lease_expires_at
) values (
  '92000000-0000-4000-8000-000000000413', 'monthly_retention',
  'email_pending', date '2091-02-01', pg_catalog.clock_timestamp(),
  30, '92000000-0000-4000-8000-000000000013', 1,
  '92000000-0000-4000-8000-000000000414',
  pg_catalog.clock_timestamp() + interval '5 minutes'
);
set local role anon;
select public.e2_test_recipient_resolution(
  '37 non-Admin setter falls back to all Admins',
  '92000000-0000-4000-8000-000000000413',
  '92000000-0000-4000-8000-000000000414',
  pg_catalog.current_setting('e2.expected_admin_emails')
);
reset role;
update ceit_connect_private.activity_log_backups
set status = 'completed', completed_at = pg_catalog.clock_timestamp(),
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000413';

-- 38-43: 5,001 exact manifest IDs delete as 5,000 + 1 after the requesting
-- Admin is deactivated; both an unmanifested pre-cutoff row and a later row
-- survive every deletion batch.
do $fixture$
declare
  v_backup constant uuid := '92000000-0000-4000-8000-000000000501';
  v_file_one constant uuid := '92000000-0000-4000-8000-000000000502';
  v_file_two constant uuid := '92000000-0000-4000-8000-000000000503';
  v_after constant uuid := '92000000-0000-4000-8000-000000000504';
  v_unmanifested constant uuid := '92000000-0000-4000-8000-000000000505';
  v_base constant timestamptz := '2001-01-01 00:00:00+08';
  v_first integer;
  v_second integer;
begin
  insert into public.activity_log(
    id, user_id, actor_kind, subject_kind, activity_type, subject_user_id,
    action, changes, created_at
  )
  select gen_random_uuid(), '92000000-0000-4000-8000-000000000011',
    'user', 'person', 'activity_log_retention_changed',
    '92000000-0000-4000-8000-000000000011', 'UPDATE',
    pg_catalog.jsonb_build_object('old_days',30,'new_days',180),
    v_base + series.value * interval '1 microsecond'
  from pg_catalog.generate_series(1,5001) as series(value);

  insert into public.activity_log(
    id, user_id, actor_kind, subject_kind, activity_type, subject_user_id,
    action, changes, created_at
  ) values (
    v_after, '92000000-0000-4000-8000-000000000011', 'user', 'person',
    'activity_log_retention_changed',
    '92000000-0000-4000-8000-000000000011', 'UPDATE',
    pg_catalog.jsonb_build_object('old_days',180,'new_days',30),
    v_base + interval '2 days'
  );

  insert into public.activity_log(
    id, user_id, actor_kind, subject_kind, activity_type, subject_user_id,
    action, changes, created_at
  ) values (
    v_unmanifested, '92000000-0000-4000-8000-000000000013',
    'user', 'person', 'activity_log_retention_changed',
    '92000000-0000-4000-8000-000000000013', 'UPDATE',
    pg_catalog.jsonb_build_object('old_days',30,'new_days',31),
    v_base + interval '12 hours'
  );

  insert into ceit_connect_private.activity_log_backups(
    id, kind, status, fixed_cutoff_at, requested_by, deletion_requested_by,
    file_count, row_count
  ) values (
    v_backup, 'manual_all', 'deleting', v_base + interval '1 day',
    '92000000-0000-4000-8000-000000000011',
    '92000000-0000-4000-8000-000000000011', 2, 5001
  );

  insert into ceit_connect_private.activity_log_backup_files(
    id, backup_id, part_number, object_path, status, reservation_expires_at,
    row_count, raw_byte_count, sha256_hex, first_created_at,
    first_activity_id, last_created_at, last_activity_id, verified_at
  )
  select v_file_one, v_backup, 1, v_backup::text || '/part-0001.csv',
    'verified', pg_catalog.clock_timestamp(), 5000, 100,
    pg_catalog.repeat('c',64), min(rows.created_at),
    (pg_catalog.array_agg(rows.id order by rows.created_at,rows.id))[1],
    max(rows.created_at),
    (pg_catalog.array_agg(rows.id order by rows.created_at desc,rows.id desc))[1],
    pg_catalog.clock_timestamp()
  from (
    select log_row.id, log_row.created_at
    from public.activity_log as log_row
    where log_row.user_id = '92000000-0000-4000-8000-000000000011'
      and log_row.activity_type = 'activity_log_retention_changed'
      and log_row.created_at >= v_base
      and log_row.created_at < v_base + interval '1 day'
    order by log_row.created_at, log_row.id limit 5000
  ) as rows;

  insert into ceit_connect_private.activity_log_backup_files(
    id, backup_id, part_number, object_path, status, reservation_expires_at,
    row_count, raw_byte_count, sha256_hex, first_created_at,
    first_activity_id, last_created_at, last_activity_id, verified_at
  )
  select v_file_two, v_backup, 2, v_backup::text || '/part-0002.csv',
    'verified', pg_catalog.clock_timestamp(), 1, 100,
    pg_catalog.repeat('d',64), rows.created_at, rows.id,
    rows.created_at, rows.id, pg_catalog.clock_timestamp()
  from (
    select log_row.id, log_row.created_at
    from public.activity_log as log_row
    where log_row.user_id = '92000000-0000-4000-8000-000000000011'
      and log_row.activity_type = 'activity_log_retention_changed'
      and log_row.created_at >= v_base
      and log_row.created_at < v_base + interval '1 day'
    order by log_row.created_at, log_row.id offset 5000 limit 1
  ) as rows;

  insert into ceit_connect_private.activity_log_backup_rows(
    backup_id, file_id, activity_id, activity_created_at
  )
  select v_backup,
    case when numbered.position <= 5000 then v_file_one else v_file_two end,
    numbered.id, numbered.created_at
  from (
    select log_row.id, log_row.created_at,
      pg_catalog.row_number() over(
        order by log_row.created_at, log_row.id
      ) as position
    from public.activity_log as log_row
    where log_row.user_id = '92000000-0000-4000-8000-000000000011'
      and log_row.activity_type = 'activity_log_retention_changed'
      and log_row.created_at >= v_base
      and log_row.created_at < v_base + interval '1 day'
  ) as numbered;

  perform ceit_connect_private.e2_test_record(
    '38 two files manifest exactly 5001 rows',
    (select pg_catalog.count(*) = 5001
     from ceit_connect_private.activity_log_backup_rows
     where backup_id = v_backup)
    and (select pg_catalog.count(*) = 2
         from ceit_connect_private.activity_log_backup_files
         where backup_id = v_backup)
  );

  begin
    v_first := ceit_connect_private.delete_activity_log_backup_manifest_batch(v_backup);
    perform ceit_connect_private.e2_test_record(
      '39 first deletion batch is exactly 5000', v_first = 5000
    );
  exception when others then
    perform ceit_connect_private.e2_test_record(
      '39 first deletion batch is exactly 5000', false
    );
  end;

  perform ceit_connect_private.e2_test_record(
    '39a non-manifest rows survive first batch',
    exists(select 1 from public.activity_log where id = v_unmanifested)
    and exists(select 1 from public.activity_log where id = v_after)
  );

  -- A second confirmed Admin fixture keeps the real last-Admin guard valid.
  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'set_officer_active', true
  );
  update public.users as profile
  set is_active = false
  where profile.id = '92000000-0000-4000-8000-000000000011';
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  perform ceit_connect_private.e2_test_record(
    '40 requesting Admin is inactive before final deletion batch',
    exists(select 1 from public.users as profile
      where profile.id = '92000000-0000-4000-8000-000000000011'
        and not profile.is_active)
  );

  begin
    v_second := ceit_connect_private.delete_activity_log_backup_manifest_batch(v_backup);
    perform ceit_connect_private.e2_test_record(
      '41 final deletion batch completes after deactivation',
      v_second = 1
      and exists(select 1
        from ceit_connect_private.activity_log_backups as backup
        where backup.id = v_backup and backup.status = 'email_pending')
    );
  exception when others then
    perform ceit_connect_private.e2_test_record(
      '41 final deletion batch completes after deactivation', false
    );
  end;

  perform ceit_connect_private.e2_test_record(
    '42 non-manifest rows survive final batch',
    exists(select 1 from public.activity_log where id = v_unmanifested)
    and exists(select 1 from public.activity_log where id = v_after)
  );
  perform ceit_connect_private.e2_test_record(
    '43 real deletion writes cleared activity type',
    1 = (select pg_catalog.count(*) from public.activity_log
         where activity_type = 'activity_log_cleared'
           and changes ->> 'backup_id' = v_backup::text)
  );
exception when others then
  perform pg_catalog.set_config(
    'e2.fixture_38_43_error',
    pg_catalog.format('%s: %s', sqlstate, pg_catalog.left(sqlerrm, 240)),
    true
  );
  perform ceit_connect_private.e2_test_record(
    '38 two files manifest exactly 5001 rows', false
  );
  perform ceit_connect_private.e2_test_record(
    '39 first deletion batch is exactly 5000', false
  );
  perform ceit_connect_private.e2_test_record(
    '39a non-manifest rows survive first batch', false
  );
  perform ceit_connect_private.e2_test_record(
    '40 requesting Admin is inactive before final deletion batch', false
  );
  perform ceit_connect_private.e2_test_record(
    '41 final deletion batch completes after deactivation', false
  );
  perform ceit_connect_private.e2_test_record(
    '42 non-manifest rows survive final batch', false
  );
  perform ceit_connect_private.e2_test_record(
    '43 real deletion writes cleared activity type', false
  );
end
$fixture$;
update ceit_connect_private.activity_log_backups
set status = 'email_failed', last_error_code = 'email_delivery_failed',
    lease_token = null, lease_expires_at = null
where id = '92000000-0000-4000-8000-000000000501';

-- 44-46: exhausted/expired snapshot work fails safely and releases the slot.
insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  attempt_count, next_attempt_at
) values (
  '92000000-0000-4000-8000-000000000601', 'manual_all', 'snapshotting',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011',
  5, pg_catalog.clock_timestamp() - interval '1 minute'
);
select ceit_connect_private.fail_stale_activity_log_snapshots();
select ceit_connect_private.e2_test_record(
  '44 exhausted snapshot becomes failed',
  exists(select 1 from ceit_connect_private.activity_log_backups
    where id = '92000000-0000-4000-8000-000000000601'
      and status = 'failed'
      and last_error_code = 'snapshot_attempts_exhausted')
);

insert into ceit_connect_private.activity_log_backups(
  id, kind, status, fixed_cutoff_at, requested_by,
  created_at, next_attempt_at
) values (
  '92000000-0000-4000-8000-000000000602', 'manual_all', 'pending',
  pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011',
  pg_catalog.clock_timestamp() - interval '25 hours',
  pg_catalog.clock_timestamp() - interval '1 minute'
);
select ceit_connect_private.fail_stale_activity_log_snapshots();
select ceit_connect_private.e2_test_record(
  '45 24-hour snapshot becomes failed',
  exists(select 1 from ceit_connect_private.activity_log_backups
    where id = '92000000-0000-4000-8000-000000000602'
      and status = 'failed' and last_error_code = 'snapshot_expired')
);

do $$
begin
  insert into ceit_connect_private.activity_log_backups(
    id, kind, status, fixed_cutoff_at, requested_by
  ) values (
    '92000000-0000-4000-8000-000000000603', 'manual_all', 'pending',
    pg_catalog.clock_timestamp(), '92000000-0000-4000-8000-000000000011'
  );
  perform ceit_connect_private.e2_test_record(
    '46 failed snapshots unblock a new backup', true
  );
exception when others then
  perform ceit_connect_private.e2_test_record(
    '46 failed snapshots unblock a new backup', false
  );
end;
$$;
update ceit_connect_private.activity_log_backups
set status = 'failed', last_error_code = 'e2_test_complete',
    completed_at = pg_catalog.clock_timestamp()
where id = '92000000-0000-4000-8000-000000000603';

-- 47: the second call represents a day-2 cron invocation in the same month.
do $$
declare v_first uuid; v_second uuid; v_cycle date;
begin
  v_cycle := pg_catalog.date_trunc(
    'month', pg_catalog.clock_timestamp() at time zone 'Asia/Manila'
  )::date;

  delete from ceit_connect_private.activity_log_backup_downloads
  where backup_id in (
    select id from ceit_connect_private.activity_log_backups
    where kind = 'monthly_retention' and cycle_month = v_cycle
  );
  delete from ceit_connect_private.activity_log_backup_rows
  where backup_id in (
    select id from ceit_connect_private.activity_log_backups
    where kind = 'monthly_retention' and cycle_month = v_cycle
  );
  delete from ceit_connect_private.activity_log_backup_file_payloads
  where file_id in (
    select file.id
    from ceit_connect_private.activity_log_backup_files as file
    join ceit_connect_private.activity_log_backups as backup
      on backup.id = file.backup_id
    where backup.kind = 'monthly_retention'
      and backup.cycle_month = v_cycle
  );
  delete from ceit_connect_private.activity_log_backup_files
  where backup_id in (
    select id from ceit_connect_private.activity_log_backups
    where kind = 'monthly_retention' and cycle_month = v_cycle
  );
  delete from ceit_connect_private.activity_log_backups
  where kind = 'monthly_retention' and cycle_month = v_cycle;

  v_first := ceit_connect_private.start_monthly_activity_log_backup();
  v_second := ceit_connect_private.start_monthly_activity_log_backup();
  perform ceit_connect_private.e2_test_record(
    '47 repeated monthly checker does not duplicate',
    v_first is not null
    and v_second = v_first
    and 1 = (select pg_catalog.count(*)
      from ceit_connect_private.activity_log_backups
      where kind = 'monthly_retention' and cycle_month = v_cycle)
  );
exception when others then
  perform ceit_connect_private.e2_test_record(
    '47 repeated monthly checker does not duplicate', false
  );
end;
$$;

-- 48: actual event/task FK identities equal the maintained delete inventory
-- in both directions, so E2 added no uncatalogued FK to either parent.
select ceit_connect_private.e2_test_record(
  '48 event-task FK inventory matches both ways',
  not exists (
    select constraint_row.conname, source_namespace.nspname,
      source_class.relname, target_class.relname
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as source_class
      on source_class.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_class.relnamespace
    join pg_catalog.pg_class as target_class
      on target_class.oid = constraint_row.confrelid
    where constraint_row.contype = 'f'
      and constraint_row.confrelid in (
        'public.events'::regclass, 'public.tasks'::regclass
      )
    except
    select lock_row.constraint_name, lock_row.referencing_schema,
      lock_row.referencing_table, lock_row.referenced_table
    from ceit_connect_private.event_delete_fk_lock_list as lock_row
  )
  and not exists (
    select lock_row.constraint_name, lock_row.referencing_schema,
      lock_row.referencing_table, lock_row.referenced_table
    from ceit_connect_private.event_delete_fk_lock_list as lock_row
    except
    select constraint_row.conname, source_namespace.nspname,
      source_class.relname, target_class.relname
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as source_class
      on source_class.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_class.relnamespace
    join pg_catalog.pg_class as target_class
      on target_class.oid = constraint_row.confrelid
    where constraint_row.contype = 'f'
      and constraint_row.confrelid in (
        'public.events'::regclass, 'public.tasks'::regclass
      )
  )
);

-- 49: neither E2 private backup table directly references events or tasks.
select ceit_connect_private.e2_test_record(
  '49 E2 tables have no event-task FK',
  not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as source_class
      on source_class.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_class.relnamespace
    where constraint_row.contype = 'f'
      and source_namespace.nspname = 'ceit_connect_private'
      and source_class.relname like 'activity_log_backup%'
      and constraint_row.confrelid in (
        'public.events'::regclass, 'public.tasks'::regclass
      )
  )
);

do $$
declare
  v_pass integer;
  v_total integer;
  v_failures text;
  v_fixture_error text;
begin
  select pg_catalog.count(*) filter(where passed), pg_catalog.count(*)
  into v_pass, v_total
  from ceit_connect_private.e2_test_results;
  select pg_catalog.string_agg(label, ', ' order by label)
  into v_failures
  from ceit_connect_private.e2_test_results
  where not passed;
  v_fixture_error := pg_catalog.current_setting('e2.fixture_38_43_error', true);
  if v_fixture_error is not null and v_fixture_error <> '' then
    v_failures := pg_catalog.concat_ws(
      ', ', v_failures, '38-43 fixture error: ' || v_fixture_error
    );
  end if;
  if v_total <> 66 then
    v_failures := pg_catalog.concat_ws(
      ', ', v_failures,
      pg_catalog.format('missing result rows: expected 66, got %s', v_total)
    );
  end if;
  raise exception 'TEST RESULTS %/66 PASS; failures: %',
    v_pass, coalesce(v_failures, 'none');
end;
$$;
```

## Coverage boundary

The **catalog paste** covers the private bucket and five-MiB setting, the exact
two bucket-specific Storage policies, reports broad anonymous/public read
policies without a bucket boundary, payload-table RLS
and API-role denial, sole purger-marker setter, absence of API execution on the
private deletion function, real claim/kick `next_attempt_at` predicates, and
the email function's 240-minute retry arm.

The **66-check behavior paste** covers effective Storage read access for anon,
Co-Admin, Member, and Admin plus every anon worker capability denial and
authentication-before-lock/mutation ordering; Admin/Co-Admin/Member RPC
authorization; real same-value and changed retention saves, valid exact-key
retention and clearing payload inserts, rejection of extra/missing/wrong-type
person payloads, and manual clearing completion; one-active,
expired-ready, download, and typed-confirmation behavior; confidential masking;
payload hash/size rejection, verified-byte storage, terminal payload cleanup;
expired snapshot-completion lease rejection and maximum-part allocation;
recipient fallbacks; 5,001-row two-file manifest deletion after deactivating
the requesting Admin; manifest-only deletion with both pre- and post-cutoff
non-manifest survival after every batch; both new activity types;
exhausted/expired snapshot failure; failed
snapshot unblocking; monthly idempotency; and both directions of the existing
event/task FK inventory.

Only **unit/source-contract tests** cover byte-level CSV splitting at five MiB,
the injectable per-wake and attachment caps, formula escaping and UTF-8 BOM,
non-ASCII byte fidelity through the 30-second backup fetch, absence of worker
Storage downloads, transient prepare/payload-read outcomes, Resend
payload/attachment construction, backup-UUID idempotency, wake-route failure
isolation, application retry rendering, and the full 5/15/60/240 retry-expression
source contract. Dev email delivery still requires the manual normal, failure,
and Admin-retry checks in the implementation document.

