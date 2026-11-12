-- DEV ONLY. In Supabase SQL Editor choose "Run without RLS".
-- Self-contained: fixtures and capability are transaction-local and the final
-- intentional exception rolls everything back.
begin;
set local timezone = 'Asia/Manila';
set local statement_timeout = '120s';

create temporary table j1_results(label text primary key, passed boolean not null);
create function pg_temp.j1_record(p_label text, p_passed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into pg_temp.j1_results values (p_label, coalesce(p_passed, false));
end $$;

insert into public.committees(id,name) values
('81000000-0000-4000-8000-000000000001','J1 Committee');

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email,'',now(),'{}','{}',now(),now()
from (values
  ('81000000-0000-4000-8000-000000000011'::uuid,'j1-admin@test.local'),
  ('81000000-0000-4000-8000-000000000012'::uuid,'j1-real@test.local'),
  ('81000000-0000-4000-8000-000000000013'::uuid,'j1-masked@test.local'),
  ('81000000-0000-4000-8000-000000000014'::uuid,'j1-inactive@test.local')
) fixture(id,email);

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('81000000-0000-4000-8000-000000000011','j1-admin@test.local','J1 Admin','Admin',null,true),
('81000000-0000-4000-8000-000000000012','j1-real@test.local','J1 Real','Member','81000000-0000-4000-8000-000000000001',true),
('81000000-0000-4000-8000-000000000013','j1-masked@test.local','J1 Masked','Member','81000000-0000-4000-8000-000000000001',true),
('81000000-0000-4000-8000-000000000014','j1-inactive@test.local','J1 Inactive','Member','81000000-0000-4000-8000-000000000001',true);
select set_config('ceit_connect.officer_writer','',true);

insert into public.events(id,name,start_date,end_date,status,created_by) values
('81000000-0000-4000-8000-000000000101','J1 Active',current_date,current_date,'Active','81000000-0000-4000-8000-000000000011'),
('81000000-0000-4000-8000-000000000102','J1 Delete',current_date,current_date,'Draft','81000000-0000-4000-8000-000000000011');

insert into public.tasks(
  id,event_id,committee_id,title,phase,status,priority,task_type,created_by,
  is_confidential,primary_assignees,assist_assignees,allowed_viewers,sort_order
) values
('81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000001','J1 Secret','Planning','To Do','Medium','Deliverable','81000000-0000-4000-8000-000000000011',true,array['81000000-0000-4000-8000-000000000012']::uuid[],'{}','{}',1024),
('81000000-0000-4000-8000-000000000202','81000000-0000-4000-8000-000000000101','81000000-0000-4000-8000-000000000001','J1 Keep','Planning','To Do','Medium','Deliverable','81000000-0000-4000-8000-000000000011',false,'{}','{}','{}',2048),
('81000000-0000-4000-8000-000000000203','81000000-0000-4000-8000-000000000102','81000000-0000-4000-8000-000000000001','J1 Event Delete','Planning','To Do','Medium','Deliverable','81000000-0000-4000-8000-000000000011',false,'{}','{}','{}',1024);

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
set local role authenticated;
insert into public.task_comments(id,task_id,created_by,body,created_at)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       '81000000-0000-4000-8000-000000000201',
       '81000000-0000-4000-8000-000000000011','Comment '||n,
       case when n=24 then '2026-11-13 00:25:00+08'::timestamptz
            else '2026-11-13 00:00:00+08'::timestamptz+n*interval '1 minute' end
from generate_series(1,51) n;
reset role;

select pg_temp.j1_record('01 exactly five replaced function names and no overloads',
  5=(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where (n.nspname,p.proname) in (
       ('ceit_connect_private','insert_notifications'),('ceit_connect_private','notify_task_comment'),
       ('ceit_connect_private','list_notifications_for_user'),('public','list_notifications'),
       ('public','claim_push_deliveries'))));
select pg_temp.j1_record('02 drop-recreate signatures have no dependent objects',
  0=(select count(*) from pg_depend where refobjid in (
    'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[],uuid)'::regprocedure,
    'ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)'::regprocedure,
    'public.list_notifications(integer,timestamptz,uuid)'::regprocedure)
    and deptype not in ('i','e')));
select pg_temp.j1_record('03 owners and execute grants restored',
  (select bool_and(pg_get_userbyid(proowner)='postgres') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where (n.nspname,p.proname) in (('ceit_connect_private','insert_notifications'),('ceit_connect_private','notify_task_comment'),('ceit_connect_private','list_notifications_for_user'),('public','list_notifications'),('public','claim_push_deliveries')))
  and has_function_privilege('authenticated','public.list_notifications(integer,timestamptz,uuid)','EXECUTE')
  and has_function_privilege('anon','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_push_deliveries(integer)','EXECUTE'));
select pg_temp.j1_record('04 nullable comment FK is mention-only SET NULL',exists(
  select 1 from pg_constraint where conname='notifications_comment_id_fkey'
  and confdeltype='n' and confrelid='public.task_comments'::regclass));
select pg_temp.j1_record('05 no notification update guard trigger blocks FK action',not exists(
  select 1 from pg_trigger where tgrelid='public.notifications'::regclass and not tgisinternal
  and (tgtype & 16)=16));

set local role authenticated;
select pg_temp.j1_record('06 boundary 25 remains newest page',
  (select out_before_id is null and not out_has_newer from public.get_task_comment_target_page_anchor(
    '81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000027',25)));
select pg_temp.j1_record('07 boundary 26 starts second page',
  (select out_before_id='81000000-0000-4000-8000-000000000027' from public.get_task_comment_target_page_anchor(
    '81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000026',25)));
select pg_temp.j1_record('08 boundary 50 stays second page',
  (select out_before_id='81000000-0000-4000-8000-000000000027' from public.get_task_comment_target_page_anchor(
    '81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000002',25)));
select pg_temp.j1_record('09 boundary 51 starts third page',
  (select out_before_id='81000000-0000-4000-8000-000000000002' from public.get_task_comment_target_page_anchor(
    '81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000001',25)));
select pg_temp.j1_record('10 timestamp tie follows id descending',
  (select array_agg(id order by created_at desc,id desc) from public.task_comments
   where id in ('81000000-0000-4000-8000-000000000024','81000000-0000-4000-8000-000000000025'))
  =array['81000000-0000-4000-8000-000000000025','81000000-0000-4000-8000-000000000024']::uuid[]);
reset role;

select public.configure_push_sender_credential_hash(
  'current',8101,repeat('81',32),
  encode(extensions.digest(
    decode(repeat('81',32),'hex')||convert_to('j1-push-secret','UTF8'),'sha256'
  ),'hex')
);
select set_config('request.headers','{"x-ceit-push-capability":"j1-push-secret"}',true);
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_subscription(
  'https://fcm.googleapis.com/j1/masked',repeat('M',87),repeat('m',22),'J1 masked','desktop',null);
reset role;

insert into public.notifications(id,user_id,type,task_id,comment_id) values
('81000000-0000-4000-8000-000000000301','81000000-0000-4000-8000-000000000012','mention','81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000026'),
('81000000-0000-4000-8000-000000000302','81000000-0000-4000-8000-000000000013','mention','81000000-0000-4000-8000-000000000201','81000000-0000-4000-8000-000000000025'),
('81000000-0000-4000-8000-000000000303','81000000-0000-4000-8000-000000000012','mention','81000000-0000-4000-8000-000000000203',null);

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.j1_record('11 real reader receives exact comment id',exists(
  select 1 from public.list_notifications() where out_id='81000000-0000-4000-8000-000000000301'
  and out_comment_id='81000000-0000-4000-8000-000000000026'));
reset role;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.j1_record('12 masked reader receives task but no comment id',exists(
  select 1 from public.list_notifications() where out_id='81000000-0000-4000-8000-000000000302'
  and out_task_id='81000000-0000-4000-8000-000000000201' and out_comment_id is null
  and out_task_title='Confidential Task'));
reset role;

create temporary table j1_masked_claim as
select * from public.claim_push_deliveries(1) with no data;
grant select,insert on j1_masked_claim to anon;
set local role anon;
insert into j1_masked_claim select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.j1_record('13 masked push receives task-only generic target',exists(
  select 1 from j1_masked_claim
  where out_notification_type='mention'
    and out_target_path='/tasks/81000000-0000-4000-8000-000000000201'
    and out_body='You were mentioned in a task.'));

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
set local role authenticated;
select public.delete_task_comment('81000000-0000-4000-8000-000000000026');
reset role;
select pg_temp.j1_record('14 comment delete sets notification target null',exists(
  select 1 from public.notifications where id='81000000-0000-4000-8000-000000000301' and comment_id is null));

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
set local role authenticated;
select public.delete_task('81000000-0000-4000-8000-000000000201');
reset role;
select pg_temp.j1_record('15 task deletion cascades notifications without FK blockage',
  not exists(select 1 from public.notifications where task_id='81000000-0000-4000-8000-000000000201'));

set local role service_role;
select * from public.delete_event(
  '81000000-0000-4000-8000-000000000102','81000000-0000-4000-8000-000000000011',
  (select updated_at from public.events where id='81000000-0000-4000-8000-000000000102'));
reset role;
select pg_temp.j1_record('16 event deletion traverses task/comment/notification cascade',
  not exists(select 1 from public.events where id='81000000-0000-4000-8000-000000000102')
  and not exists(select 1 from public.notifications where id='81000000-0000-4000-8000-000000000303'));

select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000014","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_subscription(
  'https://fcm.googleapis.com/j1/inactive',repeat('I',87),repeat('i',22),'J1 inactive','desktop',null);
reset role;
insert into public.notifications(id,user_id,type,task_id) values
('81000000-0000-4000-8000-000000000304','81000000-0000-4000-8000-000000000014','assignment','81000000-0000-4000-8000-000000000202');
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
set local role authenticated;
select public.deactivate_committee_member('81000000-0000-4000-8000-000000000014');
reset role;
select pg_temp.j1_record('17 deactivated recipient has no subscription or queued push',
  not exists(select 1 from public.push_subscriptions where user_id='81000000-0000-4000-8000-000000000014')
  and not exists(select 1 from ceit_connect_private.push_delivery_queue where user_id='81000000-0000-4000-8000-000000000014'));

select pg_temp.j1_record('18 all thirteen generic body arms remain present',
  (select count(*) from regexp_matches(pg_get_functiondef('public.claim_push_deliveries(integer)'::regprocedure),
    'when ''(mention|heads_up|assignment|status_change|unlock|backup_request|volunteer_offer|leave_requested|leave_cancelled|leave_approved|leave_denied|task_due_soon|live_operation_prep)'' then','g'))=13);
select pg_temp.j1_record('19 claim authorization precedes every queue mutation',
  strpos(pg_get_functiondef('public.claim_push_deliveries(integer)'::regprocedure),'authenticate_push_sender()')
  < strpos(pg_get_functiondef('public.claim_push_deliveries(integer)'::regprocedure),'delete from ceit_connect_private.push_delivery_queue'));
select pg_temp.j1_record('20 target SQL has no stale notifications route or content text',
  strpos(pg_get_functiondef('public.claim_push_deliveries(integer)'::regprocedure),'/notifications')=0
  and strpos(pg_get_functiondef('public.claim_push_deliveries(integer)'::regprocedure),'/tasks/%s#comment-%s')>0);
select pg_temp.j1_record('21 old null comment target remains safe task fallback',exists(
  select 1 from public.notifications where id='81000000-0000-4000-8000-000000000304' and comment_id is null));

do $$
declare v_pass integer; v_total integer;
begin
  select count(*) filter(where passed),count(*) into v_pass,v_total from j1_results;
  if v_pass<>21 or v_total<>21 then
    raise exception 'TEST RESULTS %/% PASS; failures: %',v_pass,v_total,
      (select string_agg(label,', ' order by label) from j1_results where not passed);
  end if;
  raise exception 'TEST RESULTS 21/21 PASS';
end $$;
