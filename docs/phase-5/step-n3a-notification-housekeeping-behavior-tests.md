# N3a Paste B: notification housekeeping behavior

Run this one self-contained paste in the **Dev SQL Editor** only, with
**Run without RLS** enabled (postgres), after N3a Paste A passes. It owns all
Auth/profile/notification fixtures, impersonates active and inactive users,
records exactly **32** result rows, and intentionally aborts the transaction.
The SQL block is **212 lines**. Do not run it on Prod.

Expected sentinel:

`TEST RESULTS 32/32 PASS — transaction intentionally rolled back`

```sql
begin;
set local timezone='Asia/Manila';
set local statement_timeout='120s';

-- Isolate the bounded-runner assertions from pre-existing Dev backlog. This
-- delete is inside the transaction and is restored by the final exception.
delete from public.notifications as notification_row
where notification_row.read_at is not null
  and notification_row.read_at < pg_catalog.now()-interval '60 days';

create table n3a_behavior_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);

create function pg_temp.n3a_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  insert into public.n3a_behavior_results(label,passed) values(p_label,p_passed);
end $$;

create function pg_temp.n3a_expect_sqlstate(
  p_label text,p_sql text,p_sqlstate text
)
returns void language plpgsql security invoker set search_path=''
as $$
begin
  begin
    execute p_sql;
  exception when others then
    perform pg_temp.n3a_record(p_label,sqlstate=p_sqlstate);
    return;
  end;
  perform pg_temp.n3a_record(p_label,false);
end
$$;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select fixture.id,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated',fixture.email,'',now(),'{}','{}',now(),now()
from (values
  ('53b00000-0000-4000-8000-000000000001'::uuid,'n3a-owner@test.local'),
  ('53b00000-0000-4000-8000-000000000002'::uuid,'n3a-other@test.local'),
  ('53b00000-0000-4000-8000-000000000003'::uuid,'n3a-inactive@test.local')
) fixture(id,email);

insert into public.committees(id,name)
values('53b0c000-0000-4000-8000-000000000001','N3a Behavior Committee');
select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('53b00000-0000-4000-8000-000000000001','n3a-owner@test.local','N3a Owner','Member','53b0c000-0000-4000-8000-000000000001',true),
('53b00000-0000-4000-8000-000000000002','n3a-other@test.local','N3a Other','Member','53b0c000-0000-4000-8000-000000000001',true),
('53b00000-0000-4000-8000-000000000003','n3a-inactive@test.local','N3a Inactive','Member','53b0c000-0000-4000-8000-000000000001',true);
select set_config('ceit_connect.officer_writer','',true);

insert into public.notifications(id,user_id,type,task_id,read_at,created_at) values
('53b10000-0000-4000-8000-000000000001','53b00000-0000-4000-8000-000000000001','assignment',null,now()-interval '2 days',now()-interval '3 days'),
('53b10000-0000-4000-8000-000000000002','53b00000-0000-4000-8000-000000000001','mention',null,now()-interval '1 day',now()-interval '2 days'),
('53b10000-0000-4000-8000-000000000003','53b00000-0000-4000-8000-000000000001','unlock',null,null,now()-interval '1 day'),
('53b10000-0000-4000-8000-000000000004','53b00000-0000-4000-8000-000000000002','assignment',null,now()-interval '1 day',now()-interval '2 days'),
('53b10000-0000-4000-8000-000000000005','53b00000-0000-4000-8000-000000000003','assignment',null,now()-interval '2 days',now()-interval '3 days');

select set_config('request.jwt.claims',
  '{"sub":"53b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.n3a_expect_sqlstate('01 browser raw DELETE remains denied',
  'delete from public.notifications where id=''53b10000-0000-4000-8000-000000000001''','42501');
select pg_temp.n3a_record('02 delete-one removes own row',
  public.delete_notification('53b10000-0000-4000-8000-000000000001'));
select pg_temp.n3a_record('03 deleted own row is gone',not exists(
  select 1 from public.notifications where id='53b10000-0000-4000-8000-000000000001'));
select pg_temp.n3a_record('04 repeat delete is idempotent false',
  public.delete_notification('53b10000-0000-4000-8000-000000000001') is false);
select pg_temp.n3a_record('05 foreign delete is idempotent false',
  public.delete_notification('53b10000-0000-4000-8000-000000000004') is false);
reset role;
select pg_temp.n3a_record('06 foreign row remains untouched',exists(
  select 1 from public.notifications where id='53b10000-0000-4000-8000-000000000004'));

select pg_temp.n3a_record('07 clear-read helper is ID-ordered and skip-locked',(
  select prosrc like '%order by notification_row.id%'
  and prosrc like '%for update of notification_row skip locked%'
  from pg_catalog.pg_proc
  where oid='ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure));
select pg_temp.n3a_record('08 clear-read deletes only selected victims',(
  select prosrc like '%with victims as materialized%'
  and prosrc like '%using victims%'
  and prosrc like '%notification_row.read_at is not null%'
  from pg_catalog.pg_proc
  where oid='ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure));
set local role authenticated;
select pg_temp.n3a_record('09 clear-read reports all unlocked caller read rows',
  public.clear_read_notifications()=1);
select pg_temp.n3a_record('10 clear-read removed caller read rows',not exists(
  select 1 from public.notifications where user_id='53b00000-0000-4000-8000-000000000001'
  and read_at is not null));
select pg_temp.n3a_record('11 clear-read preserves caller unread rows',exists(
  select 1 from public.notifications where id='53b10000-0000-4000-8000-000000000003'
  and read_at is null));
select pg_temp.n3a_record('12 repeated clear-read is idempotent zero',
  public.clear_read_notifications()=0);
reset role;
select pg_temp.n3a_record('13 clear-read leaves other users untouched',exists(
  select 1 from public.notifications where id='53b10000-0000-4000-8000-000000000004'));

update public.users as profile set is_active=false
where profile.id='53b00000-0000-4000-8000-000000000003';
select set_config('request.jwt.claims',
  '{"sub":"53b00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.n3a_expect_sqlstate('14 inactive delete-one is denied before mutation',
  'select public.delete_notification(''53b10000-0000-4000-8000-000000000005'')','42501');
select pg_temp.n3a_expect_sqlstate('15 inactive clear-read is denied before mutation',
  'select public.clear_read_notifications()','42501');
reset role;
select pg_temp.n3a_record('16 inactive denial leaves notification untouched',exists(
  select 1 from public.notifications where id='53b10000-0000-4000-8000-000000000005'));

select set_config('request.jwt.claims',
  '{"sub":"53b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.n3a_expect_sqlstate('17 authenticated cannot call cleanup runner',
  'select * from public.run_notification_cleanup()','42501');
reset role;
set local role service_role;
select pg_temp.n3a_expect_sqlstate('18 service role cannot call cleanup runner',
  'select * from public.run_notification_cleanup()','42501');
reset role;

delete from public.notifications
where user_id in (
  '53b00000-0000-4000-8000-000000000001',
  '53b00000-0000-4000-8000-000000000002',
  '53b00000-0000-4000-8000-000000000003'
);

insert into public.notifications(id,user_id,type,task_id,read_at,created_at)
select md5('n3a-old-read-'||series.i)::uuid,
  '53b00000-0000-4000-8000-000000000001','assignment',null,
  now()-interval '100 days'+pg_catalog.make_interval(secs=>series.i),
  now()-interval '101 days'+pg_catalog.make_interval(secs=>series.i)
from generate_series(1,501) series(i);
insert into public.notifications(id,user_id,type,task_id,read_at,created_at) values
(md5('n3a-unread-1')::uuid,'53b00000-0000-4000-8000-000000000001','mention',null,null,now()-interval '200 days'),
(md5('n3a-unread-2')::uuid,'53b00000-0000-4000-8000-000000000001','unlock',null,null,now()-interval '100 days'),
(md5('n3a-recent-read')::uuid,'53b00000-0000-4000-8000-000000000001','assignment',null,now()-interval '59 days',now()-interval '60 days'),
(md5('n3a-other-read')::uuid,'53b00000-0000-4000-8000-000000000002','assignment',null,now()-interval '10 days',now()-interval '11 days');

insert into ceit_connect_private.notification_cleanup_runs(
  id,started_at,finished_at,cutoff_at,status,eligible_count,deleted_count
) values (
  '53b20000-0000-4000-8000-000000000001',now()-interval '31 days',
  now()-interval '31 days',now()-interval '91 days','completed',0,0
);

create table n3a_first_run as
select * from public.run_notification_cleanup();
select pg_temp.n3a_record('19 first runner sees complete 501-row backlog',
  (select out_eligible_count=501 from n3a_first_run));
select pg_temp.n3a_record('20 first runner deletes bounded maximum 500',
  (select out_deleted_count=500 from n3a_first_run));
select pg_temp.n3a_record('21 first runner completes successfully',
  (select out_status='completed' and out_finished_at is not null from n3a_first_run));
select pg_temp.n3a_record('22 oldest-first leaves only newest eligible row',
  (select count(*)=1 from public.notifications where read_at<now()-interval '60 days')
  and exists(select 1 from public.notifications where id=md5('n3a-old-read-501')::uuid));
select pg_temp.n3a_record('23 automatic cleanup never removes unread rows',
  (select count(*)=2 from public.notifications where user_id='53b00000-0000-4000-8000-000000000001'
   and read_at is null));
select pg_temp.n3a_record('24 automatic cleanup preserves recent read row',exists(
  select 1 from public.notifications where id=md5('n3a-recent-read')::uuid));
select pg_temp.n3a_record('25 automatic cleanup preserves other recent row',exists(
  select 1 from public.notifications where id=md5('n3a-other-read')::uuid));
select pg_temp.n3a_record('26 first run history matches returned aggregates',exists(
  select 1 from ceit_connect_private.notification_cleanup_runs history
  join n3a_first_run result on result.out_run_id=history.id
  where history.status='completed' and history.eligible_count=501
  and history.deleted_count=500 and history.cleanup_error_message is null));
select pg_temp.n3a_record('27 history older than 30 days is purged',not exists(
  select 1 from ceit_connect_private.notification_cleanup_runs
  where id='53b20000-0000-4000-8000-000000000001'));
select pg_temp.n3a_record('28 history retention count is returned',
  (select out_retention_deleted_count=1 from n3a_first_run));

create table n3a_second_run as
select * from public.run_notification_cleanup();
select pg_temp.n3a_record('29 second runner sees one remaining eligible row',
  (select out_eligible_count=1 and out_deleted_count=1 from n3a_second_run));
select pg_temp.n3a_record('30 second runner drains old read backlog',not exists(
  select 1 from public.notifications where read_at<now()-interval '60 days'));
select pg_temp.n3a_record('31 unread rows remain indefinitely after repeated runs',
  (select count(*)=2 from public.notifications where user_id='53b00000-0000-4000-8000-000000000001'
   and read_at is null));
select pg_temp.n3a_record('32 both successful runs have private history',
  (select count(*)=2 from ceit_connect_private.notification_cleanup_runs
   where id in ((select out_run_id from n3a_first_run),(select out_run_id from n3a_second_run))));

do $$
declare v_total integer; v_pass integer;
begin
  select count(*),count(*) filter(where passed) into v_total,v_pass
  from public.n3a_behavior_results;
  if v_total<>32 or v_pass<>32 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back',v_pass,v_total;
  end if;
  raise exception 'TEST RESULTS 32/32 PASS — transaction intentionally rolled back';
end
$$;
```
