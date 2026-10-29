# Phase 4B Batch 11 — Run 1 database tests

Run these only after both Batch 11 migrations have been applied by the owner.
Each paste is self-contained, uses unique fixtures, has no temporary tables,
and intentionally ends with `TEST RESULTS` so the whole transaction rolls
back. The catalog portion of each paste is one single-row `jsonb` select.

Expected result-line counts:

| SQL test | Final `TEST RESULTS` lines | Separate catalog rows |
| --- | ---: | ---: |
| 1 — writer behavior | 19 | 0 |
| 2 — timestamp/readers/logger catalogs | 13 | 1 |
| 3 — capacity/guards/lock-order catalogs | 20 | 1 |
| 4 — stored-priority reader | 9 | 0 |
| **Total** | **61** | **2** |

## SQL Test 1 — Active-event writer behavior (19 lines)

This paste covers Add/Edit derivation, owning and stale Co-Admin checks,
confidential validation, assist promotion, volunteer cleanup, emptying an In
Progress task, emptying a Completed task, no-op/stale errors, and phase-tail
placement over an RLS-hidden row.

```sql
begin;

insert into public.committees(id,name) values
 ('b1101000-0000-4000-8000-000000000001','B11 T1 Own'),
 ('b1101000-0000-4000-8000-000000000002','B11 T1 Other');

insert into auth.users(
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
 ('b1101000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t1-admin@test.local','',now(),'{}','{}',now(),now()),
 ('b1101000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t1-co@test.local','',now(),'{}','{}',now(),now()),
 ('b1101000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t1-primary@test.local','',now(),'{}','{}',now(),now()),
 ('b1101000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t1-assist@test.local','',now(),'{}','{}',now(),now()),
 ('b1101000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t1-viewer@test.local','',now(),'{}','{}',now(),now()),
 ('b1101000-0000-4000-8000-000000000016','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t1-inactive@test.local','',now(),'{}','{}',now(),now());

select pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('b1101000-0000-4000-8000-000000000011','b11t1-admin@test.local','B11 T1 Admin','Admin',null,true),
 ('b1101000-0000-4000-8000-000000000012','b11t1-co@test.local','B11 T1 Co','Co-Admin','b1101000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('ceit_connect.officer_writer','',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('b1101000-0000-4000-8000-000000000013','b11t1-primary@test.local','B11 T1 Primary','Member','b1101000-0000-4000-8000-000000000001',true),
 ('b1101000-0000-4000-8000-000000000014','b11t1-assist@test.local','B11 T1 Assist','Member','b1101000-0000-4000-8000-000000000001',true),
 ('b1101000-0000-4000-8000-000000000015','b11t1-viewer@test.local','B11 T1 Viewer','Member','b1101000-0000-4000-8000-000000000002',true),
 ('b1101000-0000-4000-8000-000000000016','b11t1-inactive@test.local','B11 T1 Inactive','Member','b1101000-0000-4000-8000-000000000001',false);

select pg_catalog.set_config('request.jwt.claim.sub','b1101000-0000-4000-8000-000000000011',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('b1101000-0000-4000-8000-000000000101','B11 T1 Active','2026-10-01','2026-12-31','Active','b1101000-0000-4000-8000-000000000011');

select pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
insert into public.tasks(
 id,event_id,committee_id,title,phase,status,sort_order,primary_assignees,
 assist_assignees,is_confidential,allowed_viewers,request_backup,created_by
) values
 ('b1101000-0000-4000-8000-000000000201','b1101000-0000-4000-8000-000000000101','b1101000-0000-4000-8000-000000000001','In progress','Planning','In Progress',1024,array['b1101000-0000-4000-8000-000000000013'::uuid],array['b1101000-0000-4000-8000-000000000014'::uuid],false,'{}',true,'b1101000-0000-4000-8000-000000000011'),
 ('b1101000-0000-4000-8000-000000000202','b1101000-0000-4000-8000-000000000101','b1101000-0000-4000-8000-000000000001','Completed','Planning','Completed',1024,array['b1101000-0000-4000-8000-000000000013'::uuid],'{}',false,'{}',false,'b1101000-0000-4000-8000-000000000011'),
 ('b1101000-0000-4000-8000-000000000203','b1101000-0000-4000-8000-000000000101','b1101000-0000-4000-8000-000000000002','Hidden In Progress tail','Execution','In Progress',8192,'{}','{}',true,'{}',false,'b1101000-0000-4000-8000-000000000011'),
 ('b1101000-0000-4000-8000-000000000204','b1101000-0000-4000-8000-000000000101','b1101000-0000-4000-8000-000000000002','Hidden To Do tail','Execution','To Do',8192,'{}','{}',true,'{}',false,'b1101000-0000-4000-8000-000000000011');
select pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
select pg_catalog.set_config('ceit_connect.task_assignee_writer','move_task',true);
update public.tasks set sort_order=8192
where id in (
  'b1101000-0000-4000-8000-000000000203',
  'b1101000-0000-4000-8000-000000000204'
);
select pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);

insert into public.task_volunteers(task_id,user_id)
values ('b1101000-0000-4000-8000-000000000201','b1101000-0000-4000-8000-000000000014');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','b1101000-0000-4000-8000-000000000012',true);

do $$
declare
  r text := '';
  t1 timestamptz;
  t2 timestamptz;
  made uuid;
  made_token timestamptz;
  made_status text;
  made_rank bigint;
  denied boolean;
  volunteer_removed boolean;
  s text;
  n bigint;
  returned_token timestamptz;
  edit_body text;
  owner_guard_body text;
begin
  select out_task_id,out_updated_at into made,made_token
  from public.create_active_event_task(
    'b1101000-0000-4000-8000-000000000101','Added',null,'Planning',
    'b1101000-0000-4000-8000-000000000001','Deliverable','Medium',
    null,null,null,array['b1101000-0000-4000-8000-000000000013'::uuid],
    true,array['b1101000-0000-4000-8000-000000000015'::uuid]
  );
  r:=r||format(E'\nADD_ACTIVE_OWN_COMMITTEE: %s',
    case when exists(select 1 from public.tasks where id=made and committee_id='b1101000-0000-4000-8000-000000000001') then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nADD_DERIVES_EVENT_CREATOR_STATUS_RANK: %s',
    case when exists(select 1 from public.tasks where id=made and event_id='b1101000-0000-4000-8000-000000000101' and created_by='b1101000-0000-4000-8000-000000000012' and status='To Do' and sort_order is not null) then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nADD_STARTS_WITH_NO_ASSISTS: %s',
    case when (select cardinality(assist_assignees)=0 from public.tasks where id=made) then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nADD_CONFIDENTIAL_VIEWERS_STORED: %s',
    case when (select is_confidential and allowed_viewers=array['b1101000-0000-4000-8000-000000000015'::uuid] from public.tasks where id=made) then 'PASS' else 'FAIL' end);

  select status,sort_order
  into made_status,made_rank
  from public.tasks where id=made;
  select out_updated_at into returned_token
  from public.edit_active_event_task(
    made,made_token,'Added revised',null,'Planning',
    'b1101000-0000-4000-8000-000000000001','Deliverable','Medium',
    null,null,null,array['b1101000-0000-4000-8000-000000000013'::uuid],
    true,array['b1101000-0000-4000-8000-000000000015'::uuid]
  );
  r:=r||format(E'\nCONTENT_EDIT_CANNOT_CHANGE_STATUS_OR_RANK: %s',
    case when (select status=made_status and sort_order=made_rank from public.tasks where id=made) then 'PASS' else 'FAIL' end);

  select updated_at into t1 from public.tasks where id='b1101000-0000-4000-8000-000000000201';
  perform public.edit_active_event_task(
    'b1101000-0000-4000-8000-000000000201',t1,'In progress edited',null,
    'Execution','b1101000-0000-4000-8000-000000000001','Deliverable','High',
    null,null,null,array['b1101000-0000-4000-8000-000000000014'::uuid],
    false,'{}'
  );
  r:=r||format(E'\nASSIST_PROMOTED_AND_REMOVED_FROM_ASSISTS: %s',
    case when (select primary_assignees=array['b1101000-0000-4000-8000-000000000014'::uuid] and cardinality(assist_assignees)=0 from public.tasks where id='b1101000-0000-4000-8000-000000000201') then 'PASS' else 'FAIL' end);
  set local role postgres;
  select not exists(
    select 1 from public.task_volunteers
    where task_id='b1101000-0000-4000-8000-000000000201'
      and user_id='b1101000-0000-4000-8000-000000000014'
  ) into volunteer_removed;
  set local role authenticated;
  r:=r||format(E'\nREDUNDANT_VOLUNTEER_REMOVED: %s',
    case when volunteer_removed then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nPHASE_CHANGE_USES_TRUE_HIDDEN_TAIL: %s',
    case when (select sort_order=9216 from public.tasks where id='b1101000-0000-4000-8000-000000000201') then 'PASS' else 'FAIL' end);

  select updated_at into t1 from public.tasks where id='b1101000-0000-4000-8000-000000000201';
  perform public.edit_active_event_task(
    'b1101000-0000-4000-8000-000000000201',t1,'In progress edited',null,
    'Execution','b1101000-0000-4000-8000-000000000001','Deliverable','High',
    null,null,null,'{}',false,'{}'
  );
  select status,sort_order into s,n from public.tasks where id='b1101000-0000-4000-8000-000000000201';
  r:=r||format(E'\nEMPTY_IN_PROGRESS_RESETS_TO_DO: %s',case when s='To Do' then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nRESET_APPENDS_TO_DESTINATION_TAIL: %s',case when n>8192 then 'PASS' else 'FAIL' end);

  select updated_at into t2 from public.tasks where id='b1101000-0000-4000-8000-000000000202';
  perform public.edit_active_event_task(
    'b1101000-0000-4000-8000-000000000202',t2,'Completed',null,'Planning',
    'b1101000-0000-4000-8000-000000000001','Deliverable','Medium',
    null,null,null,'{}',false,'{}'
  );
  r:=r||format(E'\nEMPTY_COMPLETED_STAYS_COMPLETED: %s',
    case when (select status='Completed' from public.tasks where id='b1101000-0000-4000-8000-000000000202') then 'PASS' else 'FAIL' end);

  denied:=false;
  begin
    perform public.edit_active_event_task(
      'b1101000-0000-4000-8000-000000000202',t2,'Stale',null,'Planning',
      'b1101000-0000-4000-8000-000000000001','Deliverable','Medium',
      null,null,null,'{}',false,'{}');
  exception when sqlstate 'CCS01' then denied:=true; end;
  r:=r||format(E'\nSTALE_TOKEN_CCS01: %s',case when denied then 'PASS' else 'FAIL' end);

  select updated_at into t2 from public.tasks where id='b1101000-0000-4000-8000-000000000202';
  denied:=false;
  begin
    perform public.edit_active_event_task(
      'b1101000-0000-4000-8000-000000000202',t2,'Completed',null,'Planning',
      'b1101000-0000-4000-8000-000000000001','Deliverable','Medium',
      null,null,null,'{}',false,'{}');
  exception when sqlstate 'CCN01' then denied:=true; end;
  r:=r||format(E'\nNO_OP_CCN01: %s',case when denied then 'PASS' else 'FAIL' end);

  denied:=false;
  begin
    perform public.create_active_event_task(
      'b1101000-0000-4000-8000-000000000101','Wrong committee',null,'Planning',
      'b1101000-0000-4000-8000-000000000002','Deliverable','Medium',
      null,null,null,'{}',false,'{}');
  exception when insufficient_privilege then denied:=true; end;
  r:=r||format(E'\nCOADMIN_PROPOSED_COMMITTEE_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);

  denied:=false;
  begin
    perform public.create_active_event_task(
      'b1101000-0000-4000-8000-000000000101','Inactive viewer',null,'Planning',
      'b1101000-0000-4000-8000-000000000001','Deliverable','Medium',
      null,null,null,'{}',true,array['b1101000-0000-4000-8000-000000000016'::uuid]);
  exception when invalid_parameter_value then denied:=true; end;
  r:=r||format(E'\nNEW_INACTIVE_VIEWER_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(
    'public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure
  )) into edit_body;
  select lower(pg_catalog.pg_get_functiondef(
    'public.restrict_assignee_task_updates()'::regprocedure
  )) into owner_guard_body;
  r:=r||format(E'\nSTORED_AND_PROPOSED_COMMITTEE_RECHECK_PRESENT: %s',case when edit_body like '%v_stored_committee_id is distinct from v_my_committee_id%' and edit_body like '%p_committee_id is distinct from v_my_committee_id%' then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nREAL_CONTENT_ACCESS_RECHECK_PRESENT: %s',case when strpos(edit_body,'task_content_access(p_task_id)')>0 and strpos(substring(edit_body from strpos(edit_body,'task_content_access(p_task_id)')+1),'task_content_access(p_task_id)')>0 then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nOWNER_GUARD_SEES_RESET_STATUS_AND_RANK: %s',case when owner_guard_body like '%edit_active_event_task%' and owner_guard_body like '%- ''status'' - ''sort_order''%' then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nUPDATED_AT_RETURNED_AS_DATABASE_TOKEN: %s',case when returned_token=(select updated_at from public.tasks where id=made) and returned_token>made_token then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %',r;
end $$;
```

