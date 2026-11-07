# Batch B SQL verification pastes

Run each paste separately in the Dev SQL Editor after applying its matching migration, with **Run without RLS** enabled. Every line is an evaluated catalog or fixture assertion. Each paste ends with an intentional exception that rolls the transaction back.

## Stage 1 Paste A — schema and catalog — 41 result lines

```sql
begin;
create temporary table batch_b_results(seq integer generated always as identity,label text,passed boolean) on commit drop;
insert into batch_b_results(label,passed)
select 'catalog has 39 activity types',count(*)=39 from ceit_connect_private.activity_type_catalog union all
select 'catalog mappings are unique',count(*)=count(distinct (activity_type,broad_action,subject_kind)) from ceit_connect_private.activity_type_catalog union all
select 'catalog is private',not has_table_privilege('authenticated','ceit_connect_private.activity_type_catalog','SELECT') union all
select 'actor kind column exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='actor_kind') union all
select 'subject kind column exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='subject_kind') union all
select 'activity type column exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='activity_type') union all
select 'event id has no FK',not exists(select 1 from information_schema.key_column_usage k join information_schema.table_constraints c using(constraint_catalog,constraint_schema,constraint_name) where k.table_schema='public' and k.table_name='activity_log' and k.column_name='event_id' and c.constraint_type='FOREIGN KEY') union all
select 'subject user id has no FK',not exists(select 1 from information_schema.key_column_usage k join information_schema.table_constraints c using(constraint_catalog,constraint_schema,constraint_name) where k.table_schema='public' and k.table_name='activity_log' and k.column_name='subject_user_id' and c.constraint_type='FOREIGN KEY') union all
select 'task confidentiality column exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='task_was_confidential') union all
select 'task title snapshot column exists',exists(select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='task_title_snapshot') union all
select 'system actor cannot have user',pg_get_constraintdef((select oid from pg_constraint where conname='activity_log_actor_shape_check')) like '%system%user_id IS NULL%' union all
select 'semantic mapping FK exists',exists(select 1 from pg_constraint where conname='activity_log_activity_type_shape_fkey' and contype='f') union all
select 'task title exception is constrained',pg_get_constraintdef((select oid from pg_constraint where conname='activity_log_task_title_snapshot_check')) like '%task_deleted%task_was_confidential IS FALSE%' union all
select 'event_deleted catalog permits event_name',allowed_payload_keys@>array['event_name'] from ceit_connect_private.activity_type_catalog where activity_type='event_deleted' union all
select 'no other catalog type permits event_name',not exists(select 1 from ceit_connect_private.activity_type_catalog where activity_type<>'event_deleted' and allowed_payload_keys@>array['event_name']) union all
select 'event and phase payload shape is constrained',exists(select 1 from pg_constraint where conname='activity_log_event_phase_payload_check' and contype='c') union all
select 'event name snapshot exception is constrained',exists(select 1 from pg_constraint where conname='activity_log_event_name_snapshot_check' and contype='c') union all
select 'bulk payload shape is constrained',exists(select 1 from pg_constraint where conname='activity_log_bulk_payload_check' and contype='c') union all
select 'assignment UUID arrays are constrained',exists(select 1 from pg_constraint where conname='activity_log_assignment_payload_check' and contype='c') union all
select 'leave requester UUID is constrained',exists(select 1 from pg_constraint where conname='activity_log_leave_requester_payload_check' and contype='c') union all
select 'person payload requires old committee',pg_get_constraintdef((select oid from pg_constraint where conname='activity_log_person_payload_check')) like '%old_committee_id%' union all
select 'person payload requires new committee',pg_get_constraintdef((select oid from pg_constraint where conname='activity_log_person_payload_check')) like '%new_committee_id%' union all
select 'person payload requires action-time role',pg_get_constraintdef((select oid from pg_constraint where conname='activity_log_person_payload_check')) like '%target_role%' union all
select 'reader owner is postgres',pg_get_userbyid(proowner)='postgres' from pg_proc where oid='public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure union all
select 'reader is stable definer',provolatile='s' and prosecdef from pg_proc where oid='public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure union all
select 'reader search path is empty',proconfig=array['search_path='] from pg_proc where oid='public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure union all
select 'reader remains authenticated-only',has_function_privilege('authenticated','public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)','EXECUTE') and not has_function_privilege('anon','public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)','EXECUTE') union all
select 'raw authenticated SELECT stays revoked',not has_table_privilege('authenticated','public.activity_log','SELECT') union all
select 'raw service SELECT stays revoked',not has_table_privilege('service_role','public.activity_log','SELECT') union all
select 'reader retains scan cap',pg_get_functiondef('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure) like '%limit 2001%' union all
select 'reader retains Philippine dates',pg_get_functiondef('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure) like '%Asia/Manila%' union all
select 'global reader is leadership-only',pg_get_functiondef('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure) like '%v_caller_role not in (''Admin'', ''Co-Admin'')%' union all
select 'Task History remains task-filtered',pg_get_functiondef('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure) like '%p_task_id is null or log_row.task_id = p_task_id%' union all
select 'system copy exists',pg_get_functiondef('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure) like '%actor_kind = ''system'' then ''System''%' union all
select 'unavailable copy exists',pg_get_functiondef('public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)'::regprocedure) like '%Unavailable actor%' union all
select 'event predicate mirrors Draft rule',pg_get_functiondef('ceit_connect_private.activity_event_status_visible_for_user(text,uuid)'::regprocedure) like '%p_event_status <> ''Draft''%profile.role in (''Admin'', ''Co-Admin'')%' union all
select 'event predicate is private',not has_function_privilege('authenticated','ceit_connect_private.activity_event_status_visible_for_user(text,uuid)','EXECUTE') union all
select 'retention remains 30 days',public.activity_log_retention_days()=30 union all
select 'purge remains capped',pg_get_functiondef('public.purge_activity_log()'::regprocedure) like '%limit 5000%' union all
select 'delete guard remains bound',exists(select 1 from pg_trigger where tgrelid='public.activity_log'::regclass and tgname='activity_log_guard_deletes' and tgenabled<>'D') union all
select 'Stage 1 installs no semantic writer',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ceit_connect_private' and p.proname='write_activity');
do $report$ declare r record; begin for r in select * from batch_b_results order by seq loop raise notice '% %: %',lpad(r.seq::text,2,'0'),r.label,case when r.passed then 'PASS' else 'FAIL' end; end loop; if (select count(*) from batch_b_results)<>41 or exists(select 1 from batch_b_results where not passed) then raise exception 'Batch B Stage 1 schema checks failed'; end if; end $report$;
do $$ begin raise exception 'Stage 1 Paste A complete; transaction intentionally rolled back'; end $$;
```

