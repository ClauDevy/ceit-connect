# Step 13b — database verification

> **NOT YET RUN.** These pastes were authored from the local migration source. No result below is a Dev or Prod verification claim.

Run each paste separately in the **Dev** SQL Editor with **Run without RLS** enabled. Never run them in Prod. Every paste creates its own Auth/profile/event/task fixtures, uses a normal transaction-owned result table (never a temporary table), forces deferred checks with `set constraints all immediate`, and ends in an intentional exception so its fixtures roll back. None touches `storage.objects`.

Expected result-line counts after the approved additions:

- Paste A: **64**
- Paste B: **48**
- Paste C: **52**
- Paste D: **54**
- Paste E: **46**
- Paste F: **38**

The future Reopen UI must pass the exact `updated_at` string returned by its reader. It must not round-trip the token through JavaScript `Date`, which loses PostgreSQL microseconds.

## Paste A — catalogs, grants, trigger order, and lock-order bodies

Expected result lines: **64**, followed by `TEST RESULTS: STEP 13B A 64/64 PASS`.

```sql
begin;
set local timezone = 'Asia/Manila';
create table public._13b_a_results(n integer primary key,label text,passed boolean not null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13ba0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13b-a@example.test',crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now());

with expected(name,signature,security_definer,volatility,authenticated_execute) as (values
 ('canonical_task_phase','public.canonical_task_phase(text)'::regprocedure,false,'i',false),
 ('task_phase_lock_key','public.task_phase_lock_key(uuid,text)'::regprocedure,false,'i',false),
 ('task_phase_is_complete','public.task_phase_is_complete(uuid,text)'::regprocedure,true,'v',false),
 ('try_task_event_advisory_lock','public.try_task_event_advisory_lock(uuid)'::regprocedure,false,'v',false),
 ('try_task_phase_lock','public.try_task_phase_lock(uuid,text,boolean)'::regprocedure,false,'v',false),
 ('guard_completed_phase_task_writes','public.guard_completed_phase_task_writes()'::regprocedure,true,'v',false),
 ('guard_completed_phase_child_writes','public.guard_completed_phase_child_writes()'::regprocedure,true,'v',false),
 ('reopen_completed_phase_task','public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure,true,'v',true)
), checks as (
 select row_number() over(order by e.name,c.check_no)::integer n,
        e.name||' '||c.label label,
        case c.check_no
          when 1 then p.oid is not null
          when 2 then pg_get_userbyid(p.proowner)='postgres'
          when 3 then p.proconfig=array['search_path=""']
          when 4 then p.provolatile=e.volatility
          when 5 then p.prosecdef=e.security_definer
          when 6 then has_function_privilege('authenticated',e.signature,'EXECUTE')=e.authenticated_execute
        end passed
 from expected e join pg_proc p on p.oid=e.signature
 cross join (values(1,'exists'),(2,'postgres owner'),(3,'fixed empty path'),(4,'volatility'),(5,'security mode'),(6,'authenticated grant')) c(check_no,label)
)
insert into public._13b_a_results select * from checks;

with expected(table_name,trigger_name) as (values
 ('tasks','tasks_h0_guard_completed_phase_writes'),
 ('task_work_links','task_work_links_a0_guard_completed_phase_writes'),
 ('task_comments','task_comments_a0_guard_completed_phase_writes'),
 ('task_volunteers','task_volunteers_a0_guard_completed_phase_writes'),
 ('task_leave_requests','task_leave_requests_a0_guard_completed_phase_writes')
), checks as (
 select 48+row_number() over(order by e.table_name,c.check_no)::integer n,
        e.trigger_name||' '||c.label,
        case c.check_no
          when 1 then t.oid is not null and t.tgenabled='O'
          when 2 then not t.tgisinternal and pg_get_triggerdef(t.oid) like '%BEFORE%'
        end
 from expected e
 join pg_class r on r.relname=e.table_name and r.relnamespace='public'::regnamespace
 join pg_trigger t on t.tgrelid=r.oid and t.tgname=e.trigger_name
 cross join (values(1,'enabled'),(2,'BEFORE user trigger')) c(check_no,label)
)
insert into public._13b_a_results select * from checks;

with bodies as (
 select
  lower(regexp_replace((select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure),'\s+',' ','g')) task_guard,
  lower(regexp_replace((select prosrc from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure),'\s+',' ','g')) child_guard,
  lower(regexp_replace((select prosrc from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure),'\s+',' ','g')) move_body,
  lower(regexp_replace(regexp_replace(regexp_replace((select prosrc from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure),E'--[^\n\r]*','','g'),'/[*]([^*]|[*]+[^*/])*[*]+/','','g'),'\s+',' ','g')) reopen_body
)
insert into public._13b_a_results values
(59,'task guard event advisory precedes phase',position('try_task_event_advisory_lock' in (select task_guard from bodies))<position('try_task_phase_lock' in (select task_guard from bodies))),
(60,'capacity trigger uses event NOWAIT then advisory try',position('for share nowait' in (select lower(prosrc) from pg_proc where oid='public.enforce_event_task_capacity()'::regprocedure))<position('pg_try_advisory_xact_lock' in (select lower(prosrc) from pg_proc where oid='public.enforce_event_task_capacity()'::regprocedure))),
(61,'child guard has no event advisory wait',position('task_dependency_lock_key' in (select child_guard from bodies))=0),
(62,'child phase acquisition is shared try',position('try_task_phase_lock(v_event_id, v_phase, false)' in (select child_guard from bodies))>0),
(63,'move event advisory precedes phase and old body',position('task_dependency_lock_key' in (select move_body from bodies))<position('task_phase_lock_key' in (select move_body from bodies)) and position('task_phase_lock_key' in (select move_body from bodies))<position('move_task_pre13b' in (select move_body from bodies))),
(64,'Reopen authorizes before every lock then preserves lock order',position('completed_phase_reopen_actor_allowed' in (select reopen_body from bodies))>0 and position('completed_phase_reopen_actor_allowed' in (select reopen_body from bodies))<position('for share' in (select reopen_body from bodies)) and position('completed_phase_reopen_actor_allowed' in (select reopen_body from bodies))<position('pg_advisory_xact_lock' in (select reopen_body from bodies)) and position('completed_phase_reopen_actor_allowed' in (select reopen_body from bodies))<position('for update' in (select reopen_body from bodies)) and position('task_dependency_lock_key' in (select reopen_body from bodies))<position('task_phase_lock_key' in (select reopen_body from bodies)) and position('task_phase_lock_key' in (select reopen_body from bodies))<position('for update' in (select reopen_body from bodies)));

set constraints all immediate;
do $$ declare bad text; begin select string_agg(n||' '||label,', ' order by n) into bad from public._13b_a_results where not passed; if (select count(*) from public._13b_a_results)<>64 or bad is not null then raise exception 'STEP 13B A FAIL: %',coalesce(bad,'wrong result count'); end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from public._13b_a_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B A 64/64 PASS'; end $$;
rollback;
```

## Paste B — canonical completion and raw task writes

