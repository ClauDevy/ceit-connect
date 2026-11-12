# R1 Paste B — request-notification behavior

Run this as one paste in the **Dev** SQL Editor with **Run without RLS** enabled.
The final exception is intentional and rolls back every fixture. Expected final
result: `TEST RESULTS 38/38 PASS — transaction intentionally rolled back`. The
finished paste records exactly **38** result rows.

```sql
begin;
set local timezone='Asia/Manila';
set local statement_timeout='120s';

create table r1_behavior_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);
create function pg_temp.r1_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin insert into public.r1_behavior_results(label,passed) values(p_label,p_passed); end $$;

insert into public.committees(id,name) values
('7200c000-0000-4000-8000-000000000001','R1 Committee'),
('7200c000-0000-4000-8000-000000000002','R1 Other Committee');

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select fixture.id,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated',fixture.email,'',now(),'{}','{}',now(),now()
from (values
 ('72000000-0000-4000-8000-000000000001'::uuid,'r1-admin@test.local'),
 ('72000000-0000-4000-8000-000000000002'::uuid,'r1-admin2@test.local'),
 ('72000000-0000-4000-8000-000000000003'::uuid,'r1-coadmin@test.local'),
 ('72000000-0000-4000-8000-000000000004'::uuid,'r1-other-coadmin@test.local'),
 ('72000000-0000-4000-8000-000000000005'::uuid,'r1-primary@test.local'),
 ('72000000-0000-4000-8000-000000000006'::uuid,'r1-assist@test.local'),
 ('72000000-0000-4000-8000-000000000007'::uuid,'r1-volunteer@test.local'),
 ('72000000-0000-4000-8000-000000000008'::uuid,'r1-requester@test.local'),
 ('72000000-0000-4000-8000-000000000009'::uuid,'r1-inactive-admin@test.local')
) fixture(id,email);

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('72000000-0000-4000-8000-000000000001','r1-admin@test.local','R1 Admin','Admin',null,true),
('72000000-0000-4000-8000-000000000003','r1-coadmin@test.local','R1 CoAdmin','Co-Admin','7200c000-0000-4000-8000-000000000001',true),
('72000000-0000-4000-8000-000000000004','r1-other-coadmin@test.local','R1 Other CoAdmin','Co-Admin','7200c000-0000-4000-8000-000000000002',true),
('72000000-0000-4000-8000-000000000005','r1-primary@test.local','R1 Primary','Member','7200c000-0000-4000-8000-000000000001',true),
('72000000-0000-4000-8000-000000000006','r1-assist@test.local','R1 Assist','Member','7200c000-0000-4000-8000-000000000001',true),
('72000000-0000-4000-8000-000000000007','r1-volunteer@test.local','R1 Volunteer','Member','7200c000-0000-4000-8000-000000000001',true),
('72000000-0000-4000-8000-000000000008','r1-requester@test.local','R1 Requester','Member','7200c000-0000-4000-8000-000000000001',true),
('72000000-0000-4000-8000-000000000009','r1-inactive-admin@test.local','R1 Inactive Admin','Admin',null,false);
select set_config('ceit_connect.officer_writer','',true);

insert into public.events(id,name,start_date,end_date,status,created_by) values
('72002000-0000-4000-8000-000000000001','R1 Active Event','2026-11-01','2027-12-31','Active','72000000-0000-4000-8000-000000000001');

-- Use an owning officer who is not one of the inserted assignees; the existing
-- assignee guard rejects selecting the JWT actor during fixture creation.
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(
  id,event_id,committee_id,title,phase,status,primary_assignees,assist_assignees,
  is_confidential,request_backup,due_date
) values
('72003000-0000-4000-8000-000000000001','72002000-0000-4000-8000-000000000001','7200c000-0000-4000-8000-000000000001','R1 Volunteer task','Volunteer','To Do',array['72000000-0000-4000-8000-000000000001'::uuid,'72000000-0000-4000-8000-000000000005'::uuid],array['72000000-0000-4000-8000-000000000006'::uuid],false,true,null),
('72003000-0000-4000-8000-000000000002','72002000-0000-4000-8000-000000000001','7200c000-0000-4000-8000-000000000001','R1 Cancel task','Cancel','In Progress',array['72000000-0000-4000-8000-000000000008'::uuid],array['72000000-0000-4000-8000-000000000005'::uuid],false,false,now()+interval '24 hours'),
('72003000-0000-4000-8000-000000000003','72002000-0000-4000-8000-000000000001','7200c000-0000-4000-8000-000000000001','R1 Approval task','Approval','In Progress',array['72000000-0000-4000-8000-000000000008'::uuid],array['72000000-0000-4000-8000-000000000005'::uuid],false,false,now()+interval '24 hours'),
('72003000-0000-4000-8000-000000000004','72002000-0000-4000-8000-000000000001','7200c000-0000-4000-8000-000000000001','R1 Denial task','Denial','In Progress',array['72000000-0000-4000-8000-000000000008'::uuid],array['72000000-0000-4000-8000-000000000005'::uuid],false,false,now()+interval '24 hours'),
('72003000-0000-4000-8000-000000000005','72002000-0000-4000-8000-000000000001','7200c000-0000-4000-8000-000000000001','R1 Stale task','Stale','In Progress',array['72000000-0000-4000-8000-000000000008'::uuid,'72000000-0000-4000-8000-000000000005'::uuid],'{}',false,false,now()+interval '24 hours'),
('72003000-0000-4000-8000-000000000006','72002000-0000-4000-8000-000000000001','7200c000-0000-4000-8000-000000000001','R1 Secret title','Secret','To Do',array['72000000-0000-4000-8000-000000000005'::uuid],'{}',true,false,null);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications where task_id::text like '72003%';

-- Volunteer submission: actor is excluded, active approvers are deduplicated.
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
set local role authenticated;
select * from public.volunteer_for_task('72003000-0000-4000-8000-000000000001');
reset role;
select pg_temp.r1_record('01 volunteer offer targets exactly the current eligible recipients',(
  with expected as (
    select profile.id as user_id
    from public.users profile
    join public.tasks task_row on task_row.id='72003000-0000-4000-8000-000000000001'
    where profile.is_active is true
      and profile.id<>'72000000-0000-4000-8000-000000000007'
      and (profile.role='Admin'
        or (profile.role='Co-Admin' and profile.committee_id=task_row.committee_id)
        or profile.id=any(task_row.primary_assignees))
      and public.task_content_access_for_user(task_row.id,profile.id)='real'
  ), actual as (
    select notification.user_id
    from public.notifications notification
    where notification.task_id='72003000-0000-4000-8000-000000000001'
      and notification.type='volunteer_offer'
  )
  select not exists(select user_id from expected except select user_id from actual)
    and not exists(select user_id from actual except select user_id from expected)
));
select pg_temp.r1_record('02 active Admin is notified once despite also being primary',
  1=(select count(*) from public.notifications where task_id='72003000-0000-4000-8000-000000000001' and type='volunteer_offer' and user_id='72000000-0000-4000-8000-000000000001'));
select pg_temp.r1_record('03 owning CoAdmin is notified',exists(
  select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000001' and type='volunteer_offer' and user_id='72000000-0000-4000-8000-000000000003'));
select pg_temp.r1_record('04 current real-access primary is notified',exists(
  select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000001' and type='volunteer_offer' and user_id='72000000-0000-4000-8000-000000000005'));
select pg_temp.r1_record('05 actor assist other-committee and inactive users are excluded',not exists(
  select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000001' and type='volunteer_offer'
    and user_id=any(array['72000000-0000-4000-8000-000000000004'::uuid,'72000000-0000-4000-8000-000000000006'::uuid,'72000000-0000-4000-8000-000000000007'::uuid,'72000000-0000-4000-8000-000000000009'::uuid])));

select set_config('r1.volunteer_before',(select count(*)::text from public.notifications),true);
set local role authenticated;
select * from public.withdraw_task_volunteer('72003000-0000-4000-8000-000000000001');
reset role;
select pg_temp.r1_record('06 volunteer withdrawal is silent',current_setting('r1.volunteer_before')::bigint=(select count(*) from public.notifications));
select pg_temp.r1_record('07 withdrawal removes the pending offer',not exists(select 1 from public.task_volunteers where task_id='72003000-0000-4000-8000-000000000001' and user_id='72000000-0000-4000-8000-000000000007'));

set local role authenticated;
select * from public.volunteer_for_task('72003000-0000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('r1.offer_before_accept',(select count(*)::text from public.notifications where type='volunteer_offer'),true);
set local role authenticated;
select * from public.accept_task_volunteer('72003000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000007');
reset role;
select pg_temp.r1_record('08 volunteer acceptance adds no R1 outcome',current_setting('r1.offer_before_accept')::bigint=(select count(*) from public.notifications where type='volunteer_offer'));
select pg_temp.r1_record('09 acceptance keeps the existing assignment notification',1=(select count(*) from public.notifications where task_id='72003000-0000-4000-8000-000000000001' and type='assignment' and user_id='72000000-0000-4000-8000-000000000007'));
select pg_temp.r1_record('10 acceptance removes the selected offer',not exists(select 1 from public.task_volunteers where task_id='72003000-0000-4000-8000-000000000001' and user_id='72000000-0000-4000-8000-000000000007'));

select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select * from public.volunteer_for_task('72003000-0000-4000-8000-000000000001');
reset role;
select set_config('r1.before_backup_cancel',(select count(*)::text from public.notifications),true);
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select * from public.set_task_backup_request('72003000-0000-4000-8000-000000000001',false);
reset role;
select pg_temp.r1_record('11 backup cancellation removes remaining offers',not exists(select 1 from public.task_volunteers where task_id='72003000-0000-4000-8000-000000000001'));
select pg_temp.r1_record('12 backup cancellation itself is silent',current_setting('r1.before_backup_cancel')::bigint=(select count(*) from public.notifications));

-- Leave request submission and cancellation.
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select * from public.unassign_self('72003000-0000-4000-8000-000000000002');
reset role;
select pg_temp.r1_record('13 leave submission targets exactly the current eligible leaders',(
  with expected as (
    select profile.id as user_id
    from public.users profile
    join public.tasks task_row on task_row.id='72003000-0000-4000-8000-000000000002'
    where profile.is_active is true
      and profile.id<>'72000000-0000-4000-8000-000000000008'
      and (profile.role='Admin'
        or (profile.role='Co-Admin' and profile.committee_id=task_row.committee_id))
      and public.task_content_access_for_user(task_row.id,profile.id)='real'
  ), actual as (
    select notification.user_id
    from public.notifications notification
    where notification.task_id='72003000-0000-4000-8000-000000000002'
      and notification.type='leave_requested'
  )
  select not exists(select user_id from expected except select user_id from actual)
    and not exists(select user_id from actual except select user_id from expected)
));
select pg_temp.r1_record('14 leave requester is excluded',not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000002' and type='leave_requested' and user_id='72000000-0000-4000-8000-000000000008'));
select pg_temp.r1_record('15 other-committee and inactive leaders are excluded',not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000002' and type='leave_requested' and user_id=any(array['72000000-0000-4000-8000-000000000004'::uuid,'72000000-0000-4000-8000-000000000009'::uuid])));
select set_config('r1.after_first_request',(select count(*)::text from public.notifications),true);
set local role authenticated;
do $$ begin
  begin perform * from public.unassign_self('72003000-0000-4000-8000-000000000002');
  exception when sqlstate 'CCL01' then return; end;
  raise exception 'Expected CCL01 for double leave submission.';
end $$;
reset role;
select pg_temp.r1_record('16 failed double submission creates nothing',current_setting('r1.after_first_request')::bigint=(select count(*) from public.notifications));

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values('72000000-0000-4000-8000-000000000002','r1-admin2@test.local','R1 Admin 2','Admin',null,true);
select set_config('ceit_connect.officer_writer','',true);
set local role authenticated;
select public.cancel_task_leave_request('72003000-0000-4000-8000-000000000002');
reset role;
select pg_temp.r1_record('17 cancellation recalculates the exact current approver set',(
  with expected as (
    select profile.id as user_id
    from public.users profile
    join public.tasks task_row on task_row.id='72003000-0000-4000-8000-000000000002'
    where profile.is_active is true
      and profile.id<>'72000000-0000-4000-8000-000000000008'
      and (profile.role='Admin'
        or (profile.role='Co-Admin' and profile.committee_id=task_row.committee_id))
      and public.task_content_access_for_user(task_row.id,profile.id)='real'
  ), actual as (
    select notification.user_id
    from public.notifications notification
    where notification.task_id='72003000-0000-4000-8000-000000000002'
      and notification.type='leave_cancelled'
  )
  select not exists(select user_id from expected except select user_id from actual)
    and not exists(select user_id from actual except select user_id from expected)
));
select pg_temp.r1_record('18 newly eligible Admin gets cancellation but not old submission',exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000002' and type='leave_cancelled' and user_id='72000000-0000-4000-8000-000000000002') and not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000002' and type='leave_requested' and user_id='72000000-0000-4000-8000-000000000002'));
select pg_temp.r1_record('19 cancellation actor is excluded',not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000002' and type='leave_cancelled' and user_id='72000000-0000-4000-8000-000000000008'));
select set_config('r1.after_cancel',(select count(*)::text from public.notifications),true);
set local role authenticated;
do $$ begin
  begin perform public.cancel_task_leave_request('72003000-0000-4000-8000-000000000002');
  exception when sqlstate 'CCL02' then return; end;
  raise exception 'Expected CCL02 for repeated cancellation.';
end $$;
reset role;
select pg_temp.r1_record('20 repeated cancellation creates nothing',current_setting('r1.after_cancel')::bigint=(select count(*) from public.notifications));

-- Approval: suppression runs first by trigger name, request outcome runs second,
-- then assign_task_people updates the task and tasks_z8_notifications consumes
-- the marker instead of notifying the remaining assist assignee.
set local role authenticated;
select * from public.unassign_self('72003000-0000-4000-8000-000000000003');
select set_config('r1.approval_request_id',(
  select out_id::text from public.list_pending_task_leave_requests('72003000-0000-4000-8000-000000000003')
  where out_is_requester
),true);
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.resolve_task_leave_request(current_setting('r1.approval_request_id')::uuid,'approved');
reset role;
select pg_temp.r1_record('21 approval creates the requester outcome despite suppression trigger',1=(select count(*) from public.notifications where task_id='72003000-0000-4000-8000-000000000003' and type='leave_approved' and user_id='72000000-0000-4000-8000-000000000008'));
select pg_temp.r1_record('22 approval suppresses assignee-removal status notification',not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000003' and type='status_change' and user_id='72000000-0000-4000-8000-000000000005'));
select pg_temp.r1_record('23 approval performs final-primary reset while retaining assist',exists(select 1 from public.tasks where id='72003000-0000-4000-8000-000000000003' and status='To Do' and primary_assignees='{}'::uuid[] and assist_assignees=array['72000000-0000-4000-8000-000000000005'::uuid]));
select pg_temp.r1_record('24 approval suppression marker is consumed',not exists(select 1 from ceit_connect_private.notification_suppression_context where transaction_id=pg_current_xact_id() and task_id='72003000-0000-4000-8000-000000000003'));
select pg_temp.r1_record('25 other approvers get no approval outcome',not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000003' and type='leave_approved' and user_id<>'72000000-0000-4000-8000-000000000008'));
select set_config('r1.after_approval',(select count(*)::text from public.notifications),true);
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.cancel_task_leave_request('72003000-0000-4000-8000-000000000003');
  exception when sqlstate 'CCL02' then return; end;
  raise exception 'Expected CCL02 after approval.';
end $$;
reset role;
select pg_temp.r1_record('26 cancel after approval creates nothing',current_setting('r1.after_approval')::bigint=(select count(*) from public.notifications));

-- Denial and repeated resolution.
set local role authenticated;
select * from public.unassign_self('72003000-0000-4000-8000-000000000004');
select set_config('r1.denial_request_id',(
  select out_id::text from public.list_pending_task_leave_requests('72003000-0000-4000-8000-000000000004')
  where out_is_requester
),true);
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.resolve_task_leave_request(current_setting('r1.denial_request_id')::uuid,'denied');
reset role;
select pg_temp.r1_record('27 denial notifies only the requester',1=(select count(*) from public.notifications where task_id='72003000-0000-4000-8000-000000000004' and type='leave_denied' and user_id='72000000-0000-4000-8000-000000000008') and not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000004' and type='leave_denied' and user_id<>'72000000-0000-4000-8000-000000000008'));
select pg_temp.r1_record('28 denial retains requester assignment',exists(select 1 from public.tasks where id='72003000-0000-4000-8000-000000000004' and '72000000-0000-4000-8000-000000000008'=any(primary_assignees)));
select set_config('r1.after_denial',(select count(*)::text from public.notifications),true);
set local role authenticated;
do $$ begin
  begin perform public.resolve_task_leave_request(current_setting('r1.denial_request_id')::uuid,'denied');
  exception when insufficient_privilege then return; end;
  raise exception 'Expected denial repeat to fail.';
end $$;
reset role;
select pg_temp.r1_record('29 repeated resolution creates nothing',current_setting('r1.after_denial')::bigint=(select count(*) from public.notifications));

-- System-driven stale cancellation remains silent.
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
set local role authenticated;
select * from public.unassign_self('72003000-0000-4000-8000-000000000005');
reset role;
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select * from public.assign_task_people('72003000-0000-4000-8000-000000000005',array['72000000-0000-4000-8000-000000000005'::uuid],'{}'::uuid[]);
reset role;
select pg_temp.r1_record('30 stale assignment closure records machine reason',exists(select 1 from public.task_leave_requests where task_id='72003000-0000-4000-8000-000000000005' and status='cancelled' and stale_reason='no_longer_assigned' and resolved_by is null));
select pg_temp.r1_record('31 system-driven closure emits no cancellation notification',not exists(select 1 from public.notifications where task_id='72003000-0000-4000-8000-000000000005' and type='leave_cancelled'));

-- P1 generic delivery mapping for all five R1 types.
insert into public.push_subscriptions(
  id,user_id,endpoint,endpoint_hash,p256dh,auth_secret,device_label,platform
) values (
  '72005000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/r1/device',
  extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/r1/device','UTF8'),'sha256'),
  repeat('A',87),repeat('b',22),'R1 device','desktop'
);
insert into public.notifications(id,user_id,type,task_id) values
('72006000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','volunteer_offer','72003000-0000-4000-8000-000000000001'),
('72006000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','leave_requested','72003000-0000-4000-8000-000000000002'),
('72006000-0000-4000-8000-000000000003','72000000-0000-4000-8000-000000000001','leave_cancelled','72003000-0000-4000-8000-000000000002'),
('72006000-0000-4000-8000-000000000004','72000000-0000-4000-8000-000000000001','leave_approved','72003000-0000-4000-8000-000000000003'),
('72006000-0000-4000-8000-000000000005','72000000-0000-4000-8000-000000000001','leave_denied','72003000-0000-4000-8000-000000000004');
select public.configure_push_sender_credential_hash(
  'current',7201,repeat('11',32),
  pg_catalog.encode(extensions.digest(
    pg_catalog.decode(repeat('11',32),'hex') || pg_catalog.convert_to('r1-test-capability','UTF8'),
    'sha256'
  ),'hex')
);
select set_config('request.headers','{"x-ceit-push-capability":"r1-test-capability"}',true);
-- This paste runs against a shared Dev queue. Keep earlier pending deliveries
-- out of the bounded claim; the enclosing rollback restores them unchanged.
update ceit_connect_private.push_delivery_queue as queue
set next_attempt_at=pg_catalog.clock_timestamp()+interval '1 hour'
where queue.state='pending'
  and queue.notification_id not in (
    '72006000-0000-4000-8000-000000000001'::uuid,
    '72006000-0000-4000-8000-000000000002'::uuid,
    '72006000-0000-4000-8000-000000000003'::uuid,
    '72006000-0000-4000-8000-000000000004'::uuid,
    '72006000-0000-4000-8000-000000000005'::uuid
  );
create table r1_push_claim as select * from public.claim_push_deliveries(100);
select pg_temp.r1_record('32 push claims all five R1 types',not exists(
  select expected.type_name from (values('volunteer_offer'),('leave_requested'),('leave_cancelled'),('leave_approved'),('leave_denied')) expected(type_name)
  where not exists(select 1 from public.r1_push_claim claim_row where claim_row.out_notification_type=expected.type_name)));
select pg_temp.r1_record('33 push bodies are exact generic event wording',
  exists(select 1 from public.r1_push_claim where out_notification_type='volunteer_offer' and out_body='A task has a new volunteer offer.')
  and exists(select 1 from public.r1_push_claim where out_notification_type='leave_requested' and out_body='A task has a new leave request.')
  and exists(select 1 from public.r1_push_claim where out_notification_type='leave_cancelled' and out_body='A leave request was cancelled.')
  and exists(select 1 from public.r1_push_claim where out_notification_type='leave_approved' and out_body='Your leave request was approved.')
  and exists(select 1 from public.r1_push_claim where out_notification_type='leave_denied' and out_body='Your leave request was denied.'));
select pg_temp.r1_record('34 push output contains no fixture identity or task content',not exists(
  select 1 from public.r1_push_claim where out_notification_type in ('volunteer_offer','leave_requested','leave_cancelled','leave_approved','leave_denied')
    and (out_title<>'CEIT Connect' or out_body like '%R1 %' or out_body like '%7200%' or out_body like '%Admin%' or out_body like '%Requester%')));

-- N3 cleanup remains type-agnostic and unread-safe.
insert into public.notifications(id,user_id,type,task_id,read_at,created_at) values
('72007000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001','leave_denied','72003000-0000-4000-8000-000000000004','1900-01-01','1900-01-01'),
('72007000-0000-4000-8000-000000000002','72000000-0000-4000-8000-000000000001','leave_denied','72003000-0000-4000-8000-000000000004',null,'1900-01-01');
select ceit_connect_private.purge_old_read_notifications(pg_catalog.clock_timestamp());
select pg_temp.r1_record('35 N3 cleanup removes an old read R1 row',not exists(select 1 from public.notifications where id='72007000-0000-4000-8000-000000000001'));
select pg_temp.r1_record('36 N3 cleanup preserves an old unread R1 row',exists(select 1 from public.notifications where id='72007000-0000-4000-8000-000000000002'));

-- The unchanged N1 reader must never leak a confidential title for an R1 type.
select ceit_connect_private.insert_notifications('leave_denied','72003000-0000-4000-8000-000000000006',null,array['72000000-0000-4000-8000-000000000004'::uuid]);
select set_config('request.jwt.claims','{"sub":"72000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.r1_record('37 confidential R1 reader uses exact N1 generic title without leaking text',exists(
  select 1 from public.list_notifications(50) where out_type='leave_denied' and out_task_title='Confidential Task'
) and not exists(select 1 from public.list_notifications(50) where out_task_title='R1 Secret title'));
reset role;

-- A non-pending INSERT must return before any OLD reference or notification.
select set_config('r1.before_nonpending_insert',(select count(*)::text from public.notifications),true);
insert into public.task_leave_requests(
  id,task_id,requester_id,status,resolved_at
) values (
  '72008000-0000-4000-8000-000000000001',
  '72003000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000007',
  'denied',clock_timestamp()
);
select pg_temp.r1_record('38 non-pending leave INSERT succeeds silently',
  current_setting('r1.before_nonpending_insert')::bigint=(select count(*) from public.notifications));

do $$
declare v_total integer; v_failed integer;
begin
  select count(*),count(*) filter(where not passed) into v_total,v_failed
  from public.r1_behavior_results;
  if v_total<>38 or v_failed<>0 then
    raise exception 'TEST RESULTS %/38 FAIL — % failed; transaction intentionally rolled back',v_total-v_failed,v_failed;
  end if;
  raise exception 'TEST RESULTS 38/38 PASS — transaction intentionally rolled back';
end $$;
```
