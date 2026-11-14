# Phase 4 Step 8A — claim, backup, volunteers, and workload tests

**Run on DEV only. Choose Run without RLS in the SQL Editor pop-up.**

Apply `20261022120000_task_claim_backup_volunteers.sql` to Dev through the
owner's normal process before running these tests. Do not run these blocks on
Prod. Each numbered SQL test is an independent paste and ends with an
intentional `TEST RESULTS` exception so its transaction rolls back.

Expected `TEST RESULTS` lines:

- TEST 1: 19 lines (the mutator lock-order loop emits five lines).
- TEST 2: 14 lines.
- TEST 3: 11 lines.
- TEST 4: 16 lines.
- TEST 5: 10 lines.

Coverage map:

- Help Wanted fixed shape: TEST 1; Active/incomplete lifecycle filtering: TEST 5.
- Workload counts and leadership-only access: TEST 5.
- Child-table RLS, immutable `task_id`/all updates, and Archived-parent freeze: TEST 5.
- Confidential masking: TEST 2 (claim), TEST 3 (backup), TEST 4 (volunteer/accept), and TEST 5 (Help Wanted).
- Draft and Archived denials: TEST 2 (claim), TEST 3 (backup), TEST 4 (volunteer/accept), and TEST 5 (Help Wanted/child freeze).

No TEST 6 is required because every requested concern has a self-contained
rollback-safe paste in TESTS 1–5.

## TEST 1 — schema, catalogs, grants, exact writers, and lock order

```sql
begin;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_names text[];
  v_body text;
  v_function regprocedure;
  v_task_pos integer;
  v_event_pos integer;
begin
  select array_agg(a.attname order by a.attnum) =
    array['task_id','user_id','created_at']::text[]
  into v_ok
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.task_volunteers'::regclass
    and a.attnum > 0 and not a.attisdropped;
  v_results := v_results || format(E'\nTABLE_EXACT_THREE_COLUMNS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select c.relrowsecurity and not c.relforcerowsecurity
  into v_ok from pg_catalog.pg_class c
  where c.oid = 'public.task_volunteers'::regclass;
  v_results := v_results || format(E'\nRLS_ENABLED_NOT_FORCED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.task_volunteers'::regclass;
  v_results := v_results || format(E'\nDENY_BY_DEFAULT_NO_POLICIES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not pg_catalog.has_table_privilege('authenticated','public.task_volunteers','SELECT')
    and not pg_catalog.has_table_privilege('authenticated','public.task_volunteers','INSERT')
    and not pg_catalog.has_table_privilege('authenticated','public.task_volunteers','UPDATE')
    and not pg_catalog.has_table_privilege('authenticated','public.task_volunteers','DELETE')
    and not pg_catalog.has_table_privilege('anon','public.task_volunteers','SELECT')
    and not pg_catalog.has_table_privilege('anon','public.task_volunteers','INSERT')
    and not pg_catalog.has_table_privilege('anon','public.task_volunteers','UPDATE')
    and not pg_catalog.has_table_privilege('anon','public.task_volunteers','DELETE')
  into v_ok;
  v_results := v_results || format(E'\nNO_CLIENT_TABLE_GRANTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 into v_ok
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.task_volunteers'::regclass
    and c.contype = 'f'
    and c.confdeltype = 'c';
  v_results := v_results || format(E'\nBOTH_FOREIGN_KEYS_CASCADE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 8 into v_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'claim_task','set_task_backup_request','volunteer_for_task',
      'withdraw_task_volunteer','accept_task_volunteer',
      'get_task_backup_state','list_help_wanted_tasks',
      'list_active_task_assignees_with_workload'
    )
    and p.prosecdef
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""'];
  v_results := v_results || format(E'\nEIGHT_PUBLIC_FUNCTIONS_PINNED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 8 into v_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'claim_task','set_task_backup_request','volunteer_for_task',
      'withdraw_task_volunteer','accept_task_volunteer',
      'get_task_backup_state','list_help_wanted_tasks',
      'list_active_task_assignees_with_workload'
    )
    and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
    and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE');
  v_results := v_results || format(E'\nAUTHENTICATED_ONLY_EXECUTE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select bool_and(arg.name like 'out\_%' escape '\')
  into v_ok
  from pg_catalog.pg_proc p
  cross join lateral unnest(coalesce(p.proargnames,'{}'::text[]))
    with ordinality as arg(name, position)
  where p.oid in (
    'public.claim_task(uuid)'::regprocedure,
    'public.set_task_backup_request(uuid,boolean)'::regprocedure,
    'public.volunteer_for_task(uuid)'::regprocedure,
    'public.withdraw_task_volunteer(uuid)'::regprocedure,
    'public.accept_task_volunteer(uuid,uuid)'::regprocedure,
    'public.get_task_backup_state(uuid)'::regprocedure,
    'public.list_help_wanted_tasks(integer,integer)'::regprocedure,
    'public.list_active_task_assignees_with_workload()'::regprocedure
  )
    and arg.position > p.pronargs;
  v_results := v_results || format(E'\nEVERY_OUTPUT_COLUMN_HAS_OUT_PREFIX: %s', case when coalesce(v_ok,false) then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef('public.restrict_assignee_task_updates()'::regprocedure)) into v_body;
  v_ok := v_body like '%- ''status''%'
    and v_body like '%- ''sort_order''%'
    and v_body like '%- ''depends_on_task_id''%'
    and v_body like '%- ''primary_assignees''%'
    and v_body like '%- ''assist_assignees''%'
    and v_body like '%- ''request_backup''%'
    and v_body not like '%- ''event_id''%'
    and v_body like '%v_writer = ''edit_event_with_tasks''%'
    and v_body like '%v_writer = ''edit_active_event_task''%';
  v_results := v_results || format(E'\nOWNER_GUARD_SIX_BASE_COLUMNS_PLUS_TWO_EXACT_MARKERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(p.proname order by p.proname) into v_names
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prorettype <> 'pg_catalog.trigger'::regtype
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and (p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
      or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M');
  v_ok := v_names = array['accept_task_volunteer','assign_task_people','claim_task','delete_task','edit_active_event_task','edit_event_with_tasks','move_task','set_task_backup_request','set_task_dependency','unassign_self']::text[];
  v_results := v_results || format(E'\nOWNER_BRANCH_EXACT_TEN_WRITERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(p.proname order by p.proname) into v_names
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and (p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
      or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M');
  v_ok := v_names = array['accept_task_volunteer','assign_task_people','claim_task','delete_task','edit_active_event_task','edit_event_with_tasks','guard_event_updates','move_task','prepare_unassigned_task_reset','set_task_backup_request','set_task_confidentiality','set_task_dependency','unassign_self']::text[];
  v_results := v_results || format(E'\nFULL_EXACT_THIRTEEN_WRITERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef('public.guard_task_volunteer_writes()'::regprocedure)) into v_body;
  v_ok := strpos(v_body,'for no key update') > 0
    and strpos(v_body,'for share') > strpos(v_body,'for no key update')
    and v_body like '%ccb08%'
    and v_body like '%ccb09%';
  v_results := v_results || format(E'\nCHILD_GUARD_TASK_THEN_EVENT_AND_ARCHIVE_IMMUTABILITY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  foreach v_function in array array[
    'public.claim_task(uuid)'::regprocedure,
    'public.set_task_backup_request(uuid,boolean)'::regprocedure,
    'public.volunteer_for_task(uuid)'::regprocedure,
    'public.withdraw_task_volunteer(uuid)'::regprocedure,
    'public.accept_task_volunteer(uuid,uuid)'::regprocedure
  ] loop
    select lower(pg_catalog.pg_get_functiondef(v_function)) into v_body;
    v_task_pos := case
      when strpos(v_body,'for update') = 0 then strpos(v_body,'for no key update')
      when strpos(v_body,'for no key update') = 0 then strpos(v_body,'for update')
      else least(strpos(v_body,'for update'),strpos(v_body,'for no key update'))
    end;
    v_event_pos := strpos(v_body,'for share');
    v_ok := v_task_pos > 0 and v_event_pos > v_task_pos
      and strpos(v_body,'pg_advisory_xact_lock') = 0;
    v_results := v_results || format(E'\nMUTATOR_TASK_EVENT_NO_ADVISORY_%s: %s', v_function::text, case when v_ok then 'PASS' else 'FAIL' end);
  end loop;

  select pg_catalog.pg_get_function_result('public.list_help_wanted_tasks(integer,integer)'::regprocedure)
    = 'TABLE(out_id uuid, out_title text, out_event_id uuid, out_event_name text, out_phase text, out_status text, out_effective_priority text, out_due_date timestamp with time zone, out_committee_id uuid, out_committee_name text, out_has_volunteered boolean, out_can_volunteer boolean)'
  into v_ok;
  v_results := v_results || format(E'\nHELP_WANTED_FIXED_SHAPE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef('public.accept_task_volunteer(uuid,uuid)'::regprocedure)) into v_body;
  v_ok := v_body like '%cardinality(v_primary_assignees)%'
    and v_body like '%cardinality(v_assist_assignees) >= 100%'
    and v_body like '%errcode = ''ccb10''%';
  v_results := v_results || format(E'\nACCEPT_COMBINED_ASSIGNEE_CAP_100_CCB10_PINNED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — claims, confidentiality, dependencies, loser, and activity

```sql
begin;