## Stage 1 Paste B — reader visibility, payload rejection and display safety — 31 result lines

```sql
begin;
create temporary table batch_b_results(seq integer generated always as identity,label text,passed boolean) on commit drop;
do $fixtures$
declare
  token text:='batch-b-reader-'||gen_random_uuid();
  a uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); x uuid:=gen_random_uuid();
  ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); ea uuid:=gen_random_uuid(); er uuid:=gen_random_uuid();
  t uuid:=gen_random_uuid(); tc uuid:=gen_random_uuid(); orphan_task uuid:=gen_random_uuid(); missing_user uuid:=gen_random_uuid();
  missing_event uuid:=gen_random_uuid(); named_missing_event uuid:=gen_random_uuid();
  masked_log uuid:=gen_random_uuid(); orphan_log uuid:=gen_random_uuid(); missing_event_log uuid:=gen_random_uuid(); named_event_log uuid:=gen_random_uuid();
  assigned_log uuid:=gen_random_uuid(); leave_log uuid:=gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'-'||label||'@example.test',crypt('Batch-B-test-1!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token',token,'label',label),now(),now()
  from (values(a,'admin'),(c,'coadmin-a'),(c2,'coadmin-b'),(m,'member'),(x,'inactive')) ids(id,label);
  insert into public.committees(id,name) values(ca,'Batch B A '||token),(cb,'Batch B B '||token);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (a,token||'-a@example.test','Batch B Admin','Admin',null,true),
    (c,token||'-c@example.test','Batch B CoAdmin A','Co-Admin',ca,true),
    (c2,token||'-c2@example.test','Batch B CoAdmin B','Co-Admin',cb,true);
  perform set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (m,token||'-m@example.test','Batch B Member','Member',ca,true),
    (x,token||'-x@example.test','Batch B Inactive','Member',ca,false);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (ed,token||'-draft',current_date,current_date+2,'Draft',a),
    (ea,token||'-active',current_date,current_date+2,'Active',a),
    (er,token||'-archived',current_date-2,current_date-1,'Archived',a);
  perform set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,priority,task_type,primary_assignees,is_confidential,created_by,sort_order) values
    (t,ea,ca,token||'-visible-title','Visible phase','To Do','Medium','Deliverable',array[m],false,a,1024),
    (tc,ea,ca,token||'-secret-title','Secret phase','To Do','Medium','Deliverable',array[m],true,a,2048);
  perform set_config('ceit_connect.task_access_writer','',true); perform set_config('ceit_connect.task_assignee_writer','',true);
  insert into public.activity_log(id,task_id,user_id,actor_kind,subject_kind,activity_type,event_id,task_was_confidential,task_title_snapshot,action,changes,created_at) values
    (gen_random_uuid(),t,a,'user','task','task_deleted',ea,false,token||'-visible-title','DELETE',jsonb_build_object('event_id',ea,'committee_id',ca),clock_timestamp()+interval '1 second'),
    (masked_log,tc,a,'user','task','task_deleted',ea,true,null,'DELETE',jsonb_build_object('event_id',ea,'committee_id',ca),clock_timestamp()+interval '2 seconds'),
    (orphan_log,orphan_task,a,'user','task','task_deleted',ea,false,token||'-orphan-title','DELETE',jsonb_build_object('event_id',ea,'committee_id',ca),clock_timestamp()+interval '3 seconds'),
    (assigned_log,t,a,'user','task','task_assigned',ea,false,null,'UPDATE',jsonb_build_object('event_id',ea,'committee_id',ca,'user_ids',jsonb_build_array(m,missing_user,c,c2)),clock_timestamp()+interval '4 seconds'),
    (leave_log,t,a,'user','task','task_leave_approved',ea,false,null,'UPDATE',jsonb_build_object('event_id',ea,'committee_id',ca,'request_id',gen_random_uuid(),'requester_id',missing_user,'resolver_id',a),clock_timestamp()+interval '5 seconds');
  insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,subject_user_id,action,changes,created_at) values
    (gen_random_uuid(),a,'user','person','officer_added',a,'INSERT',jsonb_build_object('old_committee_id',null,'new_committee_id',null,'target_role','Admin'),clock_timestamp()+interval '6 seconds'),
    (gen_random_uuid(),a,'user','person','person_deactivated',m,'UPDATE',jsonb_build_object('old_committee_id',ca,'new_committee_id',ca,'target_role','Member'),clock_timestamp()+interval '7 seconds');
  insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,action,changes,created_at) values
    (gen_random_uuid(),a,'user','bulk','bulk_events_deleted','DELETE',jsonb_build_object('count',2,'ids',jsonb_build_array(ed,er)),clock_timestamp()+interval '8 seconds');
  insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,event_id,action,changes,created_at) values
    (gen_random_uuid(),a,'user','event','event_created',ed,'INSERT',jsonb_build_object('event_status','Draft'),clock_timestamp()+interval '9 seconds'),
    (missing_event_log,a,'user','event','event_deleted',missing_event,'DELETE',jsonb_build_object('event_status','Active'),clock_timestamp()+interval '10 seconds'),
    (named_event_log,a,'user','event','event_deleted',named_missing_event,'DELETE',jsonb_build_object('event_status','Active','event_name',token||'-deleted-event'),clock_timestamp()+interval '11 seconds'),
    (gen_random_uuid(),a,'user','phase','phase_removed',ea,'DELETE',jsonb_build_object('event_status','Active','phase','Removed secret','old_position',1,'affected_task_ids',jsonb_build_array(t)),clock_timestamp()+interval '12 seconds');
  perform set_config('bb.a',a::text,true); perform set_config('bb.c',c::text,true); perform set_config('bb.c2',c2::text,true);
  perform set_config('bb.m',m::text,true); perform set_config('bb.x',x::text,true); perform set_config('bb.ed',ed::text,true);
  perform set_config('bb.ea',ea::text,true); perform set_config('bb.er',er::text,true); perform set_config('bb.t',t::text,true); perform set_config('bb.tc',tc::text,true);
  perform set_config('bb.masked_log',masked_log::text,true); perform set_config('bb.orphan_log',orphan_log::text,true);
  perform set_config('bb.missing_event_log',missing_event_log::text,true); perform set_config('bb.named_event_log',named_event_log::text,true);
  perform set_config('bb.assigned_log',assigned_log::text,true); perform set_config('bb.leave_log',leave_log::text,true);
  perform set_config('bb.token',token,true);
end $fixtures$;
do $malformed_phase$ declare rejected boolean:=false; begin begin insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,event_id,action,changes) values(gen_random_uuid(),current_setting('bb.a')::uuid,'user','phase','phase_added',current_setting('bb.ea')::uuid,'INSERT',jsonb_build_object('event_status','Active','phase','Bad phase','affected_task_ids','not-an-array')); exception when check_violation then rejected:=true; end; insert into batch_b_results(label,passed) values('malformed phase payload is rejected',rejected); end $malformed_phase$;
do $malformed_bulk$ declare rejected boolean:=false; begin begin insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,action,changes) values(gen_random_uuid(),current_setting('bb.a')::uuid,'user','bulk','bulk_events_deleted','DELETE',jsonb_build_object('count','ten','ids',jsonb_build_array())); exception when check_violation then rejected:=true; end; insert into batch_b_results(label,passed) values('malformed bulk payload is rejected',rejected); end $malformed_bulk$;
do $event_name_scope$ declare rejected boolean:=false; begin begin insert into public.activity_log(id,user_id,actor_kind,subject_kind,activity_type,event_id,action,changes) values(gen_random_uuid(),current_setting('bb.a')::uuid,'user','event','event_created',current_setting('bb.ea')::uuid,'INSERT',jsonb_build_object('event_status','Active','event_name','Forbidden snapshot')); exception when check_violation then rejected:=true; end; insert into batch_b_results(label,passed) values('event_name is rejected outside event_deleted',rejected); end $event_name_scope$;
do $malformed_assignment$ declare rejected boolean:=false; begin begin insert into public.activity_log(id,task_id,user_id,actor_kind,subject_kind,activity_type,event_id,task_was_confidential,action,changes) values(gen_random_uuid(),current_setting('bb.t')::uuid,current_setting('bb.a')::uuid,'user','task','task_assigned',current_setting('bb.ea')::uuid,false,'UPDATE',jsonb_build_object('event_id',current_setting('bb.ea')::uuid,'committee_id',null,'user_ids',jsonb_build_array('not-a-uuid'))); exception when check_violation then rejected:=true; end; insert into batch_b_results(label,passed) values('malformed assignment user_ids is rejected',rejected); end $malformed_assignment$;
do $malformed_leave$ declare rejected boolean:=false; begin begin insert into public.activity_log(id,task_id,user_id,actor_kind,subject_kind,activity_type,event_id,task_was_confidential,action,changes) values(gen_random_uuid(),current_setting('bb.t')::uuid,current_setting('bb.a')::uuid,'user','task','task_leave_approved',current_setting('bb.ea')::uuid,false,'UPDATE',jsonb_build_object('event_id',current_setting('bb.ea')::uuid,'committee_id',null,'request_id',gen_random_uuid(),'requester_id','not-a-uuid','resolver_id',current_setting('bb.a')::uuid)); exception when check_violation then rejected:=true; end; insert into batch_b_results(label,passed) values('malformed leave requester_id is rejected',rejected); end $malformed_leave$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.a'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'Admin sees never-confidential deleted title',exists(select 1 from public.list_activity_log(null,'newest','DELETE',null,null,null,current_setting('bb.token')||'-visible-title',null,null,20) where task_title=current_setting('bb.token')||'-visible-title');
insert into batch_b_results(label,passed) select 'Admin sees officer entry',exists(select 1 from public.list_activity_log(null,'newest','INSERT',null,null,null,null,null,null,20) where change_summary=array['Officer added']);
insert into batch_b_results(label,passed) select 'Admin sees Admin-target entry',exists(select 1 from public.list_activity_log(null,'newest','INSERT',null,null,null,'Batch B Admin',null,null,20) where task_title='Batch B Admin');
insert into batch_b_results(label,passed) select 'visible task rows return only the live task id',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.assigned_log')::uuid and task_id=current_setting('bb.t')::uuid);
insert into batch_b_results(label,passed) select 'deleted or orphan task rows have no task link id',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.orphan_log')::uuid and task_id is null and task_title=current_setting('bb.token')||'-orphan-title');
insert into batch_b_results(label,passed) select 'missing deleted event without snapshot displays fallback',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.missing_event_log')::uuid and event_name='Deleted event');
insert into batch_b_results(label,passed) select 'event_deleted displays its permitted name snapshot',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.named_event_log')::uuid and event_name=current_setting('bb.token')||'-deleted-event');
insert into batch_b_results(label,passed) select 'assignment names resolve at read time and cap at three',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.assigned_log')::uuid and change_summary=array['Task assigned: Batch B Member, Former member, Batch B CoAdmin A and 1 more']);
insert into batch_b_results(label,passed) select 'missing leave requester resolves as Former member',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.leave_log')::uuid and change_summary=array['Leave request approved: Former member']);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.c'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'Co-Admin sees deleted title',exists(select 1 from public.list_activity_log(null,'newest','DELETE',null,null,null,current_setting('bb.token')||'-visible-title',null,null,20) where task_title=current_setting('bb.token')||'-visible-title');
insert into batch_b_results(label,passed) select 'Co-Admin sees officer-role entry',exists(select 1 from public.list_activity_log(null,'newest','INSERT',null,null,null,null,null,null,20) where change_summary=array['Officer added']);
insert into batch_b_results(label,passed) select 'Co-Admin sees Admin-target entry',exists(select 1 from public.list_activity_log(null,'newest','INSERT',null,null,null,'Batch B Admin',null,null,20));
insert into batch_b_results(label,passed) select 'Co-Admin sees bulk summary',exists(select 1 from public.list_activity_log(null,'newest','DELETE',null,null,null,null,null,null,20) where change_summary=array['2 events deleted']);
insert into batch_b_results(label,passed) select 'removed phase is generically masked for Co-Admin',exists(select 1 from public.list_activity_log(null,'newest','DELETE',null,null,null,null,null,null,20) where task_title='Event phases' and change_summary=array['Event phases updated']);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.c2'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'other-committee Co-Admin sees Member entry',exists(select 1 from public.list_activity_log(null,'newest','UPDATE',null,null,null,'Batch B Member',null,null,20) where task_title='Batch B Member' and change_summary=array['Person deactivated']);
insert into batch_b_results(label,passed) select 'masked confidential row has no task id actor or summary',exists(select 1 from public.list_activity_log(null,'newest',null,null,null,null,null,null,null,20) where activity_id=current_setting('bb.masked_log')::uuid and is_masked and task_id is null and actor_name is null and change_summary is null);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.m'),'role','authenticated')::text,true);
do $member_global$ declare rejected boolean:=false; begin begin perform 1 from public.list_activity_log(); exception when sqlstate 'CAL01' then rejected:=true; end; insert into batch_b_results(label,passed) values('Member sees no global activity rows because reader gate rejects the call',rejected); end $member_global$;
reset role;
insert into batch_b_results(label,passed) select 'ever-confidential delete stores no title',task_was_confidential and task_title_snapshot is null from public.activity_log where activity_type='task_deleted' and task_id=current_setting('bb.tc')::uuid;
insert into batch_b_results(label,passed) select 'Admin event helper sees all statuses',ceit_connect_private.activity_event_status_visible_for_user('Draft',current_setting('bb.a')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Active',current_setting('bb.a')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Archived',current_setting('bb.a')::uuid);
insert into batch_b_results(label,passed) select 'Co-Admin event helper sees all statuses',ceit_connect_private.activity_event_status_visible_for_user('Draft',current_setting('bb.c')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Active',current_setting('bb.c')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Archived',current_setting('bb.c')::uuid);
insert into batch_b_results(label,passed) select 'Member event helper matches non-Draft policy',not ceit_connect_private.activity_event_status_visible_for_user('Draft',current_setting('bb.m')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Active',current_setting('bb.m')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Archived',current_setting('bb.m')::uuid);
insert into batch_b_results(label,passed) select 'inactive helper mirrors non-Draft policy gap',not ceit_connect_private.activity_event_status_visible_for_user('Draft',current_setting('bb.x')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Active',current_setting('bb.x')::uuid) and ceit_connect_private.activity_event_status_visible_for_user('Archived',current_setting('bb.x')::uuid);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.a'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'Admin RLS matches event helper',count(*)=3 from public.events where id in(current_setting('bb.ed')::uuid,current_setting('bb.ea')::uuid,current_setting('bb.er')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.c'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'Co-Admin RLS matches event helper',count(*)=3 from public.events where id in(current_setting('bb.ed')::uuid,current_setting('bb.ea')::uuid,current_setting('bb.er')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.m'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'Member RLS matches event helper',count(*)=2 from public.events where id in(current_setting('bb.ed')::uuid,current_setting('bb.ea')::uuid,current_setting('bb.er')::uuid);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.x'),'role','authenticated')::text,true);
insert into batch_b_results(label,passed) select 'inactive RLS matches event helper',count(*)=2 from public.events where id in(current_setting('bb.ed')::uuid,current_setting('bb.ea')::uuid,current_setting('bb.er')::uuid);
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('bb.x'),'role','authenticated')::text,true);
do $inactive_reader$ declare rejected boolean:=false; begin begin perform 1 from public.list_activity_log(); exception when sqlstate 'CAL01' then rejected:=true; end; if not rejected then raise exception 'inactive activity reader was not rejected'; end if; end $inactive_reader$;
reset role;
do $report$ declare r record; begin for r in select * from batch_b_results order by seq loop raise notice '% %: %',lpad(r.seq::text,2,'0'),r.label,case when r.passed then 'PASS' else 'FAIL' end; end loop; if (select count(*) from batch_b_results)<>31 or exists(select 1 from batch_b_results where not passed) then raise exception 'Batch B Stage 1 reader checks failed'; end if; end $report$;
do $$ begin raise exception 'Stage 1 Paste B complete; transaction intentionally rolled back'; end $$;
```

Stage 1 expected total: **72 evaluated result lines** (`41 + 31`), followed by two intentional rollback exceptions. Each displayed PASS/FAIL value is computed from a catalog assertion or an attempted fixture operation; neither paste prints a hard-coded PASS result.

Stage 2A and Stage 2B paste counts will be finalized with their migration SQL; they are not claimed by Stage 1.