The stale role/committee race is additionally pinned structurally in SQL Test 3:
the writer must re-read the caller profile after its event/task lock wait. A
manual two-session version belongs in the Dev gate because one transaction
cannot change the same caller row concurrently without blocking itself.

## SQL Test 2 — timestamp, readers, logger, and real trigger order (13 lines)

```sql
begin;

insert into public.committees(id,name)
values ('b1102000-0000-4000-8000-000000000001','B11 T2');
insert into auth.users(
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
 ('b1102000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t2-admin@test.local','',now(),'{}','{}',now(),now());

select pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values ('b1102000-0000-4000-8000-000000000011','b11t2-admin@test.local','B11 T2 Admin','Admin',null,true);
select pg_catalog.set_config('ceit_connect.officer_writer','',true);
select pg_catalog.set_config('request.jwt.claim.sub','b1102000-0000-4000-8000-000000000011',true);
insert into public.events(id,name,start_date,end_date,status,created_by)
values ('b1102000-0000-4000-8000-000000000101','B11 T2 Active','2026-10-01','2026-12-31','Active','b1102000-0000-4000-8000-000000000011');
select pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,sort_order,created_by)
values ('b1102000-0000-4000-8000-000000000201','b1102000-0000-4000-8000-000000000101','b1102000-0000-4000-8000-000000000001','Token task','Planning','To Do',1024,'b1102000-0000-4000-8000-000000000011');
select pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);

select pg_catalog.jsonb_build_object(
 'updated_at', exists(select 1 from pg_catalog.pg_attribute where attrelid='public.tasks'::regclass and attname='updated_at' and attnotnull),
 'trigger_order', (
   select pg_catalog.jsonb_agg(t.tgname order by t.tgname)
   from pg_catalog.pg_trigger t
   where t.tgrelid='public.tasks'::regclass and not t.tgisinternal
     and (t.tgtype & 2)=2 and (t.tgtype & 16)=16
 ),
 'detail_signature', pg_catalog.pg_get_function_result('public.get_task_detail(uuid)'::regprocedure),
 'controls_signature', pg_catalog.pg_get_function_result('public.get_task_edit_controls(uuid)'::regprocedure)
) as catalog_checks;

do $$
declare
 r text:='';
 before_token timestamptz;
 after_token timestamptz;
 before_activity integer;
 after_activity integer;
 body text;
 trigger_names text[];
begin
 select lower(pg_catalog.pg_get_functiondef('public.log_task_activity()'::regprocedure)) into body;
 r:=r||format(E'\nLOGGER_COMPARE_EXCLUDES_UPDATED_AT: %s',case when body like '%- ''sort_order'' - ''updated_at''%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nLOGGER_SNAPSHOTS_EXCLUDE_UPDATED_AT: %s',case when body like '%to_jsonb(new) - ''updated_at''%' and body like '%to_jsonb(old) - ''updated_at''%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nDETAIL_HAS_UPDATED_AT: %s',case when pg_catalog.pg_get_function_result('public.get_task_detail(uuid)'::regprocedure) like '%updated_at timestamp with time zone%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nCONTROLS_HAS_CAN_EDIT_TASK: %s',case when pg_catalog.pg_get_function_result('public.get_task_edit_controls(uuid)'::regprocedure) like '%can_edit_task boolean%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nREADERS_NO_OVERLOADS: %s',case when (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_task_detail','get_task_edit_controls'))=2 then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nREADERS_AUTH_ONLY: %s',case when pg_catalog.has_function_privilege('authenticated','public.get_task_detail(uuid)','execute') and not pg_catalog.has_function_privilege('anon','public.get_task_detail(uuid)','execute') and pg_catalog.has_function_privilege('authenticated','public.get_task_edit_controls(uuid)','execute') and not pg_catalog.has_function_privilege('anon','public.get_task_edit_controls(uuid)','execute') then 'PASS' else 'FAIL' end);

 select array_agg(t.tgname order by t.tgname) into trigger_names
 from pg_catalog.pg_trigger t
 where t.tgrelid='public.tasks'::regclass and not t.tgisinternal
   and (t.tgtype & 2)=2 and (t.tgtype & 16)=16;
 r:=r||format(E'\nUPDATED_TRIGGER_IS_LAST_REAL_BEFORE_UPDATE_TRIGGER: %s',case when array_position(trigger_names,'tasks_z4_set_updated_at')=cardinality(trigger_names) and array_position(trigger_names,'tasks_z4_set_updated_at')>array_position(trigger_names,'tasks_z2_set_destination_lane_order') then 'PASS' else 'FAIL' end);

 select updated_at into before_token
 from public.tasks
 where id='b1102000-0000-4000-8000-000000000201';
 select count(*) into before_activity
 from public.activity_log
 where task_id='b1102000-0000-4000-8000-000000000201'
   and action='UPDATE';
 select pg_catalog.set_config('ceit_connect.task_assignee_writer','move_task',true);
 update public.tasks set sort_order=2048 where id='b1102000-0000-4000-8000-000000000201';
 select pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);
 select updated_at into after_token from public.tasks where id='b1102000-0000-4000-8000-000000000201';
 select count(*) into after_activity from public.activity_log where task_id='b1102000-0000-4000-8000-000000000201' and action='UPDATE';
 r:=r||format(E'\nRANK_ONLY_TOKEN_UNCHANGED: %s',case when after_token=before_token then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nRANK_ONLY_NO_ACTIVITY: %s',case when after_activity=before_activity then 'PASS' else 'FAIL' end);

 update public.tasks set status='In Progress' where id='b1102000-0000-4000-8000-000000000201';
 r:=r||format(E'\nSTATUS_ONLY_TOKEN_ADVANCES: %s',case when (select updated_at>after_token from public.tasks where id='b1102000-0000-4000-8000-000000000201') then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nSTATUS_ONLY_ACTIVITY_STILL_UPDATE: %s',case when (select count(*) from public.activity_log where task_id='b1102000-0000-4000-8000-000000000201' and action='UPDATE')=after_activity+1 then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nACTIVITY_JSON_NEVER_HAS_UPDATED_AT: %s',case when not exists(select 1 from public.activity_log where task_id='b1102000-0000-4000-8000-000000000201' and changes::text like '%updated_at%') then 'PASS' else 'FAIL' end);
 r:=r||E'\nMANUAL_EXISTING_ROWS_INITIALIZED_BY_DDL_DEFAULT: MANUAL — inspect a pre-migration row after applying Migration A';
 raise exception 'TEST RESULTS %',r;
end $$;
```