Expected result lines: **48**, followed by `TEST RESULTS: STEP 13B B 48/48 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create table public._13b_b_results(n integer primary key,label text,passed boolean not null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13bb0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13b-b@example.test',crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.users(id,email,full_name,role,is_active) values('13bb0000-0000-4000-8000-000000000001','step13b-b@example.test','13B Admin','Admin',true);
insert into public.committees(id,name) values('13bb1000-0000-4000-8000-000000000001','13B Committee');
insert into public.events(id,name,start_date,end_date,status,created_by) values('13bb2000-0000-4000-8000-000000000001','13B Event','2026-11-01','2026-11-02','Active','13bb0000-0000-4000-8000-000000000001');
insert into public.tasks(id,event_id,committee_id,title,phase,status) values
('13bb3000-0000-4000-8000-000000000001','13bb2000-0000-4000-8000-000000000001','13bb1000-0000-4000-8000-000000000001','Setup one','Setup','To Do'),
('13bb3000-0000-4000-8000-000000000002','13bb2000-0000-4000-8000-000000000001','13bb1000-0000-4000-8000-000000000001','Setup two',' Setup ','To Do'),
('13bb3000-0000-4000-8000-000000000003','13bb2000-0000-4000-8000-000000000001','13bb1000-0000-4000-8000-000000000001','Null phase',null,'To Do');
update public.tasks set status='Completed' where id in ('13bb3000-0000-4000-8000-000000000001','13bb3000-0000-4000-8000-000000000002');

with cases(raw,expected) as (values(null::text,'Unphased'),('','Unphased'),('   ','Unphased'),('Unphased','Unphased'),('Setup','Setup'),(' Setup ','Setup'),('setup','setup'),(E'\tSetup\n',E'\tSetup\n'))
insert into public._13b_b_results
select row_number() over()::integer,'canonical '||coalesce(quote_nullable(raw),'NULL'),public.canonical_task_phase(raw)=expected from cases;
with cases(phase_name,expected) as (values('Setup',true),(' Setup ',true),('setup',false),('Unphased',false),(null::text,false),('',false),('   ',false),('Missing',false))
insert into public._13b_b_results
select 8+row_number() over()::integer,'completion '||coalesce(quote_nullable(phase_name),'NULL'),public.task_phase_is_complete('13bb2000-0000-4000-8000-000000000001',phase_name)=expected from cases;
do $$ declare denied boolean; i integer; begin
 for i in 1..16 loop
  denied:=false;
  begin
   case i%4 when 0 then update public.tasks set title=title||'x' where id='13bb3000-0000-4000-8000-000000000001';
    when 1 then delete from public.tasks where id='13bb3000-0000-4000-8000-000000000001';
    when 2 then insert into public.tasks(event_id,committee_id,title,phase) values('13bb2000-0000-4000-8000-000000000001','13bb1000-0000-4000-8000-000000000001','blocked','Setup');
    else update public.tasks set phase='Setup' where id='13bb3000-0000-4000-8000-000000000003'; end case;
  exception when sqlstate 'CCQ01' then denied:=true; end;
  insert into public._13b_b_results values(16+i,'completed raw denial '||i,denied);
 end loop;
end $$;
with checks(label,passed) as (values
 ('Unphased remains writable',(select status='To Do' from public.tasks where id='13bb3000-0000-4000-8000-000000000003')),
 ('case-sensitive lower phase remains open',not public.task_phase_is_complete('13bb2000-0000-4000-8000-000000000001','setup')),
 ('named phase has rows',public.task_phase_is_complete('13bb2000-0000-4000-8000-000000000001','Setup')),
 ('empty named phase is not complete',not public.task_phase_is_complete('13bb2000-0000-4000-8000-000000000001','Missing')),
 ('helper is all-row definer',(select prosecdef from pg_proc where oid='public.task_phase_is_complete(uuid,text)'::regprocedure)),
 ('helper is volatile',(select provolatile='v' from pg_proc where oid='public.task_phase_is_complete(uuid,text)'::regprocedure)),
 ('raw source check exists',position('task_phase_is_complete(old.event_id' in (select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('raw destination check exists',position('task_phase_is_complete(new.event_id' in (select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('Archived check precedes completion',position('v_event_status = ''Archived''' in (select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))<position('task_phase_is_complete(old.event_id' in (select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))),
 ('event advisory try helper used',position('try_task_event_advisory_lock' in (select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('shared lock primitive exists',position('pg_try_advisory_xact_lock_shared' in (select prosrc from pg_proc where oid='public.try_task_phase_lock(uuid,text,boolean)'::regprocedure))>0),
 ('exclusive lock primitive exists',position('pg_try_advisory_xact_lock(' in (select prosrc from pg_proc where oid='public.try_task_phase_lock(uuid,text,boolean)'::regprocedure))>0),
 ('event deletion bypass exact',position('event_delete_context_matches(old.event_id)' in (select prosrc from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('no completion column',not exists(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name in ('is_phase_complete','phase_complete'))),
 ('no phases table',to_regclass('public.phases') is null),
 ('sort_order is bigint',(select data_type='bigint' from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='sort_order'))
)
insert into public._13b_b_results select 32+row_number() over()::integer,label,passed from checks;
set constraints all immediate;
do $$ declare bad text; begin select string_agg(n||' '||label,', ' order by n) into bad from public._13b_b_results where not passed; if (select count(*) from public._13b_b_results)<>48 or bad is not null then raise exception 'STEP 13B B FAIL: %',coalesce(bad,'wrong result count'); end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from public._13b_b_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B B 48/48 PASS'; end $$;
rollback;
```

## Paste C — Edit Event no-ops, writers, and final-completion rebalance

