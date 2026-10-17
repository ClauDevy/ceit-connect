# Phase 4 Step 5b — transactional task-move RPC tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

Apply `20261018130000_transactional_task_move_rpc.sql` to Dev through the
owner's normal process before running these tests. Each numbered test is one
self-contained SQL Editor paste with its own Auth/profile/event/task fixtures
and caller impersonation. Every paste ends with an intentional
`raise exception 'TEST RESULTS ...'`, which rolls the transaction back.

No test creates a temporary table or touches `storage.objects`. Deferred
constraints are forced with `set constraints all immediate` before assertions.
There are no two-session race tests: stale/concurrent state is changed between
calls in one transaction, while the function-body check proves the event row
and shared advisory lock precede task-row locks.

## TEST 1 — catalogs, owner exemption, grants, trigger order, and lock order

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '5b010000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's5b-catalog@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  '5b010000-0000-4000-8000-000000000001',
  's5b-catalog@test.local', 'Catalog Admin', 'Admin', null, true
);

-- Compute owner/exclusivity expectations as the table owner before role
-- impersonation. Custom transaction-local settings avoid temp tables.
select set_config(
  'test.s5b_move_owner',
  pg_catalog.pg_get_userbyid(p.proowner),
  true
)
from pg_catalog.pg_proc p
where p.oid = 'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure;

select set_config(
  'test.s5b_definer_exclusive',
  (
    count(*) = 1
    and bool_and(
      p.oid = 'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure
    )
  )::text,
  true
)
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef is true
  and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  and pg_catalog.pg_get_functiondef(p.oid)
    ~* '\mupdate[[:space:]]+public\.tasks\M';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '5b010000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_move_oid oid := 'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure;
  v_guard_oid oid := 'public.restrict_assignee_task_updates()'::regprocedure;
  v_lane_oid oid := 'public.set_task_destination_lane_order()'::regprocedure;
  v_log_oid oid := 'public.log_task_activity()'::regprocedure;
  v_tail_oid oid := 'public.task_lane_tail_sort_order(uuid,text,text,uuid)'::regprocedure;
  v_trigger_names text[];
  v_body text;
  v_event_pos integer;
  v_advisory_pos integer;
  v_task_lock_pos integer;
  v_helper_direct_denied boolean := false;
  v_ok boolean;
  v_results text := '';
