# Phase 4 Step 9A-DB — My Tasks personal-feed tests

**Run on DEV only. Choose Run without RLS in the SQL Editor pop-up.**

Apply `20261022150000_list_my_tasks.sql` to Dev through the owner's normal
process before running these tests. Do not run these blocks on Prod. Each
numbered SQL test is one independent, self-contained paste and ends with an
intentional `TEST RESULTS` exception so its transaction rolls back.

Expected `TEST RESULTS` lines:

- TEST 1: 12 lines.
- TEST 2: 14 lines.
- TEST 3: 16 lines.
- TEST 4: 13 lines.

Coverage map:

- Fixed shape, caller-derived scope, grants, volatility, empty search path,
  read-only/no-lock behavior, and unchanged existing readers: TEST 1.
- Admin, both Co-Admin scopes, primary Member, assist Member, allowed viewer,
  inactive caller, and profile-less caller: TEST 2.
- Confidential real content for an assigned caller, Completed inclusion, and
  Draft/Archived exclusion: TEST 2.
- Open-before-Completed Deadline/Priority/Event ordering, one statement-time
  effective-priority calculation, status filtering, and pagination: TEST 3.
- Exact `CCF01`–`CCF04` behavior, the 100-row cap, raw RLS regression, and the
  intentional inactive-caller difference from Help Wanted: TESTS 2–4.

## TEST 1 — catalog, fixed shape, grants, and read-only body

```sql
begin;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_body text;
  v_proc pg_catalog.pg_proc%rowtype;
  v_completed_pos integer;
  v_deadline_pos integer;
begin
  select p.*
  into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.list_my_tasks(text,text,integer,integer)'::regprocedure;

  v_ok := v_proc.pronargs = 4
    and v_proc.pronargdefaults = 4
    and v_proc.proargnames[1:4] = array[
      'p_status','p_sort','p_limit','p_offset'
    ]::text[]
    and pg_catalog.oidvectortypes(v_proc.proargtypes)
      = 'text, text, integer, integer';
  v_results := v_results || format(E'\nEXACT_INPUTS_AND_FOUR_DEFAULTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_catalog.pg_get_function_result(v_proc.oid) =
    'TABLE(out_id uuid, out_title text, out_event_id uuid, out_event_name text, out_phase text, out_status text, out_effective_priority text, out_due_date timestamp with time zone, out_committee_id uuid, out_committee_name text, out_is_primary boolean, out_is_assist boolean, out_request_backup boolean)'
  into v_ok;
  v_results := v_results || format(E'\nEXACT_FIXED_OUTPUT_SHAPE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_proc.prosecdef
    and v_proc.provolatile = 's'
    and pg_catalog.pg_get_userbyid(v_proc.proowner) = 'postgres'
    and coalesce(v_proc.proconfig, '{}'::text[]) @> array['search_path=""'];
  v_results := v_results || format(E'\nSTABLE_DEFINER_POSTGRES_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  into v_ok;
  v_results := v_results || format(E'\nAUTHENTICATED_ONLY_EXECUTE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_catalog.bool_and(arg.name like 'out\_%' escape '\')
  into v_ok
  from unnest(coalesce(v_proc.proargnames, '{}'::text[]))
    with ordinality as arg(name, position)
  where arg.position > v_proc.pronargs;
  v_results := v_results || format(E'\nEVERY_OUTPUT_HAS_OUT_PREFIX: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc.oid)) into v_body;
  v_ok := v_body like '%v_caller_id uuid := auth.uid()%'
    and v_body not like '%p_user_id%';
  v_results := v_results || format(E'\nCALLER_DERIVED_NO_USER_PARAMETER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_body like '%ccf01%'
    and v_body like '%ccf02%'
    and v_body like '%ccf03%'
    and v_body like '%ccf04%';
  v_results := v_results || format(E'\nEXACT_CCF_ERROR_FAMILY_PINNED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_body like '%event_row.status = ''active''%'
    and v_body like '%any(task_row.primary_assignees)%'
    and v_body like '%any(task_row.assist_assignees)%'
    and v_body like '%task_content_access(task_row.id) = ''real''%';
  v_results := v_results || format(E'\nACTIVE_ASSIGNMENTS_AND_REAL_ACCESS_PINNED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_body like '%v_as_of timestamptz := statement_timestamp()%'
    and (
      length(v_body) - length(replace(v_body, 'statement_timestamp()', ''))
    ) / length('statement_timestamp()') = 1
    and v_body like '%with assigned_tasks as materialized%'
    and v_body like '%calculate_effective_task_priority(%v_as_of%';
  v_results := v_results || format(E'\nONE_STATEMENT_TIME_MATERIALIZED_EFFECTIVE_PRIORITY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_completed_pos := strpos(v_body, '(assigned.task_status = ''completed'') asc');
  v_deadline_pos := strpos(v_body, 'p_sort = ''deadline''');
  v_ok := v_completed_pos > 0
    and v_deadline_pos > v_completed_pos
    and v_body like '%p_sort = ''priority''%'
    and v_body like '%p_sort = ''event''%';
  v_results := v_results || format(E'\nOPEN_FIRST_THEN_ALL_THREE_SORTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_body !~ '\m(insert|update|delete|merge|truncate)\M'
    and v_body not like '%for update%'
    and v_body not like '%for no key update%'
    and v_body not like '%for share%'
    and v_body not like '%pg_advisory%';
  v_results := v_results || format(E'\nREAD_ONLY_WITH_NO_EXPLICIT_LOCKS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4
  into v_ok
  from unnest(array[
    'public.list_help_wanted_tasks(integer,integer)'::regprocedure,
    'public.list_event_board_tasks(uuid,uuid)'::regprocedure,
    'public.get_task_detail(uuid)'::regprocedure,
    'public.task_content_access(uuid)'::regprocedure
  ]) retained(oid);
  v_results := v_results || format(E'\nEXISTING_READERS_RETAINED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — caller scope, roles, confidentiality, and lifecycle

```sql
begin;

