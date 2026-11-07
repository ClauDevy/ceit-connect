# Batch A SQL verification pastes

Run each paste separately in the Dev SQL Editor after applying its matching migration, with **Run without RLS** enabled. Every result below is computed from a catalog check or a fixture outcome; there are no placeholder loops. Each paste ends with the project's intentional `TEST RESULTS ...` exception, which rolls the transaction back.

## `20261106120000_event_phase_positions.sql` — 20 result lines

```sql
begin;
create temporary table batch_a_results(seq integer generated always as identity,label text,passed boolean) on commit drop;
grant select,insert on batch_a_results to authenticated;
grant usage,select on sequence batch_a_results_seq_seq to authenticated;
do $fixtures$
declare
  token text:='batch-a-phase-'||gen_random_uuid(); a uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid();
  er uuid:=gen_random_uuid(); en uuid:=gen_random_uuid(); em uuid:=gen_random_uuid(); enr uuid:=gen_random_uuid(); ed uuid:=gen_random_uuid(); ea uuid:=gen_random_uuid(); td uuid:=gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'-'||label||'@example.test',crypt('Batch-A-test-1!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token',token,'label',label),now(),now()
  from (values(a,'admin'),(m,'member'),(c,'coa')) x(id,label);
  insert into public.committees(id,name) values(ca,'Batch A Phase A '||token),(cb,'Batch A Phase B '||token);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values(a,token||'-a@example.test','Batch A Admin','Admin',null,true),(c,token||'-c@example.test','Batch A Co-Admin','Co-Admin',cb,true);
  perform set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values(m,token||'-m@example.test','Batch A Member','Member',ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (er,token||'-reorder',current_date,current_date+10,'Draft',a),(en,token||'-rename',current_date,current_date+10,'Draft',a),(em,token||'-merge',current_date,current_date+10,'Draft',a),
    (enr,token||'-rename-reorder',current_date,current_date+10,'Draft',a),(ed,token||'-delete',current_date,current_date+10,'Draft',a),(ea,token||'-archive',current_date-10,current_date-1,'Active',a);
  perform set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(event_id,committee_id,title,phase,status,priority,task_type,due_date,primary_assignees,is_confidential,created_by,sort_order)
  select event_id,ca,token||'-'||label||'-'||phase,phase,'To Do','Medium','Deliverable',current_date+1,'{}',false,a,n*1024
  from (values(er,'reorder'),(en,'rename'),(em,'merge'),(enr,'rename-reorder')) e(event_id,label) cross join (values('A',1),('B',2),('C',3)) p(phase,n);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,priority,task_type,due_date,primary_assignees,is_confidential,created_by,sort_order) values
    (td,ed,ca,token||'-delete','Delete Me','To Do','Medium','Deliverable',current_date+1,'{}',false,a,1024),
    (gen_random_uuid(),ea,ca,token||'-real','Archive Real','Completed','Medium','Deliverable',current_date-2,array[m],false,a,1024),
    (gen_random_uuid(),ea,ca,token||'-secret','Secret Phase','Completed','Medium','Deliverable',current_date-2,'{}',true,a,2048);
  perform set_config('ceit_connect.task_access_writer','',true); perform set_config('ceit_connect.task_assignee_writer','',true);
  perform ceit_connect_private.reconcile_event_phase_positions(er,array['A','B','C']); perform ceit_connect_private.reconcile_event_phase_positions(en,array['A','B','C']);
  perform ceit_connect_private.reconcile_event_phase_positions(em,array['A','B','C']); perform ceit_connect_private.reconcile_event_phase_positions(enr,array['A','B','C']);
  perform ceit_connect_private.reconcile_event_phase_positions(ed,array['Delete Me']); perform ceit_connect_private.reconcile_event_phase_positions(ea,array['Archive Real','Secret Phase']);
  perform set_config('ba.a',a::text,true); perform set_config('ba.m',m::text,true); perform set_config('ba.c',c::text,true); perform set_config('ba.er',er::text,true);
  perform set_config('ba.en',en::text,true); perform set_config('ba.em',em::text,true); perform set_config('ba.enr',enr::text,true); perform set_config('ba.ed',ed::text,true);
  perform set_config('ba.ea',ea::text,true); perform set_config('ba.td',td::text,true);
end $fixtures$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ba.a'),'role','authenticated')::text,true);
select public.archive_event(current_setting('ba.ea')::uuid,0,(select updated_at from public.events where id=current_setting('ba.ea')::uuid));
select public.edit_event_with_tasks(current_setting('ba.er')::uuid,(select updated_at from public.events where id=current_setting('ba.er')::uuid),(select name from public.events where id=current_setting('ba.er')::uuid),null,current_date,current_date+10,'Draft','[]','[]','{}',jsonb_build_array(jsonb_build_object('type','reorder','phases',jsonb_build_array('B','A','C'))));
select public.edit_event_with_tasks(current_setting('ba.en')::uuid,(select updated_at from public.events where id=current_setting('ba.en')::uuid),(select name from public.events where id=current_setting('ba.en')::uuid),null,current_date,current_date+10,'Draft','[]',(select jsonb_agg(jsonb_build_object('id',task_row.id,'title',task_row.title,'description',task_row.description,'phase','Middle','committee_id',task_row.committee_id,'task_type',task_row.task_type,'priority',task_row.priority,'due_date',task_row.due_date,'call_time',task_row.call_time,'end_time',task_row.end_time,'assignee_ids',to_jsonb(task_row.primary_assignees||task_row.assist_assignees))) from public.tasks task_row where task_row.event_id=current_setting('ba.en')::uuid and task_row.phase='B'),'{}',jsonb_build_array(jsonb_build_object('type','rename','phase','B','next_phase','Middle')));
select public.edit_event_with_tasks(current_setting('ba.em')::uuid,(select updated_at from public.events where id=current_setting('ba.em')::uuid),(select name from public.events where id=current_setting('ba.em')::uuid),null,current_date,current_date+10,'Draft','[]',(select jsonb_agg(jsonb_build_object('id',task_row.id,'title',task_row.title,'description',task_row.description,'phase','C','committee_id',task_row.committee_id,'task_type',task_row.task_type,'priority',task_row.priority,'due_date',task_row.due_date,'call_time',task_row.call_time,'end_time',task_row.end_time,'assignee_ids',to_jsonb(task_row.primary_assignees||task_row.assist_assignees))) from public.tasks task_row where task_row.event_id=current_setting('ba.em')::uuid and task_row.phase='A'),'{}',jsonb_build_array(jsonb_build_object('type','rename','phase','A','next_phase','C')));
select public.edit_event_with_tasks(current_setting('ba.enr')::uuid,(select updated_at from public.events where id=current_setting('ba.enr')::uuid),(select name from public.events where id=current_setting('ba.enr')::uuid),null,current_date,current_date+10,'Draft','[]',(select jsonb_agg(jsonb_build_object('id',task_row.id,'title',task_row.title,'description',task_row.description,'phase','Bee','committee_id',task_row.committee_id,'task_type',task_row.task_type,'priority',task_row.priority,'due_date',task_row.due_date,'call_time',task_row.call_time,'end_time',task_row.end_time,'assignee_ids',to_jsonb(task_row.primary_assignees||task_row.assist_assignees))) from public.tasks task_row where task_row.event_id=current_setting('ba.enr')::uuid and task_row.phase='B'),'{}',jsonb_build_array(jsonb_build_object('type','rename','phase','B','next_phase','Bee'),jsonb_build_object('type','reorder','phases',jsonb_build_array('C','Bee','A'))));
select public.edit_event_with_tasks(current_setting('ba.ed')::uuid,(select updated_at from public.events where id=current_setting('ba.ed')::uuid),(select name from public.events where id=current_setting('ba.ed')::uuid),null,current_date,current_date+10,'Draft','[]','[]',array[current_setting('ba.td')::uuid],'[]');
reset role;
set constraints public.tasks_z9_reconcile_event_phase_positions immediate;
set constraints public.tasks_z9_reconcile_event_phase_positions deferred;
insert into batch_a_results(label,passed)
select 'private phase table exists',to_regclass('ceit_connect_private.event_phase_positions') is not null union all
select 'reconciliation trigger is deferred',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_z9_reconcile_event_phase_positions' and tgdeferrable and tginitdeferred) union all
select 'seen-set is present',pg_get_functiondef('ceit_connect_private.defer_event_phase_reconciliation()'::regprocedure) like '%pg_temp.batch_a_phase_events_seen%' union all
select 'cascade exit precedes advisory lock',strpos(pg_get_functiondef('ceit_connect_private.defer_event_phase_reconciliation()'::regprocedure),'if not found then return null')<strpos(pg_get_functiondef('ceit_connect_private.defer_event_phase_reconciliation()'::regprocedure),'pg_advisory_xact_lock') union all
select 'FOR SHARE precedes advisory lock',strpos(pg_get_functiondef('ceit_connect_private.defer_event_phase_reconciliation()'::regprocedure),'for share') between 1 and strpos(pg_get_functiondef('ceit_connect_private.defer_event_phase_reconciliation()'::regprocedure),'pg_advisory_xact_lock')-1 union all
select 'constraint target is schema-qualified',pg_get_functiondef('ceit_connect_private.reconcile_event_phase_positions(uuid,text[])'::regprocedure) like '%set constraints ceit_connect_private.event_phase_positions_event_position_key deferred%' union all
select 'private table is ungranted',not has_table_privilege('authenticated','ceit_connect_private.event_phase_positions','SELECT') union all
select 'private helper is ungranted',not has_function_privilege('authenticated','ceit_connect_private.reconcile_event_phase_positions(uuid,text[])','EXECUTE') union all
select 'phase reader is granted',has_function_privilege('authenticated','public.list_event_phase_order(uuid)','EXECUTE') union all
select 'typeless actions reach prior validator',pg_get_functiondef('public.edit_event_with_tasks_pre_batch_b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)'::regprocedure) ~* $pattern$type.*is[[:space:]]+distinct[[:space:]]+from.*reorder$pattern$ union all
select 'position OUT name stays quoted',pg_get_functiondef('public.list_event_phase_order(uuid)'::regprocedure) like '%"position" bigint%' union all
select 'writer reorder persisted',array(select phase_key from ceit_connect_private.event_phase_positions where event_id=current_setting('ba.er')::uuid order by position)=array['B','A','C'] union all
select 'middle rename kept position',array(select phase_key from ceit_connect_private.event_phase_positions where event_id=current_setting('ba.en')::uuid order by position)=array['A','Middle','C'] union all
select 'rename merge kept destination',array(select phase_key from ceit_connect_private.event_phase_positions where event_id=current_setting('ba.em')::uuid order by position)=array['B','C'] union all
select 'rename plus reorder used explicit order',array(select phase_key from ceit_connect_private.event_phase_positions where event_id=current_setting('ba.enr')::uuid order by position)=array['C','Bee','A'] union all
select 'DELETE reconciled without orphan',not exists(select 1 from ceit_connect_private.event_phase_positions where event_id=current_setting('ba.ed')::uuid and phase_key='Delete Me');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ba.a'),'role','authenticated')::text,true);
do $archived$ declare rejected boolean:=false; begin begin perform public.edit_event_with_tasks(current_setting('ba.ea')::uuid,(select updated_at from public.events where id=current_setting('ba.ea')::uuid),(select name from public.events where id=current_setting('ba.ea')::uuid),null,current_date-10,current_date-1,'Archived','[]','[]','{}','[{"type":"reorder","phases":["Archive Real","Secret Phase"]}]'); exception when sqlstate 'CCP06' then rejected:=true; end; insert into batch_a_results(label,passed) values('Archived reorder is rejected',rejected); end $archived$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ba.m'),'role','authenticated')::text,true);
insert into batch_a_results(label,passed) select 'Member reads Archived order',exists(select 1 from public.list_event_phase_order(current_setting('ba.ea')::uuid) where phase_key='Archive Real');
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ba.c'),'role','authenticated')::text,true);
insert into batch_a_results(label,passed) select 'confidential-only name is hidden',not exists(select 1 from public.list_event_phase_order(current_setting('ba.ea')::uuid) where phase_key='Secret Phase');
reset role;
insert into batch_a_results(label,passed) select 'Home computes content access once',(length(pg_get_functiondef('public.list_home_event_progress(uuid[])'::regprocedure))-length(replace(pg_get_functiondef('public.list_home_event_progress(uuid[])'::regprocedure),'task_content_access_for_user','')))/length('task_content_access_for_user')=1;
do $report$ declare r record; v_count integer; v_failed text; begin for r in select * from batch_a_results order by seq loop raise notice '% %: %',lpad(r.seq::text,2,'0'),r.label,case when r.passed then 'PASS' else 'FAIL' end; end loop; select count(*),string_agg(seq::text||' '||label,', ' order by seq) filter(where not passed) into v_count,v_failed from batch_a_results; if v_count<>20 or v_failed is not null then raise exception 'Batch A phase checks failed: expected 20 rows, got %; failed: %',v_count,coalesce(v_failed,'none (one or more result rows were missing)'); end if; end $report$;
do $$ begin raise exception 'TEST RESULTS: 20/20 PASS — transaction intentionally rolled back'; end $$;
```

