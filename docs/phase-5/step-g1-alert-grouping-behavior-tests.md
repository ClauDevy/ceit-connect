# G1 alert grouping — Dev behaviour test paste

Dev only. In the Supabase SQL Editor select **Run without RLS**, paste this entire block once, and run it. It uses clock margins rather than exact boundaries. The final intentional exception must read `TEST RESULTS 36/36 PASS`; the transaction rolls back every fixture.

```sql
begin;

create table public.g1_behavior_results (
  label text primary key,
  passed boolean not null
);

create function pg_temp.g1_record(p_label text, p_passed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.g1_behavior_results(label, passed)
  values (p_label, coalesce(p_passed, false));
end;
$$;

set local session_replication_role = replica;
insert into public.committees(id, name)
values ('8210c000-0000-4000-8000-000000000001', 'G1 Behaviour');

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', fixture.email, '', now(), '{}', '{}', now(), now()
from (values
  ('82100000-0000-4000-8000-000000000001'::uuid, 'g1-admin@test.local'),
  ('82100000-0000-4000-8000-000000000002'::uuid, 'g1-person-a@test.local'),
  ('82100000-0000-4000-8000-000000000003'::uuid, 'g1-person-b@test.local'),
  ('82100000-0000-4000-8000-000000000004'::uuid, 'g1-inactive@test.local'),
  ('82100000-0000-4000-8000-000000000005'::uuid, 'g1-expired@test.local')
) as fixture(id, email);

insert into public.users(id, email, full_name, role, committee_id, is_active) values
('82100000-0000-4000-8000-000000000001','g1-admin@test.local','G1 Admin','Admin',null,true),
('82100000-0000-4000-8000-000000000002','g1-person-a@test.local','G1 Person A','Member','8210c000-0000-4000-8000-000000000001',true),
('82100000-0000-4000-8000-000000000003','g1-person-b@test.local','G1 Person B','Member','8210c000-0000-4000-8000-000000000001',true),
('82100000-0000-4000-8000-000000000004','g1-inactive@test.local','G1 Inactive','Member','8210c000-0000-4000-8000-000000000001',false),
('82100000-0000-4000-8000-000000000005','g1-expired@test.local','G1 Expired','Member','8210c000-0000-4000-8000-000000000001',true);

insert into public.events(id, name, start_date, end_date, status, created_by) values
('82102000-0000-4000-8000-000000000001','G1 Launch Event','2026-11-01','2027-12-31','Draft','82100000-0000-4000-8000-000000000001'),
('82102000-0000-4000-8000-000000000002','G1 Failed Launch','2026-11-01','2027-12-31','Draft','82100000-0000-4000-8000-000000000001');

insert into public.tasks(
  id, event_id, committee_id, title, phase, status, task_type,
  primary_assignees, assist_assignees, is_confidential, allowed_viewers, request_backup
) values
('82103000-0000-4000-8000-000000000001','82102000-0000-4000-8000-000000000001','8210c000-0000-4000-8000-000000000001','G1 Launch secret 1','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',true,array['82100000-0000-4000-8000-000000000002'::uuid,'82100000-0000-4000-8000-000000000003'::uuid],false),
('82103000-0000-4000-8000-000000000002','82102000-0000-4000-8000-000000000001','8210c000-0000-4000-8000-000000000001','G1 Launch secret 2','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',true,array['82100000-0000-4000-8000-000000000002'::uuid,'82100000-0000-4000-8000-000000000003'::uuid],false),
('82103000-0000-4000-8000-000000000003','82102000-0000-4000-8000-000000000001','8210c000-0000-4000-8000-000000000001','G1 Launch secret 3','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',true,array['82100000-0000-4000-8000-000000000002'::uuid,'82100000-0000-4000-8000-000000000003'::uuid],false),
('82103000-0000-4000-8000-000000000004','82102000-0000-4000-8000-000000000001','8210c000-0000-4000-8000-000000000001','G1 Launch secret 4','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',true,array['82100000-0000-4000-8000-000000000002'::uuid,'82100000-0000-4000-8000-000000000003'::uuid],false),
('82103000-0000-4000-8000-000000000005','82102000-0000-4000-8000-000000000001','8210c000-0000-4000-8000-000000000001','G1 Launch secret 5','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',true,array['82100000-0000-4000-8000-000000000002'::uuid,'82100000-0000-4000-8000-000000000003'::uuid],false),
('82103000-0000-4000-8000-000000000006','82102000-0000-4000-8000-000000000001','8210c000-0000-4000-8000-000000000001','G1 Launch secret 6','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',true,array['82100000-0000-4000-8000-000000000002'::uuid,'82100000-0000-4000-8000-000000000003'::uuid],false),
('82103000-0000-4000-8000-000000000007','82102000-0000-4000-8000-000000000002','8210c000-0000-4000-8000-000000000001','G1 Failed task','G1','To Do','Deliverable',array['82100000-0000-4000-8000-000000000002'::uuid],'{}',false,'{}',false);

insert into public.push_subscriptions(
  id, user_id, endpoint, endpoint_hash, p256dh, auth_secret, device_label, platform, expires_at
) values
('82105000-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000002','https://fcm.googleapis.com/g1/a-one',extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/g1/a-one','UTF8'),'sha256'),repeat('A',87),repeat('a',22),'A one','android',null),
('82105000-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000002','https://web.push.apple.com/g1/a-two',extensions.digest(pg_catalog.convert_to('https://web.push.apple.com/g1/a-two','UTF8'),'sha256'),repeat('B',87),repeat('b',22),'A two','ios',null),
('82105000-0000-4000-8000-000000000003','82100000-0000-4000-8000-000000000003','https://fcm.googleapis.com/g1/b-one',extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/g1/b-one','UTF8'),'sha256'),repeat('C',87),repeat('c',22),'B one','desktop',null),
('82105000-0000-4000-8000-000000000004','82100000-0000-4000-8000-000000000004','https://fcm.googleapis.com/g1/inactive',extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/g1/inactive','UTF8'),'sha256'),repeat('D',87),repeat('d',22),'Inactive','desktop',null),
('82105000-0000-4000-8000-000000000005','82100000-0000-4000-8000-000000000005','https://fcm.googleapis.com/g1/expired',extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/g1/expired','UTF8'),'sha256'),repeat('E',87),repeat('e',22),'Expired','desktop',clock_timestamp()-interval '1 day');
set local session_replication_role = origin;

select public.configure_push_sender_credential_hash(
  'current', 8212, repeat('22',32),
  pg_catalog.encode(extensions.digest(
    pg_catalog.decode(repeat('22',32),'hex') || pg_catalog.convert_to('g1-test-capability','UTF8'),
    'sha256'
  ),'hex')
);
select set_config('request.headers','{"x-ceit-push-capability":"g1-test-capability"}',true);
select set_config('request.jwt.claims','{"sub":"82100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
  if auth.uid() is distinct from '82100000-0000-4000-8000-000000000001'::uuid then
    raise exception 'G1 behaviour impersonation fixture failed.';
  end if;
end;
$$;
update public.events set status='Active' where id='82102000-0000-4000-8000-000000000001';
reset role;

select pg_temp.g1_record('01 launch keeps six bell rows and twelve device queue rows',
  6=(select count(*) from public.notifications where type='assignment' and task_id::text like '82103%')
  and 12=(select count(*) from ceit_connect_private.push_delivery_queue where notification_type='assignment' and user_id='82100000-0000-4000-8000-000000000002'));
select pg_temp.g1_record('02 two devices share one window and one window deadline',
  1=(select count(distinct group_window_id) from ceit_connect_private.push_delivery_queue where notification_type='assignment' and user_id='82100000-0000-4000-8000-000000000002')
  and 1=(select count(distinct next_attempt_at) from ceit_connect_private.push_delivery_queue where notification_type='assignment' and user_id='82100000-0000-4000-8000-000000000002')
  and 1=(select count(distinct retry_deadline_at) from ceit_connect_private.push_delivery_queue where notification_type='assignment' and user_id='82100000-0000-4000-8000-000000000002'));
select pg_temp.g1_record('03 grouped retry deadline is one hour from window start',not exists(
  select 1 from ceit_connect_private.push_delivery_queue where notification_type='assignment'
  and retry_deadline_at is distinct from group_window_started_at+interval '1 hour'));
select pg_temp.g1_record('04 successful launch leaves no context row',
  not exists(select 1 from ceit_connect_private.push_launch_group_context));

create table public.g1_early_claim as select * from public.claim_push_deliveries(100) with no data;
grant select, insert on public.g1_early_claim to anon;
set local role anon;
insert into public.g1_early_claim select * from public.claim_push_deliveries(100);
reset role;
select pg_temp.g1_record('05 hold prevents an early claim',0=(select count(*) from public.g1_early_claim));

update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '40 seconds',
    next_attempt_at=clock_timestamp()-interval '10 seconds',
    retry_deadline_at=clock_timestamp()+interval '50 minutes'
where notification_type='assignment' and user_id='82100000-0000-4000-8000-000000000002';
create table public.g1_launch_claim as select * from public.claim_push_deliveries(100) with no data;
grant select, insert on public.g1_launch_claim to anon;
set local role anon;
insert into public.g1_launch_claim select * from public.claim_push_deliveries(100);
reset role;
select pg_temp.g1_record('06 two devices produce two summaries with one stable window id',
  2=(select count(*) from public.g1_launch_claim)
  and 1=(select count(distinct out_delivery_id) from public.g1_launch_claim)
  and 2=(select count(distinct out_lease_token) from public.g1_launch_claim));
select pg_temp.g1_record('07 launch summary copy target and confidentiality are safe',not exists(
  select 1 from public.g1_launch_claim where out_title<>'CEIT Connect'
  or out_body<>'You were assigned to 6 tasks.' or out_target_path<>'/'
  or out_body like '%G1 Launch secret%'));
select pg_temp.g1_record('08 run claimed counter counts device-window deliveries not rows',
  2=(select claimed_count from ceit_connect_private.push_delivery_runs where id=(select out_run_id from public.g1_launch_claim limit 1)));
select pg_temp.g1_record('09 wrong lease token returns false',not public.acknowledge_push_delivery(
  (select out_delivery_id from public.g1_launch_claim limit 1),gen_random_uuid(),'success',201));
select pg_temp.g1_record('10 acknowledging device one touches only its six rows',
  public.acknowledge_push_delivery(
    (select out_delivery_id from public.g1_launch_claim where out_endpoint like '%a-one'),
    (select out_lease_token from public.g1_launch_claim where out_endpoint like '%a-one'),'success',201)
  and 6=(select count(*) from ceit_connect_private.push_delivery_queue where subscription_id='82105000-0000-4000-8000-000000000001' and notification_type='assignment' and state='delivered')
  and 6=(select count(*) from ceit_connect_private.push_delivery_queue where subscription_id='82105000-0000-4000-8000-000000000002' and notification_type='assignment' and state='leased'));
select pg_temp.g1_record('11 failing device two touches only its own six rows',
  public.acknowledge_push_delivery(
    (select out_delivery_id from public.g1_launch_claim where out_endpoint like '%a-two'),
    (select out_lease_token from public.g1_launch_claim where out_endpoint like '%a-two'),'transient',503)
  and 6=(select count(*) from ceit_connect_private.push_delivery_queue where subscription_id='82105000-0000-4000-8000-000000000002' and notification_type='assignment' and state='pending')
  and 6=(select count(*) from ceit_connect_private.push_delivery_queue where subscription_id='82105000-0000-4000-8000-000000000001' and notification_type='assignment' and state='delivered'));
update ceit_connect_private.push_delivery_queue set next_attempt_at=clock_timestamp()-interval '10 seconds'
where subscription_id='82105000-0000-4000-8000-000000000002' and notification_type='assignment' and state='pending';
create table public.g1_launch_retry as select * from public.claim_push_deliveries(100) with no data;
grant select, insert on public.g1_launch_retry to anon;
set local role anon;
insert into public.g1_launch_retry select * from public.claim_push_deliveries(100);
reset role;
select pg_temp.g1_record('12 retry stays one summary with the same tag and never splits',
  1=(select count(*) from public.g1_launch_retry)
  and (select out_delivery_id from public.g1_launch_retry)=(select out_delivery_id from public.g1_launch_claim limit 1)
  and 6=(select count(*) from ceit_connect_private.push_delivery_queue where subscription_id='82105000-0000-4000-8000-000000000002' and notification_type='assignment' and state='leased'));
select pg_temp.g1_record('13 retry success finalizes the complete second-device group',
  public.acknowledge_push_delivery((select out_delivery_id from public.g1_launch_retry),(select out_lease_token from public.g1_launch_retry),'success',201)
  and 12=(select count(*) from ceit_connect_private.push_delivery_queue where notification_type='assignment' and user_id='82100000-0000-4000-8000-000000000002' and state='delivered'));

insert into public.notifications(id,user_id,type,task_id)
values('82106000-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','unlock','82103000-0000-4000-8000-000000000001');
update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '40 seconds',next_attempt_at=clock_timestamp()-interval '10 seconds',retry_deadline_at=clock_timestamp()+interval '50 minutes'
where notification_id='82106000-0000-4000-8000-000000000001';
create table public.g1_single_claim as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_single_claim to anon;
set local role anon;
insert into public.g1_single_claim select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('14 one grouped alert keeps its row id exact copy and task target',
  (select out_delivery_id from public.g1_single_claim)=(select id from ceit_connect_private.push_delivery_queue where notification_id='82106000-0000-4000-8000-000000000001')
  and (select out_body='A task you’re assigned to is now unlocked.' and out_target_path='/tasks/82103000-0000-4000-8000-000000000001' from public.g1_single_claim));
select pg_temp.g1_record('15 acknowledgement accepts the single-row id',
  public.acknowledge_push_delivery((select out_delivery_id from public.g1_single_claim),(select out_lease_token from public.g1_single_claim),'success',201)
  and exists(select 1 from ceit_connect_private.push_delivery_queue where notification_id='82106000-0000-4000-8000-000000000001' and state='delivered'));

insert into public.notifications(id,user_id,type,task_id) values
('82106100-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','task_due_soon','82103000-0000-4000-8000-000000000001'),
('82106100-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000003','task_due_soon','82103000-0000-4000-8000-000000000002');
select set_config('g1.first_due_window',(select group_window_id::text from ceit_connect_private.push_delivery_queue where notification_id='82106100-0000-4000-8000-000000000001'),true);
update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '26 seconds',next_attempt_at=clock_timestamp()+interval '4 seconds',retry_deadline_at=clock_timestamp()+interval '59 minutes 34 seconds'
where group_window_id=current_setting('g1.first_due_window')::uuid;
insert into public.notifications(id,user_id,type,task_id)
values('82106100-0000-4000-8000-000000000003','82100000-0000-4000-8000-000000000003','task_due_soon','82103000-0000-4000-8000-000000000003');
select pg_temp.g1_record('16 notification after twenty-five seconds starts a new window',
  current_setting('g1.first_due_window')::uuid is distinct from (select group_window_id from ceit_connect_private.push_delivery_queue where notification_id='82106100-0000-4000-8000-000000000003'));
update ceit_connect_private.push_delivery_queue set next_attempt_at=clock_timestamp()-interval '10 seconds'
where group_window_id=current_setting('g1.first_due_window')::uuid;
create table public.g1_due_first as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_due_first to anon;
set local role anon;
insert into public.g1_due_first select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('17 original due window claims one summary and accepts window id',
  (select out_delivery_id=current_setting('g1.first_due_window')::uuid and out_body='2 tasks are due within 24 hours.' and out_target_path='/' from public.g1_due_first)
  and public.acknowledge_push_delivery((select out_delivery_id from public.g1_due_first),(select out_lease_token from public.g1_due_first),'success',201));
update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '40 seconds',next_attempt_at=clock_timestamp()-interval '10 seconds',retry_deadline_at=clock_timestamp()+interval '50 minutes'
where notification_id='82106100-0000-4000-8000-000000000003';
create table public.g1_due_late as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_due_late to anon;
set local role anon;
insert into public.g1_due_late select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('18 late row is not stranded and never reuses the old window tag',
  1=(select count(*) from public.g1_due_late)
  and (select out_delivery_id from public.g1_due_late) is distinct from current_setting('g1.first_due_window')::uuid
  and (select out_delivery_id from public.g1_due_late)=(select id from ceit_connect_private.push_delivery_queue where notification_id='82106100-0000-4000-8000-000000000003'));
select public.acknowledge_push_delivery((select out_delivery_id from public.g1_due_late),(select out_lease_token from public.g1_due_late),'success',201);

insert into public.notifications(id,user_id,type,task_id,read_at) values
('82106200-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','unlock','82103000-0000-4000-8000-000000000004',clock_timestamp()),
('82106200-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000003','unlock','82103000-0000-4000-8000-000000000005',null);
update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '40 seconds',next_attempt_at=clock_timestamp()-interval '10 seconds',retry_deadline_at=clock_timestamp()+interval '50 minutes'
where notification_id in ('82106200-0000-4000-8000-000000000001','82106200-0000-4000-8000-000000000002');
select set_config('request.jwt.claims','{"sub":"82100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select set_config('g1.partial_unread_before',public.get_notification_unread_count()::text,true);
reset role;
create table public.g1_partial_read as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_partial_read to anon;
set local role anon;
insert into public.g1_partial_read select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('19 partial-read summary counts every alert in the window',
  (select out_body='2 of your tasks are now unlocked.' from public.g1_partial_read));
select public.acknowledge_push_delivery((select out_delivery_id from public.g1_partial_read),(select out_lease_token from public.g1_partial_read),'success',201);
set local role authenticated;
select set_config('g1.partial_unread_after',public.get_notification_unread_count()::text,true);
reset role;
select pg_temp.g1_record('20 push delivery changes neither bell rows nor unread count',
  2=(select count(*) from public.notifications where id in ('82106200-0000-4000-8000-000000000001','82106200-0000-4000-8000-000000000002'))
  and current_setting('g1.partial_unread_before')=current_setting('g1.partial_unread_after'));

insert into public.notifications(id,user_id,type,task_id,read_at) values
('82106300-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','live_operation_prep','82103000-0000-4000-8000-000000000001',clock_timestamp()),
('82106300-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000003','live_operation_prep','82103000-0000-4000-8000-000000000002',clock_timestamp());
update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '40 seconds',next_attempt_at=clock_timestamp()-interval '10 seconds',retry_deadline_at=clock_timestamp()+interval '50 minutes'
where notification_id in ('82106300-0000-4000-8000-000000000001','82106300-0000-4000-8000-000000000002');
create table public.g1_all_read as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_all_read to anon;
set local role anon;
insert into public.g1_all_read select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('21 all-read group is skipped into one clear final state',
  0=(select count(*) from public.g1_all_read)
  and 2=(select count(*) from ceit_connect_private.push_delivery_queue where notification_id in ('82106300-0000-4000-8000-000000000001','82106300-0000-4000-8000-000000000002') and state='terminal' and terminal_reason='all_read'));

insert into public.notifications(id,user_id,type,task_id) values
('82106400-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','mention','82103000-0000-4000-8000-000000000001'),
('82106400-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000003','leave_approved','82103000-0000-4000-8000-000000000001');
select pg_temp.g1_record('22 mention and leave alerts remain immediate and ungrouped',
  2=(select count(*) from ceit_connect_private.push_delivery_queue where notification_id in ('82106400-0000-4000-8000-000000000001','82106400-0000-4000-8000-000000000002') and group_window_id is null and next_attempt_at<=clock_timestamp()));
create table public.g1_immediate as select * from public.claim_push_deliveries(2) with no data;
grant select, insert on public.g1_immediate to anon;
set local role anon;
insert into public.g1_immediate select * from public.claim_push_deliveries(2);
reset role;
select pg_temp.g1_record('23 immediate types remain separate exact pushes',
  2=(select count(*) from public.g1_immediate)
  and exists(select 1 from public.g1_immediate where out_notification_type='mention' and out_body='You were mentioned in a task.')
  and exists(select 1 from public.g1_immediate where out_notification_type='leave_approved' and out_body='Your leave request was approved.'));
select public.acknowledge_push_delivery(out_delivery_id,out_lease_token,'success',201) from public.g1_immediate;

set local session_replication_role = replica;
insert into public.notifications(id,user_id,type,task_id)
values('82106500-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','assignment','82103000-0000-4000-8000-000000000001');
insert into ceit_connect_private.push_delivery_queue(
  id,notification_id,user_id,subscription_id,notification_type,next_attempt_at,retry_deadline_at
) values (
  '82106600-0000-4000-8000-000000000001','82106500-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','82105000-0000-4000-8000-000000000003','assignment',clock_timestamp()-interval '10 seconds',clock_timestamp()+interval '50 minutes'
);
set local session_replication_role = origin;
create table public.g1_legacy as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_legacy to anon;
set local role anon;
insert into public.g1_legacy select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('24 pre-migration null-group row remains an individual delivery',
  (select out_delivery_id='82106600-0000-4000-8000-000000000001' and out_body='You were assigned to a task.' from public.g1_legacy)
  and exists(select 1 from ceit_connect_private.push_delivery_queue where id='82106600-0000-4000-8000-000000000001' and group_window_id is null));
select public.acknowledge_push_delivery((select out_delivery_id from public.g1_legacy),(select out_lease_token from public.g1_legacy),'success',201);

insert into public.notifications(id,user_id,type,task_id) values
('82106700-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000004','unlock','82103000-0000-4000-8000-000000000001'),
('82106700-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000005','unlock','82103000-0000-4000-8000-000000000001');
select pg_temp.g1_record('25 deactivated and expired recipients enqueue nothing',not exists(
  select 1 from ceit_connect_private.push_delivery_queue where notification_id in ('82106700-0000-4000-8000-000000000001','82106700-0000-4000-8000-000000000002')));

insert into public.notifications(id,user_id,type,task_id) values
('82106800-0000-4000-8000-000000000001','82100000-0000-4000-8000-000000000003','live_operation_prep','82103000-0000-4000-8000-000000000003'),
('82106800-0000-4000-8000-000000000002','82100000-0000-4000-8000-000000000003','live_operation_prep','82103000-0000-4000-8000-000000000004');
update ceit_connect_private.push_delivery_queue
set group_window_started_at=clock_timestamp()-interval '40 seconds',next_attempt_at=clock_timestamp()-interval '10 seconds',retry_deadline_at=clock_timestamp()+interval '50 minutes',
    state='leased',attempt_count=1,lease_token='82106900-0000-4000-8000-000000000001',lease_expires_at=clock_timestamp()-interval '10 seconds',run_id='82106900-0000-4000-8000-000000000002'
where notification_id in ('82106800-0000-4000-8000-000000000001','82106800-0000-4000-8000-000000000002');
create table public.g1_expired_lease as select * from public.claim_push_deliveries(1) with no data;
grant select, insert on public.g1_expired_lease to anon;
set local role anon;
insert into public.g1_expired_lease select * from public.claim_push_deliveries(1);
reset role;
select pg_temp.g1_record('26 expired leased group is released and reclaimed together',
  1=(select count(*) from public.g1_expired_lease)
  and (select out_body='2 Live Operation call times are within 2 hours.' from public.g1_expired_lease)
  and 2=(select count(*) from ceit_connect_private.push_delivery_queue where notification_id in ('82106800-0000-4000-8000-000000000001','82106800-0000-4000-8000-000000000002') and state='leased' and attempt_count=2 and lease_token=(select out_lease_token from public.g1_expired_lease)));
select public.acknowledge_push_delivery((select out_delivery_id from public.g1_expired_lease),(select out_lease_token from public.g1_expired_lease),'success',201);

create function pg_temp.g1_force_launch_failure()
returns trigger
language plpgsql
as $$
begin
  raise exception 'G1 forced launch failure.';
end;
$$;
create trigger notifications_a0_g1_force_launch_failure
after insert on public.notifications
for each row execute function pg_temp.g1_force_launch_failure();
select set_config('g1.failed_launch_caught','false',true);
select set_config('request.jwt.claims','{"sub":"82100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
  begin
    update public.events set status='Active' where id='82102000-0000-4000-8000-000000000002';
  exception when others then
    perform set_config('g1.failed_launch_caught','true',true);
  end;
end;
$$;
reset role;
drop trigger notifications_a0_g1_force_launch_failure on public.notifications;
select pg_temp.g1_record('27 failed launch rolls back event and clears launch context',
  current_setting('g1.failed_launch_caught')::boolean
  and (select status='Draft' from public.events where id='82102000-0000-4000-8000-000000000002')
  and not exists(select 1 from ceit_connect_private.push_launch_group_context));

set local role authenticated;
do $$
begin
  begin
    perform * from ceit_connect_private.push_launch_group_context;
    perform pg_temp.g1_record('28 authenticated cannot read launch context',false);
  exception when insufficient_privilege then
    perform pg_temp.g1_record('28 authenticated cannot read launch context',true);
  end;
end;
$$;
do $$
begin
  begin
    insert into ceit_connect_private.push_launch_group_context values(pg_catalog.pg_current_xact_id());
    perform pg_temp.g1_record('29 authenticated cannot write launch context',false);
  exception when insufficient_privilege then
    perform pg_temp.g1_record('29 authenticated cannot write launch context',true);
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform * from ceit_connect_private.push_launch_group_context;
    perform pg_temp.g1_record('30 anon cannot read launch context',false);
  exception when insufficient_privilege then
    perform pg_temp.g1_record('30 anon cannot read launch context',true);
  end;
end;
$$;
do $$
begin
  begin
    insert into ceit_connect_private.push_launch_group_context values(pg_catalog.pg_current_xact_id());
    perform pg_temp.g1_record('31 anon cannot write launch context',false);
  exception when insufficient_privilege then
    perform pg_temp.g1_record('31 anon cannot write launch context',true);
  end;
end;
$$;
reset role;

select pg_temp.g1_record('32 group keys separate people',not exists(
  select 1 from ceit_connect_private.push_delivery_queue a
  join ceit_connect_private.push_delivery_queue b on b.user_id<>a.user_id and b.group_window_id=a.group_window_id
  where a.group_window_id is not null));
select pg_temp.g1_record('33 group keys separate notification types',not exists(
  select 1 from ceit_connect_private.push_delivery_queue a
  join ceit_connect_private.push_delivery_queue b on b.notification_type<>a.notification_type and b.group_window_id=a.group_window_id
  where a.group_window_id is not null));
select pg_temp.g1_record('34 every summary respects worker title and body limits',not exists(
  select 1 from (
    select out_title,out_body from public.g1_launch_claim
    union all select out_title,out_body from public.g1_due_first
    union all select out_title,out_body from public.g1_partial_read
    union all select out_title,out_body from public.g1_expired_lease
  ) summaries where char_length(out_title)>80 or char_length(out_body)>240));
select pg_temp.g1_record('35 delivery outcomes leave every exercised grouped row final or retryable',not exists(
  select 1 from ceit_connect_private.push_delivery_queue
  where notification_id::text like '82106%'
    and state='leased'
    and lease_expires_at<=clock_timestamp()));
select pg_temp.g1_record('36 grouping never changes notification storage count',
  6=(select count(*) from public.notifications where type='assignment' and task_id between '82103000-0000-4000-8000-000000000001' and '82103000-0000-4000-8000-000000000006'));

do $$
declare
  v_pass integer;
  v_total integer;
begin
  select count(*) filter(where passed), count(*)
  into v_pass, v_total
  from public.g1_behavior_results;
  if v_pass <> 36 or v_total <> 36 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back', v_pass, v_total;
  end if;
  raise exception 'TEST RESULTS 36/36 PASS — transaction intentionally rolled back';
end;
$$;
```