## SQL Test 3 — cap, guards, CCL01, and lock-order bodies (20 lines)

```sql
begin;

insert into public.committees(id,name) values
 ('b1103000-0000-4000-8000-000000000001','B11 T3 Own'),
 ('b1103000-0000-4000-8000-000000000002','B11 T3 Hidden');
insert into auth.users(
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
 ('b1103000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t3-admin@test.local','',now(),'{}','{}',now(),now()),
 ('b1103000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11t3-co@test.local','',now(),'{}','{}',now(),now());
select pg_catalog.set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values
 ('b1103000-0000-4000-8000-000000000011','b11t3-admin@test.local','B11 T3 Admin','Admin',null,true),
 ('b1103000-0000-4000-8000-000000000012','b11t3-co@test.local','B11 T3 Co','Co-Admin','b1103000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('ceit_connect.officer_writer','',true);
select pg_catalog.set_config('request.jwt.claim.sub','b1103000-0000-4000-8000-000000000011',true);
insert into public.events(id,name,start_date,end_date,status,created_by)
values ('b1103000-0000-4000-8000-000000000101','B11 T3 Active','2026-10-01','2026-12-31','Active','b1103000-0000-4000-8000-000000000011');

select pg_catalog.set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
insert into public.tasks(
 event_id,committee_id,title,phase,is_confidential,created_by
)
select 'b1103000-0000-4000-8000-000000000101',
       case when i=1 then 'b1103000-0000-4000-8000-000000000002'::uuid else 'b1103000-0000-4000-8000-000000000001'::uuid end,
       'Capacity '||i,'Planning',i=1,'b1103000-0000-4000-8000-000000000011'
from pg_catalog.generate_series(1,199) series(i);
select pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);

select pg_catalog.jsonb_build_object(
 'capacity_trigger', exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_a0_enforce_event_capacity' and not tgisinternal),
 'create_security', (select prosecdef and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc p where oid='public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure),
 'edit_security', (select prosecdef and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc p where oid='public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure),
 'capacity_count_security', (select prosecdef and provolatile='v' and pg_catalog.pg_get_userbyid(proowner)='postgres' and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""'] and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE') and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') from pg_catalog.pg_proc p where oid='public.count_event_tasks_for_capacity(uuid)'::regprocedure),
 'full_update_delete_writers', (select pg_catalog.jsonb_agg(name order by name) from (select distinct p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_catalog.pg_get_userbyid(p.proowner)='postgres' and (p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M' or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M')) q),
 'definer_update_delete_writers', (select pg_catalog.jsonb_agg(name order by name) from (select distinct p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prorettype<>'pg_catalog.trigger'::regtype and (p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M' or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M')) q),
 'task_insert_writers', (select pg_catalog.jsonb_agg(name order by name) from (select distinct p.proname as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ~* '\minsert[[:space:]]+into[[:space:]]+public\.tasks\M') q)
) as catalog_checks;

do $$
declare
 r text:='';
 cap_body text;
 helper_body text;
 create_body text;
 edit_body text;
 event_body text;
 denied boolean:=false;
 before_count integer;
begin
 select lower(pg_catalog.pg_get_functiondef('public.enforce_event_task_capacity()'::regprocedure)) into cap_body;
 select lower(pg_catalog.pg_get_functiondef('public.count_event_tasks_for_capacity(uuid)'::regprocedure)) into helper_body;
 select lower(pg_catalog.pg_get_functiondef('public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure)) into create_body;
 select lower(pg_catalog.pg_get_functiondef('public.edit_active_event_task(uuid,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])'::regprocedure)) into edit_body;
 select lower(pg_catalog.pg_get_functiondef('public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure)) into event_body;

 r:=r||format(E'\nCAP_EVENT_ROW_THEN_ADVISORY_THEN_COUNT: %s',case when strpos(cap_body,'for share')<strpos(cap_body,'pg_advisory_xact_lock') and strpos(cap_body,'pg_advisory_xact_lock')<strpos(cap_body,'count_event_tasks_for_capacity') then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nCAP_COUNTS_ALL_STATUSES: %s',case when helper_body like '%select count(*)%' and helper_body not like '%status =%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nBOUNDED_EXCEPTION_USES_START_PLUS_ADDITIONS: %s',case when cap_body like '%v_stored_count >= v_start_count + v_addition_limit%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nCCL01_ONLY_GENUINE_LOCK_SET_AND_STALE_USES_CCS01: %s',case when edit_body like '%v_authoritative_lock_user_ids is distinct from v_lock_user_ids%' and edit_body like '%errcode = ''ccl01''%' and edit_body like '%errcode = ''ccs01''%' and edit_body like '%errcode = ''42501''%message = ''the task is unavailable.''%' and event_body not like '%errcode = ''ccl01''%' and event_body not like '%task update requires its updated_at token%' and event_body like '%errcode = ''40001''%the task changed. refresh and try again.%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nUSER_LOCKS_SORTED_ASSIGNEES_ONLY: %s',case when edit_body like '%array_agg(id order by id)%' and edit_body like '%p_primary_assignees || v_stored_primary || v_stored_assists%' and create_body like '%unnest(p_primary_assignees) proposed(id)%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nUSERS_THEN_EVENT_ROW_THEN_ADVISORY_THEN_TASK: %s',case when strpos(edit_body,'lock_task_assignee_users')<strpos(edit_body,'for share') and strpos(edit_body,'for share')<strpos(edit_body,'pg_advisory_xact_lock') and strpos(edit_body,'pg_advisory_xact_lock')<strpos(edit_body,'for update') then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nCALLER_PROFILE_RECHECK_AFTER_LOCKS: %s',case when strpos(edit_body,'for update')<strpos(edit_body,'your account no longer has permission') then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nSTORED_AND_PROPOSED_COMMITTEE_CHECK: %s',case when edit_body like '%v_stored_committee_id is distinct from v_my_committee_id%' and edit_body like '%p_committee_id is distinct from v_my_committee_id%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nOWNER_GUARD_MARKERS_AND_RESET_ONLY_STATUS_RANK_UNION: %s',case when lower(pg_catalog.pg_get_functiondef('public.restrict_assignee_task_updates()'::regprocedure)) like '%edit_active_event_task%' and lower(pg_catalog.pg_get_functiondef('public.restrict_assignee_task_updates()'::regprocedure)) like '%- ''assist_assignees''%' and lower(pg_catalog.pg_get_functiondef('public.restrict_assignee_task_updates()'::regprocedure)) like '%- ''status'' - ''sort_order''%' and edit_body like '%v_new_status := v_stored_status%' and edit_body like '%v_stored_status not in (''to do'', ''completed'')%' and lower(pg_catalog.pg_get_functiondef('public.guard_task_assignee_writes()'::regprocedure)) like '%create_active_event_task%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nAUTH_ONLY_RPC_GRANTS: %s',case when pg_catalog.has_function_privilege('authenticated','public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])','execute') and not pg_catalog.has_function_privilege('anon','public.create_active_event_task(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz,timestamptz,uuid[],boolean,uuid[])','execute') then 'PASS' else 'FAIL' end);
 denied:=false;
 begin
   perform public.count_event_tasks_for_capacity('b1103000-0000-4000-8000-000000000101');
 exception when insufficient_privilege then denied:=true; end;
 r:=r||format(E'\nCAPACITY_COUNT_DIRECT_CALL_42501: %s',case when denied then 'PASS' else 'FAIL' end);

 select count(*) into before_count from public.tasks where event_id='b1103000-0000-4000-8000-000000000101';
 insert into public.tasks(event_id,committee_id,title,phase,created_by)
 values ('b1103000-0000-4000-8000-000000000101','b1103000-0000-4000-8000-000000000001','Number 200','Planning','b1103000-0000-4000-8000-000000000011');
 r:=r||format(E'\nSERIAL_199_TO_200_SUCCEEDS: %s',case when before_count=199 and (select count(*) from public.tasks where event_id='b1103000-0000-4000-8000-000000000101')=200 then 'PASS' else 'FAIL' end);

 denied:=false;
 begin
   insert into public.tasks(event_id,committee_id,title,phase,created_by)
   values ('b1103000-0000-4000-8000-000000000101','b1103000-0000-4000-8000-000000000001','Number 201 denied','Planning','b1103000-0000-4000-8000-000000000011');
 exception when sqlstate 'CCP01' then denied:=true; end;
 r:=r||format(E'\nSERIAL_200_TO_201_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nDENIAL_LEAVES_200: %s',case when (select count(*) from public.tasks where event_id='b1103000-0000-4000-8000-000000000101')=200 then 'PASS' else 'FAIL' end);

 set local role authenticated;
 perform pg_catalog.set_config('request.jwt.claim.sub','b1103000-0000-4000-8000-000000000012',true);
 denied:=false;
 begin
   insert into public.tasks(event_id,committee_id,title,phase)
   values ('b1103000-0000-4000-8000-000000000101','b1103000-0000-4000-8000-000000000001','Co-Admin hidden 201 denied','Planning');
 exception when sqlstate 'CCP01' then denied:=true; end;
 set local role postgres;
 perform pg_catalog.set_config('request.jwt.claim.sub','b1103000-0000-4000-8000-000000000011',true);
 r:=r||format(E'\nCOADMIN_HIDDEN_CONFIDENTIAL_ROWS_COUNT_TOWARD_200: %s',case when denied then 'PASS' else 'FAIL' end);

 select pg_catalog.set_config('ceit_connect.task_assignee_writer','edit_event_with_tasks',true);
 select pg_catalog.set_config('ceit_connect.task_capacity_event_id','b1103000-0000-4000-8000-000000000101',true);
 select pg_catalog.set_config('ceit_connect.task_capacity_start_count','200',true);
 select pg_catalog.set_config('ceit_connect.task_capacity_addition_limit','1',true);
 insert into public.tasks(event_id,committee_id,title,phase,created_by)
 values ('b1103000-0000-4000-8000-000000000101','b1103000-0000-4000-8000-000000000001','Bounded temporary 201','Planning','b1103000-0000-4000-8000-000000000011');
 r:=r||format(E'\nBOUNDED_EXCEPTION_ALLOWS_ONLY_SUBMITTED_SLOT: %s',case when (select count(*) from public.tasks where event_id='b1103000-0000-4000-8000-000000000101')=201 then 'PASS' else 'FAIL' end);
 denied:=false;
 begin
   insert into public.tasks(event_id,committee_id,title,phase,created_by)
   values ('b1103000-0000-4000-8000-000000000101','b1103000-0000-4000-8000-000000000001','Beyond bound','Planning','b1103000-0000-4000-8000-000000000011');
 exception when sqlstate 'CCP01' then denied:=true; end;
 r:=r||format(E'\nBOUNDED_EXCEPTION_REJECTS_EXTRA_INSERT: %s',case when denied then 'PASS' else 'FAIL' end);
 select pg_catalog.set_config('ceit_connect.task_capacity_event_id','',true);
 select pg_catalog.set_config('ceit_connect.task_capacity_start_count','',true);
 select pg_catalog.set_config('ceit_connect.task_capacity_addition_limit','',true);
 select pg_catalog.set_config('ceit_connect.task_assignee_writer','',true);

 r:=r||format(E'\nEDIT_EVENT_FINAL_NONINCREASE_CHECK: %s',case when event_body like '%v_final_task_count > 200%' and event_body like '%v_final_task_count > v_starting_task_count%' then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nDIRECT_INSERT_USES_SAME_CAP_TRIGGER: %s',case when exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_a0_enforce_event_capacity' and not tgisinternal and tgenabled='O' and tgfoid='public.enforce_event_task_capacity()'::regprocedure) then 'PASS' else 'FAIL' end);
 r:=r||format(E'\nNO_DYNAMIC_SQL_IN_NEW_RPCS: %s',case when create_body not like '%execute %' and edit_body not like '%execute %' then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',r;
end $$;
```

