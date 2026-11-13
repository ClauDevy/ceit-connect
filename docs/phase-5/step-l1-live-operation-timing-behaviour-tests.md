# L1 live-operation timing — behaviour test

Dev only. Apply `20261119120000_live_operation_timing_rules.sql`, open the Dev
SQL Editor, turn **Run without RLS** on, and run this entire block as one paste.
The final exception is intentional and rolls every fixture back.

```sql
begin;

create table public.l1_behaviour_results(
  n integer primary key,
  label text not null,
  passed boolean not null
);

-- Deterministic helper/priority/classifier checks run as postgres before the
-- first SET ROLE or JWT impersonation line. Exact boundaries are tested only
-- here because these functions accept an explicit as_of timestamp.
insert into public.l1_behaviour_results
select 1,'deliverable start and end remain due date',
  out_start='2026-11-20 00:00+00'::timestamptz
  and out_end='2026-11-20 00:00+00'::timestamptz and not out_is_running
from ceit_connect_private.task_timing_reference('Deliverable','2026-11-20 00:00+00',null,null,'To Do','2026-11-20 01:00+00');

insert into public.l1_behaviour_results values
(2,'deliverable overdue strict before boundary',
 public.calculate_effective_task_priority('Low','Deliverable','2026-11-20 00:00+00',null,null,'2026-11-20 00:00:00.001+00','To Do')='Critical'),
(3,'deliverable exact due is not overdue and is high',
 public.calculate_effective_task_priority('Low','Deliverable','2026-11-20 00:00+00',null,null,'2026-11-20 00:00+00','To Do')='High'),
(4,'deliverable exact plus 24 hours is high',
 public.calculate_effective_task_priority('Low','Deliverable','2026-11-21 00:00+00',null,null,'2026-11-20 00:00+00','To Do')='High'),
(5,'deliverable beyond 24 hours remains low',
 public.calculate_effective_task_priority('Low','Deliverable','2026-11-21 00:00:00.001+00',null,null,'2026-11-20 00:00+00','To Do')='Low');

insert into public.l1_behaviour_results
select 6,'dashboard deliverable exact lower 24h boundary included',
  not out_is_overdue and out_is_due_in_24_hours and not out_is_at_risk
from ceit_connect_private.classify_executive_dashboard_task('Deliverable','2026-11-20 00:00+00',null,null,'To Do','2026-11-20 00:00+00');
insert into public.l1_behaviour_results
select 7,'dashboard deliverable immediately before lower boundary overdue',
  out_is_overdue and not out_is_due_in_24_hours
from ceit_connect_private.classify_executive_dashboard_task('Deliverable','2026-11-20 00:00+00',null,null,'To Do','2026-11-20 00:00:00.001+00');
insert into public.l1_behaviour_results
select 8,'dashboard deliverable exact upper 24h boundary included',out_is_due_in_24_hours
from ceit_connect_private.classify_executive_dashboard_task('Deliverable','2026-11-21 00:00+00',null,null,'To Do','2026-11-20 00:00+00');
insert into public.l1_behaviour_results
select 9,'dashboard deliverable beyond 24h enters at risk',not out_is_due_in_24_hours and out_is_at_risk
from ceit_connect_private.classify_executive_dashboard_task('Deliverable','2026-11-21 00:00:00.001+00',null,null,'To Do','2026-11-20 00:00+00');

insert into public.l1_behaviour_results
select 10,'live call and end exact call boundary running',out_is_running and out_start='2026-11-20 10:00+00' and out_end='2026-11-20 12:00+00'
from ceit_connect_private.task_timing_reference('LiveOperation','2026-11-19 00:00+00','2026-11-20 10:00+00','2026-11-20 12:00+00','To Do','2026-11-20 10:00+00');
insert into public.l1_behaviour_results
select 11,'live exact end boundary is not running',not out_is_running
from ceit_connect_private.task_timing_reference('LiveOperation',null,'2026-11-20 10:00+00','2026-11-20 12:00+00','To Do','2026-11-20 12:00+00');
insert into public.l1_behaviour_results
select 12,'live call only uses call for start and end',out_start='2026-11-20 10:00+00' and out_end='2026-11-20 10:00+00' and not out_is_running
from ceit_connect_private.task_timing_reference('LiveOperation','2026-11-19 00:00+00','2026-11-20 10:00+00',null,'To Do','2026-11-20 09:00+00');
insert into public.l1_behaviour_results
select 13,'live due only falls back to due for both',out_start='2026-11-20 08:00+00' and out_end='2026-11-20 08:00+00'
from ceit_connect_private.task_timing_reference('LiveOperation','2026-11-20 08:00+00',null,null,'To Do','2026-11-20 09:00+00');
insert into public.l1_behaviour_results
select 14,'live no times returns null references and not running',out_start is null and out_end is null and not out_is_running
from ceit_connect_private.task_timing_reference('LiveOperation',null,null,null,'To Do','2026-11-20 09:00+00');

insert into public.l1_behaviour_results values
(15,'date-only due at 8 Manila with 6 PM call is not critical at 9 AM',
 public.calculate_effective_task_priority('Low','LiveOperation','2026-11-20 00:00+00','2026-11-20 18:00+08',null,'2026-11-20 09:00+08','To Do')='High');
insert into public.l1_behaviour_results
select 16,'date-only due does not make live operation overdue',not out_is_overdue and out_is_due_in_24_hours
from ceit_connect_private.classify_executive_dashboard_task('LiveOperation','2026-11-20 00:00+00','2026-11-20 18:00+08',null,'To Do','2026-11-20 09:00+08');
insert into public.l1_behaviour_results
select 17,'running classifier excludes all three warning flags',out_is_running and not out_is_overdue and not out_is_due_in_24_hours and not out_is_at_risk
from ceit_connect_private.classify_executive_dashboard_task('LiveOperation','2026-11-19 00:00+00','2026-11-20 08:00+00','2026-11-20 12:00+00','To Do','2026-11-20 09:00+00');
insert into public.l1_behaviour_results values
(18,'running low becomes high',public.calculate_effective_task_priority('Low','LiveOperation',null,'2026-11-20 08:00+00','2026-11-20 12:00+00','2026-11-20 09:00+00','To Do')='High'),
(19,'running critical stays critical',public.calculate_effective_task_priority('Critical','LiveOperation',null,'2026-11-20 08:00+00','2026-11-20 12:00+00','2026-11-20 09:00+00','To Do')='Critical'),
(20,'completed keeps stored priority',public.calculate_effective_task_priority('Low','LiveOperation',null,'2026-11-19 08:00+00','2026-11-19 12:00+00','2026-11-20 09:00+00','Completed')='Low');

insert into public.l1_behaviour_results
select 36,'dashboard exact 48h boundary is at risk',out_is_at_risk
from ceit_connect_private.classify_executive_dashboard_task('LiveOperation',null,'2026-11-22 09:00+00',null,'To Do','2026-11-20 09:00+00');
insert into public.l1_behaviour_results
select 37,'dashboard beyond 48h is not at risk',not out_is_at_risk
from ceit_connect_private.classify_executive_dashboard_task('LiveOperation',null,'2026-11-22 09:00:00.001+00',null,'To Do','2026-11-20 09:00+00');
insert into public.l1_behaviour_results values
(38,'running stored High stays High',public.calculate_effective_task_priority('High','LiveOperation',null,'2026-11-20 08:00+00','2026-11-20 12:00+00','2026-11-20 09:00+00','To Do')='High'),
(39,'running stored Medium raises to High',public.calculate_effective_task_priority('Medium','LiveOperation',null,'2026-11-20 08:00+00','2026-11-20 12:00+00','2026-11-20 09:00+00','To Do')='High');

set local session_replication_role=replica;
insert into public.committees(id,name) values('1b100000-0000-4000-8000-000000000001','L1 Behaviour');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','1b110000-0000-4000-8000-000000000001','authenticated','authenticated','l1-admin@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
('00000000-0000-0000-0000-000000000000','1b110000-0000-4000-8000-000000000002','authenticated','authenticated','l1-member@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
('00000000-0000-0000-0000-000000000000','1b110000-0000-4000-8000-000000000003','authenticated','authenticated','l1-inside@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now());
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('1b110000-0000-4000-8000-000000000001','l1-admin@example.invalid','L1 Admin','Admin',null,true),
('1b110000-0000-4000-8000-000000000002','l1-member@example.invalid','L1 Member','Member','1b100000-0000-4000-8000-000000000001',true),
('1b110000-0000-4000-8000-000000000003','l1-inside@example.invalid','L1 Inside','Member','1b100000-0000-4000-8000-000000000001',true);
insert into public.events(id,name,start_date,end_date,status,created_by)
values('1b120000-0000-4000-8000-000000000001','L1 Active','2026-01-01','2035-12-31','Active','1b110000-0000-4000-8000-000000000001');

insert into public.tasks(
 id,event_id,committee_id,title,description,phase,status,priority,task_type,
 due_date,call_time,end_time,primary_assignees,assist_assignees,is_confidential,
 request_backup,allowed_viewers,created_by,sort_order,created_at
) values
('1b130000-0000-4000-8000-000000000001','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Far call near due','ordinary','Run','To Do','Low','LiveOperation',statement_timestamp()+interval '1 hour',statement_timestamp()+interval '72 hours 1 minute',null,array['1b110000-0000-4000-8000-000000000002']::uuid[],'{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',1024,statement_timestamp()),
('1b130000-0000-4000-8000-000000000002','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Inside cutoff','ordinary','Run','To Do','Low','LiveOperation',statement_timestamp()+interval '10 days',statement_timestamp()+interval '71 hours 59 minutes',null,array['1b110000-0000-4000-8000-000000000003']::uuid[],'{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',2048,statement_timestamp()),
('1b130000-0000-4000-8000-000000000003','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Running confidential secret','SECRET','Run','To Do','Low','LiveOperation',statement_timestamp()-interval '1 day',statement_timestamp()-interval '1 hour',statement_timestamp()+interval '1 hour',array['1b110000-0000-4000-8000-000000000002']::uuid[],'{}',true,true,'{}','1b110000-0000-4000-8000-000000000001',3072,statement_timestamp()),
('1b130000-0000-4000-8000-000000000004','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Overdue relevant end','ordinary','Run','To Do','Low','LiveOperation',statement_timestamp()-interval '3 days',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day','{}','{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',4096,statement_timestamp()),
('1b130000-0000-4000-8000-000000000005','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Admin near task','ordinary','Run','To Do','Low','LiveOperation',statement_timestamp(),statement_timestamp()+interval '48 hours',null,array['1b110000-0000-4000-8000-000000000001']::uuid[],'{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',5120,statement_timestamp()),
('1b130000-0000-4000-8000-000000000006','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Already started','ordinary','Run','To Do','Low','LiveOperation',statement_timestamp()+interval '10 days',statement_timestamp()-interval '1 hour',null,array['1b110000-0000-4000-8000-000000000003']::uuid[],'{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',6144,statement_timestamp()),
('1b130000-0000-4000-8000-000000000007','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Already ended','ordinary','Run','To Do','Low','LiveOperation',statement_timestamp()+interval '10 days',statement_timestamp()-interval '2 hours',statement_timestamp()-interval '1 hour',array['1b110000-0000-4000-8000-000000000003']::uuid[],'{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',7168,statement_timestamp()),
('1b130000-0000-4000-8000-000000000008','1b120000-0000-4000-8000-000000000001','1b100000-0000-4000-8000-000000000001','Calendar uses call','ordinary','Run','To Do','Low','LiveOperation',((statement_timestamp() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila'),((((statement_timestamp() at time zone 'Asia/Manila')::date+5)::timestamp+interval '18 hours') at time zone 'Asia/Manila'),null,'{}','{}',false,false,'{}','1b110000-0000-4000-8000-000000000001',8192,statement_timestamp());
set local session_replication_role=origin;

-- First application impersonation line.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"1b110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select * from public.unassign_self('1b130000-0000-4000-8000-000000000001');
reset role;
insert into public.l1_behaviour_results
select 21,'one minute outside with far call and near due leaves through both layers',
  primary_assignees='{}'::uuid[] and not exists(select 1 from public.task_leave_requests where task_id=tasks.id)
from public.tasks where id='1b130000-0000-4000-8000-000000000001';

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"1b110000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select * from public.unassign_self('1b130000-0000-4000-8000-000000000002');
insert into public.l1_behaviour_results
select 22,'inside edit controls agree with approval path',not can_unassign_self and self_unassign_block_code='due'
from public.get_task_edit_controls('1b130000-0000-4000-8000-000000000002');
reset role;
insert into public.l1_behaviour_results
select 23,'one minute inside creates request and keeps assignment',
  '1b110000-0000-4000-8000-000000000003'=any(primary_assignees)
  and exists(select 1 from public.task_leave_requests where task_id=tasks.id and status='pending')
from public.tasks where id='1b130000-0000-4000-8000-000000000002';

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"1b110000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select * from public.unassign_self('1b130000-0000-4000-8000-000000000006');
select * from public.unassign_self('1b130000-0000-4000-8000-000000000007');
reset role;
insert into public.l1_behaviour_results
select 24,'already-started Member receives approval request',exists(select 1 from public.task_leave_requests where task_id='1b130000-0000-4000-8000-000000000006' and status='pending');
insert into public.l1_behaviour_results
select 25,'already-ended Member receives approval request',exists(select 1 from public.task_leave_requests where task_id='1b130000-0000-4000-8000-000000000007' and status='pending');

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"1b110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select * from public.unassign_self('1b130000-0000-4000-8000-000000000005');
insert into public.l1_behaviour_results
select 26,'Admin near-time behavior unchanged',not ('1b110000-0000-4000-8000-000000000001'=any(primary_assignees))
from public.tasks where id='1b130000-0000-4000-8000-000000000005';

insert into public.l1_behaviour_results
select 27,'running task excluded from dashboard overdue and due soon counts',
  out_overdue_task_count=3 and out_due_in_24_hours_task_count=0
from public.get_executive_dashboard_extras_overview('1b100000-0000-4000-8000-000000000001');
insert into public.l1_behaviour_results
select 28,'running task excluded from dashboard at risk count',out_at_risk_task_count=0
from public.list_executive_dashboard_member_slipping_signals('1b100000-0000-4000-8000-000000000001')
where out_member_id='1b110000-0000-4000-8000-000000000002';
insert into public.l1_behaviour_results
select 29,'confidential dashboard task stays masked',out_task_id is null and out_label='Confidential task'
from public.list_executive_dashboard_needs_attention('1b100000-0000-4000-8000-000000000001')
where out_category='help_wanted' and out_label='Confidential task';
insert into public.l1_behaviour_results
select 30,'overdue dashboard row returns END as relevant time',out_due_date between statement_timestamp()-interval '1 day 1 minute' and statement_timestamp()-interval '23 hours 59 minutes'
from public.list_executive_dashboard_needs_attention('1b100000-0000-4000-8000-000000000001')
where out_label='Overdue relevant end';
insert into public.l1_behaviour_results
select 31,'running attention row returns START as relevant time',out_due_date between statement_timestamp()-interval '1 hour 1 minute' and statement_timestamp()-interval '59 minutes'
from public.list_executive_dashboard_needs_attention('1b100000-0000-4000-8000-000000000001')
where out_label='Confidential task';
insert into public.l1_behaviour_results
select 32,'deadline calendar groups Live Operation by START',out_open_task_count=1
from public.list_executive_dashboard_deadlines('1b100000-0000-4000-8000-000000000001')
where out_calendar_date=(statement_timestamp() at time zone 'Asia/Manila')::date+5;
insert into public.l1_behaviour_results
select 33,'task detail keeps stored due date while priority uses timing',
  due_date between statement_timestamp()-interval '1 day 1 minute' and statement_timestamp()-interval '23 hours 59 minutes'
  and effective_priority='High'
from public.get_task_detail('1b130000-0000-4000-8000-000000000003');
select pg_catalog.set_config('request.jwt.claims','{"sub":"1b110000-0000-4000-8000-000000000002","role":"authenticated"}',true);
insert into public.l1_behaviour_results
select 34,'My Tasks keeps stored due date while priority uses timing',
  out_due_date between statement_timestamp()-interval '1 day 1 minute' and statement_timestamp()-interval '23 hours 59 minutes'
  and out_effective_priority='High'
from public.list_my_tasks(null,'deadline',50,0)
where out_id='1b130000-0000-4000-8000-000000000003';
select pg_catalog.set_config('request.jwt.claims','{"sub":"1b110000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.l1_behaviour_results
select 35,'board keeps stored due date while priority uses timing',
  due_date between statement_timestamp()-interval '1 day 1 minute' and statement_timestamp()-interval '23 hours 59 minutes'
  and effective_priority='High'
from public.list_event_board_tasks('1b120000-0000-4000-8000-000000000001',null)
where id='1b130000-0000-4000-8000-000000000003';
reset role;

do $$
declare v_total integer; v_failed text;
begin
  select pg_catalog.count(*),pg_catalog.string_agg(n||' '||label,', ' order by n)
    filter(where not passed)
  into v_total,v_failed from public.l1_behaviour_results;
  if v_total<>39 or v_failed is not null then
    raise exception 'TEST RESULTS FAIL: %',coalesce(v_failed,'wrong result count');
  end if;
  raise exception 'TEST RESULTS 39/39 PASS (intentional rollback)';
end $$;
```
