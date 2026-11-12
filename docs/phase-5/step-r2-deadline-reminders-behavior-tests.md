# R2 Paste B — deadline-reminder behavior

Run this as one paste in the **Dev** SQL Editor with **Run without RLS** enabled.
It uses the private clock-injected boundary, so no real-time wait is needed. The
final exception is intentional and rolls back every fixture. Expected final
result: `TEST RESULTS 26/26 PASS — transaction intentionally rolled back`. The
finished paste records exactly **26** result rows.

```sql
begin;
set local timezone='Asia/Manila';
set local statement_timeout='120s';

create table r2_behavior_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);
create function pg_temp.r2_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin insert into public.r2_behavior_results(label,passed) values(p_label,p_passed); end $$;

insert into public.committees(id,name) values
('7300c000-0000-4000-8000-000000000001','R2 Committee');

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select fixture.id,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated',fixture.email,'',now(),'{}','{}',now(),now()
from (values
 ('73000000-0000-4000-8000-000000000001'::uuid,'r2-admin@test.local'),
 ('73000000-0000-4000-8000-000000000002'::uuid,'r2-primary@test.local'),
 ('73000000-0000-4000-8000-000000000003'::uuid,'r2-assist@test.local'),
 ('73000000-0000-4000-8000-000000000004'::uuid,'r2-later@test.local'),
 ('73000000-0000-4000-8000-000000000005'::uuid,'r2-inactive@test.local')
) fixture(id,email);

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('73000000-0000-4000-8000-000000000001','r2-admin@test.local','R2 Admin','Admin',null,true),
('73000000-0000-4000-8000-000000000002','r2-primary@test.local','R2 Primary','Member','7300c000-0000-4000-8000-000000000001',true),
('73000000-0000-4000-8000-000000000003','r2-assist@test.local','R2 Assist','Member','7300c000-0000-4000-8000-000000000001',true),
('73000000-0000-4000-8000-000000000004','r2-later@test.local','R2 Later','Member','7300c000-0000-4000-8000-000000000001',true),
('73000000-0000-4000-8000-000000000005','r2-inactive@test.local','R2 Inactive','Member','7300c000-0000-4000-8000-000000000001',false);
select set_config('ceit_connect.officer_writer','',true);

insert into public.events(id,name,start_date,end_date,status,created_by) values
('73002000-0000-4000-8000-000000000001','R2 Active Event','2026-11-01','2027-12-31','Active','73000000-0000-4000-8000-000000000001'),
('73002000-0000-4000-8000-000000000002','R2 Draft Event','2026-11-01','2027-12-31','Draft','73000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(
  id,event_id,committee_id,title,phase,status,task_type,due_date,call_time,end_time,
  primary_assignees,assist_assignees,is_confidential,request_backup
) values
('73003000-0000-4000-8000-000000000001','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 Bootstrap task','R2','To Do','Deliverable','2026-11-20 12:00+00',null,null,array['73000000-0000-4000-8000-000000000002'::uuid],array['73000000-0000-4000-8000-000000000003'::uuid,'73000000-0000-4000-8000-000000000005'::uuid],false,false),
('73003000-0000-4000-8000-000000000002','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 Live Operation','R2','In Progress','LiveOperation','2026-11-20 20:00+00','2026-11-20 01:00+00','2026-11-20 03:00+00',array['73000000-0000-4000-8000-000000000002'::uuid],array['73000000-0000-4000-8000-000000000003'::uuid],false,false),
('73003000-0000-4000-8000-000000000003','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 Assist-only Backlog','R2','To Do','Deliverable','2026-11-20 10:00+00',null,null,'{}',array['73000000-0000-4000-8000-000000000003'::uuid],false,false),
('73003000-0000-4000-8000-000000000004','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 Completed','R2','Completed','Deliverable','2026-11-20 05:00+00',null,null,array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false),
('73003000-0000-4000-8000-000000000005','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 Unassigned','R2','To Do','Deliverable','2026-11-20 04:00+00',null,null,'{}','{}',false,false),
('73003000-0000-4000-8000-000000000006','73002000-0000-4000-8000-000000000002','7300c000-0000-4000-8000-000000000001','R2 Draft parent','R2','To Do','Deliverable','2026-11-20 04:00+00',null,null,array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false),
('73003000-0000-4000-8000-000000000007','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 Past target','R2','To Do','Deliverable','2026-11-20 00:00+00',null,null,array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false),
('73003000-0000-4000-8000-000000000008','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 End-only','R2','To Do','LiveOperation','2026-11-22 00:00+00',null,'2026-11-20 01:00+00',array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false),
('73003000-0000-4000-8000-000000000009','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 24-hour edge','R2','To Do','Deliverable','2026-11-21 00:00+00',null,null,array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false),
('73003000-0000-4000-8000-000000000010','73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001','R2 2-hour edge','R2','To Do','LiveOperation','2026-11-22 00:00+00','2026-11-20 02:00+00','2026-11-20 04:00+00',array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications where task_id::text like '73003%';

select set_config('r2.bootstrap_count',ceit_connect_private.bootstrap_deadline_reminders_at('2026-11-20 00:00+00')::text,true);
select pg_temp.r2_record('01 bootstrap marks every active in-window recipient and both kinds',
  current_setting('r2.bootstrap_count')::integer=9);
select pg_temp.r2_record('02 bootstrap creates no notifications',
  0=(select count(*) from public.notifications where task_id::text like '73003%' and type in ('task_due_soon','live_operation_prep')));
select pg_temp.r2_record('03 bootstrap is idempotent',
  ceit_connect_private.bootstrap_deadline_reminders_at('2026-11-20 00:00+00')=0);

select set_config('ceit_connect.task_assignee_writer','edit_active_event_task',true);
update public.tasks set assist_assignees=array[
  '73000000-0000-4000-8000-000000000003'::uuid,
  '73000000-0000-4000-8000-000000000005'::uuid,
  '73000000-0000-4000-8000-000000000004'::uuid
] where id='73003000-0000-4000-8000-000000000001';
select set_config('ceit_connect.task_assignee_writer','',true);
delete from public.notifications where task_id='73003000-0000-4000-8000-000000000001' and type not in ('task_due_soon','live_operation_prep');
create table r2_after_new_assignee as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('04 person assigned after bootstrap receives one reminder',
  (select out_occurrences_handled=1 and out_notifications_created=1 and out_status='Completed.' from r2_after_new_assignee)
  and 1=(select count(*) from public.notifications where task_id='73003000-0000-4000-8000-000000000001'
    and type='task_due_soon' and user_id='73000000-0000-4000-8000-000000000004'));
select pg_temp.r2_record('05 already-ledgered recipients receive nothing from that occurrence',
  not exists(select 1 from public.notifications where task_id='73003000-0000-4000-8000-000000000001'
    and type='task_due_soon' and user_id in ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000003')));
select pg_temp.r2_record('06 repeated run handles zero fully-ledgered occurrences',
  (select out_occurrences_handled=0 and out_notifications_created=0
   from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00')));

select set_config('ceit_connect.task_assignee_writer','edit_active_event_task',true);
update public.tasks set assist_assignees=array[
  '73000000-0000-4000-8000-000000000003'::uuid,
  '73000000-0000-4000-8000-000000000004'::uuid
] where id='73003000-0000-4000-8000-000000000002';
select set_config('ceit_connect.task_assignee_writer','',true);
delete from public.notifications where task_id='73003000-0000-4000-8000-000000000002' and type not in ('task_due_soon','live_operation_prep');
create table r2_live_new_assignee as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('07 Live Operation due and prep reminders are separate occurrences',
  (select out_occurrences_handled=2 and out_notifications_created=2 from r2_live_new_assignee)
  and 1=(select count(*) from public.notifications where task_id='73003000-0000-4000-8000-000000000002'
    and user_id='73000000-0000-4000-8000-000000000004' and type='task_due_soon')
  and 1=(select count(*) from public.notifications where task_id='73003000-0000-4000-8000-000000000002'
    and user_id='73000000-0000-4000-8000-000000000004' and type='live_operation_prep'));
select pg_temp.r2_record('08 assist-only Backlog task is represented in the ledger',
  exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
    where task_id='73003000-0000-4000-8000-000000000003'
      and user_id='73000000-0000-4000-8000-000000000003'));
select pg_temp.r2_record('09 Completed Draft past inactive and end-only paths stay silent',
  not exists(select 1 from public.notifications where task_id in (
    '73003000-0000-4000-8000-000000000004','73003000-0000-4000-8000-000000000006',
    '73003000-0000-4000-8000-000000000007','73003000-0000-4000-8000-000000000008'))
  and not exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
    where user_id='73000000-0000-4000-8000-000000000005'));
select pg_temp.r2_record('10 unassigned task notifies nobody',
  not exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
    where task_id='73003000-0000-4000-8000-000000000005'));
select pg_temp.r2_record('11 exact 24-hour and 2-hour upper boundaries qualify',
  exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
    where task_id='73003000-0000-4000-8000-000000000009' and reminder_kind='task_due_soon')
  and exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
    where task_id='73003000-0000-4000-8000-000000000010' and reminder_kind='live_operation_prep'));

select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,task_type,due_date,
  primary_assignees,assist_assignees,is_confidential,request_backup)
values('73003000-0000-4000-8000-000000000011','73002000-0000-4000-8000-000000000001',
  '7300c000-0000-4000-8000-000000000001','R2 Confidential secret','R2','To Do','Deliverable',
  '2026-11-20 01:00+00',array['73000000-0000-4000-8000-000000000002'::uuid],'{}',true,false);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications where task_id='73003000-0000-4000-8000-000000000011';
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:30+00');
select pg_temp.r2_record('12 late-entry confidential task receives the next-run reminder',
  1=(select count(*) from public.notifications where task_id='73003000-0000-4000-8000-000000000011'
    and user_id='73000000-0000-4000-8000-000000000002' and type='task_due_soon'));
select set_config('ceit_connect.task_assignee_writer','edit_active_event_task',true);
update public.tasks set primary_assignees='{}' where id='73003000-0000-4000-8000-000000000011';
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.r2_record('13 confidential bell copy uses generic title and no link after access loss',
  exists(select 1 from public.list_notifications(50) where out_type='task_due_soon'
    and out_task_title='Confidential Task' and out_task_id is null)
  and not exists(select 1 from public.list_notifications(50) where out_task_title='R2 Confidential secret'));
reset role;
delete from public.notifications where task_id='73003000-0000-4000-8000-000000000011' and type='task_due_soon';
select pg_temp.r2_record('14 N3-style deletion does not erase dedupe memory or regenerate',
  exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
    where task_id='73003000-0000-4000-8000-000000000011' and reminder_kind='task_due_soon')
  and (select out_notifications_created=0
    from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:30+00')));

select set_config('request.jwt.claims','{"sub":"73000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('ceit_connect.task_assignee_writer','edit_active_event_task',true);
select set_config('ceit_connect.task_access_writer','edit_active_event_task',true);
update public.tasks set due_date='2026-11-20 13:00+00'
where id='73003000-0000-4000-8000-000000000001';
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications where task_id='73003000-0000-4000-8000-000000000001' and type not in ('task_due_soon','live_operation_prep');
create table r2_moved_target as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('15 moved deadline is a new occurrence for every current active assignee',
  (select out_occurrences_handled=1 and out_notifications_created=3 from r2_moved_target));
select set_config('ceit_connect.task_assignee_writer','edit_active_event_task',true);
select set_config('ceit_connect.task_access_writer','edit_active_event_task',true);
update public.tasks set due_date='2026-11-20 12:00+00',
  assist_assignees=array['73000000-0000-4000-8000-000000000003'::uuid]
where id='73003000-0000-4000-8000-000000000001';
update public.tasks set assist_assignees=array[
  '73000000-0000-4000-8000-000000000003'::uuid,
  '73000000-0000-4000-8000-000000000004'::uuid]
where id='73003000-0000-4000-8000-000000000001';
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications where task_id='73003000-0000-4000-8000-000000000001' and type not in ('task_due_soon','live_operation_prep');
select pg_temp.r2_record('16 returning to an old target or readding an assignee does not resend',
  (select out_occurrences_handled=0 and out_notifications_created=0
   from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00')));

select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(event_id,committee_id,title,phase,status,task_type,due_date,
  primary_assignees,assist_assignees,is_confidential,request_backup)
select '73002000-0000-4000-8000-000000000001','7300c000-0000-4000-8000-000000000001',
  'R2 Cap task '||series.n,'R2 Cap','To Do','Deliverable',
  '2026-11-20 03:00+00'::timestamptz + pg_catalog.make_interval(secs=>series.n),
  array['73000000-0000-4000-8000-000000000002'::uuid],'{}',false,false
from pg_catalog.generate_series(1,101) as series(n);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications as notification_row
using public.tasks as task_row
where notification_row.task_id=task_row.id and task_row.phase='R2 Cap'
  and notification_row.type not in ('task_due_soon','live_operation_prep');
create table r2_cap_run_one as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('17 first capped run handles the earliest 100 occurrences',
  (select out_occurrences_handled=100 and out_notifications_created=100 from r2_cap_run_one)
  and 100=(select count(*) from public.notifications n join public.tasks t on t.id=n.task_id
    where t.phase='R2 Cap' and n.type='task_due_soon'));
select pg_temp.r2_record('18 first capped run leaves only the latest target unledgered',
  1=(select count(*) from public.tasks t where t.phase='R2 Cap' and not exists(
    select 1 from ceit_connect_private.task_deadline_reminder_ledger l
    where l.task_id=t.id and l.reminder_kind='task_due_soon' and l.target_at=t.due_date
      and l.user_id='73000000-0000-4000-8000-000000000002'))
  and (select t.title='R2 Cap task 101' from public.tasks t where t.phase='R2 Cap' and not exists(
    select 1 from ceit_connect_private.task_deadline_reminder_ledger l
    where l.task_id=t.id and l.reminder_kind='task_due_soon' and l.target_at=t.due_date
      and l.user_id='73000000-0000-4000-8000-000000000002')));
create table r2_cap_run_two as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('19 second run handles the remaining one while first 100 remain in-window',
  (select out_occurrences_handled=1 and out_notifications_created=1 from r2_cap_run_two)
  and 101=(select count(*) from public.notifications n join public.tasks t on t.id=n.task_id
    where t.phase='R2 Cap' and n.type='task_due_soon'));
select pg_temp.r2_record('20 third run sends nothing again',
  (select out_occurrences_handled=0 and out_notifications_created=0
   from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00'))
  and 101=(select count(*) from public.notifications n join public.tasks t on t.id=n.task_id
    where t.phase='R2 Cap' and n.type='task_due_soon'));

insert into ceit_connect_private.task_deadline_reminder_ledger(
  task_id,reminder_kind,target_at,user_id,recorded_at,recorded_reason)
select gen_random_uuid(),'task_due_soon','2026-01-01 00:00+00',gen_random_uuid(),
  '2026-01-01 00:00+00','sent' from pg_catalog.generate_series(1,501);
insert into ceit_connect_private.deadline_reminder_runs(
  id,started_at,finished_at,as_of,status)
select gen_random_uuid(),'2026-01-01 00:00+00','2026-01-01 00:01+00',
  '2026-01-01 00:00+00','completed' from pg_catalog.generate_series(1,501);
create table r2_cleanup_one as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('21 cleanup is capped at 500 ledger and run-history rows',
  (select out_ledger_rows_cleaned=500 and out_run_history_rows_cleaned=500 from r2_cleanup_one));
create table r2_cleanup_two as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_record('22 next run cleans the one remaining old row of each kind',
  (select out_ledger_rows_cleaned=1 and out_run_history_rows_cleaned=1 from r2_cleanup_two));

insert into public.push_subscriptions(
  id,user_id,endpoint,endpoint_hash,p256dh,auth_secret,device_label,platform
) values (
  '73005000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002',
  'https://fcm.googleapis.com/r2/device',
  extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/r2/device','UTF8'),'sha256'),
  repeat('A',87),repeat('b',22),'R2 device','desktop'
);
insert into public.notifications(id,user_id,type,task_id) values
('73006000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','task_due_soon','73003000-0000-4000-8000-000000000001'),
('73006000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000002','live_operation_prep','73003000-0000-4000-8000-000000000002');
select public.configure_push_sender_credential_hash(
  'current',7302,repeat('22',32),
  pg_catalog.encode(extensions.digest(
    pg_catalog.decode(repeat('22',32),'hex') || pg_catalog.convert_to('r2-test-capability','UTF8'),
    'sha256'),'hex')
);
select set_config('request.headers','{"x-ceit-push-capability":"r2-test-capability"}',true);
update ceit_connect_private.push_delivery_queue as queue
set next_attempt_at=pg_catalog.clock_timestamp()+interval '1 hour'
where queue.state='pending' and queue.notification_id not in (
  '73006000-0000-4000-8000-000000000001'::uuid,
  '73006000-0000-4000-8000-000000000002'::uuid
);
create table r2_push_claim as select * from public.claim_push_deliveries(100);
select pg_temp.r2_record('23 push claims both R2 types with exact generic copy',
  exists(select 1 from r2_push_claim where out_notification_type='task_due_soon'
    and out_title='CEIT Connect' and out_body='A task is due soon.')
  and exists(select 1 from r2_push_claim where out_notification_type='live_operation_prep'
    and out_title='CEIT Connect' and out_body='A Live Operation call time is soon.'));
select pg_temp.r2_record('24 push copy leaks no task title or identity',
  not exists(select 1 from r2_push_claim where out_notification_type in ('task_due_soon','live_operation_prep')
    and (out_body like '%R2 %' or out_body like '%7300%' or out_body like '%Primary%')));

insert into public.notifications(id,user_id,type,task_id,read_at,created_at) values
('73007000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002',
  'task_due_soon','73003000-0000-4000-8000-000000000001','1900-01-01','1900-01-01');
select ceit_connect_private.purge_old_read_notifications(pg_catalog.clock_timestamp());
select pg_temp.r2_record('25 N3a remains type-agnostic for an old read R2 row',
  not exists(select 1 from public.notifications where id='73007000-0000-4000-8000-000000000001'));

set local role authenticated;
do $$ begin
  begin perform * from public.run_deadline_reminders();
  exception when insufficient_privilege then
    perform pg_temp.r2_record('26 browser role cannot execute the real-clock runner',true); return;
  end;
  perform pg_temp.r2_record('26 browser role cannot execute the real-clock runner',false);
end $$;
reset role;

do $$
declare v_total integer; v_failed integer;
begin
  select count(*),count(*) filter(where not passed) into v_total,v_failed
  from public.r2_behavior_results;
  if v_total<>26 or v_failed<>0 then
    raise exception 'TEST RESULTS %/26 FAIL — % failed; transaction intentionally rolled back',v_total-v_failed,v_failed;
  end if;
  raise exception 'TEST RESULTS 26/26 PASS — transaction intentionally rolled back';
end $$;
```