## SQL Test 4 — stored-priority reader (9 lines)

**Run on DEV only. Choose Run without RLS in the SQL Editor pop-up.** Apply
Migration C first. This paste owns all of its Auth/profile/event/task fixtures,
uses unique nonempty Auth token values, impersonates every caller explicitly,
and ends with an intentional `TEST RESULTS` exception so the transaction rolls
back.

```sql
begin;

insert into public.committees(id,name) values
 ('b11c0000-0000-4000-8000-000000000001','B11 C Own'),
 ('b11c0000-0000-4000-8000-000000000002','B11 C Other');

insert into auth.users(
 id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
 confirmation_token,recovery_token,email_change_token_new,
 email_change_token_current,reauthentication_token,phone_change_token
) values
 ('b11c0000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11c-admin@test.local','',now(),'{}','{}',now(),now(),'b11c-confirm-11','b11c-recover-11','b11c-email-new-11','b11c-email-current-11','b11c-reauth-11','b11c-phone-11'),
 ('b11c0000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11c-own-co@test.local','',now(),'{}','{}',now(),now(),'b11c-confirm-12','b11c-recover-12','b11c-email-new-12','b11c-email-current-12','b11c-reauth-12','b11c-phone-12'),
 ('b11c0000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11c-other-co@test.local','',now(),'{}','{}',now(),now(),'b11c-confirm-13','b11c-recover-13','b11c-email-new-13','b11c-email-current-13','b11c-reauth-13','b11c-phone-13'),
 ('b11c0000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b11c-member@test.local','',now(),'{}','{}',now(),now(),'b11c-confirm-14','b11c-recover-14','b11c-email-new-14','b11c-email-current-14','b11c-reauth-14','b11c-phone-14');

select pg_catalog.set_config(
  'ceit_connect.officer_writer', 'invite_new_officer', true
);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('b11c0000-0000-4000-8000-000000000011','b11c-admin@test.local','B11 C Admin','Admin',null,true),
 ('b11c0000-0000-4000-8000-000000000012','b11c-own-co@test.local','B11 C Own Co','Co-Admin','b11c0000-0000-4000-8000-000000000001',true),
 ('b11c0000-0000-4000-8000-000000000013','b11c-other-co@test.local','B11 C Other Co','Co-Admin','b11c0000-0000-4000-8000-000000000002',true);
select pg_catalog.set_config('ceit_connect.officer_writer', '', true);

insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('b11c0000-0000-4000-8000-000000000014','b11c-member@test.local','B11 C Member','Member','b11c0000-0000-4000-8000-000000000001',true);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b11c0000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);

insert into public.events(id,name,start_date,status,created_by) values
 ('b11c0000-0000-4000-8000-000000000101','B11 C Active','2026-10-01','Active','b11c0000-0000-4000-8000-000000000011'),
 ('b11c0000-0000-4000-8000-000000000102','B11 C Draft','2026-10-01','Draft','b11c0000-0000-4000-8000-000000000011'),
 ('b11c0000-0000-4000-8000-000000000103','B11 C To Archive','2026-10-01','Active','b11c0000-0000-4000-8000-000000000011');

select pg_catalog.set_config(
  'ceit_connect.task_assignee_writer', 'create_event_with_tasks', true
);
insert into public.tasks(
 id,event_id,committee_id,title,phase,status,sort_order,priority,due_date,
 primary_assignees,assist_assignees,is_confidential,allowed_viewers,created_by
) values
 ('b11c0000-0000-4000-8000-000000000201','b11c0000-0000-4000-8000-000000000101','b11c0000-0000-4000-8000-000000000001','Stored Low','Planning','To Do',1024,'Low','2026-01-01','{}','{}',false,'{}','b11c0000-0000-4000-8000-000000000011'),
 ('b11c0000-0000-4000-8000-000000000202','b11c0000-0000-4000-8000-000000000101','b11c0000-0000-4000-8000-000000000001','Masked Priority','Planning','To Do',2048,'High',null,'{}','{}',true,'{}','b11c0000-0000-4000-8000-000000000011'),
 ('b11c0000-0000-4000-8000-000000000203','b11c0000-0000-4000-8000-000000000102','b11c0000-0000-4000-8000-000000000001','Draft Priority','Planning','To Do',1024,'Medium',null,'{}','{}',false,'{}','b11c0000-0000-4000-8000-000000000011'),
 ('b11c0000-0000-4000-8000-000000000204','b11c0000-0000-4000-8000-000000000103','b11c0000-0000-4000-8000-000000000001','Archived Priority','Planning','To Do',1024,'Critical',null,'{}','{}',false,'{}','b11c0000-0000-4000-8000-000000000011');
select pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);

set local role authenticated;
select public.archive_event(
  'b11c0000-0000-4000-8000-000000000103',
  1,
  (select updated_at from public.events where id='b11c0000-0000-4000-8000-000000000103')
);
reset role;

do $$
declare
  r text := '';
  v_priority text;
  v_effective_priority text;
  v_masked_for_member boolean;
  v_catalog_ok boolean;
  v_body text;
begin
  select public.calculate_effective_task_priority(
    task_row.priority,
    task_row.due_date,
    pg_catalog.statement_timestamp(),
    task_row.status
  )
  into v_effective_priority
  from public.tasks task_row
  where task_row.id='b11c0000-0000-4000-8000-000000000201';

  select public.task_content_access_for_user(
    'b11c0000-0000-4000-8000-000000000202',
    'b11c0000-0000-4000-8000-000000000014'
  ) = 'masked'
  into v_masked_for_member;

  set local role authenticated;
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b11c0000-0000-4000-8000-000000000011","role":"authenticated"}',
    true
  );
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000201'
  ) into v_priority;
  r:=r||format(E'\nADMIN_GETS_STORED_PRIORITY: %s',
    case when v_priority='Low' then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nSTORED_PRIORITY_NOT_EFFECTIVE_PRIORITY: %s',
    case when v_priority='Low' and v_effective_priority='Critical'
      then 'PASS' else 'FAIL' end);

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b11c0000-0000-4000-8000-000000000012","role":"authenticated"}',
    true
  );
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000201'
  ) into v_priority;
  r:=r||format(E'\nOWN_COMMITTEE_COADMIN_GETS_STORED_PRIORITY: %s',
    case when v_priority='Low' then 'PASS' else 'FAIL' end);

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b11c0000-0000-4000-8000-000000000013","role":"authenticated"}',
    true
  );
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000201'
  ) into v_priority;
  r:=r||format(E'\nOTHER_COMMITTEE_COADMIN_GETS_NULL: %s',
    case when v_priority is null then 'PASS' else 'FAIL' end);

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b11c0000-0000-4000-8000-000000000014","role":"authenticated"}',
    true
  );
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000201'
  ) into v_priority;
  r:=r||format(E'\nMEMBER_GETS_NULL: %s',
    case when v_priority is null then 'PASS' else 'FAIL' end);
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000202'
  ) into v_priority;
  r:=r||format(E'\nMASKED_CONFIDENTIAL_GETS_NULL: %s',
    case when v_masked_for_member and v_priority is null
      then 'PASS' else 'FAIL' end);

  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"b11c0000-0000-4000-8000-000000000011","role":"authenticated"}',
    true
  );
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000203'
  ) into v_priority;
  r:=r||format(E'\nDRAFT_TASK_GETS_NULL: %s',
    case when v_priority is null then 'PASS' else 'FAIL' end);
  select public.get_task_stored_priority(
    'b11c0000-0000-4000-8000-000000000204'
  ) into v_priority;
  r:=r||format(E'\nARCHIVED_TASK_GETS_NULL: %s',
    case when v_priority is null then 'PASS' else 'FAIL' end);

  set local role postgres;
  select lower(pg_catalog.pg_get_functiondef(
    'public.get_task_stored_priority(uuid)'::regprocedure
  )) into v_body;
  select
    (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'
        and p.proname='get_task_stored_priority'
    ) = 1
    and exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid='public.get_task_stored_priority(uuid)'::regprocedure
        and p.prosecdef
        and p.provolatile='s'
        and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
        and coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']
        and pg_catalog.pg_get_function_result(p.oid)='text'
        and pg_catalog.has_function_privilege(
          'authenticated',p.oid,'EXECUTE'
        )
        and not pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
        and not pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')
    )
    and v_body !~ '\mexecute\M'
    and v_body !~ 'pg_catalog\.(coalesce|greatest|least|nullif)'
  into v_catalog_ok;
  r:=r||format(E'\nCATALOG_PIN_OWNER_GRANTS_PATH_STABLE_SINGLE_OVERLOAD: %s',
    case when v_catalog_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %',r;
end $$;
```

