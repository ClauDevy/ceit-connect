# Phase 4 Step 1A — raw task access hardening tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

Use the SQL Editor once per block. Every paste starts a transaction and ends
with one `raise exception 'TEST RESULTS ...'`. That final exception is
intentional: it aborts the transaction and rolls every fixture back, so there
is no literal `rollback` statement. Each block collects all assertion outcomes
before raising, so a failed check does not hide the other PASS/FAIL lines.

The tests expect these permanent Dev users:

- Admin: `11111111-1111-1111-1111-111111111111`
- CIA Co-Admin: `22222222-2222-2222-2222-222222222222`
- Member: `33333333-3333-3333-3333-333333333333`

Every block that needs additional callers creates matching rows in both
`auth.users` and `public.users`. Do not run any block against Prod. No block
touches `storage.objects`, creates a temp/result table, or requires two
sessions. Deferred-trigger checks use `set constraints all immediate`.

## TEST 1 — pre-fix leak reproduction only

Run this block **before** applying
`20261016120000_harden_raw_task_access.sql` to Dev. Before the fix it should
report `LEAKED` as a PASS. After the fix, running it again is expected to report
`NOT LEAKED` and therefore mark this pre-fix expectation FAIL.

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select
  fixture.id,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  fixture.email,
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select
  '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local',
  'Step 1A Other Co-Admin',
  'Co-Admin',
  c.id,
  true
from public.committees c
where c.id <> (
  select committee_id from public.users
  where id = '22222222-2222-2222-2222-222222222222'
)
order by c.name
limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (
  select committee_id from public.users
  where id = '22222222-2222-2222-2222-222222222222'
) cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values (
  'a1a00000-0000-4000-8000-000000000001',
  'Step 1A pre-fix leak',
  '2026-11-01',
  '2026-11-02',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, description,
  is_confidential, request_backup
)
select
  'b1a00000-0000-4000-8000-000000000001',
  'a1a00000-0000-4000-8000-000000000001',
  committee_id,
  'PRE-FIX SECRET TITLE',
  'PRE-FIX SECRET DESCRIPTION',
  true,
  true
from public.users
where id = '22222222-2222-2222-2222-222222222222';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '55555555-5555-4555-8555-555555555555',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
begin
  select count(*)
  into v_rows
  from (
    select title, description
    from public.tasks
    where id = 'b1a00000-0000-4000-8000-000000000001'
      and title = 'PRE-FIX SECRET TITLE'
      and description = 'PRE-FIX SECRET DESCRIPTION'
  ) leaked_content;

  v_results := v_results || format(
    E'\nPRE-FIX_BACKUP_CONFIDENTIAL_LEAK: %s (%s)',
    case when v_rows = 1 then 'PASS' else 'FAIL' end,
    case when v_rows = 1 then 'LEAKED as expected before the fix'
         else 'NOT LEAKED; expected after the fix' end
  );

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 9 — activity log is closed by Step 1A

Run this post-fix test only after
`20261016120000_harden_raw_task_access.sql` is on Dev. It reads
`activity_log.changes` directly and proves that the activity policy's task
subquery inherits the hardened `tasks_select` gate.

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-log-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-log-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-log-viewer@test.local'),
  ('77777777-7777-4777-8777-777777777777'::uuid, 'step1a-log-inactive-primary@test.local'),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'step1a-log-inactive-assist@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-log-other-coadmin@test.local',
  'Step 1A Log Other Co-Admin',
  'Co-Admin',
  c.id,
  true