insert into public.committees (id,name) values
  ('80020000-0000-4000-8000-000000000001','S8 One'),
  ('80020000-0000-4000-8000-000000000002','S8 Two');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('80020000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8-admin@test.local','',now(),'{}','{}',now(),now()),
  ('80020000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000000','authenticated','authenticated','s8-member@test.local','',now(),'{}','{}',now(),now()),
  ('80020000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000000','authenticated','authenticated','s8-other@test.local','',now(),'{}','{}',now(),now()),
  ('80020000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000000','authenticated','authenticated','s8-assist@test.local','',now(),'{}','{}',now(),now());
insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('80020000-0000-4000-8000-000000000011','s8-admin@test.local','S8 Admin','Admin',null,true),
  ('80020000-0000-4000-8000-000000000012','s8-member@test.local','S8 Member','Member','80020000-0000-4000-8000-000000000001',true),
  ('80020000-0000-4000-8000-000000000013','s8-other@test.local','S8 Other','Member','80020000-0000-4000-8000-000000000002',true),
  ('80020000-0000-4000-8000-000000000014','s8-assist@test.local','S8 Assist','Member','80020000-0000-4000-8000-000000000001',true);
insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('80020000-0000-4000-8000-000000000101','S8 Active','2026-10-01','2026-11-30','Active','80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000102','S8 Draft','2026-10-01','2026-11-30','Draft','80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000103','S8 Archived','2026-10-01','2026-11-30','Active','80020000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,phase,status,primary_assignees,assist_assignees,is_confidential,allowed_viewers,depends_on_task_id,created_by) values
  ('80020000-0000-4000-8000-000000000201','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Public claim','P','To Do','{}','{}',false,'{}',null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000202','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Prerequisite','P','To Do',array['80020000-0000-4000-8000-000000000011']::uuid[],'{}',false,'{}',null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000203','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Blocked claim','P','To Do','{}','{}',false,'{}','80020000-0000-4000-8000-000000000202','80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000204','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Confidential','P','To Do','{}','{}',true,array['80020000-0000-4000-8000-000000000012']::uuid[],null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000205','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Completed','P','Completed','{}','{}',false,'{}',null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000206','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Assist only','P','To Do','{}',array['80020000-0000-4000-8000-000000000014']::uuid[],false,'{}',null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000207','80020000-0000-4000-8000-000000000102','80020000-0000-4000-8000-000000000001','Draft secret','P','To Do','{}','{}',true,'{}',null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000208','80020000-0000-4000-8000-000000000103','80020000-0000-4000-8000-000000000001','Archived secret','P','To Do','{}','{}',true,'{}',null,'80020000-0000-4000-8000-000000000011'),
  ('80020000-0000-4000-8000-000000000209','80020000-0000-4000-8000-000000000101','80020000-0000-4000-8000-000000000001','Completed secret','P','Completed','{}','{}',true,'{}',null,'80020000-0000-4000-8000-000000000011');
update public.events set status='Archived' where id='80020000-0000-4000-8000-000000000103';
update public.tasks set sort_order=777 where id='80020000-0000-4000-8000-000000000201';

set local role authenticated;
do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_before bigint;
  v_after bigint;
begin
  perform set_config('request.jwt.claims','{"sub":"80020000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  select count(*) into v_before from public.activity_log where task_id='80020000-0000-4000-8000-000000000201' and action='UPDATE';
  perform public.claim_task('80020000-0000-4000-8000-000000000201');
  select primary_assignees=array['80020000-0000-4000-8000-000000000012']::uuid[] into v_ok from public.tasks where id='80020000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nACTIVE_CROSS_COMMITTEE_MEMBER_CLAIM: %s',case when v_ok then 'PASS' else 'FAIL' end);
  select status='To Do' and sort_order=777 into v_ok from public.tasks where id='80020000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nCLAIM_CHANGES_NO_STATUS_OR_RANK: %s',case when v_ok then 'PASS' else 'FAIL' end);
  select count(*) into v_after from public.activity_log where task_id='80020000-0000-4000-8000-000000000201' and action='UPDATE' and user_id='80020000-0000-4000-8000-000000000012';
  v_results := v_results || format(E'\nCLAIM_ONE_ATTRIBUTED_ACTIVITY: %s',case when v_after=v_before+1 then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB03' then v_denied:=true; end;
  v_results := v_results || format(E'\nSEQUENTIAL_LOSER_CCB03: %s',case when v_denied then 'PASS' else 'FAIL' end);
  perform public.claim_task('80020000-0000-4000-8000-000000000203');
  select '80020000-0000-4000-8000-000000000012'::uuid=any(primary_assignees) into v_ok from public.tasks where id='80020000-0000-4000-8000-000000000203';
  v_results := v_results || format(E'\nUNMET_DEPENDENCY_DOES_NOT_BLOCK_CLAIM: %s',case when v_ok then 'PASS' else 'FAIL' end);
  select count(*)=2 into v_ok from public.tasks where '80020000-0000-4000-8000-000000000012'::uuid=any(primary_assignees);
  v_results := v_results || format(E'\nUNLIMITED_SECOND_CLAIM: %s',case when v_ok then 'PASS' else 'FAIL' end);
  perform public.claim_task('80020000-0000-4000-8000-000000000204');
  v_results := v_results || E'\nCONFIDENTIAL_ALLOWED_VIEWER_CLAIM: PASS';

  perform set_config('request.jwt.claims','{"sub":"80020000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000204'); exception when insufficient_privilege then v_denied:=true; end;
  v_results := v_results || format(E'\nMASKED_CONFIDENTIAL_CANNOT_CLAIM: %s',case when v_denied then 'PASS' else 'FAIL' end);
  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000205'); exception when sqlstate 'CCB03' then v_denied:=true; end;
  v_results := v_results || format(E'\nCOMPLETED_UNASSIGNED_CCB03: %s',case when v_denied then 'PASS' else 'FAIL' end);
  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000207'); exception when insufficient_privilege then v_denied:=true; end;
  begin perform public.claim_task('80020000-0000-4000-8000-000000000208'); v_denied:=false; exception when insufficient_privilege then null; end;
  begin perform public.claim_task('80020000-0000-4000-8000-000000000209'); v_denied:=false; exception when insufficient_privilege then null; end;
  v_results := v_results || format(E'\nMASKED_DRAFT_ARCHIVED_COMPLETED_CLAIM_ALWAYS_42501: %s',case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"80020000-0000-4000-8000-000000000014","role":"authenticated"}',true);
  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000206'); exception when sqlstate 'CCB04' then v_denied:=true; end;
  v_results := v_results || format(E'\nEXISTING_ASSIST_CCB04: %s',case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"80020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000207'); exception when sqlstate 'CCB02' then v_denied:=true; end;
  v_results := v_results || format(E'\nDRAFT_CLAIM_CCB02: %s',case when v_denied then 'PASS' else 'FAIL' end);
  v_denied:=false; begin perform public.claim_task('80020000-0000-4000-8000-000000000208'); exception when sqlstate 'CCB02' then v_denied:=true; end;
  v_results := v_results || format(E'\nARCHIVED_CLAIM_CCB02: %s',case when v_denied then 'PASS' else 'FAIL' end);
  select strpos(lower(pg_catalog.pg_get_functiondef('public.claim_task(uuid)'::regprocedure)),'for update') > 0
    and strpos(lower(pg_catalog.pg_get_functiondef('public.claim_task(uuid)'::regprocedure)),'for share')
      > strpos(lower(pg_catalog.pg_get_functiondef('public.claim_task(uuid)'::regprocedure)),'for update')
  into v_ok;
  v_results := v_results || format(E'\nFUNCTION_BODY_LOCK_SERIALIZES_CLAIM_RACE: %s',case when v_ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %',v_results;
end
$$;
```

## TEST 3 — request/cancel role matrix, cleanup, and activity

```sql
begin;
insert into public.committees(id,name) values
 ('80030000-0000-4000-8000-000000000001','S8B One'),
 ('80030000-0000-4000-8000-000000000002','S8B Two');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('80030000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8b-admin@test.local','',now(),'{}','{}',now(),now()),
 ('80030000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8b-co1@test.local','',now(),'{}','{}',now(),now()),
 ('80030000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8b-co2@test.local','',now(),'{}','{}',now(),now()),
 ('80030000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8b-primary@test.local','',now(),'{}','{}',now(),now()),
 ('80030000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8b-member@test.local','',now(),'{}','{}',now(),now());
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('80030000-0000-4000-8000-000000000011','s8b-admin@test.local','S8B Admin','Admin',null,true),
 ('80030000-0000-4000-8000-000000000012','s8b-co1@test.local','S8B Co1','Co-Admin','80030000-0000-4000-8000-000000000001',true),
 ('80030000-0000-4000-8000-000000000013','s8b-co2@test.local','S8B Co2','Co-Admin','80030000-0000-4000-8000-000000000002',true),
 ('80030000-0000-4000-8000-000000000014','s8b-primary@test.local','S8B Primary','Member','80030000-0000-4000-8000-000000000001',true),
 ('80030000-0000-4000-8000-000000000015','s8b-member@test.local','S8B Member','Member','80030000-0000-4000-8000-000000000002',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('80030000-0000-4000-8000-000000000101','S8B Active','2026-10-01','2026-11-30','Active','80030000-0000-4000-8000-000000000011'),
 ('80030000-0000-4000-8000-000000000102','S8B Draft','2026-10-01','2026-11-30','Draft','80030000-0000-4000-8000-000000000011'),
 ('80030000-0000-4000-8000-000000000103','S8B Archive','2026-10-01','2026-11-30','Active','80030000-0000-4000-8000-000000000011');
insert into public.tasks(id,event_id,committee_id,title,status,primary_assignees,assist_assignees,is_confidential,created_by) values
 ('80030000-0000-4000-8000-000000000201','80030000-0000-4000-8000-000000000101','80030000-0000-4000-8000-000000000001','Public','To Do',array['80030000-0000-4000-8000-000000000014']::uuid[],'{}',false,'80030000-0000-4000-8000-000000000011'),
 ('80030000-0000-4000-8000-000000000202','80030000-0000-4000-8000-000000000101','80030000-0000-4000-8000-000000000001','Secret','To Do',array['80030000-0000-4000-8000-000000000014']::uuid[],'{}',true,'80030000-0000-4000-8000-000000000011'),
 ('80030000-0000-4000-8000-000000000203','80030000-0000-4000-8000-000000000101','80030000-0000-4000-8000-000000000001','Done secret','Completed',array['80030000-0000-4000-8000-000000000014']::uuid[],'{}',true,'80030000-0000-4000-8000-000000000011'),
 ('80030000-0000-4000-8000-000000000204','80030000-0000-4000-8000-000000000102','80030000-0000-4000-8000-000000000001','Draft secret','To Do',array['80030000-0000-4000-8000-000000000014']::uuid[],'{}',true,'80030000-0000-4000-8000-000000000011'),
 ('80030000-0000-4000-8000-000000000205','80030000-0000-4000-8000-000000000103','80030000-0000-4000-8000-000000000001','Archive secret','To Do',array['80030000-0000-4000-8000-000000000014']::uuid[],'{}',true,'80030000-0000-4000-8000-000000000011');
update public.events set status='Archived' where id='80030000-0000-4000-8000-000000000103';

set local role authenticated;
do $$
declare v_results text:=''; v_ok boolean; v_denied boolean; v_before bigint; v_after bigint;
begin
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_before from public.activity_log where task_id='80030000-0000-4000-8000-000000000201' and action='UPDATE';
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000014","role":"authenticated"}',true);
 perform public.set_task_backup_request('80030000-0000-4000-8000-000000000201',true);
 select request_backup into v_ok from public.tasks where id='80030000-0000-4000-8000-000000000201';
 v_results:=v_results||format(E'\nPRIMARY_REQUEST_ALLOWED: %s',case when v_ok then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_after from public.activity_log where task_id='80030000-0000-4000-8000-000000000201' and action='UPDATE' and user_id='80030000-0000-4000-8000-000000000014';
 v_results:=v_results||format(E'\nREQUEST_ACTIVITY_EXACTLY_ONCE_AND_ATTRIBUTED: %s',case when v_after=v_before+1 then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000015","role":"authenticated"}',true);
 v_denied:=false; begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000201',false); exception when insufficient_privilege then v_denied:=true; end;
 v_results:=v_results||format(E'\nUNASSIGNED_MEMBER_DENIED: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform public.volunteer_for_task('80030000-0000-4000-8000-000000000201');
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_before from public.activity_log where task_id='80030000-0000-4000-8000-000000000201' and action='UPDATE';
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000013","role":"authenticated"}',true);
 perform public.set_task_backup_request('80030000-0000-4000-8000-000000000201',false);
 v_results:=v_results||E'\nANY_COADMIN_WITH_REAL_ACCESS_CAN_CANCEL: PASS';
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_after from public.activity_log where task_id='80030000-0000-4000-8000-000000000201' and action='UPDATE';
 select v_after=v_before+1 and exists(select 1 from public.activity_log where task_id='80030000-0000-4000-8000-000000000201' and action='UPDATE' and user_id='80030000-0000-4000-8000-000000000013') into v_ok;
 v_results:=v_results||format(E'\nCANCEL_ACTIVITY_EXACTLY_ONCE_AND_ATTRIBUTED: %s',case when v_ok then 'PASS' else 'FAIL' end);
 perform public.set_task_backup_request('80030000-0000-4000-8000-000000000201',true);
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000015","role":"authenticated"}',true);
 v_ok:=true; begin perform public.volunteer_for_task('80030000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB06' then v_ok:=false; end;
 v_results:=v_results||format(E'\nCANCEL_SWEEPS_ALL_OFFERS: %s',case when v_ok then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000013","role":"authenticated"}',true);
 perform public.set_task_backup_request('80030000-0000-4000-8000-000000000201',false);
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000013","role":"authenticated"}',true);
 v_denied:=false; begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000202',true); exception when insufficient_privilege then v_denied:=true; end;
 v_results:=v_results||format(E'\nMASKED_COADMIN_DENIED: %s',case when v_denied then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000203',true); exception when insufficient_privilege then v_denied:=true; end;
 begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000204',true); v_denied:=false; exception when insufficient_privilege then null; end;
 begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000205',true); v_denied:=false; exception when insufficient_privilege then null; end;
 v_results:=v_results||format(E'\nMASKED_COMPLETED_DRAFT_ARCHIVED_BACKUP_ALWAYS_42501: %s',case when v_denied then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000201',false); exception when sqlstate 'CCB05' then v_denied:=true; end;
 v_results:=v_results||format(E'\nNOOP_BACKUP_STATE_CCB05: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 v_denied:=false; begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000203',true); exception when sqlstate 'CCB05' then v_denied:=true; end;
 v_results:=v_results||format(E'\nCOMPLETED_BACKUP_CCB05: %s',case when v_denied then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000204',true); exception when sqlstate 'CCB02' then v_denied:=true; end;
 begin perform public.set_task_backup_request('80030000-0000-4000-8000-000000000205',true); v_denied:=false; exception when sqlstate 'CCB02' then null; end;
 v_results:=v_results||format(E'\nDRAFT_AND_ARCHIVED_BACKUP_CCB02: %s',case when v_denied then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',v_results;
end $$;
```

## TEST 4 — volunteer, withdraw, accept, and stale-offer cleanup

```sql
begin;
insert into public.committees(id,name) values
 ('80040000-0000-4000-8000-000000000001','S8V One'),
 ('80040000-0000-4000-8000-000000000002','S8V Two');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('80040000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-admin@test.local','',now(),'{}','{}',now(),now()),
 ('80040000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-co@test.local','',now(),'{}','{}',now(),now()),
 ('80040000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-primary@test.local','',now(),'{}','{}',now(),now()),
 ('80040000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-assist@test.local','',now(),'{}','{}',now(),now()),
 ('80040000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-vol1@test.local','',now(),'{}','{}',now(),now()),
 ('80040000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-vol2@test.local','',now(),'{}','{}',now(),now()),
 ('80040000-0000-4000-8000-000000000017','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8v-inactive@test.local','',now(),'{}','{}',now(),now());
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('80040000-0000-4000-8000-000000000011','s8v-admin@test.local','S8V Admin','Admin',null,true),
 ('80040000-0000-4000-8000-000000000012','s8v-co@test.local','S8V Co','Co-Admin','80040000-0000-4000-8000-000000000002',true),
 ('80040000-0000-4000-8000-000000000013','s8v-primary@test.local','S8V Primary','Member','80040000-0000-4000-8000-000000000001',true),
 ('80040000-0000-4000-8000-000000000014','s8v-assist@test.local','S8V Assist','Member','80040000-0000-4000-8000-000000000001',true),
 ('80040000-0000-4000-8000-000000000015','s8v-vol1@test.local','S8V Vol1','Member','80040000-0000-4000-8000-000000000002',true),
 ('80040000-0000-4000-8000-000000000016','s8v-vol2@test.local','S8V Vol2','Member','80040000-0000-4000-8000-000000000002',true),
 ('80040000-0000-4000-8000-000000000017','s8v-inactive@test.local','S8V Inactive','Member','80040000-0000-4000-8000-000000000002',false);
insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('80040000-0000-4000-8000-000000000101','S8V Active','2026-10-01','2026-11-30','Active','80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000102','S8V Draft','2026-10-01','2026-11-30','Draft','80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000103','S8V Archive','2026-10-01','2026-11-30','Active','80040000-0000-4000-8000-000000000011');
insert into public.tasks(id,event_id,committee_id,title,status,primary_assignees,assist_assignees,is_confidential,allowed_viewers,request_backup,created_by) values
 ('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000101','80040000-0000-4000-8000-000000000001','Public help','To Do',array['80040000-0000-4000-8000-000000000013']::uuid[],array['80040000-0000-4000-8000-000000000014']::uuid[],false,'{}',true,'80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000202','80040000-0000-4000-8000-000000000101','80040000-0000-4000-8000-000000000001','Secret help','To Do',array['80040000-0000-4000-8000-000000000013']::uuid[],'{}',true,'{}',true,'80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000203','80040000-0000-4000-8000-000000000102','80040000-0000-4000-8000-000000000001','Draft secret','To Do',array['80040000-0000-4000-8000-000000000013']::uuid[],'{}',true,'{}',true,'80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000204','80040000-0000-4000-8000-000000000103','80040000-0000-4000-8000-000000000001','Archived secret','To Do',array['80040000-0000-4000-8000-000000000013']::uuid[],'{}',true,'{}',true,'80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000205','80040000-0000-4000-8000-000000000101','80040000-0000-4000-8000-000000000001','Completed secret','Completed',array['80040000-0000-4000-8000-000000000013']::uuid[],'{}',true,'{}',true,'80040000-0000-4000-8000-000000000011'),
 ('80040000-0000-4000-8000-000000000206','80040000-0000-4000-8000-000000000101','80040000-0000-4000-8000-000000000001','Full task','To Do',array(select ('90000000-0000-4000-8000-'||lpad(generated.series_value::text,12,'0'))::uuid from generate_series(1,100) as generated(series_value)),'{}',false,'{}',true,'80040000-0000-4000-8000-000000000011');
insert into public.task_volunteers(task_id,user_id) values
 ('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000017'),
 ('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000014'),
 ('80040000-0000-4000-8000-000000000206','80040000-0000-4000-8000-000000000016');
update public.events set status='Archived' where id='80040000-0000-4000-8000-000000000103';

set local role authenticated;
do $$
declare v_results text:=''; v_ok boolean; v_denied boolean; v_before bigint; v_after bigint; v_outcome text; v_volunteers jsonb;
begin
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000015","role":"authenticated"}',true);
 perform public.volunteer_for_task('80040000-0000-4000-8000-000000000201');
 select out_has_volunteered into v_ok from public.get_task_backup_state('80040000-0000-4000-8000-000000000201');
 v_results:=v_results||format(E'\nACTIVE_REAL_VIEWER_VOLUNTEERS: %s',case when v_ok then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB06' then v_denied:=true; end;
 v_results:=v_results||format(E'\nDUPLICATE_OFFER_CCB06: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000013","role":"authenticated"}',true);
 v_denied:=false; begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB07' then v_denied:=true; end;
 v_results:=v_results||format(E'\nPRIMARY_CANNOT_VOLUNTEER_CCB07: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000014","role":"authenticated"}',true);
 v_denied:=false; begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB07' then v_denied:=true; end;
 v_results:=v_results||format(E'\nASSIST_CANNOT_VOLUNTEER_CCB07: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000015","role":"authenticated"}',true);
 v_denied:=false; begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000202'); exception when insufficient_privilege then v_denied:=true; end;
 v_results:=v_results||format(E'\nMASKED_CONFIDENTIAL_CANNOT_VOLUNTEER: %s',case when v_denied then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000203'); exception when insufficient_privilege then v_denied:=true; end;
 begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000204'); v_denied:=false; exception when insufficient_privilege then null; end;
 begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000205'); v_denied:=false; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000012","role":"authenticated"}',true);
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000203','80040000-0000-4000-8000-000000000015'); v_denied:=false; exception when insufficient_privilege then null; end;
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000204','80040000-0000-4000-8000-000000000015'); v_denied:=false; exception when insufficient_privilege then null; end;
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000205','80040000-0000-4000-8000-000000000015'); v_denied:=false; exception when insufficient_privilege then null; end;
 v_results:=v_results||format(E'\nMASKED_VOLUNTEER_AND_ACCEPT_HIDE_DRAFT_ARCHIVED_COMPLETED: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 v_denied:=false; begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000203'); exception when sqlstate 'CCB02' then v_denied:=true; end;
 begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000204'); v_denied:=false; exception when sqlstate 'CCB02' then null; end;
 begin perform public.volunteer_for_task('80040000-0000-4000-8000-000000000205'); v_denied:=false; exception when sqlstate 'CCB05' then null; end;
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000203','80040000-0000-4000-8000-000000000015'); v_denied:=false; exception when sqlstate 'CCB02' then null; end;
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000204','80040000-0000-4000-8000-000000000015'); v_denied:=false; exception when sqlstate 'CCB02' then null; end;
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000205','80040000-0000-4000-8000-000000000015'); v_denied:=false; exception when sqlstate 'CCB05' then null; end;
 v_results:=v_results||format(E'\nREAL_VOLUNTEER_AND_ACCEPT_KEEP_CCB02_AND_CCB05: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000015","role":"authenticated"}',true);
 perform public.withdraw_task_volunteer('80040000-0000-4000-8000-000000000201');
 select not out_has_volunteered into v_ok from public.get_task_backup_state('80040000-0000-4000-8000-000000000201');
 v_results:=v_results||format(E'\nVOLUNTEER_WITHDRAWS_ONLY_SELF: %s',case when v_ok then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.withdraw_task_volunteer('80040000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB06' then v_denied:=true; end;
 v_results:=v_results||format(E'\nMISSING_WITHDRAW_CCB06: %s',case when v_denied then 'PASS' else 'FAIL' end);
 perform public.volunteer_for_task('80040000-0000-4000-8000-000000000201');
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_before from public.activity_log where task_id='80040000-0000-4000-8000-000000000201' and action='UPDATE';
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000013","role":"authenticated"}',true);
 select out_outcome into v_outcome from public.accept_task_volunteer('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000015');
 v_results:=v_results||format(E'\nPRIMARY_ACCEPTS_ACTIVE_VOLUNTEER: %s',case when v_outcome='accepted' then 'PASS' else 'FAIL' end);
 select cardinality(array_positions(assist_assignees,'80040000-0000-4000-8000-000000000015'::uuid))=1 into v_ok from public.tasks where id='80040000-0000-4000-8000-000000000201';
 v_results:=v_results||format(E'\nACCEPT_ADDS_ASSIST_EXACTLY_ONCE: %s',case when v_ok then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_after from public.activity_log where task_id='80040000-0000-4000-8000-000000000201' and action='UPDATE' and user_id='80040000-0000-4000-8000-000000000013';
 v_results:=v_results||format(E'\nACCEPT_ACTIVITY_EXACTLY_ONCE_AND_ACCEPTOR_ATTRIBUTED: %s',case when v_after=v_before+1 then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000017'); exception when sqlstate 'CCB06' then v_denied:=true; end;
 begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000014'); v_denied:=false; exception when sqlstate 'CCB06' then null; end;
 v_results:=v_results||format(E'\nACCEPT_SWEEPS_ALL_INACTIVE_AND_ASSIGNED_OFFERS: %s',case when v_denied then 'PASS' else 'FAIL' end);
 select out_request_backup into v_ok from public.get_task_backup_state('80040000-0000-4000-8000-000000000201');
 v_denied:=false; begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000015'); exception when sqlstate 'CCB06' then v_denied:=true; end;
 v_results:=v_results||format(E'\nACCEPT_REMOVES_SELECTED_OFFER_AND_LEAVES_REQUEST_OPEN: %s',case when v_ok and v_denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000016","role":"authenticated"}',true);
 perform public.volunteer_for_task('80040000-0000-4000-8000-000000000201');
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_before from public.activity_log where task_id='80040000-0000-4000-8000-000000000201' and action='UPDATE';
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000012","role":"authenticated"}',true);
 select out_outcome into v_outcome from public.accept_task_volunteer('80040000-0000-4000-8000-000000000201','80040000-0000-4000-8000-000000000016');
 perform set_config('request.jwt.claims','{"sub":"80040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select count(*) into v_after from public.activity_log where task_id='80040000-0000-4000-8000-000000000201' and action='UPDATE';
 select v_outcome='accepted' and v_after=v_before+1 and exists(select 1 from public.activity_log where task_id='80040000-0000-4000-8000-000000000201' and action='UPDATE' and user_id='80040000-0000-4000-8000-000000000012') into v_ok;
 v_results:=v_results||format(E'\nCOADMIN_ACCEPTS_WITH_EXACTLY_ONE_ATTRIBUTED_ACTIVITY: %s',case when v_ok then 'PASS' else 'FAIL' end);
 select count(*) into v_before from public.activity_log where task_id='80040000-0000-4000-8000-000000000206' and action='UPDATE';
 v_denied:=false; begin perform public.accept_task_volunteer('80040000-0000-4000-8000-000000000206','80040000-0000-4000-8000-000000000016'); exception when sqlstate 'CCB10' then v_denied:=true; end;
 select cardinality(primary_assignees)+cardinality(assist_assignees)=100 into v_ok from public.tasks where id='80040000-0000-4000-8000-000000000206';
 select count(*) into v_after from public.activity_log where task_id='80040000-0000-4000-8000-000000000206' and action='UPDATE';
 select out_volunteers into v_volunteers from public.get_task_backup_state('80040000-0000-4000-8000-000000000206');
 v_results:=v_results||format(E'\nACCEPT_CAP_100_CCB10_PRESERVES_OFFER_AND_WRITES_NO_ACTIVITY: %s',case when v_denied and v_ok and v_after=v_before and v_volunteers @> '[{"id":"80040000-0000-4000-8000-000000000016"}]'::jsonb then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',v_results;
end $$;
```

## TEST 5 — readers, workload, RLS, immutability, and archive freeze

```sql
begin;
insert into public.committees(id,name) values ('80050000-0000-4000-8000-000000000001','S8R');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('80050000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8r-admin@test.local','',now(),'{}','{}',now(),now()),
 ('80050000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8r-member@test.local','',now(),'{}','{}',now(),now()),
 ('80050000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8r-viewer@test.local','',now(),'{}','{}',now(),now()),
 ('80050000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8r-inactive@test.local','',now(),'{}','{}',now(),now()),
 ('80050000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s8r-valid@test.local','',now(),'{}','{}',now(),now());
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('80050000-0000-4000-8000-000000000011','s8r-admin@test.local','S8R Admin','Admin',null,true),
 ('80050000-0000-4000-8000-000000000012','s8r-member@test.local','S8R Member','Member','80050000-0000-4000-8000-000000000001',true),
 ('80050000-0000-4000-8000-000000000013','s8r-viewer@test.local','S8R Viewer','Member','80050000-0000-4000-8000-000000000001',true),
 ('80050000-0000-4000-8000-000000000014','s8r-inactive@test.local','S8R Inactive','Member','80050000-0000-4000-8000-000000000001',false),
 ('80050000-0000-4000-8000-000000000015','s8r-valid@test.local','S8R Valid','Member','80050000-0000-4000-8000-000000000001',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('80050000-0000-4000-8000-000000000101','S8R Active','2026-10-01','2026-11-30','Active','80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000102','S8R Draft','2026-10-01','2026-11-30','Draft','80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000103','S8R Archive','2026-10-01','2026-11-30','Active','80050000-0000-4000-8000-000000000011');
insert into public.tasks(id,event_id,committee_id,title,status,primary_assignees,assist_assignees,is_confidential,allowed_viewers,request_backup,created_by) values
 ('80050000-0000-4000-8000-000000000201','80050000-0000-4000-8000-000000000101','80050000-0000-4000-8000-000000000001','Public help','To Do',array['80050000-0000-4000-8000-000000000012']::uuid[],'{}',false,'{}',true,'80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000202','80050000-0000-4000-8000-000000000101','80050000-0000-4000-8000-000000000001','Secret help','To Do',array['80050000-0000-4000-8000-000000000012']::uuid[],'{}',true,array['80050000-0000-4000-8000-000000000013']::uuid[],true,'80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000203','80050000-0000-4000-8000-000000000101','80050000-0000-4000-8000-000000000001','Done help','Completed',array['80050000-0000-4000-8000-000000000012']::uuid[],'{}',false,'{}',true,'80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000204','80050000-0000-4000-8000-000000000102','80050000-0000-4000-8000-000000000001','Draft help','To Do',array['80050000-0000-4000-8000-000000000012']::uuid[],'{}',false,'{}',true,'80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000205','80050000-0000-4000-8000-000000000103','80050000-0000-4000-8000-000000000001','Archive help','To Do',array['80050000-0000-4000-8000-000000000012']::uuid[],'{}',false,'{}',true,'80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000206','80050000-0000-4000-8000-000000000101','80050000-0000-4000-8000-000000000001','No request','To Do','{}','{}',false,'{}',false,'80050000-0000-4000-8000-000000000011'),
 ('80050000-0000-4000-8000-000000000207','80050000-0000-4000-8000-000000000101','80050000-0000-4000-8000-000000000001','Distinct workload','In Progress',array['80050000-0000-4000-8000-000000000012']::uuid[],array['80050000-0000-4000-8000-000000000012']::uuid[],false,'{}',false,'80050000-0000-4000-8000-000000000011');
insert into public.task_volunteers(task_id,user_id) values
 ('80050000-0000-4000-8000-000000000201','80050000-0000-4000-8000-000000000014'),
 ('80050000-0000-4000-8000-000000000201','80050000-0000-4000-8000-000000000012'),
 ('80050000-0000-4000-8000-000000000201','80050000-0000-4000-8000-000000000015'),
 ('80050000-0000-4000-8000-000000000206','80050000-0000-4000-8000-000000000015'),
 ('80050000-0000-4000-8000-000000000205','80050000-0000-4000-8000-000000000015');
update public.events set status='Archived' where id='80050000-0000-4000-8000-000000000103';

do $$
declare v_denied boolean;
begin
 v_denied:=false; begin update public.task_volunteers set created_at=clock_timestamp() where task_id='80050000-0000-4000-8000-000000000201' and user_id='80050000-0000-4000-8000-000000000015'; exception when sqlstate 'CCB09' then v_denied:=true; end;
 perform set_config('s8.test.immutable',v_denied::text,true);
 v_denied:=false; begin delete from public.task_volunteers where task_id='80050000-0000-4000-8000-000000000205' and user_id='80050000-0000-4000-8000-000000000015'; exception when sqlstate 'CCB08' then v_denied:=true; end;
 begin insert into public.task_volunteers(task_id,user_id) values('80050000-0000-4000-8000-000000000205','80050000-0000-4000-8000-000000000013'); v_denied:=false; exception when sqlstate 'CCB08' then null; end;
 perform set_config('s8.test.archive',v_denied::text,true);
end $$;

set local role authenticated;
do $$
declare v_results text:=''; v_ok boolean; v_denied boolean; v_count bigint; v_volunteers jsonb;
begin
 perform set_config('request.jwt.claims','{"sub":"80050000-0000-4000-8000-000000000015","role":"authenticated"}',true);
 select count(*)=1 into v_ok from public.list_help_wanted_tasks(50,0);
 v_results:=v_results||format(E'\nHELP_WANTED_ACTIVE_INCOMPLETE_ONLY: %s',case when v_ok then 'PASS' else 'FAIL' end);
 select count(*)=0 into v_ok from public.list_help_wanted_tasks(50,0) where out_id='80050000-0000-4000-8000-000000000202';
 v_results:=v_results||format(E'\nCONFIDENTIAL_HELP_HIDDEN_FROM_MASKED_CALLER: %s',case when v_ok then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80050000-0000-4000-8000-000000000013","role":"authenticated"}',true);
 select count(*)=1 into v_ok from public.list_help_wanted_tasks(50,0) where out_id='80050000-0000-4000-8000-000000000202' and out_title='Secret help';
 v_results:=v_results||format(E'\nCONFIDENTIAL_HELP_REAL_FOR_EXISTING_REAL_VIEWER: %s',case when v_ok then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80050000-0000-4000-8000-000000000011","role":"authenticated"}',true);
 select out_volunteers into v_volunteers from public.get_task_backup_state('80050000-0000-4000-8000-000000000201');
 v_results:=v_results||format(E'\nBACKUP_STATE_HIDES_INACTIVE_AND_ASSIGNED_OFFERS: %s',case when jsonb_array_length(v_volunteers)=1 and v_volunteers->0->>'id'='80050000-0000-4000-8000-000000000015' then 'PASS' else 'FAIL' end);
 select out_request_backup=false and jsonb_array_length(out_volunteers)=0 into v_ok from public.get_task_backup_state('80050000-0000-4000-8000-000000000206');
 v_results:=v_results||format(E'\nOFFERS_SURFACE_ONLY_WHILE_REQUEST_BACKUP_TRUE: %s',case when v_ok then 'PASS' else 'FAIL' end);
 select out_active_task_count into v_count from public.list_active_task_assignees_with_workload() where out_id='80050000-0000-4000-8000-000000000012';
 v_results:=v_results||format(E'\nWORKLOAD_ACTIVE_NONCOMPLETED_DISTINCT_ONLY: %s',case when v_count=3 then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"80050000-0000-4000-8000-000000000012","role":"authenticated"}',true);
 select count(*)=0 into v_ok from public.list_active_task_assignees_with_workload();
 v_results:=v_results||format(E'\nWORKLOAD_LEADERSHIP_ONLY: %s',case when v_ok then 'PASS' else 'FAIL' end);
 v_denied:=false; begin perform count(*) from public.task_volunteers; exception when insufficient_privilege then v_denied:=true; end;
 v_results:=v_results||format(E'\nDIRECT_AUTHENTICATED_TABLE_ACCESS_DENIED: %s',case when v_denied then 'PASS' else 'FAIL' end);
 v_results:=v_results||format(E'\nTASK_ID_AND_ALL_UPDATES_CCB09: %s',case when current_setting('s8.test.immutable')='true' then 'PASS' else 'FAIL' end);
 v_results:=v_results||format(E'\nARCHIVED_PARENT_INSERT_AND_DELETE_CCB08: %s',case when current_setting('s8.test.archive')='true' then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',v_results;
end $$;
```

## Manual Step 8A checks

There is no Step 8A UI. After applying the migration to Dev, run all five SQL
tests and confirm every named line is `PASS`. Rerun Step 1A activity-log TEST 9,
Step 7 TEST 1/4, and Step 7A TEST 1/2/5. When interpreting those historical
tests, use the supersession notes at the top of the Step 7 and Step 7A test
documents; the current guard/inventory truth is Step 8 TEST 1.