Expected final result: exactly **9 `TEST RESULTS` lines**, all `PASS`. The
intentional exception rolls back every fixture.

## Read-only over-cap query for Dev and Prod

Run separately in each Dashboard SQL editor. It performs no writes.

```sql
select
  e.id,
  e.name,
  e.status,
  count(t.id)::integer as task_total
from public.events e
join public.tasks t on t.event_id = e.id
group by e.id, e.name, e.status
having count(t.id) > 200
order by count(t.id) desc, e.id;
```

## Application tests for Runs 2–3

- Route: retry only SQLSTATE `CCL01`; three total transactions; success
  after a stable later attempt; no retry for `CCP01`, `CCN01`, validation,
  `CCS01`, authentication, or authorization failures.
- Route messages: exhausted `CCL01` maps to “Assignments changed while
  saving. Please try again.”; `CCP01` maps to “This event already has the
  maximum of 200 tasks.”; `CCN01` maps to “No changes to save”;
  `CCS01` maps to “This task changed after you loaded it. Reload and try
  again.”
- Token: transport `updated_at` as an opaque string and never construct or
  round-trip it through a JavaScript `Date`.
- UI: Add/Edit controls, masked-task absence, Philippine-time display,
  reduced-motion state/test row, shared `PriorityBadge`, and the existing
  motion-kit contracts.

