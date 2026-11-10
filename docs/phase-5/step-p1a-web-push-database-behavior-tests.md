# P1a Paste B: web-push behavior and deletion races

Run this self-contained paste in the **Dev SQL Editor** only, with **Run
without RLS** enabled (postgres), after Paste A passes. It records exactly
**61** assertions and intentionally rolls back. It queues only an invalid test
URL through `pg_net`; the rollback removes that request before delivery. Do not
run it on Prod.

Expected sentinel:

`TEST RESULTS 61/61 PASS — transaction intentionally rolled back`

```sql
begin;
set local timezone='Asia/Manila';
set local statement_timeout='120s';

create table p1a_behavior_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);
create function pg_temp.p1a_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  insert into public.p1a_behavior_results(label,passed) values(p_label,coalesce(p_passed,false));
end $$;
create function pg_temp.p1a_expect_sqlstate(p_label text,p_sqlstate text,p_sql text)
returns void language plpgsql security definer set search_path=''
as $$ begin
  begin execute p_sql;
  exception when others then
    perform pg_temp.p1a_record(p_label,sqlstate=p_sqlstate); return;
  end;
  perform pg_temp.p1a_record(p_label,false);
end $$;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select fixture.id,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated',fixture.email,'',now(),'{}','{}',now(),now()
from (values
  ('54b00000-0000-4000-8000-000000000001'::uuid,'p1a-owner@test.local'),
  ('54b00000-0000-4000-8000-000000000002'::uuid,'p1a-shared@test.local'),
  ('54b00000-0000-4000-8000-000000000003'::uuid,'p1a-inactive@test.local')
) fixture(id,email);
insert into public.committees(id,name)
values('54b0c000-0000-4000-8000-000000000001','P1a Behavior Committee');
select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('54b00000-0000-4000-8000-000000000001','p1a-owner@test.local','P1a Owner','Member','54b0c000-0000-4000-8000-000000000001',true),
('54b00000-0000-4000-8000-000000000002','p1a-shared@test.local','P1a Shared','Member','54b0c000-0000-4000-8000-000000000001',true),
('54b00000-0000-4000-8000-000000000003','p1a-inactive@test.local','P1a Inactive','Member','54b0c000-0000-4000-8000-000000000001',true);
select set_config('ceit_connect.officer_writer','',true);

select public.configure_push_sender_credential_hash(
  'current',1,repeat('11',32),
  encode(extensions.digest(decode(repeat('11',32),'hex')||convert_to('p1a-current-secret','UTF8'),'sha256'),'hex')
);
select vault.create_secret('https://example.invalid/p1a-wake','p1a_test_kick_url','P1a rollback-only URL');
select vault.create_secret('p1a-test-wake-secret','p1a_test_wake_secret','P1a rollback-only wake secret');
update ceit_connect_private.push_environment_config
set kick_url_secret_name='p1a_test_kick_url',wake_secret_name='p1a_test_wake_secret'
where singleton;
select set_config('request.headers','{"x-ceit-push-capability":"p1a-current-secret"}',true);

select set_config('request.jwt.claims',
  '{"sub":"54b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_subscription(
  'https://fcm.googleapis.com/p1a/allowed','A'||repeat('a',86),repeat('b',22),'FCM','android',null
);
select public.register_push_subscription(
  'https://updates.push.services.mozilla.com/p1a/allowed',repeat('C',87),repeat('d',22),'Mozilla','desktop',null
);
select public.register_push_subscription(
  'https://web.push.apple.com/p1a/allowed',repeat('E',87),repeat('f',22),'Apple','ios',null
);
select public.register_push_subscription(
  'https://one.two.notify.windows.com/p1a/allowed',repeat('G',87),repeat('h',22),'Windows','desktop',null
);
select pg_temp.p1a_record('allowed push-service hosts are accepted',
  4=(select count(*) from public.list_my_push_subscriptions()));
select public.remove_all_my_push_subscriptions();
select pg_temp.p1a_expect_sqlstate('evil host is rejected','22023',
  $$select public.register_push_subscription('https://evil.example/push',repeat('A',87),repeat('b',22),'Evil','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('allowed-host lookalike is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com.evil.example/push',repeat('A',87),repeat('b',22),'Lookalike','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('userinfo endpoint is rejected','22023',
  $$select public.register_push_subscription('https://user@fcm.googleapis.com/push',repeat('A',87),repeat('b',22),'Userinfo','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('explicit endpoint port is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com:443/push',repeat('A',87),repeat('b',22),'Port','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('endpoint fragment is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com/push#fragment',repeat('A',87),repeat('b',22),'Fragment','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('http endpoint is rejected','22023',
  $$select public.register_push_subscription('http://fcm.googleapis.com/push',repeat('A',87),repeat('b',22),'HTTP','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('p256dh non-base64url text is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com/push/bad-p256dh-text',repeat('A',86)||'+',repeat('b',22),'Bad key','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('p256dh unsafe length is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com/push/bad-p256dh-length','short',repeat('b',22),'Short key','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('auth non-base64url text is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com/push/bad-auth-text',repeat('A',87),repeat('b',21)||'+','Bad auth','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('auth unsafe length is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com/push/bad-auth-length',repeat('A',87),'short','Short auth','desktop',null)$$);
select pg_temp.p1a_expect_sqlstate('null platform is rejected','22023',
  $$select public.register_push_subscription('https://fcm.googleapis.com/push/null-platform',repeat('A',87),repeat('b',22),'Null platform',null,null)$$);
select set_config('p1a.shared_subscription',public.register_push_subscription(
  'https://web.push.apple.com/p1a/shared',repeat('S',87),repeat('s',22),'Shared phone','ios',null
)::text,true);
select pg_temp.p1a_record('01 active person registers a subscription',
  current_setting('p1a.shared_subscription')::uuid is not null);
select pg_temp.p1a_record('02 owner lists only safe own metadata',
  1=(select count(*) from public.list_my_push_subscriptions()));
select pg_temp.p1a_record('03 owner RLS sees own safe row',
  1=(select count(*) from public.push_subscriptions));
reset role;

insert into public.notifications(id,user_id,type,task_id)
values('54b10000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000001','assignment',null);
select pg_temp.p1a_record('04 notification enqueue creates one delivery',
  1=(select count(*) from ceit_connect_private.push_delivery_queue
     where notification_id='54b10000-0000-4000-8000-000000000001'));

select set_config('request.jwt.claims',
  '{"sub":"54b00000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select set_config('p1a.transferred_subscription',public.register_push_subscription(
  'https://web.push.apple.com/p1a/shared',repeat('T',87),repeat('t',22),'Shared phone','ios',null
)::text,true);
select pg_temp.p1a_record('05 shared-device transfer preserves subscription id',
  current_setting('p1a.transferred_subscription')=current_setting('p1a.shared_subscription'));
reset role;
select pg_temp.p1a_record('06 transfer changes ownership atomically',exists(
  select 1 from public.push_subscriptions where id=current_setting('p1a.shared_subscription')::uuid
  and user_id='54b00000-0000-4000-8000-000000000002'));
select pg_temp.p1a_record('07 transfer removes old owners queued delivery',not exists(
  select 1 from ceit_connect_private.push_delivery_queue
  where subscription_id=current_setting('p1a.shared_subscription')::uuid));

set local role authenticated;
select pg_temp.p1a_record('08 new owner can remove transferred subscription',
  public.remove_my_push_subscription(current_setting('p1a.shared_subscription')::uuid));
reset role;

select set_config('request.jwt.claims',
  '{"sub":"54b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select public.register_push_subscription('https://fcm.googleapis.com/p1a/cap-1',repeat('A',87),repeat('a',22),'Cap 1','desktop',null);
select public.register_push_subscription('https://fcm.googleapis.com/p1a/cap-2',repeat('B',87),repeat('b',22),'Cap 2','desktop',null);
select public.register_push_subscription('https://fcm.googleapis.com/p1a/cap-3',repeat('C',87),repeat('c',22),'Cap 3','desktop',null);
select public.register_push_subscription('https://fcm.googleapis.com/p1a/cap-4',repeat('D',87),repeat('d',22),'Cap 4','desktop',null);
select public.register_push_subscription('https://fcm.googleapis.com/p1a/cap-5',repeat('E',87),repeat('e',22),'Cap 5','desktop',null);
select pg_temp.p1a_record('09 per-user device cap permits exactly five',
  5=(select count(*) from public.list_my_push_subscriptions()));
select pg_temp.p1a_expect_sqlstate('10 sixth device is rejected','P0001',
  $$select public.register_push_subscription('https://fcm.googleapis.com/p1a/cap-6',repeat('F',87),repeat('f',22),'Cap 6','desktop',null)$$);
select set_config('p1a.removed_device_count',public.remove_all_my_push_subscriptions()::text,true);
select pg_temp.p1a_record('11 remove-all clears signed-in persons devices',
  current_setting('p1a.removed_device_count')::integer=5
  and not exists(select 1 from public.list_my_push_subscriptions()));

select set_config('p1a.main_subscription',public.register_push_subscription(
  'https://fcm.googleapis.com/p1a/main',repeat('M',87),repeat('m',22),'Main phone','android',null
)::text,true);
reset role;

update ceit_connect_private.push_kick_state
set last_requested_at=null,request_count=0,last_request_id=null,last_error_at=null,error_count=0
where singleton;
insert into public.notifications(id,user_id,type,task_id) values
('54b20000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000001','mention',null),
('54b20000-0000-4000-8000-000000000002','54b00000-0000-4000-8000-000000000001','heads_up',null),
('54b20000-0000-4000-8000-000000000003','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b20000-0000-4000-8000-000000000004','54b00000-0000-4000-8000-000000000001','status_change',null),
('54b20000-0000-4000-8000-000000000005','54b00000-0000-4000-8000-000000000001','unlock',null),
('54b20000-0000-4000-8000-000000000006','54b00000-0000-4000-8000-000000000001','backup_request',null);
select pg_temp.p1a_record('12 six-row burst preserves every notification',
  6=(select count(*) from public.notifications where id::text like '54b2%'));
select pg_temp.p1a_record('13 six-row burst creates every queue row',
  6=(select count(*) from ceit_connect_private.push_delivery_queue where notification_id::text like '54b2%'));
select pg_temp.p1a_record('14 ten-second coalescer creates exactly one kick',
  1=(select request_count from ceit_connect_private.push_kick_state where singleton));

create table p1a_first_claim as
select * from public.claim_push_deliveries(6) with no data;
grant select,insert on table p1a_first_claim to anon;
set local role anon;
insert into p1a_first_claim select * from public.claim_push_deliveries(6);
select pg_temp.p1a_record('anon role claims with the correct capability header',
  6=(select count(*) from public.p1a_first_claim));
do $$ begin
  begin
    perform public.register_push_subscription(
      'https://fcm.googleapis.com/p1a/anon-denied',repeat('A',87),repeat('b',22),
      'Anon denied','desktop',null
    );
  exception when insufficient_privilege then
    perform pg_temp.p1a_record('anon role cannot register a subscription',true);
    return;
  end;
  perform pg_temp.p1a_record('anon role cannot register a subscription',false);
end $$;
reset role;
select pg_temp.p1a_record('15 claim leases all six rows',6=(select count(*) from p1a_first_claim));
select pg_temp.p1a_record('16 claim lease is approximately two minutes',not exists(
  select 1 from p1a_first_claim where out_lease_expires_at not between clock_timestamp()+interval '110 seconds'
  and clock_timestamp()+interval '130 seconds'));
select pg_temp.p1a_record('17 title and target are fixed generic values',not exists(
  select 1 from p1a_first_claim where out_title<>'CEIT Connect' or out_target_path<>'/notifications'));
select pg_temp.p1a_record('18 mention copy exact',exists(
  select 1 from p1a_first_claim where out_notification_type='mention' and out_body='You were mentioned in a task.'));
select pg_temp.p1a_record('19 heads-up copy exact',exists(
  select 1 from p1a_first_claim where out_notification_type='heads_up' and out_body='A task you’re assigned to has a new heads-up.'));
select pg_temp.p1a_record('20 assignment copy exact',exists(
  select 1 from p1a_first_claim where out_notification_type='assignment' and out_body='You were assigned to a task.'));
select pg_temp.p1a_record('21 status copy exact',exists(
  select 1 from p1a_first_claim where out_notification_type='status_change' and out_body='A task you’re assigned to changed status.'));
select pg_temp.p1a_record('22 unlock copy exact',exists(
  select 1 from p1a_first_claim where out_notification_type='unlock' and out_body='A task you’re assigned to is now unlocked.'));
select pg_temp.p1a_record('23 backup copy exact',exists(
  select 1 from p1a_first_claim where out_notification_type='backup_request' and out_body='A task needs backup help.'));
select pg_temp.p1a_record('24 first claim records attempt one',not exists(
  select 1 from p1a_first_claim where out_attempt<>1));

select pg_temp.p1a_record('25 success acknowledgement is accepted',public.acknowledge_push_delivery(
  (select out_delivery_id from p1a_first_claim where out_notification_type='mention'),
  (select out_lease_token from p1a_first_claim where out_notification_type='mention'),'success',201));
select set_config('p1a.transient_ack',public.acknowledge_push_delivery(
  (select out_delivery_id from p1a_first_claim where out_notification_type='heads_up'),
  (select out_lease_token from p1a_first_claim where out_notification_type='heads_up'),'transient',503)::text,true);
select pg_temp.p1a_record('26 only transient failure is rescheduled',
  current_setting('p1a.transient_ack')::boolean
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where id=(select out_delivery_id from p1a_first_claim where out_notification_type='heads_up')
    and state='pending' and next_attempt_at>clock_timestamp()));
select set_config('p1a.permanent_ack',public.acknowledge_push_delivery(
  (select out_delivery_id from p1a_first_claim where out_notification_type='assignment'),
  (select out_lease_token from p1a_first_claim where out_notification_type='assignment'),'permanent',400)::text,true);
select pg_temp.p1a_record('27 permanent 4xx becomes terminal',
  current_setting('p1a.permanent_ack')::boolean
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where id=(select out_delivery_id from p1a_first_claim where out_notification_type='assignment')
    and state='terminal' and terminal_reason='permanent_failure'));
select set_config('p1a.gone_ack',public.acknowledge_push_delivery(
  (select out_delivery_id from p1a_first_claim where out_notification_type='status_change'),
  (select out_lease_token from p1a_first_claim where out_notification_type='status_change'),'gone',410)::text,true);
select pg_temp.p1a_record('28 410 acknowledgement removes expired subscription',
  current_setting('p1a.gone_ack')::boolean
  and not exists(select 1 from public.push_subscriptions where id=current_setting('p1a.main_subscription')::uuid));
select set_config('p1a.finish_run',public.finish_push_delivery_run(
  (select out_run_id from p1a_first_claim limit 1),(select out_run_token from p1a_first_claim limit 1))::text,true);
select pg_temp.p1a_record('29 finish writes counts-only run outcome',
  current_setting('p1a.finish_run')::boolean
  and exists(select 1 from ceit_connect_private.push_delivery_runs
    where id=(select out_run_id from p1a_first_claim limit 1)
    and claimed_count=6 and delivered_count=1 and retry_scheduled_count=1
    and terminal_count=1 and expired_subscription_count=1 and unacknowledged_count=2));

select set_config('request.jwt.claims',
  '{"sub":"54b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('p1a.delete_subscription',public.register_push_subscription(
  'https://updates.push.services.mozilla.com/p1a/delete-race',repeat('R',87),repeat('r',22),'Delete race','desktop',null
)::text,true);
reset role;
insert into public.notifications(id,user_id,type,task_id)
values('54b30000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000001','mention',null);
create table p1a_delete_claim as select * from public.claim_push_deliveries(1);
delete from public.notifications where id='54b30000-0000-4000-8000-000000000001';
select pg_temp.p1a_record('30 deleting a leased notification cascades its delivery',not exists(
  select 1 from ceit_connect_private.push_delivery_queue
  where id=(select out_delivery_id from p1a_delete_claim)));
select pg_temp.p1a_record('31 missing-delivery acknowledgement is quiet false',not public.acknowledge_push_delivery(
  (select out_delivery_id from p1a_delete_claim),(select out_lease_token from p1a_delete_claim),'transient',503));
select pg_temp.p1a_record('32 missing delivery creates no retry or error row',not exists(
  select 1 from ceit_connect_private.push_delivery_queue
  where notification_id='54b30000-0000-4000-8000-000000000001'));

select set_config('request.headers','{"x-ceit-push-capability":"wrong-secret"}',true);
select pg_temp.p1a_expect_sqlstate('wrong secret cannot claim','42501',
  'select public.claim_push_deliveries(1)');
select pg_temp.p1a_expect_sqlstate('wrong secret cannot acknowledge','42501',
  $$select public.acknowledge_push_delivery(
    '54bfffff-0000-4000-8000-000000000001',
    '54bfffff-0000-4000-8000-000000000002','success',201
  )$$);
select set_config('request.headers','{"x-ceit-push-capability":"p1a-current-secret"}',true);
select pg_temp.p1a_record('34 valid capability still works after generic denials',
  0=(select count(*) from public.claim_push_deliveries(1)));

select public.configure_push_sender_credential_hash(
  'next',2,repeat('22',32),
  encode(extensions.digest(decode(repeat('22',32),'hex')||convert_to('p1a-next-secret','UTF8'),'sha256'),'hex')
);
select set_config('request.headers','{"x-ceit-push-capability":"p1a-next-secret"}',true);
select pg_temp.p1a_record('35 next rotation slot authenticates before cutover',
  0=(select count(*) from public.claim_push_deliveries(1)));
select public.retire_push_sender_credential('current');
select set_config('request.headers','{"x-ceit-push-capability":"p1a-current-secret"}',true);
select pg_temp.p1a_expect_sqlstate('36 retired capability stops immediately','42501',
  'select public.claim_push_deliveries(1)');
select set_config('request.headers','{"x-ceit-push-capability":"p1a-next-secret"}',true);
select pg_temp.p1a_record('37 next capability survives old-slot retirement',
  0=(select count(*) from public.claim_push_deliveries(1)));

select set_config('request.jwt.claims',
  '{"sub":"54b00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select set_config('p1a.inactive_subscription',public.register_push_subscription(
  'https://fcm.googleapis.com/p1a/inactive',repeat('I',87),repeat('i',22),'Inactive phone','android',null
)::text,true);
reset role;
insert into public.notifications(id,user_id,type,task_id)
values('54b40000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000003','assignment',null);
update public.users set is_active=false where id='54b00000-0000-4000-8000-000000000003';
select pg_temp.p1a_record('38 deactivation removes every device subscription',not exists(
  select 1 from public.push_subscriptions where user_id='54b00000-0000-4000-8000-000000000003'));
select pg_temp.p1a_record('39 deactivation removes queued delivery before claim',not exists(
  select 1 from ceit_connect_private.push_delivery_queue where user_id='54b00000-0000-4000-8000-000000000003'));

update ceit_connect_private.push_kick_state
set last_requested_at=clock_timestamp()-interval '11 seconds',request_count=0,last_request_id=null
where singleton;
insert into public.notifications(id,user_id,type,task_id)
values('54b50000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000001','assignment',null);
update ceit_connect_private.push_kick_state
set last_requested_at=clock_timestamp()-interval '11 seconds',request_count=0,last_request_id=null
where singleton;
select set_config('p1a.if_due_requested',ceit_connect_private.request_push_kick_if_due()::text,true);
select pg_temp.p1a_record('if-due requests one kick when pending work is due',
  current_setting('p1a.if_due_requested')::boolean
  and 1=(select request_count from ceit_connect_private.push_kick_state where singleton));
delete from public.notifications where id='54b50000-0000-4000-8000-000000000001';
insert into public.notifications(id,user_id,type,task_id) values
('54b50000-0000-4000-8000-000000000002','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b50000-0000-4000-8000-000000000003','54b00000-0000-4000-8000-000000000001','assignment',null);
update ceit_connect_private.push_delivery_queue
set next_attempt_at=clock_timestamp()-interval '1 second',
    retry_deadline_at=clock_timestamp()-interval '1 second',
    attempt_count=7
where notification_id='54b50000-0000-4000-8000-000000000002';
update ceit_connect_private.push_delivery_queue
set next_attempt_at=clock_timestamp()-interval '1 second',
    retry_deadline_at=clock_timestamp()+interval '1 hour',
    attempt_count=8
where notification_id='54b50000-0000-4000-8000-000000000003';
update ceit_connect_private.push_kick_state
set last_requested_at=clock_timestamp()-interval '11 seconds',request_count=0,last_request_id=null
where singleton;
select pg_temp.p1a_record('if-due does nothing when no work is due',
  exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b50000-0000-4000-8000-000000000002'
    and state='pending' and next_attempt_at<=clock_timestamp()
    and retry_deadline_at<=clock_timestamp() and attempt_count<8)
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b50000-0000-4000-8000-000000000003'
    and state='pending' and next_attempt_at<=clock_timestamp()
    and retry_deadline_at>clock_timestamp() and attempt_count=8)
  and not ceit_connect_private.request_push_kick_if_due()
  and 0=(select request_count from ceit_connect_private.push_kick_state where singleton));

insert into public.notifications(id,user_id,type,task_id) values
('54b60000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b60000-0000-4000-8000-000000000002','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b60000-0000-4000-8000-000000000003','54b00000-0000-4000-8000-000000000001','assignment',null);
update ceit_connect_private.push_delivery_queue
set state='leased',attempt_count=2,
    retry_deadline_at=clock_timestamp()+interval '30 minutes',
    lease_token='54b6a000-0000-4000-8000-000000000001',
    lease_expires_at=clock_timestamp()-interval '1 minute',
    run_id='54b6b000-0000-4000-8000-000000000001'
where notification_id='54b60000-0000-4000-8000-000000000001';
update ceit_connect_private.push_delivery_queue
set state='leased',attempt_count=2,
    retry_deadline_at=clock_timestamp()-interval '1 minute',
    lease_token='54b6a000-0000-4000-8000-000000000002',
    lease_expires_at=clock_timestamp()-interval '1 minute',
    run_id='54b6b000-0000-4000-8000-000000000002'
where notification_id='54b60000-0000-4000-8000-000000000002';
update ceit_connect_private.push_delivery_queue
set state='leased',attempt_count=8,
    retry_deadline_at=clock_timestamp()+interval '30 minutes',
    lease_token='54b6a000-0000-4000-8000-000000000003',
    lease_expires_at=clock_timestamp()-interval '1 minute',
    run_id='54b6b000-0000-4000-8000-000000000003'
where notification_id='54b60000-0000-4000-8000-000000000003';
create table p1a_expired_lease_claim as select * from public.claim_push_deliveries(1);
select pg_temp.p1a_record('expired leases reclaim eligible work and terminalize exhausted work',
  exists(select 1 from p1a_expired_lease_claim as claimed
    join ceit_connect_private.push_delivery_queue as queue on queue.id=claimed.out_delivery_id
    where queue.notification_id='54b60000-0000-4000-8000-000000000001'
    and queue.state='leased' and queue.attempt_count=3
    and queue.lease_token is not null and queue.lease_expires_at>clock_timestamp()
    and queue.run_id=claimed.out_run_id)
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b60000-0000-4000-8000-000000000002'
    and state='terminal' and terminal_reason='retry_window_exhausted'
    and terminal_at is not null and delivered_at is null
    and lease_token is null and lease_expires_at is null)
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b60000-0000-4000-8000-000000000003'
    and state='terminal' and terminal_reason='attempts_exhausted'
    and terminal_at is not null and delivered_at is null
    and lease_token is null and lease_expires_at is null));

insert into public.notifications(id,user_id,type,task_id) values
('54b70000-0000-4000-8000-000000000001','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b70000-0000-4000-8000-000000000002','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b70000-0000-4000-8000-000000000003','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b70000-0000-4000-8000-000000000004','54b00000-0000-4000-8000-000000000001','assignment',null),
('54b70000-0000-4000-8000-000000000005','54b00000-0000-4000-8000-000000000001','assignment',null);
update ceit_connect_private.push_delivery_queue
set retry_deadline_at=clock_timestamp()-interval '1 minute'
where notification_id='54b70000-0000-4000-8000-000000000001';
update ceit_connect_private.push_delivery_queue
set state='delivered',delivered_at=clock_timestamp()-interval '4 days'
where notification_id='54b70000-0000-4000-8000-000000000002';
update ceit_connect_private.push_delivery_queue
set state='delivered',delivered_at=clock_timestamp()-interval '2 days'
where notification_id='54b70000-0000-4000-8000-000000000003';
update ceit_connect_private.push_delivery_queue
set state='terminal',terminal_at=clock_timestamp()-interval '8 days',
    terminal_reason='permanent_failure'
where notification_id='54b70000-0000-4000-8000-000000000004';
update ceit_connect_private.push_delivery_queue
set state='terminal',terminal_at=clock_timestamp()-interval '6 days',
    terminal_reason='permanent_failure'
where notification_id='54b70000-0000-4000-8000-000000000005';
insert into ceit_connect_private.push_delivery_runs(id,run_token,started_at,finished_at) values
('54b80000-0000-4000-8000-000000000001','54b8a000-0000-4000-8000-000000000001',clock_timestamp(),clock_timestamp()),
('54b80000-0000-4000-8000-000000000002','54b8a000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp());
update ceit_connect_private.push_delivery_runs
set finished_at=clock_timestamp()-interval '31 days'
where id='54b80000-0000-4000-8000-000000000001';
update ceit_connect_private.push_delivery_runs
set finished_at=clock_timestamp()-interval '29 days'
where id='54b80000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims',
  '{"sub":"54b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('p1a.expired_subscription',public.register_push_subscription(
  'https://web.push.apple.com/p1a/expired',repeat('X',87),repeat('x',22),'Expired phone','ios',null
)::text,true);
reset role;
update public.push_subscriptions
set expires_at=clock_timestamp()-interval '1 minute'
where id=current_setting('p1a.expired_subscription')::uuid;
select * from public.run_push_delivery_cleanup();
select pg_temp.p1a_record('cleanup removes an expired subscription by id',
  not exists(select 1 from public.push_subscriptions
    where id=current_setting('p1a.expired_subscription')::uuid));
select pg_temp.p1a_record('cleanup terminalizes a pending row past its retry deadline',
  exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b70000-0000-4000-8000-000000000001'
    and state='terminal' and terminal_reason='retry_window_exhausted'
    and terminal_at is not null and delivered_at is null));
select pg_temp.p1a_record('cleanup applies delivered and terminal retention by id',
  not exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id in (
      '54b70000-0000-4000-8000-000000000002',
      '54b70000-0000-4000-8000-000000000004'
    ))
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b70000-0000-4000-8000-000000000003'
    and state='delivered' and delivered_at is not null)
  and exists(select 1 from ceit_connect_private.push_delivery_queue
    where notification_id='54b70000-0000-4000-8000-000000000005'
    and state='terminal' and terminal_at is not null));
select pg_temp.p1a_record('cleanup applies run retention by id',
  not exists(select 1 from ceit_connect_private.push_delivery_runs
    where id='54b80000-0000-4000-8000-000000000001')
  and exists(select 1 from ceit_connect_private.push_delivery_runs
    where id='54b80000-0000-4000-8000-000000000002'));

do $$
declare v_total integer; v_pass integer;
begin
  select count(*),count(*) filter(where passed) into v_total,v_pass
  from public.p1a_behavior_results;
  if v_total<>61 or v_pass<>61 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back',v_pass,v_total;
  end if;
  raise exception 'TEST RESULTS 61/61 PASS — transaction intentionally rolled back';
end
$$;
```