insert into public.committees (id, name) values
  ('9a020000-0000-4000-8000-000000000001', 'S9A One'),
  ('9a020000-0000-4000-8000-000000000002', 'S9A Two');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('9a020000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-admin@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-co-own@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-co-other@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-primary@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-assist@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-viewer@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000017','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-inactive@test.local','',now(),'{}','{}',now(),now()),
  ('9a020000-0000-4000-8000-000000000018','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-profileless@test.local','',now(),'{}','{}',now(),now());

insert into public.users (id, email, full_name, role, committee_id, is_active) values
  ('9a020000-0000-4000-8000-000000000011','s9a-admin@test.local','S9A Admin','Admin',null,true),
  ('9a020000-0000-4000-8000-000000000012','s9a-co-own@test.local','S9A Co Own','Co-Admin','9a020000-0000-4000-8000-000000000001',true),
  ('9a020000-0000-4000-8000-000000000013','s9a-co-other@test.local','S9A Co Other','Co-Admin','9a020000-0000-4000-8000-000000000002',true),
  ('9a020000-0000-4000-8000-000000000014','s9a-primary@test.local','S9A Primary','Member','9a020000-0000-4000-8000-000000000001',true),
  ('9a020000-0000-4000-8000-000000000015','s9a-assist@test.local','S9A Assist','Member','9a020000-0000-4000-8000-000000000001',true),
  ('9a020000-0000-4000-8000-000000000016','s9a-viewer@test.local','S9A Viewer','Member','9a020000-0000-4000-8000-000000000001',true),
  ('9a020000-0000-4000-8000-000000000017','s9a-inactive@test.local','S9A Inactive','Member','9a020000-0000-4000-8000-000000000001',false);

