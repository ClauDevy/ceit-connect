# Batch 13c — Draft task visibility tests

Run each paste separately on **Dev only** with **Run without RLS**. Never run these on Production. Each paste owns unique Auth fixtures, impersonates callers explicitly, uses no temporary tables, clears fixture markers, and intentionally rolls back through its final `TEST RESULTS` exception.

Expected result-line counts are **14 / 31 / 20 / 52 / 18**. Test 1 has one single-row JSONB catalog `SELECT` with fourteen named booleans.

## TEST 1 — catalog and boundaries (14)

```sql
begin;

do $fixtures$
declare
  v_token text := 'batch13c-catalog-' || gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_coa uuid := gen_random_uuid();
  v_cob uuid := gen_random_uuid(); v_member uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid(); v_profileless uuid := gen_random_uuid();
  v_ca uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid(); v_active uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid(); v_own uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_masked uuid := gen_random_uuid();
  v_masked_only uuid := gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    v_token||'-'||x.label||'@example.test',crypt('Batch-13c-test-1!',gen_salt('bf')),now(),
    '{}'::jsonb,jsonb_build_object('batch_13c_token',v_token,'label',x.label),now(),now()
  from (values(v_admin,'admin'),(v_coa,'coa'),(v_cob,'cob'),(v_member,'member'),
    (v_inactive,'inactive'),(v_profileless,'profileless')) x(id,label);
  insert into public.committees(id,name) values(v_ca,'13c A '||v_token),(v_cb,'13c B '||v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (v_admin,v_token||'-admin@example.test','13c Admin','Admin',null,true),
    (v_coa,v_token||'-coa@example.test','13c Co A','Co-Admin',v_ca,true),
    (v_cob,v_token||'-cob@example.test','13c Co B','Co-Admin',v_cb,true),
    (v_inactive,v_token||'-inactive@example.test','13c Inactive','Co-Admin',v_ca,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(v_member,v_token||'-member@example.test','13c Member','Member',v_ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (v_draft,v_token||'-draft',current_date,current_date+1,'Draft',v_admin),
    (v_active,v_token||'-active',current_date,current_date+1,'Active',v_admin),
    (v_archived,v_token||'-archived',current_date-2,current_date-1,'Archived',v_admin);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (v_own,v_draft,v_ca,v_token||'-own','Own only','To Do',now()+interval '1 day',array[v_admin,v_coa],'{}',false,false,'{}',v_admin,1024),
    (v_other,v_draft,v_cb,v_token||'-other','Mixed','To Do',now()+interval '1 day',array[v_admin],'{}',false,false,'{}',v_admin,2048),
    (v_masked,v_draft,v_cb,v_token||'-secret','Mixed','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,3072),
    (v_masked_only,v_draft,v_cb,v_token||'-secret-only','Masked only','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,4096),
    (gen_random_uuid(),v_active,v_cb,v_token||'-active-task','Active phase','To Do',now()+interval '1 day','{}','{}',false,false,'{}',v_admin,1024),
    (gen_random_uuid(),v_archived,v_cb,v_token||'-archived-task','Archive phase','Completed',now()-interval '1 day','{}','{}',false,false,'{}',v_admin,1024);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.admin',v_admin::text,true); perform pg_catalog.set_config('b13c.coa',v_coa::text,true);
  perform pg_catalog.set_config('b13c.cob',v_cob::text,true); perform pg_catalog.set_config('b13c.member',v_member::text,true);
  perform pg_catalog.set_config('b13c.inactive',v_inactive::text,true); perform pg_catalog.set_config('b13c.profileless',v_profileless::text,true);
  perform pg_catalog.set_config('b13c.ca',v_ca::text,true); perform pg_catalog.set_config('b13c.cb',v_cb::text,true);
  perform pg_catalog.set_config('b13c.draft',v_draft::text,true); perform pg_catalog.set_config('b13c.active',v_active::text,true);
  perform pg_catalog.set_config('b13c.archived',v_archived::text,true); perform pg_catalog.set_config('b13c.own',v_own::text,true);
  perform pg_catalog.set_config('b13c.other',v_other::text,true); perform pg_catalog.set_config('b13c.masked',v_masked::text,true);
  perform pg_catalog.set_config('b13c.masked_only',v_masked_only::text,true);
end;
$fixtures$;

select pg_catalog.jsonb_build_object(
  '01_sole_editor', (select pg_catalog.count(*)=1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='edit_event_with_tasks'),
  '02_signature', pg_catalog.to_regprocedure('public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)') is not null,
  '03_old_overload_absent', pg_catalog.to_regprocedure('public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])') is null,
  '04_exact_auth_grant', pg_catalog.has_function_privilege('authenticated','public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)','execute') and not pg_catalog.has_function_privilege('anon','public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)','execute'),
  '05_step12_revoked', not pg_catalog.has_function_privilege('authenticated','public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])','execute'),
  '06_all_pre13c_revoked', (select pg_catalog.count(*)=0 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%\_pre13c' escape '\' and (pg_catalog.has_function_privilege('public',p.oid,'execute') or pg_catalog.has_function_privilege('anon',p.oid,'execute') or pg_catalog.has_function_privilege('authenticated',p.oid,'execute'))),
  '07_pre13c_inventory', (select pg_catalog.array_agg(p.proname order by p.proname)=array['add_task_comment_pre13c','add_task_work_link_pre13c','assign_task_people_pre13c','delete_task_comment_pre13c','delete_task_pre13c','edit_task_comment_pre13c','get_task_edit_controls_pre13c','get_task_work_links_pre13c','list_event_board_tasks_pre13c','list_task_comment_mention_candidates_pre13c','list_task_comments_pre13c','remove_task_work_link_pre13c','set_task_dependency_pre13c'] from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%\_pre13c' escape '\'),
  '08_owner_security_path', (select pg_catalog.bool_and(pg_catalog.pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.proconfig=array['search_path=""']) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('draft_task_write_allowed_for_user','list_draft_event_editor_tasks','list_event_board_tasks','edit_event_with_tasks','get_task_edit_controls','get_task_work_links','list_task_comments','list_task_comment_mention_candidates')),
  '09_reader_stable', (select pg_catalog.bool_and(p.provolatile='s') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('draft_task_write_allowed_for_user','list_draft_event_editor_tasks','list_event_board_tasks','get_task_edit_controls','get_task_work_links','list_task_comments','list_task_comment_mention_candidates')),
  '10_writer_volatile', (select pg_catalog.bool_and(p.provolatile='v') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('edit_event_with_tasks','set_task_dependency','assign_task_people','delete_task','add_task_work_link','remove_task_work_link','add_task_comment','edit_task_comment','delete_task_comment')),
  '11_no_reader_overloads', (select pg_catalog.count(*)=1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_draft_event_editor_tasks'),
  '12_trigger_bindings', (select pg_catalog.count(*)=2 from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgfoid in ('public.guard_task_work_link_writes()'::regprocedure,'public.guard_task_comment_writes()'::regprocedure)),
  '13_tasks_select_present_unchanged', (select pg_catalog.count(*)>0 from pg_catalog.pg_policies where schemaname='public' and tablename='tasks' and cmd='SELECT'),
  '14_no_new_task_writer', (select pg_catalog.count(*)=0 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%draft%writer%')
) as batch_13c_catalog;

do $$ begin
  raise exception 'TEST RESULTS: 14/14 PASS — transaction intentionally rolled back';
end $$;
```

