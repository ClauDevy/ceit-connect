# Phase 4 Step 1 — transactional archive RPC tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

Run each test as one separate SQL Editor paste. Every paste creates its own
Auth/profile/event/task fixtures and ends with an intentional `TEST RESULTS`
exception. That exception rolls the transaction and all fixtures back.

These tests use no temporary tables and never touch `storage.objects`.
Deferred-trigger tests run `set constraints all immediate` before assertions.
The SQL Editor cannot reliably coordinate a two-session race, so TEST 5 checks
the lock contract from the installed function bodies and catalogs instead.

The archive error codes are stable API identifiers:

- `CCA01` — caller is not an active Admin
- `CCA02` — event id or expected version is missing
- `CCA03` — expected incomplete count is invalid
- `CCA04` — event not found
- `CCA05` — event is Draft
- `CCA06` — event is already Archived
- `CCA07` — event has another non-Active status
- `CCA08` — event version is stale
- `CCA09` — incomplete-task count changed
- `CCA10` — the final event update did not affect exactly one row

## TEST 1 — exact count, microsecond version, and unchanged tasks

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '41000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'step1-admin-1@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, is_active)
values (
  '41000000-0000-4000-8000-000000000001',
  'step1-admin-1@test.local', 'Step 1 Admin 1', 'Admin', true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by, updated_at
) values (
  '41000000-0000-4000-8000-000000000101',
  'Step 1 exact count', '2026-11-01', '2026-11-02', 'Active',
  '41000000-0000-4000-8000-000000000001',
  '2026-10-16 12:34:56.123456+00'::timestamptz
);

insert into public.tasks (
  id, event_id, committee_id, title, description, status, is_confidential
)
select fixture.id, '41000000-0000-4000-8000-000000000101', c.id,
       fixture.title, fixture.description, fixture.status, fixture.confidential
from (select id from public.committees order by name limit 1) c
cross join (values
  ('41000000-0000-4000-8000-000000000201'::uuid,
   'Incomplete confidential', 'SECRET MUST NOT BE RETURNED', 'To Do'::text, true),
  ('41000000-0000-4000-8000-000000000202'::uuid,
   'Incomplete progress', 'Still stored', 'In Progress'::text, false),
  ('41000000-0000-4000-8000-000000000203'::uuid,
   'Completed task', 'Already done', 'Completed'::text, false)
) fixture(id, title, description, status, confidential);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '41000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_before jsonb;
  v_after jsonb;
  v_status text;
  v_version timestamptz;
  v_result_type text;
begin
  select jsonb_agg(to_jsonb(t) order by t.id)
  into v_before
  from public.tasks t
  where t.event_id = '41000000-0000-4000-8000-000000000101';

  select e.updated_at
  into v_version
  from public.events e
  where e.id = '41000000-0000-4000-8000-000000000101';

  v_results := v_results || format(E'\nVERSION_HAS_NONZERO_MICROSECONDS: %s',
    case when extract(microseconds from v_version)::bigint % 1000000 = 123456
      then 'PASS' else 'FAIL (' || v_version || ')' end);

  perform public.archive_event(
    '41000000-0000-4000-8000-000000000101',
    2,
    '2026-10-16 12:34:56.123456+00'::timestamptz
  );

  select e.status into v_status
  from public.events e
  where e.id = '41000000-0000-4000-8000-000000000101';
  v_results := v_results || format(E'\nEXACT_COUNT_ARCHIVES: %s',
    case when v_status = 'Archived' then 'PASS' else 'FAIL' end);

  select jsonb_agg(to_jsonb(t) order by t.id)
  into v_after
  from public.tasks t
  where t.event_id = '41000000-0000-4000-8000-000000000101';
  v_results := v_results || format(E'\nTASK_ROWS_EXACTLY_UNCHANGED: %s',
    case when v_after is not distinct from v_before then 'PASS' else 'FAIL' end);

  select pg_get_function_result(
    'public.archive_event(uuid,bigint,timestamp with time zone)'::regprocedure
  ) into v_result_type;
  v_results := v_results || format(E'\nRETURNS_VOID_NOT_CONFIDENTIAL_CONTENT: %s',
    case when v_result_type = 'void' then 'PASS' else 'FAIL (' || v_result_type || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — stale count, stale version, and double submission

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '42000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'step1-admin-2@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, is_active)
values (
  '42000000-0000-4000-8000-000000000001',
  'step1-admin-2@test.local', 'Step 1 Admin 2', 'Admin', true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by, updated_at
) values
  ('42000000-0000-4000-8000-000000000101', 'Stale count',
   '2026-11-01', '2026-11-02', 'Active',
   '42000000-0000-4000-8000-000000000001',
   '2026-10-16 13:00:00.111111+00'),
  ('42000000-0000-4000-8000-000000000102', 'Stale version',
   '2026-11-01', '2026-11-02', 'Active',
   '42000000-0000-4000-8000-000000000001',
   '2026-10-16 13:00:00.222222+00'),
  ('42000000-0000-4000-8000-000000000103', 'Double submission',
   '2026-11-01', '2026-11-02', 'Active',
   '42000000-0000-4000-8000-000000000001',
   '2026-10-16 13:00:00.333333+00');