insert into public.events (id, name, start_date, end_date, status, created_by) values
  ('9a020000-0000-4000-8000-000000000101','S9A Active','2026-10-01','2026-12-31','Active','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000102','S9A Draft','2026-10-01','2026-12-31','Draft','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000103','S9A Archive','2026-10-01','2026-12-31','Active','9a020000-0000-4000-8000-000000000011');

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, priority, due_date,
  primary_assignees, assist_assignees, is_confidential, request_backup,
  allowed_viewers, created_by
) values
  ('9a020000-0000-4000-8000-000000000201','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Admin active','P','To Do','Medium','2099-01-10T00:00:00Z',array['9a020000-0000-4000-8000-000000000011']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000202','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Owning co active','P','To Do','Medium','2099-01-11T00:00:00Z',array['9a020000-0000-4000-8000-000000000012']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000203','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Other co cross committee','P','To Do','Medium','2099-01-12T00:00:00Z',array['9a020000-0000-4000-8000-000000000013']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000204','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000002','Real confidential title','P','To Do','High','2099-01-13T00:00:00Z',array['9a020000-0000-4000-8000-000000000014']::uuid[],'{}',true,true,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000205','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Assist only','P','In Progress','Medium','2099-01-14T00:00:00Z','{}',array['9a020000-0000-4000-8000-000000000015']::uuid[],false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000206','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Both arrays','P','To Do','Low','2099-01-15T00:00:00Z',array['9a020000-0000-4000-8000-000000000014']::uuid[],array['9a020000-0000-4000-8000-000000000014']::uuid[],false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000207','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Completed assignment','P','Completed','High','2026-10-01T00:00:00Z',array['9a020000-0000-4000-8000-000000000014']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000208','9a020000-0000-4000-8000-000000000102','9a020000-0000-4000-8000-000000000001','Draft leadership task','P','To Do','Medium','2099-01-16T00:00:00Z',array['9a020000-0000-4000-8000-000000000011']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000209','9a020000-0000-4000-8000-000000000103','9a020000-0000-4000-8000-000000000001','Archived leadership task','P','To Do','Medium','2099-01-17T00:00:00Z',array['9a020000-0000-4000-8000-000000000011']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000210','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Viewer only secret','P','To Do','Medium','2099-01-18T00:00:00Z',array['9a020000-0000-4000-8000-000000000012']::uuid[],'{}',true,false,array['9a020000-0000-4000-8000-000000000016']::uuid[],'9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000211','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Unrelated task','P','To Do','Medium','2099-01-19T00:00:00Z',array['9a020000-0000-4000-8000-000000000012']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011'),
  ('9a020000-0000-4000-8000-000000000212','9a020000-0000-4000-8000-000000000101','9a020000-0000-4000-8000-000000000001','Inactive assignment','P','To Do','Medium','2099-01-20T00:00:00Z',array['9a020000-0000-4000-8000-000000000017']::uuid[],'{}',false,false,'{}','9a020000-0000-4000-8000-000000000011');

update public.events
set status = 'Archived'
where id = '9a020000-0000-4000-8000-000000000103';