## `20261106130000_peer_admin_lifecycle.sql` — 16 result lines

```sql
begin;
create temporary table batch_a_results(seq integer generated always as identity,label text,passed boolean) on commit drop;
grant select,insert on batch_a_results to authenticated;
grant usage,select on sequence batch_a_results_seq_seq to authenticated;
-- Keep the two rollback-only fixture Admins inside the enabled two-seat cap.
select set_config('ceit_connect.officer_writer','set_officer_active',true);
update public.users set is_active=false where role='Admin' and is_active;
select set_config('ceit_connect.officer_writer','',true);
do $fixtures$
declare token text:='batch-a-admin-'||gen_random_uuid(); actor_id uuid:=gen_random_uuid(); peer_id uuid:=gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'-'||label||'@example.test',crypt('Batch-A-test-1!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token',token,'label',label),now(),now()
  from (values(actor_id,'actor'),(peer_id,'peer')) x(id,label);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active,avatar_url) values(actor_id,token||'-actor@example.test','Batch A Actor','Admin',null,true,null),(peer_id,token||'-peer@example.test','Batch A Peer','Admin',null,true,'avatars/test.png');
  perform set_config('ceit_connect.officer_writer','',true);
  update public.app_settings set enforce_officer_role_caps=true where key='global';
  perform set_config('ba.actor',actor_id::text,true); perform set_config('ba.peer',peer_id::text,true);
end $fixtures$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ba.actor'),'role','authenticated')::text,true);
select public.set_officer_active(current_setting('ba.peer')::uuid,false);
insert into batch_a_results(label,passed) select 'peer Admin deactivation preserves role and clears avatar',coalesce((select role='Admin' and not is_active and avatar_url is null from public.users where id=current_setting('ba.peer')::uuid),false);
select public.set_officer_active(current_setting('ba.peer')::uuid,true);
insert into batch_a_results(label,passed) select 'peer Admin reactivation succeeds',coalesce((select role='Admin' and is_active from public.users where id=current_setting('ba.peer')::uuid),false);
do $self$ declare rejected boolean:=false; begin begin perform public.set_officer_active(current_setting('ba.actor')::uuid,false); exception when sqlstate 'CCO03' then rejected:=true; end; insert into batch_a_results(label,passed) values('self deactivation is rejected',rejected); end $self$;
select public.set_officer_active(current_setting('ba.peer')::uuid,false);
insert into batch_a_results(label,passed) select 'inactive Admin is eligible',coalesce((select outcome='eligible' and role='Admin' from public.preview_former_member_removal(array[current_setting('ba.peer')::uuid])),false);
do $anonymize$
declare v_outcome text;v_role text;v_anonymized_at timestamptz;
begin
  select result.out_outcome into v_outcome from public.anonymize_former_member(current_setting('ba.peer')::uuid) result;
  select profile.role,profile.anonymized_at into v_role,v_anonymized_at from public.users profile where profile.id=current_setting('ba.peer')::uuid;
  insert into batch_a_results(label,passed) values('anonymization preserves Admin history',coalesce(v_outcome='anonymized' and v_role='Admin' and v_anonymized_at is not null,false));
end $anonymize$;
reset role;
insert into batch_a_results(label,passed)
select 'Admin target is supported',pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure) like '%v_target.role not in (''Admin'',''Co-Admin'')%' union all
select 'authorization precedes officer lock',strpos(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'officer_require_active_admin')<strpos(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'pg_advisory_xact_lock') union all
select 'self rejection precedes officer lock',strpos(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'p_user_id=auth.uid')<strpos(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'pg_advisory_xact_lock') union all
select 'caller is reauthorized after lock',(length(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure))-length(replace(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'officer_require_active_admin','')))/length('officer_require_active_admin')=2 union all
select 'officer lock precedes sorted user lock',strpos(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'pg_advisory_xact_lock')<strpos(pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure),'lock_task_assignee_users') union all
select 'final confirmed Admin is protected',pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure) like '%email_confirmed_at is not null%' and pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure) like '%CCO05%' union all
select 'reactivation enforces caps',pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure) like '%officer_caps_are_enabled%' and pg_get_functiondef('public.set_officer_active(uuid,boolean)'::regprocedure) like '%CCO04%' union all
select 'anonymize authorizes before lock',strpos(pg_get_functiondef('public.anonymize_former_member(uuid)'::regprocedure),'officer_require_active_admin')<strpos(pg_get_functiondef('public.anonymize_former_member(uuid)'::regprocedure),'pg_advisory_xact_lock') union all
select 'CMR05 inner handler is retained',pg_get_functiondef('public.anonymize_former_member(uuid)'::regprocedure) like '%exception when others then%CMR05%Anonymization failed before its invariant could be verified.%' union all
select 'officer guard trigger remains enabled',exists(select 1 from pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and tgenabled<>'D') union all
select 'lifecycle context is granted',has_function_privilege('authenticated','public.get_admin_lifecycle_context()','EXECUTE');
do $report$ declare r record;v_count integer;v_failed text;begin for r in select * from batch_a_results order by seq loop raise notice '% %: %',lpad(r.seq::text,2,'0'),r.label,case when r.passed then 'PASS' else 'FAIL' end;end loop;select count(*),string_agg(seq::text||' '||label,', ' order by seq) filter(where not passed) into v_count,v_failed from batch_a_results;if v_count<>16 or v_failed is not null then raise exception 'Batch A Admin checks failed: expected 16 rows, got %; failed: %',v_count,coalesce(v_failed,'none (one or more result rows were missing)');end if;end $report$;
do $$ begin raise exception 'TEST RESULTS: 16/16 PASS — transaction intentionally rolled back'; end $$;
```