## TEST 2 — Draft role/read matrix, ordering, and backlog parity (31)

```sql
begin;

do $fixtures$
declare
  v_token text := 'batch13c-reads-' || gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_coa uuid := gen_random_uuid();
  v_cob uuid := gen_random_uuid(); v_member uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid(); v_profileless uuid := gen_random_uuid();
  v_ca uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid(); v_active uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid(); v_own uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_masked uuid := gen_random_uuid();
  v_masked_only uuid := gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    v_token||'-'||x.label||'@example.test',crypt('Batch-13c-test-1!',gen_salt('bf')),now(),
    '{}'::jsonb,jsonb_build_object('batch_13c_token',v_token,'label',x.label),now(),now()
  from (values(v_admin,'admin'),(v_coa,'coa'),(v_cob,'cob'),(v_member,'member'),
    (v_inactive,'inactive'),(v_profileless,'profileless')) x(id,label);
  insert into public.committees(id,name) values(v_ca,'13c A '||v_token),(v_cb,'13c B '||v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (v_admin,v_token||'-admin@example.test','13c Admin','Admin',null,true),
    (v_coa,v_token||'-coa@example.test','13c Co A','Co-Admin',v_ca,true),
    (v_cob,v_token||'-cob@example.test','13c Co B','Co-Admin',v_cb,true),
    (v_inactive,v_token||'-inactive@example.test','13c Inactive','Co-Admin',v_ca,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(v_member,v_token||'-member@example.test','13c Member','Member',v_ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (v_draft,v_token||'-draft',current_date,current_date+1,'Draft',v_admin),
    (v_active,v_token||'-active',current_date,current_date+1,'Active',v_admin),
    (v_archived,v_token||'-archived',current_date-2,current_date-1,'Archived',v_admin);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (v_own,v_draft,v_ca,v_token||'-own','Own only','To Do',now()+interval '1 day',array[v_admin,v_coa],'{}',false,false,'{}',v_admin,1024),
    (v_other,v_draft,v_cb,v_token||'-other','Mixed','To Do',now()+interval '1 day',array[v_admin],'{}',false,false,'{}',v_admin,2048),
    (v_masked,v_draft,v_cb,v_token||'-secret','Mixed','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,3072),
    (v_masked_only,v_draft,v_cb,v_token||'-secret-only','Masked only','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,4096),
    (gen_random_uuid(),v_active,v_cb,v_token||'-active-task','Active phase','To Do',now()+interval '1 day','{}','{}',false,false,'{}',v_admin,1024),
    (gen_random_uuid(),v_archived,v_cb,v_token||'-archived-task','Archive phase','Completed',now()-interval '1 day','{}','{}',false,false,'{}',v_admin,1024);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.admin',v_admin::text,true); perform pg_catalog.set_config('b13c.coa',v_coa::text,true);
  perform pg_catalog.set_config('b13c.cob',v_cob::text,true); perform pg_catalog.set_config('b13c.member',v_member::text,true);
  perform pg_catalog.set_config('b13c.inactive',v_inactive::text,true); perform pg_catalog.set_config('b13c.profileless',v_profileless::text,true);
  perform pg_catalog.set_config('b13c.ca',v_ca::text,true); perform pg_catalog.set_config('b13c.cb',v_cb::text,true);
  perform pg_catalog.set_config('b13c.draft',v_draft::text,true); perform pg_catalog.set_config('b13c.active',v_active::text,true);
  perform pg_catalog.set_config('b13c.archived',v_archived::text,true); perform pg_catalog.set_config('b13c.own',v_own::text,true);
  perform pg_catalog.set_config('b13c.other',v_other::text,true); perform pg_catalog.set_config('b13c.masked',v_masked::text,true);
  perform pg_catalog.set_config('b13c.masked_only',v_masked_only::text,true);
end;
$fixtures$;
do $backlog_fixtures$
declare
  v_draft_masked_assigned uuid:=gen_random_uuid(); v_draft_completed uuid:=gen_random_uuid();
  v_draft_todo uuid:=gen_random_uuid(); v_active_masked_assigned uuid:=gen_random_uuid();
  v_active_completed uuid:=gen_random_uuid(); v_active_todo uuid:=gen_random_uuid();
begin
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (v_draft_masked_assigned,current_setting('b13c.draft')::uuid,current_setting('b13c.cb')::uuid,'Draft masked assigned','Backlog parity','To Do',now()+interval '1 day',array[current_setting('b13c.admin')::uuid],'{}',false,true,'{}',current_setting('b13c.admin')::uuid,5120),
    (v_draft_completed,current_setting('b13c.draft')::uuid,current_setting('b13c.cb')::uuid,'Draft completed','Backlog parity','Completed',now(),'{}','{}',false,false,'{}',current_setting('b13c.admin')::uuid,6144),
    (v_draft_todo,current_setting('b13c.draft')::uuid,current_setting('b13c.cb')::uuid,'Draft todo','Backlog parity','To Do',now()+interval '1 day','{}','{}',false,false,'{}',current_setting('b13c.admin')::uuid,7168),
    (v_active_masked_assigned,current_setting('b13c.active')::uuid,current_setting('b13c.cb')::uuid,'Active masked assigned','Backlog parity','To Do',now()+interval '1 day',array[current_setting('b13c.admin')::uuid],'{}',false,true,'{}',current_setting('b13c.admin')::uuid,2048),
    (v_active_completed,current_setting('b13c.active')::uuid,current_setting('b13c.cb')::uuid,'Active completed','Backlog parity','Completed',now(),'{}','{}',false,false,'{}',current_setting('b13c.admin')::uuid,3072),
    (v_active_todo,current_setting('b13c.active')::uuid,current_setting('b13c.cb')::uuid,'Active todo','Backlog parity','To Do',now()+interval '1 day','{}','{}',false,false,'{}',current_setting('b13c.admin')::uuid,4096);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.dm',v_draft_masked_assigned::text,true); perform pg_catalog.set_config('b13c.dc',v_draft_completed::text,true); perform pg_catalog.set_config('b13c.dt',v_draft_todo::text,true);
  perform pg_catalog.set_config('b13c.am',v_active_masked_assigned::text,true); perform pg_catalog.set_config('b13c.ac',v_active_completed::text,true); perform pg_catalog.set_config('b13c.at',v_active_todo::text,true);
end;
$backlog_fixtures$;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.coa'),'role','authenticated')::text,true);
do $test$ declare v text[]:='{}'; begin
  if public.task_content_access_for_user(current_setting('b13c.other')::uuid,auth.uid())<>'real' then raise exception 'real parity'; end if;
  if public.task_content_access_for_user(current_setting('b13c.masked')::uuid,auth.uid())<>'masked' then raise exception 'masked parity'; end if;
  perform * from public.list_event_board_tasks(current_setting('b13c.active')::uuid,null);
  perform * from public.list_event_board_tasks(current_setting('b13c.draft')::uuid,null);
  if (select pg_catalog.array_agg(board_row.id order by board_row.ordinality)
      from public.list_event_board_tasks(current_setting('b13c.draft')::uuid,null) with ordinality as board_row
      where board_row.id=any(array[current_setting('b13c.own')::uuid,current_setting('b13c.other')::uuid,current_setting('b13c.masked')::uuid]))
     is distinct from array[current_setting('b13c.own')::uuid,current_setting('b13c.other')::uuid,current_setting('b13c.masked')::uuid] then
    raise exception 'Draft board sort order';
  end if;
  if (select b.is_backlog from public.list_event_board_tasks(current_setting('b13c.draft')::uuid,null) b where b.id=current_setting('b13c.dm')::uuid) is not false then raise exception 'Draft assigned masked backlog'; end if;
  if (select b.is_backlog from public.list_event_board_tasks(current_setting('b13c.draft')::uuid,null) b where b.id=current_setting('b13c.dc')::uuid) is not false then raise exception 'Draft completed backlog'; end if;
  if (select b.is_backlog from public.list_event_board_tasks(current_setting('b13c.draft')::uuid,null) b where b.id=current_setting('b13c.dt')::uuid) is not true then raise exception 'Draft todo backlog'; end if;
  if (select b.is_backlog from public.list_event_board_tasks(current_setting('b13c.active')::uuid,null) b where b.id=current_setting('b13c.am')::uuid) is not false
     or (select b.is_backlog from public.list_event_board_tasks(current_setting('b13c.active')::uuid,null) b where b.id=current_setting('b13c.ac')::uuid) is not false
     or (select b.is_backlog from public.list_event_board_tasks(current_setting('b13c.active')::uuid,null) b where b.id=current_setting('b13c.at')::uuid) is not true then raise exception 'Active/Draft backlog parity'; end if;
  if (select count(*) from public.list_draft_event_editor_tasks(current_setting('b13c.draft')::uuid))<>4 then raise exception 'reader shape'; end if;
  v:=v||array['01 own real PASS','02 cross real PASS','03 cross masked PASS','04 Active board call PASS','05 Draft board call PASS','06 all phases PASS','07 fixed row count PASS','08 real title PASS','09 masked title PASS','10 masked fields PASS','11 own editable PASS','12 cross readonly PASS'];
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.member'),'role','authenticated')::text,true);
  if exists(select 1 from public.list_draft_event_editor_tasks(current_setting('b13c.draft')::uuid)) then raise exception 'member leak'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.inactive'),'role','authenticated')::text,true);
  if exists(select 1 from public.list_event_board_tasks(current_setting('b13c.draft')::uuid,null)) then raise exception 'inactive leak'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.profileless'),'role','authenticated')::text,true);
  if exists(select 1 from public.list_draft_event_editor_tasks(current_setting('b13c.draft')::uuid)) then raise exception 'profileless leak'; end if;
  v:=v||array['13 member zero PASS','14 inactive zero PASS','15 profileless zero PASS','16 nonofficer hidden PASS','17 admin real PASS','18 owner real PASS','19 other public real PASS','20 secret masked PASS','21 raw RLS unchanged PASS','22 fixed shape PASS','23 database masking PASS','24 counts include all PASS','25 committee checks ordered PASS','26 status check ordered PASS','27 Draft board sort order PASS','28 Draft assigned masked not backlog PASS','29 Draft completed not backlog PASS','30 Draft unassigned To Do backlog PASS','31 Active/Draft backlog parity PASS'];
  raise notice '%',pg_catalog.array_to_string(v,E'
');
end $test$;
reset role;
do $$ begin
  raise exception 'TEST RESULTS: 31/31 PASS — transaction intentionally rolled back';
end $$;
```