Expected result lines: **52**, followed by `TEST RESULTS: STEP 13B C 52/52 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create table public._13b_c_results(n integer primary key,label text,passed boolean not null);
create table public._13b_c_before(id uuid primary key,updated_at timestamptz);
create table public._13b_c_noop_activity_before(n bigint not null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('13bc0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13b-c@example.test',crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now()),
('13bc0000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13b-c-member@example.test',crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.committees(id,name) values('13bc1000-0000-4000-8000-000000000001','13C Committee');
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('13bc0000-0000-4000-8000-000000000001','step13b-c@example.test','13B Admin','Admin',null,true),
('13bc0000-0000-4000-8000-000000000002','step13b-c-member@example.test','13B Member','Member','13bc1000-0000-4000-8000-000000000001',true);
insert into public.events(id,name,description,start_date,end_date,status,created_by) values('13bc2000-0000-4000-8000-000000000001','13C Event',null,'2026-11-01','2026-11-02','Active','13bc0000-0000-4000-8000-000000000001');
insert into public.tasks(id,event_id,committee_id,title,phase,status) values
('13bc3000-0000-4000-8000-000000000001','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Complete no-op','Setup','To Do'),
('13bc3000-0000-4000-8000-000000000002','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Null raw',null,'To Do'),
('13bc3000-0000-4000-8000-000000000003','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Blank raw','','To Do'),
('13bc3000-0000-4000-8000-000000000004','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Whitespace raw','   ','To Do'),
('13bc3000-0000-4000-8000-000000000005','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Label raw','Unphased','To Do');
update public.tasks set status='Completed' where id='13bc3000-0000-4000-8000-000000000001';
insert into public._13b_c_before select id,updated_at from public.tasks where event_id='13bc2000-0000-4000-8000-000000000001';
insert into public._13b_c_noop_activity_before
select count(*) from public.activity_log where task_id in(select id from public._13b_c_before);
select set_config('request.jwt.claims','{"sub":"13bc0000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select public.edit_event_with_tasks(
 '13bc2000-0000-4000-8000-000000000001',(select updated_at from public.events where id='13bc2000-0000-4000-8000-000000000001'),
 '13C Event metadata saved',null,'2026-11-01','2026-11-02','Active','[]'::jsonb,
 (select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'description',t.description,'phase',case when public.canonical_task_phase(t.phase)='Unphased' then 'Unphased' else public.canonical_task_phase(t.phase) end,'committee_id',t.committee_id,'task_type',t.task_type,'priority',t.priority,'due_date',case when t.due_date is null then null else to_char(t.due_date,'YYYY-MM-DD') end,'call_time',t.call_time,'end_time',t.end_time,'assignee_ids',t.primary_assignees) order by t.id) from public.tasks t where t.event_id='13bc2000-0000-4000-8000-000000000001'),
 '{}'::uuid[],'[]'::jsonb);

insert into public._13b_c_results
select row_number() over(order by t.id)::integer,'no-op updated_at '||t.title,t.updated_at=b.updated_at
from public.tasks t join public._13b_c_before b using(id);
insert into public._13b_c_results values
(6,'no no-op task activity',(select count(*)=(select n from public._13b_c_noop_activity_before) from public.activity_log where task_id in(select id from public._13b_c_before))),
(7,'metadata saved',(select name='13C Event metadata saved' from public.events where id='13bc2000-0000-4000-8000-000000000001')),
(8,'complete no-op remains complete',public.task_phase_is_complete('13bc2000-0000-4000-8000-000000000001','Setup')),
(9,'null raw phase preserved',(select phase is null from public.tasks where id='13bc3000-0000-4000-8000-000000000002')),
(10,'blank raw phase preserved',(select phase='' from public.tasks where id='13bc3000-0000-4000-8000-000000000003')),
(11,'whitespace raw phase preserved',(select phase='   ' from public.tasks where id='13bc3000-0000-4000-8000-000000000004')),
(12,'Unphased label preserved',(select phase='Unphased' from public.tasks where id='13bc3000-0000-4000-8000-000000000005'));

do $$ declare denied boolean:=false; begin
 begin perform public.edit_event_with_tasks('13bc2000-0000-4000-8000-000000000001',(select updated_at from public.events where id='13bc2000-0000-4000-8000-000000000001'),'13C Event metadata saved',null,'2026-11-01','2026-11-02','Active','[]'::jsonb,jsonb_build_array(jsonb_build_object('id','13bc3000-0000-4000-8000-000000000001','title','Changed','description',null,'phase','Setup','committee_id','13bc1000-0000-4000-8000-000000000001','task_type','Deliverable','priority','Medium','due_date',null,'call_time',null,'end_time',null,'assignee_ids','[]'::jsonb)),'{}'::uuid[],'[]'::jsonb); exception when sqlstate 'CCQ01' then denied:=true; end;
 insert into public._13b_c_results values(13,'one changed complete field rejected',denied);
end $$;

do $$ declare denied boolean:=false; v_message text; begin
 begin
  perform public.edit_event_with_tasks('13bc2000-0000-4000-8000-000000000001',(select updated_at from public.events where id='13bc2000-0000-4000-8000-000000000001'),'13C Event metadata saved',null,'2026-11-01','2026-11-02','Active','[]'::jsonb,jsonb_build_array(jsonb_build_object('id','13bc3000-0000-4000-8000-000000000002','title','Null raw','description',null,'phase','Unphased','committee_id','13bc1000-0000-4000-8000-000000000001','task_type','Deliverable','priority','Medium','due_date',null,'call_time',null,'end_time',null,'assignee_ids','[]'::jsonb)),array['13bc3000-0000-4000-8000-000000000002'::uuid],'[]'::jsonb);
 exception when others then get stacked diagnostics v_message=message_text; denied:=v_message='A task cannot be updated and deleted in the same save.'; end;
 insert into public._13b_c_results values(14,'unchanged update plus delete retains old conflict',denied);
end $$;

set local timezone='UTC';
select set_config('request.jwt.claims','{}',true);
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
insert into public.tasks(id,event_id,committee_id,title,phase,due_date,primary_assignees)
values('13bc3000-0000-4000-8000-000000000006','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Dated no-op','Dated phase','2026-11-03',array['13bc0000-0000-4000-8000-000000000001'::uuid,'13bc0000-0000-4000-8000-000000000002'::uuid]);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('request.jwt.claims','{"sub":"13bc0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
update public.tasks set status='Completed' where id='13bc3000-0000-4000-8000-000000000006';
set local timezone='Asia/Manila';
do $$ declare before_updated_at timestamptz; before_activity bigint; denied boolean:=false; v_message text; begin
 select updated_at into before_updated_at from public.tasks where id='13bc3000-0000-4000-8000-000000000006';
 select count(*) into before_activity from public.activity_log where task_id='13bc3000-0000-4000-8000-000000000006';
 perform set_config('TimeZone','UTC',true);
 perform public.edit_event_with_tasks('13bc2000-0000-4000-8000-000000000001',(select updated_at from public.events where id='13bc2000-0000-4000-8000-000000000001'),'13C Event metadata saved',null,'2026-11-01','2026-11-02','Active','[]'::jsonb,jsonb_build_array(jsonb_build_object('id','13bc3000-0000-4000-8000-000000000006','title','Dated no-op','description',null,'phase','Dated phase','committee_id','13bc1000-0000-4000-8000-000000000001','task_type','Deliverable','priority','Medium','due_date','2026-11-03','call_time',null,'end_time',null,'assignee_ids',jsonb_build_array('13bc0000-0000-4000-8000-000000000001','13bc0000-0000-4000-8000-000000000002'))),'{}'::uuid[],'[]'::jsonb);
 insert into public._13b_c_results values(50,'non-Manila dated no-op skipped',(select updated_at=before_updated_at from public.tasks where id='13bc3000-0000-4000-8000-000000000006') and (select count(*)=before_activity from public.activity_log where task_id='13bc3000-0000-4000-8000-000000000006'));
 begin
  perform public.edit_event_with_tasks('13bc2000-0000-4000-8000-000000000001',(select updated_at from public.events where id='13bc2000-0000-4000-8000-000000000001'),'13C Event metadata saved',null,'2026-11-01','2026-11-02','Active','[]'::jsonb,jsonb_build_array(jsonb_build_object('id','13bc3000-0000-4000-8000-000000000006','title','Dated no-op','description',null,'phase','Dated phase','committee_id','13bc1000-0000-4000-8000-000000000001','task_type','Deliverable','priority','Medium','due_date','2026-11-03','call_time',null,'end_time',null,'assignee_ids',jsonb_build_array('13bc0000-0000-4000-8000-000000000002','13bc0000-0000-4000-8000-000000000001'))),'{}'::uuid[],'[]'::jsonb);
 exception when sqlstate 'CCQ01' then denied:=true; end;
 insert into public._13b_c_results values(51,'reordered assignees delegated and rejected',denied);
 denied:=false; v_message:=null;
 begin
  perform public.edit_event_with_tasks('13bc2000-0000-4000-8000-000000000001',(select updated_at from public.events where id='13bc2000-0000-4000-8000-000000000001'),'13C Event metadata saved',null,'2026-11-01','2026-11-02','Active','[]'::jsonb,jsonb_build_array(jsonb_build_object('id','13bc3000-0000-4000-8000-000000000006','title','Dated no-op','description',7,'phase','Dated phase','committee_id','13bc1000-0000-4000-8000-000000000001','task_type','Deliverable','priority','Medium','due_date','2026-11-03','call_time',null,'end_time',null,'assignee_ids',jsonb_build_array('13bc0000-0000-4000-8000-000000000001','13bc0000-0000-4000-8000-000000000002'))),'{}'::uuid[],'[]'::jsonb);
 exception when others then get stacked diagnostics v_message=message_text; denied:=v_message='Task descriptions must be strings or null.'; end;
 insert into public._13b_c_results values(52,'wrong-typed description retains old error',denied);
 perform set_config('TimeZone','Asia/Manila',true);
end $$;

insert into public.tasks(id,event_id,committee_id,title,phase,status) values
('13bc3000-0000-4000-8000-000000000011','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Rank A','Rank','To Do'),
('13bc3000-0000-4000-8000-000000000012','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Rank B','Rank','To Do'),
('13bc3000-0000-4000-8000-000000000013','13bc2000-0000-4000-8000-000000000001','13bc1000-0000-4000-8000-000000000001','Rank final','Rank','To Do');
update public.tasks set status='Completed' where id in('13bc3000-0000-4000-8000-000000000011','13bc3000-0000-4000-8000-000000000012');
update public.tasks set status='In Progress' where id='13bc3000-0000-4000-8000-000000000013';
alter table public.tasks disable trigger tasks_z2_set_destination_lane_order;
update public.tasks set sort_order=case id when '13bc3000-0000-4000-8000-000000000011' then 9223372036854775000 else 9223372036854775500 end where id in('13bc3000-0000-4000-8000-000000000011','13bc3000-0000-4000-8000-000000000012');
alter table public.tasks enable trigger tasks_z2_set_destination_lane_order;
create table public._13b_c_activity_before(n bigint);
insert into public._13b_c_activity_before select count(*) from public.activity_log where task_id in('13bc3000-0000-4000-8000-000000000011','13bc3000-0000-4000-8000-000000000012','13bc3000-0000-4000-8000-000000000013');
select * from public.move_task('13bc3000-0000-4000-8000-000000000013','Rank','In Progress','Completed',null,null);
insert into public._13b_c_results values
(15,'rank phase completes',public.task_phase_is_complete('13bc2000-0000-4000-8000-000000000001','Rank')),
(16,'all Rank tasks completed',(select bool_and(status='Completed') from public.tasks where public.canonical_task_phase(phase)='Rank')),
(17,'Rank orders unique',(select count(*)=count(distinct sort_order) from public.tasks where public.canonical_task_phase(phase)='Rank' and status='Completed')),
(18,'Rank orders spaced',(select array_agg(sort_order order by sort_order)=array[1024,2048,3072]::bigint[] from public.tasks where public.canonical_task_phase(phase)='Rank')),
(19,'only final task adds activity',(select count(*)=(select n+1 from public._13b_c_activity_before) from public.activity_log where task_id in('13bc3000-0000-4000-8000-000000000011','13bc3000-0000-4000-8000-000000000012','13bc3000-0000-4000-8000-000000000013')));

with checks(label,passed) as (values
 ('old Step 12 body retained',to_regprocedure('public.edit_event_with_tasks_step12_pre13b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])') is not null),
 ('new Step 12 wrapper retained',to_regprocedure('public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])') is not null),
 ('no-op helper uses canonical phase',position('canonical_task_phase' in (select prosrc from pg_proc where oid='ceit_connect_private.edit_event_task_payload_is_unchanged(uuid,jsonb)'::regprocedure))>0),
 ('no-op helper compares assignments',position('primary_assignees' in (select prosrc from pg_proc where oid='ceit_connect_private.edit_event_task_payload_is_unchanged(uuid,jsonb)'::regprocedure))>0),
 ('wrapper filters before old body',position('edit_event_task_payload_is_unchanged' in (select prosrc from pg_proc where oid='public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure))<position('edit_event_with_tasks_step12_pre13b' in (select prosrc from pg_proc where oid='public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure))),
 ('duplicate IDs delegated',position('v_has_duplicate_ids' in (select prosrc from pg_proc where oid='public.edit_event_with_tasks_step12(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure))>0),
 ('Create Event body omits Completed',position('''Completed''' in (select prosrc from pg_proc where oid='public.create_event_with_tasks_step12(text,text,date,date,text,jsonb)'::regprocedure))=0),
 ('Edit Event insert omits status',position('status,' in substring((select lower(prosrc) from pg_proc where oid='public.edit_event_with_tasks_step12_pre13b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure) from position('insert into public.tasks' in (select lower(prosrc) from pg_proc where oid='public.edit_event_with_tasks_step12_pre13b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure)) for 500))=0),
 ('Batch 11 add derives To Do',position('status' in substring((select lower(prosrc) from pg_proc where oid='public.create_active_event_task_step12(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure) from position('insert into public.tasks' in (select lower(prosrc) from pg_proc where oid='public.create_active_event_task_step12(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure)) for 500))=0),
 ('move wrapper checks completion before old body',position('task_phase_is_complete' in (select prosrc from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure))<position('move_task_pre13b' in (select prosrc from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure)))
)
insert into public._13b_c_results select 19+row_number() over()::integer,label,passed from checks;
with writers(name) as (values('create_event_with_tasks'),('edit_event_with_tasks'),('create_active_event_task'),('edit_active_event_task'),('create_event_from_archived_template'),('move_task'),('set_task_dependency'),('set_task_confidentiality'),('assign_task_people'),('delete_task'),('unassign_self'),('claim_task'),('set_task_backup_request'),('accept_task_volunteer'),('resolve_task_leave_request'),('volunteer_for_task'),('prepare_unassigned_task_reset'),('guard_event_updates'),('copy_archived_template_tasks'),('edit_event_with_tasks_step12_pre13b'))
insert into public._13b_c_results select 29+row_number() over(order by name)::integer,'writer inventoried '||name,exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname=writers.name and n.nspname in('public','ceit_connect_private')) from writers;
set constraints all immediate;
do $$ begin if (select count(*) from public._13b_c_results)<>52 or exists(select 1 from public._13b_c_results where not passed) then raise exception 'STEP 13B C FAIL'; end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from public._13b_c_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B C 52/52 PASS'; end $$;
rollback;
```

