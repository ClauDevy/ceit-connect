# N1 Paste B: notification behavior and confidentiality

Run this one self-contained paste in the **Dev SQL Editor** only, with
**Run without RLS** enabled (postgres),
after N1 Paste A passes. It creates its own Auth/profile/event/task/comment/leave
fixtures and intentionally aborts the transaction.

It records exactly **48** result rows. The burst is 45 recipients across three
comments (20 + 20 + 5). Checks 16–17 derive the backup-recipient set from the
active Dev profiles, because Dev can have additional council-wide Admins beyond
the two N1 fixtures.

Expected sentinel:

`TEST RESULTS 48/48 PASS — transaction intentionally rolled back`

```sql
begin;
set local timezone='Asia/Manila';
set local statement_timeout='120s';

create table n1_behavior_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);

create function pg_temp.n1_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin insert into public.n1_behavior_results(label,passed) values(p_label,p_passed); end $$;

insert into public.committees(id,name) values
('5100c000-0000-4000-8000-000000000001','N1 Committee');

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select fixture.id,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated',fixture.email,'',now(),'{}','{}',now(),now()
from (values
 ('51000000-0000-4000-8000-000000000001'::uuid,'n1-admin@test.local'),
 ('51000000-0000-4000-8000-000000000002'::uuid,'n1-coadmin@test.local'),
 ('51000000-0000-4000-8000-000000000003'::uuid,'n1-member1@test.local'),
 ('51000000-0000-4000-8000-000000000004'::uuid,'n1-member2@test.local'),
 ('51000000-0000-4000-8000-000000000005'::uuid,'n1-member3@test.local'),
 ('51000000-0000-4000-8000-000000000006'::uuid,'n1-inactive@test.local'),
 ('51000000-0000-4000-8000-000000000007'::uuid,'n1-revoked@test.local')
) fixture(id,email);

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('51000000-0000-4000-8000-000000000001','n1-admin@test.local','N1 Admin','Admin',null,true),
('51000000-0000-4000-8000-000000000002','n1-coadmin@test.local','N1 CoAdmin','Co-Admin','5100c000-0000-4000-8000-000000000001',true),
('51000000-0000-4000-8000-000000000003','n1-member1@test.local','N1 Member 1','Member','5100c000-0000-4000-8000-000000000001',true),
('51000000-0000-4000-8000-000000000004','n1-member2@test.local','N1 Member 2','Member','5100c000-0000-4000-8000-000000000001',true),
('51000000-0000-4000-8000-000000000005','n1-member3@test.local','N1 Member 3','Member','5100c000-0000-4000-8000-000000000001',true),
('51000000-0000-4000-8000-000000000006','n1-inactive@test.local','N1 Inactive','Member','5100c000-0000-4000-8000-000000000001',true),
('51000000-0000-4000-8000-000000000007','n1-revoked@test.local','N1 Revoked','Member','5100c000-0000-4000-8000-000000000001',true);
select set_config('ceit_connect.officer_writer','',true);

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select md5('n1-burst-'||series.i)::uuid,
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'n1-burst-'||series.i||'@test.local','',now(),'{}','{}',now(),now()
from generate_series(1,45) series(i);

insert into public.users(id,email,full_name,role,committee_id,is_active)
select md5('n1-burst-'||series.i)::uuid,
  'n1-burst-'||series.i||'@test.local','N1 Burst '||series.i,'Member',
  '5100c000-0000-4000-8000-000000000001',true
from generate_series(1,45) series(i);

insert into public.events(id,name,start_date,end_date,status,created_by) values
('51002000-0000-4000-8000-000000000001','N1 Draft','2026-11-01','2026-11-30','Draft','51000000-0000-4000-8000-000000000001'),
('51002000-0000-4000-8000-000000000002','N1 Active','2026-11-01','2026-11-30','Active','51000000-0000-4000-8000-000000000001'),
('51002000-0000-4000-8000-000000000003','N1 Archive','2026-11-01','2026-11-30','Active','51000000-0000-4000-8000-000000000001'),
('51002000-0000-4000-8000-000000000004','N1 Hidden Draft','2026-11-01','2026-11-30','Draft','51000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(
  id,event_id,committee_id,title,phase,status,primary_assignees,assist_assignees,
  is_confidential,request_backup,depends_on_task_id
) values
('51003000-0000-4000-8000-000000000001','51002000-0000-4000-8000-000000000001','5100c000-0000-4000-8000-000000000001','Draft task','Draft','To Do',array['51000000-0000-4000-8000-000000000004'::uuid,'51000000-0000-4000-8000-000000000006'::uuid],'{}',false,false,null),
('51003000-0000-4000-8000-000000000002','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Active task','Active','To Do',array['51000000-0000-4000-8000-000000000003'::uuid,'51000000-0000-4000-8000-000000000004'::uuid,'51000000-0000-4000-8000-000000000006'::uuid],'{}',false,false,null),
('51003000-0000-4000-8000-000000000003','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Prerequisite','Prerequisite','To Do',array['51000000-0000-4000-8000-000000000003'::uuid],'{}',false,false,null),
('51003000-0000-4000-8000-000000000004','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Dependent','Dependent','To Do',array['51000000-0000-4000-8000-000000000004'::uuid],array['51000000-0000-4000-8000-000000000005'::uuid],false,false,'51003000-0000-4000-8000-000000000003'),
('51003000-0000-4000-8000-000000000005','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Backup task','Backup','To Do',array['51000000-0000-4000-8000-000000000003'::uuid],'{}',false,false,null),
('51003000-0000-4000-8000-000000000006','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Claim task','Claim','To Do','{}','{}',false,false,null),
('51003000-0000-4000-8000-000000000007','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Secret title','Secret','To Do',array['51000000-0000-4000-8000-000000000007'::uuid],'{}',true,false,null),
('51003000-0000-4000-8000-000000000008','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Leave task','Leave','In Progress',array['51000000-0000-4000-8000-000000000004'::uuid],'{}',false,false,null),
('51003000-0000-4000-8000-000000000009','51002000-0000-4000-8000-000000000003','5100c000-0000-4000-8000-000000000001','Archived task','Archived','To Do',array['51000000-0000-4000-8000-000000000004'::uuid],'{}',false,false,null),
('51003000-0000-4000-8000-000000000010','51002000-0000-4000-8000-000000000002','5100c000-0000-4000-8000-000000000001','Completed dependent','Completed dependent','Completed',array['51000000-0000-4000-8000-000000000004'::uuid],'{}',false,false,'51003000-0000-4000-8000-000000000003'),
('51003000-0000-4000-8000-000000000011','51002000-0000-4000-8000-000000000004','5100c000-0000-4000-8000-000000000001','Hidden draft title','Hidden','To Do','{}','{}',false,false,null);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);

update public.users as profile
set is_active=false
where profile.id='51000000-0000-4000-8000-000000000006';

update public.events set status='Archived'
where id='51002000-0000-4000-8000-000000000003';
delete from public.notifications where task_id::text like '51003%';

select pg_temp.n1_record('01 fixture baseline is clean',not exists(select 1 from public.notifications where task_id::text like '51003%'));

select out_id from public.add_task_comment('51003000-0000-4000-8000-000000000001','Draft mention',false,array['51000000-0000-4000-8000-000000000002'::uuid]);
select pg_temp.n1_record('02 Draft comment fires nothing',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000001'));

do $$ begin
  begin perform public.add_task_comment('51003000-0000-4000-8000-000000000009','Archived mention',false,array['51000000-0000-4000-8000-000000000004'::uuid]);
  exception when sqlstate 'CCC05' then return; end;
  raise exception 'Archived comment unexpectedly succeeded';
end $$;
select pg_temp.n1_record('03 Archived comment fires nothing',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000009'));

select ceit_connect_private.insert_notifications('assignment','51003000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000001',array['51000000-0000-4000-8000-000000000004'::uuid,'51000000-0000-4000-8000-000000000006'::uuid]);
select pg_temp.n1_record('04 inactive recipient filtered',(select count(*)=1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002'));
select pg_temp.n1_record('05 active recipient retained',exists(select 1 from public.notifications where user_id='51000000-0000-4000-8000-000000000004' and task_id='51003000-0000-4000-8000-000000000002'));
delete from public.notifications where task_id='51003000-0000-4000-8000-000000000002';

select ceit_connect_private.insert_notifications('assignment','51003000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000004',array['51000000-0000-4000-8000-000000000004'::uuid]);
select pg_temp.n1_record('06 actor is excluded',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002'));

select * from public.assign_task_people('51003000-0000-4000-8000-000000000002',array['51000000-0000-4000-8000-000000000003'::uuid,'51000000-0000-4000-8000-000000000004'::uuid,'51000000-0000-4000-8000-000000000006'::uuid],array['51000000-0000-4000-8000-000000000005'::uuid]);
select pg_temp.n1_record('07 assignment addition emits one',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='assignment'));
select pg_temp.n1_record('08 assignment targets added active user',exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='assignment' and user_id='51000000-0000-4000-8000-000000000005'));
select pg_temp.n1_record('09 retained inactive assignee not notified',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and user_id='51000000-0000-4000-8000-000000000006'));
do $$ begin
  begin
    perform public.assign_task_people('51003000-0000-4000-8000-000000000002',array['51000000-0000-4000-8000-000000000003'::uuid,'51000000-0000-4000-8000-000000000004'::uuid,'51000000-0000-4000-8000-000000000006'::uuid],array['51000000-0000-4000-8000-000000000005'::uuid]);
  exception when sqlstate 'CCN01' then return;
  end;
  raise exception 'No-op assignment save unexpectedly succeeded.';
end $$;
select pg_temp.n1_record('10 no-op assignment save does not replay',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='assignment'));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select * from public.claim_task('51003000-0000-4000-8000-000000000006');
select pg_temp.n1_record('11 self-claim is silent',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000006'));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
update public.tasks set status='In Progress' where id='51003000-0000-4000-8000-000000000002';
reset role;
select pg_temp.n1_record('12 status change notifies two others',2=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='status_change'));
select pg_temp.n1_record('13 status actor excluded',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='status_change' and user_id='51000000-0000-4000-8000-000000000003'));
select pg_temp.n1_record('14 status inactive assignee excluded',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='status_change' and user_id='51000000-0000-4000-8000-000000000006'));
select set_config('n1.status_count',(select count(*)::text from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='status_change'),true);
set local role authenticated;
update public.tasks set status=status where id='51003000-0000-4000-8000-000000000002';
reset role;
select pg_temp.n1_record('15 no-op status does not replay',current_setting('n1.status_count')::bigint=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='status_change'));

select * from public.set_task_backup_request('51003000-0000-4000-8000-000000000005',true);
select pg_temp.n1_record('16 backup request includes fixture leaders',
  array['51000000-0000-4000-8000-000000000001'::uuid,'51000000-0000-4000-8000-000000000002'::uuid]
    <@ (select coalesce(array_agg(notification_row.user_id order by notification_row.user_id),'{}'::uuid[])
        from public.notifications notification_row
        where notification_row.task_id='51003000-0000-4000-8000-000000000005'
          and notification_row.type='backup_request'));
select pg_temp.n1_record('17 backup recipients match active leader rule',
  (select coalesce(array_agg(profile.id order by profile.id),'{}'::uuid[])
   from public.users profile
   where profile.is_active is true
     and profile.id is distinct from '51000000-0000-4000-8000-000000000003'::uuid
     and (profile.role='Admin'
       or (profile.role='Co-Admin' and profile.committee_id='5100c000-0000-4000-8000-000000000001'::uuid)))
  =
  (select coalesce(array_agg(notification_row.user_id order by notification_row.user_id),'{}'::uuid[])
   from public.notifications notification_row
   where notification_row.task_id='51003000-0000-4000-8000-000000000005'
     and notification_row.type='backup_request'));
select set_config('n1.backup_count',(select count(*)::text from public.notifications where task_id='51003000-0000-4000-8000-000000000005' and type='backup_request'),true);
select set_config('ceit_connect.task_assignee_writer','set_task_backup_request',true);
update public.tasks set request_backup=request_backup where id='51003000-0000-4000-8000-000000000005';
select set_config('ceit_connect.task_assignee_writer','',true);
select pg_temp.n1_record('18 backup no-op does not replay',current_setting('n1.backup_count')::bigint=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000005' and type='backup_request'));

set local role authenticated;
update public.tasks set status='Completed' where id='51003000-0000-4000-8000-000000000003';
reset role;
select pg_temp.n1_record('19 completion unlocks two active assignees',2=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000004' and type='unlock'));
select pg_temp.n1_record('20 Completed dependent is not unlocked',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000010' and type='unlock'));
select pg_temp.n1_record('21 unlock rows belong to dependent',not exists(select 1 from public.notifications where type='unlock' and task_id<>'51003000-0000-4000-8000-000000000004'));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
update public.events set status='Active' where id='51002000-0000-4000-8000-000000000001';
reset role;
select pg_temp.n1_record('22 Draft launch emits one assignment',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000001' and type='assignment'));
select pg_temp.n1_record('23 Draft launch filters inactive assignee',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000001' and user_id='51000000-0000-4000-8000-000000000006'));

insert into public.task_leave_requests(task_id,requester_id)
values('51003000-0000-4000-8000-000000000008','51000000-0000-4000-8000-000000000004');
select set_config('n1.leave_count',(select count(*)::text from public.notifications),true);
select public.resolve_task_leave_request((select id from public.task_leave_requests where task_id='51003000-0000-4000-8000-000000000008' and status='pending'),'approved');
select pg_temp.n1_record('24 leave approval is silent',current_setting('n1.leave_count')::bigint=(select count(*) from public.notifications));
select pg_temp.n1_record('25 leave suppression context consumed',not exists(select 1 from ceit_connect_private.notification_suppression_context where transaction_id=pg_current_xact_id()));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select set_config('n1.comment_id',out_id::text,true) from public.add_task_comment('51003000-0000-4000-8000-000000000002','Heads up with mention',true,array['51000000-0000-4000-8000-000000000004'::uuid]);
select pg_temp.n1_record('26 mention emitted once',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='mention' and user_id='51000000-0000-4000-8000-000000000004'));
select pg_temp.n1_record('27 Heads Up emitted to other assignee',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='heads_up' and user_id='51000000-0000-4000-8000-000000000005'));
select pg_temp.n1_record('28 mention wins over Heads Up',not exists(select 1 from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='heads_up' and user_id='51000000-0000-4000-8000-000000000004'));
select set_config('n1.comment_before_count',(select count(*)::text from public.notifications),true);
do $$ begin
  begin
    perform public.edit_task_comment(current_setting('n1.comment_id')::uuid,'Heads up with mention',true,array['51000000-0000-4000-8000-000000000004'::uuid],null);
  exception when sqlstate 'CCC09' then return;
  end;
  raise exception 'No-op comment edit unexpectedly succeeded.';
end $$;
select pg_temp.n1_record('29 no-op comment edit is silent',current_setting('n1.comment_before_count')::bigint=(select count(*) from public.notifications));
select * from public.edit_task_comment(current_setting('n1.comment_id')::uuid,'Heads up with two mentions',true,array['51000000-0000-4000-8000-000000000004'::uuid,'51000000-0000-4000-8000-000000000005'::uuid],null);
select pg_temp.n1_record('30 newly added edit mention emits once',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000002' and type='mention' and user_id='51000000-0000-4000-8000-000000000005'));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select * from public.assign_task_people('51003000-0000-4000-8000-000000000007','{}','{}');
delete from public.notifications where task_id='51003000-0000-4000-8000-000000000007';
select * from public.assign_task_people('51003000-0000-4000-8000-000000000007',array['51000000-0000-4000-8000-000000000007'::uuid],'{}');
select * from public.assign_task_people('51003000-0000-4000-8000-000000000007','{}','{}');
select pg_temp.n1_record('31 revoked user retains notification row',1=(select count(*) from public.notifications where task_id='51003000-0000-4000-8000-000000000007' and user_id='51000000-0000-4000-8000-000000000007'));
insert into public.notifications(user_id,type,task_id)
values('51000000-0000-4000-8000-000000000007','assignment','51003000-0000-4000-8000-000000000011');
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
select pg_temp.n1_record('32 masked access keeps task ID with generic title',exists(select 1 from public.list_notifications(50) where out_task_id='51003000-0000-4000-8000-000000000007' and out_task_title='Confidential Task'));
select pg_temp.n1_record('33 hidden access removes task ID and all hidden titles',exists(select 1 from public.list_notifications(50) where out_task_id is null and out_task_title='Confidential Task') and not exists(select 1 from public.list_notifications(50) where out_task_title in ('Secret title','Hidden draft title')));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
do $$ begin
  begin perform public.get_notification_unread_count();
  exception when insufficient_privilege then perform pg_temp.n1_record('34 inactive reader denied',true); return; end;
  perform pg_temp.n1_record('34 inactive reader denied',false);
end $$;
insert into public.notifications(id,user_id,type,task_id)
values('51004000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000006','assignment','51003000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.n1_record('35 inactive raw SELECT sees zero',not exists(select 1 from public.notifications));
reset role;
delete from public.notifications
where id='51004000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.n1_record('36 raw SELECT is current-user only',not exists(select 1 from public.notifications where user_id<>'51000000-0000-4000-8000-000000000004'));
reset role;

set local role authenticated;
do $$ begin
  begin insert into public.notifications(user_id,type,task_id) values('51000000-0000-4000-8000-000000000004','assignment','51003000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then perform pg_temp.n1_record('37 raw INSERT denied',true); return; end;
  perform pg_temp.n1_record('37 raw INSERT denied',false);
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin update public.notifications set read_at=now() where user_id='51000000-0000-4000-8000-000000000004';
  exception when insufficient_privilege then perform pg_temp.n1_record('38 raw UPDATE denied',true); return; end;
  perform pg_temp.n1_record('38 raw UPDATE denied',false);
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin delete from public.notifications where user_id='51000000-0000-4000-8000-000000000004';
  exception when insufficient_privilege then perform pg_temp.n1_record('39 raw DELETE denied',true); return; end;
  perform pg_temp.n1_record('39 raw DELETE denied',false);
end $$;
reset role;

select set_config('n1.read_id',(select id::text from public.notifications where user_id='51000000-0000-4000-8000-000000000004' order by created_at,id limit 1),true);
select pg_temp.n1_record('40 mark one owns existing row',public.mark_notification_read(current_setting('n1.read_id')::uuid));
select pg_temp.n1_record('41 mark one is idempotent',public.mark_notification_read(current_setting('n1.read_id')::uuid));
select pg_temp.n1_record('42 mark foreign row returns false',not public.mark_notification_read((select id from public.notifications where user_id='51000000-0000-4000-8000-000000000005' limit 1)));
select public.mark_all_notifications_read();
select pg_temp.n1_record('43 mark all clears caller unread',public.get_notification_unread_count()=0);

reset role;
insert into public.notifications(user_id,type,task_id,created_at)
select '51000000-0000-4000-8000-000000000004','assignment','51003000-0000-4000-8000-000000000002',clock_timestamp()-series.i*interval '1 second'
from generate_series(1,22) series(i);
select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.n1_record('44 reader returns requested 21',21=(select count(*) from public.list_notifications(21)));
select pg_temp.n1_record('45 reader order is stable',not exists(select 1 from (select out_created_at,out_id,lag(out_created_at) over(order by out_created_at desc,out_id desc) previous_created from public.list_notifications(21)) page where previous_created is not null and out_created_at>previous_created));

select set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select out_id from public.add_task_comment('51003000-0000-4000-8000-000000000002','Burst one',false,array(select md5('n1-burst-'||i)::uuid from generate_series(1,20) i));
select out_id from public.add_task_comment('51003000-0000-4000-8000-000000000002','Burst two',false,array(select md5('n1-burst-'||i)::uuid from generate_series(21,40) i));
select out_id from public.add_task_comment('51003000-0000-4000-8000-000000000002','Burst three',false,array(select md5('n1-burst-'||i)::uuid from generate_series(41,45) i));
select pg_temp.n1_record('46 three-comment burst creates exactly 45 mentions',45=(select count(*) from public.notifications where type='mention' and user_id=any(array(select md5('n1-burst-'||i)::uuid from generate_series(1,45) i))));
select pg_temp.n1_record('47 every burst recipient receives one',not exists(select 1 from generate_series(1,45) i where 1<>(select count(*) from public.notifications where type='mention' and user_id=md5('n1-burst-'||i)::uuid)));

select set_config('n1.former_count',(select count(*)::text from public.notifications),true);
select * from public.former_member_eligibility('51000000-0000-4000-8000-000000000006');
select pg_temp.n1_record('48 former-member eligibility is silent',current_setting('n1.former_count')::bigint=(select count(*) from public.notifications));

do $$
declare v_bad text; v_count integer;
begin
  select count(*),string_agg(ordinal||' '||label,', ' order by ordinal) filter(where not passed)
  into v_count,v_bad from n1_behavior_results;
  if v_count<>48 or v_bad is not null then
    raise exception 'TEST FAILURES: %',coalesce(v_bad,'wrong result count');
  end if;
  raise exception 'TEST RESULTS 48/48 PASS — transaction intentionally rolled back';
end
$$;
```

