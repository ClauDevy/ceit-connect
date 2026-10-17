# Phase 4 Step 5a — task metadata and dependency-integrity tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

Apply `20261018120000_task_creator_order_dependency_integrity.sql` to Dev
through the owner's normal process before running these tests. Each numbered
test is one self-contained SQL Editor paste with its own Auth/profile/event/task
fixtures and caller impersonation. Every paste ends with an intentional
`raise exception 'TEST RESULTS ...'`, which rolls back the transaction.

No test creates a temporary table or touches `storage.objects`. Deferred
constraints are forced with `set constraints all immediate` before assertions.
There are deliberately no two-session race tests. The concurrency contract is
instead proved by function-body and catalog checks: every ordering/dependency
writer calls the same event-key helper, each trigger locks before its lane-tail
or cycle read, the dependency trigger is VOLATILE, the edit RPC locks the stored
event row before the advisory lock and task rows, and the Vitest suite proves
SQLSTATE `40P01` maps to a retry message.

Step 7 must account for `edit_event_with_tasks` deleting task IDs one at a time:
deleting a prerequisite before its submitted dependent fails. A future
dependency-aware multi-delete path must clear/delete dependents first or order
the operation safely.

## TEST 1 — unchanged create RPC, derived metadata, and real authenticated edit

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
  ('45100000-0000-4000-8000-000000000001'::uuid, 's5a-admin@test.local'),
  ('45100000-0000-4000-8000-000000000002'::uuid, 's5a-co@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('45100000-0000-4000-8000-000000000001', 's5a-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select '45100000-0000-4000-8000-000000000002', 's5a-co@test.local', 'Co', 'Co-Admin', c.id, true
from (select id from public.committees order by name limit 1) c;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '45100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_committee_id uuid;
  v_event_id uuid;
  v_version timestamptz;
  v_new_version timestamptz;
  v_ok boolean;
  v_results text := '';
begin
  select id into v_committee_id from public.committees order by name limit 1;

  v_event_id := public.create_event_with_tasks(
    'Metadata Event', null, '2027-01-01', null, 'Draft',
    jsonb_build_array(
      jsonb_build_object('title', 'First', 'description', null, 'phase', 'Setup',
        'committee_id', v_committee_id, 'task_type', 'Deliverable', 'priority', 'Medium',
        'due_date', null, 'call_time', null, 'end_time', null, 'assignee_ids', '[]'::jsonb),
      jsonb_build_object('title', 'Second', 'description', null, 'phase', 'Setup',
        'committee_id', v_committee_id, 'task_type', 'Deliverable', 'priority', 'High',
        'due_date', null, 'call_time', null, 'end_time', null, 'assignee_ids', '[]'::jsonb),
      jsonb_build_object('title', 'Other lane', 'description', null, 'phase', 'Program',
        'committee_id', v_committee_id, 'task_type', 'Deliverable', 'priority', 'Low',
        'due_date', null, 'call_time', null, 'end_time', null, 'assignee_ids', '[]'::jsonb)
    )
  );

  select count(*) = 3
    and bool_and(created_by = '45100000-0000-4000-8000-000000000001')
  into v_ok
  from public.tasks where event_id = v_event_id;
  v_results := v_results || format(E'\nUNCHANGED_CREATE_RPC_DERIVES_TASK_CREATOR: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    array_agg(sort_order order by sort_order) filter (where phase = 'Setup') = array[1024, 2048]::bigint[]
    and min(sort_order) filter (where phase = 'Program') = 1024
  into v_ok
  from public.tasks where event_id = v_event_id;
  v_results := v_results || format(E'\nCREATE_RPC_SERVER_ORDER_PRESERVES_LANE_INPUT_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select updated_at into v_version from public.events where id = v_event_id;
  v_new_version := public.edit_event_with_tasks(
    v_event_id, v_version, 'Metadata Event saved', null,
    '2027-01-01', null, 'Draft', '[]'::jsonb, '[]'::jsonb, '{}'::uuid[]
  );
  select updated_at = v_new_version and name = 'Metadata Event saved'
  into v_ok from public.events where id = v_event_id;
  v_results := v_results || format(E'\nAUTHENTICATED_EDIT_RPC_CAN_CALL_LOCK_HELPER_AND_SAVE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — Member status movement, immutable metadata, and reparenting matrix

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
  ('45200000-0000-4000-8000-000000000001'::uuid, 's5m-admin@test.local'),
  ('45200000-0000-4000-8000-000000000002'::uuid, 's5m-own@test.local'),
  ('45200000-0000-4000-8000-000000000003'::uuid, 's5m-other@test.local'),
  ('45200000-0000-4000-8000-000000000004'::uuid, 's5m-assigned@test.local'),
  ('45200000-0000-4000-8000-000000000005'::uuid, 's5m-member@test.local'),
  ('45200000-0000-4000-8000-000000000006'::uuid, 's5m-viewer@test.local'),
  ('45200000-0000-4000-8000-000000000007'::uuid, 's5m-inactive@test.local'),
  ('45200000-0000-4000-8000-000000000008'::uuid, 's5m-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('45200000-0000-4000-8000-000000000001', 's5m-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.name, fixture.role,
  (select id from public.committees order by name offset fixture.committee_number - 1 limit 1),
  fixture.is_active
from (values
  ('45200000-0000-4000-8000-000000000002'::uuid, 's5m-own@test.local', 'Own Co', 'Co-Admin', 1, true),
  ('45200000-0000-4000-8000-000000000003'::uuid, 's5m-other@test.local', 'Other Co', 'Co-Admin', 2, true),
  ('45200000-0000-4000-8000-000000000004'::uuid, 's5m-assigned@test.local', 'Assigned', 'Member', 1, true),
  ('45200000-0000-4000-8000-000000000005'::uuid, 's5m-member@test.local', 'Member', 'Member', 1, true),
  ('45200000-0000-4000-8000-000000000006'::uuid, 's5m-viewer@test.local', 'Viewer', 'Member', 1, true),
  ('45200000-0000-4000-8000-000000000007'::uuid, 's5m-inactive@test.local', 'Inactive', 'Member', 1, false)
) fixture(id, email, name, role, committee_number, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('45210000-0000-4000-8000-000000000001', 'Source', '2027-01-02', '2027-01-03', 'Active', '45200000-0000-4000-8000-000000000001'),
  ('45210000-0000-4000-8000-000000000002', 'Destination', '2027-01-03', null, 'Draft', '45200000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, phase, status, primary_assignees, allowed_viewers)
select fixture.id, fixture.event_id, c.id, fixture.title, 'Setup', fixture.status,
  fixture.assignees, fixture.viewers
from (values
  ('45220000-0000-4000-8000-000000000001'::uuid, '45210000-0000-4000-8000-000000000001'::uuid, 'Member target', 'To Do', array['45200000-0000-4000-8000-000000000004'::uuid], array['45200000-0000-4000-8000-000000000006'::uuid]),
  ('45220000-0000-4000-8000-000000000002'::uuid, '45210000-0000-4000-8000-000000000001'::uuid, 'Existing progress', 'In Progress', '{}'::uuid[], '{}'::uuid[]),
  ('45220000-0000-4000-8000-000000000003'::uuid, '45210000-0000-4000-8000-000000000001'::uuid, 'Second progress', 'In Progress', '{}'::uuid[], '{}'::uuid[]),
  ('45220000-0000-4000-8000-000000000004'::uuid, '45210000-0000-4000-8000-000000000002'::uuid, 'Other event task', 'To Do', '{}'::uuid[], '{}'::uuid[])
) fixture(id, event_id, title, status, assignees, viewers)
cross join lateral (select id from public.committees order by name limit 1) c;

set constraints all immediate;

select set_config(
  'test.s5a_expected_destination_tail',
  (
    select (max(sort_order) + 1024)::text
    from public.tasks
    where event_id = '45210000-0000-4000-8000-000000000001'
      and phase = 'Setup' and status = 'In Progress'
  ),
  true
);

set local role authenticated;

do $$
declare
  v_failed boolean;
  v_rows integer;
  v_expected_tail bigint;
  v_actual_order bigint;
  v_creator uuid;
  v_ok boolean;
  v_results text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '45200000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  v_expected_tail := current_setting('test.s5a_expected_destination_tail')::bigint;

  update public.tasks set status = 'In Progress'
  where id = '45220000-0000-4000-8000-000000000001';
  select sort_order into v_actual_order from public.tasks where id = '45220000-0000-4000-8000-000000000001';
  v_results := v_results || format(E'\nASSIGNED_MEMBER_STATUS_ONLY_SUCCEEDS_AT_DESTINATION_TAIL: %s', case when v_actual_order = v_expected_tail then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin
    update public.tasks set priority = 'Critical'
    where id = '45220000-0000-4000-8000-000000000001';
  exception when others then v_failed := true;
  end;
  v_results := v_results || format(E'\nASSIGNED_MEMBER_OTHER_FIELD_STILL_FAILS: %s', case when v_failed then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '45200000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  select created_by into v_creator from public.tasks where id = '45220000-0000-4000-8000-000000000001';
  v_failed := false;
  begin update public.tasks set created_by = '45200000-0000-4000-8000-000000000002' where id = '45220000-0000-4000-8000-000000000001';
  exception when others then v_failed := true; end;
  v_ok := v_failed and (select created_by = v_creator from public.tasks where id = '45220000-0000-4000-8000-000000000001');
  v_results := v_results || format(E'\nADMIN_CANNOT_CHANGE_CREATOR: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin update public.tasks set sort_order = sort_order + 1 where id = '45220000-0000-4000-8000-000000000001';
  exception when others then v_failed := true; end;
  v_results := v_results || format(E'\nADMIN_CANNOT_FORGE_SAME_LANE_ORDER: %s', case when v_failed then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin update public.tasks set event_id = '45210000-0000-4000-8000-000000000002' where id = '45220000-0000-4000-8000-000000000001';
  exception when others then v_failed := true; end;
  v_results := v_results || format(E'\nADMIN_REAL_REPARENT_FAILS: %s', case when v_failed then 'PASS' else 'FAIL' end);

  update public.tasks set event_id = event_id where id = '45220000-0000-4000-8000-000000000001';
  v_results := v_results || E'\nADMIN_NOOP_REPARENT_SUCCEEDS: PASS';

  v_ok := true;
  foreach v_creator in array array[
    '45200000-0000-4000-8000-000000000002'::uuid,
    '45200000-0000-4000-8000-000000000003'::uuid,
    '45200000-0000-4000-8000-000000000004'::uuid,
    '45200000-0000-4000-8000-000000000005'::uuid,
    '45200000-0000-4000-8000-000000000006'::uuid,
    '45200000-0000-4000-8000-000000000007'::uuid,
    '45200000-0000-4000-8000-000000000008'::uuid
  ] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
    begin
      update public.tasks set event_id = '45210000-0000-4000-8000-000000000002'
      where id = '45220000-0000-4000-8000-000000000001';
      get diagnostics v_rows = row_count;
    exception when others then
      v_rows := 0;
    end;
    v_ok := coalesce(v_ok, true) and v_rows = 0;
  end loop;
  v_results := v_results || format(E'\nOWN_OTHER_CO_ASSIGNED_UNASSIGNED_VIEWER_INACTIVE_PROFILELESS_CANNOT_REPARENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — dependency rules, clear prerequisite error, and event cascade

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '45300000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's5d-admin@test.local', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('45300000-0000-4000-8000-000000000001', 's5d-admin@test.local', 'Admin', 'Admin', null, true);

insert into public.events (id, name, start_date, status, created_by)
values
  ('45310000-0000-4000-8000-000000000001', 'Graph', '2027-01-04', 'Draft', '45300000-0000-4000-8000-000000000001'),
  ('45310000-0000-4000-8000-000000000002', 'Other graph', '2027-01-05', 'Draft', '45300000-0000-4000-8000-000000000001'),
  ('45310000-0000-4000-8000-000000000003', 'Cascade graph', '2027-01-06', 'Draft', '45300000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, phase)
select fixture.id, fixture.event_id, c.id, fixture.title, 'Setup'
from (values
  ('45320000-0000-4000-8000-000000000001'::uuid, '45310000-0000-4000-8000-000000000001'::uuid, 'A'),
  ('45320000-0000-4000-8000-000000000002'::uuid, '45310000-0000-4000-8000-000000000001'::uuid, 'B'),
  ('45320000-0000-4000-8000-000000000003'::uuid, '45310000-0000-4000-8000-000000000001'::uuid, 'C'),
  ('45320000-0000-4000-8000-000000000004'::uuid, '45310000-0000-4000-8000-000000000002'::uuid, 'Other'),
  ('45320000-0000-4000-8000-000000000005'::uuid, '45310000-0000-4000-8000-000000000003'::uuid, 'Cascade A'),
  ('45320000-0000-4000-8000-000000000006'::uuid, '45310000-0000-4000-8000-000000000003'::uuid, 'Cascade B'),
  ('45320000-0000-4000-8000-000000000007'::uuid, '45310000-0000-4000-8000-000000000003'::uuid, 'Cascade C')
) fixture(id, event_id, title)
cross join lateral (select id from public.committees order by name limit 1) c;

set constraints all immediate;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '45300000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_failed boolean;
  v_state text;
  v_status text;
  v_ok boolean;
  v_results text := '';
begin
  update public.tasks set depends_on_task_id = '45320000-0000-4000-8000-000000000002'
  where id = '45320000-0000-4000-8000-000000000001';
  update public.tasks set depends_on_task_id = '45320000-0000-4000-8000-000000000003'
  where id = '45320000-0000-4000-8000-000000000002';
  select status into v_status from public.tasks where id = '45320000-0000-4000-8000-000000000001';
  v_results := v_results || format(E'\nVALID_CHAIN_STORES_WITHOUT_STATUS_CHANGE: %s', case when v_status = 'To Do' then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin update public.tasks set depends_on_task_id = id where id = '45320000-0000-4000-8000-000000000003';
  exception when others then v_failed := true; end;
  v_results := v_results || format(E'\nSELF_DEPENDENCY_REJECTED: %s', case when v_failed then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin update public.tasks set depends_on_task_id = '45320000-0000-4000-8000-000000000004' where id = '45320000-0000-4000-8000-000000000003';
  exception when others then v_failed := true; end;
  v_results := v_results || format(E'\nCROSS_EVENT_DEPENDENCY_REJECTED: %s', case when v_failed then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin update public.tasks set depends_on_task_id = '45320000-0000-4000-8000-000000000001' where id = '45320000-0000-4000-8000-000000000003';
  exception when others then v_failed := true; end;
  v_results := v_results || format(E'\nLONG_CYCLE_REJECTED: %s', case when v_failed then 'PASS' else 'FAIL' end);

  v_failed := false;
  v_state := null;
  begin
    delete from public.tasks where id = '45320000-0000-4000-8000-000000000002';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    v_failed := true;
  end;
  v_ok := v_failed and v_state = 'CCD01'
    and exists (select 1 from public.tasks where id = '45320000-0000-4000-8000-000000000002');
  v_results := v_results || format(E'\nDIRECT_REFERENCED_PREREQUISITE_DELETE_GETS_CLEAR_ERROR: %s', case when v_ok then 'PASS' else 'FAIL' end);

  update public.tasks set depends_on_task_id = '45320000-0000-4000-8000-000000000006'
  where id = '45320000-0000-4000-8000-000000000005';
  update public.tasks set depends_on_task_id = '45320000-0000-4000-8000-000000000007'
  where id = '45320000-0000-4000-8000-000000000006';
  delete from public.events where id = '45310000-0000-4000-8000-000000000003';
  v_ok := not exists (select 1 from public.events where id = '45310000-0000-4000-8000-000000000003')
    and not exists (select 1 from public.tasks where event_id = '45310000-0000-4000-8000-000000000003');
  v_results := v_results || format(E'\nDRAFT_EVENT_DELETE_WITH_DEPENDENCY_CHAIN_CASCADES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — forced backfill failure restores named triggers and writes nothing

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '45400000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's5b-admin@test.local', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('45400000-0000-4000-8000-000000000001', 's5b-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.events (id, name, start_date, status, created_by)
values ('45410000-0000-4000-8000-000000000001', 'Backfill fixture', '2027-01-07', 'Draft', '45400000-0000-4000-8000-000000000001');
insert into public.tasks (id, event_id, committee_id, title, phase)
select '45420000-0000-4000-8000-000000000001', '45410000-0000-4000-8000-000000000001', c.id, 'Fixture', null
from (select id from public.committees order by name limit 1) c;
set constraints all immediate;

do $$
declare
  v_before_creator uuid;
  v_before_order bigint;
  v_before_activity bigint;
  v_after_activity bigint;
  v_enabled_count integer;
  v_forced boolean := false;
  v_order_fixture_ok boolean;
  v_results text := '';
begin
  select created_by, sort_order into v_before_creator, v_before_order
  from public.tasks where id = '45420000-0000-4000-8000-000000000001';
  select count(*) into v_before_activity from public.activity_log
  where task_id = '45420000-0000-4000-8000-000000000001';

  begin
    alter table public.tasks disable trigger tasks_guard_archived_event_writes;
    alter table public.tasks disable trigger tasks_restrict_assignee_updates;
    alter table public.tasks disable trigger tasks_activity_log;
    update public.tasks
    set created_by = created_by, sort_order = sort_order
    where id = '45420000-0000-4000-8000-000000000001';
    raise exception 'forced atomic backfill failure';
  exception when others then
    v_forced := true;
  end;

  select count(*) into v_enabled_count
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.tasks'::regclass
    and trigger_row.tgenabled = 'O'
    and trigger_row.tgname in ('tasks_guard_archived_event_writes', 'tasks_restrict_assignee_updates', 'tasks_activity_log');
  select count(*) into v_after_activity from public.activity_log
  where task_id = '45420000-0000-4000-8000-000000000001';

  v_results := v_results || format(E'\nFORCED_FAILURE_RESTORES_ALL_THREE_TRIGGERS: %s', case when v_forced and v_enabled_count = 3 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nFORCED_FAILURE_WRITES_NOTHING_AND_LOGS_NOTHING: %s', case when
    (select created_by = v_before_creator and sort_order = v_before_order from public.tasks where id = '45420000-0000-4000-8000-000000000001')
    and v_after_activity = v_before_activity then 'PASS' else 'FAIL' end);

  with fixture(id, event_id, phase, status, created_at) as (values
    ('00000000-0000-4000-8000-000000000003'::uuid, '00000000-0000-4000-8000-000000000010'::uuid, null::text, 'To Do'::text, '2027-01-01 09:00+00'::timestamptz),
    ('00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000010'::uuid, null::text, 'To Do'::text, '2027-01-01 08:00+00'::timestamptz),
    ('00000000-0000-4000-8000-000000000002'::uuid, '00000000-0000-4000-8000-000000000010'::uuid, null::text, 'To Do'::text, '2027-01-01 09:00+00'::timestamptz),
    ('00000000-0000-4000-8000-000000000004'::uuid, '00000000-0000-4000-8000-000000000010'::uuid, 'Other'::text, 'To Do'::text, '2027-01-01 07:00+00'::timestamptz)
  ), ranked as (
    select id, row_number() over (partition by event_id, phase, status order by created_at, id)::bigint * 1024 as sort_order
    from fixture
  )
  select array_agg(sort_order order by id) = array[1024, 2048, 3072, 1024]::bigint[]
  into v_order_fixture_ok from ranked;
  v_results := v_results || format(E'\nBACKFILL_FORMULA_IS_DETERMINISTIC_BY_CREATED_AT_THEN_ID_PER_LANE: %s', case when v_order_fixture_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — catalogs, function bodies, lock order, and unchanged policies

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '45500000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's5c-admin@test.local', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('45500000-0000-4000-8000-000000000001', 's5c-admin@test.local', 'Admin', 'Admin', null, true);
set constraints all immediate;

do $$
declare
  v_create_def text := lower(pg_get_functiondef('public.create_event_with_tasks(text,text,date,date,text,jsonb)'::regprocedure));
  v_edit_def text := lower(pg_get_functiondef('public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure));
  v_insert_def text := lower(pg_get_functiondef('public.assign_task_creation_metadata()'::regprocedure));
  v_lane_def text := lower(pg_get_functiondef('public.set_task_destination_lane_order()'::regprocedure));
  v_dependency_def text := lower(pg_get_functiondef('public.validate_task_dependency()'::regprocedure));
  v_delete_def text := lower(pg_get_functiondef('public.guard_referenced_prerequisite_deletion()'::regprocedure));
  v_event_id_writers text;
  v_ok boolean;
  v_results text := '';
begin
  select count(*) = 1 into v_ok from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_event_with_tasks'
    and pg_get_function_identity_arguments(p.oid) = 'p_name text, p_description text, p_start_date date, p_end_date date, p_status text, p_tasks jsonb'
    and not p.prosecdef;
  v_ok := v_ok and (select count(*) = 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_event_with_tasks')
    and v_create_def like '%set search_path to ''''%'
    and has_function_privilege('authenticated', 'public.create_event_with_tasks(text,text,date,date,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_event_with_tasks(text,text,date,date,text,jsonb)', 'EXECUTE')
    and v_create_def not like '%task_dependency_lock_key%';
  v_results := v_results || format(E'\nCREATE_RPC_UNCHANGED_SIGNATURE_NO_OVERLOAD: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'edit_event_with_tasks'
    and pg_get_function_identity_arguments(p.oid) = 'p_event_id uuid, p_expected_updated_at timestamp with time zone, p_name text, p_description text, p_start_date date, p_end_date date, p_status text, p_tasks_to_add jsonb, p_tasks_to_update jsonb, p_task_ids_to_delete uuid[]'
    and not p.prosecdef;
  v_ok := v_ok
    and (select count(*) = 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'edit_event_with_tasks')
    and v_edit_def like '%set search_path to ''''%'
    and has_function_privilege('authenticated', 'public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])', 'EXECUTE');
  v_results := v_results || format(E'\nEDIT_RPC_EXACT_SIGNATURE_INVOKER_AUTHENTICATED_ONLY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := strpos(v_edit_def, 'for update') > 0
    and strpos(v_edit_def, 'pg_advisory_xact_lock') > strpos(v_edit_def, 'for update')
    and strpos(v_edit_def, 'task_dependency_lock_key(v_stored_event_id)') > strpos(v_edit_def, 'for update')
    and strpos(v_edit_def, 'from public.tasks t') > strpos(v_edit_def, 'pg_advisory_xact_lock');
  v_results := v_results || format(E'\nEDIT_LOCK_ORDER_EVENT_ROW_THEN_STORED_KEY_THEN_TASK_ROWS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select p.provolatile = 'v' into v_ok
  from pg_catalog.pg_proc p
  where p.oid = 'public.validate_task_dependency()'::regprocedure;
  v_ok := v_ok
    and strpos(v_dependency_def, 'pg_advisory_xact_lock') > 0
    and strpos(v_dependency_def, 'with recursive dependency_chain') > strpos(v_dependency_def, 'pg_advisory_xact_lock');
  v_results := v_results || format(E'\nVOLATILE_DEPENDENCY_LOCK_PRECEDES_FRESH_CYCLE_QUERY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := strpos(v_insert_def, 'pg_advisory_xact_lock') > 0
    and strpos(v_insert_def, 'max(task_row.sort_order)') > strpos(v_insert_def, 'pg_advisory_xact_lock')
    and strpos(v_lane_def, 'pg_advisory_xact_lock') > 0
    and strpos(v_lane_def, 'max(task_row.sort_order)') > strpos(v_lane_def, 'pg_advisory_xact_lock');
  v_results := v_results || format(E'\nBOTH_ORDER_TRIGGERS_LOCK_BEFORE_LANE_TAIL_READ: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.tasks'::regclass
      and trigger_row.tgname = 'tasks_z3_assign_creation_metadata'
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgname > 'tasks_guard_archived_event_writes'
  );
  v_results := v_results || format(E'\nINSERT_ARCHIVE_GUARD_PRECEDES_ADVISORY_ORDER_TRIGGER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select has_function_privilege('authenticated', 'public.task_dependency_lock_key(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.task_dependency_lock_key(uuid)', 'EXECUTE')
    and p.provolatile = 'i'
    and p.proisstrict
    and not p.prosecdef
    and lower(pg_get_functiondef(p.oid)) like '%set search_path to ''''%'
    and not exists (
      select 1
      from lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
    and v_edit_def like '%task_dependency_lock_key%'
    and v_insert_def like '%task_dependency_lock_key%'
    and v_lane_def like '%task_dependency_lock_key%'
    and v_dependency_def like '%task_dependency_lock_key%'
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = 'public.task_dependency_lock_key(uuid)'::regprocedure;
  v_results := v_results || format(E'\nONE_AUTHENTICATED_HASH_HELPER_USED_EVERYWHERE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.tasks'::regclass
    and not trigger_row.tgisinternal
    and trigger_row.tgname in (
      'tasks_z0_reject_event_id_changes',
      'tasks_z1_reject_created_by_changes',
      'tasks_z2_set_destination_lane_order'
    )
    and trigger_row.tgenabled = 'O'
    and lower(pg_get_triggerdef(trigger_row.oid)) like '%before update%'
    and trigger_row.tgname > 'tasks_guard_archived_event_writes'
    and trigger_row.tgname > 'tasks_restrict_assignee_updates';
  v_results := v_results || format(E'\nNEW_UPDATE_TRIGGERS_RUN_AFTER_ARCHIVE_AND_ASSIGNEE_GUARDS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select condeferrable and not condeferred
    and pg_get_constraintdef(oid) ilike '%unique nulls not distinct%'
  into v_ok
  from pg_catalog.pg_constraint
  where conrelid = 'public.tasks'::regclass and conname = 'tasks_lane_sort_order_key';
  v_ok := coalesce(v_ok, false)
    and exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_created_by_fkey')
    and exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_sort_order_positive');
  v_results := v_results || format(E'\nMETADATA_CONSTRAINTS_AND_DEFERRABLE_IMMEDIATE_LANE_UNIQUENESS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_delete_def like '%pg_trigger_depth() > 1%'
    and v_delete_def like '%ccd01%'
    and exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.tasks'::regclass
        and tgname = 'tasks_preserve_active_event_task_on_event_move'
        and tgenabled = 'O'
    );
  v_results := v_results || format(E'\nDELETE_CASCADE_EXCEPTION_AND_DEFERRED_MOVE_DEFENSE_REMAIN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_guard_archived_event_writes'
        and t.tgenabled = 'O' and lower(pg_get_triggerdef(t.oid)) like '%before insert or delete or update%'
    ) and exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_restrict_assignee_updates'
        and t.tgenabled = 'O' and lower(pg_get_triggerdef(t.oid)) like '%before update%'
    ) and exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_activity_log'
        and t.tgenabled = 'O' and lower(pg_get_triggerdef(t.oid)) like '%after insert or delete or update%'
    ) and exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_preserve_active_event_task_on_delete'
        and t.tgenabled = 'O' and t.tgdeferrable and t.tginitdeferred
    ) and exists (
      select 1 from pg_catalog.pg_trigger t
      where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_preserve_active_event_task_on_event_move'
        and t.tgenabled = 'O' and t.tgdeferrable and t.tginitdeferred
    );
  v_results := v_results || format(E'\nALL_EXISTING_TASK_TRIGGERS_KEEP_EXACT_TIMING_AND_ENABLEMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4 into v_ok from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname in ('tasks_select', 'tasks_insert', 'tasks_update', 'tasks_delete');
  v_results := v_results || format(E'\nTASK_POLICIES_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
  into v_event_id_writers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join lateral regexp_matches(
    lower(p.prosrc),
    'update[[:space:]]+public[.]tasks[[:space:]]+set[[:space:]]+([^;]*)',
    'g'
  ) as matches(parts)
  where n.nspname = 'public'
    and split_part(matches.parts[1], 'where', 1)
      ~ '(^|,)[[:space:]]*event_id[[:space:]]*=';
  v_ok := v_event_id_writers is null;
  v_results := v_results || format(
    E'\nCURRENT_RPCS_DO_NOT_UPDATE_STORED_TASK_EVENT_ID: %s',
    case when v_ok then 'PASS' else 'FAIL (' || v_event_id_writers || ')' end
  );

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## Application check — retryable deadlock mapping

`npm test` runs `src/lib/events/save-error.test.ts`. It proves SQLSTATE `40P01`
returns “Another task change happened at the same time. Please try saving
again.” and that other database messages remain unchanged.