from public.committees c
where c.id <> (
  select committee_id from public.users
  where id = '22222222-2222-2222-2222-222222222222'
)
order by c.name
limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (
  select committee_id from public.users
  where id = '22222222-2222-2222-2222-222222222222'
) cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-log-unassigned@test.local', 'Step 1A Log Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-log-viewer@test.local', 'Step 1A Log Allowed Viewer'),
  ('77777777-7777-4777-8777-777777777777'::uuid,
   'step1a-log-inactive-primary@test.local', 'Step 1A Log Inactive Primary'),
  ('88888888-8888-4888-8888-888888888888'::uuid,
   'step1a-log-inactive-assist@test.local', 'Step 1A Log Inactive Assist')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values (
  'a1a00000-0000-4000-8000-000000000090',
  'Step 1A activity log gate',
  '2026-11-01',
  '2026-11-02',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

insert into public.tasks (
  id, event_id, committee_id, title, description, is_confidential,
  request_backup, primary_assignees, assist_assignees
)
select fixture.id,
  'a1a00000-0000-4000-8000-000000000090',
  cia.committee_id,
  fixture.title,
  fixture.description,
  fixture.is_confidential,
  fixture.request_backup,
  fixture.primary_assignees,
  fixture.assist_assignees
from (
  select committee_id from public.users
  where id = '22222222-2222-2222-2222-222222222222'
) cia
cross join (values
  (
    'b1a00000-0000-4000-8000-000000000090'::uuid,
    'Confidential assigned task',
    'Confidential assigned description',
    true,
    false,
    array[
      '33333333-3333-3333-3333-333333333333'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid
    ],
    array['88888888-8888-4888-8888-888888888888'::uuid]
  ),
  (
    'b1a00000-0000-4000-8000-000000000091'::uuid,
    'Non-confidential backup task',
    'Non-confidential backup description',
    false,
    true,
    '{}'::uuid[],
    '{}'::uuid[]
  ),
  (
    'b1a00000-0000-4000-8000-000000000092'::uuid,
    'Non-confidential ordinary task',
    'Non-confidential ordinary description',
    false,
    false,
    '{}'::uuid[],
    '{}'::uuid[]
  )
) fixture(
  id, title, description, is_confidential, request_backup,
  primary_assignees, assist_assignees
);

-- Capture trigger output before impersonation, while the SQL Editor is still
-- running as postgres. TEST RESULTS marks setup FAIL if any task has no log.
select set_config(
  'step1a.test9_setup_counts',
  jsonb_build_object(
    'confidential', (
      select count(*) from public.activity_log
      where task_id = 'b1a00000-0000-4000-8000-000000000090'
    ),
    'backup', (
      select count(*) from public.activity_log
      where task_id = 'b1a00000-0000-4000-8000-000000000091'
    ),
    'ordinary', (
      select count(*) from public.activity_log
      where task_id = 'b1a00000-0000-4000-8000-000000000092'
    )
  )::text,
  true
);

update public.users
set is_active = false
where id in (
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888'
);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '77777777-7777-4777-8777-777777777777',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_setup jsonb := current_setting('step1a.test9_setup_counts')::jsonb;
  v_confidential_logs integer := (v_setup ->> 'confidential')::integer;
  v_backup_logs integer := (v_setup ->> 'backup')::integer;
  v_ordinary_logs integer := (v_setup ->> 'ordinary')::integer;
  v_total_logs integer := v_confidential_logs + v_backup_logs + v_ordinary_logs;
  v_rows integer;
  v_no_profile uuid := gen_random_uuid();
begin
  v_results := v_results || format(E'\nSETUP_CONFIDENTIAL_LOG_EXISTS: %s',
    case when v_confidential_logs > 0 then 'PASS'
         else 'FAIL (trigger produced no row)' end);
  v_results := v_results || format(E'\nSETUP_BACKUP_LOG_EXISTS: %s',
    case when v_backup_logs > 0 then 'PASS'
         else 'FAIL (trigger produced no row)' end);
  v_results := v_results || format(E'\nSETUP_ORDINARY_LOG_EXISTS: %s',
    case when v_ordinary_logs > 0 then 'PASS'
         else 'FAIL (trigger produced no row)' end);

  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id = 'b1a00000-0000-4000-8000-000000000090'
  ) direct_changes;
  v_results := v_results || format(E'\nINACTIVE_FORMER_PRIMARY_ZERO_CHANGES: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '88888888-8888-4888-8888-888888888888',
      'role', 'authenticated'
    )::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id = 'b1a00000-0000-4000-8000-000000000090'
  ) direct_changes;
  v_results := v_results || format(E'\nINACTIVE_FORMER_ASSIST_ZERO_CHANGES: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_no_profile, 'role', 'authenticated')::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id in (
      'b1a00000-0000-4000-8000-000000000090',
      'b1a00000-0000-4000-8000-000000000091',
      'b1a00000-0000-4000-8000-000000000092'
    )
  ) direct_changes;
  v_results := v_results || format(E'\nNO_PROFILE_ZERO_CHANGES_INCLUDING_BACKUP: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '55555555-5555-4555-8555-555555555555',
      'role', 'authenticated'
    )::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id = 'b1a00000-0000-4000-8000-000000000091'
  ) direct_changes;
  v_results := v_results || format(
    E'\nACTIVE_UNASSIGNED_BACKUP_ZERO_CHANGES_INTENDED: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end
  );

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '33333333-3333-3333-3333-333333333333',
      'role', 'authenticated'
    )::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id = 'b1a00000-0000-4000-8000-000000000090'
  ) direct_changes;
  v_results := v_results || format(E'\nACTIVE_ASSIGNED_MEMBER_SEES_OWN_CHANGES: %s',
    case when v_rows = v_confidential_logs and v_rows > 0 then 'PASS'
         else 'FAIL (expected ' || v_confidential_logs || ', got ' || v_rows || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '11111111-1111-1111-1111-111111111111',
      'role', 'authenticated'
    )::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id in (
      'b1a00000-0000-4000-8000-000000000090',
      'b1a00000-0000-4000-8000-000000000091',
      'b1a00000-0000-4000-8000-000000000092'
    )
  ) direct_changes;
  v_results := v_results || format(E'\nACTIVE_ADMIN_SEES_ALL_CHANGES: %s',
    case when v_rows = v_total_logs and v_total_logs > 0 then 'PASS'
         else 'FAIL (expected ' || v_total_logs || ', got ' || v_rows || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '22222222-2222-2222-2222-222222222222',
      'role', 'authenticated'
    )::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id in (
      'b1a00000-0000-4000-8000-000000000090',
      'b1a00000-0000-4000-8000-000000000091',
      'b1a00000-0000-4000-8000-000000000092'
    )
  ) direct_changes;
  v_results := v_results || format(E'\nACTIVE_OWNING_COADMIN_SEES_ALL_SCOPE_CHANGES: %s',
    case when v_rows = v_total_logs and v_total_logs > 0 then 'PASS'
         else 'FAIL (expected ' || v_total_logs || ', got ' || v_rows || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '44444444-4444-4444-8444-444444444444',
      'role', 'authenticated'
    )::text,
    true
  );
  select count(*) into v_rows
  from (
    select changes from public.activity_log
    where task_id in (
      'b1a00000-0000-4000-8000-000000000090',
      'b1a00000-0000-4000-8000-000000000091',
      'b1a00000-0000-4000-8000-000000000092'
    )
  ) direct_changes;
  v_results := v_results || format(E'\nOTHER_COMMITTEE_COADMIN_ZERO_OUT_OF_SCOPE_CHANGES: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — real read callers, activity log, and definer helpers

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin', c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('a1a00000-0000-4000-8000-000000000060', 'Step 1A caller Active',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111'),
  ('a1a00000-0000-4000-8000-000000000061', 'Step 1A caller Archive',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');

insert into public.tasks (
  id, event_id, committee_id, title, description, phase, status, priority,
  task_type, due_date, call_time, end_time, primary_assignees,
  assist_assignees, is_confidential, request_backup, allowed_viewers
)
select fixture.id, fixture.event_id, fixture.committee_id,
  fixture.title, fixture.description, 'Setup', 'To Do', 'Medium',
  'Deliverable', null, null, null, fixture.primary_assignees,
  '{}'::uuid[], fixture.is_confidential, fixture.request_backup,
  fixture.allowed_viewers
from (
  select
    'b1a00000-0000-4000-8000-000000000060'::uuid as id,
    'a1a00000-0000-4000-8000-000000000060'::uuid as event_id,
    u.committee_id,
    'Allowed viewer RPC secret'::text as title,
    'Allowed viewer real description'::text as description,
    '{}'::uuid[] as primary_assignees,
    true as is_confidential,
    false as request_backup,
    array['66666666-6666-4666-8666-666666666666'::uuid] as allowed_viewers
  from public.users u where u.id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'b1a00000-0000-4000-8000-000000000061',
    'a1a00000-0000-4000-8000-000000000060', u.committee_id,
    'Active own public', 'Active own description', '{}'::uuid[], false, false, '{}'::uuid[]
  from public.users u where u.id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'b1a00000-0000-4000-8000-000000000062',
    'a1a00000-0000-4000-8000-000000000061', u.committee_id,
    'Archived own public', 'Archived own description',
    array['33333333-3333-3333-3333-333333333333'::uuid], false, false, '{}'::uuid[]
  from public.users u where u.id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'b1a00000-0000-4000-8000-000000000063',
    'a1a00000-0000-4000-8000-000000000061', u.committee_id,
    'Archived own confidential', 'Archived own confidential description',
    '{}'::uuid[], true, false, '{}'::uuid[]
  from public.users u where u.id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'b1a00000-0000-4000-8000-000000000064',
    'a1a00000-0000-4000-8000-000000000061', u.committee_id,
    'Archived other public backup', 'Archived other public description',
    '{}'::uuid[], false, true, '{}'::uuid[]
  from public.users u where u.id = '44444444-4444-4444-8444-444444444444'
  union all
  select 'b1a00000-0000-4000-8000-000000000065',
    'a1a00000-0000-4000-8000-000000000061', u.committee_id,
    'Archived other confidential backup', 'Archived other secret',
    '{}'::uuid[], true, true, '{}'::uuid[]
  from public.users u where u.id = '44444444-4444-4444-8444-444444444444'
) fixture;

update public.events set status = 'Archived'
where id = 'a1a00000-0000-4000-8000-000000000061';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_other_rows integer;
  v_imported integer;
  v_skipped integer;
  v_ok boolean;
begin
  select count(*) into v_rows
  from (select id, event_id, status from public.tasks
        where event_id = 'a1a00000-0000-4000-8000-000000000060'
          and status <> 'Completed') home_count;
  v_results := v_results || format(E'\nHOME_INCOMPLETE_COUNT_ADMIN_EXACT_2: %s',
    case when v_rows = 2 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222',
                      'role', 'authenticated')::text, true);
  select count(*) into v_rows
  from (select id, event_id, committee_id, phase, status, priority, task_type,
               due_date, call_time, end_time, primary_assignees, created_at
        from public.tasks
        where event_id = 'a1a00000-0000-4000-8000-000000000060') event_edit;
  v_results := v_results || format(E'\nEVENT_EDIT_RAW_COLUMNS_EXACT_2: %s',
    case when v_rows = 2 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  select imported_task_count, skipped_confidential_count
  into v_imported, v_skipped
  from public.get_archived_event_template(
    'a1a00000-0000-4000-8000-000000000061', '2026-12-01'
  );
  v_results := v_results || format(E'\nARCHIVE_TEMPLATE_OWN_PUBLIC_1_CONFIDENTIAL_1: %s',
    case when v_imported = 1 and v_skipped = 1 then 'PASS'
         else 'FAIL (imported=' || v_imported || ', skipped=' || v_skipped || ')' end);

  select count(*) filter (where task_id in (
           'b1a00000-0000-4000-8000-000000000060',
           'b1a00000-0000-4000-8000-000000000061',
           'b1a00000-0000-4000-8000-000000000062',
           'b1a00000-0000-4000-8000-000000000063')),
         count(*) filter (where task_id =
           'b1a00000-0000-4000-8000-000000000065')
  into v_rows, v_other_rows
  from public.activity_log;
  v_results := v_results || format(E'\nACTIVITY_LOG_OWN_VISIBLE_CONFIDENTIAL_OTHER_HIDDEN: %s',
    case when v_rows > 0 and v_other_rows = 0 then 'PASS'
         else 'FAIL (own=' || v_rows || ', other=' || v_other_rows || ')' end);

  select public.event_is_archived('a1a00000-0000-4000-8000-000000000061')
    and not public.event_is_archived('a1a00000-0000-4000-8000-000000000060')
  into v_ok;
  v_results := v_results || format(E'\nEVENT_IS_ARCHIVED_HELPER: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select public.task_update_assignees_are_valid(
    'b1a00000-0000-4000-8000-000000000061', '{}'::uuid[]
  ) and public.event_has_tasks_for_editor(
    'a1a00000-0000-4000-8000-000000000060'
  ) into v_ok;
  v_results := v_results || format(E'\nEDITOR_DEFINER_HELPERS_RETURN_TRUE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) into v_rows from public.list_active_task_assignees();
  v_results := v_results || format(E'\nACTIVE_ASSIGNEE_PICKER_CALLER_RETURNS_DATA: %s',
    case when v_rows > 0 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '55555555-5555-4555-8555-555555555555',
                      'role', 'authenticated')::text, true);
  select count(*) into v_rows
  from (select id, event_id, phase, status, priority, task_type, due_date,
               primary_assignees, assist_assignees, created_at
        from public.tasks
        where event_id = 'a1a00000-0000-4000-8000-000000000061') archives;
  v_results := v_results || format(E'\nARCHIVES_RAW_COLUMNS_EXACT_2_PUBLIC_ROWS: %s',
    case when v_rows = 2 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  select count(*) into v_rows
  from public.list_archived_event_assignees(
    'a1a00000-0000-4000-8000-000000000061'
  ) where id = '33333333-3333-3333-3333-333333333333';
  v_results := v_results || format(E'\nARCHIVED_ASSIGNEE_HELPER_RETURNS_NAME_ROW: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '66666666-6666-4666-8666-666666666666',
                      'role', 'authenticated')::text, true);
  select count(*) into v_rows from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000060';
  select count(*) into v_other_rows
  from public.get_task('b1a00000-0000-4000-8000-000000000060')
  where title = 'Allowed viewer RPC secret'
    and description = 'Allowed viewer real description';
  v_results := v_results || format(E'\nALLOWED_VIEWER_RAW_ZERO_GET_TASK_REAL_ONE: %s',
    case when v_rows = 0 and v_other_rows = 1 then 'PASS'
         else 'FAIL (raw=' || v_rows || ', rpc=' || v_other_rows || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — mixed-committee Edit Event regression and lifecycle guards

The owning Co-Admin must be able to save an event even though another
committee has tasks in it, including a backup-requested task the Co-Admin can
no longer raw-read.

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin', c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('a1a00000-0000-4000-8000-000000000070', 'Mixed committee edit before',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111'),
  ('a1a00000-0000-4000-8000-000000000071', 'Archive freeze regression',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');

insert into public.tasks (id, event_id, committee_id, title, phase, request_backup, primary_assignees)
select fixture.id, fixture.event_id, fixture.committee_id,
  fixture.title, 'Setup', fixture.request_backup, fixture.primary_assignees
from (
  select 'b1a00000-0000-4000-8000-000000000070'::uuid as id,
    'a1a00000-0000-4000-8000-000000000070'::uuid as event_id,
    committee_id, 'Owning committee task'::text as title,
    false as request_backup, '{}'::uuid[] as primary_assignees
  from public.users where id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'b1a00000-0000-4000-8000-000000000071',
    'a1a00000-0000-4000-8000-000000000070', committee_id,
    'Other committee backup task', true, '{}'::uuid[]
  from public.users where id = '44444444-4444-4444-8444-444444444444'
  union all
  select 'b1a00000-0000-4000-8000-000000000072',
    'a1a00000-0000-4000-8000-000000000070', committee_id,
    'Assignee guard task', false,
    array['33333333-3333-3333-3333-333333333333'::uuid]
  from public.users where id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'b1a00000-0000-4000-8000-000000000073',
    'a1a00000-0000-4000-8000-000000000071', committee_id,
    'Frozen archive task', false, '{}'::uuid[]
  from public.users where id = '22222222-2222-2222-2222-222222222222'
) fixture;

update public.events set status = 'Archived'
where id = 'a1a00000-0000-4000-8000-000000000071';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_rpc_ok boolean := true;
  v_guard_blocked boolean := false;
  v_archive_blocked boolean := false;
begin
  select count(*) into v_rows
  from public.tasks
  where event_id = 'a1a00000-0000-4000-8000-000000000070';
  v_results := v_results || format(E'\nCOADMIN_RAW_READS_OWN_TWO_NOT_OTHER_BACKUP: %s',
    case when v_rows = 2 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  begin
    perform public.edit_event_with_tasks(
      p_event_id => 'a1a00000-0000-4000-8000-000000000070',
      p_expected_updated_at => (
        select updated_at from public.events
        where id = 'a1a00000-0000-4000-8000-000000000070'
      ),
      p_name => 'Mixed committee edit after',
      p_description => null,
      p_start_date => '2026-11-01',
      p_end_date => '2026-11-02',
      p_status => 'Active',
      p_tasks_to_add => '[]'::jsonb,
      p_tasks_to_update => '[]'::jsonb,
      p_task_ids_to_delete => '{}'::uuid[]
    );
  exception when others then
    v_rpc_ok := false;
  end;
  v_results := v_results || format(E'\nCOADMIN_MIXED_COMMITTEE_EDIT_RPC_NO_ERROR: %s',
    case when v_rpc_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-3333-3333-333333333333',
                      'role', 'authenticated')::text, true);
  update public.tasks set status = 'In Progress'
  where id = 'b1a00000-0000-4000-8000-000000000072';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nASSIGNEE_STATUS_UPDATE_STILL_WORKS: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  begin
    update public.tasks set priority = 'High'
    where id = 'b1a00000-0000-4000-8000-000000000072';
  exception when others then
    v_guard_blocked := position('Assignees can only update' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nASSIGNEE_COLUMN_GUARD_REGRESSION: %s',
    case when v_guard_blocked then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '11111111-1111-1111-1111-111111111111',
                      'role', 'authenticated')::text, true);
  begin
    update public.tasks set status = 'Completed'
    where id = 'b1a00000-0000-4000-8000-000000000073';
  exception when others then
    v_archive_blocked := position('Tasks in Archived events are read-only' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nARCHIVE_FREEZE_TRIGGER_REGRESSION: %s',
    case when v_archive_blocked then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — inactive and profile-less callers read zero raw rows

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local'),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'step1a-inactive-admin@test.local'),
  ('99999999-9999-4999-8999-999999999999'::uuid, 'step1a-inactive-coadmin@test.local'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'step1a-inactive-primary@test.local'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'step1a-inactive-assist@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin', c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, fixture.role,
  case when fixture.role = 'Admin' then null else cia.committee_id end,
  fixture.is_active
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member', 'Member', true),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer', 'Member', true),
  ('88888888-8888-4888-8888-888888888888'::uuid,
   'step1a-inactive-admin@test.local', 'Step 1A Inactive Admin', 'Admin', true),
  ('99999999-9999-4999-8999-999999999999'::uuid,
   'step1a-inactive-coadmin@test.local', 'Step 1A Inactive Co-Admin', 'Co-Admin', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
   'step1a-inactive-primary@test.local', 'Step 1A Inactive Primary', 'Member', true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
   'step1a-inactive-assist@test.local', 'Step 1A Inactive Assist', 'Member', true)
) fixture(id, email, full_name, role, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('a1a00000-0000-4000-8000-000000000030', 'Step 1A inactive Active',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111'),
  ('a1a00000-0000-4000-8000-000000000031', 'Step 1A inactive Archive',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');

insert into public.tasks (
  id, event_id, committee_id, title, description, is_confidential,
  request_backup, primary_assignees, assist_assignees
)
select fixture.id, fixture.event_id, cia.committee_id,
  fixture.title, 'Sensitive inactive-caller content', fixture.is_confidential,
  true,
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid],
  array['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid]
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('b1a00000-0000-4000-8000-000000000030'::uuid,
   'a1a00000-0000-4000-8000-000000000030'::uuid,
   'Inactive Active confidential', true),
  ('b1a00000-0000-4000-8000-000000000031'::uuid,
   'a1a00000-0000-4000-8000-000000000031'::uuid,
   'Inactive Archived public', false)
) fixture(id, event_id, title, is_confidential);

update public.events set status = 'Archived'
where id = 'a1a00000-0000-4000-8000-000000000031';

update public.users set is_active = false
where id in (
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '88888888-8888-4888-8888-888888888888',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_no_profile uuid := gen_random_uuid();
  v_caller uuid;
  v_label text;
begin
  for v_caller, v_label in
    select * from (values
      ('88888888-8888-4888-8888-888888888888'::uuid, 'INACTIVE_ADMIN'),
      ('99999999-9999-4999-8999-999999999999'::uuid, 'INACTIVE_OWNING_COADMIN'),
      ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'INACTIVE_PRIMARY_ASSIGNEE'),
      ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'INACTIVE_ASSIST_ASSIGNEE')
    ) callers(id, label)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);
    select count(*) into v_rows
    from (select title, description from public.tasks
          where id in (
            'b1a00000-0000-4000-8000-000000000030',
            'b1a00000-0000-4000-8000-000000000031'
          )) visible;
    v_results := v_results || format(E'\n%s_ZERO_ROWS_INCLUDING_ARCHIVE: %s',
      v_label, case when v_rows = 0 then 'PASS'
                    else 'FAIL (got ' || v_rows || ')' end);
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_no_profile, 'role', 'authenticated')::text, true);
  select count(*) into v_rows
  from (select title, description from public.tasks
        where id in (
          'b1a00000-0000-4000-8000-000000000030',
          'b1a00000-0000-4000-8000-000000000031'
        )) visible;
  v_results := v_results || format(E'\nAUTHENTICATED_NO_PROFILE_ZERO_ROWS: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — UPDATE/DELETE gates and the unchanged assignee column guard

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local'),
  ('88888888-8888-4888-8888-888888888888'::uuid, 'step1a-inactive-admin@test.local'),
  ('99999999-9999-4999-8999-999999999999'::uuid, 'step1a-inactive-coadmin@test.local'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'step1a-inactive-assignee@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin', c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, fixture.role,
  case when fixture.role = 'Admin' then null else cia.committee_id end,
  fixture.is_active
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member', 'Member', true),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer', 'Member', true),
  ('88888888-8888-4888-8888-888888888888'::uuid,
   'step1a-inactive-admin@test.local', 'Step 1A Inactive Admin', 'Admin', true),
  ('99999999-9999-4999-8999-999999999999'::uuid,
   'step1a-inactive-coadmin@test.local', 'Step 1A Inactive Co-Admin', 'Co-Admin', true),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
   'step1a-inactive-assignee@test.local', 'Step 1A Inactive Assignee', 'Member', true)
) fixture(id, email, full_name, role, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('a1a00000-0000-4000-8000-000000000040', 'Step 1A write gates',
  '2026-11-01', '2026-11-02', 'Active',
  '11111111-1111-1111-1111-111111111111');

insert into public.tasks (
  id, event_id, committee_id, title, status, primary_assignees
)
select fixture.id, 'a1a00000-0000-4000-8000-000000000040',
  cia.committee_id, fixture.title, 'To Do', fixture.primary_assignees
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('b1a00000-0000-4000-8000-000000000040'::uuid, 'Admin update target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000041'::uuid, 'Admin delete target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000042'::uuid, 'Co-Admin update target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000043'::uuid, 'Co-Admin delete target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000044'::uuid, 'Assignee status target',
   array['33333333-3333-3333-3333-333333333333'::uuid]),
  ('b1a00000-0000-4000-8000-000000000045'::uuid, 'Assignee column target',
   array['33333333-3333-3333-3333-333333333333'::uuid]),
  ('b1a00000-0000-4000-8000-000000000046'::uuid, 'Inactive Admin target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000047'::uuid, 'Inactive Co-Admin target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000048'::uuid, 'Inactive assignee target',
   array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid]),
  ('b1a00000-0000-4000-8000-000000000049'::uuid, 'No-profile target', '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-00000000004a'::uuid, 'Invariant spare task', '{}'::uuid[])
) fixture(id, title, primary_assignees);