set local role authenticated;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
begin
  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select count(*) = 1 and min(out_title) = 'Admin active'
  into v_ok from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nADMIN_CALLER_ONLY_ACTIVE_ASSIGNMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  select count(*) = 3 and bool_and(out_is_primary)
  into v_ok from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nOWNING_COADMIN_CALLER_ONLY_ASSIGNMENTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  select count(*) = 1 and min(out_title) = 'Other co cross committee'
  into v_ok from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nOTHER_COADMIN_CROSS_COMMITTEE_ASSIGNMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000014","role":"authenticated"}',true);
  select count(*) = 3 into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nPRIMARY_MEMBER_EXACT_THREE_ROWS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select out_is_primary and not out_is_assist into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0)
  where out_id = '9a020000-0000-4000-8000-000000000204';
  v_results := v_results || format(E'\nPRIMARY_FLAG_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000015","role":"authenticated"}',true);
  select count(*) = 1 and bool_and(not out_is_primary and out_is_assist)
  into v_ok from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nASSIST_MEMBER_FLAG_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000014","role":"authenticated"}',true);
  select count(*) = 1 and bool_and(out_is_primary and out_is_assist)
  into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0)
  where out_id = '9a020000-0000-4000-8000-000000000206';
  v_results := v_results || format(E'\nBOTH_ARRAYS_RETURN_ONE_ROW_AND_BOTH_FLAGS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 and min(out_title) = 'Real confidential title'
    and bool_and(out_request_backup)
  into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0)
  where out_id = '9a020000-0000-4000-8000-000000000204';
  v_results := v_results || format(E'\nCONFIDENTIAL_ASSIGNEE_GETS_REAL_TITLE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from public.list_my_tasks('Completed', 'deadline', 50, 0)
  where out_id = '9a020000-0000-4000-8000-000000000207';
  v_results := v_results || format(E'\nCOMPLETED_ASSIGNMENT_INCLUDED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select count(*) = 0 into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0)
  where out_id = '9a020000-0000-4000-8000-000000000208';
  v_results := v_results || format(E'\nDRAFT_EXCLUDED_EVEN_FOR_ADMIN_FEED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0)
  where out_id = '9a020000-0000-4000-8000-000000000209';
  v_results := v_results || format(E'\nARCHIVED_EXCLUDED_EVEN_FOR_ADMIN_FEED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000016","role":"authenticated"}',true);
  select count(*) = 0 into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nALLOWED_VIEWER_WITHOUT_ASSIGNMENT_GETS_ZERO: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000017","role":"authenticated"}',true);
  v_denied := false;
  begin
    perform count(*) from public.list_my_tasks(null, 'deadline', 50, 0);
  exception when sqlstate 'CCF01' then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nINACTIVE_CALLER_CCF01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a020000-0000-4000-8000-000000000018","role":"authenticated"}',true);
  v_denied := false;
  begin
    perform count(*) from public.list_my_tasks(null, 'deadline', 50, 0);
  exception when sqlstate 'CCF01' then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nPROFILELESS_CALLER_CCF01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — filters, all three sorts, and pagination

```sql
begin;

insert into public.committees (id, name)
values ('9a030000-0000-4000-8000-000000000001', 'S9A Sort');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9a030000-0000-4000-8000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','s9a-sort@test.local','',now(),'{}','{}',now(),now()
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  '9a030000-0000-4000-8000-000000000011',
  's9a-sort@test.local','S9A Sorter','Member',
  '9a030000-0000-4000-8000-000000000001',true
);

insert into public.events (id, name, start_date, end_date, status, created_by) values
  ('9a030000-0000-4000-8000-000000000101','Zulu Event','2098-01-01','2099-12-31','Active','9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000102','Alpha Event','2098-01-01','2099-12-31','Active','9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000103','Middle Event','2098-01-01','2099-12-31','Active','9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000104','Aardvark Event','2098-01-01','2099-12-31','Active','9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000105','Beta Event','2098-01-01','2099-12-31','Active','9a030000-0000-4000-8000-000000000011');

insert into public.tasks (
  id, event_id, committee_id, title, status, priority, due_date,
  primary_assignees, created_by
) values
  ('9a030000-0000-4000-8000-000000000201','9a030000-0000-4000-8000-000000000101','9a030000-0000-4000-8000-000000000001','Open Low Early','To Do','Low','2099-01-02T00:00:00Z',array['9a030000-0000-4000-8000-000000000011']::uuid[],'9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000202','9a030000-0000-4000-8000-000000000102','9a030000-0000-4000-8000-000000000001','Open High Late','In Progress','High','2099-01-10T00:00:00Z',array['9a030000-0000-4000-8000-000000000011']::uuid[],'9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000203','9a030000-0000-4000-8000-000000000103','9a030000-0000-4000-8000-000000000001','Open Critical Mid','To Do','Critical','2099-01-05T00:00:00Z',array['9a030000-0000-4000-8000-000000000011']::uuid[],'9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000204','9a030000-0000-4000-8000-000000000104','9a030000-0000-4000-8000-000000000001','Completed Critical Earliest','Completed','Critical','2099-01-01T00:00:00Z',array['9a030000-0000-4000-8000-000000000011']::uuid[],'9a030000-0000-4000-8000-000000000011'),
  ('9a030000-0000-4000-8000-000000000205','9a030000-0000-4000-8000-000000000105','9a030000-0000-4000-8000-000000000001','Completed Low','Completed','Low','2099-01-03T00:00:00Z',array['9a030000-0000-4000-8000-000000000011']::uuid[],'9a030000-0000-4000-8000-000000000011');

set local role authenticated;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_titles text[];
  v_page_one uuid[];
  v_page_two uuid[];
begin
  perform set_config('request.jwt.claims','{"sub":"9a030000-0000-4000-8000-000000000011","role":"authenticated"}',true);

  select count(*) = 5 into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nNULL_STATUS_MEANS_ALL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 and bool_and(out_status = 'To Do') into v_ok
  from public.list_my_tasks('To Do', 'deadline', 50, 0);
  v_results := v_results || format(E'\nTODO_FILTER_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 and bool_and(out_status = 'In Progress') into v_ok
  from public.list_my_tasks('In Progress', 'deadline', 50, 0);
  v_results := v_results || format(E'\nIN_PROGRESS_FILTER_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 and bool_and(out_status = 'Completed') into v_ok
  from public.list_my_tasks('Completed', 'deadline', 50, 0);
  v_results := v_results || format(E'\nCOMPLETED_FILTER_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(feed.out_title order by feed.ordinality) into v_titles
  from public.list_my_tasks() with ordinality as feed;
  v_ok := v_titles = array[
    'Open Low Early','Open Critical Mid','Open High Late',
    'Completed Critical Earliest','Completed Low'
  ]::text[];
  v_results := v_results || format(E'\nDEFAULTS_USE_DEADLINE_ALL_50_OFFSET_ZERO: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(feed.out_title order by feed.ordinality) into v_titles
  from public.list_my_tasks(null, 'deadline', 50, 0) with ordinality as feed;
  v_ok := v_titles = array[
    'Open Low Early','Open Critical Mid','Open High Late',
    'Completed Critical Earliest','Completed Low'
  ]::text[];
  v_results := v_results || format(E'\nDEADLINE_SORT_OPEN_FIRST: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(feed.out_title order by feed.ordinality) into v_titles
  from public.list_my_tasks(null, 'priority', 50, 0) with ordinality as feed;
  v_ok := v_titles = array[
    'Open Critical Mid','Open High Late','Open Low Early',
    'Completed Critical Earliest','Completed Low'
  ]::text[];
  v_results := v_results || format(E'\nPRIORITY_SORT_EFFECTIVE_PRIORITY_OPEN_FIRST: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(feed.out_title order by feed.ordinality) into v_titles
  from public.list_my_tasks(null, 'event', 50, 0) with ordinality as feed;
  v_ok := v_titles = array[
    'Open High Late','Open Critical Mid','Open Low Early',
    'Completed Critical Earliest','Completed Low'
  ]::text[];
  v_results := v_results || format(E'\nEVENT_SORT_OPEN_FIRST: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 5
    and count(*) filter (
      where out_title = 'Open Critical Mid'
        and out_effective_priority = 'Critical'
    ) = 1
    and count(*) filter (
      where out_title = 'Open Low Early'
        and out_effective_priority = 'Low'
    ) = 1
  into v_ok
  from public.list_my_tasks(null, 'priority', 50, 0);
  v_results := v_results || format(E'\nEFFECTIVE_PRIORITY_VALUES_RETURNED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(feed.out_id order by feed.ordinality) into v_page_one
  from public.list_my_tasks(null, 'deadline', 2, 0) with ordinality as feed;
  v_ok := v_page_one = array[
    '9a030000-0000-4000-8000-000000000201',
    '9a030000-0000-4000-8000-000000000203'
  ]::uuid[];
  v_results := v_results || format(E'\nPAGE_ONE_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(feed.out_id order by feed.ordinality) into v_page_two
  from public.list_my_tasks(null, 'deadline', 2, 2) with ordinality as feed;
  v_ok := v_page_two = array[
    '9a030000-0000-4000-8000-000000000202',
    '9a030000-0000-4000-8000-000000000204'
  ]::uuid[];
  v_results := v_results || format(E'\nPAGE_TWO_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := not (v_page_one && v_page_two);
  v_results := v_results || format(E'\nPAGES_DO_NOT_OVERLAP: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 5 into v_ok
  from public.list_my_tasks(null, 'deadline', 100, 0);
  v_results := v_results || format(E'\nLIMIT_100_ACCEPTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform count(*) from public.list_my_tasks('to do', 'deadline', 50, 0);
  exception when sqlstate 'CCF03' then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nSTATUS_IS_EXACT_AND_CASE_SENSITIVE_CCF03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform count(*) from public.list_my_tasks(null, 'unknown', 50, 0);
  exception when sqlstate 'CCF04' then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nUNKNOWN_SORT_CCF04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform count(*) from public.list_my_tasks(null, null, 50, 0);
  exception when sqlstate 'CCF04' then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nNULL_SORT_CCF04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — pagination validation, inactive-reader difference, and raw RLS regression

```sql
begin;

insert into public.committees (id, name)
values ('9a040000-0000-4000-8000-000000000001', 'S9A Guard');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('9a040000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-assigned@test.local','',now(),'{}','{}',now(),now()),
  ('9a040000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-unassigned@test.local','',now(),'{}','{}',now(),now()),
  ('9a040000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s9a-inactive2@test.local','',now(),'{}','{}',now(),now());

insert into public.users (id, email, full_name, role, committee_id, is_active) values
  ('9a040000-0000-4000-8000-000000000011','s9a-assigned@test.local','S9A Assigned','Member','9a040000-0000-4000-8000-000000000001',true),
  ('9a040000-0000-4000-8000-000000000012','s9a-unassigned@test.local','S9A Unassigned','Member','9a040000-0000-4000-8000-000000000001',true),
  ('9a040000-0000-4000-8000-000000000013','s9a-inactive2@test.local','S9A Inactive Two','Member','9a040000-0000-4000-8000-000000000001',false);

insert into public.events (id, name, start_date, end_date, status, created_by)
values (
  '9a040000-0000-4000-8000-000000000101','S9A Guard Active',
  '2026-10-01','2026-12-31','Active','9a040000-0000-4000-8000-000000000011'
);

insert into public.tasks (
  id, event_id, committee_id, title, status, priority, due_date,
  primary_assignees, is_confidential, request_backup, created_by
) values
  (
    '9a040000-0000-4000-8000-000000000201',
    '9a040000-0000-4000-8000-000000000101',
    '9a040000-0000-4000-8000-000000000001',
    'S9A guarded confidential','To Do','Medium','2099-01-01T00:00:00Z',
    array['9a040000-0000-4000-8000-000000000011']::uuid[],true,false,
    '9a040000-0000-4000-8000-000000000011'
  ),
  (
    '9a040000-0000-4000-8000-000000000202',
    '9a040000-0000-4000-8000-000000000101',
    '9a040000-0000-4000-8000-000000000001',
    'S9A eligible public backup','To Do','Medium','2099-01-02T00:00:00Z',
    array['9a040000-0000-4000-8000-000000000011']::uuid[],false,true,
    '9a040000-0000-4000-8000-000000000011'
  );

set local role authenticated;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
begin
  perform set_config('request.jwt.claims','{"sub":"9a040000-0000-4000-8000-000000000011","role":"authenticated"}',true);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'deadline', null, 0);
  exception when sqlstate 'CCF02' then v_denied := true; end;
  v_results := v_results || format(E'\nNULL_LIMIT_CCF02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'deadline', 0, 0);
  exception when sqlstate 'CCF02' then v_denied := true; end;
  v_results := v_results || format(E'\nZERO_LIMIT_CCF02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'deadline', 101, 0);
  exception when sqlstate 'CCF02' then v_denied := true; end;
  v_results := v_results || format(E'\nOVER_100_LIMIT_CCF02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'deadline', 50, null);
  exception when sqlstate 'CCF02' then v_denied := true; end;
  v_results := v_results || format(E'\nNULL_OFFSET_CCF02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'deadline', 50, -1);
  exception when sqlstate 'CCF02' then v_denied := true; end;
  v_results := v_results || format(E'\nNEGATIVE_OFFSET_CCF02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks('TO DO', 'deadline', 50, 0);
  exception when sqlstate 'CCF03' then v_denied := true; end;
  v_results := v_results || format(E'\nSTATUS_VARIANT_CCF03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'Deadline', 50, 0);
  exception when sqlstate 'CCF04' then v_denied := true; end;
  v_results := v_results || format(E'\nSORT_VARIANT_CCF04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  select count(*) = 1 and min(title) = 'S9A guarded confidential'
  into v_ok
  from public.tasks
  where id = '9a040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nRAW_RLS_ASSIGNED_CONFIDENTIAL_STILL_VISIBLE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from public.list_help_wanted_tasks(50, 0)
  where out_id = '9a040000-0000-4000-8000-000000000202';
  v_results := v_results || format(E'\nHELP_WANTED_FIXTURE_VISIBLE_TO_ACTIVE_CALLER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a040000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  select count(*) = 0 into v_ok
  from public.tasks
  where id = '9a040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nRAW_RLS_UNASSIGNED_CONFIDENTIAL_STILL_HIDDEN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from public.list_my_tasks(null, 'deadline', 50, 0);
  v_results := v_results || format(E'\nPERSONAL_FEED_UNASSIGNED_CALLER_GETS_ZERO: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.task_content_access('9a040000-0000-4000-8000-000000000201');
  exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nCONTENT_HELPER_REMAINS_UNGRANTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"9a040000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  v_denied := false;
  begin perform count(*) from public.list_my_tasks(null, 'deadline', 50, 0);
  exception when sqlstate 'CCF01' then v_denied := true; end;
  select v_denied and count(*) = 0 into v_ok
  from public.list_help_wanted_tasks(50, 0);
  v_results := v_results || format(E'\nMY_TASKS_CCF01_HELP_WANTED_ZERO_ROWS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

No additional SQL test is required: TESTS 1–4 cover the complete Step 9A-DB
contract without applying the migration, changing Dev data permanently, or
starting the Step 9A UI.
