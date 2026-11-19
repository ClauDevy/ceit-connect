# E1 important email behavior paste

Run after `npx supabase db push` in Dev. This self-contained transaction creates
its own fixtures and credential, exercises real trigger/RPC behavior, stores
results in ordinary in-transaction tables, and intentionally rolls back.
Expected: `TEST RESULTS 21/21 PASS — transaction intentionally rolled back`.

```sql
begin;
create table public.e1_behavior_results(label text primary key,passed boolean not null);
revoke all on public.e1_behavior_results from public,anon,authenticated,service_role;
create function public.e1_record(p_label text,p_passed boolean) returns void
language plpgsql security definer set search_path='' as $$ begin
 insert into public.e1_behavior_results values(p_label,coalesce(p_passed,false));
end $$;
create table public.e1_claimed(seq integer generated always as identity,delivery_id uuid,
 lease_token uuid,run_id uuid,run_token uuid,notification_type text,
 task_title text,target_path text,is_confidential boolean,attempt integer);
revoke all on public.e1_claimed from public,anon,authenticated,service_role;

-- Isolate the rolled-back paste from any existing Dev delivery history. The
-- rollback restores every pre-existing row.
delete from ceit_connect_private.email_send_attempts;
delete from ceit_connect_private.email_delivery_queue;
delete from ceit_connect_private.email_delivery_runs;

insert into public.committees(id,name) values
('e100c000-0000-4000-8000-000000000001','E1 Behavior Committee');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('e1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-main@example.invalid','',now(),'{}','{}',now(),now()),
('e1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-inactive@example.invalid','',now(),'{}','{}',now(),now()),
('e1000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-unconfirmed@example.invalid','',null,'{}','{}',now(),now()),
('e1000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','e1-auth-mismatch@example.invalid','',now(),'{}','{}',now(),now());
select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('e1000000-0000-4000-8000-000000000001','e1-main@example.invalid','E1 Main','Member','e100c000-0000-4000-8000-000000000001',true),
('e1000000-0000-4000-8000-000000000002','e1-inactive@example.invalid','E1 Inactive','Member','e100c000-0000-4000-8000-000000000001',false),
('e1000000-0000-4000-8000-000000000003','e1-unconfirmed@example.invalid','E1 Unconfirmed','Member','e100c000-0000-4000-8000-000000000001',true),
('e1000000-0000-4000-8000-000000000004','e1-profile-mismatch@example.invalid','E1 Mismatch','Member','e100c000-0000-4000-8000-000000000001',true);
select set_config('ceit_connect.officer_writer','',true);
insert into public.events(id,name,start_date,end_date,status,created_by) values
('e100e000-0000-4000-8000-000000000001','E1 Event',current_date,current_date+1,'Active','e1000000-0000-4000-8000-000000000001');
insert into public.tasks(
 id,event_id,committee_id,title,description,phase,status,priority,task_type,
 due_date,call_time,end_time,primary_assignees,assist_assignees,is_confidential,
 request_backup,allowed_viewers,created_by,sort_order,created_at
) values
('e100a000-0000-4000-8000-000000000001','e100e000-0000-4000-8000-000000000001','e100c000-0000-4000-8000-000000000001','Visible E1 task','E1 visible fixture','E1','To Do','Medium','Deliverable',null,null,null,'{}'::uuid[],'{}'::uuid[],false,false,'{}'::uuid[],'e1000000-0000-4000-8000-000000000001',1024,statement_timestamp()),
('e100a000-0000-4000-8000-000000000002','e100e000-0000-4000-8000-000000000001','e100c000-0000-4000-8000-000000000001','Secret E1 task','E1 confidential fixture','E1','To Do','High','Deliverable',null,null,null,'{}'::uuid[],'{}'::uuid[],true,false,'{}'::uuid[],'e1000000-0000-4000-8000-000000000001',2048,statement_timestamp());

delete from ceit_connect_private.email_sender_credentials;
insert into ceit_connect_private.email_sender_credentials(slot,generation,salt,secret_hash)
values('current',1,decode(repeat('11',32),'hex'),extensions.digest(
 decode(repeat('11',32),'hex')||convert_to('e1-test-capability','UTF8'),'sha256'));
select set_config('request.headers','{"x-ceit-email-capability":"e1-test-capability"}',true);
update ceit_connect_private.email_delivery_config set daily_allowance=70 where singleton;

insert into public.notifications(id,user_id,type,task_id,created_at) values
('e1010000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','task_due_soon','e100a000-0000-4000-8000-000000000001',clock_timestamp()),
('e1010000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','assignment','e100a000-0000-4000-8000-000000000002',clock_timestamp()),
('e1010000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','live_operation_prep','e100a000-0000-4000-8000-000000000001',clock_timestamp()),
('e1010000-0000-4000-8000-000000000004','e1000000-0000-4000-8000-000000000001','mention','e100a000-0000-4000-8000-000000000001',clock_timestamp());
select public.e1_record('01 only three important types enqueue',(select count(*)=3 from ceit_connect_private.email_delivery_queue where notification_id::text like 'e101%'));
select public.e1_record('02 one queue row per notification',not exists(select notification_id from ceit_connect_private.email_delivery_queue group by notification_id having count(*)>1));

do $$ begin
 perform set_config('request.headers','{}',true);
 begin perform public.claim_email_deliveries(1);perform public.e1_record('03 missing capability denied',false);
 exception when sqlstate '42501' then perform public.e1_record('03 missing capability denied',true);end;
 perform set_config('request.headers','{"x-ceit-email-capability":"wrong"}',true);
 begin perform public.claim_email_deliveries(1);perform public.e1_record('04 wrong capability denied',false);
 exception when sqlstate '42501' then perform public.e1_record('04 wrong capability denied',true);end;
 perform set_config('request.headers','{"x-ceit-email-capability":"e1-test-capability"}',true);
end $$;
insert into public.e1_claimed(delivery_id,lease_token,run_id,run_token,
 notification_type,task_title,target_path,is_confidential,attempt)
select claim_row.out_delivery_id,claim_row.out_lease_token,claim_row.out_run_id,
 claim_row.out_run_token,claim_row.out_notification_type,prepared.out_task_title,
 prepared.out_target_path,prepared.out_is_confidential,claim_row.out_attempt
from public.claim_email_deliveries(10) as claim_row
cross join lateral public.prepare_email_delivery(
 claim_row.out_delivery_id,claim_row.out_lease_token
) as prepared;
select public.e1_record('05 assignment claims first',(select notification_type='assignment' from public.e1_claimed order by seq limit 1));
do $$ declare v_generic boolean;begin
 select exists(select 1 from public.e1_claimed where is_confidential and task_title is null and target_path='/workspace') into v_generic;
 delete from public.notifications where id='e1010000-0000-4000-8000-000000000002';
 perform set_config('ceit_connect.task_assignee_writer','assign_task_people',true);
 begin
  update public.tasks
  set assist_assignees=array['e1000000-0000-4000-8000-000000000001'::uuid]
  where id='e100a000-0000-4000-8000-000000000002';
  perform public.e1_record('06 confidential payload and send guard',false);
 exception when sqlstate '55000' then
  perform public.e1_record('06 confidential payload and send guard',v_generic);
 end;
 perform set_config('ceit_connect.task_assignee_writer','',true);
end $$;
select public.e1_record('07 visible payload has title and direct path',exists(select 1 from public.e1_claimed where not is_confidential and task_title='Visible E1 task' and target_path='/tasks/e100a000-0000-4000-8000-000000000001'));
select public.e1_record('08 success acknowledgement',public.acknowledge_email_delivery((select delivery_id from public.e1_claimed where notification_type='assignment'),(select lease_token from public.e1_claimed where notification_type='assignment'),'success',200));
select public.e1_record('09 transient acknowledgement',public.acknowledge_email_delivery((select delivery_id from public.e1_claimed where notification_type='task_due_soon'),(select lease_token from public.e1_claimed where notification_type='task_due_soon'),'transient',429));
select public.e1_record('10 permanent acknowledgement',public.acknowledge_email_delivery((select delivery_id from public.e1_claimed where notification_type='live_operation_prep'),(select lease_token from public.e1_claimed where notification_type='live_operation_prep'),'permanent',400));
do $$ begin
 begin perform public.acknowledge_email_delivery(gen_random_uuid(),gen_random_uuid(),null,200);
  perform public.e1_record('11 null acknowledgement outcome rejected',false);
 exception when sqlstate '22023' then perform public.e1_record('11 null acknowledgement outcome rejected',true);end;
end $$;

select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.notifications(id,user_id,type,task_id) values('e1020000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','assignment','e100a000-0000-4000-8000-000000000001');
select public.set_important_email_updates_enabled(false);
insert into public.notifications(id,user_id,type,task_id) values('e1020000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','assignment','e100a000-0000-4000-8000-000000000001');
select public.set_important_email_updates_enabled(true);
select public.e1_record('12 disable suppresses pending',exists(select 1 from ceit_connect_private.email_delivery_queue where notification_id='e1020000-0000-4000-8000-000000000001' and state='suppressed'));
select public.e1_record('13 re-enable does not backfill',not exists(select 1 from ceit_connect_private.email_delivery_queue where notification_id='e1020000-0000-4000-8000-000000000002'));

insert into public.notifications(id,user_id,type,task_id) select
 ('e1030000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'e1000000-0000-4000-8000-000000000001','task_due_soon','e100a000-0000-4000-8000-000000000001' from generate_series(1,12) s(i);
truncate public.e1_claimed restart identity;
insert into public.e1_claimed(delivery_id,lease_token,run_id,run_token,notification_type,attempt)
select out_delivery_id,out_lease_token,out_run_id,out_run_token,out_notification_type,out_attempt
from public.claim_email_deliveries(10);
select public.e1_record('14 per-run cap is ten',(select count(*)=10 from public.e1_claimed));

insert into public.notifications(id,user_id,type,task_id) values
('e1040000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','assignment','e100a000-0000-4000-8000-000000000001'),
('e1040000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000003','assignment','e100a000-0000-4000-8000-000000000001'),
('e1040000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000004','assignment','e100a000-0000-4000-8000-000000000001');
insert into ceit_connect_private.email_delivery_queue(notification_id,task_id,user_id,notification_type,priority,stale_at)
select id,task_id,user_id,type,0,created_at+interval '24 hours' from public.notifications where id::text like 'e104%';
select count(*) from public.claim_email_deliveries(10);
select public.e1_record('15 invalid recipients are not claimed',not exists(select 1 from ceit_connect_private.email_delivery_queue where notification_id::text like 'e104%' and state='leased'));

insert into public.notifications(id,user_id,type,task_id,created_at) values('e1050000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','assignment','e100a000-0000-4000-8000-000000000001',clock_timestamp()-interval '24 hours');
select count(*) from public.claim_email_deliveries(1);
select public.e1_record('16 twenty-four-hour boundary is stale',exists(select 1 from ceit_connect_private.email_delivery_queue where notification_id='e1050000-0000-4000-8000-000000000001' and state='stale'));

insert into public.notifications(id,user_id,type,task_id) values('e1060000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','assignment','e100a000-0000-4000-8000-000000000001');
update ceit_connect_private.email_delivery_queue set attempt_count=4 where notification_id='e1060000-0000-4000-8000-000000000001';
truncate public.e1_claimed restart identity;
insert into public.e1_claimed(delivery_id,lease_token,run_id,run_token,notification_type,attempt)
select out_delivery_id,out_lease_token,out_run_id,out_run_token,out_notification_type,out_attempt
from public.claim_email_deliveries(1);
select public.acknowledge_email_delivery((select delivery_id from public.e1_claimed),(select lease_token from public.e1_claimed),'transient',503);
select public.e1_record('17 fifth attempt is terminal',exists(select 1 from ceit_connect_private.email_delivery_queue where notification_id='e1060000-0000-4000-8000-000000000001' and state='terminal' and terminal_reason='attempts_exhausted'));

update ceit_connect_private.email_delivery_config set daily_allowance=(select count(*) from ceit_connect_private.email_send_attempts) where singleton;
select public.e1_record('18 daily allowance stops claims',not exists(select 1 from public.claim_email_deliveries(10)));
select count(*) from public.claim_email_deliveries(10);
select public.e1_record('19 allowance reached is hourly bounded',(select count(*)=1 from ceit_connect_private.email_delivery_runs where allowance_reached_count=1 and started_at>=date_trunc('hour',clock_timestamp())));
select public.e1_record('20 kick false when allowance spent',ceit_connect_private.request_email_kick_if_due() is false);
delete from ceit_connect_private.email_send_attempts;
update ceit_connect_private.email_delivery_queue
set state='suppressed',terminal_at=clock_timestamp(),terminal_reason='stale',
    lease_token=null,lease_expires_at=null,send_guard_until=null
where state in('pending','leased');
select public.e1_record('21 kick false when nothing due',ceit_connect_private.request_email_kick_if_due() is false);

do $$ declare v_total integer;v_failed integer;v_labels text;begin
 select count(*)::integer,count(*) filter(where passed is false)::integer,
 string_agg(label,', ' order by label) filter(where passed is false)
 into v_total,v_failed,v_labels from public.e1_behavior_results;
 if v_total<>21 or v_failed<>0 then raise exception
 'TEST RESULTS %/21 FAIL — % failed: %; transaction intentionally rolled back',
 v_total-v_failed,v_failed,coalesce(v_labels,'count mismatch');end if;
 raise exception 'TEST RESULTS 21/21 PASS — transaction intentionally rolled back';
end $$;
rollback;
```