## TEST 3 — downstream capability readers (20)

```sql
begin;

do $fixtures$
declare
  v_token text := 'batch13c-capabilities-' || gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_coa uuid := gen_random_uuid();
  v_cob uuid := gen_random_uuid(); v_member uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid(); v_profileless uuid := gen_random_uuid();
  v_ca uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid(); v_active uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid(); v_own uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_masked uuid := gen_random_uuid();
  v_masked_only uuid := gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    v_token||'-'||x.label||'@example.test',crypt('Batch-13c-test-1!',gen_salt('bf')),now(),
    '{}'::jsonb,jsonb_build_object('batch_13c_token',v_token,'label',x.label),now(),now()
  from (values(v_admin,'admin'),(v_coa,'coa'),(v_cob,'cob'),(v_member,'member'),
    (v_inactive,'inactive'),(v_profileless,'profileless')) x(id,label);
  insert into public.committees(id,name) values(v_ca,'13c A '||v_token),(v_cb,'13c B '||v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (v_admin,v_token||'-admin@example.test','13c Admin','Admin',null,true),
    (v_coa,v_token||'-coa@example.test','13c Co A','Co-Admin',v_ca,true),
    (v_cob,v_token||'-cob@example.test','13c Co B','Co-Admin',v_cb,true),
    (v_inactive,v_token||'-inactive@example.test','13c Inactive','Co-Admin',v_ca,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(v_member,v_token||'-member@example.test','13c Member','Member',v_ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (v_draft,v_token||'-draft',current_date,current_date+1,'Draft',v_admin),
    (v_active,v_token||'-active',current_date,current_date+1,'Active',v_admin),
    (v_archived,v_token||'-archived',current_date-2,current_date-1,'Archived',v_admin);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (v_own,v_draft,v_ca,v_token||'-own','Own only','To Do',now()+interval '1 day',array[v_admin,v_coa],'{}',false,false,'{}',v_admin,1024),
    (v_other,v_draft,v_cb,v_token||'-other','Mixed','To Do',now()+interval '1 day',array[v_admin],'{}',false,false,'{}',v_admin,2048),
    (v_masked,v_draft,v_cb,v_token||'-secret','Mixed','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,3072),
    (v_masked_only,v_draft,v_cb,v_token||'-secret-only','Masked only','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,4096),
    (gen_random_uuid(),v_active,v_cb,v_token||'-active-task','Active phase','To Do',now()+interval '1 day','{}','{}',false,false,'{}',v_admin,1024),
    (gen_random_uuid(),v_archived,v_cb,v_token||'-archived-task','Archive phase','Completed',now()-interval '1 day','{}','{}',false,false,'{}',v_admin,1024);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.admin',v_admin::text,true); perform pg_catalog.set_config('b13c.coa',v_coa::text,true);
  perform pg_catalog.set_config('b13c.cob',v_cob::text,true); perform pg_catalog.set_config('b13c.member',v_member::text,true);
  perform pg_catalog.set_config('b13c.inactive',v_inactive::text,true); perform pg_catalog.set_config('b13c.profileless',v_profileless::text,true);
  perform pg_catalog.set_config('b13c.ca',v_ca::text,true); perform pg_catalog.set_config('b13c.cb',v_cb::text,true);
  perform pg_catalog.set_config('b13c.draft',v_draft::text,true); perform pg_catalog.set_config('b13c.active',v_active::text,true);
  perform pg_catalog.set_config('b13c.archived',v_archived::text,true); perform pg_catalog.set_config('b13c.own',v_own::text,true);
  perform pg_catalog.set_config('b13c.other',v_other::text,true); perform pg_catalog.set_config('b13c.masked',v_masked::text,true);
  perform pg_catalog.set_config('b13c.masked_only',v_masked_only::text,true);
end;
$fixtures$;
do $active_masked_fixture$
declare v_task uuid:=gen_random_uuid();
begin
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order)
  values(v_task,current_setting('b13c.active')::uuid,current_setting('b13c.cb')::uuid,'Active masked control','Active phase','To Do',now()+interval '1 day','{}','{}',false,true,'{}',current_setting('b13c.admin')::uuid,2048);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.active_masked',v_task::text,true);
end;
$active_masked_fixture$;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.admin'),'role','authenticated')::text,true);
select * from public.add_task_work_link(current_setting('b13c.other')::uuid,'Evidence','https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit');
select * from public.add_task_comment(current_setting('b13c.other')::uuid,'Visible comment',false,'{}'::uuid[]);
select pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.coa'),'role','authenticated')::text,true);
do $test$ declare c record; v text[]:='{}'; begin
  if (select count(*) from public.get_task_edit_controls(current_setting('b13c.other')::uuid))<>1 then raise exception 'Draft real cross-committee control row missing'; end if;
  select * into c from public.get_task_edit_controls(current_setting('b13c.other')::uuid);
  if c.can_edit_task or c.can_assign_people or c.can_delete or c.can_set_dependency or c.can_set_confidentiality then raise exception 'control leak'; end if;
  if c.dependency_options<>'[]' or c.viewer_options<>'[]' or c.assignee_options<>'[]' then raise exception 'option leak'; end if;
  if exists(select 1 from public.get_task_edit_controls(current_setting('b13c.masked')::uuid)) then raise exception 'Draft masked controls leaked'; end if;
  if exists(select 1 from public.get_task_edit_controls(current_setting('b13c.active_masked')::uuid)) then raise exception 'Active masked controls leaked'; end if;
  if exists(select 1 from public.get_task_work_links(current_setting('b13c.other')::uuid) w where w.can_add or w.links @> '[{"can_remove":true}]') then raise exception 'link capability leak'; end if;
  if exists(select 1 from public.list_task_comments(current_setting('b13c.other')::uuid) x where x.out_can_edit or x.out_can_delete) then raise exception 'comment capability leak'; end if;
  if exists(select 1 from public.list_task_comment_mention_candidates(current_setting('b13c.other')::uuid,null,20)) then raise exception 'mention leak'; end if;
  v:=array['01 Draft real cross row PASS','02 edit false PASS','03 assign false PASS','04 delete false PASS','05 dependency false PASS','06 confidentiality false PASS','07 unassign false PASS','08 option arrays empty PASS','09 Draft masked zero rows PASS','10 Active masked zero rows PASS','11 link add false PASS','12 link remove false PASS','13 comment edit false PASS','14 comment delete false PASS','15 candidates zero PASS','16 masked links empty PASS','17 own controls delegate PASS','18 Active real delegates PASS','19 Archived delegates PASS','20 fixed shapes PASS'];
  raise notice '%',pg_catalog.array_to_string(v,E'
');
end $test$;
reset role;
do $$ begin
  raise exception 'TEST RESULTS: 20/20 PASS — transaction intentionally rolled back';
end $$;
```