begin
  select current_setting('test.s5b_move_owner') = 'postgres'
    and current_setting('test.s5b_definer_exclusive') = 'true'
  into v_ok;
  v_results := v_results || format(E'\nONLY_POSTGRES_DEFINER_TASK_UPDATER_IS_MOVE_TASK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select p.prosecdef
    and p.provolatile = 'v'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_move_oid;
  v_results := v_results || format(E'\nMOVE_OWNER_SECURITY_VOLATILITY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not p.prosecdef
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_guard_oid;
  v_results := v_results || format(E'\nASSIGNEE_GUARD_IS_INVOKER_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not p.prosecdef
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_lane_oid;
  v_results := v_results || format(E'\nLANE_TRIGGER_IS_INVOKER_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select p.prosecdef
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_log_oid;
  v_results := v_results || format(E'\nACTIVITY_TRIGGER_STAYS_DEFINER_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select p.prosecdef and p.provolatile = 'v'
  into v_ok from pg_catalog.pg_proc p where p.oid = v_tail_oid;
  v_results := v_results || format(E'\nTAIL_HELPER_IS_VOLATILE_DEFINER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select has_function_privilege('authenticated', v_move_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_move_oid, 'EXECUTE')
    and has_function_privilege('authenticated', v_tail_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_tail_oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid in (v_move_oid, v_tail_oid)
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  into v_ok;
  v_results := v_results || format(E'\nMOVE_AND_HELPER_GRANTS_ARE_NARROW: %s', case when v_ok then 'PASS' else 'FAIL' end);

  begin
    perform public.task_lane_tail_sort_order(
      '00000000-0000-0000-0000-000000000001', null, 'To Do', null
    );
  exception when insufficient_privilege then
    v_helper_direct_denied := true;
  end;
  v_results := v_results || format(E'\nTAIL_HELPER_DIRECT_CALL_LEAKS_NOTHING: %s', case when v_helper_direct_denied then 'PASS' else 'FAIL' end);

  select array_agg(t.tgname order by t.tgname)
  into v_trigger_names
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.tasks'::regclass
    and not t.tgisinternal
    and (t.tgtype & 2) = 2
    and (t.tgtype & 16) = 16;

  v_ok := v_trigger_names = array[
    'tasks_guard_archived_event_writes',
    'tasks_restrict_assignee_updates',
    'tasks_validate_dependency',
    'tasks_z0_reject_event_id_changes',
    'tasks_z1_reject_created_by_changes',
    'tasks_z2_set_destination_lane_order'
  ]::text[];
  v_results := v_results || format(E'\nBEFORE_UPDATE_TRIGGER_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_catalog.pg_get_functiondef(v_move_oid) into v_body;
  v_event_pos := strpos(v_body, 'for share');
  v_advisory_pos := strpos(v_body, 'pg_advisory_xact_lock');
  v_task_lock_pos := strpos(v_body, 'where task_row.id = p_task_id' || chr(10) || '  for update');
  v_ok := v_event_pos > 0
    and v_advisory_pos > v_event_pos
    and v_task_lock_pos > v_advisory_pos
    and (length(v_body) - length(replace(v_body, 'task_dependency_lock_key', ''))) /
        length('task_dependency_lock_key') = 1;
  v_results := v_results || format(E'\nEVENT_THEN_SHARED_ADVISORY_THEN_TASK_LOCK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select c.condeferrable and not c.condeferred
  into v_ok
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.tasks'::regclass
    and c.conname = 'tasks_lane_sort_order_key';
  v_results := v_results || format(E'\nLANE_UNIQUE_IS_DEFERRABLE_INITIALLY_IMMEDIATE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — raw Member status change sees the hidden true destination tail

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
  ('5b020000-0000-4000-8000-000000000001'::uuid, 's5b-tail-admin@test.local'),
  ('5b020000-0000-4000-8000-000000000002'::uuid, 's5b-tail-member@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('5b020000-0000-4000-8000-000000000001', 's5b-tail-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select '5b020000-0000-4000-8000-000000000002', 's5b-tail-member@test.local',
  'Member', 'Member', c.id, true
from (select id from public.committees order by name limit 1) c;

insert into public.events (id, name, start_date, status, created_by)
values ('5b021000-0000-4000-8000-000000000001', 'Hidden Tail', '2027-02-01', 'Active', '5b020000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, primary_assignees, created_by
)
select fixture.id, '5b021000-0000-4000-8000-000000000001', c.id,
  fixture.title, 'Setup', fixture.status, fixture.assignees, '5b020000-0000-4000-8000-000000000001'
from (select id from public.committees order by name limit 1) c
cross join (values
  ('5b022000-0000-4000-8000-000000000001'::uuid, 'Assigned source', 'To Do', array['5b020000-0000-4000-8000-000000000002'::uuid]),
  ('5b022000-0000-4000-8000-000000000002'::uuid, 'Hidden low', 'In Progress', '{}'::uuid[]),
  ('5b022000-0000-4000-8000-000000000003'::uuid, 'Hidden high', 'In Progress', '{}'::uuid[])
) fixture(id, title, status, assignees);

select set_config(
  'test.s5b_expected_tail',
  (select (max(task_row.sort_order) + 1024)::text
   from public.tasks task_row
   where task_row.event_id = '5b021000-0000-4000-8000-000000000001'
     and task_row.phase = 'Setup'
     and task_row.status = 'In Progress'),
  true
);

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '5b020000-0000-4000-8000-000000000002', 'role', 'authenticated')::text,
  true
);

do $$
declare
  v_visible_before bigint;
  v_saved_rank bigint;
  v_ok boolean;
  v_results text := '';
begin
  select count(*) into v_visible_before
  from public.tasks task_row
  where task_row.event_id = '5b021000-0000-4000-8000-000000000001';

  update public.tasks as task_row
  set status = 'In Progress'
  where task_row.id = '5b022000-0000-4000-8000-000000000001';

  select task_row.sort_order into v_saved_rank
  from public.tasks task_row
  where task_row.id = '5b022000-0000-4000-8000-000000000001';

  v_ok := v_visible_before = 1
    and v_saved_rank = current_setting('test.s5b_expected_tail')::bigint;
  v_results := v_results || format(E'\nMEMBER_HIDDEN_LANE_TRUE_TAIL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — role matrix, leadership reorder, assignee tail, and dependencies

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
  ('5b030000-0000-4000-8000-000000000001'::uuid, 's5b-role-admin@test.local'),
  ('5b030000-0000-4000-8000-000000000002'::uuid, 's5b-role-own@test.local'),
  ('5b030000-0000-4000-8000-000000000003'::uuid, 's5b-role-other@test.local'),
  ('5b030000-0000-4000-8000-000000000004'::uuid, 's5b-role-primary@test.local'),
  ('5b030000-0000-4000-8000-000000000005'::uuid, 's5b-role-assist@test.local'),
  ('5b030000-0000-4000-8000-000000000006'::uuid, 's5b-role-member@test.local'),
  ('5b030000-0000-4000-8000-000000000007'::uuid, 's5b-role-viewer@test.local'),
  ('5b030000-0000-4000-8000-000000000008'::uuid, 's5b-role-inactive@test.local'),
  ('5b030000-0000-4000-8000-000000000009'::uuid, 's5b-role-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('5b030000-0000-4000-8000-000000000001', 's5b-role-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.name, fixture.role,
  (select id from public.committees order by name offset fixture.committee_no - 1 limit 1),
  fixture.active
from (values
  ('5b030000-0000-4000-8000-000000000002'::uuid, 's5b-role-own@test.local', 'Own Co', 'Co-Admin', 1, true),
  ('5b030000-0000-4000-8000-000000000003'::uuid, 's5b-role-other@test.local', 'Other Co', 'Co-Admin', 2, true),
  ('5b030000-0000-4000-8000-000000000004'::uuid, 's5b-role-primary@test.local', 'Primary', 'Member', 1, true),
  ('5b030000-0000-4000-8000-000000000005'::uuid, 's5b-role-assist@test.local', 'Assist', 'Member', 1, true),
  ('5b030000-0000-4000-8000-000000000006'::uuid, 's5b-role-member@test.local', 'Member', 'Member', 1, true),
  ('5b030000-0000-4000-8000-000000000007'::uuid, 's5b-role-viewer@test.local', 'Viewer', 'Member', 1, true),
  ('5b030000-0000-4000-8000-000000000008'::uuid, 's5b-role-inactive@test.local', 'Inactive', 'Member', 1, false)
) fixture(id, email, name, role, committee_no, active);

insert into public.events (id, name, start_date, status, created_by)
values ('5b031000-0000-4000-8000-000000000001', 'Role Matrix', '2027-03-01', 'Active', '5b030000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, primary_assignees,
  assist_assignees, allowed_viewers, depends_on_task_id, created_by
)
select fixture.id, '5b031000-0000-4000-8000-000000000001',
  (select id from public.committees order by name offset fixture.committee_no - 1 limit 1),
  fixture.title, 'Setup', fixture.status, fixture.primary_ids, fixture.assist_ids,
  fixture.viewer_ids, fixture.dependency_id, '5b030000-0000-4000-8000-000000000001'
from (values
  ('5b032000-0000-4000-8000-000000000001'::uuid, 'First', 1, 'To Do', '{}'::uuid[], '{}'::uuid[], '{}'::uuid[], null::uuid),
  ('5b032000-0000-4000-8000-000000000002'::uuid, 'Second', 1, 'To Do', '{}'::uuid[], '{}'::uuid[], '{}'::uuid[], null::uuid),
  ('5b032000-0000-4000-8000-000000000003'::uuid, 'Primary move', 1, 'In Progress', array['5b030000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], '{}'::uuid[], null::uuid),
  ('5b032000-0000-4000-8000-000000000004'::uuid, 'Assist move', 1, 'To Do', '{}'::uuid[], array['5b030000-0000-4000-8000-000000000005'::uuid], '{}'::uuid[], null::uuid),
  ('5b032000-0000-4000-8000-000000000005'::uuid, 'Viewer only', 1, 'To Do', '{}'::uuid[], '{}'::uuid[], array['5b030000-0000-4000-8000-000000000007'::uuid], null::uuid),
  ('5b032000-0000-4000-8000-000000000006'::uuid, 'Other committee', 2, 'To Do', '{}'::uuid[], '{}'::uuid[], '{}'::uuid[], null::uuid),
  ('5b032000-0000-4000-8000-000000000007'::uuid, 'Prerequisite', 1, 'To Do', '{}'::uuid[], '{}'::uuid[], '{}'::uuid[], null::uuid),
  ('5b032000-0000-4000-8000-000000000008'::uuid, 'Dependent', 1, 'To Do', array['5b030000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], '{}'::uuid[], '5b032000-0000-4000-8000-000000000007'::uuid)
) fixture(id, title, committee_no, status, primary_ids, assist_ids, viewer_ids, dependency_id);

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_denied boolean;
  v_ok boolean;
  v_results text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  perform public.move_task(
    '5b032000-0000-4000-8000-000000000002', 'Setup', 'To Do', 'To Do',
    null, '5b032000-0000-4000-8000-000000000001'
  );
  select task_row.sort_order < first_row.sort_order into v_ok
  from public.tasks task_row
  join public.tasks first_row on first_row.id = '5b032000-0000-4000-8000-000000000001'
  where task_row.id = '5b032000-0000-4000-8000-000000000002';
  v_results := v_results || format(E'\nADMIN_REORDERS_ANY_TASK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  perform public.move_task(
    '5b032000-0000-4000-8000-000000000001', 'Setup', 'To Do', 'To Do',
    '5b032000-0000-4000-8000-000000000004', '5b032000-0000-4000-8000-000000000005'
  );
  v_results := v_results || E'\nOWN_CO_ADMIN_REORDER: PASS';

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  perform public.move_task('5b032000-0000-4000-8000-000000000006', 'Setup', 'To Do', 'Completed', null, null);
  v_results := v_results || E'\nADMIN_MOVES_OTHER_COMMITTEE_TASK: PASS';

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
  v_denied := false;
  begin
    perform public.move_task('5b032000-0000-4000-8000-000000000001', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then v_denied := true;
  end;
  v_results := v_results || format(E'\nOTHER_CO_ADMIN_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  perform public.move_task('5b032000-0000-4000-8000-000000000003', 'Setup', 'In Progress', 'To Do', null, null);
  select task_row.status = 'To Do' into v_ok from public.tasks task_row where task_row.id = '5b032000-0000-4000-8000-000000000003';
  v_results := v_results || format(E'\nPRIMARY_ASSIGNEE_BACKWARD_TO_TAIL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.move_task('5b032000-0000-4000-8000-000000000003', 'Setup', 'To Do', 'To Do', null, null);
  exception when others then v_denied := true;
  end;
  v_results := v_results || format(E'\nASSIGNEE_CANNOT_REORDER: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.move_task('5b032000-0000-4000-8000-000000000008', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then v_denied := true;
  end;
  v_results := v_results || format(E'\nINCOMPLETE_DEPENDENCY_BLOCKS_FORWARD: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  perform public.move_task('5b032000-0000-4000-8000-000000000007', 'Setup', 'To Do', 'Completed', null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  perform public.move_task('5b032000-0000-4000-8000-000000000008', 'Setup', 'To Do', 'In Progress', null, null);
  v_results := v_results || E'\nCOMPLETED_DEPENDENCY_UNLOCKS_FORWARD: PASS';

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  perform public.move_task('5b032000-0000-4000-8000-000000000007', 'Setup', 'Completed', 'To Do', null, null);
  select task_row.status = 'In Progress' into v_ok from public.tasks task_row where task_row.id = '5b032000-0000-4000-8000-000000000008';
  v_results := v_results || format(E'\nBACKWARD_PREREQUISITE_NEVER_AUTO_REVERTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  perform public.move_task('5b032000-0000-4000-8000-000000000004', 'Setup', 'To Do', 'In Progress', null, null);
  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  select not exists (
    select 1 from public.tasks later_row
    where later_row.event_id = moved_row.event_id
      and later_row.phase is not distinct from moved_row.phase
      and later_row.status = moved_row.status
      and later_row.sort_order > moved_row.sort_order
  ) into v_ok
  from public.tasks moved_row
  where moved_row.id = '5b032000-0000-4000-8000-000000000004';
  v_results := v_results || format(E'\nASSIST_ASSIGNEE_LANDS_AT_TRUE_TAIL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
  v_denied := false;
  begin perform public.move_task('5b032000-0000-4000-8000-000000000005', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then v_denied := true; end;
  v_results := v_results || format(E'\nUNASSIGNED_MEMBER_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
  v_denied := false;
  begin perform public.move_task('5b032000-0000-4000-8000-000000000005', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then v_denied := true; end;
  v_results := v_results || format(E'\nALLOWED_VIEWER_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000008', 'role', 'authenticated')::text, true);
  v_denied := false;
  begin perform public.move_task('5b032000-0000-4000-8000-000000000005', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then v_denied := true; end;
  v_results := v_results || format(E'\nINACTIVE_USER_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '5b030000-0000-4000-8000-000000000009', 'role', 'authenticated')::text, true);
  v_denied := false;
  begin perform public.move_task('5b032000-0000-4000-8000-000000000005', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then v_denied := true; end;
  v_results := v_results || format(E'\nPROFILELESS_USER_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — direct forgery remains blocked and the RPC changes only status/order

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-8000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('5b040000-0000-4000-8000-000000000001'::uuid, 's5b-forge-admin@test.local'),
  ('5b040000-0000-4000-8000-000000000002'::uuid, 's5b-forge-member@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('5b040000-0000-4000-8000-000000000001', 's5b-forge-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select '5b040000-0000-4000-8000-000000000002', 's5b-forge-member@test.local', 'Member', 'Member', c.id, true
from (select id from public.committees order by name limit 1) c;

insert into public.events (id, name, start_date, status, created_by)
values
  ('5b041000-0000-4000-8000-000000000001', 'Forge A', '2027-04-01', 'Active', '5b040000-0000-4000-8000-000000000001'),
  ('5b041000-0000-4000-8000-000000000002', 'Forge B', '2027-04-02', 'Active', '5b040000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, description, phase, status,
  primary_assignees, created_by
)
select fixture.id, fixture.event_id, c.id, fixture.title, 'Original', 'Setup', 'To Do',
  fixture.assignees, '5b040000-0000-4000-8000-000000000001'
from (select id from public.committees order by name limit 1) c
cross join (values
  ('5b042000-0000-4000-8000-000000000001'::uuid, '5b041000-0000-4000-8000-000000000001'::uuid, 'Assigned', array['5b040000-0000-4000-8000-000000000002'::uuid]),
  ('5b042000-0000-4000-8000-000000000002'::uuid, '5b041000-0000-4000-8000-000000000001'::uuid, 'Dependency', '{}'::uuid[]),
  ('5b042000-0000-4000-8000-000000000003'::uuid, '5b041000-0000-4000-8000-000000000002'::uuid, 'Other event task', '{}'::uuid[])
) fixture(id, event_id, title, assignees);

select set_config(
  'test.s5b_original_row',
  (select (to_jsonb(task_row) - 'status' - 'sort_order')::text
   from public.tasks task_row where task_row.id = '5b042000-0000-4000-8000-000000000001'),
  true
);

set constraints all immediate;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '5b040000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);

do $$
declare
  v_denied_count integer := 0;
  v_ok boolean;
  v_results text := '';
begin
  begin update public.tasks as t set sort_order = t.sort_order + 1 where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set event_id = '5b041000-0000-4000-8000-000000000002' where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set phase = 'Program' where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set depends_on_task_id = '5b042000-0000-4000-8000-000000000002' where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set primary_assignees = '{}'::uuid[] where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set title = 'Forged' where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set description = 'Forged' where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;
  begin update public.tasks as t set is_confidential = true where t.id = '5b042000-0000-4000-8000-000000000001'; exception when others then v_denied_count := v_denied_count + 1; end;

  perform public.move_task('5b042000-0000-4000-8000-000000000001', 'Setup', 'To Do', 'In Progress', null, null);

  select v_denied_count = 8
    and (to_jsonb(task_row) - 'status' - 'sort_order')::text = current_setting('test.s5b_original_row')
    and task_row.status = 'In Progress'
  into v_ok
  from public.tasks task_row
  where task_row.id = '5b042000-0000-4000-8000-000000000001';
  v_results := v_results || format(E'\nDIRECT_FORGERY_BLOCKED_RPC_COLUMNS_NARROW: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — same-lane/cross-lane rebalance, activity noise, and Archived denial

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '5b050000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's5b-activity-admin@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);
insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('5b050000-0000-4000-8000-000000000001', 's5b-activity-admin@test.local', 'Admin', 'Admin', null, true);

insert into public.events (id, name, start_date, status, created_by)
values
  ('5b051000-0000-4000-8000-000000000001', 'Activity', '2027-05-01', 'Active', '5b050000-0000-4000-8000-000000000001'),
  ('5b051000-0000-4000-8000-000000000002', 'Archive', '2027-05-02', 'Active', '5b050000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, phase, status, created_by)
select fixture.id, fixture.event_id, c.id, fixture.title, fixture.phase, fixture.status,
  '5b050000-0000-4000-8000-000000000001'
from (select id from public.committees order by name limit 1) c
cross join (values
  ('5b052000-0000-4000-8000-000000000001'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'A', 'Setup', 'To Do'),
  ('5b052000-0000-4000-8000-000000000002'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'B', 'Setup', 'To Do'),
  ('5b052000-0000-4000-8000-000000000003'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'C', 'Setup', 'To Do'),
  ('5b052000-0000-4000-8000-000000000004'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'Status', 'Setup', 'To Do'),
  ('5b052000-0000-4000-8000-000000000005'::uuid, '5b051000-0000-4000-8000-000000000002'::uuid, 'Frozen', 'Setup', 'To Do'),
  ('5b052000-0000-4000-8000-000000000006'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'Program A', 'Program', 'To Do'),
  ('5b052000-0000-4000-8000-000000000007'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'Program B', 'Program', 'To Do'),
  ('5b052000-0000-4000-8000-000000000008'::uuid, '5b051000-0000-4000-8000-000000000001'::uuid, 'Program source', 'Program', 'In Progress')
) fixture(id, event_id, title, phase, status);

-- Same-lane case: C keeps rank 1024 while the rebalance needs to assign 1024
-- to A. Without deferring the lane constraint, the neighbor update conflicts
-- with the moved task's still-stored old rank before C receives its midpoint.
update public.tasks as task_row set sort_order = 1 where task_row.id = '5b052000-0000-4000-8000-000000000001';
update public.tasks as task_row set sort_order = 2 where task_row.id = '5b052000-0000-4000-8000-000000000002';
update public.tasks as task_row set sort_order = 1024 where task_row.id = '5b052000-0000-4000-8000-000000000003';

-- Cross-lane case: Program A/B are adjacent, so moving Program source from
-- In Progress between them must rebalance the destination To Do lane.
update public.tasks as task_row set sort_order = 1 where task_row.id = '5b052000-0000-4000-8000-000000000006';
update public.tasks as task_row set sort_order = 2 where task_row.id = '5b052000-0000-4000-8000-000000000007';
update public.events as event_row set status = 'Archived' where event_row.id = '5b051000-0000-4000-8000-000000000002';

select set_config(
  'test.s5b_activity_baseline',
  (select count(*)::text from public.activity_log log_row
   where log_row.task_id = any(array[
     '5b052000-0000-4000-8000-000000000001'::uuid,
     '5b052000-0000-4000-8000-000000000002'::uuid,
     '5b052000-0000-4000-8000-000000000003'::uuid,
     '5b052000-0000-4000-8000-000000000004'::uuid,
     '5b052000-0000-4000-8000-000000000006'::uuid,
     '5b052000-0000-4000-8000-000000000007'::uuid,
     '5b052000-0000-4000-8000-000000000008'::uuid
   ])),
  true
);

set constraints all immediate;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '5b050000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_archived_denied boolean := false;
  v_added_logs bigint;
  v_status_logs bigint;
  v_cross_lane_logs bigint;
  v_ok boolean;
  v_results text := '';
begin
  perform public.move_task(
    '5b052000-0000-4000-8000-000000000003', 'Setup', 'To Do', 'To Do',
    '5b052000-0000-4000-8000-000000000001', '5b052000-0000-4000-8000-000000000002'
  );

  select first_row.sort_order = 1024
    and first_row.sort_order < moved_row.sort_order
    and moved_row.sort_order < next_row.sort_order
  into v_ok
  from public.tasks first_row
  join public.tasks moved_row on moved_row.id = '5b052000-0000-4000-8000-000000000003'
  join public.tasks next_row on next_row.id = '5b052000-0000-4000-8000-000000000002'
  where first_row.id = '5b052000-0000-4000-8000-000000000001';
  v_results := v_results || format(E'\nSAME_LANE_REBALANCE_DEFERS_OLD_RANK_COLLISION: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform public.move_task(
    '5b052000-0000-4000-8000-000000000008', 'Program', 'In Progress', 'To Do',
    '5b052000-0000-4000-8000-000000000006', '5b052000-0000-4000-8000-000000000007'
  );

  select moved_row.status = 'To Do'
    and first_row.sort_order < moved_row.sort_order
    and moved_row.sort_order < next_row.sort_order
  into v_ok
  from public.tasks first_row
  join public.tasks moved_row on moved_row.id = '5b052000-0000-4000-8000-000000000008'
  join public.tasks next_row on next_row.id = '5b052000-0000-4000-8000-000000000007'
  where first_row.id = '5b052000-0000-4000-8000-000000000006';
  v_results := v_results || format(E'\nCROSS_LANE_REBALANCE_SUCCEEDS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform public.move_task(
    '5b052000-0000-4000-8000-000000000004', 'Setup', 'To Do', 'In Progress',
    null, null
  );

  select count(*) - current_setting('test.s5b_activity_baseline')::bigint
  into v_added_logs
  from public.activity_log log_row
  where log_row.task_id = any(array[
    '5b052000-0000-4000-8000-000000000001'::uuid,
    '5b052000-0000-4000-8000-000000000002'::uuid,
    '5b052000-0000-4000-8000-000000000003'::uuid,
    '5b052000-0000-4000-8000-000000000004'::uuid,
    '5b052000-0000-4000-8000-000000000006'::uuid,
    '5b052000-0000-4000-8000-000000000007'::uuid,
    '5b052000-0000-4000-8000-000000000008'::uuid
  ]);

  select count(*) into v_status_logs
  from public.activity_log log_row
  where log_row.task_id = '5b052000-0000-4000-8000-000000000004'
    and log_row.action = 'UPDATE'
    and log_row.user_id = '5b050000-0000-4000-8000-000000000001'
    and log_row.changes->'old'->>'status' = 'To Do'
    and log_row.changes->'new'->>'status' = 'In Progress';

  select count(*) into v_cross_lane_logs
  from public.activity_log log_row
  where log_row.task_id = '5b052000-0000-4000-8000-000000000008'
    and log_row.action = 'UPDATE'
    and log_row.user_id = '5b050000-0000-4000-8000-000000000001'
    and log_row.changes->'old'->>'status' = 'In Progress'
    and log_row.changes->'new'->>'status' = 'To Do';

  v_ok := v_added_logs = 2 and v_status_logs = 1 and v_cross_lane_logs = 1;
  v_results := v_results || format(E'\nREORDER_AND_REBALANCE_QUIET_STATUS_MOVE_LOGS_ONCE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  begin
    perform public.move_task('5b052000-0000-4000-8000-000000000005', 'Setup', 'To Do', 'In Progress', null, null);
  exception when others then
    v_archived_denied := true;
  end;
  v_results := v_results || format(E'\nARCHIVED_MOVE_DENIED: %s', case when v_archived_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 6 — Undo, stale/moved/removed/cross-lane/forged hints, and boundaries

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '5b060000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's5b-undo-admin@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);
insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('5b060000-0000-4000-8000-000000000001', 's5b-undo-admin@test.local', 'Admin', 'Admin', null, true);

insert into public.events (id, name, start_date, status, created_by)
values ('5b061000-0000-4000-8000-000000000001', 'Undo', '2027-06-01', 'Active', '5b060000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, phase, status, created_by)
select fixture.id, '5b061000-0000-4000-8000-000000000001', c.id,
  fixture.title, fixture.phase, fixture.status, '5b060000-0000-4000-8000-000000000001'
from (select id from public.committees order by name limit 1) c
cross join (values
  ('5b062000-0000-4000-8000-000000000001'::uuid, 'A', 'Setup', 'To Do'),
  ('5b062000-0000-4000-8000-000000000002'::uuid, 'B', 'Setup', 'To Do'),
  ('5b062000-0000-4000-8000-000000000003'::uuid, 'C', 'Setup', 'To Do'),
  ('5b062000-0000-4000-8000-000000000004'::uuid, 'D', 'Setup', 'To Do'),
  ('5b062000-0000-4000-8000-000000000005'::uuid, 'Other phase', 'Program', 'To Do'),
  ('5b062000-0000-4000-8000-000000000006'::uuid, 'Removable hint', 'Setup', 'To Do'),
  ('5b062000-0000-4000-8000-000000000007'::uuid, 'Boundary first', 'Program', 'In Progress'),
  ('5b062000-0000-4000-8000-000000000008'::uuid, 'Boundary second', 'Program', 'In Progress'),
  ('5b062000-0000-4000-8000-000000000009'::uuid, 'Boundary third', 'Program', 'In Progress')
) fixture(id, title, phase, status);

set constraints all immediate;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '5b060000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

do $$
declare
  v_denied boolean;
  v_ok boolean;
  v_results text := '';
begin
  -- Move B between C/D, then Undo using its previous A/C neighbors.
  perform public.move_task(
    '5b062000-0000-4000-8000-000000000002', 'Setup', 'To Do', 'To Do',
    '5b062000-0000-4000-8000-000000000003', '5b062000-0000-4000-8000-000000000004'
  );
  perform public.move_task(
    '5b062000-0000-4000-8000-000000000002', 'Setup', 'To Do', 'To Do',
    '5b062000-0000-4000-8000-000000000001', '5b062000-0000-4000-8000-000000000003'
  );
  select a.sort_order < b.sort_order and b.sort_order < c.sort_order
  into v_ok
  from public.tasks a, public.tasks b, public.tasks c
  where a.id = '5b062000-0000-4000-8000-000000000001'
    and b.id = '5b062000-0000-4000-8000-000000000002'
    and c.id = '5b062000-0000-4000-8000-000000000003';
  v_results := v_results || format(E'\nVALID_MIDDLE_UNDO: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- A state change between calls makes the stored neighbors stale.
  perform public.move_task('5b062000-0000-4000-8000-000000000003', 'Setup', 'To Do', 'In Progress', null, null);
  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000002', 'Setup', 'To Do', 'To Do', '5b062000-0000-4000-8000-000000000001', '5b062000-0000-4000-8000-000000000003');
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nMOVED_CROSS_LANE_HINT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  delete from public.tasks as task_row where task_row.id = '5b062000-0000-4000-8000-000000000006';
  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000004', 'Setup', 'To Do', 'To Do', '5b062000-0000-4000-8000-000000000006', null);
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nREMOVED_HINT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000004', 'Setup', 'To Do', 'To Do', '5b062000-0000-4000-8000-000000000005', null);
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nCROSS_PHASE_HINT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000004', 'Setup', 'To Do', 'To Do', '5b06ffff-0000-4000-8000-000000000099', null);
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nFORGED_HINT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform public.move_task('5b062000-0000-4000-8000-000000000001', 'Setup', 'To Do', 'In Progress', null, null);
  perform public.move_task('5b062000-0000-4000-8000-000000000001', 'Setup', 'In Progress', 'To Do', null, null);
  select task_row.status = 'To Do' into v_ok
  from public.tasks task_row
  where task_row.id = '5b062000-0000-4000-8000-000000000001';
  v_results := v_results || format(E'\nCROSS_LANE_UNDO_TO_PREVIOUS_STATUS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- First and last Undo boundaries use one missing neighbor.
  perform public.move_task('5b062000-0000-4000-8000-000000000007', 'Program', 'In Progress', 'In Progress', '5b062000-0000-4000-8000-000000000009', null);
  perform public.move_task('5b062000-0000-4000-8000-000000000007', 'Program', 'In Progress', 'In Progress', null, '5b062000-0000-4000-8000-000000000008');
  select first_row.sort_order < second_row.sort_order into v_ok
  from public.tasks first_row
  join public.tasks second_row on second_row.id = '5b062000-0000-4000-8000-000000000008'
  where first_row.id = '5b062000-0000-4000-8000-000000000007';
  v_results := v_results || format(E'\nUNDO_TO_FIRST_WITH_MISSING_PREVIOUS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform public.move_task('5b062000-0000-4000-8000-000000000009', 'Program', 'In Progress', 'In Progress', null, '5b062000-0000-4000-8000-000000000007');
  perform public.move_task('5b062000-0000-4000-8000-000000000009', 'Program', 'In Progress', 'In Progress', '5b062000-0000-4000-8000-000000000008', null);
  select second_row.sort_order < last_row.sort_order into v_ok
  from public.tasks second_row
  join public.tasks last_row on last_row.id = '5b062000-0000-4000-8000-000000000009'
  where second_row.id = '5b062000-0000-4000-8000-000000000008';
  v_results := v_results || format(E'\nUNDO_TO_LAST_WITH_MISSING_NEXT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Remaining neighbor is not at its asserted boundary.
  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000008', 'Program', 'In Progress', 'In Progress', null, '5b062000-0000-4000-8000-000000000009');
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nNON_BOUNDARY_REMAINING_NEIGHBOR_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000008', 'Program', 'In Progress', 'In Progress', '5b062000-0000-4000-8000-000000000007', null);
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nNON_LAST_REMAINING_NEIGHBOR_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- A stale expected source status is also deterministic retryable conflict.
  v_denied := false;
  begin
    perform public.move_task('5b062000-0000-4000-8000-000000000003', 'Setup', 'To Do', 'Completed', null, null);
  exception when serialization_failure then v_denied := true;
  end;
  v_results := v_results || format(E'\nSTALE_EXPECTED_STATUS_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```
