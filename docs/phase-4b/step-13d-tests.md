# Step 13d — Dev verification

Run each paste separately in the **Dev** SQL Editor with **Run without RLS** enabled. Never run these pastes in Prod. Each paste owns its Auth fixtures, impersonates application roles explicitly, rolls back through an intentional final exception, and prints one numbered result row per assertion. After the intentional exception, run `rollback;` if the editor leaves the transaction aborted.

## Paste A — role, boundary, locks, guards, and raw closure

Expected result lines: **64**, followed by `TEST RESULTS: STEP 13D A 64/64 PASS`.

```sql
begin;
set local timezone = 'Asia/Manila';

create temporary table _13d_a_results(n integer primary key, label text, passed boolean) on commit drop;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13da0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'step13d-a@example.test',crypt('Step13d-test-1!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token','step-13d-a'),now(),now());
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"13da0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
reset role;

with role_row as (
  select * from pg_roles where rolname='ceit_event_delete_executor'
), delete_proc as (
  select p.* from pg_proc p where p.oid='public.delete_event(uuid,uuid,timestamptz)'::regprocedure
), helper_body as (
  select lower(regexp_replace(prosrc,'\s+',' ','g')) body
  from pg_proc where oid='ceit_connect_private.perform_event_delete(uuid,timestamptz)'::regprocedure
), public_body as (
  select lower(regexp_replace(prosrc,'\s+',' ','g')) body
  from pg_proc where oid='public.delete_event(uuid,uuid,timestamptz)'::regprocedure
)
insert into _13d_a_results values
(1,'executor exists',exists(select 1 from role_row)),
(2,'executor NOLOGIN',not (select rolcanlogin from role_row)),
(3,'executor NOINHERIT',not (select rolinherit from role_row)),
(4,'executor NOSUPERUSER',not (select rolsuper from role_row)),
(5,'executor NOCREATEROLE',not (select rolcreaterole from role_row)),
(6,'executor NOCREATEDB',not (select rolcreatedb from role_row)),
(7,'executor NOREPLICATION and NOBYPASSRLS',not (select rolreplication or rolbypassrls from role_row)),
(8,'executor memberships match server version',case
  when (select count(*)=2 from pg_attribute where attrelid='pg_catalog.pg_auth_members'::regclass and attname in ('inherit_option','set_option') and not attisdropped)
  then (select count(*)=1 and count(*) filter(where roleid='ceit_event_delete_executor'::regrole and member='postgres'::regrole and admin_option is true and (to_jsonb(pg_auth_members)->>'inherit_option')::boolean is false and (to_jsonb(pg_auth_members)->>'set_option')::boolean is false)=1 from pg_auth_members where roleid='ceit_event_delete_executor'::regrole or member='ceit_event_delete_executor'::regrole)
  else not exists(select 1 from pg_auth_members where roleid='ceit_event_delete_executor'::regrole or member='ceit_event_delete_executor'::regrole)
end),
(9,'executor owns exactly one function',(select count(*)=1 from pg_proc where proowner='ceit_event_delete_executor'::regrole)),
(10,'executor owns delete_event',(select proowner='ceit_event_delete_executor'::regrole from delete_proc)),
(11,'delete_event has one signature',(select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_event')),
(12,'delete_event SECURITY DEFINER',(select prosecdef from delete_proc)),
(13,'delete_event VOLATILE',(select provolatile='v' from delete_proc)),
(14,'delete_event fixed empty path',(select proconfig=array['search_path=""'] from delete_proc)),
(15,'service_role executes delete_event',has_function_privilege('service_role','public.delete_event(uuid,uuid,timestamptz)','EXECUTE')),
(16,'PUBLIC cannot execute delete_event',not has_function_privilege('public','public.delete_event(uuid,uuid,timestamptz)','EXECUTE')),
(17,'anon cannot execute delete_event',not has_function_privilege('anon','public.delete_event(uuid,uuid,timestamptz)','EXECUTE')),
(18,'authenticated cannot execute delete_event',not has_function_privilege('authenticated','public.delete_event(uuid,uuid,timestamptz)','EXECUTE')),
(19,'events_delete policy removed',not exists(select 1 from pg_policies where schemaname='public' and tablename='events' and policyname='events_delete')),
(20,'authenticated lacks raw event DELETE',not has_table_privilege('authenticated','public.events','DELETE')),
(21,'service_role lacks raw event DELETE',not has_table_privilege('service_role','public.events','DELETE')),
(22,'context has RLS',(select relrowsecurity from pg_class where oid='ceit_connect_private.event_delete_cascade_context'::regclass)),
(23,'anon has no context privilege',not has_table_privilege('anon','ceit_connect_private.event_delete_cascade_context','SELECT,INSERT,DELETE')),
(24,'authenticated has no context privilege',not has_table_privilege('authenticated','ceit_connect_private.event_delete_cascade_context','SELECT,INSERT,DELETE')),
(25,'service_role has no context privilege',not has_table_privilege('service_role','ceit_connect_private.event_delete_cascade_context','SELECT,INSERT,DELETE')),
(26,'executor context privileges are exact',has_table_privilege('ceit_event_delete_executor','ceit_connect_private.event_delete_cascade_context','SELECT,INSERT,DELETE') and not has_table_privilege('ceit_event_delete_executor','ceit_connect_private.event_delete_cascade_context','UPDATE,TRUNCATE,REFERENCES,TRIGGER')),
(27,'context has exactly three executor policies',(select count(*)=3 from pg_policies where schemaname='ceit_connect_private' and tablename='event_delete_cascade_context')),
(28,'tasks event FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='tasks_event_id_fkey')),
(29,'dependency self FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='tasks_depends_on_task_id_fkey')),
(30,'work-link FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='task_work_links_task_id_fkey')),
(31,'volunteer FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='task_volunteers_task_id_fkey')),
(32,'comment FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='task_comments_task_id_fkey')),
(33,'archive-viewer FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='archived_task_viewers_task_id_fkey')),
(34,'notification FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='notifications_task_id_fkey')),
(35,'leave-request FK is inventoried',exists(select 1 from ceit_connect_private.event_delete_fk_lock_list where constraint_name='task_leave_requests_task_id_fkey')),
(36,'FK catalog exactly matches lock list',
  (select count(*) from pg_constraint where contype='f' and confrelid in ('public.events'::regclass,'public.tasks'::regclass))
  =(select count(*) from ceit_connect_private.event_delete_fk_lock_list)),
(37,'context uses transaction id',position('pg_current_xact_id' in (select prosrc from pg_proc where oid='ceit_connect_private.event_delete_context_matches(uuid)'::regprocedure))>0),
(38,'event guard requires context',position('event_delete_context_matches(old.id)' in (select prosrc from pg_proc where oid='public.guard_event_updates()'::regprocedure))>0),
(39,'task guard requires context',position('event_delete_context_matches(old.event_id)' in (select prosrc from pg_proc where oid='public.guard_archived_event_task_writes()'::regprocedure))>0),
(40,'dependency guard requires context',position('event_delete_context_matches(old.event_id)' in (select prosrc from pg_proc where oid='public.guard_referenced_prerequisite_deletion()'::regprocedure))>0),
(41,'work-link nested path requires context',position('event_delete_cascade_context' in (select prosrc from pg_proc where oid='public.guard_task_work_link_writes()'::regprocedure))>0),
(42,'comment nested path requires context',position('event_delete_cascade_context' in (select prosrc from pg_proc where oid='public.guard_task_comment_writes()'::regprocedure))>0),
(43,'volunteer nested path requires context',position('event_delete_cascade_context' in (select prosrc from pg_proc where oid='public.guard_task_volunteer_writes()'::regprocedure))>0),
(44,'archive-viewer nested path requires context',position('event_delete_cascade_context' in (select prosrc from pg_proc where oid='public.guard_archived_task_viewer_writes()'::regprocedure))>0),
(45,'deferred invariant requires context',position('event_delete_context_matches(v_event_id)' in (select prosrc from pg_proc where oid='public.enforce_active_event_has_tasks()'::regprocedure))>0),
(46,'DELETE activity stores old id',position('old.id' in (select prosrc from pg_proc where oid='public.log_task_activity()'::regprocedure))>0),
(47,'activity task FK alone is gone',not exists(select 1 from pg_constraint where conrelid='public.activity_log'::regclass and confrelid='public.tasks'::regclass)),
(48,'activity orphan lookup index exists',to_regclass('public.activity_log_task_id_idx') is not null),
(49,'activity reader has one signature',(select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_activity_log')),
(50,'reader checks old confidential snapshot',position('old'' -> ''is_confidential' in (select prosrc from pg_proc where oid='public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure))>0),
(51,'reader fails closed on invalid evidence',position('v_orphan_evidence_invalid' in (select prosrc from pg_proc where oid='public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure))>0),
(52,'cleanup ledger has RLS',(select relrowsecurity from pg_class where oid='public.event_storage_cleanup_jobs'::regclass)),
(53,'browser roles have zero ledger grants',not exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name='event_storage_cleanup_jobs' and grantee in ('PUBLIC','anon','authenticated','service_role'))),
(54,'service_role executes count',has_function_privilege('service_role','public.count_event_storage_cleanup_jobs()','EXECUTE')),
(55,'service_role executes claim',has_function_privilege('service_role','public.claim_event_storage_cleanup_job(uuid)','EXECUTE')),
(56,'service_role executes finalize',has_function_privilege('service_role','public.finalize_event_storage_cleanup_job(uuid,uuid,text,text)','EXECUTE')),
(57,'claim has one signature',(select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_event_storage_cleanup_job')),
(58,'finalize has one signature',(select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='finalize_event_storage_cleanup_job')),
(59,'event row precedes advisory',position('for update' in (select body from helper_body))<position('pg_advisory_xact_lock' in (select body from helper_body))),
(60,'advisory precedes descendant locks',position('pg_advisory_xact_lock' in (select body from helper_body))<position('lock_event_delete_descendants' in (select body from helper_body))),
(61,'descendant locks precede event delete',position('lock_event_delete_descendants' in (select body from helper_body))<position('delete from public.events' in (select body from helper_body))),
(62,'actor authorization precedes context',position('event_delete_actor_is_active_admin' in (select body from public_body))<position('insert into ceit_connect_private.event_delete_cascade_context' in (select body from public_body))),
(63,'executor has no users grant or policy',not has_table_privilege('ceit_event_delete_executor','public.users','SELECT,INSERT,UPDATE,DELETE') and not exists(select 1 from pg_policies where schemaname='public' and tablename='users' and 'ceit_event_delete_executor'=any(roles))),
(64,'executor has no CREATE on public schema',not has_schema_privilege('ceit_event_delete_executor','public','CREATE'));

do $$ declare v_bad text; begin
  select string_agg(n||' '||label,', ' order by n) into v_bad from _13d_a_results where not passed;
  if (select count(*) from _13d_a_results)<>64 or v_bad is not null then raise exception 'STEP 13D A FAIL: %',coalesce(v_bad,'wrong result count'); end if;
end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from _13d_a_results order by n;
do $$ begin
  raise exception 'TEST RESULTS: STEP 13D A 64/64 PASS';
end $$;
```