update public.users set is_active = false
where id in (
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_guard_blocked boolean := false;
  v_no_profile uuid := gen_random_uuid();
begin
  update public.tasks set priority = 'High'
  where id = 'b1a00000-0000-4000-8000-000000000040';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nACTIVE_ADMIN_UPDATE_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  delete from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000041';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nACTIVE_ADMIN_DELETE_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222',
                      'role', 'authenticated')::text, true);
  update public.tasks set priority = 'Critical'
  where id = 'b1a00000-0000-4000-8000-000000000042';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nACTIVE_OWNING_COADMIN_UPDATE_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  delete from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000043';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nACTIVE_OWNING_COADMIN_DELETE_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-3333-3333-333333333333',
                      'role', 'authenticated')::text, true);
  update public.tasks set status = 'In Progress'
  where id = 'b1a00000-0000-4000-8000-000000000044';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nACTIVE_ASSIGNEE_STATUS_UPDATE_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  begin
    update public.tasks set title = 'Forbidden assignee edit'
    where id = 'b1a00000-0000-4000-8000-000000000045';
  exception when others then
    v_guard_blocked := position('Assignees can only update' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nASSIGNEE_COLUMN_GUARD_BLOCKS_TITLE: %s',
    case when v_guard_blocked then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '88888888-8888-4888-8888-888888888888',
                      'role', 'authenticated')::text, true);
  update public.tasks set priority = 'Low'
  where id = 'b1a00000-0000-4000-8000-000000000046';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nINACTIVE_ADMIN_UPDATE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);
  delete from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000046';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nINACTIVE_ADMIN_DELETE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '99999999-9999-4999-8999-999999999999',
                      'role', 'authenticated')::text, true);
  delete from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000047';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nINACTIVE_COADMIN_DELETE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);
  update public.tasks set priority = 'Low'
  where id = 'b1a00000-0000-4000-8000-000000000047';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nINACTIVE_COADMIN_UPDATE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                      'role', 'authenticated')::text, true);
  update public.tasks set status = 'Completed'
  where id = 'b1a00000-0000-4000-8000-000000000048';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nINACTIVE_ASSIGNEE_UPDATE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);
  delete from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000048';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nINACTIVE_ASSIGNEE_DELETE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_no_profile, 'role', 'authenticated')::text, true);
  delete from public.tasks
  where id = 'b1a00000-0000-4000-8000-000000000049';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nNO_PROFILE_DELETE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);
  update public.tasks set priority = 'Low'
  where id = 'b1a00000-0000-4000-8000-000000000049';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nNO_PROFILE_UPDATE_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 6 — policy catalog and active-helper source

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin', c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('a1a00000-0000-4000-8000-000000000050', 'Step 1A catalog fixture',
  '2026-11-01', '2026-11-02', 'Active',
  '11111111-1111-1111-1111-111111111111');