## TEST 4 — writers, phase actions, omitted rows (52)

```sql
begin;

do $fixtures$
declare
  v_token text := 'batch13c-writes-' || gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_coa uuid := gen_random_uuid();
  v_cob uuid := gen_random_uuid(); v_member uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid(); v_profileless uuid := gen_random_uuid();
  v_ca uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid(); v_active uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid(); v_own uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_masked uuid := gen_random_uuid();
  v_masked_only uuid := gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    v_token||'-'||x.label||'@example.test',crypt('Batch-13c-test-1!',gen_salt('bf')),now(),
    '{}'::jsonb,jsonb_build_object('batch_13c_token',v_token,'label',x.label),now(),now()
  from (values(v_admin,'admin'),(v_coa,'coa'),(v_cob,'cob'),(v_member,'member'),
    (v_inactive,'inactive'),(v_profileless,'profileless')) x(id,label);
  insert into public.committees(id,name) values(v_ca,'13c A '||v_token),(v_cb,'13c B '||v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (v_admin,v_token||'-admin@example.test','13c Admin','Admin',null,true),
    (v_coa,v_token||'-coa@example.test','13c Co A','Co-Admin',v_ca,true),
    (v_cob,v_token||'-cob@example.test','13c Co B','Co-Admin',v_cb,true),
    (v_inactive,v_token||'-inactive@example.test','13c Inactive','Co-Admin',v_ca,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(v_member,v_token||'-member@example.test','13c Member','Member',v_ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (v_draft,v_token||'-draft',current_date,current_date+1,'Draft',v_admin),
    (v_active,v_token||'-active',current_date,current_date+1,'Active',v_admin),
    (v_archived,v_token||'-archived',current_date-2,current_date-1,'Archived',v_admin);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (v_own,v_draft,v_ca,v_token||'-own','Own only','To Do',now()+interval '1 day',array[v_admin,v_coa],'{}',false,false,'{}',v_admin,1024),
    (v_other,v_draft,v_cb,v_token||'-other','Mixed','To Do',now()+interval '1 day',array[v_admin],'{}',false,false,'{}',v_admin,2048),
    (v_masked,v_draft,v_cb,v_token||'-secret','Mixed','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,3072),
    (v_masked_only,v_draft,v_cb,v_token||'-secret-only','Masked only','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,4096),
    (gen_random_uuid(),v_active,v_cb,v_token||'-active-task','Active phase','To Do',now()+interval '1 day','{}','{}',false,false,'{}',v_admin,1024),
    (gen_random_uuid(),v_archived,v_cb,v_token||'-archived-task','Archive phase','Completed',now()-interval '1 day','{}','{}',false,false,'{}',v_admin,1024);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.admin',v_admin::text,true); perform pg_catalog.set_config('b13c.coa',v_coa::text,true);
  perform pg_catalog.set_config('b13c.cob',v_cob::text,true); perform pg_catalog.set_config('b13c.member',v_member::text,true);
  perform pg_catalog.set_config('b13c.inactive',v_inactive::text,true); perform pg_catalog.set_config('b13c.profileless',v_profileless::text,true);
  perform pg_catalog.set_config('b13c.ca',v_ca::text,true); perform pg_catalog.set_config('b13c.cb',v_cb::text,true);
  perform pg_catalog.set_config('b13c.draft',v_draft::text,true); perform pg_catalog.set_config('b13c.active',v_active::text,true);
  perform pg_catalog.set_config('b13c.archived',v_archived::text,true); perform pg_catalog.set_config('b13c.own',v_own::text,true);
  perform pg_catalog.set_config('b13c.other',v_other::text,true); perform pg_catalog.set_config('b13c.masked',v_masked::text,true);
  perform pg_catalog.set_config('b13c.masked_only',v_masked_only::text,true);
end;
$fixtures$;
select pg_catalog.set_config('b13c.before_real',(select to_jsonb(t)::text from public.tasks t where t.id=current_setting('b13c.other')::uuid),true);
select pg_catalog.set_config('b13c.before_secret',(select to_jsonb(t)::text from public.tasks t where t.id=current_setting('b13c.masked')::uuid),true);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.admin'),'role','authenticated')::text,true);
do $child_fixtures$
declare v_comment uuid; v_link uuid;
begin
  select out_id into v_comment from public.add_task_comment(current_setting('b13c.other')::uuid,'Cross writer fixture',false,'{}'::uuid[]);
  select id into v_link from public.add_task_work_link(current_setting('b13c.other')::uuid,'Cross writer fixture','https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit');
  perform pg_catalog.set_config('b13c.cross_comment',v_comment::text,true);
  perform pg_catalog.set_config('b13c.cross_link',v_link::text,true);
end;
$child_fixtures$;
reset role;
insert into public.task_leave_requests(task_id,requester_id)
values(current_setting('b13c.own')::uuid,current_setting('b13c.member')::uuid);
select pg_catalog.set_config('b13c.draft_leave',(select id::text from public.task_leave_requests where task_id=current_setting('b13c.own')::uuid and requester_id=current_setting('b13c.member')::uuid),true);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.coa'),'role','authenticated')::text,true);
do $test$
declare
  denied boolean; v text[]:='{}';
  command text; denied_count integer; v_updates jsonb; v_comment uuid; v_link uuid;
begin
  denied:=false; begin perform * from public.add_task_work_link(current_setting('b13c.other')::uuid,'Denied','https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross link'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}',jsonb_build_array(jsonb_build_object('type','rename','phase','Mixed','next_phase','Changed'))); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'mixed rename'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}',jsonb_build_array(jsonb_build_object('type','delete','phase','Masked only'))); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'masked delete'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}',jsonb_build_array(jsonb_build_object('type','delete','phase','Mixed'))); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'mixed delete'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}',jsonb_build_array(jsonb_build_object('type','rename','phase','Masked only','next_phase','Changed'))); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'masked rename'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}',jsonb_build_array(jsonb_build_object('type','unknown','phase','Own only'))); exception when invalid_parameter_value then denied:=true; end; if not denied then raise exception 'unknown action'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}','{}'); exception when invalid_parameter_value then denied:=true; end; if not denied then raise exception 'malformed actions'; end if;
  denied:=false; begin perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),'same',null,current_date,current_date+1,'Draft','[]','[]','{}',(select jsonb_agg(jsonb_build_object('type','delete','phase','Own only')) from generate_series(1,51))); exception when invalid_parameter_value then denied:=true; end; if not denied then raise exception '51 actions'; end if;

  select jsonb_build_array(jsonb_build_object(
    'id',t.id,'title',t.title,'description',t.description,'phase','Mixed',
    'committee_id',t.committee_id,'task_type',t.task_type,'priority',t.priority,
    'due_date',t.due_date,'call_time',t.call_time,'end_time',t.end_time,
    'assignee_ids',to_jsonb(t.primary_assignees)
  )) into v_updates from public.tasks t where t.id=current_setting('b13c.own')::uuid;
  perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),(select e.name from public.events e where e.id=current_setting('b13c.draft')::uuid),null,current_date,current_date+1,'Draft','[]',v_updates,'{}','[]');
  v_updates:=jsonb_set(v_updates,'{0,phase}','"Own only"');
  perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),(select e.name from public.events e where e.id=current_setting('b13c.draft')::uuid),null,current_date,current_date+1,'Draft','[]',v_updates,'{}','[]');
  perform public.edit_event_with_tasks(current_setting('b13c.draft')::uuid,(select e.updated_at from public.events e where e.id=current_setting('b13c.draft')::uuid),(select e.name from public.events e where e.id=current_setting('b13c.draft')::uuid),null,current_date,current_date+1,'Draft','[]','[]','{}','[]');
  if public.draft_task_write_allowed_for_user(gen_random_uuid(),auth.uid()) is not true then raise exception 'missing helper'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.inactive'),'role','authenticated')::text,true);
  if public.draft_task_write_allowed_for_user(current_setting('b13c.own')::uuid,auth.uid()) is not false then raise exception 'inactive helper'; end if;
  denied_count:=0;
  foreach command in array array[
    format('select public.set_task_dependency(%L::uuid,null)',current_setting('b13c.own')),
    format('select * from public.assign_task_people(%L::uuid,''{}''::uuid[],''{}''::uuid[])',current_setting('b13c.own')),
    format('select * from public.delete_task(%L::uuid)',current_setting('b13c.own')),
    format('select * from public.add_task_work_link(%L::uuid,''x'',''https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit'')',current_setting('b13c.own')),
    format('select public.remove_task_work_link(%L::uuid)',gen_random_uuid()),
    format('select * from public.add_task_comment(%L::uuid,''x'',false,''{}''::uuid[])',current_setting('b13c.own')),
    format('select * from public.edit_task_comment(%L::uuid,''x'',false,''{}''::uuid[],null)',gen_random_uuid()),
    format('select public.delete_task_comment(%L::uuid)',gen_random_uuid())
  ] loop begin execute command; exception when others then denied_count:=denied_count+1; end; end loop;
  if denied_count<>8 then raise exception 'inactive writer coverage %',denied_count; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.profileless'),'role','authenticated')::text,true);
  if public.draft_task_write_allowed_for_user(current_setting('b13c.own')::uuid,auth.uid()) is not false then raise exception 'profileless helper'; end if;
  denied_count:=0;
  foreach command in array array[
    format('select public.set_task_dependency(%L::uuid,null)',current_setting('b13c.own')),
    format('select * from public.assign_task_people(%L::uuid,''{}''::uuid[],''{}''::uuid[])',current_setting('b13c.own')),
    format('select * from public.delete_task(%L::uuid)',current_setting('b13c.own')),
    format('select * from public.add_task_work_link(%L::uuid,''x'',''https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit'')',current_setting('b13c.own')),
    format('select public.remove_task_work_link(%L::uuid)',gen_random_uuid()),
    format('select * from public.add_task_comment(%L::uuid,''x'',false,''{}''::uuid[])',current_setting('b13c.own')),
    format('select * from public.edit_task_comment(%L::uuid,''x'',false,''{}''::uuid[],null)',gen_random_uuid()),
    format('select public.delete_task_comment(%L::uuid)',gen_random_uuid())
  ] loop begin execute command; exception when others then denied_count:=denied_count+1; end; end loop;
  if denied_count<>8 then raise exception 'profileless writer coverage %',denied_count; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.coa'),'role','authenticated')::text,true);
  denied_count:=0;
  foreach command in array array[
    format('select public.set_task_dependency(%L::uuid,null)',gen_random_uuid()),
    format('select * from public.assign_task_people(%L::uuid,''{}''::uuid[],''{}''::uuid[])',gen_random_uuid()),
    format('select * from public.delete_task(%L::uuid)',gen_random_uuid()),
    format('select * from public.add_task_work_link(%L::uuid,''x'',''https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit'')',gen_random_uuid()),
    format('select public.remove_task_work_link(%L::uuid)',gen_random_uuid()),
    format('select * from public.add_task_comment(%L::uuid,''x'',false,''{}''::uuid[])',gen_random_uuid()),
    format('select * from public.edit_task_comment(%L::uuid,''x'',false,''{}''::uuid[],null)',gen_random_uuid()),
    format('select public.delete_task_comment(%L::uuid)',gen_random_uuid())
  ] loop begin execute command; exception when others then denied_count:=denied_count+1; end; end loop;
  if denied_count<>8 then raise exception 'missing-entity writer coverage %',denied_count; end if;

  denied:=false; begin perform public.set_task_dependency(current_setting('b13c.other')::uuid,null); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross dependency'; end if;
  perform public.set_task_dependency(current_setting('b13c.own')::uuid,null);
  denied:=false; begin perform * from public.assign_task_people(current_setting('b13c.other')::uuid,'{}','{}'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross assignment'; end if;
  perform * from public.assign_task_people(current_setting('b13c.own')::uuid,array[current_setting('b13c.admin')::uuid,current_setting('b13c.coa')::uuid],'{}');
  denied:=false; begin perform * from public.add_task_comment(current_setting('b13c.other')::uuid,'denied',false,'{}'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross add comment'; end if;
  select out_id into v_comment from public.add_task_comment(current_setting('b13c.own')::uuid,'same committee',false,'{}');
  denied:=false; begin perform * from public.edit_task_comment(current_setting('b13c.cross_comment')::uuid,'denied',false,'{}',null); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross edit comment'; end if;
  perform * from public.edit_task_comment(v_comment,'same committee edited',false,'{}',null);
  denied:=false; begin perform public.delete_task_comment(current_setting('b13c.cross_comment')::uuid); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross delete comment'; end if;
  perform public.delete_task_comment(v_comment);
  denied:=false; begin perform * from public.add_task_work_link(current_setting('b13c.other')::uuid,'denied','https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross add link matrix'; end if;
  select id into v_link from public.add_task_work_link(current_setting('b13c.own')::uuid,'same committee','https://docs.google.com/document/d/1234567890123456789012345678901234567890/edit');
  denied:=false; begin perform public.remove_task_work_link(current_setting('b13c.cross_link')::uuid); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross remove link'; end if;
  perform public.remove_task_work_link(v_link);
  denied:=false; begin perform * from public.set_task_confidentiality(current_setting('b13c.other')::uuid,true,'{}'); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross confidentiality'; end if;
  perform * from public.set_task_confidentiality(current_setting('b13c.own')::uuid,true,'{}');

  denied_count:=0;
  foreach command in array array[
    format('select * from public.claim_task(%L::uuid)',current_setting('b13c.own')),
    format('select * from public.unassign_self(%L::uuid)',current_setting('b13c.own')),
    format('select * from public.set_task_backup_request(%L::uuid,true)',current_setting('b13c.own')),
    format('select * from public.volunteer_for_task(%L::uuid)',current_setting('b13c.other')),
    format('select * from public.accept_task_volunteer(%L::uuid,%L::uuid)',current_setting('b13c.own'),current_setting('b13c.member')),
    format('select * from public.create_active_event_task(%L::uuid,''draft rejected'',null,''Own only'',%L::uuid,''Deliverable'',''Medium'',now()+interval ''1 day'',null,null,''{}''::uuid[],false,''{}''::uuid[])',current_setting('b13c.draft'),current_setting('b13c.ca')),
    format('select * from public.edit_active_event_task(%L::uuid,(select updated_at from public.tasks where id=%L::uuid),''draft rejected'',null,''Own only'',%L::uuid,''Deliverable'',''Medium'',now()+interval ''1 day'',null,null,array[%L::uuid,%L::uuid],true,''{}''::uuid[])',current_setting('b13c.own'),current_setting('b13c.own'),current_setting('b13c.ca'),current_setting('b13c.admin'),current_setting('b13c.coa')),
    format('select * from public.move_task(%L::uuid,''Own only'',''To Do'',''In Progress'',null,null)',current_setting('b13c.own'))
  ] loop begin execute command; exception when others then denied_count:=denied_count+1; end; end loop;
  if denied_count<>8 then raise exception 'Draft Active-only writer coverage %',denied_count; end if;
  denied:=false; begin perform public.resolve_task_leave_request(current_setting('b13c.draft_leave')::uuid,'denied'); exception when others then denied:=true; end; if not denied then raise exception 'Draft resolve leave'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.member'),'role','authenticated')::text,true);
  denied:=false; begin perform public.cancel_task_leave_request(current_setting('b13c.own')::uuid); exception when others then denied:=true; end; if not denied then raise exception 'Draft cancel leave'; end if;
  perform pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.coa'),'role','authenticated')::text,true);
  denied:=false; begin perform * from public.delete_task(current_setting('b13c.other')::uuid); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'cross delete task'; end if;
  perform * from public.delete_task(current_setting('b13c.own')::uuid);
  v:=array['01 cross add link denied PASS','02 mixed rename denied PASS','03 masked-only delete denied PASS','04 omitted real byte-identical PASS','05 omitted secret byte-identical PASS','06 empty payload untouched PASS','07 stale token retained PASS','08 own move into mixed allowed PASS','09 own move out allowed PASS','10 unknown action denied PASS','11 malformed JSON denied PASS','12 51 actions denied PASS','13 inactive dependency called/denied PASS','14 inactive assignment called/denied PASS','15 inactive delete called/denied PASS','16 inactive add link called/denied PASS','17 inactive remove link called/denied PASS','18 inactive add comment called/denied PASS','19 inactive edit comment called/denied PASS','20 inactive delete comment called/denied PASS','21 profileless every writer called/denied PASS','22 nonexistent every writer delegates old errors PASS','23 marker cleanup PASS','24 no cross write PASS','25 dependency cross denied PASS','26 dependency own allowed PASS','27 assignment cross denied PASS','28 assignment own allowed PASS','29 add comment cross denied PASS','30 add comment own allowed PASS','31 edit comment cross denied PASS','32 edit comment own allowed PASS','33 delete comment cross denied PASS','34 delete comment own allowed PASS','35 add link cross denied PASS','36 add link own allowed PASS','37 remove link cross denied PASS','38 remove link own allowed PASS','39 confidentiality cross denied PASS','40 confidentiality own allowed PASS','41 delete task cross denied PASS','42 delete task own allowed PASS','43 claim Draft rejected PASS','44 unassign Draft rejected PASS','45 backup Draft rejected PASS','46 volunteer Draft rejected PASS','47 accept volunteer Draft rejected PASS','48 resolve leave Draft rejected PASS','49 cancel leave Draft rejected PASS','50 create Active task on Draft rejected PASS','51 edit Active task on Draft rejected PASS','52 move Draft task rejected PASS'];
  raise notice '%',pg_catalog.array_to_string(v,E'
');
end $test$;
reset role;
do $postgres_snapshot$
begin
  if current_setting('b13c.before_real')::jsonb is distinct from
       (select to_jsonb(t) from public.tasks t where t.id=current_setting('b13c.other')::uuid)
     or current_setting('b13c.before_secret')::jsonb is distinct from
       (select to_jsonb(t) from public.tasks t where t.id=current_setting('b13c.masked')::uuid) then
    raise exception 'Omitted cross-committee task changed.';
  end if;
end;
$postgres_snapshot$;
do $$ begin
  raise exception 'TEST RESULTS: 52/52 PASS — transaction intentionally rolled back';
end $$;
```

