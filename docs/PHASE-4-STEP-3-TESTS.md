# Phase 4 Step 3 — read-only task detail tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

Apply `20261017120000_read_only_task_detail.sql` to Dev through the owner's
normal process before running these tests. Each test below is one
self-contained SQL Editor paste with its own `auth.users`, profile, event, and
task fixtures. Every paste sets its own caller claims and ends with an
intentional `raise exception 'TEST RESULTS ...'`; that final exception rolls
the transaction back.

No test uses a temporary table or touches `storage.objects`. Deferred
constraints are forced with `set constraints all immediate` before assertions.
The internal helper parity test runs as the migration owner because
`task_content_access()` is deliberately not executable by `authenticated`;
the catalog test separately proves that restriction. Read-only race properties
are checked through volatility and function-body catalogs rather than a second
session.

Comments and persisted work links do not exist yet. These tests prove immediate
revocation for `get_task_detail()` now. Steps 4 and 9 must call
`task_content_access()` in their own readers and repeat revocation coverage for
their child data.

## TEST 1 — Active role matrix, exact masked shell, and unknown IDs

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
  ('43100000-0000-4000-8000-000000000001'::uuid, 's3-admin@test.local'),
  ('43100000-0000-4000-8000-000000000002'::uuid, 's3-co-own@test.local'),
  ('43100000-0000-4000-8000-000000000003'::uuid, 's3-co-other@test.local'),
  ('43100000-0000-4000-8000-000000000004'::uuid, 's3-primary@test.local'),
  ('43100000-0000-4000-8000-000000000005'::uuid, 's3-assist@test.local'),
  ('43100000-0000-4000-8000-000000000006'::uuid, 's3-viewer@test.local'),
  ('43100000-0000-4000-8000-000000000007'::uuid, 's3-member@test.local'),
  ('43100000-0000-4000-8000-000000000008'::uuid, 's3-inactive@test.local'),
  ('43100000-0000-4000-8000-000000000009'::uuid, 's3-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.full_name, fixture.role,
  case when fixture.committee_number = 0 then null else (
    select id from public.committees order by name
    offset fixture.committee_number - 1 limit 1
  ) end,
  fixture.is_active
from (values
  ('43100000-0000-4000-8000-000000000001'::uuid, 's3-admin@test.local', 'Admin', 'Admin', 0, true),
  ('43100000-0000-4000-8000-000000000002'::uuid, 's3-co-own@test.local', 'Owning Co-Admin', 'Co-Admin', 1, true),
  ('43100000-0000-4000-8000-000000000003'::uuid, 's3-co-other@test.local', 'Other Co-Admin', 'Co-Admin', 2, true),
  ('43100000-0000-4000-8000-000000000004'::uuid, 's3-primary@test.local', 'Primary Member', 'Member', 1, true),
  ('43100000-0000-4000-8000-000000000005'::uuid, 's3-assist@test.local', 'Assist Member', 'Member', 1, true),
  ('43100000-0000-4000-8000-000000000006'::uuid, 's3-viewer@test.local', 'Allowed Viewer', 'Member', 1, true),
  ('43100000-0000-4000-8000-000000000007'::uuid, 's3-member@test.local', 'Unassigned Member', 'Member', 1, true),
  ('43100000-0000-4000-8000-000000000008'::uuid, 's3-inactive@test.local', 'Inactive Member', 'Member', 1, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('43110000-0000-4000-8000-000000000001', 'Step 3 Active',
  '2026-11-01', '2026-11-02', 'Active',
  '43100000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, description, phase, status, priority,
  task_type, due_date, primary_assignees, assist_assignees,
  is_confidential, allowed_viewers
)
select '43120000-0000-4000-8000-000000000001',
  '43110000-0000-4000-8000-000000000001', id,
  'Confidential Active', 'Secret description', 'Preparation', 'To Do',
  'Medium', 'Deliverable', now() + interval '2 days',
  array['43100000-0000-4000-8000-000000000004'::uuid],
  array['43100000-0000-4000-8000-000000000005'::uuid], true,
  array['43100000-0000-4000-8000-000000000006'::uuid]
from public.committees order by name limit 1;

insert into public.tasks (
  id, event_id, committee_id, title, description, phase, is_confidential
)
select '43120000-0000-4000-8000-000000000002',
  '43110000-0000-4000-8000-000000000001', id,
  'Public Active', 'Public description', 'Execution', false
from public.committees order by name limit 1;

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_callers uuid[] := array[
    '43100000-0000-4000-8000-000000000001'::uuid,
    '43100000-0000-4000-8000-000000000002'::uuid,
    '43100000-0000-4000-8000-000000000003'::uuid,
    '43100000-0000-4000-8000-000000000004'::uuid,
    '43100000-0000-4000-8000-000000000005'::uuid,
    '43100000-0000-4000-8000-000000000006'::uuid,
    '43100000-0000-4000-8000-000000000007'::uuid,
    '43100000-0000-4000-8000-000000000008'::uuid,
    '43100000-0000-4000-8000-000000000009'::uuid
  ];
  v_caller uuid;
  v_index integer := 0;
  v_rows integer;
  v_masked boolean;
  v_exact_shell boolean;
  v_ok boolean := true;
  v_results text := '';
begin
  foreach v_caller in array v_callers loop
    v_index := v_index + 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);

    select count(*), coalesce(bool_or(d.is_masked), false)
      into v_rows, v_masked
    from public.get_task_detail('43120000-0000-4000-8000-000000000001') d;

    if v_index in (1, 2, 4, 5, 6) then
      v_ok := v_ok and v_rows = 1 and not v_masked;
    elsif v_index in (3, 7) then
      v_ok := v_ok and v_rows = 1 and v_masked;
    else
      v_ok := v_ok and v_rows = 0;
    end if;

    select coalesce(bool_and(
      d.id = '43120000-0000-4000-8000-000000000001'::uuid
      and d.title = 'Confidential Task'
      and d.phase = 'Preparation'
      and d.status = 'To Do'
      and d.is_masked
      and d.event_id is null and d.event_name is null
      and d.event_status is null and d.description is null
      and d.effective_priority is null and d.task_type is null
      and d.due_date is null and d.call_time is null and d.end_time is null
      and d.created_at is null and d.committee_id is null
      and d.committee_name is null
      and d.primary_assignees = '[]'::jsonb
      and d.assist_assignees = '[]'::jsonb
      and d.is_confidential is null
      and d.has_dependency is null and d.is_blocked is null
      and d.dependency_label is null and d.access_list = '[]'::jsonb
    ), false) into v_exact_shell
    from public.get_task_detail('43120000-0000-4000-8000-000000000001') d
    where d.is_masked;
    if v_index in (3, 7) then
      v_ok := v_ok and v_exact_shell;
    end if;

    select count(*), coalesce(bool_or(d.is_masked), false)
      into v_rows, v_masked
    from public.get_task_detail('43120000-0000-4000-8000-000000000002') d;
    if v_index <= 7 then
      v_ok := v_ok and v_rows = 1 and not v_masked;
    else
      v_ok := v_ok and v_rows = 0;
    end if;

    select count(*) into v_rows
    from public.get_task_detail('43129999-0000-4000-8000-000000000099');
    v_ok := v_ok and v_rows = 0;
  end loop;

  v_results := v_results || format(E'\nACTIVE_ALL_ROLES_AND_EXACT_SHELL: %s',
    case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nUNKNOWN_ID_ZERO_ROWS_FOR_EVERY_ROLE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — Draft and Archived lifecycle matrices

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('43200000-0000-4000-8000-000000000001'::uuid, 's3-life-admin@test.local'),
  ('43200000-0000-4000-8000-000000000002'::uuid, 's3-life-own@test.local'),
  ('43200000-0000-4000-8000-000000000003'::uuid, 's3-life-other-co@test.local'),
  ('43200000-0000-4000-8000-000000000004'::uuid, 's3-life-primary@test.local'),
  ('43200000-0000-4000-8000-000000000005'::uuid, 's3-life-assist@test.local'),
  ('43200000-0000-4000-8000-000000000006'::uuid, 's3-life-viewer@test.local'),
  ('43200000-0000-4000-8000-000000000007'::uuid, 's3-life-member@test.local'),
  ('43200000-0000-4000-8000-000000000008'::uuid, 's3-life-inactive@test.local'),
  ('43200000-0000-4000-8000-000000000009'::uuid, 's3-life-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select id, email, full_name, role,
  case when committee_number = 0 then null else (
    select id from public.committees order by name
    offset committee_number - 1 limit 1
  ) end,
  is_active
from (values
  ('43200000-0000-4000-8000-000000000001'::uuid, 's3-life-admin@test.local', 'Admin', 'Admin', 0, true),
  ('43200000-0000-4000-8000-000000000002'::uuid, 's3-life-own@test.local', 'Owning Co', 'Co-Admin', 1, true),
  ('43200000-0000-4000-8000-000000000003'::uuid, 's3-life-other-co@test.local', 'Other Co', 'Co-Admin', 2, true),
  ('43200000-0000-4000-8000-000000000004'::uuid, 's3-life-primary@test.local', 'Primary', 'Member', 1, true),
  ('43200000-0000-4000-8000-000000000005'::uuid, 's3-life-assist@test.local', 'Assist', 'Member', 1, true),
  ('43200000-0000-4000-8000-000000000006'::uuid, 's3-life-viewer@test.local', 'Viewer', 'Member', 1, true),
  ('43200000-0000-4000-8000-000000000007'::uuid, 's3-life-member@test.local', 'Member', 'Member', 1, true),
  ('43200000-0000-4000-8000-000000000008'::uuid, 's3-life-inactive@test.local', 'Inactive', 'Member', 1, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('43210000-0000-4000-8000-000000000001', 'Draft Event',
   '2026-11-03', null, 'Draft', '43200000-0000-4000-8000-000000000001'),
  ('43210000-0000-4000-8000-000000000002', 'Archive Event',
   '2026-11-04', '2026-11-05', 'Active', '43200000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, is_confidential,
  primary_assignees, assist_assignees, allowed_viewers
)
select task_id, event_id, c.id, title, confidential,
  array['43200000-0000-4000-8000-000000000004'::uuid],
  array['43200000-0000-4000-8000-000000000005'::uuid],
  array['43200000-0000-4000-8000-000000000006'::uuid]
from public.committees c
cross join (values
  ('43220000-0000-4000-8000-000000000001'::uuid, '43210000-0000-4000-8000-000000000001'::uuid, 'Draft confidential', true),
  ('43220000-0000-4000-8000-000000000002'::uuid, '43210000-0000-4000-8000-000000000001'::uuid, 'Draft public', false),
  ('43220000-0000-4000-8000-000000000003'::uuid, '43210000-0000-4000-8000-000000000002'::uuid, 'Archived confidential', true),
  ('43220000-0000-4000-8000-000000000004'::uuid, '43210000-0000-4000-8000-000000000002'::uuid, 'Archived public', false)
) fixture(task_id, event_id, title, confidential)
where c.id = (select id from public.committees order by name limit 1);

update public.events set status = 'Archived'
where id = '43210000-0000-4000-8000-000000000002';

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_callers uuid[] := array[
    '43200000-0000-4000-8000-000000000001'::uuid,
    '43200000-0000-4000-8000-000000000002'::uuid,
    '43200000-0000-4000-8000-000000000003'::uuid,
    '43200000-0000-4000-8000-000000000004'::uuid,
    '43200000-0000-4000-8000-000000000005'::uuid,
    '43200000-0000-4000-8000-000000000006'::uuid,
    '43200000-0000-4000-8000-000000000007'::uuid,
    '43200000-0000-4000-8000-000000000008'::uuid,
    '43200000-0000-4000-8000-000000000009'::uuid
  ];
  v_caller uuid;
  v_index integer := 0;
  v_rows integer;
  v_masked boolean;
  v_ok boolean := true;
  v_results text := '';
begin
  foreach v_caller in array v_callers loop
    v_index := v_index + 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);

    select count(*) into v_rows
    from public.get_task_detail('43220000-0000-4000-8000-000000000001');
    v_ok := v_ok and v_rows = case when v_index in (1, 2) then 1 else 0 end;

    select count(*) into v_rows
    from public.get_task_detail('43220000-0000-4000-8000-000000000002');
    v_ok := v_ok and v_rows = case when v_index in (1, 2) then 1 else 0 end;

    select count(*), coalesce(bool_or(is_masked), false)
      into v_rows, v_masked
    from public.get_task_detail('43220000-0000-4000-8000-000000000003');
    if v_index in (1, 2, 4, 5, 6) then
      v_ok := v_ok and v_rows = 1 and not v_masked;
    elsif v_index in (3, 7) then
      v_ok := v_ok and v_rows = 1 and v_masked;
    else
      v_ok := v_ok and v_rows = 0;
    end if;

    select count(*), coalesce(bool_or(is_masked), false)
      into v_rows, v_masked
    from public.get_task_detail('43220000-0000-4000-8000-000000000004');
    if v_index <= 7 then
      v_ok := v_ok and v_rows = 1 and not v_masked;
    else
      v_ok := v_ok and v_rows = 0;
    end if;
  end loop;

  v_results := v_results || format(E'\nDRAFT_LEADERSHIP_ONLY_ZERO_NOT_SHELL: %s',
    case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nARCHIVED_PUBLIC_AND_CONFIDENTIAL_PATHS: %s',
    case when v_ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — access-list minimization and immediate revocation

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('43300000-0000-4000-8000-000000000001'::uuid, 's3-access-admin@test.local'),
  ('43300000-0000-4000-8000-000000000002'::uuid, 's3-access-primary@test.local'),
  ('43300000-0000-4000-8000-000000000003'::uuid, 's3-access-assist@test.local'),
  ('43300000-0000-4000-8000-000000000004'::uuid, 's3-access-viewer@test.local'),
  ('43300000-0000-4000-8000-000000000005'::uuid, 's3-access-member@test.local'),
  ('43300000-0000-4000-8000-000000000006'::uuid, 's3-access-inactive@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select id, email, full_name, role,
  (select id from public.committees order by name limit 1), is_active
from (values
  ('43300000-0000-4000-8000-000000000001'::uuid, 's3-access-admin@test.local', 'Admin', 'Admin', true),
  ('43300000-0000-4000-8000-000000000002'::uuid, 's3-access-primary@test.local', 'Primary', 'Member', true),
  ('43300000-0000-4000-8000-000000000003'::uuid, 's3-access-assist@test.local', 'Assist', 'Member', true),
  ('43300000-0000-4000-8000-000000000004'::uuid, 's3-access-viewer@test.local', 'Viewer', 'Member', true),
  ('43300000-0000-4000-8000-000000000005'::uuid, 's3-access-member@test.local', 'Other Member', 'Member', true),
  ('43300000-0000-4000-8000-000000000006'::uuid, 's3-access-inactive@test.local', 'Inactive Viewer', 'Member', false)
) fixture(id, email, full_name, role, is_active);

update public.users set committee_id = null
where id = '43300000-0000-4000-8000-000000000001';

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('43310000-0000-4000-8000-000000000001', 'Access Event',
  '2026-11-06', '2026-11-07', 'Active',
  '43300000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, is_confidential,
  primary_assignees, assist_assignees, allowed_viewers
)
select '43320000-0000-4000-8000-000000000001',
  '43310000-0000-4000-8000-000000000001', id, 'Access Task', true,
  array['43300000-0000-4000-8000-000000000002'::uuid],
  array['43300000-0000-4000-8000-000000000003'::uuid],
  array[
    '43300000-0000-4000-8000-000000000004'::uuid,
    '43300000-0000-4000-8000-000000000006'::uuid,
    '43300000-0000-4000-8000-000000000002'::uuid,
    '43300000-0000-4000-8000-000000000004'::uuid
  ]
from public.committees order by name limit 1;

insert into public.tasks (id, event_id, committee_id, title, is_confidential)
select '43320000-0000-4000-8000-000000000002',
  '43310000-0000-4000-8000-000000000001', id, 'Public Task', false
from public.committees order by name limit 1;

set constraints all immediate;

do $$
declare
  v_ok boolean;
  v_rows integer;
  v_masked boolean;
  v_access jsonb;
  v_results text := '';
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);

  select access_list into v_access
  from public.get_task_detail('43320000-0000-4000-8000-000000000001');
  v_ok := jsonb_array_length(v_access) = 1
    and v_access -> 0 ->> 'id' = '43300000-0000-4000-8000-000000000004'
    and (v_access -> 0) - array['id', 'full_name', 'avatar_url']::text[] = '{}'::jsonb;
  v_results := v_results || format(E'\nACCESS_LIST_ACTIVE_UNIQUE_NON_ASSIGNEES_SAFE_FIELDS: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select access_list = '[]'::jsonb into v_ok
  from public.get_task_detail('43320000-0000-4000-8000-000000000002');
  v_results := v_results || format(E'\nNON_CONFIDENTIAL_ACCESS_LIST_EMPTY: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000005',
                      'role', 'authenticated')::text, true);
  select access_list = '[]'::jsonb into v_ok
  from public.get_task_detail('43320000-0000-4000-8000-000000000001');
  v_results := v_results || format(E'\nMASKED_ACCESS_LIST_EMPTY: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000004',
                      'role', 'authenticated')::text, true);
  select count(*), coalesce(bool_or(is_masked), false)
    into v_rows, v_masked
  from public.get_task_detail('43320000-0000-4000-8000-000000000001');
  v_ok := v_rows = 1 and not v_masked;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);
  update public.tasks
  set allowed_viewers = array['43300000-0000-4000-8000-000000000006'::uuid]
  where id = '43320000-0000-4000-8000-000000000001';

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000004',
                      'role', 'authenticated')::text, true);
  select count(*), coalesce(bool_or(is_masked), false)
    into v_rows, v_masked
  from public.get_task_detail('43320000-0000-4000-8000-000000000001');
  v_ok := v_ok and v_rows = 1 and v_masked;
  v_results := v_results || format(E'\nALLOWLIST_REVOCATION_NEXT_CALL_MASKED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000002',
                      'role', 'authenticated')::text, true);
  select count(*), coalesce(bool_or(is_masked), false)
    into v_rows, v_masked
  from public.get_task_detail('43320000-0000-4000-8000-000000000001');
  v_ok := v_rows = 1 and not v_masked;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);
  update public.tasks set primary_assignees = '{}'
  where id = '43320000-0000-4000-8000-000000000001';

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43300000-0000-4000-8000-000000000002',
                      'role', 'authenticated')::text, true);
  select count(*), coalesce(bool_or(is_masked), false)
    into v_rows, v_masked
  from public.get_task_detail('43320000-0000-4000-8000-000000000001');
  v_ok := v_ok and v_rows = 1 and v_masked;
  v_results := v_results || format(E'\nASSIGNEE_REVOCATION_NEXT_CALL_MASKED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — dependency state and label masking

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('43400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-dep-admin@test.local', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('43400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-dep-member@test.local', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('43400000-0000-4000-8000-000000000001', 's3-dep-admin@test.local',
  'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select '43400000-0000-4000-8000-000000000002', 's3-dep-member@test.local',
  'Member', 'Member', id, true from public.committees order by name limit 1;

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('43410000-0000-4000-8000-000000000001', 'Dependency Active',
   '2026-11-08', '2026-11-09', 'Active', '43400000-0000-4000-8000-000000000001'),
  ('43410000-0000-4000-8000-000000000002', 'Dependency Draft',
   '2026-11-10', null, 'Draft', '43400000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, status, is_confidential)
select fixture.id, fixture.event_id, c.id, fixture.title, fixture.status, fixture.confidential
from (values
  ('43420000-0000-4000-8000-000000000001'::uuid, '43410000-0000-4000-8000-000000000001'::uuid, 'Visible prerequisite', 'To Do', false, 1),
  ('43420000-0000-4000-8000-000000000002'::uuid, '43410000-0000-4000-8000-000000000001'::uuid, 'Hidden prerequisite title', 'In Progress', true, 2),
  ('43420000-0000-4000-8000-000000000003'::uuid, '43410000-0000-4000-8000-000000000002'::uuid, 'Draft prerequisite title', 'To Do', false, 1),
  ('43420000-0000-4000-8000-000000000004'::uuid, '43410000-0000-4000-8000-000000000001'::uuid, 'Completed prerequisite', 'Completed', false, 1)
) fixture(id, event_id, title, status, confidential, committee_number)
join lateral (
  select id from public.committees order by name
  offset fixture.committee_number - 1 limit 1
) c on true;

insert into public.tasks (
  id, event_id, committee_id, title, is_confidential, depends_on_task_id
)
select fixture.id, '43410000-0000-4000-8000-000000000001', c.id,
  fixture.title, fixture.confidential, fixture.dependency_id
from (values
  ('43430000-0000-4000-8000-000000000001'::uuid, 'Depends visible', false, '43420000-0000-4000-8000-000000000001'::uuid, 1),
  ('43430000-0000-4000-8000-000000000002'::uuid, 'Depends masked', false, '43420000-0000-4000-8000-000000000002'::uuid, 1),
  ('43430000-0000-4000-8000-000000000003'::uuid, 'Depends hidden', false, '43420000-0000-4000-8000-000000000003'::uuid, 1),
  ('43430000-0000-4000-8000-000000000004'::uuid, 'Depends completed', false, '43420000-0000-4000-8000-000000000004'::uuid, 1),
  ('43430000-0000-4000-8000-000000000005'::uuid, 'Masked dependent title', true, '43420000-0000-4000-8000-000000000001'::uuid, 2)
) fixture(id, title, confidential, dependency_id, committee_number)
join lateral (
  select id from public.committees order by name
  offset fixture.committee_number - 1 limit 1
) c on true;

set constraints all immediate;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '43400000-0000-4000-8000-000000000002',
                    'role', 'authenticated')::text, true);

do $$
declare
  v_ok boolean;
  v_results text := '';
begin
  select has_dependency and is_blocked
    and dependency_label = 'Visible prerequisite'
  into v_ok from public.get_task_detail('43430000-0000-4000-8000-000000000001');
  v_results := v_results || format(E'\nINCOMPLETE_REAL_DEPENDENCY_BLOCKED_WITH_REAL_LABEL: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select has_dependency and is_blocked
    and dependency_label = 'Confidential Task'
  into v_ok from public.get_task_detail('43430000-0000-4000-8000-000000000002');
  v_results := v_results || format(E'\nMASKED_DEPENDENCY_USES_GENERIC_LABEL: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select has_dependency and is_blocked and dependency_label is null
  into v_ok from public.get_task_detail('43430000-0000-4000-8000-000000000003');
  v_results := v_results || format(E'\nHIDDEN_DEPENDENCY_LABEL_NULL: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select has_dependency and not is_blocked
    and dependency_label = 'Completed prerequisite'
  into v_ok from public.get_task_detail('43430000-0000-4000-8000-000000000004');
  v_results := v_results || format(E'\nCOMPLETED_DEPENDENCY_NOT_BLOCKED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select is_masked and has_dependency is null and is_blocked is null
    and dependency_label is null and event_id is null
    and primary_assignees = '[]'::jsonb and access_list = '[]'::jsonb
  into v_ok from public.get_task_detail('43430000-0000-4000-8000-000000000005');
  v_results := v_results || format(E'\nMASKED_DEPENDENT_LEAKS_NO_DEPENDENCY_DATA: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — helper, board, get_task, detail, and priority parity

This paste stays as the migration owner so it can inspect the deliberately
restricted `task_content_access()` helper while changing `auth.uid()` claims.

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('43500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-parity-admin@test.local', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('43500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 's3-parity-member@test.local', '', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('43500000-0000-4000-8000-000000000001', 's3-parity-admin@test.local',
  'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select '43500000-0000-4000-8000-000000000002', 's3-parity-member@test.local',
  'Member', 'Member', id, true from public.committees order by name offset 1 limit 1;

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('43510000-0000-4000-8000-000000000001', 'Parity Active', '2026-11-11', '2026-11-12', 'Active', '43500000-0000-4000-8000-000000000001'),
  ('43510000-0000-4000-8000-000000000002', 'Parity Draft', '2026-11-13', null, 'Draft', '43500000-0000-4000-8000-000000000001'),
  ('43510000-0000-4000-8000-000000000003', 'Parity Archive', '2026-11-14', '2026-11-15', 'Active', '43500000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, priority, due_date, is_confidential
)
select fixture.id, fixture.event_id, c.id, fixture.title, 'Low',
  now() - interval '2 days', fixture.confidential
from (values
  ('43520000-0000-4000-8000-000000000001'::uuid, '43510000-0000-4000-8000-000000000001'::uuid, 'Active secret', true),
  ('43520000-0000-4000-8000-000000000002'::uuid, '43510000-0000-4000-8000-000000000001'::uuid, 'Active public', false),
  ('43520000-0000-4000-8000-000000000003'::uuid, '43510000-0000-4000-8000-000000000002'::uuid, 'Draft public', false),
  ('43520000-0000-4000-8000-000000000004'::uuid, '43510000-0000-4000-8000-000000000003'::uuid, 'Archive public', false)
) fixture(id, event_id, title, confidential)
cross join lateral (select id from public.committees order by name limit 1) c;

update public.events set status = 'Archived'
where id = '43510000-0000-4000-8000-000000000003';

set constraints all immediate;

do $$
declare
  v_caller uuid;
  v_task uuid;
  v_event uuid;
  v_expected text;
  v_expected_board text;
  v_access text;
  v_detail text;
  v_get_task text;
  v_board text;
  v_detail_priority text;
  v_board_priority text;
  v_ok boolean := true;
  v_results text := '';
begin
  for v_caller, v_task, v_event, v_expected, v_expected_board in
    select * from (values
      ('43500000-0000-4000-8000-000000000001'::uuid, '43520000-0000-4000-8000-000000000001'::uuid, '43510000-0000-4000-8000-000000000001'::uuid, 'real', 'real'),
      ('43500000-0000-4000-8000-000000000002'::uuid, '43520000-0000-4000-8000-000000000001'::uuid, '43510000-0000-4000-8000-000000000001'::uuid, 'masked', 'masked'),
      ('43500000-0000-4000-8000-000000000001'::uuid, '43520000-0000-4000-8000-000000000002'::uuid, '43510000-0000-4000-8000-000000000001'::uuid, 'real', 'real'),
      ('43500000-0000-4000-8000-000000000002'::uuid, '43520000-0000-4000-8000-000000000002'::uuid, '43510000-0000-4000-8000-000000000001'::uuid, 'real', 'real'),
      ('43500000-0000-4000-8000-000000000001'::uuid, '43520000-0000-4000-8000-000000000003'::uuid, '43510000-0000-4000-8000-000000000002'::uuid, 'real', 'real'),
      ('43500000-0000-4000-8000-000000000002'::uuid, '43520000-0000-4000-8000-000000000003'::uuid, '43510000-0000-4000-8000-000000000002'::uuid, 'hidden', 'absent'),
      ('43500000-0000-4000-8000-000000000001'::uuid, '43520000-0000-4000-8000-000000000004'::uuid, '43510000-0000-4000-8000-000000000003'::uuid, 'real', 'absent'),
      ('43500000-0000-4000-8000-000000000002'::uuid, '43520000-0000-4000-8000-000000000004'::uuid, '43510000-0000-4000-8000-000000000003'::uuid, 'real', 'absent')
    ) parity(caller_id, task_id, event_id, expected_access, expected_board)
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);

    v_access := public.task_content_access(v_task);

    select case when count(*) = 0 then 'hidden'
      when bool_or(is_masked) then 'masked' else 'real' end
    into v_detail from public.get_task_detail(v_task);

    select case when count(*) = 0 then 'hidden'
      when bool_or(description is null and title like '%Confidential Task%')
        then 'masked' else 'real' end
    into v_get_task from public.get_task(v_task);

    select case when count(*) = 0 then 'absent'
      when bool_or(is_masked) then 'masked' else 'real' end
    into v_board from public.list_event_board_tasks(v_event, null)
    where id = v_task;

    v_ok := v_ok
      and v_access = v_expected
      and v_detail = v_expected
      and v_get_task = v_expected
      and v_board = v_expected_board;
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '43500000-0000-4000-8000-000000000001',
                      'role', 'authenticated')::text, true);
  select d.effective_priority, b.effective_priority
    into v_detail_priority, v_board_priority
  from public.get_task_detail('43520000-0000-4000-8000-000000000002') d
  cross join public.list_event_board_tasks(
    '43510000-0000-4000-8000-000000000001', null
  ) b
  where b.id = d.id;
  v_ok := v_ok
    and v_detail_priority = 'Critical'
    and v_detail_priority = v_board_priority;

  v_results := v_results || format(E'\nALL_PARITY_FIXTURES_AND_CALLERS_AGREE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nEFFECTIVE_PRIORITY_MATCHES_BOARD: %s',
    case when v_ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 6 — function catalogs, grants, read-only body, and unchanged policies

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '43600000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's3-catalog@test.local', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('43600000-0000-4000-8000-000000000001',
  's3-catalog@test.local', 'Catalog Admin', 'Admin', null, true);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('43610000-0000-4000-8000-000000000001', 'Catalog Event',
  '2026-11-16', '2026-11-17', 'Active',
  '43600000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title)
select '43620000-0000-4000-8000-000000000001',
  '43610000-0000-4000-8000-000000000001', id, 'Catalog Task'
from public.committees order by name limit 1;

set constraints all immediate;

do $$
declare
  v_def text;
  v_ok boolean;
  v_count integer;
  v_select_qual text;
  v_update_qual text;
  v_update_check text;
  v_delete_qual text;
  v_results text := '';
begin
  select pg_get_functiondef('public.get_task_detail(uuid)'::regprocedure)
    into v_def;

  select count(*) = 1 into v_ok
  from pg_proc p
  where p.oid = 'public.get_task_detail(uuid)'::regprocedure
    and p.prosecdef
    and p.provolatile = 's'
    and pg_get_function_result(p.oid) =
      'TABLE(id uuid, event_id uuid, event_name text, event_status text, title text, description text, phase text, status text, effective_priority text, task_type text, due_date timestamp with time zone, call_time timestamp with time zone, end_time timestamp with time zone, created_at timestamp with time zone, committee_id uuid, committee_name text, primary_assignees jsonb, assist_assignees jsonb, is_confidential boolean, is_masked boolean, has_dependency boolean, is_blocked boolean, dependency_label text, access_list jsonb)';
  v_results := v_results || format(E'\nEXACT_RETURN_SHAPE_SECURITY_DEFINER_STABLE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_def) like '%set search_path to ''''%'
    and lower(v_def) like '%task_content_access%'
    and lower(v_def) like '%calculate_effective_task_priority%'
    and lower(v_def) like '%statement_timestamp()%'
    and lower(v_def) !~ '\m(insert|update|delete|merge|truncate)\M';
  v_results := v_results || format(E'\nEMPTY_PATH_SHARED_HELPERS_ONE_TIMESTAMP_NO_WRITES: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := has_function_privilege(
      'authenticated', 'public.get_task_detail(uuid)', 'EXECUTE')
    and not has_function_privilege(
      'anon', 'public.get_task_detail(uuid)', 'EXECUTE')
    and not exists (
      select 1
      from pg_proc p,
        lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where p.oid = 'public.get_task_detail(uuid)'::regprocedure
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    );
  v_results := v_results || format(E'\nAUTHENTICATED_ONLY_EXECUTE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_def) like '%left join public.tasks dependency%'
    and lower(v_def) like '%dependency_id is not null%'
    and lower(v_def) like '%dependency_status <> ''completed''%';
  v_results := v_results || format(E'\nMISSING_DEPENDENCY_NOT_BLOCKED_AND_LABEL_NULL_BY_BODY: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) into v_count from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname in ('tasks_select', 'tasks_insert', 'tasks_update', 'tasks_delete');
  select v_count = 4 and (
    select count(*) = 4 from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
  ) into v_ok;
  v_results := v_results || format(E'\nTASK_POLICIES_EXACTLY_FOUR_UNCHANGED_NAMES: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select qual into v_select_qual from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_select' and cmd = 'SELECT';
  select qual, with_check into v_update_qual, v_update_check from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_update' and cmd = 'UPDATE';
  select qual into v_delete_qual from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_delete' and cmd = 'DELETE';
  v_ok := v_select_qual is not null
    and v_update_qual is not null and v_update_check is not null
    and v_delete_qual is not null
    and exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'tasks'
        and policyname = 'tasks_insert' and cmd = 'INSERT'
    )
    and lower(v_select_qual) like '%my_role() is not null%'
    and lower(v_select_qual) not like '%request_backup%'
    and lower(v_select_qual) not like '%allowed_viewers%'
    and lower(v_update_qual) like '%my_role() is not null%'
    and lower(v_update_check) like '%my_role() is not null%'
    and lower(v_delete_qual) like '%my_role() is not null%';
  v_results := v_results || format(E'\nTASK_POLICY_COMMANDS_AND_HARDENED_RULES_UNCHANGED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4 into v_ok
  from pg_policies
  where schemaname = 'public' and tablename = 'users'
    and policyname in (
      'users_select_own_row',
      'co_admin_view_own_committee_members',
      'co_admin_update_own_committee_members',
      'admin_full_access_users'
    );
  v_ok := v_ok and (
    select count(*) = 4 from pg_policies
    where schemaname = 'public' and tablename = 'users'
  );
  v_results := v_results || format(E'\nUSER_POLICIES_EXACTLY_FOUR_UNCHANGED_NAMES: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4 into v_ok
  from pg_policies
  where schemaname = 'public' and tablename = 'users'
    and (
      (policyname = 'users_select_own_row' and cmd = 'SELECT'
       and lower(qual) like '%id = auth.uid()%')
      or (policyname = 'co_admin_view_own_committee_members' and cmd = 'SELECT'
       and lower(qual) like '%my_role() = ''co-admin''%')
      or (policyname = 'co_admin_update_own_committee_members' and cmd = 'UPDATE'
       and lower(with_check) like '%role <> ''admin''%')
      or (policyname = 'admin_full_access_users' and cmd = 'ALL'
       and lower(qual) like '%my_role() = ''admin''%')
    );
  v_results := v_results || format(E'\nUSER_POLICY_COMMANDS_AND_RULES_UNCHANGED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```