The body/catalog checks above replace fake single-session simulations of the 13e `FOR SHARE`, task-writer, child-writer, and two-claimer races. After this paste, rerun Step 13e unchanged; it must still print **72** result lines and missing/deleted templates must still return `CCT02` / `The Archived template is unavailable.`

## Paste B — deletion, cascades, and orphan activity

Expected result lines: **58**, followed by `TEST RESULTS: STEP 13D B 58/58 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create temporary table _13d_b_results(n integer primary key,label text,passed boolean) on commit drop;
grant select,insert on _13d_b_results to authenticated,service_role;

-- This paste owns five Auth identities. The profile-less identity deliberately
-- has no public.users row.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,crypt('Step13d-test-2!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token','step-13d-b'),now(),now()
from (values
 ('13db0000-0000-4000-8000-000000000001'::uuid,'step13d-b-admin@example.test'),
 ('13db0000-0000-4000-8000-000000000002'::uuid,'step13d-b-coadmin@example.test'),
 ('13db0000-0000-4000-8000-000000000003'::uuid,'step13d-b-member@example.test'),
 ('13db0000-0000-4000-8000-000000000004'::uuid,'step13d-b-inactive@example.test'),
 ('13db0000-0000-4000-8000-000000000005'::uuid,'step13d-b-profileless@example.test')) as fixture(id,email);

insert into public.committees(id,name)
values('13db0000-0000-4000-8000-00000000c001','ZZ Step 13d CoAdmin committee');

insert into public.users(id,email,full_name,role,committee_id,is_active)
select id,email,name,role,
  case when role='Admin' then null else '13db0000-0000-4000-8000-00000000c001'::uuid end,
  active
from (values
 ('13db0000-0000-4000-8000-000000000001'::uuid,'step13d-b-admin@example.test','13d Admin','Admin',true),
 ('13db0000-0000-4000-8000-000000000002'::uuid,'step13d-b-coadmin@example.test','13d CoAdmin','Co-Admin',true),
 ('13db0000-0000-4000-8000-000000000003'::uuid,'step13d-b-member@example.test','13d Member','Member',true),
 ('13db0000-0000-4000-8000-000000000004'::uuid,'step13d-b-inactive@example.test','13d Inactive','Admin',false)) as fixture(id,email,name,role,active);

select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('13db1000-0000-4000-8000-000000000001','13d Draft',date '2026-10-01',null,'Draft','13db0000-0000-4000-8000-000000000001'),
 ('13db1000-0000-4000-8000-000000000002','13d Archived',date '2025-10-01',date '2025-10-02','Active','13db0000-0000-4000-8000-000000000001'),
 ('13db1000-0000-4000-8000-000000000003','13d Active',date '2026-10-01',date '2026-10-02','Active','13db0000-0000-4000-8000-000000000001'),
 ('13db1000-0000-4000-8000-000000000004','13d Stale',date '2026-10-01',null,'Draft','13db0000-0000-4000-8000-000000000001');

select set_config('ceit_connect.task_assignee_writer','create_active_event_task',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(id,event_id,committee_id,title,status,primary_assignees,is_confidential,created_by,sort_order)
values
 ('13db2000-0000-4000-8000-000000000001','13db1000-0000-4000-8000-000000000002',(select id from committees order by name limit 1),'Public orphan','To Do',array['13db0000-0000-4000-8000-000000000002'::uuid],false,'13db0000-0000-4000-8000-000000000001',1024),
 ('13db2000-0000-4000-8000-000000000002','13db1000-0000-4000-8000-000000000002',(select id from committees order by name limit 1),'Ever confidential','To Do',array['13db0000-0000-4000-8000-000000000002'::uuid],true,'13db0000-0000-4000-8000-000000000001',2048),
 ('13db2000-0000-4000-8000-000000000003','13db1000-0000-4000-8000-000000000002',(select id from committees order by name limit 1),'Dependent','To Do','{}',false,'13db0000-0000-4000-8000-000000000001',3072),
 ('13db2000-0000-4000-8000-000000000004','13db1000-0000-4000-8000-000000000003',(select id from committees order by name limit 1),'Active keeper','To Do','{}',false,'13db0000-0000-4000-8000-000000000001',1024);
update public.tasks set depends_on_task_id='13db2000-0000-4000-8000-000000000001' where id='13db2000-0000-4000-8000-000000000003';
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','set_task_confidentiality',true);
update public.tasks set is_confidential=false where id='13db2000-0000-4000-8000-000000000002';
select set_config('ceit_connect.task_access_writer','',true);

select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into public.task_work_links(task_id,name,url,created_by) values('13db2000-0000-4000-8000-000000000001','Brief','https://drive.google.com/file/d/13dFixtureFile/view','13db0000-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.task_comments(task_id,created_by,body) values('13db2000-0000-4000-8000-000000000001','13db0000-0000-4000-8000-000000000001','13d comment');
insert into public.task_volunteers(task_id,user_id) values('13db2000-0000-4000-8000-000000000003','13db0000-0000-4000-8000-000000000003');
insert into public.notifications(user_id,type,task_id) values('13db0000-0000-4000-8000-000000000003','assignment','13db2000-0000-4000-8000-000000000001');
insert into public.task_leave_requests(task_id,requester_id) values('13db2000-0000-4000-8000-000000000001','13db0000-0000-4000-8000-000000000001');
update public.events set status='Archived' where id='13db1000-0000-4000-8000-000000000002';
insert into public.archived_task_viewers(task_id,user_id,granted_by) values('13db2000-0000-4000-8000-000000000002','13db0000-0000-4000-8000-000000000003','13db0000-0000-4000-8000-000000000001');

create temporary table _13d_versions as select id,updated_at from public.events;
grant select on _13d_versions to authenticated,service_role;

-- Browser raw DELETE and direct RPC are both denied.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ begin
  begin delete from public.events where id='13db1000-0000-4000-8000-000000000001'; insert into _13d_b_results values(1,'raw authenticated delete denied',false); exception when insufficient_privilege then insert into _13d_b_results values(1,'raw authenticated delete denied',true); end;
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000001','13db0000-0000-4000-8000-000000000001',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000001')); insert into _13d_b_results values(2,'authenticated execute denied',false); exception when insufficient_privilege then insert into _13d_b_results values(2,'authenticated execute denied',true); end;
end $$;
reset role;

set local role service_role;
do $$ begin
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000003','13db0000-0000-4000-8000-000000000001',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000003')); insert into _13d_b_results values(3,'Active rejected',false); exception when sqlstate 'CCE04' then insert into _13d_b_results values(3,'Active rejected',true); end;
  begin perform public.delete_event(gen_random_uuid(),'13db0000-0000-4000-8000-000000000001',now()); insert into _13d_b_results values(4,'unknown rejected',false); exception when sqlstate 'CCE03' then insert into _13d_b_results values(4,'unknown rejected',true); end;
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000004','13db0000-0000-4000-8000-000000000001',now()-interval '1 day'); insert into _13d_b_results values(5,'stale rejected',false); exception when sqlstate 'CCE05' then insert into _13d_b_results values(5,'stale rejected',true); end;
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000004','13db0000-0000-4000-8000-000000000002',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000004')); insert into _13d_b_results values(6,'Co-Admin actor rejected',false); exception when sqlstate 'CCE01' then insert into _13d_b_results values(6,'Co-Admin actor rejected',true); end;
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000004','13db0000-0000-4000-8000-000000000003',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000004')); insert into _13d_b_results values(7,'Member actor rejected',false); exception when sqlstate 'CCE01' then insert into _13d_b_results values(7,'Member actor rejected',true); end;
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000004','13db0000-0000-4000-8000-000000000004',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000004')); insert into _13d_b_results values(8,'inactive Admin rejected',false); exception when sqlstate 'CCE01' then insert into _13d_b_results values(8,'inactive Admin rejected',true); end;
  begin perform public.delete_event('13db1000-0000-4000-8000-000000000004','13db0000-0000-4000-8000-000000000005',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000004')); insert into _13d_b_results values(9,'profile-less actor rejected',false); exception when sqlstate 'CCE01' then insert into _13d_b_results values(9,'profile-less actor rejected',true); end;
end $$;
select * from public.delete_event('13db1000-0000-4000-8000-000000000001','13db0000-0000-4000-8000-000000000001',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000001'));
select * from public.delete_event('13db1000-0000-4000-8000-000000000002','13db0000-0000-4000-8000-000000000001',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000002'));
do $$ begin begin perform public.delete_event('13db1000-0000-4000-8000-000000000002','13db0000-0000-4000-8000-000000000001',(select updated_at from _13d_versions where id='13db1000-0000-4000-8000-000000000002')); insert into _13d_b_results values(10,'double submit safe',false); exception when sqlstate 'CCE03' then insert into _13d_b_results values(10,'double submit safe',true); end; end $$;
reset role;

create temporary table _13d_admin_activity as
select * from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) with no data;
create temporary table _13d_coadmin_activity (like _13d_admin_activity);
grant select,insert on _13d_admin_activity,_13d_coadmin_activity to authenticated;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into _13d_admin_activity select * from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20);
select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into _13d_coadmin_activity select * from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20);
select set_config('request.jwt.claims','{"sub":"13db0000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$ begin
  begin perform public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20); insert into _13d_b_results values(53,'Member gets no orphan history',false); exception when sqlstate 'CAL01' then insert into _13d_b_results values(53,'Member gets no orphan history',true); end;
  begin perform public.list_activity_log('13db2000-0000-4000-8000-000000000001','newest',null,null,null,null,null,null,null,20); insert into _13d_b_results values(54,'Member exact orphan lookup denied',false); exception when sqlstate 'CAL01' then insert into _13d_b_results values(54,'Member exact orphan lookup denied',true); end;
end $$;
reset role;

insert into _13d_b_results
select n,label,passed from (values
(11,'Draft deleted',not exists(select 1 from events where id='13db1000-0000-4000-8000-000000000001')),
(12,'Archived deleted',not exists(select 1 from events where id='13db1000-0000-4000-8000-000000000002')),
(13,'Active retained',exists(select 1 from events where id='13db1000-0000-4000-8000-000000000003')),
(14,'stale Draft retained',exists(select 1 from events where id='13db1000-0000-4000-8000-000000000004')),
(15,'event tasks removed',not exists(select 1 from tasks where event_id='13db1000-0000-4000-8000-000000000002')),
(16,'work links cascaded',not exists(select 1 from task_work_links where task_id='13db2000-0000-4000-8000-000000000001')),
(17,'comments cascaded',not exists(select 1 from task_comments where task_id='13db2000-0000-4000-8000-000000000001')),
(18,'volunteers cascaded',not exists(select 1 from task_volunteers where task_id='13db2000-0000-4000-8000-000000000003')),
(19,'archive viewers cascaded',not exists(select 1 from archived_task_viewers where task_id='13db2000-0000-4000-8000-000000000002')),
(20,'notifications cascaded',not exists(select 1 from notifications where task_id='13db2000-0000-4000-8000-000000000001')),
(21,'leave requests cascaded',not exists(select 1 from task_leave_requests where task_id='13db2000-0000-4000-8000-000000000001')),
(22,'dependency chain cascaded',not exists(select 1 from tasks where id='13db2000-0000-4000-8000-000000000003')),
(23,'public activity UUID retained',exists(select 1 from activity_log where task_id='13db2000-0000-4000-8000-000000000001')),
(24,'confidential activity UUID retained',exists(select 1 from activity_log where task_id='13db2000-0000-4000-8000-000000000002')),
(25,'DELETE row retains public UUID',exists(select 1 from activity_log where task_id='13db2000-0000-4000-8000-000000000001' and action='DELETE')),
(26,'DELETE actor retained',exists(select 1 from activity_log where task_id='13db2000-0000-4000-8000-000000000001' and action='DELETE' and user_id='13db0000-0000-4000-8000-000000000001')),
(27,'historical nulls allowed',exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='task_id' and is_nullable='YES')),
(28,'context cleared',not exists(select 1 from ceit_connect_private.event_delete_cascade_context)),
(29,'no banner jobs for bannerless Draft',(select count(*)=0 from event_storage_cleanup_jobs where event_id='13db1000-0000-4000-8000-000000000001')),
(30,'no banner jobs for bannerless Archive',(select count(*)=0 from event_storage_cleanup_jobs where event_id='13db1000-0000-4000-8000-000000000002')),
(31,'raw event trigger remains',exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='guard_event_updates' and not tgisinternal)),
(32,'task archive trigger remains',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_guard_archived_event_writes' and not tgisinternal)),
(33,'dependency trigger remains',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_guard_referenced_prerequisite_deletion' and not tgisinternal)),
(34,'activity trigger remains',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_activity_log' and not tgisinternal)),
(35,'deferred delete invariant remains',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_preserve_active_event_task_on_delete' and tgdeferrable)),
(36,'work-link guard remains',exists(select 1 from pg_trigger where tgrelid='public.task_work_links'::regclass and tgname='task_work_links_guard_writes')),
(37,'comment guard remains',exists(select 1 from pg_trigger where tgrelid='public.task_comments'::regclass and tgname='task_comments_guard_writes')),
(38,'volunteer guard remains',exists(select 1 from pg_trigger where tgrelid='public.task_volunteers'::regclass and tgname='task_volunteers_guard_writes')),
(39,'archive-viewer guard remains',exists(select 1 from pg_trigger where tgrelid='public.archived_task_viewers'::regclass and tgname='archived_task_viewers_guard_writes')),
(40,'event cleanup has no FK',not exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and contype='f')),
(41,'activity rows immutable to authenticated',not has_table_privilege('authenticated','public.activity_log','INSERT,UPDATE,DELETE,TRUNCATE')),
(42,'activity retention function unchanged',to_regprocedure('public.purge_activity_log()') is not null),
(43,'activity retention days unchanged',public.activity_log_retention_days()=30),
(44,'event policy count excludes delete',(select count(*)=3 from pg_policies where schemaname='public' and tablename='events')),
(45,'task policies unchanged',exists(select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_delete')),
(46,'13e writer remains one signature',(select count(*)=1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_event_from_archived_template')),
(47,'13e source lock remains',position('for share' in lower(pg_get_functiondef('public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)'::regprocedure)))>0),
(48,'13e fixed missing-template code remains',position('CCT02' in pg_get_functiondef('public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)'::regprocedure))>0),
(49,'Admin sees public orphan across committees',exists(select 1 from _13d_admin_activity where task_id='13db2000-0000-4000-8000-000000000001' and task_title='Public orphan' and not is_masked)),
(50,'Co-Admin sees public orphan across committees',exists(select 1 from _13d_coadmin_activity where task_id='13db2000-0000-4000-8000-000000000001' and task_title='Public orphan' and not is_masked)),
(51,'Admin never receives confidential orphan identity',not exists(select 1 from _13d_admin_activity where task_id='13db2000-0000-4000-8000-000000000002' or task_title='Ever confidential')),
(52,'Co-Admin never receives confidential orphan identity',not exists(select 1 from _13d_coadmin_activity where task_id='13db2000-0000-4000-8000-000000000002' or task_title='Ever confidential')),
(55,'orphan index is partial',position('WHERE (task_id IS NOT NULL)' in pg_get_indexdef('public.activity_log_task_id_idx'::regclass))>0),
(56,'cleanup unavailable output exists',position('out_cleanup_unavailable' in pg_get_function_result('public.delete_event(uuid,uuid,timestamptz)'::regprocedure))>0),
(57,'delete_event returns cleanup identity',position('out_cleanup_job_id' in pg_get_function_result('public.delete_event(uuid,uuid,timestamptz)'::regprocedure))>0),
(58,'event deletion is one-row RPC',(select count(*)=1 from pg_proc where oid='public.delete_event(uuid,uuid,timestamptz)'::regprocedure))
) as checks(n,label,passed);

do $$ declare v_bad text; begin
  select string_agg(n||' '||label,', ' order by n) into v_bad from _13d_b_results where not passed;
  if (select count(*) from _13d_b_results)<>58 or v_bad is not null then raise exception 'STEP 13D B FAIL: %',coalesce(v_bad,'wrong result count'); end if;
end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from _13d_b_results order by n;
do $$ begin
  raise exception 'TEST RESULTS: STEP 13D B 58/58 PASS';
end $$;
```

