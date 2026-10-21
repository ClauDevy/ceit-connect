# Phase 4 Step 7 — dependency and confidentiality control tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

Apply `20261020120000_task_dependency_confidentiality_controls.sql` to Dev
through the owner's normal process before running these tests. Each numbered
test is one self-contained SQL Editor paste with its own Auth/profile/event/task
fixtures and caller impersonation. Every paste ends with an intentional
`raise exception 'TEST RESULTS ...'`, which rolls the transaction back.

No test creates a temporary table or touches `storage.objects`. Every fixture
sets `sort_order` explicitly. Deferred constraints are forced with
`set constraints all immediate` before their results are asserted. There are
no two-session race tests: TEST 1 checks that the shared advisory lock occurs
before dependency graph reads in the function bodies.

## TEST 1 — catalogs, grants, exact writer allowlist, and lock order

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '70010000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's7-catalog@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  '70010000-0000-4000-8000-000000000001',
  's7-catalog@test.local', 'Catalog Admin', 'Admin', null, true
);

-- Compute catalog expectations as table owner before impersonation.
select set_config(
  'test.s7_writer_allowlist',
  (
    select (
      count(*) = 2
      and count(*) filter (
        where p.oid = 'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure
      ) = 1
      and count(*) filter (
        where p.oid = 'public.set_task_dependency(uuid,uuid)'::regprocedure
      ) = 1
    )::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef is true
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and pg_catalog.pg_get_functiondef(p.oid)
        ~* '\mupdate[[:space:]]+public\.tasks\M'
  ),
  true
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '70010000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_dependency_oid oid := 'public.set_task_dependency(uuid,uuid)'::regprocedure;
  v_confidentiality_oid oid := 'public.set_task_confidentiality(uuid,boolean,uuid[])'::regprocedure;
  v_reader_oid oid := 'public.get_task_edit_controls(uuid)'::regprocedure;
  v_helper_oid oid := 'public.task_dependency_allows_forward_move(uuid,uuid)'::regprocedure;
  v_guard_oid oid := 'public.restrict_assignee_task_updates()'::regprocedure;
  v_lane_oid oid := 'public.set_task_destination_lane_order()'::regprocedure;
  v_body text;
  v_lock_pos integer;
  v_graph_pos integer;
  v_direct_denied boolean := false;
  v_ok boolean;
  v_results text := '';
begin
  v_ok := current_setting('test.s7_writer_allowlist') = 'true';
  v_results := v_results || format(E'\nEXACT_MOVE_AND_DEPENDENCY_WRITER_ALLOWLIST: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    p.prosecdef
    and p.provolatile = 'v'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = v_dependency_oid;
  v_results := v_results || format(E'\nDEPENDENCY_DEFINER_OWNER_VOLATILITY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    not p.prosecdef
    and p.provolatile = 'v'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = v_confidentiality_oid;
  v_results := v_results || format(E'\nCONFIDENTIALITY_INVOKER_VOLATILITY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    p.prosecdef
    and p.provolatile = 's'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = v_reader_oid;
  v_results := v_results || format(E'\nREADER_DEFINER_STABLE_OWNER_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    p.prosecdef
    and p.provolatile = 'v'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = v_helper_oid;
  v_results := v_results || format(E'\nTRIGGER_HELPER_DEFINER_VOLATILE_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    count(*) = 2
    and bool_and(
      not p.prosecdef
      and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    )
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid in (v_guard_oid, v_lane_oid);
  v_results := v_results || format(E'\nREPLACED_TRIGGERS_STAY_INVOKER: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select
    has_function_privilege('authenticated', v_dependency_oid, 'EXECUTE')
    and has_function_privilege('authenticated', v_confidentiality_oid, 'EXECUTE')
    and has_function_privilege('authenticated', v_reader_oid, 'EXECUTE')
    and has_function_privilege('authenticated', v_helper_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_dependency_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_confidentiality_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_reader_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_helper_oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid in (
        v_dependency_oid,
        v_confidentiality_oid,
        v_reader_oid,
        v_helper_oid
      )
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  into v_ok;
  v_results := v_results || format(E'\nEXACT_AUTHENTICATED_GRANTS_NO_PUBLIC_OR_ANON: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(v_dependency_oid)) into v_body;
  v_lock_pos := strpos(v_body, 'pg_advisory_xact_lock');
  v_graph_pos := strpos(v_body, 'with recursive dependency_chain');
  v_ok := v_lock_pos > 0 and v_graph_pos > v_lock_pos;
  v_results := v_results || format(E'\nDEPENDENCY_LOCK_PRECEDES_GRAPH_READ: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(v_lane_oid)) into v_body;
  v_ok := strpos(v_body, 'current_user = ''postgres''') > 0
    and strpos(
      substring(v_body from strpos(v_body, 'current_user = ''postgres''')),
      'return new;'
    ) > 0
    and strpos(v_body, 'task_dependency_allows_forward_move') > strpos(v_body, 'pg_advisory_xact_lock');
  v_results := v_results || format(E'\nRAW_GATE_AFTER_POSTGRES_RETURN_AND_EVENT_LOCK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(v_guard_oid)) into v_body;
  v_ok := v_body like '%- ''status''%'
    and v_body like '%- ''sort_order''%'
    and v_body like '%- ''depends_on_task_id''%'
    and v_body not like '%- ''is_confidential''%'
    and v_body not like '%- ''allowed_viewers''%';
  v_results := v_results || format(E'\nOWNER_BRANCH_EXACT_COLUMN_UNION: %s', case when v_ok then 'PASS' else 'FAIL' end);

  begin
    perform public.task_dependency_allows_forward_move(
      '00000000-0000-4000-8000-000000000001', null
    );
  exception when insufficient_privilege then
    v_direct_denied := true;
  end;
  v_results := v_results || format(E'\nHELPER_DIRECT_CALL_DENIED: %s', case when v_direct_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

Trigger functions are deliberately absent from the writer allowlist unless
their own stored body contains `UPDATE public.tasks`. Returning `trigger`,
changing `NEW`, validating rows, or writing `activity_log` does not make a
function a direct task-table writer.

## TEST 2 — dependency roles, real/masked access, integrity, clear, and lifecycle

```sql
begin;

insert into public.committees (id, name) values
  ('70020000-0000-4000-8000-000000000001', 'S7 Dependency One'),
  ('70020000-0000-4000-8000-000000000002', 'S7 Dependency Two');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('70020000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-admin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70020000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-co-one@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70020000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-co-two@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70020000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-member@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70020000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7-inactive@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.users (id, email, full_name, role, committee_id, is_active) values
  ('70020000-0000-4000-8000-000000000011','s7-admin@test.local','S7 Admin','Admin',null,true),
  ('70020000-0000-4000-8000-000000000012','s7-co-one@test.local','S7 Co One','Co-Admin','70020000-0000-4000-8000-000000000001',true),
  ('70020000-0000-4000-8000-000000000013','s7-co-two@test.local','S7 Co Two','Co-Admin','70020000-0000-4000-8000-000000000002',true),
  ('70020000-0000-4000-8000-000000000014','s7-member@test.local','S7 Member','Member','70020000-0000-4000-8000-000000000001',true),
  ('70020000-0000-4000-8000-000000000015','s7-inactive@test.local','S7 Inactive','Co-Admin','70020000-0000-4000-8000-000000000001',false);

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values
  ('70020000-0000-4000-8000-000000000101','S7 Active','2026-10-20','2026-10-22','Active','70020000-0000-4000-8000-000000000011'),
  ('70020000-0000-4000-8000-000000000102','S7 Other','2026-10-20','2026-10-22','Active','70020000-0000-4000-8000-000000000011'),
  ('70020000-0000-4000-8000-000000000103','S7 Draft','2026-10-20','2026-10-22','Draft','70020000-0000-4000-8000-000000000011'),
  ('70020000-0000-4000-8000-000000000104','S7 Archived','2026-10-20','2026-10-22','Active','70020000-0000-4000-8000-000000000011');

insert into public.tasks (
  id, event_id, committee_id, title, status, priority, task_type,
  primary_assignees, assist_assignees, is_confidential, allowed_viewers,
  created_by, sort_order
) values
  ('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000101','70020000-0000-4000-8000-000000000001','Dependent','To Do','Medium','Deliverable','{}','{}',false,'{}','70020000-0000-4000-8000-000000000011',1024),
  ('70020000-0000-4000-8000-000000000202','70020000-0000-4000-8000-000000000101','70020000-0000-4000-8000-000000000002','Hidden prerequisite','To Do','Medium','Deliverable','{}','{}',true,'{}','70020000-0000-4000-8000-000000000011',2048),
  ('70020000-0000-4000-8000-000000000203','70020000-0000-4000-8000-000000000101','70020000-0000-4000-8000-000000000001','Masked dependent','To Do','Medium','Deliverable','{}','{}',true,'{}','70020000-0000-4000-8000-000000000011',3072),
  ('70020000-0000-4000-8000-000000000204','70020000-0000-4000-8000-000000000102','70020000-0000-4000-8000-000000000001','Other event','To Do','Medium','Deliverable','{}','{}',false,'{}','70020000-0000-4000-8000-000000000011',1024),
  ('70020000-0000-4000-8000-000000000205','70020000-0000-4000-8000-000000000103','70020000-0000-4000-8000-000000000001','Draft own','To Do','Medium','Deliverable','{}','{}',false,'{}','70020000-0000-4000-8000-000000000011',1024),
  ('70020000-0000-4000-8000-000000000206','70020000-0000-4000-8000-000000000103','70020000-0000-4000-8000-000000000002','Draft other','To Do','Medium','Deliverable','{}','{}',false,'{}','70020000-0000-4000-8000-000000000011',2048),
  ('70020000-0000-4000-8000-000000000207','70020000-0000-4000-8000-000000000104','70020000-0000-4000-8000-000000000001','Archived task','To Do','Medium','Deliverable','{}','{}',false,'{}','70020000-0000-4000-8000-000000000011',1024),
  ('70020000-0000-4000-8000-000000000208','70020000-0000-4000-8000-000000000103','70020000-0000-4000-8000-000000000001','Draft own prerequisite','To Do','Medium','Deliverable','{}','{}',false,'{}','70020000-0000-4000-8000-000000000011',3072);

update public.events
set status = 'Archived'
where id = '70020000-0000-4000-8000-000000000104';

set constraints all immediate;

set local role authenticated;

do $$
declare
  v_denied boolean;
  v_ok boolean;
  v_status text;
  v_event_id uuid;
  v_results text := '';
begin
  -- Owning Co-Admin has real access to the dependent. The other committee's
  -- confidential prerequisite is selectable only with the masked label.
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000012','role','authenticated')::text, true);
  select exists (
    select 1
    from public.get_task_edit_controls('70020000-0000-4000-8000-000000000201') c,
         jsonb_array_elements(c.dependency_options) option_row
    where option_row->>'id' = '70020000-0000-4000-8000-000000000202'
      and option_row->>'label' = 'Confidential Task'
  ) into v_ok;
  v_results := v_results || format(E'\nMASKED_PREREQUISITE_LABEL_SAFE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform public.set_task_dependency(
    '70020000-0000-4000-8000-000000000201',
    '70020000-0000-4000-8000-000000000202'
  );
  select status, event_id into v_status, v_event_id
  from public.tasks where id = '70020000-0000-4000-8000-000000000201';
  v_ok := v_status = 'To Do' and v_event_id = '70020000-0000-4000-8000-000000000101';
  v_results := v_results || format(E'\nCROSS_COMMITTEE_DEPENDENCY_ONLY_NO_STATUS_OR_EVENT_CHANGE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Other Co-Admin has only masked access to the confidential dependent.
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  select count(*) = 0
  into v_ok
  from public.get_task_edit_controls('70020000-0000-4000-8000-000000000203');
  v_denied := false;
  begin
    perform public.set_task_dependency(
      '70020000-0000-4000-8000-000000000203',
      '70020000-0000-4000-8000-000000000202'
    );
  exception when insufficient_privilege then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nMASKED_DEPENDENT_READER_AND_WRITE_DENIED: %s', case when v_ok and v_denied then 'PASS' else 'FAIL' end);

  -- A Co-Admin with real Active-task access may intentionally act across committees.
  perform public.set_task_dependency(
    '70020000-0000-4000-8000-000000000201', null
  );
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  select depends_on_task_id is null into v_ok
  from public.tasks where id = '70020000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nOTHER_COMMITTEE_COADMIN_CLEAR_WITH_REAL_ACCESS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Members, inactive leadership, and profile-less authenticated callers fail closed.
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000014','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000202');
  exception when insufficient_privilege then v_denied := true;
  end;
  select v_denied and count(*) = 0 into v_ok
  from public.get_task_edit_controls('70020000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nMEMBER_DENIED_AND_READER_EMPTY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000015','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000202');
  exception when insufficient_privilege then v_denied := true;
  end;
  v_results := v_results || format(E'\nINACTIVE_COADMIN_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000099','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000202');
  exception when insufficient_privilege then v_denied := true;
  end;
  v_results := v_results || format(E'\nPROFILELESS_CALLER_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- Admin integrity checks: self, cross-event, cycle, clear, referenced delete.
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000201');
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nSELF_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000204');
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nCROSS_EVENT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform public.set_task_dependency('70020000-0000-4000-8000-000000000201','70020000-0000-4000-8000-000000000202');
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000202','70020000-0000-4000-8000-000000000201');
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nCYCLE_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    delete from public.tasks where id = '70020000-0000-4000-8000-000000000202';
  exception when sqlstate 'CCD01' then v_denied := true;
  end;
  v_results := v_results || format(E'\nREFERENCED_PREREQUISITE_DELETE_STILL_BLOCKED: %s', case when v_denied then 'PASS' else 'FAIL' end);
  perform public.set_task_dependency('70020000-0000-4000-8000-000000000201', null);

  -- Draft is leadership-only and still requires real dependent access.
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000012','role','authenticated')::text, true);
  perform public.set_task_dependency('70020000-0000-4000-8000-000000000205','70020000-0000-4000-8000-000000000208');
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000205','70020000-0000-4000-8000-000000000206');
  exception when sqlstate '42501' then v_denied := true;
  end;
  v_results := v_results || format(E'\nDRAFT_OTHER_COMMITTEE_PREREQUISITE_HIDDEN_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000205', null);
  exception when sqlstate '42501' then v_denied := true;
  end;
  v_results := v_results || format(E'\nDRAFT_OTHER_COMMITTEE_DEPENDENT_HIDDEN_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','70020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_dependency('70020000-0000-4000-8000-000000000207', null);
  exception when others then
    v_denied := sqlerrm like '%Archived%';
  end;
  select v_denied and count(*) = 0 into v_ok
  from public.get_task_edit_controls('70020000-0000-4000-8000-000000000207');
  v_results := v_results || format(E'\nARCHIVED_WRITE_REJECTED_AND_READER_EMPTY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  set constraints all immediate;
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — confidentiality validation, retained inactive viewers, and immediate access

```sql
begin;

insert into public.committees (id, name) values
  ('70030000-0000-4000-8000-000000000001', 'S7 Confidential One'),
  ('70030000-0000-4000-8000-000000000002', 'S7 Confidential Two');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('70030000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7c-admin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70030000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7c-co-one@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70030000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7c-co-two@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70030000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7c-viewer@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70030000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7c-old-inactive@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70030000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7c-new-inactive@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.users (id, email, full_name, role, committee_id, is_active) values
  ('70030000-0000-4000-8000-000000000011','s7c-admin@test.local','S7C Admin','Admin',null,true),
  ('70030000-0000-4000-8000-000000000012','s7c-co-one@test.local','S7C Co One','Co-Admin','70030000-0000-4000-8000-000000000001',true),
  ('70030000-0000-4000-8000-000000000013','s7c-co-two@test.local','S7C Co Two','Co-Admin','70030000-0000-4000-8000-000000000002',true),
  ('70030000-0000-4000-8000-000000000014','s7c-viewer@test.local','S7C Viewer','Member','70030000-0000-4000-8000-000000000002',true),
  ('70030000-0000-4000-8000-000000000015','s7c-old-inactive@test.local','S7C Old Inactive','Member','70030000-0000-4000-8000-000000000002',false),
  ('70030000-0000-4000-8000-000000000016','s7c-new-inactive@test.local','S7C New Inactive','Member','70030000-0000-4000-8000-000000000002',false);

insert into public.events (id, name, start_date, end_date, status, created_by) values
  ('70030000-0000-4000-8000-000000000101','S7C Active','2026-10-20','2026-10-22','Active','70030000-0000-4000-8000-000000000011'),
  ('70030000-0000-4000-8000-000000000102','S7C Archived','2026-10-20','2026-10-22','Active','70030000-0000-4000-8000-000000000011'),
  ('70030000-0000-4000-8000-000000000103','S7C Draft','2026-10-20','2026-10-22','Draft','70030000-0000-4000-8000-000000000011');

insert into public.tasks (
  id, event_id, committee_id, title, status, priority, task_type,
  primary_assignees, assist_assignees, is_confidential, allowed_viewers,
  created_by, sort_order
) values
  ('70030000-0000-4000-8000-000000000201','70030000-0000-4000-8000-000000000101','70030000-0000-4000-8000-000000000001','Secret task','To Do','Medium','Deliverable','{}','{}',true,array['70030000-0000-4000-8000-000000000015']::uuid[],'70030000-0000-4000-8000-000000000014',1024),
  ('70030000-0000-4000-8000-000000000202','70030000-0000-4000-8000-000000000102','70030000-0000-4000-8000-000000000001','Archived secret','To Do','Medium','Deliverable','{}','{}',true,'{}','70030000-0000-4000-8000-000000000011',1024),
  ('70030000-0000-4000-8000-000000000203','70030000-0000-4000-8000-000000000103','70030000-0000-4000-8000-000000000001','Draft secret','To Do','Medium','Deliverable','{}','{}',false,'{}','70030000-0000-4000-8000-000000000011',1024),
  ('70030000-0000-4000-8000-000000000204','70030000-0000-4000-8000-000000000101','70030000-0000-4000-8000-000000000001','Active public task','To Do','Medium','Deliverable','{}','{}',false,'{}','70030000-0000-4000-8000-000000000011',2048);

update public.events
set status = 'Archived'
where id = '70030000-0000-4000-8000-000000000102';

insert into public.task_work_links (id, task_id, name, url, created_by)
values (
  '70030000-0000-4000-8000-000000000301',
  '70030000-0000-4000-8000-000000000201',
  'Fixture',
  'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view',
  '70030000-0000-4000-8000-000000000011'
);

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_denied boolean;
  v_ok boolean;
  v_keys text[];
  v_results text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000011','role','authenticated')::text, true);

  -- The stored inactive viewer may remain while one active viewer is added.
  perform public.set_task_confidentiality(
    '70030000-0000-4000-8000-000000000201',
    true,
    array[
      '70030000-0000-4000-8000-000000000015',
      '70030000-0000-4000-8000-000000000014'
    ]::uuid[]
  );
  select allowed_viewers = array[
    '70030000-0000-4000-8000-000000000015',
    '70030000-0000-4000-8000-000000000014'
  ]::uuid[] into v_ok
  from public.tasks where id = '70030000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nRETAIN_INACTIVE_AND_ADD_ACTIVE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Reader returns the full stored list, omits inactive choices, and exposes
  -- exactly id/full_name/avatar_url for every profile object.
  select
    jsonb_array_length(c.allowed_viewers) = 2
    and not exists (
      select 1 from jsonb_array_elements(c.viewer_options) option_row
      where option_row->>'id' = '70030000-0000-4000-8000-000000000015'
    )
    and not exists (
      select 1
      from jsonb_array_elements(c.allowed_viewers || c.viewer_options) as profile(value),
           lateral (
             select array_agg(key order by key) as keys
             from jsonb_object_keys(profile.value) key
           ) key_list
      where key_list.keys <> array['avatar_url','full_name','id']::text[]
    )
  into v_ok
  from public.get_task_edit_controls('70030000-0000-4000-8000-000000000201') c;
  v_results := v_results || format(E'\nFULL_CURRENT_VIEWERS_AND_SAFE_PROFILE_SHAPE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality(
      '70030000-0000-4000-8000-000000000201', true,
      array['70030000-0000-4000-8000-000000000015','70030000-0000-4000-8000-000000000016']::uuid[]
    );
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nNEW_INACTIVE_VIEWER_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality(
      '70030000-0000-4000-8000-000000000201', true,
      array['70030000-0000-4000-8000-000000000099']::uuid[]
    );
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nMISSING_NEW_VIEWER_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality(
      '70030000-0000-4000-8000-000000000201', true,
      array['70030000-0000-4000-8000-000000000014','70030000-0000-4000-8000-000000000014']::uuid[]
    );
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nDUPLICATE_VIEWER_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality(
      '70030000-0000-4000-8000-000000000201', true,
      array[null]::uuid[]
    );
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nNULL_VIEWER_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality(
      '70030000-0000-4000-8000-000000000201', true,
      array_fill('70030000-0000-4000-8000-000000000014'::uuid, array[51])
    );
  exception when invalid_parameter_value then v_denied := sqlerrm like '%at most 50%';
  end;
  v_results := v_results || format(E'\nMAX_FIFTY_ENFORCED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality(
      '70030000-0000-4000-8000-000000000201', false,
      array['70030000-0000-4000-8000-000000000014']::uuid[]
    );
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nNONCONFIDENTIAL_NONEMPTY_LIST_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- Grant is visible immediately through detail and work-link readers.
  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000014','role','authenticated')::text, true);
  select
    (select title = 'Secret task' and is_masked is false from public.get_task_detail('70030000-0000-4000-8000-000000000201'))
    and (select count(*) = 1 from public.get_task_work_links('70030000-0000-4000-8000-000000000201'))
  into v_ok;
  v_results := v_results || format(E'\nGRANT_IMMEDIATE_FOR_DETAIL_AND_WORK_LINKS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  perform public.set_task_confidentiality(
    '70030000-0000-4000-8000-000000000201', true,
    array['70030000-0000-4000-8000-000000000015']::uuid[]
  );
  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000014','role','authenticated')::text, true);
  select
    (select title = 'Confidential Task' and is_masked is true from public.get_task_detail('70030000-0000-4000-8000-000000000201'))
    and (select count(*) = 0 from public.get_task_work_links('70030000-0000-4000-8000-000000000201'))
  into v_ok;
  v_results := v_results || format(E'\nREVOCATION_IMMEDIATE_FOR_DETAIL_AND_WORK_LINKS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Owning Co-Admin succeeds; other Co-Admin and Member do not.
  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000012','role','authenticated')::text, true);
  perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000201', true, array['70030000-0000-4000-8000-000000000015']::uuid[]);
  perform public.set_task_confidentiality(
    '70030000-0000-4000-8000-000000000201',
    true,
    array[
      '70030000-0000-4000-8000-000000000015',
      '70030000-0000-4000-8000-000000000014'
    ]::uuid[]
  );
  select allowed_viewers = array[
    '70030000-0000-4000-8000-000000000015',
    '70030000-0000-4000-8000-000000000014'
  ]::uuid[] into v_ok
  from public.tasks where id = '70030000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nOWNING_COADMIN_ADDS_CROSS_COMMITTEE_ACTIVE_VIEWER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000203', true, '{}'::uuid[]);
  select is_confidential into v_ok
  from public.tasks where id = '70030000-0000-4000-8000-000000000203';
  v_results := v_results || format(E'\nDRAFT_OWNING_LEADERSHIP_ALLOWED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000204', true, '{}'::uuid[]);
  exception when sqlstate '42501' then
    v_denied := sqlerrm = 'Co-Admins can change confidentiality only for their own committee''s tasks.';
  end;
  v_results := v_results || format(E'\nOTHER_COMMITTEE_COADMIN_DENIED_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000201', true, '{}'::uuid[]);
  exception when sqlstate '42501' then v_denied := true;
  end;
  v_results := v_results || format(E'\nCONFIDENTIAL_TASK_OTHER_COMMITTEE_COADMIN_DENIED_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000014','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000201', true, '{}'::uuid[]);
  exception when insufficient_privilege then v_denied := true;
  end;
  v_results := v_results || format(E'\nMEMBER_AND_CREATOR_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- In the invoker function, Archived events_update RLS may make FOR SHARE
  -- return no row. The function must raise the explicit Archived/unavailable error.
  perform set_config('request.jwt.claims', json_build_object('sub','70030000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000202', true, '{}'::uuid[]);
  exception when insufficient_privilege then
    v_denied := sqlerrm = 'The task event is Archived or unavailable.';
  when others then
    v_denied := sqlerrm like '%Archived%';
  end;
  v_results := v_results || format(E'\nARCHIVED_OR_NO_EVENT_LOCK_ROW_EXPLICITLY_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- Turning confidentiality off requires and stores an empty list.
  perform public.set_task_confidentiality('70030000-0000-4000-8000-000000000201', false, '{}'::uuid[]);
  select is_confidential is false and allowed_viewers = '{}'::uuid[] into v_ok
  from public.tasks where id = '70030000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nCONFIDENTIAL_OFF_CLEARS_VIEWERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  set constraints all immediate;
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — direct forgery, owner-column union, raw forward gate, and move_task regression

```sql
begin;

insert into public.committees (id, name)
values ('70040000-0000-4000-8000-000000000001', 'S7 Raw Gate');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('70040000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7r-admin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70040000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7r-co@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('70040000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7r-member@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.users (id, email, full_name, role, committee_id, is_active) values
  ('70040000-0000-4000-8000-000000000011','s7r-admin@test.local','S7R Admin','Admin',null,true),
  ('70040000-0000-4000-8000-000000000012','s7r-co@test.local','S7R Co','Co-Admin','70040000-0000-4000-8000-000000000001',true),
  ('70040000-0000-4000-8000-000000000013','s7r-member@test.local','S7R Member','Member','70040000-0000-4000-8000-000000000001',true);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('70040000-0000-4000-8000-000000000101','S7 Raw Event','2026-10-20','2026-10-22','Active','70040000-0000-4000-8000-000000000011'),
  ('70040000-0000-4000-8000-000000000102','S7 Other Event','2026-10-20','2026-10-22','Active','70040000-0000-4000-8000-000000000011');

insert into public.tasks (
  id, event_id, committee_id, title, status, priority, task_type,
  primary_assignees, assist_assignees, is_confidential, allowed_viewers,
  created_by, sort_order
) values
  ('70040000-0000-4000-8000-000000000201','70040000-0000-4000-8000-000000000101','70040000-0000-4000-8000-000000000001','Raw dependent','To Do','Medium','Deliverable',array['70040000-0000-4000-8000-000000000013']::uuid[],'{}',false,'{}','70040000-0000-4000-8000-000000000011',1024),
  ('70040000-0000-4000-8000-000000000202','70040000-0000-4000-8000-000000000101','70040000-0000-4000-8000-000000000001','Incomplete prerequisite','To Do','Medium','Deliverable','{}','{}',false,'{}','70040000-0000-4000-8000-000000000011',2048),
  ('70040000-0000-4000-8000-000000000203','70040000-0000-4000-8000-000000000101','70040000-0000-4000-8000-000000000001','Completed prerequisite','Completed','Medium','Deliverable','{}','{}',false,'{}','70040000-0000-4000-8000-000000000011',1024),
  ('70040000-0000-4000-8000-000000000204','70040000-0000-4000-8000-000000000102','70040000-0000-4000-8000-000000000001','Other event task','To Do','Medium','Deliverable','{}','{}',false,'{}','70040000-0000-4000-8000-000000000011',1024);

set constraints all immediate;

-- Migration-owner context may change the exact union, but nothing else.
update public.tasks
set depends_on_task_id = '70040000-0000-4000-8000-000000000202'
where id = '70040000-0000-4000-8000-000000000201';

do $$
declare
  v_denied boolean := false;
begin
  begin
    update public.tasks
    set title = 'Forged owner title'
    where id = '70040000-0000-4000-8000-000000000201';
  exception when others then
    v_denied := sqlerrm like '%status, sort_order, and depends_on_task_id%';
  end;
  perform set_config('test.s7_owner_union_denied_title', v_denied::text, true);
end
$$;

update public.tasks
set depends_on_task_id = null
where id = '70040000-0000-4000-8000-000000000201';

set local role authenticated;

do $$
declare
  v_denied boolean;
  v_ok boolean;
  v_results text := '';
begin
  v_results := v_results || format(E'\nOWNER_BRANCH_REJECTS_NONUNION_COLUMN: %s', case when current_setting('test.s7_owner_union_denied_title') = 'true' then 'PASS' else 'FAIL' end);

  -- Assigned Member cannot forge dependency/confidentiality/viewers.
  perform set_config('request.jwt.claims', json_build_object('sub','70040000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  v_denied := false;
  begin
    update public.tasks
    set depends_on_task_id = '70040000-0000-4000-8000-000000000202'
    where id = '70040000-0000-4000-8000-000000000201';
  exception when others then v_denied := true;
  end;
  v_results := v_results || format(E'\nASSIGNEE_RAW_DEPENDENCY_FORGERY_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    update public.tasks
    set is_confidential = true,
        allowed_viewers = array['70040000-0000-4000-8000-000000000013']::uuid[]
    where id = '70040000-0000-4000-8000-000000000201';
  exception when others then v_denied := true;
  end;
  v_results := v_results || format(E'\nASSIGNEE_RAW_CONFIDENTIALITY_FORGERY_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- The raw assignee forward path uses the same dependency rule.
  perform set_config('request.jwt.claims', json_build_object('sub','70040000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  perform public.set_task_dependency('70040000-0000-4000-8000-000000000201','70040000-0000-4000-8000-000000000202');
  perform set_config('request.jwt.claims', json_build_object('sub','70040000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  v_denied := false;
  begin
    update public.tasks
    set status = 'In Progress'
    where id = '70040000-0000-4000-8000-000000000201';
  exception when others then
    v_denied := sqlerrm like '%Complete the prerequisite%';
  end;
  v_results := v_results || format(E'\nRAW_ASSIGNEE_FORWARD_INCOMPLETE_BLOCKED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- A leadership raw update that changes dependency and status together must
  -- check NEW.depends_on_task_id, not the previously stored value.
  perform set_config('request.jwt.claims', json_build_object('sub','70040000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  perform public.set_task_dependency('70040000-0000-4000-8000-000000000201', null);
  v_denied := false;
  begin
    update public.tasks
    set depends_on_task_id = '70040000-0000-4000-8000-000000000202',
        status = 'In Progress'
    where id = '70040000-0000-4000-8000-000000000201';
  exception when others then
    v_denied := sqlerrm like '%Complete the prerequisite%';
  end;
  select
    v_denied
    and status = 'To Do'
    and depends_on_task_id is null
  into v_ok
  from public.tasks where id = '70040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nRAW_LEADERSHIP_COMBINED_DEPENDENCY_FORWARD_CHECKED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    update public.tasks
    set event_id = '70040000-0000-4000-8000-000000000102'
    where id = '70040000-0000-4000-8000-000000000201';
  exception when others then v_denied := true;
  end;
  v_results := v_results || format(E'\nEVENT_ID_REPARENT_FORGERY_STILL_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  -- Completed prerequisite permits forward; incomplete prerequisite does not
  -- affect backward or same-status updates.
  update public.tasks
  set depends_on_task_id = '70040000-0000-4000-8000-000000000203',
      status = 'In Progress'
  where id = '70040000-0000-4000-8000-000000000201';
  update public.tasks
  set depends_on_task_id = '70040000-0000-4000-8000-000000000202'
  where id = '70040000-0000-4000-8000-000000000201';
  update public.tasks
  set status = 'To Do'
  where id = '70040000-0000-4000-8000-000000000201';
  select status = 'To Do' and depends_on_task_id = '70040000-0000-4000-8000-000000000202'
  into v_ok from public.tasks where id = '70040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nCOMPLETED_FORWARD_AND_INCOMPLETE_SAME_OR_BACKWARD_ALLOWED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- move_task still owns its own dependency gate because the lane trigger's
  -- current_user=postgres branch returns before the raw gate.
  v_denied := false;
  begin
    perform public.move_task(
      '70040000-0000-4000-8000-000000000201', null, 'To Do',
      'In Progress', null, null
    );
  exception when others then
    v_denied := sqlerrm like '%Complete the prerequisite%';
  end;
  perform public.set_task_dependency('70040000-0000-4000-8000-000000000201','70040000-0000-4000-8000-000000000203');
  perform public.move_task(
    '70040000-0000-4000-8000-000000000201', null, 'To Do',
    'In Progress', null, null
  );
  perform public.set_task_dependency('70040000-0000-4000-8000-000000000201','70040000-0000-4000-8000-000000000202');
  perform public.move_task(
    '70040000-0000-4000-8000-000000000201', null, 'In Progress',
    'To Do', null, null
  );
  select v_denied and status = 'To Do' into v_ok
  from public.tasks where id = '70040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nMOVE_TASK_GATE_UNCHANGED_FORWARD_BLOCK_BACKWARD_ALLOW: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Leadership's existing raw confidentiality branch remains unchanged; the
  -- app UI nevertheless uses only the narrow RPC.
  update public.tasks
  set is_confidential = true,
      allowed_viewers = '{}'::uuid[]
  where id = '70040000-0000-4000-8000-000000000201';
  select is_confidential into v_ok
  from public.tasks where id = '70040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nEXISTING_ADMIN_RAW_SCOPE_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  set constraints all immediate;
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## Manual checklist

Use **Claudee (Admin)**:

1. Open an Active task at `/tasks/[taskId]`.
2. Set a same-event prerequisite and confirm the dependency banner updates.
3. Attempt self and cyclic choices and confirm readable errors.
4. Select a confidential prerequisite Claudee can see only as a shell and confirm its picker label is `Confidential Task`.
5. Clear the dependency and confirm status does not change.
6. Turn Confidential on, add an active viewer, and save.
7. Confirm the access dialog exposes only names and avatars.
8. Remove that viewer and verify their detail/work-link access disappears after refresh.
9. Turn Confidential off and confirm the additional-viewer list clears.
10. Open an Archived task and confirm all Step 7 controls are absent.

Use **tv (Member)**:

1. Open a real-content task and confirm no dependency/confidentiality controls appear.
2. Open a masked confidential task and confirm no title, viewer list, or edit state leaks.
3. As an assignee of a dependent task, try moving forward while its prerequisite is incomplete; confirm the move is blocked.
4. Move backward and confirm it remains allowed.
5. Complete the prerequisite and confirm a forward move succeeds.
6. In the browser Network panel, confirm the UI calls only the three Step 7 RPCs and never performs a raw `tasks` update.