## Paste D — child writers and automatic side effects

Expected result lines: **54**, followed by `TEST RESULTS: STEP 13B D 54/54 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create table public._13b_d_results(n integer primary key,label text,passed boolean not null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13bd0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13b-d@example.test',crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.users(id,email,full_name,role,is_active) values('13bd0000-0000-4000-8000-000000000001','step13b-d@example.test','13B D Admin','Admin',true);
insert into public.committees(id,name) values('13bd1000-0000-4000-8000-000000000001','13D Committee');
insert into public.events(id,name,start_date,end_date,status,created_by) values('13bd2000-0000-4000-8000-000000000001','13D Event','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000001');
insert into public.tasks(id,event_id,committee_id,title,phase,status) values('13bd3000-0000-4000-8000-000000000001','13bd2000-0000-4000-8000-000000000001','13bd1000-0000-4000-8000-000000000001','13D child fixture','Child phase','To Do');
insert into public.events(id,name,start_date,end_date,status,created_by) values
('13bd2000-0000-4000-8000-000000000002','13D Draft delete event','2026-11-01','2026-11-02','Draft','13bd0000-0000-4000-8000-000000000001'),
('13bd2000-0000-4000-8000-000000000003','13D Active delete event','2026-11-01','2026-11-02','Active','13bd0000-0000-4000-8000-000000000001');
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,primary_assignees) values
('13bd3000-0000-4000-8000-000000000101','13bd2000-0000-4000-8000-000000000002','13bd1000-0000-4000-8000-000000000001','Draft delete_task target','Delete phase','To Do',array['13bd0000-0000-4000-8000-000000000001'::uuid]),
('13bd3000-0000-4000-8000-000000000102','13bd2000-0000-4000-8000-000000000002','13bd1000-0000-4000-8000-000000000001','Draft Edit target','Delete phase','To Do',array['13bd0000-0000-4000-8000-000000000001'::uuid]),
('13bd3000-0000-4000-8000-000000000103','13bd2000-0000-4000-8000-000000000002','13bd1000-0000-4000-8000-000000000001','Draft keeper','Delete phase','To Do','{}'),
('13bd3000-0000-4000-8000-000000000104','13bd2000-0000-4000-8000-000000000003','13bd1000-0000-4000-8000-000000000001','Active delete_task target','Delete phase','To Do',array['13bd0000-0000-4000-8000-000000000001'::uuid]),
('13bd3000-0000-4000-8000-000000000105','13bd2000-0000-4000-8000-000000000003','13bd1000-0000-4000-8000-000000000001','Active Edit target','Delete phase','To Do',array['13bd0000-0000-4000-8000-000000000001'::uuid]),
('13bd3000-0000-4000-8000-000000000106','13bd2000-0000-4000-8000-000000000003','13bd1000-0000-4000-8000-000000000001','Active keeper','Delete phase','To Do','{}');
select set_config('ceit_connect.task_assignee_writer','',true);
alter table public.task_work_links disable trigger user;
alter table public.task_comments disable trigger user;
alter table public.task_volunteers disable trigger user;
alter table public.task_leave_requests disable trigger user;
with targets(id) as (values
 ('13bd3000-0000-4000-8000-000000000101'::uuid),('13bd3000-0000-4000-8000-000000000102'::uuid),
 ('13bd3000-0000-4000-8000-000000000104'::uuid),('13bd3000-0000-4000-8000-000000000105'::uuid)
)
insert into public.task_work_links(task_id,name,url,created_by)
select id,'Delete fixture','https://drive.google.com/file/d/'||replace(id::text,'-','')||'/view','13bd0000-0000-4000-8000-000000000001' from targets;
with targets(id) as (values
 ('13bd3000-0000-4000-8000-000000000101'::uuid),('13bd3000-0000-4000-8000-000000000102'::uuid),
 ('13bd3000-0000-4000-8000-000000000104'::uuid),('13bd3000-0000-4000-8000-000000000105'::uuid)
)
insert into public.task_comments(task_id,created_by,body) select id,'13bd0000-0000-4000-8000-000000000001','Delete fixture' from targets;
with targets(id) as (values
 ('13bd3000-0000-4000-8000-000000000101'::uuid),('13bd3000-0000-4000-8000-000000000102'::uuid),
 ('13bd3000-0000-4000-8000-000000000104'::uuid),('13bd3000-0000-4000-8000-000000000105'::uuid)
)
insert into public.task_volunteers(task_id,user_id) select id,'13bd0000-0000-4000-8000-000000000001' from targets;
with targets(id) as (values
 ('13bd3000-0000-4000-8000-000000000101'::uuid),('13bd3000-0000-4000-8000-000000000102'::uuid),
 ('13bd3000-0000-4000-8000-000000000104'::uuid),('13bd3000-0000-4000-8000-000000000105'::uuid)
)
insert into public.task_leave_requests(task_id,requester_id) select id,'13bd0000-0000-4000-8000-000000000001' from targets;
alter table public.task_work_links enable trigger user;
alter table public.task_comments enable trigger user;
alter table public.task_volunteers enable trigger user;
alter table public.task_leave_requests enable trigger user;
select set_config('request.jwt.claims','{"sub":"13bd0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
 perform * from public.delete_task('13bd3000-0000-4000-8000-000000000101');
 perform public.edit_event_with_tasks('13bd2000-0000-4000-8000-000000000002',(select updated_at from public.events where id='13bd2000-0000-4000-8000-000000000002'),'13D Draft delete event',null,'2026-11-01','2026-11-02','Draft','[]','[]',array['13bd3000-0000-4000-8000-000000000102'::uuid],'[]');
 perform * from public.delete_task('13bd3000-0000-4000-8000-000000000104');
 perform public.edit_event_with_tasks('13bd2000-0000-4000-8000-000000000003',(select updated_at from public.events where id='13bd2000-0000-4000-8000-000000000003'),'13D Active delete event',null,'2026-11-01','2026-11-02','Active','[]','[]',array['13bd3000-0000-4000-8000-000000000105'::uuid],'[]');
end $$;
with tables(name,attached) as (values
 ('task_work_links',true),('task_comments',true),('task_volunteers',true),('task_leave_requests',true),('archived_task_viewers',false)
), ops(op) as (values('INSERT'),('UPDATE'),('DELETE')),
matrix as (
 select row_number() over(order by name,op)::integer n,name||' '||op label,
  case when attached then exists(select 1 from pg_trigger where tgrelid=('public.'||name)::regclass and tgname=name||'_a0_guard_completed_phase_writes')
       else not exists(select 1 from pg_trigger where tgrelid=('public.'||name)::regclass and tgname like '%completed_phase%') end passed
 from tables cross join ops
)
insert into public._13b_d_results select * from matrix;
with checks(label,passed) as (values
 ('child locks task first',position('for no key update' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('child locks event second',position('for share' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>position('for no key update' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))),
 ('child phase lock follows event',position('try_task_phase_lock' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>position('for share' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))),
 ('child lock is shared',position('try_task_phase_lock(v_event_id, v_phase, false)' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('child takes no event advisory',position('task_dependency_lock_key' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))=0),
 ('leave cleanup context RLS',(select relrowsecurity from pg_class where oid='ceit_connect_private.task_leave_cleanup_context'::regclass)),
 ('Reopen context RLS',(select relrowsecurity from pg_class where oid='ceit_connect_private.completed_phase_reopen_context'::regclass)),
 ('browser has no leave context access',not has_table_privilege('authenticated','ceit_connect_private.task_leave_cleanup_context','SELECT,INSERT,UPDATE,DELETE')),
 ('browser has no Reopen context access',not has_table_privilege('authenticated','ceit_connect_private.completed_phase_reopen_context','SELECT,INSERT,UPDATE,DELETE')),
 ('stale cleanup checks cancellable pending row before context',position('if not exists' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))<position('insert into ceit_connect_private.task_leave_cleanup_context' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))),
 ('event cleanup creates exact context',position('task_leave_cleanup_context' in (select prosrc from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))>0),
 ('cleanup exception is update-only',position('TG_OP = ''UPDATE''' in (select prosrc from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('task completion stale reason retained',position('task_completed' in (select prosrc from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))>0),
 ('assignment stale reason retained',position('no_longer_assigned' in (select prosrc from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))>0),
 ('event inactive stale reason retained',position('event_inactive' in (select prosrc from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))>0)
)
insert into public._13b_d_results select 15+row_number() over()::integer,label,passed from checks;
with checks(label,passed) as (values
 ('task activity trigger remains enabled',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_activity_log' and tgenabled='O')),
 ('stale leave trigger remains enabled',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_cancel_stale_leave_requests' and tgenabled='O')),
 ('stale cleanup only updates leave requests',position('update public.task_leave_requests' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))>0 and position('update public.task_volunteers' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))=0),
 ('stale context inserted before cleanup',position('insert into ceit_connect_private.task_leave_cleanup_context' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))<position('update public.task_leave_requests' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))),
 ('stale context removed after cleanup',position('delete from ceit_connect_private.task_leave_cleanup_context' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))>position('update public.task_leave_requests' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))),
 ('stale context exception cleanup exists',position('exception when others' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))>0),
 ('event cleanup only updates leave requests',position('update public.task_leave_requests' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))>0 and position('update public.task_volunteers' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))=0),
 ('event context inserted before cleanup',position('insert into ceit_connect_private.task_leave_cleanup_context' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))<position('update public.task_leave_requests' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))),
 ('event context removed after cleanup',position('delete from ceit_connect_private.task_leave_cleanup_context' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))>position('update public.task_leave_requests' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))),
 ('event context exception cleanup exists',position('exception when others' in (select lower(prosrc) from pg_proc where oid='public.cancel_inactive_event_leave_requests()'::regprocedure))>0),
 ('completion has no volunteer side-effect trigger',not exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal and lower(pg_get_triggerdef(oid)) like '%task_volunteers%')),
 ('completion has no work-link side-effect trigger',not exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal and lower(pg_get_triggerdef(oid)) like '%task_work_links%')),
 ('completion has no comment side-effect trigger',not exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal and lower(pg_get_triggerdef(oid)) like '%task_comments%')),
 ('completion has no archive-viewer side effect',not exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal and lower(pg_get_triggerdef(oid)) like '%archived_task_viewers%')),
 ('completion has no notification side-effect trigger',not exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and not tgisinternal and lower(pg_get_triggerdef(oid)) like '%notifications%')),
 ('stale cleanup does not clear backup request',position('request_backup' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))=0),
 ('stale cleanup does not change dependency',position('depends_on_task_id' in (select lower(prosrc) from pg_proc where oid='public.cancel_stale_task_leave_requests()'::regprocedure))=0),
 ('child guard rejects normal completed writes',position('CCQ01' in (select prosrc from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('cleanup exception is exact pending to cancelled',position('old.status = ''pending''' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0 and position('new.status = ''cancelled''' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('cleanup exception preserves identity fields',position('new.requester_id is not distinct from old.requester_id' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0)
)
insert into public._13b_d_results select 30+row_number() over()::integer,label,passed from checks;
with cases(task_id,label) as (values
 ('13bd3000-0000-4000-8000-000000000101'::uuid,'Draft delete_task cascades all children'),
 ('13bd3000-0000-4000-8000-000000000102'::uuid,'Draft Edit Event deletion cascades all children'),
 ('13bd3000-0000-4000-8000-000000000104'::uuid,'Active delete_task cascades all children'),
 ('13bd3000-0000-4000-8000-000000000105'::uuid,'Active Edit Event deletion cascades all children')
)
insert into public._13b_d_results
select 50+row_number() over(order by task_id)::integer,label,
 not exists(select 1 from public.tasks where id=task_id)
 and not exists(select 1 from public.task_work_links where task_work_links.task_id=cases.task_id)
 and not exists(select 1 from public.task_comments where task_comments.task_id=cases.task_id)
 and not exists(select 1 from public.task_volunteers where task_volunteers.task_id=cases.task_id)
 and not exists(select 1 from public.task_leave_requests where task_leave_requests.task_id=cases.task_id)
from cases;
set constraints all immediate;
do $$ declare bad text; begin select string_agg(n||' '||label,', ' order by n) into bad from public._13b_d_results where not passed; if (select count(*) from public._13b_d_results)<>54 or bad is not null then raise exception 'STEP 13B D FAIL: %',coalesce(bad,'wrong result count'); end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from public._13b_d_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B D 54/54 PASS'; end $$;
rollback;
```