## Paste C — cleanup ledger, leases, and tokens

Expected result lines: **47**, followed by `TEST RESULTS: STEP 13D C 47/47 PASS`.

```sql
begin;
set local timezone='Asia/Manila';
create temporary table _13d_c_results(n integer primary key,label text,passed boolean) on commit drop;
grant select,insert on _13d_c_results to service_role;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('13dc0000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','step13d-c@example.test',crypt('Step13d-test-3!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token','step-13d-c'),now(),now());
select set_config('request.jwt.claims','{"sub":"13dc0000-0000-4000-8000-000000000001","role":"authenticated"}',true);

insert into public.event_storage_cleanup_jobs(id,event_id,bucket_id,object_path)
values
 ('13dc1000-0000-4000-8000-000000000001','13dc2000-0000-4000-8000-000000000001','banners','13dc2000-0000-4000-8000-000000000001/13dc3000-0000-4000-8000-000000000001.webp'),
 ('13dc1000-0000-4000-8000-000000000002','13dc2000-0000-4000-8000-000000000002','banners','13dc2000-0000-4000-8000-000000000002/13dc3000-0000-4000-8000-000000000002.webp'),
 ('13dc1000-0000-4000-8000-000000000003','13dc2000-0000-4000-8000-000000000003','banners','13dc2000-0000-4000-8000-000000000003/13dc3000-0000-4000-8000-000000000003.webp');

create temporary table _13d_claims(job_id uuid,event_id uuid,bucket text,path text,token uuid,expires timestamptz) on commit drop;
grant select,insert on _13d_claims to service_role;
set local role service_role;
insert into _13d_claims select * from public.claim_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000001');
insert into _13d_claims select * from public.claim_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000002');
reset role;

insert into _13d_c_results values
(1,'three jobs are retryable',public.count_event_storage_cleanup_jobs()=3),
(2,'first exact job claimed',exists(select 1 from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000001')),
(3,'second exact job claimed',exists(select 1 from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000002')),
(4,'claim token generated',(select token is not null from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000001')),
(5,'lease is five minutes',(select claim.expires between job.last_attempt_at+interval '4 minutes 59 seconds' and job.last_attempt_at+interval '5 minutes 1 second' from _13d_claims as claim join event_storage_cleanup_jobs as job on job.id=claim.job_id where claim.job_id='13dc1000-0000-4000-8000-000000000001')),
(6,'first attempt incremented',(select attempt_count=1 from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000001')),
(7,'second attempt incremented',(select attempt_count=1 from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000002')),
(8,'exact bucket returned',(select bucket='banners' from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000001')),
(9,'exact path returned',(select path='13dc2000-0000-4000-8000-000000000001/13dc3000-0000-4000-8000-000000000001.webp' from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000001'));

set local role service_role;
insert into _13d_c_results values(10,'unexpired claim cannot be reclaimed',not exists(select 1 from public.claim_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000001')));
insert into _13d_c_results values(11,'wrong token cannot finalize',not public.finalize_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000001',gen_random_uuid(),'done',null));
insert into _13d_c_results values(12,'current token finalizes done',public.finalize_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000001',(select token from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000001'),'done',null));
insert into _13d_c_results values(13,'current token finalizes failed',public.finalize_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000002',(select token from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000002'),'failed','Storage removal failed.'));
reset role;

with expired as (
  update event_storage_cleanup_jobs set claim_token=gen_random_uuid(),lease_expires_at=clock_timestamp()-interval '1 second',attempt_count=1,last_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
  where id='13dc1000-0000-4000-8000-000000000003'
  returning id,event_id,bucket_id,object_path,claim_token,lease_expires_at
)
insert into _13d_claims select * from expired;
set local role service_role;
insert into _13d_claims select * from public.claim_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000003');
insert into _13d_c_results values(33,'expired stale token cannot finalize',not public.finalize_event_storage_cleanup_job('13dc1000-0000-4000-8000-000000000003',(select token from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000003' order by expires limit 1),'done',null));
reset role;

insert into _13d_c_results
select * from (values
(14,'done status stored',(select status='done' from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000001')),
(15,'done clears token',(select claim_token is null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000001')),
(16,'done clears lease',(select lease_expires_at is null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000001')),
(17,'done clears error',(select last_error is null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000001')),
(18,'done records completion',(select completed_at is not null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000001')),
(19,'failed status stored',(select status='failed' from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000002')),
(20,'failed clears token',(select claim_token is null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000002')),
(21,'failed clears lease',(select lease_expires_at is null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000002')),
(22,'failed stores sanitized error',(select last_error='Storage removal failed.' from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000002')),
(23,'failed has no completion',(select completed_at is null from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000002')),
(24,'expired lease reclaimed',(select attempt_count=2 from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000003')),
(25,'expired lease gets new token',(select claim_token=(select token from _13d_claims where job_id='13dc1000-0000-4000-8000-000000000003' order by expires desc limit 1) from event_storage_cleanup_jobs where id='13dc1000-0000-4000-8000-000000000003')),
(26,'remaining count excludes done',public.count_event_storage_cleanup_jobs()=2),
(27,'unique bucket path constraint exists',exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and conname='event_storage_cleanup_jobs_object_unique')),
(28,'object validity constraint exists',exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and conname='event_storage_cleanup_jobs_object_valid')),
(29,'claim shape constraint exists',exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and conname='event_storage_cleanup_jobs_claim_shape')),
(30,'attempt shape constraint exists',exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and conname='event_storage_cleanup_jobs_attempt_shape')),
(31,'error shape constraint exists',exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and conname='event_storage_cleanup_jobs_error_shape')),
(32,'state shape constraint exists',exists(select 1 from pg_constraint where conrelid='public.event_storage_cleanup_jobs'::regclass and conname='event_storage_cleanup_jobs_state_shape')),
(34,'ledger has no browser policy',not exists(select 1 from pg_policies where schemaname='public' and tablename='event_storage_cleanup_jobs')),
(35,'PUBLIC cannot count',not has_function_privilege('public','public.count_event_storage_cleanup_jobs()','EXECUTE')),
(36,'anon cannot count',not has_function_privilege('anon','public.count_event_storage_cleanup_jobs()','EXECUTE')),
(37,'authenticated cannot count',not has_function_privilege('authenticated','public.count_event_storage_cleanup_jobs()','EXECUTE')),
(38,'PUBLIC cannot claim',not has_function_privilege('public','public.claim_event_storage_cleanup_job(uuid)','EXECUTE')),
(39,'anon cannot claim',not has_function_privilege('anon','public.claim_event_storage_cleanup_job(uuid)','EXECUTE')),
(40,'authenticated cannot claim',not has_function_privilege('authenticated','public.claim_event_storage_cleanup_job(uuid)','EXECUTE')),
(41,'PUBLIC cannot finalize',not has_function_privilege('public','public.finalize_event_storage_cleanup_job(uuid,uuid,text,text)','EXECUTE')),
(42,'anon cannot finalize',not has_function_privilege('anon','public.finalize_event_storage_cleanup_job(uuid,uuid,text,text)','EXECUTE')),
(43,'authenticated cannot finalize',not has_function_privilege('authenticated','public.finalize_event_storage_cleanup_job(uuid,uuid,text,text)','EXECUTE')),
(44,'claim uses SKIP LOCKED, failed cooldown, and stable order',position('skip locked' in lower(pg_get_functiondef('public.claim_event_storage_cleanup_job(uuid)'::regprocedure)))>0 and position('last_attempt_at <= v_now - interval ''1 minute''' in lower(pg_get_functiondef('public.claim_event_storage_cleanup_job(uuid)'::regprocedure)))>0 and position('last_attempt_at nulls first, job.created_at, job.id' in lower(pg_get_functiondef('public.claim_event_storage_cleanup_job(uuid)'::regprocedure)))>0),
(45,'claim body uses database token',position('gen_random_uuid' in lower(pg_get_functiondef('public.claim_event_storage_cleanup_job(uuid)'::regprocedure)))>0),
(46,'finalize requires unexpired lease',position('lease_expires_at > v_now' in lower(pg_get_functiondef('public.finalize_event_storage_cleanup_job(uuid,uuid,text,text)'::regprocedure)))>0),
(47,'no SQL Storage delete',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','ceit_connect_private') and lower(p.prosrc) like '%delete from storage.objects%'))
) as checks(n,label,passed);

do $$ declare v_bad text; begin
  select string_agg(n||' '||label,', ' order by n) into v_bad from _13d_c_results where not passed;
  if (select count(*) from _13d_c_results)<>47 or v_bad is not null then raise exception 'STEP 13D C FAIL: %',coalesce(v_bad,'wrong result count'); end if;
end $$;
select format('%s %s: PASS',lpad(n::text,2,'0'),label) from _13d_c_results order by n;
do $$ begin
  raise exception 'TEST RESULTS: STEP 13D C 47/47 PASS';
end $$;
```

The route/UI part will add focused TypeScript tests and the manual browser/Storage checklist. It must not be released separately from this database part; both parts ship in one PR before any Prod migration.