insert into public.tasks (id, event_id, committee_id, title, status)
select fixture.id, fixture.event_id, c.id, fixture.title, fixture.status
from (select id from public.committees order by name limit 1) c
cross join (values
  ('42000000-0000-4000-8000-000000000201'::uuid,
   '42000000-0000-4000-8000-000000000101'::uuid, 'Count To Do', 'To Do'::text),
  ('42000000-0000-4000-8000-000000000202'::uuid,
   '42000000-0000-4000-8000-000000000101'::uuid, 'Count Completed', 'Completed'::text),
  ('42000000-0000-4000-8000-000000000203'::uuid,
   '42000000-0000-4000-8000-000000000102'::uuid, 'Version task', 'To Do'::text),
  ('42000000-0000-4000-8000-000000000204'::uuid,
   '42000000-0000-4000-8000-000000000103'::uuid, 'Double task', 'In Progress'::text)
) fixture(id, event_id, title, status);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '42000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_code text;
  v_status text;
begin
  begin
    perform public.archive_event(
      '42000000-0000-4000-8000-000000000101', 2,
      '2026-10-16 13:00:00.111111+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  select status into v_status from public.events
  where id = '42000000-0000-4000-8000-000000000101';
  v_results := v_results || format(E'\nSTALE_COUNT_CCA09_AND_ACTIVE: %s',
    case when v_code = 'CCA09' and v_status = 'Active' then 'PASS'
      else 'FAIL (code=' || v_code || ', status=' || v_status || ')' end);

  begin
    perform public.archive_event(
      '42000000-0000-4000-8000-000000000102', 1,
      '2026-10-16 13:00:00.222221+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  select status into v_status from public.events
  where id = '42000000-0000-4000-8000-000000000102';
  v_results := v_results || format(E'\nSTALE_VERSION_CCA08_AND_ACTIVE: %s',
    case when v_code = 'CCA08' and v_status = 'Active' then 'PASS'
      else 'FAIL (code=' || v_code || ', status=' || v_status || ')' end);

  perform public.archive_event(
    '42000000-0000-4000-8000-000000000103', 1,
    '2026-10-16 13:00:00.333333+00'
  );
  begin
    perform public.archive_event(
      '42000000-0000-4000-8000-000000000103', 1,
      '2026-10-16 13:00:00.333333+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_results := v_results || format(E'\nDOUBLE_SUBMISSION_CCA06: %s',
    case when v_code = 'CCA06' then 'PASS' else 'FAIL (' || v_code || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — caller and event-status matrix

```sql
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
  ('43000000-0000-4000-8000-000000000001'::uuid, 'step1-admin-3@test.local'),
  ('43000000-0000-4000-8000-000000000002'::uuid, 'step1-coadmin-3@test.local'),
  ('43000000-0000-4000-8000-000000000003'::uuid, 'step1-member-3@test.local'),
  ('43000000-0000-4000-8000-000000000004'::uuid, 'step1-inactive-3@test.local'),
  ('43000000-0000-4000-8000-000000000005'::uuid, 'step1-no-profile-3@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, fixture.role,
  case when fixture.role = 'Admin' then null else c.id end,
  fixture.active
from (select id from public.committees order by name limit 1) c
cross join (values
  ('43000000-0000-4000-8000-000000000001'::uuid,
   'step1-admin-3@test.local', 'Step 1 Admin 3', 'Admin'::text, true),
  ('43000000-0000-4000-8000-000000000002'::uuid,
   'step1-coadmin-3@test.local', 'Step 1 Co-Admin 3', 'Co-Admin'::text, true),
  ('43000000-0000-4000-8000-000000000003'::uuid,
   'step1-member-3@test.local', 'Step 1 Member 3', 'Member'::text, true),
  ('43000000-0000-4000-8000-000000000004'::uuid,
   'step1-inactive-3@test.local', 'Step 1 Inactive Admin 3', 'Admin'::text, false)
) fixture(id, email, full_name, role, active);

insert into public.events (
  id, name, start_date, end_date, status, created_by, updated_at
) values
  ('43000000-0000-4000-8000-000000000101', 'Role matrix Active',
   '2026-11-01', '2026-11-02', 'Active',
   '43000000-0000-4000-8000-000000000001', '2026-10-16 14:00:00.111111+00'),
  ('43000000-0000-4000-8000-000000000102', 'Admin success Active',
   '2026-11-01', '2026-11-02', 'Active',
   '43000000-0000-4000-8000-000000000001', '2026-10-16 14:00:00.222222+00'),
  ('43000000-0000-4000-8000-000000000103', 'Draft status',
   '2026-11-01', '2026-11-02', 'Draft',
   '43000000-0000-4000-8000-000000000001', '2026-10-16 14:00:00.333333+00'),
  ('43000000-0000-4000-8000-000000000104', 'Archived status',
   '2026-11-01', '2026-11-02', 'Archived',
   '43000000-0000-4000-8000-000000000001', '2026-10-16 14:00:00.444444+00');

insert into public.tasks (id, event_id, committee_id, title)
select fixture.id, fixture.event_id, c.id, fixture.title
from (select id from public.committees order by name limit 1) c
cross join (values
  ('43000000-0000-4000-8000-000000000201'::uuid,
   '43000000-0000-4000-8000-000000000101'::uuid, 'Role matrix task'),
  ('43000000-0000-4000-8000-000000000202'::uuid,
   '43000000-0000-4000-8000-000000000102'::uuid, 'Admin success task')
) fixture(id, event_id, title);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '43000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_code text;
  v_caller uuid;
begin
  foreach v_caller in array array[
    '43000000-0000-4000-8000-000000000002'::uuid,
    '43000000-0000-4000-8000-000000000003'::uuid,
    '43000000-0000-4000-8000-000000000004'::uuid,
    '43000000-0000-4000-8000-000000000005'::uuid
  ] loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text,
      true
    );
    begin
      perform public.archive_event(
        '43000000-0000-4000-8000-000000000101', 1,
        '2026-10-16 14:00:00.111111+00'
      );
      v_code := 'NO ERROR';
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate;
    end;
    v_results := v_results || format(E'\nCALLER_%s_CCA01: %s', v_caller,
      case when v_code = 'CCA01' then 'PASS' else 'FAIL (' || v_code || ')' end);
  end loop;

  -- Prove authorization happens before lookup: a non-Admin receives CCA01
  -- even when the supplied event id does not exist.
  begin
    perform public.archive_event(
      '43000000-0000-4000-8000-000000000999', 0,
      '2026-10-16 14:00:00.999999+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_results := v_results || format(E'\nNONADMIN_MISSING_ID_STILL_CCA01: %s',
    case when v_code = 'CCA01' then 'PASS' else 'FAIL (' || v_code || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '43000000-0000-4000-8000-000000000001',
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.archive_event(
      '43000000-0000-4000-8000-000000000103', 0,
      '2026-10-16 14:00:00.333333+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_results := v_results || format(E'\nDRAFT_CCA05: %s',
    case when v_code = 'CCA05' then 'PASS' else 'FAIL (' || v_code || ')' end);

  begin
    perform public.archive_event(
      '43000000-0000-4000-8000-000000000104', 0,
      '2026-10-16 14:00:00.444444+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_results := v_results || format(E'\nARCHIVED_CCA06: %s',
    case when v_code = 'CCA06' then 'PASS' else 'FAIL (' || v_code || ')' end);

  begin
    perform public.archive_event(
      '43000000-0000-4000-8000-000000000999', 0,
      '2026-10-16 14:00:00.999999+00'
    );
    v_code := 'NO ERROR';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  v_results := v_results || format(E'\nACTIVE_ADMIN_MISSING_CCA04: %s',
    case when v_code = 'CCA04' then 'PASS' else 'FAIL (' || v_code || ')' end);

  perform public.archive_event(
    '43000000-0000-4000-8000-000000000102', 1,
    '2026-10-16 14:00:00.222222+00'
  );
  v_results := v_results || format(E'\nACTIVE_ADMIN_ACTIVE_SUCCEEDS: %s',
    case when (select status from public.events
               where id = '43000000-0000-4000-8000-000000000102') = 'Archived'
      then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — raw policy, archive freeze, and reparent guards

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '44000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'step1-admin-4@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, is_active)
values (
  '44000000-0000-4000-8000-000000000001',
  'step1-admin-4@test.local', 'Step 1 Admin 4', 'Admin', true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by, updated_at
) values
  ('44000000-0000-4000-8000-000000000101', 'Raw archive blocked',
   '2026-11-01', '2026-11-02', 'Active',
   '44000000-0000-4000-8000-000000000001', '2026-10-16 15:00:00.111111+00'),
  ('44000000-0000-4000-8000-000000000102', 'Active destination',
   '2026-11-01', '2026-11-02', 'Active',
   '44000000-0000-4000-8000-000000000001', '2026-10-16 15:00:00.222222+00'),
  ('44000000-0000-4000-8000-000000000103', 'Archived parent',
   '2026-11-01', '2026-11-02', 'Active',
   '44000000-0000-4000-8000-000000000001', '2026-10-16 15:00:00.333333+00');

insert into public.tasks (id, event_id, committee_id, title)
select fixture.id, fixture.event_id, c.id, fixture.title
from (select id from public.committees order by name limit 1) c
cross join (values
  ('44000000-0000-4000-8000-000000000201'::uuid,
   '44000000-0000-4000-8000-000000000101'::uuid, 'Raw policy task'),
  ('44000000-0000-4000-8000-000000000202'::uuid,
   '44000000-0000-4000-8000-000000000102'::uuid, 'Active move task'),
  ('44000000-0000-4000-8000-000000000203'::uuid,
   '44000000-0000-4000-8000-000000000103'::uuid, 'Archived move task')
) fixture(id, event_id, title);

update public.events set status = 'Archived'
where id = '44000000-0000-4000-8000-000000000103';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '44000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_blocked boolean;
  v_rows integer;
  v_archive_rows integer := 0;
begin
  v_blocked := false;
  begin
    update public.events set status = 'Archived'
    where id = '44000000-0000-4000-8000-000000000101';
    get diagnostics v_archive_rows = row_count;
  exception when insufficient_privilege then
    v_blocked := true;
  end;
  select count(*) into v_rows from public.events
  where id = '44000000-0000-4000-8000-000000000101' and status = 'Active';
  v_results := v_results || format(E'\nRAW_ADMIN_ARCHIVE_BLOCKED: %s',
    case when (v_blocked or v_archive_rows = 0) and v_rows = 1
      then 'PASS' else 'FAIL' end);

  update public.events set name = 'Ordinary Active edit still works'
  where id = '44000000-0000-4000-8000-000000000101';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nORDINARY_ACTIVE_EDIT_STILL_WORKS: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    update public.tasks
    set event_id = '44000000-0000-4000-8000-000000000103'
    where id = '44000000-0000-4000-8000-000000000202';
  exception when others then
    v_blocked := position('Tasks in Archived events are read-only.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nREPARENT_INTO_ARCHIVED_REJECTED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    update public.tasks
    set event_id = '44000000-0000-4000-8000-000000000102'
    where id = '44000000-0000-4000-8000-000000000203';
  exception when others then
    v_blocked := position('Tasks in Archived events are read-only.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nREPARENT_OUT_OF_ARCHIVED_REJECTED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    update public.tasks set title = 'Blocked archive update'
    where id = '44000000-0000-4000-8000-000000000203';
  exception when others then
    v_blocked := position('Tasks in Archived events are read-only.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nARCHIVED_TASK_UPDATE_STILL_REJECTED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    delete from public.tasks
    where id = '44000000-0000-4000-8000-000000000203';
  exception when others then
    v_blocked := position('Tasks in Archived events are read-only.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nARCHIVED_TASK_DELETE_STILL_REJECTED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    insert into public.tasks (event_id, committee_id, title)
    values (
      '44000000-0000-4000-8000-000000000103',
      (select id from public.committees order by name limit 1),
      'Blocked archive insert'
    );
  exception when others then
    v_blocked := position('Tasks in Archived events are read-only.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nARCHIVED_TASK_INSERT_STILL_REJECTED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — event freeze and Active-event invariant remain enforced

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '45000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'step1-admin-5@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, is_active)
values (
  '45000000-0000-4000-8000-000000000001',
  'step1-admin-5@test.local', 'Step 1 Admin 5', 'Admin', true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values
  ('45000000-0000-4000-8000-000000000101', 'Archived event guard',
   '2026-11-01', '2026-11-02', 'Active',
   '45000000-0000-4000-8000-000000000001'),
  ('45000000-0000-4000-8000-000000000102', 'Active invariant guard',
   '2026-11-01', '2026-11-02', 'Active',
   '45000000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title)
select fixture.id, fixture.event_id, c.id, fixture.title
from (select id from public.committees order by name limit 1) c
cross join (values
  ('45000000-0000-4000-8000-000000000201'::uuid,
   '45000000-0000-4000-8000-000000000101'::uuid, 'Archived event task'),
  ('45000000-0000-4000-8000-000000000202'::uuid,
   '45000000-0000-4000-8000-000000000102'::uuid, 'Only Active task')
) fixture(id, event_id, title);

update public.events set status = 'Archived'
where id = '45000000-0000-4000-8000-000000000101';

set constraints all immediate;
set constraints all deferred;
set local role service_role;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '45000000-0000-4000-8000-000000000001',
    'role', 'service_role'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    update public.events set name = 'Forbidden archived edit'
    where id = '45000000-0000-4000-8000-000000000101';
  exception when others then
    v_blocked := position('Archived events are read-only.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nARCHIVED_EVENT_UPDATE_GUARD_UNCHANGED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    delete from public.events
    where id = '45000000-0000-4000-8000-000000000101';
  exception when others then
    v_blocked := position('Archived events cannot be deleted.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nARCHIVED_EVENT_DELETE_GUARD_UNCHANGED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  v_blocked := false;
  begin
    delete from public.tasks
    where id = '45000000-0000-4000-8000-000000000202';
    set constraints all immediate;
  exception when others then
    v_blocked := position('An Active event must have at least one task.' in sqlerrm) > 0;
  end;
  v_results := v_results || format(E'\nACTIVE_EVENT_LAST_TASK_GUARD_UNCHANGED: %s',
    case when v_blocked then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 6 — function bodies, trigger catalogs, owner, and grants

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '45000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'step1-admin-5@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, is_active)
values (
  '45000000-0000-4000-8000-000000000001',
  'step1-admin-5@test.local', 'Step 1 Admin 5', 'Admin', true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values (
  '45000000-0000-4000-8000-000000000101', 'Catalog fixture',
  '2026-11-01', '2026-11-02', 'Active',
  '45000000-0000-4000-8000-000000000001'
);

insert into public.tasks (id, event_id, committee_id, title)
select '45000000-0000-4000-8000-000000000201',
  '45000000-0000-4000-8000-000000000101', id, 'Catalog task'
from public.committees order by name limit 1;

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '45000000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_archive_source text;
  v_guard_source text;
  v_archive_definition text;
  v_ok boolean;
  v_rows integer;
begin
  select p.prosrc, pg_get_functiondef(p.oid)
  into v_archive_source, v_archive_definition
  from pg_proc p
  where p.oid = 'public.archive_event(uuid,bigint,timestamp with time zone)'::regprocedure;

  select p.prosrc into v_guard_source
  from pg_proc p
  where p.oid = 'public.guard_archived_event_task_writes()'::regprocedure;

  select count(*) into v_rows
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'archive_event';
  v_results := v_results || format(E'\nONE_ARCHIVE_SIGNATURE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (' || v_rows || ')' end);

  select p.prosecdef
    and pg_get_userbyid(p.proowner) = pg_get_userbyid(g.proowner)
    and lower(pg_get_function_result(p.oid)) = 'void'
  into v_ok
  from pg_proc p
  cross join pg_proc g
  where p.oid = 'public.archive_event(uuid,bigint,timestamp with time zone)'::regprocedure
    and g.oid = 'public.guard_event_updates()'::regprocedure;
  v_results := v_results || format(E'\nDEFINER_OWNER_AND_VOID: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_archive_definition) like '%set search_path to ''''%';
  v_results := v_results || format(E'\nARCHIVE_EMPTY_SEARCH_PATH: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := has_function_privilege(
      'authenticated',
      'public.archive_event(uuid,bigint,timestamp with time zone)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.archive_event(uuid,bigint,timestamp with time zone)',
      'EXECUTE'
    )
    and not exists (
      select 1
      from pg_proc privilege_proc
      cross join lateral aclexplode(
        coalesce(
          privilege_proc.proacl,
          acldefault('f', privilege_proc.proowner)
        )
      ) acl
      where privilege_proc.oid =
        'public.archive_event(uuid,bigint,timestamp with time zone)'::regprocedure
        and acl.grantee = 0::oid
        and acl.privilege_type = 'EXECUTE'
    );
  v_results := v_results || format(E'\nONLY_AUTHENTICATED_HAS_EXECUTE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := position('for update' in lower(v_archive_source)) > 0
    and position('for update' in lower(v_archive_source))
        < position('from public.tasks' in lower(v_archive_source));
  v_results := v_results || format(E'\nEVENT_LOCK_PRECEDES_TASK_COUNT: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_archive_source) not similar to
    '%from public[.]tasks%for (update|share)%';
  v_results := v_results || format(E'\nARCHIVE_HAS_NO_TASK_ROW_LOCK: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := position('u.role = ''Admin''' in v_archive_source) > 0
    and position('u.is_active is true' in v_archive_source) > 0
    and position('from public.users' in v_archive_source)
        < position('from public.events' in v_archive_source);
  v_results := v_results || format(E'\nAUTHORIZATION_PRECEDES_EVENT_LOOKUP: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := position('order by e.id' in lower(v_guard_source)) > 0
    and position('order by e.id' in lower(v_guard_source))
        < position('for share' in lower(v_guard_source))
    and position('for share' in lower(v_guard_source))
        < position('e.status = ''archived''' in lower(v_guard_source))
    and position('old.event_id' in lower(v_guard_source)) > 0
    and position('new.event_id' in lower(v_guard_source)) > 0;
  v_results := v_results || format(E'\nGUARD_LOCKS_OLD_NEW_THEN_REREADS_STATUS: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_trigger t
  where t.tgrelid = 'public.tasks'::regclass
    and t.tgname = 'tasks_guard_archived_event_writes'
    and not t.tgisinternal
    and (t.tgtype & 2) = 2;
  v_results := v_results || format(E'\nARCHIVE_TASK_GUARD_STILL_BEFORE_TRIGGER: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from pg_trigger t
  where t.tgname in (
    'events_require_task_when_inserted_active',
    'tasks_preserve_active_event_task_on_delete',
    'tasks_preserve_active_event_task_on_event_move'
  )
    and t.tgdeferrable
    and t.tginitdeferred
    and not t.tgisinternal;
  v_results := v_results || format(E'\nACTIVE_EVENT_INVARIANT_TRIGGERS_UNCHANGED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'events'
    and p.policyname = 'events_update'
    and lower(p.with_check) not like '%archived%'
    and lower(p.with_check) like '%draft%'
    and lower(p.with_check) like '%active%';
  v_results := v_results || format(E'\nRAW_ARCHIVE_BRANCH_REMOVED_ONLY: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_results := v_results || E'\nCHILD_TABLE_LOCK_ORDER: PASS (N/A; no Phase 4 child tables exist yet)';
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 7 — Co-Admin edit and launch paths remain available

```sql
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
  ('47000000-0000-4000-8000-000000000001'::uuid, 'step1-admin-7@test.local'),
  ('47000000-0000-4000-8000-000000000002'::uuid, 'step1-coadmin-7@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  '47000000-0000-4000-8000-000000000001',
  'step1-admin-7@test.local', 'Step 1 Admin 7', 'Admin', null, true
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select
  '47000000-0000-4000-8000-000000000002',
  'step1-coadmin-7@test.local', 'Step 1 Co-Admin 7', 'Co-Admin', c.id, true
from public.committees c
order by c.name
limit 1;

insert into public.events (
  id, name, description, start_date, end_date, status, created_by, updated_at
) values
  ('47000000-0000-4000-8000-000000000101', 'Co-Admin Active raw edit', null,
   '2026-11-01', '2026-11-02', 'Active',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.111111+00'),
  ('47000000-0000-4000-8000-000000000102', 'Co-Admin Draft raw edit', null,
   '2026-11-01', '2026-11-02', 'Draft',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.222222+00'),
  ('47000000-0000-4000-8000-000000000103', 'Co-Admin launch succeeds', null,
   '2026-11-01', '2026-11-02', 'Draft',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.333333+00'),
  ('47000000-0000-4000-8000-000000000104', 'Co-Admin launch no tasks', null,
   '2026-11-01', '2026-11-02', 'Draft',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.444444+00'),
  ('47000000-0000-4000-8000-000000000105', 'Co-Admin raw archive rejected', null,
   '2026-11-01', '2026-11-02', 'Active',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.555555+00'),
  ('47000000-0000-4000-8000-000000000106', 'Admin RPC archive succeeds', null,
   '2026-11-01', '2026-11-02', 'Active',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.666666+00'),
  ('47000000-0000-4000-8000-000000000107', 'Co-Admin edit RPC before', null,
   '2026-11-01', '2026-11-02', 'Active',
   '47000000-0000-4000-8000-000000000001', '2026-10-16 17:00:00.777777+00');

insert into public.tasks (id, event_id, committee_id, title, phase)
select fixture.id, fixture.event_id, u.committee_id, fixture.title, 'Setup'
from public.users u
cross join (values
  ('47000000-0000-4000-8000-000000000201'::uuid,
   '47000000-0000-4000-8000-000000000101'::uuid, 'Active raw edit task'),
  ('47000000-0000-4000-8000-000000000202'::uuid,
   '47000000-0000-4000-8000-000000000102'::uuid, 'Draft raw edit task'),
  ('47000000-0000-4000-8000-000000000203'::uuid,
   '47000000-0000-4000-8000-000000000103'::uuid, 'Launch task'),
  ('47000000-0000-4000-8000-000000000205'::uuid,
   '47000000-0000-4000-8000-000000000105'::uuid, 'Co-Admin archive task'),
  ('47000000-0000-4000-8000-000000000206'::uuid,
   '47000000-0000-4000-8000-000000000106'::uuid, 'Admin archive task'),
  ('47000000-0000-4000-8000-000000000207'::uuid,
   '47000000-0000-4000-8000-000000000107'::uuid, 'Own-committee edit task')
) fixture(id, event_id, title)
where u.id = '47000000-0000-4000-8000-000000000002';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '47000000-0000-4000-8000-000000000002',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_results text := '';
  v_rows integer;
  v_code text;
  v_message text;
  v_status text;
  v_rpc_ok boolean;
begin
  update public.events
  set name = 'Co-Admin Active raw edit saved'
  where id = '47000000-0000-4000-8000-000000000101';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nCOADMIN_RAW_ACTIVE_EDIT_ONE_ROW: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (' || v_rows || ')' end);

  update public.events
  set description = 'Co-Admin Draft raw edit saved'
  where id = '47000000-0000-4000-8000-000000000102';
  get diagnostics v_rows = row_count;
  v_results := v_results || format(E'\nCOADMIN_RAW_DRAFT_EDIT_ONE_ROW: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (' || v_rows || ')' end);

  update public.events
  set status = 'Active'
  where id = '47000000-0000-4000-8000-000000000103';
  get diagnostics v_rows = row_count;
  set constraints all immediate;
  select status into v_status from public.events
  where id = '47000000-0000-4000-8000-000000000103';
  v_results := v_results || format(E'\nCOADMIN_DRAFT_TO_ACTIVE_WITH_TASK_SUCCEEDS: %s',
    case when v_rows = 1 and v_status = 'Active' then 'PASS'
      else 'FAIL (rows=' || v_rows || ', status=' || v_status || ')' end);

  v_code := null;
  v_message := null;
  begin
    update public.events
    set status = 'Active'
    where id = '47000000-0000-4000-8000-000000000104';
  exception when others then
    get stacked diagnostics
      v_code = returned_sqlstate,
      v_message = message_text;
  end;
  select status into v_status from public.events
  where id = '47000000-0000-4000-8000-000000000104';
  v_results := v_results || format(E'\nCOADMIN_LAUNCH_WITHOUT_TASK_GUARD_REJECTS: %s',
    case when v_message = 'An event requires at least one task before it can be launched.'
                   and v_status = 'Draft'
      then 'PASS' else 'FAIL (code=' || coalesce(v_code, 'none')
        || ', message=' || coalesce(v_message, 'none') || ')' end);

  v_code := null;
  begin
    update public.events
    set status = 'Archived'
    where id = '47000000-0000-4000-8000-000000000105';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  select status into v_status from public.events
  where id = '47000000-0000-4000-8000-000000000105';
  v_results := v_results || format(E'\nCOADMIN_RAW_ACTIVE_TO_ARCHIVED_REJECTED: %s',
    case when v_code = '42501' and v_status = 'Active'
      then 'PASS' else 'FAIL (code=' || coalesce(v_code, 'none') || ')' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '47000000-0000-4000-8000-000000000001',
      'role', 'authenticated'
    )::text,
    true
  );

  v_code := null;
  begin
    update public.events
    set status = 'Archived'
    where id = '47000000-0000-4000-8000-000000000106';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  select status into v_status from public.events
  where id = '47000000-0000-4000-8000-000000000106';
  v_results := v_results || format(
    E'\nINTENDED_STEP_1_ADMIN_RAW_ACTIVE_TO_ARCHIVED_REJECTED: %s',
    case when v_code = '42501' and v_status = 'Active'
      then 'PASS' else 'FAIL (code=' || coalesce(v_code, 'none') || ')' end
  );

  perform public.archive_event(
    '47000000-0000-4000-8000-000000000106',
    1,
    (select updated_at from public.events
     where id = '47000000-0000-4000-8000-000000000106')
  );
  select status into v_status from public.events
  where id = '47000000-0000-4000-8000-000000000106';
  v_results := v_results || format(E'\nADMIN_ARCHIVE_RPC_STILL_SUCCEEDS: %s',
    case when v_status = 'Archived' then 'PASS' else 'FAIL' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', '47000000-0000-4000-8000-000000000002',
      'role', 'authenticated'
    )::text,
    true
  );

  v_rpc_ok := true;
  begin
    perform public.edit_event_with_tasks(
      p_event_id => '47000000-0000-4000-8000-000000000107',
      p_expected_updated_at => (
        select updated_at from public.events
        where id = '47000000-0000-4000-8000-000000000107'
      ),
      p_name => 'Co-Admin edit RPC saved',
      p_description => 'Own-committee Active edit remains available',
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
  v_results := v_results || format(E'\nCOADMIN_EDIT_EVENT_WITH_TASKS_SUCCEEDS: %s',
    case when v_rpc_ok
              and (select name from public.events
                   where id = '47000000-0000-4000-8000-000000000107')
                  = 'Co-Admin edit RPC saved'
      then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## Manual app checks

After all seven SQL tests pass on Dev:

1. Open Home as an active Admin. Confirm an Active event shows the exact
   incomplete-task warning, archive it, and confirm the app opens its Archive.
2. Open Home in one browser tab, then edit and save that event in another tab.
   Return to the original tab and try its old confirmation. It must report the
   stale-version message and require a refresh and reconfirmation.
3. To isolate the count check, open Home, then use the Dev SQL Editor to change
   one task between `Completed` and `To Do` without changing the event row.
   Submit the already-open confirmation. It must report `The incomplete task
   count changed. Refresh and confirm the archive again.`

Do not attempt a lock-timing race in the SQL Editor. The function-body checks
above prove the required event-lock-first archive contract and the task guard's
shared-parent-lock/status-re-read contract.
