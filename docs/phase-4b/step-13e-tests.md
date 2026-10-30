# Batch 13e — Dev SQL verification

Run this **one self-contained paste on Dev only**, in the SQL editor with the normal postgres dashboard context, after manually applying the Batch 13e migration. It creates its own `auth.users` fixtures, impersonates every caller through the JWT claim, uses transaction-local `ceit_connect.*` fixture markers only where required, and rolls everything back through the final exception.

Expected result-line count: **72**. The final exception must be exactly `TEST RESULTS: 72/72 PASS — transaction intentionally rolled back`.

```sql
begin;

select pg_catalog.set_config('timezone','Asia/Manila',true);

create temporary table batch13e_results (
  n integer generated always as identity,
  label text not null,
  passed boolean not null
) on commit drop;

create function pg_temp.ok(p_label text, p_passed boolean)
returns void language plpgsql as $$
begin
  insert into batch13e_results(label,passed) values(p_label,coalesce(p_passed,false));
end $$;

create function pg_temp.auth_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(p_user::text,''),true);
  perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
end $$;

do $fixtures$
declare
  t text := 'b13e-'||gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); coa uuid:=gen_random_uuid(); cob uuid:=gen_random_uuid();
  member_id uuid:=gen_random_uuid(); inactive_id uuid:=gen_random_uuid(); profileless uuid:=gen_random_uuid();
  ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); archived_id uuid:=gen_random_uuid(); active_id uuid:=gen_random_uuid();
  own_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid(); excluded_id uuid:=gen_random_uuid(); secret_id uuid:=gen_random_uuid();
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    t||'-'||label||'@example.test',crypt('Batch-13e!',gen_salt('bf')),now(),'{}',
    jsonb_build_object('batch_13e',t,'label',label),now(),now()
  from (values(admin_id,'admin'),(coa,'coa'),(cob,'cob'),(member_id,'member'),
    (inactive_id,'inactive'),(profileless,'profileless')) x(id,label);
  insert into public.committees(id,name) values(ca,t||' A'),(cb,t||' B');
  perform pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    (admin_id,t||'-admin@example.test','13e Admin','Admin',null,true),
    (coa,t||'-coa@example.test','13e Co A','Co-Admin',ca,true),
    (cob,t||'-cob@example.test','13e Co B','Co-Admin',cb,true),
    (inactive_id,t||'-inactive@example.test','13e Inactive','Co-Admin',ca,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id,is_active)
  values(member_id,t||'-member@example.test','13e Member','Member',ca,true);
  insert into public.events(id,name,start_date,end_date,status,created_by) values
    (archived_id,t||' archive',date '2026-10-01',date '2026-10-03','Active',admin_id),
    (active_id,t||' active',date '2026-10-01',date '2026-10-03','Active',admin_id);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','create_active_event_task',true);
  insert into public.tasks(id,event_id,committee_id,title,description,phase,status,priority,task_type,due_date,call_time,end_time,primary_assignees,assist_assignees,is_confidential,allowed_viewers,created_by,sort_order) values
    (own_id,archived_id,ca,'Own source','Own description','Setup','Completed','High','Deliverable','2026-10-02 00:00+08',null,null,'{}','{}',false,'{}',admin_id,1024),
    (foreign_id,archived_id,cb,'Foreign source','Foreign description','Live','In Progress','Critical','LiveOperation',null,'2026-10-02 23:00+08','2026-10-03 01:00+08','{}','{}',false,'{}',admin_id,2048),
    (excluded_id,archived_id,cb,'Excluded source',null,'Setup','To Do','Low','Deliverable',null,null,null,'{}','{}',false,'{}',admin_id,3072),
    (secret_id,archived_id,cb,'DO NOT LEAK','DO NOT LEAK','Secret','To Do','High','Deliverable',null,null,null,'{}','{}',true,'{}',admin_id,4096);
  perform pg_catalog.set_config('ceit_connect.task_access_writer','',true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
  -- Direct postgres-dashboard update. guard_event_updates permits only the
  -- Active-to-Archived transition; tasks had to be inserted while Active.
  update public.events set status='Archived' where id=archived_id;
  perform pg_catalog.set_config('b13e.admin',admin_id::text,true); perform pg_catalog.set_config('b13e.coa',coa::text,true);
  perform pg_catalog.set_config('b13e.cob',cob::text,true); perform pg_catalog.set_config('b13e.member',member_id::text,true);
  perform pg_catalog.set_config('b13e.inactive',inactive_id::text,true); perform pg_catalog.set_config('b13e.profileless',profileless::text,true);
  perform pg_catalog.set_config('b13e.ca',ca::text,true); perform pg_catalog.set_config('b13e.cb',cb::text,true);
  perform pg_catalog.set_config('b13e.archived',archived_id::text,true); perform pg_catalog.set_config('b13e.active',active_id::text,true);
  perform pg_catalog.set_config('b13e.own',own_id::text,true); perform pg_catalog.set_config('b13e.foreign',foreign_id::text,true);
  perform pg_catalog.set_config('b13e.excluded',excluded_id::text,true); perform pg_catalog.set_config('b13e.secret',secret_id::text,true);
end $fixtures$;

-- 01–24: signatures, grants, ownership, policies, markers, and lock order.
do $catalog$
declare r regprocedure; c regprocedure; i regprocedure; rb text; wb text; cb text;
begin
  r:='public.get_archived_event_template(uuid,date)'::regprocedure;
  c:='public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)'::regprocedure;
  i:='public.copy_archived_template_tasks(uuid,uuid,date,uuid[])'::regprocedure;
  select prosrc into rb from pg_proc where oid=r; select prosrc into wb from pg_proc where oid=c; select prosrc into cb from pg_proc where oid=i;
  perform pg_temp.ok('01 reader sole signature',(select count(*)=1 from pg_proc where pronamespace='public'::regnamespace and proname='get_archived_event_template'));
  perform pg_temp.ok('02 reader unchanged table shape',(select proallargtypes[3:7]=array['text'::regtype,'date'::regtype,'jsonb'::regtype,'integer'::regtype,'integer'::regtype]::oid[] from pg_proc where oid=r));
  perform pg_temp.ok('03 reader postgres definer empty path',(select pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=r));
  perform pg_temp.ok('04 reader stable',(select provolatile='s' from pg_proc where oid=r));
  perform pg_temp.ok('05 reader exact grant',has_function_privilege('authenticated',r,'execute') and not has_function_privilege('anon',r,'execute'));
  perform pg_temp.ok('06 public writer sole signature',(select count(*)=1 from pg_proc where pronamespace='public'::regnamespace and proname='create_event_from_archived_template'));
  perform pg_temp.ok('07 public writer postgres definer empty path',(select pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=c));
  perform pg_temp.ok('08 public writer volatile',(select provolatile='v' from pg_proc where oid=c));
  perform pg_temp.ok('09 public writer exact grant',has_function_privilege('authenticated',c,'execute') and not has_function_privilege('anon',c,'execute') and not has_function_privilege('public',c,'execute'));
  perform pg_temp.ok('10 copier sole signature',(select count(*)=1 from pg_proc where pronamespace='public'::regnamespace and proname='copy_archived_template_tasks'));
  perform pg_temp.ok('11 copier postgres definer empty path',(select pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=i));
  perform pg_temp.ok('12 copier fully revoked',not has_function_privilege('public',i,'execute') and not has_function_privilege('anon',i,'execute') and not has_function_privilege('authenticated',i,'execute'));
  perform pg_temp.ok('13 auth precedes user lock',strpos(wb,'select user_row.committee_id')<strpos(wb,'lock_task_assignee_users'));
  perform pg_temp.ok('14 Step10 users precede source lock',strpos(wb,'lock_task_assignee_users')<strpos(wb,'for share'));
  perform pg_temp.ok('15 source lock precedes cap lock',strpos(wb,'for share')<strpos(wb,'lock_draft_event_creator'));
  perform pg_temp.ok('16 Draft cap after cap lock',strpos(wb,'lock_draft_event_creator')<strpos(wb,'count_creator_draft_events'));
  perform pg_temp.ok('17 200 cap after cap lock',strpos(wb,'lock_draft_event_creator')<strpos(wb,'v_own_task_count + v_retained_copy_count > 200'));
  perform pg_temp.ok('18 marker exact name',wb~'''create_event_from_archived_template''');
  perform pg_temp.ok('19 marker success cleanup',strpos(wb,'''create_event_from_archived_template''')<strpos(wb,'''ceit_connect.task_assignee_writer'', '''', true'));
  perform pg_temp.ok('20 marker exception cleanup',wb~'exception[[:space:]]+when others then[[:space:]]+perform pg_catalog.set_config');
  perform pg_temp.ok('21 guard null safe and postgres',(select prosrc~'current_setting.*true' and prosrc~'current_user = ''postgres''' from pg_proc where oid='public.guard_task_assignee_writes()'::regprocedure));
  perform pg_temp.ok('22 guard exact new writer once',(select length(prosrc)-length(replace(prosrc,'create_event_from_archived_template',''))=length('create_event_from_archived_template') from pg_proc where oid='public.guard_task_assignee_writes()'::regprocedure));
  perform pg_temp.ok('23 task policies unchanged',(select count(*)>=3 from pg_policies where schemaname='public' and tablename='tasks'));
  perform pg_temp.ok('24 no general client copier',cb~'source_task.event_id = p_template_event_id' and cb~'source_task.is_confidential is false' and cb~'source_task.committee_id is distinct from v_caller_committee_id');
end $catalog$;

-- 25–36: reader matrix and aggregate-only confidentiality behavior.
do $reader$
declare d record; denied boolean;
begin
  perform pg_temp.auth_as(current_setting('b13e.coa')::uuid);
  select * into d from public.get_archived_event_template(current_setting('b13e.archived')::uuid,date '2026-11-01');
  perform pg_temp.ok('25 Co-Admin reader returns one row',found);
  perform pg_temp.ok('26 all non-confidential rows returned',d.imported_task_count=3 and jsonb_array_length(d.tasks)=3);
  perform pg_temp.ok('27 confidential aggregate all committees',d.skipped_confidential_count=1);
  perform pg_temp.ok('28 confidential content absent',d.tasks::text not like '%DO NOT LEAK%');
  perform pg_temp.ok('29 source ids present',(select bool_and(x?'source_task_id') from jsonb_array_elements(d.tasks)x));
  perform pg_temp.ok('30 status forced To Do',(select bool_and(x->>'status'='To Do') from jsonb_array_elements(d.tasks)x));
  perform pg_temp.ok('31 assignees empty',(select bool_and(x->'assignee_ids'='[]') from jsonb_array_elements(d.tasks)x));
  perform pg_temp.ok('32 integer-day shift',(select x->>'due_date' like '2026-11-02%' from jsonb_array_elements(d.tasks)x where x->>'source_task_id'=current_setting('b13e.own')));
  perform pg_temp.ok('33 multi-day end preserved',(select (x->>'end_time')::timestamptz>(x->>'call_time')::timestamptz and ((x->>'end_time')::date>(x->>'call_time')::date) from jsonb_array_elements(d.tasks)x where x->>'source_task_id'=current_setting('b13e.foreign')));
  perform pg_temp.auth_as(current_setting('b13e.admin')::uuid); select * into d from public.get_archived_event_template(current_setting('b13e.archived')::uuid,date '2026-11-01');
  perform pg_temp.ok('34 Admin reader unchanged access',d.imported_task_count=3 and d.skipped_confidential_count=1);
  begin perform pg_temp.auth_as(current_setting('b13e.member')::uuid); perform public.get_archived_event_template(current_setting('b13e.archived')::uuid,current_date); denied:=false; exception when sqlstate '42501' then denied:=true; end;
  perform pg_temp.ok('35 Member reader rejected',denied);
  begin perform pg_temp.auth_as(current_setting('b13e.inactive')::uuid); perform public.get_archived_event_template(current_setting('b13e.archived')::uuid,current_date); denied:=false; exception when sqlstate '42501' then denied:=true; end;
  perform pg_temp.ok('36 inactive/profile-less/anonymous readers rejected',denied);
  begin perform pg_temp.auth_as(current_setting('b13e.profileless')::uuid); perform public.get_archived_event_template(current_setting('b13e.archived')::uuid,current_date); denied:=false; exception when sqlstate '42501' then denied:=true; end;
  update batch13e_results set passed=passed and denied where label='36 inactive/profile-less/anonymous readers rejected';
  begin perform pg_temp.auth_as(null::uuid); perform public.get_archived_event_template(current_setting('b13e.archived')::uuid,current_date); denied:=false; exception when sqlstate '42501' then denied:=true; end;
  update batch13e_results set passed=passed and denied where label='36 inactive/profile-less/anonymous readers rejected';
end $reader$;

-- 37–58: successful atomic create, exclusions, defaults, dates, log, and payload proof.
do $create$
declare eid uuid; denied boolean; own jsonb;
begin
  own:=jsonb_build_array(jsonb_build_object('title','Edited own','description','Client own','phase','Setup','committee_id',current_setting('b13e.ca'),'task_type','LiveOperation','priority','High','due_date','2026-11-02','call_time','2026-11-02T23:00:00+08:00','end_time','2026-11-03T01:00:00+08:00','assignee_ids',jsonb_build_array(current_setting('b13e.member'))));
  perform pg_temp.auth_as(current_setting('b13e.coa')::uuid);
  eid:=public.create_event_from_archived_template('Created 13e',null,date '2026-11-01',date '2026-11-04','Active',current_setting('b13e.archived')::uuid,own,jsonb_build_array(current_setting('b13e.excluded'),current_setting('b13e.own'),gen_random_uuid()));
  perform pg_catalog.set_config('b13e.created',eid::text,true);
  perform pg_temp.ok('37 event created',eid is not null);
  perform pg_temp.ok('38 creator derived from auth.uid()',(select created_by=current_setting('b13e.coa')::uuid from public.events where id=eid));
  perform pg_temp.ok('39 only retained total inserted',(select count(*)=2 from public.tasks where event_id=eid));
  perform pg_temp.ok('40 own payload inserted once',(select count(*)=1 from public.tasks where event_id=eid and committee_id=current_setting('b13e.ca')::uuid));
  perform pg_temp.ok('41 foreign server row inserted once',(select count(*)=1 from public.tasks where event_id=eid and committee_id=current_setting('b13e.cb')::uuid));
  perform pg_temp.ok('42 valid unrelated exclusion ignored',(select count(*)=2 from public.tasks where event_id=eid));
  perform pg_temp.ok('43 own exclusion ignored',(select count(*)=1 from public.tasks where event_id=eid and title='Edited own'));
  perform pg_temp.ok('44 foreign exclusion reduced set',(select count(*)=0 from public.tasks where event_id=eid and title='Excluded source'));
  perform pg_temp.ok('45 foreign title re-derived',(select count(*)=1 from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('46 foreign committee retained',(select committee_id=current_setting('b13e.cb')::uuid from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('47 foreign status To Do',(select status='To Do' from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('48 foreign assignees empty',(select cardinality(primary_assignees)=0 and cardinality(assist_assignees)=0 from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('49 foreign confidentiality reset',(select not is_confidential and cardinality(allowed_viewers)=0 from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('50 foreign auxiliary fields reset',(select not request_backup and depends_on_task_id is null from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('51 foreign multi-day shift',(select end_time::date>call_time::date from public.tasks where event_id=eid and title='Foreign source'));
  perform pg_temp.ok('52 own multi-day validator accepted',(select end_time::date>call_time::date from public.tasks where event_id=eid and title='Edited own'));
  perform pg_temp.ok('53 own assignee accepted under narrow marker',(select primary_assignees=array[current_setting('b13e.member')::uuid] from public.tasks where event_id=eid and title='Edited own'));
  perform pg_temp.ok('54 marker cleared on success',coalesce(current_setting('ceit_connect.task_assignee_writer',true),'')='');
  perform pg_temp.ok('55 INSERT activity rows exist',(select count(*)=2 from public.activity_log where task_id in(select id from public.tasks where event_id=eid) and action='INSERT'));
  perform pg_temp.auth_as(current_setting('b13e.admin')::uuid);
  perform pg_temp.ok('56 Batch12 reader shows copied INSERT',(select count(*)>=1 from public.list_activity_log(null,'newest','INSERT',current_setting('b13e.cb')::uuid,null,null,'Foreign source',null,null,20) where task_title='Foreign source' and not is_masked));
  perform pg_temp.ok('57 activity snapshot has no source token',(select bool_and(changes::text not like '%source_task_id%') from public.activity_log where task_id in(select id from public.tasks where event_id=eid)));
  perform pg_temp.ok('58 no confidential source activity copied',(select count(*)=0 from public.activity_log where task_id in(select id from public.tasks where event_id=eid) and changes::text like '%DO NOT LEAK%'));
end $create$;

-- 59–72: rejection/atomicity/caps and fixed safe failures.
do $negative$
declare denied boolean; before_count integer; bad_id uuid:=gen_random_uuid(); i integer; own jsonb:='[]'; retained_foreign_count integer;
begin
  select count(*) into before_count from public.events;
  perform pg_temp.auth_as(current_setting('b13e.admin')::uuid);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCT01' then denied:=true; end;
  perform pg_temp.ok('59 Admin writer rejected fixed',denied);
  perform pg_temp.auth_as(current_setting('b13e.member')::uuid);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCT01' then denied:=true; end;
  perform pg_temp.ok('60 Member writer rejected fixed',denied);
  perform pg_temp.auth_as(current_setting('b13e.inactive')::uuid);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCT01' then denied:=true; end;
  perform pg_temp.ok('61 inactive writer rejected fixed',denied);
  perform pg_temp.auth_as(current_setting('b13e.profileless')::uuid);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCT01' then denied:=true; end;
  perform pg_temp.ok('62 profile-less writer rejected fixed',denied);
  perform pg_temp.auth_as(null::uuid);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCT01' then denied:=true; end;
  perform pg_temp.ok('63 anonymous writer rejected fixed',denied);
  perform pg_temp.auth_as(current_setting('b13e.coa')::uuid);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.active')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCT02' then denied:=true; end;
  perform pg_temp.ok('64 non-Archived source rejected',denied);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',bad_id,'[]','[]'); denied:=false; exception when sqlstate 'CCT02' then denied:=true; end;
  perform pg_temp.ok('65 missing source fixed safe error',denied);
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','["bad"]'); denied:=false; exception when sqlstate 'CCT03' then denied:=true; end;
  perform pg_temp.ok('66 malformed exclusion fixed safe error',denied);
  perform pg_temp.ok('67 failed calls atomic',(select count(*)=before_count from public.events));
  own:=jsonb_build_array(jsonb_build_object('title','Wrong committee','phase','P','committee_id',current_setting('b13e.cb'),'task_type','Deliverable','priority','Low','due_date',null,'call_time',null,'end_time',null,'assignee_ids','[]'::jsonb));
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,own,'[]'); denied:=false; exception when sqlstate '42501' then denied:=true; end;
  perform pg_temp.ok('68 cross-committee client draft rejected',denied);
  perform pg_temp.ok('69 cross-committee failure atomic and marker cleared',(select count(*)=before_count from public.events) and coalesce(current_setting('ceit_connect.task_assignee_writer',true),'')='');
  for i in 1..10 loop insert into public.events(name,start_date,status,created_by) values('cap '||i,current_date,'Draft',current_setting('b13e.coa')::uuid); end loop;
  begin perform public.create_event_from_archived_template('No',null,current_date,current_date,'Draft',current_setting('b13e.archived')::uuid,'[]','[]'); denied:=false; exception when sqlstate 'CCD01' then denied:=true; end;
  perform pg_temp.ok('70 per-creator Draft cap enforced after lock',denied);
  select jsonb_agg(jsonb_build_object(
    'title','Own cap task '||g,
    'committee_id',current_setting('b13e.ca'),
    'phase','Cap',
    'task_type','Deliverable',
    'priority','Low',
    'due_date',null,
    'call_time',null,
    'end_time',null,
    'assignee_ids','[]'::jsonb
  ) order by g) into own from generate_series(1,199) as generated(g);
  select count(*)::integer into retained_foreign_count
  from public.tasks
  where event_id=current_setting('b13e.archived')::uuid
    and committee_id<>current_setting('b13e.ca')::uuid
    and is_confidential is false;
  begin
    perform public.create_event_from_archived_template('No',null,current_date,current_date,'Active',current_setting('b13e.archived')::uuid,own,'[]');
    denied:=false;
  exception when sqlstate 'CCP01' then
    denied:=true;
  end;
  perform pg_temp.ok('71 combined 200-task cap enforced',denied and retained_foreign_count=2);
  perform pg_temp.ok('72 no cap failure residue',(select count(*)=0 from public.events where name='No'));
end $negative$;

select n,label,case when passed then 'PASS' else 'FAIL' end as result
from batch13e_results order by n;

do $final$
declare total integer; failures text;
begin
  select count(*),string_agg(n||' '||label,', ' order by n) filter(where not passed)
  into total,failures from batch13e_results;
  if total<>72 or failures is not null then
    raise exception 'TEST RESULTS: %/72 PASS — failures: %',total-coalesce(array_length(string_to_array(failures,','),1),0),coalesce(failures,'wrong result count');
  end if;
  raise exception 'TEST RESULTS: 72/72 PASS — transaction intentionally rolled back';
end $final$;
```