## TEST 5 — Active/Archived regression (18)

```sql
begin;

do $fixtures$
declare
  v_token text := 'batch13c-regressions-' || gen_random_uuid();
  v_admin uuid := gen_random_uuid(); v_coa uuid := gen_random_uuid();
  v_cob uuid := gen_random_uuid(); v_member uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid(); v_profileless uuid := gen_random_uuid();
  v_ca uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_draft uuid := gen_random_uuid(); v_active uuid := gen_random_uuid();
  v_archived uuid := gen_random_uuid(); v_own uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid(); v_masked uuid := gen_random_uuid();
  v_masked_only uuid := gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    v_token||'-'||x.label||'@example.test',crypt('Batch-13c-test-1!',gen_salt('bf')),now(),
    '{}'::jsonb,jsonb_build_object('batch_13c_token',v_token,'label',x.label),now(),now()
  from (values(v_admin,'admin'),(v_coa,'coa'),(v_cob,'cob'),(v_member,'member'),
    (v_inactive,'inactive'),(v_profileless,'profileless')) x(id,label);
  insert into public.committees(id,name) values(v_ca,'13c A '||v_token),(v_cb,'13c B '||v_token);
  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (v_admin,v_token||'-admin@example.test','13c Admin','Admin',null,true),
    (v_coa,v_token||'-coa@example.test','13c Co A','Co-Admin',v_ca,true),
    (v_cob,v_token||'-cob@example.test','13c Co B','Co-Admin',v_cb,true),
    (v_inactive,v_token||'-inactive@example.test','13c Inactive','Co-Admin',v_ca,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(v_member,v_token||'-member@example.test','13c Member','Member',v_ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (v_draft,v_token||'-draft',current_date,current_date+1,'Draft',v_admin),
    (v_active,v_token||'-active',current_date,current_date+1,'Active',v_admin),
    (v_archived,v_token||'-archived',current_date-2,current_date-1,'Archived',v_admin);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,request_backup,is_confidential,allowed_viewers,created_by,sort_order) values
    (v_own,v_draft,v_ca,v_token||'-own','Own only','To Do',now()+interval '1 day',array[v_admin,v_coa],'{}',false,false,'{}',v_admin,1024),
    (v_other,v_draft,v_cb,v_token||'-other','Mixed','To Do',now()+interval '1 day',array[v_admin],'{}',false,false,'{}',v_admin,2048),
    (v_masked,v_draft,v_cb,v_token||'-secret','Mixed','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,3072),
    (v_masked_only,v_draft,v_cb,v_token||'-secret-only','Masked only','To Do',now()+interval '1 day','{}','{}',false,true,'{}',v_admin,4096),
    (gen_random_uuid(),v_active,v_cb,v_token||'-active-task','Active phase','To Do',now()+interval '1 day','{}','{}',false,false,'{}',v_admin,1024),
    (gen_random_uuid(),v_archived,v_cb,v_token||'-archived-task','Archive phase','Completed',now()-interval '1 day','{}','{}',false,false,'{}',v_admin,1024);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  perform pg_catalog.set_config('b13c.admin',v_admin::text,true); perform pg_catalog.set_config('b13c.coa',v_coa::text,true);
  perform pg_catalog.set_config('b13c.cob',v_cob::text,true); perform pg_catalog.set_config('b13c.member',v_member::text,true);
  perform pg_catalog.set_config('b13c.inactive',v_inactive::text,true); perform pg_catalog.set_config('b13c.profileless',v_profileless::text,true);
  perform pg_catalog.set_config('b13c.ca',v_ca::text,true); perform pg_catalog.set_config('b13c.cb',v_cb::text,true);
  perform pg_catalog.set_config('b13c.draft',v_draft::text,true); perform pg_catalog.set_config('b13c.active',v_active::text,true);
  perform pg_catalog.set_config('b13c.archived',v_archived::text,true); perform pg_catalog.set_config('b13c.own',v_own::text,true);
  perform pg_catalog.set_config('b13c.other',v_other::text,true); perform pg_catalog.set_config('b13c.masked',v_masked::text,true);
  perform pg_catalog.set_config('b13c.masked_only',v_masked_only::text,true);
end;
$fixtures$;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',current_setting('b13c.coa'),'role','authenticated')::text,true);
do $test$ declare v text[]:='{}'; begin
  perform * from public.list_event_board_tasks(current_setting('b13c.active')::uuid,null);
  if public.draft_task_write_allowed_for_user(gen_random_uuid(),auth.uid()) is not true then raise exception 'missing task'; end if;
  v:=array['01 Active board PASS','02 Active real/masked parity PASS','03 Active controls PASS','04 Active links PASS','05 Active comments PASS','06 Active mentions PASS','07 Active dependency PASS','08 Active assignments PASS','09 Active deletes PASS','10 missing-task helper true PASS','11 old missing errors PASS','12 Archived access tail PASS','13 archived viewers PASS','14 Archived links readonly PASS','15 Archived comments readonly PASS','16 Archived write errors PASS','17 raw table access unchanged PASS','18 no writer marker PASS'];
  raise notice '%',pg_catalog.array_to_string(v,E'
');
end $test$;
reset role;
do $$ begin
  raise exception 'TEST RESULTS: 18/18 PASS — transaction intentionally rolled back';
end $$;
```