## `20261106140000_event_deadline_bounds.sql` — 24 result lines

```sql
begin;
create temporary table batch_a_results(seq integer generated always as identity,label text,passed boolean) on commit drop;
grant select,insert on batch_a_results to authenticated;
grant usage,select on sequence batch_a_results_seq_seq to authenticated;
do $fixtures$
declare token text:='batch-a-deadline-'||gen_random_uuid(); a uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); exm uuid:=gen_random_uuid(); exa uuid:=gen_random_uuid(); shm uuid:=gen_random_uuid(); shb uuid:=gen_random_uuid(); gf uuid:=gen_random_uuid(); texm uuid:=gen_random_uuid(); tshm uuid:=gen_random_uuid(); tshb uuid:=gen_random_uuid(); tgf uuid:=gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',token||'@example.test',crypt('Batch-A-test-1!',gen_salt('bf')),now(),'{}',jsonb_build_object('test_token',token),now(),now());
  insert into public.committees(id,name) values(c,'Batch A Deadline '||token);
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true); insert into public.users(id,email,full_name,role,committee_id,is_active) values(a,token||'@example.test','Batch A Deadline Admin','Admin',null,true); perform set_config('ceit_connect.officer_writer','',true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values(exm,token||'-extend-move',current_date,current_date+10,'Draft',a),(exa,token||'-extend-add',current_date,current_date+10,'Draft',a),(shm,token||'-shorten-move',current_date,current_date+20,'Draft',a),(shb,token||'-shorten-block',current_date,current_date+20,'Draft',a),(gf,token||'-grandfather',current_date,current_date+10,'Draft',a);
  execute 'alter table public.tasks disable trigger tasks_i0_guard_event_end';
  perform set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  insert into public.tasks(id,event_id,committee_id,title,phase,status,priority,task_type,due_date,primary_assignees,created_by,sort_order) values
    (texm,exm,c,token||'-extend-move','Phase','To Do','Medium','Deliverable',current_date+9,'{}',a,1024),(tshm,shm,c,token||'-shorten-move','Phase','To Do','Medium','Deliverable',current_date+18,'{}',a,1024),
    (tshb,shb,c,token||'-shorten-block','Phase','To Do','Medium','Deliverable',current_date+18,'{}',a,1024),(tgf,gf,c,token||'-grandfather','Phase','To Do','Medium','Deliverable',current_date+15,'{}',a,1024);
  perform set_config('ceit_connect.task_assignee_writer','',true);
  perform set_config('ba.a',a::text,true); perform set_config('ba.c',c::text,true); perform set_config('ba.exm',exm::text,true); perform set_config('ba.exa',exa::text,true); perform set_config('ba.shm',shm::text,true); perform set_config('ba.shb',shb::text,true); perform set_config('ba.gf',gf::text,true); perform set_config('ba.texm',texm::text,true); perform set_config('ba.tshm',tshm::text,true); perform set_config('ba.tgf',tgf::text,true);
end $fixtures$;
set constraints all immediate;
alter table public.tasks enable trigger tasks_i0_guard_event_end;
set constraints all deferred;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('ba.a'),'role','authenticated')::text,true);
select public.edit_event_with_tasks(current_setting('ba.exm')::uuid,(select updated_at from public.events where id=current_setting('ba.exm')::uuid),(select name from public.events where id=current_setting('ba.exm')::uuid),null,current_date,current_date+20,'Draft','[]',jsonb_build_array(jsonb_build_object('id',current_setting('ba.texm'),'title',(select title from public.tasks where id=current_setting('ba.texm')::uuid),'description',null,'phase','Phase','committee_id',current_setting('ba.c'),'task_type','Deliverable','priority','Medium','due_date',(current_date+15)::text,'call_time',null,'end_time',null,'assignee_ids','[]'::jsonb)),'{}','[]');
insert into batch_a_results(label,passed) select 'extend plus move later succeeds',e.end_date=current_date+20 and t.due_date::date=current_date+15 from public.events e join public.tasks t on t.event_id=e.id where e.id=current_setting('ba.exm')::uuid;
select public.edit_event_with_tasks(current_setting('ba.exa')::uuid,(select updated_at from public.events where id=current_setting('ba.exa')::uuid),(select name from public.events where id=current_setting('ba.exa')::uuid),null,current_date,current_date+20,'Draft',jsonb_build_array(jsonb_build_object('title','Added later','description',null,'phase','Phase','committee_id',current_setting('ba.c'),'task_type','Deliverable','priority','Medium','due_date',(current_date+15)::text,'call_time',null,'end_time',null,'assignee_ids','[]'::jsonb)),'[]','{}','[]');
insert into batch_a_results(label,passed) select 'extend plus add later succeeds',end_date=current_date+20 and exists(select 1 from public.tasks where event_id=public.events.id and title='Added later' and due_date::date=current_date+15) from public.events where id=current_setting('ba.exa')::uuid;
select public.edit_event_with_tasks(current_setting('ba.shm')::uuid,(select updated_at from public.events where id=current_setting('ba.shm')::uuid),(select name from public.events where id=current_setting('ba.shm')::uuid),null,current_date,current_date+10,'Draft','[]',jsonb_build_array(jsonb_build_object('id',current_setting('ba.tshm'),'title',(select title from public.tasks where id=current_setting('ba.tshm')::uuid),'description',null,'phase','Phase','committee_id',current_setting('ba.c'),'task_type','Deliverable','priority','Medium','due_date',(current_date+9)::text,'call_time',null,'end_time',null,'assignee_ids','[]'::jsonb)),'{}','[]');
insert into batch_a_results(label,passed) select 'shorten plus move earlier succeeds',e.end_date=current_date+10 and t.due_date::date=current_date+9 from public.events e join public.tasks t on t.event_id=e.id where e.id=current_setting('ba.shm')::uuid;
do $shorten$ declare rejected boolean:=false; begin begin perform public.edit_event_with_tasks(current_setting('ba.shb')::uuid,(select updated_at from public.events where id=current_setting('ba.shb')::uuid),(select name from public.events where id=current_setting('ba.shb')::uuid),null,current_date,current_date+10,'Draft','[]','[]','{}','[]'); exception when sqlstate 'CCD04' then rejected:=true; end; insert into batch_a_results(label,passed) values('shorten without fix is rejected',rejected); end $shorten$;
do $direct$ declare rejected boolean:=false; begin begin update public.tasks set due_date=current_date+30 where id=current_setting('ba.texm')::uuid; exception when sqlstate 'CCD05' then rejected:=true; end; insert into batch_a_results(label,passed) values('direct write cannot use override',rejected); end $direct$;
insert into batch_a_results(label,passed) select 'override does not leak',coalesce(current_setting('ceit_connect.event_end_override_writer',true),'')='' and coalesce(current_setting('ceit_connect.event_end_override_event_id',true),'')='' and coalesce(current_setting('ceit_connect.event_end_override_is_set',true),'')='';
update public.tasks set title=title||' edited' where id=current_setting('ba.tgf')::uuid;
insert into batch_a_results(label,passed) select 'unrelated grandfathered edit succeeds',title like '% edited' from public.tasks where id=current_setting('ba.tgf')::uuid;
reset role;
insert into batch_a_results(label,passed)
select 'task deadline trigger exists',exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_i0_guard_event_end') union all
select 'event shortening trigger exists',exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and tgname='events_z0_guard_end_shortening') union all
select 'Manila conversion is used',pg_get_functiondef('ceit_connect_private.schedule_after_event_end(timestamptz,date)'::regprocedure) like '%Asia/Manila%' union all
select 'due is distinct-only',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%new.due_date is distinct from old.due_date%' union all
select 'call is distinct-only',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%new.call_time is distinct from old.call_time%' union all
select 'end is distinct-only',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%new.end_time is distinct from old.end_time%' union all
select 'due uses CCD05',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%CCD05%due_date is after%' and pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) not like '%CCD01%' union all
select 'call retains CCD02',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%CCD02%call_time is after%' union all
select 'end retains CCD03',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%CCD03%end_time is after%' union all
select 'null end is unbounded',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%v_end_date is null then return new%' union all
select 'equal end bypasses scan',pg_get_functiondef('ceit_connect_private.guard_event_end_shortening()'::regprocedure) like '%new.end_date is not distinct from old.end_date%' union all
select 'extension bypasses scan',pg_get_functiondef('ceit_connect_private.guard_event_end_shortening()'::regprocedure) like '%new.end_date >= old.end_date then return new%' union all
select 'null-to-value scans',pg_get_functiondef('ceit_connect_private.guard_event_end_shortening()'::regprocedure) like '%old.end_date is not null and new.end_date >= old.end_date%' union all
select 'event error has no title',pg_get_functiondef('ceit_connect_private.guard_event_end_shortening()'::regprocedure) not like '%task_row.title%' union all
select 'override requires exact trusted scope',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%current_user=''postgres''%event_end_override_writer%=''edit_event_with_tasks''%event_end_override_event_id%new.event_id::text%' union all
select 'wrapper clears success and error paths',regexp_count(pg_get_functiondef('public.edit_event_with_tasks_pre_batch_b(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)'::regprocedure),$pattern$event_end_override_writer[^;]*''[^;]*true$pattern$)=2 union all
select 'set-null differs from unset',pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%event_end_override_is_set%' and pg_get_functiondef('ceit_connect_private.guard_task_event_end()'::regprocedure) like '%nullif(current_setting(''ceit_connect.event_end_override_value''%';
do $report$ declare r record; v_count integer; v_failed text; begin for r in select * from batch_a_results order by seq loop raise notice '% %: %',lpad(r.seq::text,2,'0'),r.label,case when r.passed then 'PASS' else 'FAIL' end; end loop; select count(*),string_agg(seq::text||' '||label,', ' order by seq) filter(where not passed) into v_count,v_failed from batch_a_results; if v_count<>24 or v_failed is not null then raise exception 'Batch A deadline checks failed: expected 24 rows, got %; failed: %',v_count,coalesce(v_failed,'none (one or more result rows were missing)'); end if; end $report$;
do $$ begin raise exception 'TEST RESULTS: 24/24 PASS — transaction intentionally rolled back'; end $$;
```

Expected total: **60 evaluated PASS result lines** (20 + 16 + 24), followed by three intentional `TEST RESULTS ...` exceptions.