## Paste E — Reopen authority, masking, exact version, and activity

Expected result lines: **46**, followed by `TEST RESULTS: STEP 13B E 46/46 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create table public._13b_e_results(n integer primary key,label text,passed boolean not null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now()
from (values('13be0000-0000-4000-8000-000000000001'::uuid,'step13b-e-admin@example.test'),('13be0000-0000-4000-8000-000000000002'::uuid,'step13b-e-owner@example.test'),('13be0000-0000-4000-8000-000000000003'::uuid,'step13b-e-other@example.test')) v(id,email);
insert into public.committees(id,name) values('13be1000-0000-4000-8000-000000000001','13E Owner Committee'),('13be1000-0000-4000-8000-000000000002','13E Other Committee');
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('13be0000-0000-4000-8000-000000000001','step13b-e-admin@example.test','13B E Admin','Admin',null,true),
('13be0000-0000-4000-8000-000000000002','step13b-e-owner@example.test','13B E Owner','Co-Admin','13be1000-0000-4000-8000-000000000001',true),
('13be0000-0000-4000-8000-000000000003','step13b-e-other@example.test','13B E Other','Co-Admin','13be1000-0000-4000-8000-000000000002',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values('13be2000-0000-4000-8000-000000000001','13E Reopen Event','2026-11-01','2026-11-02','Active','13be0000-0000-4000-8000-000000000002');
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,is_confidential) values
('13be3000-0000-4000-8000-000000000001','13be2000-0000-4000-8000-000000000001','13be1000-0000-4000-8000-000000000002','13E masked confidential fixture','Reopen phase','To Do',true),
('13be3000-0000-4000-8000-000000000002','13be2000-0000-4000-8000-000000000001','13be1000-0000-4000-8000-000000000002','13E completed dependent','Reopen phase','To Do',false);
select set_config('ceit_connect.task_access_writer','',true);
do $$ begin
 perform set_config('request.jwt.claims','{"sub":"13be0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 perform * from public.set_task_dependency('13be3000-0000-4000-8000-000000000002','13be3000-0000-4000-8000-000000000001');
end $$;
update public.tasks set status='Completed' where id='13be3000-0000-4000-8000-000000000001';
update public.tasks set status='Completed' where id='13be3000-0000-4000-8000-000000000002';
create table public._13b_e_behavior(label text primary key,passed boolean not null);
do $$ declare denied boolean:=false; before_count bigint; reopened record; begin
 perform set_config('request.jwt.claims','{"sub":"13be0000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 begin perform * from public.reopen_completed_phase_task('13be3000-0000-4000-8000-000000000001',(select updated_at from public.tasks where id='13be3000-0000-4000-8000-000000000001')); exception when sqlstate 'CCQ03' then denied:=true; end;
 insert into public._13b_e_behavior values('masked owner denied',denied);
 perform set_config('request.jwt.claims','{"sub":"13be0000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 denied:=false;
 begin perform * from public.reopen_completed_phase_task('13be3000-0000-4000-8000-000000000001',(select updated_at from public.tasks where id='13be3000-0000-4000-8000-000000000001')); exception when sqlstate 'CCQ03' then denied:=true; end;
 insert into public._13b_e_behavior values('other Co-Admin denied',denied);
 perform set_config('request.jwt.claims','{"sub":"13be0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 denied:=false;
 begin perform * from public.reopen_completed_phase_task('13be3000-0000-4000-8000-000000000001',(select updated_at-'1 microsecond'::interval from public.tasks where id='13be3000-0000-4000-8000-000000000001')); exception when sqlstate 'CCQ05' then denied:=true; end;
 insert into public._13b_e_behavior values('stale exact timestamp denied',denied);
 select count(*) into before_count from public.activity_log where task_id='13be3000-0000-4000-8000-000000000001';
 select * into reopened from public.reopen_completed_phase_task('13be3000-0000-4000-8000-000000000001',(select updated_at from public.tasks where id='13be3000-0000-4000-8000-000000000001'));
 insert into public._13b_e_behavior values
 ('Admin exact reopen returns contract',reopened.task_id='13be3000-0000-4000-8000-000000000001' and reopened.status='In Progress' and reopened.sort_order is not null and reopened.phase_key='Reopen phase' and reopened.phase_complete=false),
 ('Reopen logs exactly one activity',(select count(*)=before_count+1 from public.activity_log where task_id='13be3000-0000-4000-8000-000000000001')),
 ('Completed dependent remains Completed',(select status='Completed' and depends_on_task_id='13be3000-0000-4000-8000-000000000001' from public.tasks where id='13be3000-0000-4000-8000-000000000002'));
end $$;
with checks(label,passed) as (values
 ('one Reopen signature',(select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='reopen_completed_phase_task')),
 ('return task_id uuid',(select pg_get_function_result('public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure) like '%task_id uuid%')),
 ('return status text',(select pg_get_function_result('public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure) like '%status text%')),
 ('return sort_order bigint',(select pg_get_function_result('public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure) like '%sort_order bigint%')),
 ('return phase key',(select pg_get_function_result('public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure) like '%phase_key text%')),
 ('return completion boolean',(select pg_get_function_result('public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure) like '%phase_complete boolean%')),
 ('authenticated execute',has_function_privilege('authenticated','public.reopen_completed_phase_task(uuid,timestamptz)','EXECUTE')),
 ('anon denied',not has_function_privilege('anon','public.reopen_completed_phase_task(uuid,timestamptz)','EXECUTE')),
 ('service role denied',not has_function_privilege('service_role','public.reopen_completed_phase_task(uuid,timestamptz)','EXECUTE')),
 ('active profile before task lookup',position('from public.users' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))<position('from public.tasks' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))),
 ('masked event-creator Co-Admin refused',(select passed from public._13b_e_behavior where label='masked owner denied')),
 ('other Co-Admin refused',(select passed from public._13b_e_behavior where label='other Co-Admin denied')),
 ('stale exact timestamp refused',(select passed from public._13b_e_behavior where label='stale exact timestamp denied')),
 ('no timestamp text conversion',position('p_expected_updated_at::text' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))=0),
 ('Archived rejected',position('archived tasks cannot be reopened' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))>0),
 ('requires Completed target',position('only a completed task' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))>0),
 ('requires complete phase',position('phase is no longer complete' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))>0),
 ('Admin exact Reopen return contract',(select passed from public._13b_e_behavior where label='Admin exact reopen returns contract')),
 ('private context inserted',position('insert into ceit_connect_private.completed_phase_reopen_context' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))>0),
 ('private context success cleanup',position('delete from ceit_connect_private.completed_phase_reopen_context' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))>0),
 ('context tied to transaction',position('pg_current_xact_id' in (select lower(prosrc) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))>0),
 ('Reopen logs exactly one activity',(select passed from public._13b_e_behavior where label='Reopen logs exactly one activity')),
 ('one guarded UPDATE',(select (length(lower(prosrc))-length(replace(lower(prosrc),'update public.tasks','')))/length('update public.tasks')=1 from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))
)
insert into public._13b_e_results select row_number() over()::integer,label,passed from checks;
with body as (
 select lower(regexp_replace(prosrc,'\s+',' ','g')) src
 from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure
), checks(label,passed) as (values
 ('active user required',(select position('user_row.is_active is true' in src)>0 from body)),
 ('only Admin or Co-Admin admitted',(select position('v_role not in (''admin'', ''co-admin'')' in src)>0 from body)),
 ('generic denial precedes task discovery',(select position('this task cannot be reopened' in src)<position('from public.tasks as task_row' in src) from body)),
 ('event row locked before event advisory',(select position('for share' in src)<position('task_dependency_lock_key' in src) from body)),
 ('event advisory locked before phase',(select position('task_dependency_lock_key' in src)<position('task_phase_lock_key' in src) from body)),
 ('phase locked before task row',(select position('task_phase_lock_key' in src)<position('for update' in src) from body)),
 ('task identity revalidated after lock',(select position('public.canonical_task_phase(v_phase) is distinct from v_phase_key' in src)>position('for update' in src) from body)),
 ('event status revalidated after task lock',(select length(src)-length(replace(src,'from public.events as event_row',''))=2*length('from public.events as event_row') from body)),
 ('shared helper owns Co-Admin event ownership',(select position('event_row.created_by = user_row.id' in lower(prosrc))>0 from pg_proc where oid='ceit_connect_private.completed_phase_reopen_actor_allowed(uuid,uuid,boolean)'::regprocedure)),
 ('shared helper denies masked content',(select position('task_content_access_for_user(task_row.id, user_row.id) = ''real''' in lower(prosrc))>0 from pg_proc where oid='ceit_connect_private.completed_phase_reopen_actor_allowed(uuid,uuid,boolean)'::regprocedure)),
 ('shared helper aligns Admin with real content',(select position('user_row.role = ''admin''' in lower(prosrc))>0 and position('task_content_access_for_user(task_row.id, user_row.id) = ''real''' in lower(prosrc))>0 from pg_proc where oid='ceit_connect_private.completed_phase_reopen_actor_allowed(uuid,uuid,boolean)'::regprocedure)),
 ('exact timestamp checked after authority',(select position('v_updated_at is distinct from p_expected_updated_at' in src)>position('completed_phase_reopen_actor_allowed' in src) from body)),
 ('exact timestamp reused in guarded update',(select position('task_row.updated_at = p_expected_updated_at' in src)>0 from body)),
 ('timestamp never rounded',(select position('date_trunc' in src)=0 and position('extract(epoch' in src)=0 from body)),
 ('complete phase checked under exclusive lock',(select position('task_phase_is_complete(v_event_id, v_phase_key)' in src)>position('task_phase_lock_key' in src) from body)),
 ('Reopen context precedes task update',(select position('insert into ceit_connect_private.completed_phase_reopen_context' in src)<position('update public.tasks as task_row' in src) from body)),
 ('Reopen update is Completed to In Progress',(select position('set status = ''in progress''' in src)>0 and position('task_row.status = ''completed''' in src)>0 from body)),
 ('Reopen reuses lane-tail helper and 1024 gap',(select position('task_lane_tail_sort_order' in src)>0 and position('1024::bigint' in src)>0 from body)),
 ('Reopen context removed on success',(select position('delete from ceit_connect_private.completed_phase_reopen_context' in src)>position('update public.tasks as task_row' in src) from body)),
 ('Reopen context removed on exception',(select position('exception when others' in src)>0 from body)),
 ('phase rechecked open after update',(select length(src)-length(replace(src,'task_phase_is_complete(v_event_id, v_phase_key)',''))=2*length('task_phase_is_complete(v_event_id, v_phase_key)') from body)),
 ('return reads persisted task row',(select position('from public.tasks as task_row' in substring(src from position('return query' in src)))>0 from body)),
 ('Reopen does not auto-revert Completed dependents',(select passed from public._13b_e_behavior where label='Completed dependent remains Completed'))
)
insert into public._13b_e_results select 23+row_number() over()::integer,label,passed from checks;
set constraints all immediate;
do $$ declare bad text; begin select string_agg(n||' '||label,', ' order by n) into bad from public._13b_e_results where not passed; if (select count(*) from public._13b_e_results)<>46 or bad is not null then raise exception 'STEP 13B E FAIL: %',coalesce(bad,'wrong result count'); end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from public._13b_e_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B E 46/46 PASS'; end $$;
rollback;
```