insert into public.tasks (id, event_id, committee_id, title)
select 'b1a00000-0000-4000-8000-000000000050',
  'a1a00000-0000-4000-8000-000000000050', committee_id,
  'Step 1A catalog task'
from public.users where id = '22222222-2222-2222-2222-222222222222';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_ok boolean;
  v_select_qual text;
  v_update_qual text;
  v_update_check text;
  v_delete_qual text;
  v_my_role_definition text;
begin
  select count(*) into v_rows
  from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_select' and cmd = 'SELECT';
  v_results := v_results || format(E'\nONE_TASKS_SELECT_POLICY: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  select count(*) into v_rows
  from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_update' and cmd = 'UPDATE';
  v_results := v_results || format(E'\nONE_TASKS_UPDATE_POLICY: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  select count(*) into v_rows
  from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_delete' and cmd = 'DELETE';
  v_results := v_results || format(E'\nONE_TASKS_DELETE_POLICY: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  select qual into v_select_qual from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_select';
  select qual, with_check into v_update_qual, v_update_check from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_update';
  select qual into v_delete_qual from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_delete';

  v_ok := lower(v_select_qual) like '%my_role() is not null%'
    and lower(v_select_qual) not like '%request_backup%'
    and lower(v_select_qual) not like '%allowed_viewers%';
  v_results := v_results || format(E'\nSELECT_HAS_ACTIVE_GATE_AND_NO_REMOVED_PATHS: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_update_qual) like '%my_role() is not null%'
    and lower(v_update_check) like '%my_role() is not null%';
  v_results := v_results || format(E'\nUPDATE_USING_AND_CHECK_HAVE_ACTIVE_GATE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_delete_qual) like '%my_role() is not null%';
  v_results := v_results || format(E'\nDELETE_HAS_ACTIVE_GATE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select pg_get_functiondef('public.my_role()'::regprocedure)
  into v_my_role_definition;
  v_ok := lower(v_my_role_definition) like '%is_active = true%';
  v_results := v_results || format(E'\nMY_ROLE_STILL_REQUIRES_ACTIVE_PROFILE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and cmd in ('SELECT', 'UPDATE', 'DELETE');
  v_results := v_results || format(E'\nNO_EXTRA_TASK_COMMAND_POLICIES: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 7 — post-fix raw SELECT matrix

Run this and every later block only after the migration is on Dev. This block
uses direct `public.tasks` queries that include `title` and `description`.

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local'),
  ('77777777-7777-4777-8777-777777777777'::uuid, 'step1a-assist@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin',
  c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer'),
  ('77777777-7777-4777-8777-777777777777'::uuid,
   'step1a-assist@test.local', 'Step 1A Assist Assignee')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('a1a00000-0000-4000-8000-000000000010', 'Step 1A Active matrix',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111'),
  ('a1a00000-0000-4000-8000-000000000011', 'Step 1A Draft matrix',
   '2026-11-01', '2026-11-02', 'Draft', '11111111-1111-1111-1111-111111111111'),
  ('a1a00000-0000-4000-8000-000000000012', 'Step 1A Archive matrix',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');

with committees as (
  select 'CIA'::text as label, committee_id as id
  from public.users where id = '22222222-2222-2222-2222-222222222222'
  union all
  select 'Other', committee_id
  from public.users where id = '44444444-4444-4444-8444-444444444444'
), events as (
  select * from (values
    ('Active'::text, 'a1a00000-0000-4000-8000-000000000010'::uuid),
    ('Draft'::text, 'a1a00000-0000-4000-8000-000000000011'::uuid),
    ('Archived'::text, 'a1a00000-0000-4000-8000-000000000012'::uuid)
  ) value(label, id)
), confidentiality as (
  select * from (values
    ('Confidential'::text, true),
    ('Public'::text, false)
  ) value(label, is_confidential)
), task_fixtures as (
  select * from (values
    ('CIA'::text, 'Active'::text, true, 'b1a00000-0000-4000-8000-000000000100'::uuid),
    ('CIA', 'Active', false, 'b1a00000-0000-4000-8000-000000000101'::uuid),
    ('CIA', 'Draft', true, 'b1a00000-0000-4000-8000-000000000102'::uuid),
    ('CIA', 'Draft', false, 'b1a00000-0000-4000-8000-000000000103'::uuid),
    ('CIA', 'Archived', true, 'b1a00000-0000-4000-8000-000000000104'::uuid),
    ('CIA', 'Archived', false, 'b1a00000-0000-4000-8000-000000000105'::uuid),
    ('Other', 'Active', true, 'b1a00000-0000-4000-8000-000000000106'::uuid),
    ('Other', 'Active', false, 'b1a00000-0000-4000-8000-000000000107'::uuid),
    ('Other', 'Draft', true, 'b1a00000-0000-4000-8000-000000000108'::uuid),
    ('Other', 'Draft', false, 'b1a00000-0000-4000-8000-000000000109'::uuid),
    ('Other', 'Archived', true, 'b1a00000-0000-4000-8000-000000000110'::uuid),
    ('Other', 'Archived', false, 'b1a00000-0000-4000-8000-000000000111'::uuid)
  ) value(committee_label, event_label, is_confidential, id)
)
insert into public.tasks (
  id, event_id, committee_id, title, description, is_confidential,
  primary_assignees, assist_assignees, allowed_viewers
)
select
  task_fixtures.id,
  events.id,
  committees.id,
  committees.label || ' ' || events.label || ' ' || confidentiality.label,
  'Description for ' || committees.label || ' ' || events.label || ' ' || confidentiality.label,
  confidentiality.is_confidential,
  array['33333333-3333-3333-3333-333333333333'::uuid],
  array['77777777-7777-4777-8777-777777777777'::uuid],
  array['66666666-6666-4666-8666-666666666666'::uuid]
from task_fixtures
join committees on committees.label = task_fixtures.committee_label
join events on events.label = task_fixtures.event_label
join confidentiality
  on confidentiality.is_confidential = task_fixtures.is_confidential;

update public.events set status = 'Archived'
where id = 'a1a00000-0000-4000-8000-000000000012';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_bad_rows integer;
  v_cia_committee uuid := (
    select committee_id from public.users
    where id = '22222222-2222-2222-2222-222222222222'
  );
  v_other_committee uuid := (
    select committee_id from public.users
    where id = '44444444-4444-4444-8444-444444444444'
  );
begin
  select count(*) into v_rows
  from (select title, description from public.tasks
        where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012'
        )) visible;
  v_results := v_results || format(E'\nACTIVE_ADMIN_EXACT_12_ROWS: %s',
    case when v_rows = 12 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222',
                      'role', 'authenticated')::text, true);
  select count(*), count(*) filter (
    where committee_id <> v_cia_committee
      and not (event_id = 'a1a00000-0000-4000-8000-000000000012'
               and is_confidential = false)
  ) into v_rows, v_bad_rows
  from (select event_id, committee_id, is_confidential, title, description
        from public.tasks where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012')) visible;
  v_results := v_results || format(E'\nOWNING_COADMIN_EXACT_7_ROWS: %s',
    case when v_rows = 7 and v_bad_rows = 0 then 'PASS'
         else 'FAIL (rows=' || v_rows || ', unexpected=' || v_bad_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '44444444-4444-4444-8444-444444444444',
                      'role', 'authenticated')::text, true);
  select count(*), count(*) filter (
    where committee_id <> v_other_committee
      and not (event_id = 'a1a00000-0000-4000-8000-000000000012'
               and is_confidential = false)
  ) into v_rows, v_bad_rows
  from (select event_id, committee_id, is_confidential, title, description
        from public.tasks where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012')) visible;
  v_results := v_results || format(E'\nOTHER_COADMIN_EXACT_7_ROWS: %s',
    case when v_rows = 7 and v_bad_rows = 0 then 'PASS'
         else 'FAIL (rows=' || v_rows || ', unexpected=' || v_bad_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '33333333-3333-3333-3333-333333333333',
                      'role', 'authenticated')::text, true);
  select count(*), count(*) filter (
    where event_id = 'a1a00000-0000-4000-8000-000000000011'
  ) into v_rows, v_bad_rows
  from (select event_id, title, description from public.tasks
        where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012')) visible;
  v_results := v_results || format(E'\nPRIMARY_ASSIGNEE_EXACT_8_NON_DRAFT_ROWS: %s',
    case when v_rows = 8 and v_bad_rows = 0 then 'PASS'
         else 'FAIL (rows=' || v_rows || ', draft=' || v_bad_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '77777777-7777-4777-8777-777777777777',
                      'role', 'authenticated')::text, true);
  select count(*), count(*) filter (
    where event_id = 'a1a00000-0000-4000-8000-000000000011'
  ) into v_rows, v_bad_rows
  from (select event_id, title, description from public.tasks
        where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012')) visible;
  v_results := v_results || format(E'\nASSIST_ASSIGNEE_EXACT_8_NON_DRAFT_ROWS: %s',
    case when v_rows = 8 and v_bad_rows = 0 then 'PASS'
         else 'FAIL (rows=' || v_rows || ', draft=' || v_bad_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '55555555-5555-4555-8555-555555555555',
                      'role', 'authenticated')::text, true);
  select count(*), count(*) filter (
    where event_id <> 'a1a00000-0000-4000-8000-000000000012'
       or is_confidential
  ) into v_rows, v_bad_rows
  from (select event_id, is_confidential, title, description from public.tasks
        where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012')) visible;
  v_results := v_results || format(E'\nUNASSIGNED_MEMBER_EXACT_2_ARCHIVED_PUBLIC_ROWS: %s',
    case when v_rows = 2 and v_bad_rows = 0 then 'PASS'
         else 'FAIL (rows=' || v_rows || ', unexpected=' || v_bad_rows || ')' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '66666666-6666-4666-8666-666666666666',
                      'role', 'authenticated')::text, true);
  select count(*), count(*) filter (
    where event_id <> 'a1a00000-0000-4000-8000-000000000012'
       or is_confidential
  ) into v_rows, v_bad_rows
  from (select event_id, is_confidential, title, description from public.tasks
        where event_id in (
          'a1a00000-0000-4000-8000-000000000010',
          'a1a00000-0000-4000-8000-000000000011',
          'a1a00000-0000-4000-8000-000000000012')) visible;
  v_results := v_results || format(E'\nALLOWED_VIEWER_EXACT_2_ARCHIVED_PUBLIC_ROWS: %s',
    case when v_rows = 2 and v_bad_rows = 0 then 'PASS'
         else 'FAIL (rows=' || v_rows || ', unexpected=' || v_bad_rows || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 8 — backup and viewer flags grant no raw access

Archive late-share fixtures do not yet exist: Step 7B and its storage have not
been implemented. This test therefore covers every currently stored sharing
flag and keeps the late-share case explicitly marked not applicable.

```sql
-- The final TEST RESULTS exception intentionally aborts and rolls back this transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44444444-4444-4444-8444-444444444444'::uuid, 'step1a-other-coadmin@test.local'),
  ('55555555-5555-4555-8555-555555555555'::uuid, 'step1a-unassigned@test.local'),
  ('66666666-6666-4666-8666-666666666666'::uuid, 'step1a-viewer@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select '44444444-4444-4444-8444-444444444444',
  'step1a-other-coadmin@test.local', 'Step 1A Other Co-Admin', 'Co-Admin',
  c.id, true
from public.committees c
where c.id <> (select committee_id from public.users
               where id = '22222222-2222-2222-2222-222222222222')
order by c.name limit 1;

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, 'Member', cia.committee_id, true
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('55555555-5555-4555-8555-555555555555'::uuid,
   'step1a-unassigned@test.local', 'Step 1A Unassigned Member'),
  ('66666666-6666-4666-8666-666666666666'::uuid,
   'step1a-viewer@test.local', 'Step 1A Allowed Viewer')
) fixture(id, email, full_name);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('a1a00000-0000-4000-8000-000000000020', 'Step 1A removed Active paths',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111'),
  ('a1a00000-0000-4000-8000-000000000021', 'Step 1A removed Archive paths',
   '2026-11-01', '2026-11-02', 'Active', '11111111-1111-1111-1111-111111111111');

insert into public.tasks (
  id, event_id, committee_id, title, description, is_confidential,
  request_backup, allowed_viewers
)
select fixture.id, fixture.event_id, cia.committee_id,
  fixture.title, 'Secret content', fixture.is_confidential,
  fixture.request_backup, fixture.allowed_viewers
from (select committee_id from public.users
      where id = '22222222-2222-2222-2222-222222222222') cia
cross join (values
  ('b1a00000-0000-4000-8000-000000000020'::uuid,
   'a1a00000-0000-4000-8000-000000000020'::uuid,
   'Active backup only', true, true, '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000021'::uuid,
   'a1a00000-0000-4000-8000-000000000020'::uuid,
   'Active allowed viewer only', true, false,
   array['55555555-5555-4555-8555-555555555555'::uuid]),
  ('b1a00000-0000-4000-8000-000000000022'::uuid,
   'a1a00000-0000-4000-8000-000000000021'::uuid,
   'Archived confidential backup only', true, true, '{}'::uuid[]),
  ('b1a00000-0000-4000-8000-000000000023'::uuid,
   'a1a00000-0000-4000-8000-000000000021'::uuid,
   'Archived confidential allowed viewer only', true, false,
   array['55555555-5555-4555-8555-555555555555'::uuid]),
  ('b1a00000-0000-4000-8000-000000000024'::uuid,
   'a1a00000-0000-4000-8000-000000000021'::uuid,
   'Archived public lifecycle control', false, true, '{}'::uuid[])
) fixture(id, event_id, title, is_confidential, request_backup, allowed_viewers);

update public.events set status = 'Archived'
where id = 'a1a00000-0000-4000-8000-000000000021';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '55555555-5555-4555-8555-555555555555',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
begin
  select count(*) into v_rows
  from (select title, description from public.tasks
        where id in (
          'b1a00000-0000-4000-8000-000000000020',
          'b1a00000-0000-4000-8000-000000000021',
          'b1a00000-0000-4000-8000-000000000022',
          'b1a00000-0000-4000-8000-000000000023'
        )) removed_paths;
  v_results := v_results || format(E'\nBACKUP_AND_ALLOWED_VIEWER_RAW_ROWS_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  select count(*) into v_rows
  from (select title, description from public.tasks
        where id = 'b1a00000-0000-4000-8000-000000000024') archive_control;
  v_results := v_results || format(E'\nARCHIVED_PUBLIC_LIFECYCLE_ROW_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (got ' || v_rows || ')' end);

  v_results := v_results || E'\nARCHIVE_LATE_SHARE_ONLY: PASS (N/A until Step 7B exists)';
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```