Implemented application coverage includes
strict POST/PATCH validation, CCL01 attempt 2/3 success using distinct RPC
requests, exact three-failure text, one-call non-retry errors, Philippine
serialization, opaque task tokens, safe busy-state settlement, authoritative
refetches, and the Add/Edit field contract without Status. UI/pure contract
rows cover Admin versus owning/non-owning Co-Admin and Member presentation;
masked, Draft, Archived, and denied Edit paths; standalone stored-priority
prefill; shared `PriorityBadge`; Asia/Manila Created/Last updated display;
normal shared motion and explicit reduced-motion classes; 44px phone targets;
and hover, focus-visible, and pressed states. The focused priority regression
proves stored `Low` with calculated `Critical` prefills and resubmits `Low` on
a no-op save. The post-browser-test rows additionally cover every fixed
field-specific request rejection, generic unexpected-shape handling without
value/key reflection, committee label metadata and fail-closed Edit loading,
search-scoped/indeterminate bulk selection with all-or-nothing cap handling,
assist exclusion, redundant stored-viewer no-op suppression, one normalized
viewer payload for a real edit while retaining inactive non-assignee viewers,
background Edit-result rejection, `CCS01` reload gating, and the reachable
Manage assignees footer grid. The completion rows prove that a failed people-
option load keeps the editor unavailable, exposes Reload task editor, and
leaves Submit disabled until a successful foreground reload; failed client
validation alone scrolls to and focuses the annotated title, committee,
schedule, or people control. Exact picker boundaries prove that the 101st
primary assignee and 51st additional viewer apply no selection change while
unticking at either cap still succeeds. Final full-suite counts are recorded
in `docs/PROGRESS.md`. No browser retest is claimed here.

The picker follow-up proves that zero committee matches plus three preserved
outside selections remains a three-person no-op; below-cap bulk selection adds
only matching IDs; exactly 100 succeeds; 101/51 leave the applied selection
unchanged; and a successful picker interaction clears only count-derived cap
state. The full local suite passes **635/635 across 66 files**.

The UUID/picker regression follow-up accepts canonical 8-4-4-4-12 UUIDs of
any version while rejecting braces and unhyphenated input, covers UUIDv7 in
every applicable POST/PATCH id position, lowercases before duplicate checks,
and reserves the 100/50 messages for real length overflow. Invalid or duplicate
arrays receive separate fixed messages. The behavioral ten-person regression
proves that removing one person clears the earlier false cap path. A pure
presentation test proves that zero available committee members replace the
bulk row with quiet text, search-zero has distinct text, and Clear shown is
rendered only when a shown member is selected. No browser retest is claimed.

