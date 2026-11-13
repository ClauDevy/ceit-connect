# G1 alert grouping — Dev catalog test paste

Dev only. In the Supabase SQL Editor select **Run without RLS**, paste this entire block once, and run it. The final intentional exception must read `TEST RESULTS 24/24 PASS`; the transaction rolls back every fixture.

```sql
begin;

create table public.g1_catalog_results (
  label text primary key,
  passed boolean not null
);

create function pg_temp.g1_catalog_record(p_label text, p_passed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.g1_catalog_results(label, passed)
  values (p_label, coalesce(p_passed, false));
end;
$$;

set local session_replication_role = replica;
insert into public.committees(id, name)
values ('8200c000-0000-4000-8000-000000000001', 'G1 Catalog');
insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '82000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'g1-catalog@test.local', '', now(),
  '{}', '{}', now(), now()
);
insert into public.users(id, email, full_name, role, committee_id, is_active)
values (
  '82000000-0000-4000-8000-000000000001', 'g1-catalog@test.local',
  'G1 Catalog Member', 'Member', '8200c000-0000-4000-8000-000000000001', true
);
insert into public.events(id, name, start_date, end_date, status, created_by)
values (
  '82002000-0000-4000-8000-000000000001', 'G1 Catalog Event',
  '2026-11-01', '2027-12-31', 'Active', '82000000-0000-4000-8000-000000000001'
);
insert into public.tasks(
  id, event_id, committee_id, title, phase, status, task_type,
  primary_assignees, assist_assignees, is_confidential, request_backup, created_by, sort_order
) values (
  '82003000-0000-4000-8000-000000000001',
  '82002000-0000-4000-8000-000000000001',
  '8200c000-0000-4000-8000-000000000001',
  'G1 Catalog Task', 'G1', 'To Do', 'Deliverable',
  array['82000000-0000-4000-8000-000000000001'::uuid], '{}', false, false,
  '82000000-0000-4000-8000-000000000001', 1024
);
insert into public.push_subscriptions(
  id, user_id, endpoint, endpoint_hash, p256dh, auth_secret, device_label, platform
) values (
  '82005000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'https://fcm.googleapis.com/g1/catalog',
  extensions.digest(pg_catalog.convert_to('https://fcm.googleapis.com/g1/catalog', 'UTF8'), 'sha256'),
  repeat('A', 87), repeat('b', 22), 'G1 catalog device', 'desktop'
);
set local session_replication_role = origin;

select set_config(
  'request.jwt.claims',
  '{"sub":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
do $$
begin
  if auth.uid() is distinct from '82000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'G1 catalog impersonation fixture failed.';
  end if;
end;
$$;
reset role;

select pg_temp.g1_catalog_record('01 migration objects exist',
  to_regclass('ceit_connect_private.push_launch_group_context') is not null
  and exists(select 1 from information_schema.columns where table_schema='ceit_connect_private' and table_name='push_delivery_queue' and column_name='group_window_id' and data_type='uuid')
  and exists(select 1 from information_schema.columns where table_schema='ceit_connect_private' and table_name='push_delivery_queue' and column_name='group_window_started_at' and data_type='timestamp with time zone'));
select pg_temp.g1_catalog_record('02 context table is postgres-owned zero-policy RLS',
  (select c.relrowsecurity and pg_get_userbyid(c.relowner)='postgres' from pg_class c where c.oid='ceit_connect_private.push_launch_group_context'::regclass)
  and 0=(select count(*) from pg_policy where polrelid='ceit_connect_private.push_launch_group_context'::regclass));
select pg_temp.g1_catalog_record('03 context table has no browser or service grants',
  not has_table_privilege('anon','ceit_connect_private.push_launch_group_context','SELECT')
  and not has_table_privilege('anon','ceit_connect_private.push_launch_group_context','INSERT')
  and not has_table_privilege('authenticated','ceit_connect_private.push_launch_group_context','SELECT')
  and not has_table_privilege('authenticated','ceit_connect_private.push_launch_group_context','INSERT')
  and not has_table_privilege('service_role','ceit_connect_private.push_launch_group_context','SELECT'));
select pg_temp.g1_catalog_record('04 group shape constraint is validated',exists(
  select 1 from pg_constraint where conrelid='ceit_connect_private.push_delivery_queue'::regclass
  and conname='push_delivery_queue_group_shape' and convalidated));
select pg_temp.g1_catalog_record('05 all-read is a permitted terminal reason',
  (select strpos(pg_get_constraintdef(oid),'''all_read''')>0 from pg_constraint
   where conrelid='ceit_connect_private.push_delivery_queue'::regclass
   and conname='push_delivery_queue_terminal_reason_check'));
select pg_temp.g1_catalog_record('06 both grouping indexes exist',
  2=(select count(*) from pg_indexes where schemaname='ceit_connect_private'
     and indexname in ('push_delivery_queue_open_group_idx','push_delivery_queue_group_subscription_idx')));
select pg_temp.g1_catalog_record('07 four replaced functions have no overloads',
  4=(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where (n.nspname,p.proname) in (
       ('ceit_connect_private','notify_event_launch'),
       ('ceit_connect_private','enqueue_notification_push'),
       ('public','claim_push_deliveries'),
       ('public','acknowledge_push_delivery'))));
select pg_temp.g1_catalog_record('08 four functions remain postgres definer empty-path volatile',not exists(
  select 1 from pg_proc where oid=any(array[
    'ceit_connect_private.notify_event_launch()'::regprocedure,
    'ceit_connect_private.enqueue_notification_push()'::regprocedure,
    'public.claim_push_deliveries(integer)'::regprocedure,
    'public.acknowledge_push_delivery(uuid,uuid,text,integer)'::regprocedure
  ]) and not (pg_get_userbyid(proowner)='postgres' and prosecdef and provolatile='v' and proconfig=array['search_path=""']::text[])));
select pg_temp.g1_catalog_record('09 private trigger functions remain ungranted',
  not has_function_privilege('public','ceit_connect_private.notify_event_launch()','EXECUTE')
  and not has_function_privilege('anon','ceit_connect_private.notify_event_launch()','EXECUTE')
  and not has_function_privilege('authenticated','ceit_connect_private.enqueue_notification_push()','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.enqueue_notification_push()','EXECUTE'));
select pg_temp.g1_catalog_record('10 sender execute remains anon capability only',
  has_function_privilege('anon','public.claim_push_deliveries(integer)','EXECUTE')
  and has_function_privilege('anon','public.acknowledge_push_delivery(uuid,uuid,text,integer)','EXECUTE')
  and not has_function_privilege('public','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_push_deliveries(integer)','EXECUTE'));
select pg_temp.g1_catalog_record('11 claim return shape remains thirteen columns',
  13=(select count(*) from information_schema.parameters where specific_schema='public'
      and specific_name like 'claim_push_deliveries_%' and parameter_mode='OUT'));
select pg_temp.g1_catalog_record('12 claim keeps exact output names',
  array['out_delivery_id','out_lease_token','out_run_id','out_run_token','out_endpoint','out_p256dh','out_auth_secret','out_title','out_body','out_target_path','out_notification_type','out_attempt','out_lease_expires_at']::text[]=
  (select array_agg(parameter_name::text order by ordinal_position) from information_schema.parameters
   where specific_schema='public' and specific_name like 'claim_push_deliveries_%' and parameter_mode='OUT'));
select pg_temp.g1_catalog_record('13 claim authenticates before queue mutation or lock',
  (select strpos(pg_get_functiondef(oid),'authenticate_push_sender()') < strpos(pg_get_functiondef(oid),'delete from ceit_connect_private.push_delivery_queue')
   from pg_proc where oid='public.claim_push_deliveries(integer)'::regprocedure));
select pg_temp.g1_catalog_record('14 acknowledge authenticates before queue lock',
  (select strpos(pg_get_functiondef(oid),'authenticate_push_sender()') < strpos(pg_get_functiondef(oid),'for update')
   from pg_proc where oid='public.acknowledge_push_delivery(uuid,uuid,text,integer)'::regprocedure));
select pg_temp.g1_catalog_record('15 enqueue closes joins at twenty-five seconds',
  (select strpos(pg_get_functiondef(oid),$$interval '25 seconds' > v_now$$)>0
   from pg_proc where oid='ceit_connect_private.enqueue_notification_push()'::regprocedure));
select pg_temp.g1_catalog_record('16 delivery remains at thirty seconds',
  (select strpos(pg_get_functiondef(oid),$$interval '30 seconds'$$)>0
   from pg_proc where oid='ceit_connect_private.enqueue_notification_push()'::regprocedure));
select pg_temp.g1_catalog_record('17 grouped retry deadline starts at window start',
  (select strpos(pg_get_functiondef(oid),$$v_group_window_started_at + interval '1 hour'$$)>0
   from pg_proc where oid='ceit_connect_private.enqueue_notification_push()'::regprocedure));
select pg_temp.g1_catalog_record('18 leader considers pending earlier rows only',
  (select strpos(pg_get_functiondef(oid),$$earlier.state = 'pending'$$)>0
   from pg_proc where oid='public.claim_push_deliveries(integer)'::regprocedure));
select pg_temp.g1_catalog_record('19 single delivery id remains queue row id',
  (select strpos(pg_get_functiondef(oid),'when delivery.group_count >= 2')>0
      and strpos(pg_get_functiondef(oid),'else leader.id')>0
   from pg_proc where oid='public.claim_push_deliveries(integer)'::regprocedure));
select pg_temp.g1_catalog_record('20 summary target is fixed root',
  (select strpos(pg_get_functiondef(oid),'delivery.group_count >= 2')>0
      and strpos(pg_get_functiondef(oid),$$then '/'$$)>0
   from pg_proc where oid='public.claim_push_deliveries(integer)'::regprocedure));
select pg_temp.g1_catalog_record('21 approved summary copies are exact',
  (select strpos(pg_get_functiondef(oid),'You were assigned to %s tasks.')>0
      and strpos(pg_get_functiondef(oid),'%s tasks are due within 24 hours.')>0
      and strpos(pg_get_functiondef(oid),'%s Live Operation call times are within 2 hours.')>0
      and strpos(pg_get_functiondef(oid),'%s of your tasks are now unlocked.')>0
   from pg_proc where oid='public.claim_push_deliveries(integer)'::regprocedure));
select pg_temp.g1_catalog_record('22 launch context is private transaction keyed',
  (select strpos(pg_get_functiondef(oid),'push_launch_group_context')>0
      and strpos(pg_get_functiondef(oid),'pg_current_xact_id()')>0
   from pg_proc where oid='ceit_connect_private.notify_event_launch()'::regprocedure));
select pg_temp.g1_catalog_record('23 enqueue has no blocking context error',
  (select strpos(pg_get_functiondef(oid),'Push enqueue trigger context is invalid')=0
      and strpos(pg_get_functiondef(oid),'when others then')>0
   from pg_proc where oid='ceit_connect_private.enqueue_notification_push()'::regprocedure));
select pg_temp.g1_catalog_record('24 migration functions contain no session-user gate',not exists(
  select 1 from pg_proc where oid=any(array[
    'ceit_connect_private.notify_event_launch()'::regprocedure,
    'ceit_connect_private.enqueue_notification_push()'::regprocedure,
    'public.claim_push_deliveries(integer)'::regprocedure,
    'public.acknowledge_push_delivery(uuid,uuid,text,integer)'::regprocedure
  ]) and strpos(lower(pg_get_functiondef(oid)),'session_user')>0));

do $$
declare
  v_pass integer;
  v_total integer;
begin
  select count(*) filter(where passed), count(*)
  into v_pass, v_total
  from public.g1_catalog_results;
  if v_pass <> 24 or v_total <> 24 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back', v_pass, v_total;
  end if;
  raise exception 'TEST RESULTS 24/24 PASS — transaction intentionally rolled back';
end;
$$;
```