## Paste F — lock-order proof, sequential losers, forgery, and deletion

Expected result lines: **38**, followed by `TEST RESULTS: STEP 13B F 38/38 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create table public._13b_f_results(n integer primary key,label text,passed boolean not null);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13bf0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13b-f@example.test',crypt('Step13b-test-1!',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.users(id,email,full_name,role,is_active) values('13bf0000-0000-4000-8000-000000000001','step13b-f@example.test','13B F Admin','Admin',true);
insert into public.committees(id,name) values('13bf1000-0000-4000-8000-000000000001','13F Committee');
insert into public.events(id,name,start_date,end_date,status,created_by) values('13bf2000-0000-4000-8000-000000000001','13F Lock Event','2026-11-01','2026-11-02','Active','13bf0000-0000-4000-8000-000000000001');
insert into public.tasks(id,event_id,committee_id,title,phase,status) values('13bf3000-0000-4000-8000-000000000001','13bf2000-0000-4000-8000-000000000001','13bf1000-0000-4000-8000-000000000001','13F lock fixture','Lock phase','To Do');
with body(name,src) as (values
 ('task guard',(select lower(regexp_replace(prosrc,'\s+',' ','g')) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure)),
 ('child guard',(select lower(regexp_replace(prosrc,'\s+',' ','g')) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure)),
 ('move',(select lower(regexp_replace(prosrc,'\s+',' ','g')) from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure)),
 ('reopen',(select lower(regexp_replace(prosrc,'\s+',' ','g')) from pg_proc where oid='public.reopen_completed_phase_task(uuid,timestamptz)'::regprocedure))
), checks(label,passed) as (values
 ('task guard uses event try before phase',(select position('try_task_event_advisory_lock' in src)<position('try_task_phase_lock' in src) from body where name='task guard')),
 ('task guard never blocking-locks phase',(select position('pg_advisory_xact_lock(' in src)=0 from body where name='task guard')),
 ('child task row precedes event',(select position('for no key update' in src)<position('for share' in src) from body where name='child guard')),
 ('child event precedes phase',(select position('for share' in src)<position('try_task_phase_lock' in src) from body where name='child guard')),
 ('child has no later event advisory',(select position('task_dependency_lock_key' in src)=0 from body where name='child guard')),
 ('move event lock precedes event advisory',(select position('for share' in src)<position('task_dependency_lock_key' in src) from body where name='move')),
 ('move event advisory precedes phase',(select position('task_dependency_lock_key' in src)<position('task_phase_lock_key' in src) from body where name='move')),
 ('move phase precedes old task-locking body',(select position('task_phase_lock_key' in src)<position('move_task_pre13b' in src) from body where name='move')),
 ('Reopen event precedes advisory',(select position('for share' in src)<position('task_dependency_lock_key' in src) from body where name='reopen')),
 ('Reopen advisory precedes phase',(select position('task_dependency_lock_key' in src)<position('task_phase_lock_key' in src) from body where name='reopen')),
 ('Reopen phase precedes task row',(select position('task_phase_lock_key' in src)<position('for update' in src) from body where name='reopen')),
 ('Reopen context exact task',position('context_row.task_id = old.id' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('Reopen context exact event',position('context_row.event_id = old.event_id' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('Reopen context exact phase',position('context_row.phase_key = public.canonical_task_phase(old.phase)' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('Reopen exact status transition',position('old.status = ''completed''' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0 and position('new.status = ''in progress''' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('ordinary caller cannot write Reopen context',not has_table_privilege('authenticated','ceit_connect_private.completed_phase_reopen_context','INSERT')),
 ('ordinary caller cannot write cleanup context',not has_table_privilege('authenticated','ceit_connect_private.task_leave_cleanup_context','INSERT')),
 ('event cascade exact task bypass',position('event_delete_context_matches(old.event_id)' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('child cascade requires transaction context',position('event_delete_cascade_context' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('archive guard trigger sorts before completion guard',(select a.tgname<c.tgname from pg_trigger a cross join pg_trigger c where a.tgrelid='public.tasks'::regclass and c.tgrelid=a.tgrelid and a.tgname='tasks_guard_archived_event_writes' and c.tgname='tasks_h0_guard_completed_phase_writes'))
)
insert into public._13b_f_results select row_number() over()::integer,label,passed from checks;
with checks(label,passed) as (values
 ('archive task guard uses event NOWAIT',position('for share nowait' in (select lower(prosrc) from pg_proc where oid='public.guard_archived_event_task_writes()'::regprocedure))>0),
 ('archive task guard maps lock conflict to 40001',position('lock_not_available' in (select lower(prosrc) from pg_proc where oid='public.guard_archived_event_task_writes()'::regprocedure))>0 and position('40001' in (select prosrc from pg_proc where oid='public.guard_archived_event_task_writes()'::regprocedure))>0),
 ('child event row uses NOWAIT',position('for share nowait' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('child event conflict maps to 40001',position('lock_not_available' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0 and position('40001' in (select prosrc from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('move authorizes after task row and before completion',position('v_caller_role = ''Admin''' in (select prosrc from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure))>position('for update' in (select lower(prosrc) from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure)) and position('v_caller_role = ''Admin''' in (select prosrc from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure))<position('task_phase_is_complete' in (select prosrc from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure))),
 ('move stale check precedes completion',position('v_phase is distinct from p_expected_phase' in (select lower(prosrc) from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure))<position('task_phase_is_complete' in (select lower(prosrc) from pg_proc where oid='public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure))),
 ('move old body is private',not has_function_privilege('authenticated','public.move_task_pre13b(uuid,text,text,text,uuid,uuid)','EXECUTE')),
 ('old Edit Event body is private',not has_function_privilege('authenticated','public.edit_event_with_tasks_step12_pre13b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])','EXECUTE')),
 ('Reopen exception table has no policies',not exists(select 1 from pg_policy where polrelid='ceit_connect_private.completed_phase_reopen_context'::regclass)),
 ('cleanup exception table has no policies',not exists(select 1 from pg_policy where polrelid='ceit_connect_private.task_leave_cleanup_context'::regclass)),
 ('Reopen context exact transaction primary key',(select indisprimary from pg_index where indrelid='ceit_connect_private.completed_phase_reopen_context'::regclass)),
 ('cleanup context exact transaction and reason key',(select indisprimary and indnkeyatts=2 from pg_index where indrelid='ceit_connect_private.task_leave_cleanup_context'::regclass)),
 ('task deletion bypass calls exact 13d matcher',position('event_delete_context_matches(old.event_id)' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_task_writes()'::regprocedure))>0),
 ('archive deletion bypass calls exact 13d matcher',position('event_delete_context_matches(old.event_id)' in (select lower(prosrc) from pg_proc where oid='public.guard_archived_event_task_writes()'::regprocedure))>0),
 ('single-task child deletion requires exact private matcher',position('task_delete_context_matches(old.task_id)' in (select lower(prosrc) from pg_proc where oid='public.guard_completed_phase_child_writes()'::regprocedure))>0),
 ('single-task delete matcher requires current transaction and task',(select position('context_row.transaction_id = pg_catalog.pg_current_xact_id()' in lower(prosrc))>0 and position('context_row.task_id = p_task_id' in lower(prosrc))>0 from pg_proc where oid='ceit_connect_private.task_delete_context_matches(uuid)'::regprocedure)),
 ('shared phase helper exposes only try primitive',position('pg_try_advisory_xact_lock_shared' in (select lower(prosrc) from pg_proc where oid='public.try_task_phase_lock(uuid,text,boolean)'::regprocedure))>0 and position('pg_advisory_xact_lock_shared' in replace((select lower(prosrc) from pg_proc where oid='public.try_task_phase_lock(uuid,text,boolean)'::regprocedure),'pg_try_advisory_xact_lock_shared',''))=0),
 ('retry message is common across try paths',position('The phase changed while this request was being saved. Refresh and try again.' in (select prosrc from pg_proc where oid='public.try_task_event_advisory_lock(uuid)'::regprocedure))>0 and position('The phase changed while this request was being saved. Refresh and try again.' in (select prosrc from pg_proc where oid='public.try_task_phase_lock(uuid,text,boolean)'::regprocedure))>0)
)
insert into public._13b_f_results select 20+row_number() over()::integer,label,passed from checks;
set constraints all immediate;
do $$ declare bad text; begin select string_agg(n||' '||label,', ' order by n) into bad from public._13b_f_results where not passed; if (select count(*) from public._13b_f_results)<>38 or bad is not null then raise exception 'STEP 13B F FAIL: %',coalesce(bad,'wrong result count'); end if; end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from public._13b_f_results order by n;
do $$ begin raise exception 'TEST RESULTS: STEP 13B F 38/38 PASS'; end $$;
rollback;
```

## Owner-run manual concurrency notes

The catalog/body proofs above do not claim true two-session execution. For live Dev review, hold an ordinary shared phase lock in session A, start `move_task` in session B and confirm it waits before task rows, then release A and confirm B revalidates. Reverse the order by holding the exclusive phase lock in session A and invoking a comment/link/claim in B; B must return `40001` immediately rather than wait. Repeat with a raw task status update already holding its task row; its event-advisory or phase acquisition must fail fast.
