# R1 Paste A — catalog and security boundary

Run this as one paste in the **Dev** SQL Editor with **Run without RLS** enabled.
The final exception is intentional and rolls back every fixture. Expected final
result: `TEST RESULTS 25/25 PASS — transaction intentionally rolled back`. The
finished paste records exactly **25** result rows.

```sql
begin;
set local statement_timeout='120s';

create table r1_catalog_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);

create function pg_temp.r1_catalog_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  insert into public.r1_catalog_results(label,passed) values(p_label,p_passed);
end $$;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '71a00000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','r1-catalog-admin@test.local','',now(),
  '{}','{}',now(),now()
);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values(
  '71a00000-0000-4000-8000-000000000001',
  'r1-catalog-admin@test.local','R1 Catalog Member','Member',null,true
);
select set_config(
  'request.jwt.claims',
  '{"sub":"71a00000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
do $$ begin
  if auth.uid() is distinct from '71a00000-0000-4000-8000-000000000001'::uuid
     or (select count(*) from public.notifications
         where user_id='71a00000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'R1 catalog impersonation fixture failed.';
  end if;
end $$;
reset role;

select pg_temp.r1_catalog_record('01 notifications constraint has all eleven types',
  (select every(pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),quote_literal(t.type_name))>0)
   from pg_catalog.pg_constraint c
   cross join (values('mention'),('heads_up'),('assignment'),('status_change'),('unlock'),
     ('backup_request'),('volunteer_offer'),('leave_requested'),('leave_cancelled'),
     ('leave_approved'),('leave_denied')) t(type_name)
   where c.conrelid='public.notifications'::regclass and c.conname='notifications_type_check'));

select pg_temp.r1_catalog_record('02 push queue constraint has all eleven types',
  (select every(pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),quote_literal(t.type_name))>0)
   from pg_catalog.pg_constraint c
   cross join (values('mention'),('heads_up'),('assignment'),('status_change'),('unlock'),
     ('backup_request'),('volunteer_offer'),('leave_requested'),('leave_cancelled'),
     ('leave_approved'),('leave_denied')) t(type_name)
   where c.conrelid='ceit_connect_private.push_delivery_queue'::regclass
     and c.conname='push_delivery_queue_notification_type_check'));

select pg_temp.r1_catalog_record('03 notification constraints are validated',
  2=(select count(*) from pg_catalog.pg_constraint c
    where c.conname in ('notifications_type_check','push_delivery_queue_notification_type_check')
      and c.convalidated));

select pg_temp.r1_catalog_record('04 insert helper retains exact catalog properties',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[]));

select pg_temp.r1_catalog_record('05 insert helper denies every application role',
  not has_function_privilege('public','ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])','EXECUTE')
  and not has_function_privilege('anon','ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])','EXECUTE')
  and not has_function_privilege('authenticated','ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])','EXECUTE'));

select pg_temp.r1_catalog_record('06 insert helper preserves set-wise active actor filtering',
  (select pg_get_functiondef(p.oid) like '%select distinct proposed.user_id%'
      and pg_get_functiondef(p.oid) like '%proposed.user_id is distinct from p_actor_id%'
      and pg_get_functiondef(p.oid) like '%profile.is_active is true%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure));

select pg_temp.r1_catalog_record('07 insert helper includes every R1 type',
  (select every(pg_catalog.strpos(pg_get_functiondef(p.oid),quote_literal(t.type_name))>0)
   from pg_catalog.pg_proc p
   cross join (values('volunteer_offer'),('leave_requested'),('leave_cancelled'),
     ('leave_approved'),('leave_denied')) t(type_name)
   where p.oid='ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure));

select pg_temp.r1_catalog_record('08 claim function retains exact catalog properties',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.claim_push_deliveries(integer)'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[]));

select pg_temp.r1_catalog_record('09 claim execute remains anon capability only',
  has_function_privilege('anon','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('public','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_push_deliveries(integer)','EXECUTE'));

select pg_temp.r1_catalog_record('10 claim return shape remains thirteen OUT columns',
  13=(select count(*) from information_schema.parameters p
    where p.specific_schema='public'
      and p.specific_name like 'claim_push_deliveries_%'
      and p.parameter_mode='OUT'));

select pg_temp.r1_catalog_record('11 claim authenticates before queue mutation',
  (select 0 < pg_catalog.strpos(pg_get_functiondef(p.oid),'authenticate_push_sender()')
      and pg_catalog.strpos(pg_get_functiondef(p.oid),'authenticate_push_sender()')
        < pg_catalog.strpos(pg_get_functiondef(p.oid),'delete from ceit_connect_private.push_delivery_queue')
   from pg_catalog.pg_proc p where p.oid='public.claim_push_deliveries(integer)'::regprocedure));

select pg_temp.r1_catalog_record('12 claim contains all exact R1 generic copies',
  (select pg_get_functiondef(p.oid) like '%when ''volunteer_offer'' then ''A task has a new volunteer offer.''%'
      and pg_get_functiondef(p.oid) like '%when ''leave_requested'' then ''A task has a new leave request.''%'
      and pg_get_functiondef(p.oid) like '%when ''leave_cancelled'' then ''A leave request was cancelled.''%'
      and pg_get_functiondef(p.oid) like '%when ''leave_approved'' then ''Your leave request was approved.''%'
      and pg_get_functiondef(p.oid) like '%when ''leave_denied'' then ''Your leave request was denied.''%'
   from pg_catalog.pg_proc p where p.oid='public.claim_push_deliveries(integer)'::regprocedure));

select pg_temp.r1_catalog_record('13 volunteer trigger function is private hardened definer',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='ceit_connect_private.notify_task_volunteer_offer()'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[])
  and not has_function_privilege('authenticated','ceit_connect_private.notify_task_volunteer_offer()','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.notify_task_volunteer_offer()','EXECUTE'));

select pg_temp.r1_catalog_record('14 leave trigger function is private hardened definer',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='ceit_connect_private.notify_task_leave_request()'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[])
  and not has_function_privilege('authenticated','ceit_connect_private.notify_task_leave_request()','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.notify_task_leave_request()','EXECUTE'));

select pg_temp.r1_catalog_record('15 volunteer trigger is exact AFTER INSERT row trigger',
  exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.task_volunteers'::regclass
      and t.tgname='task_volunteers_z8_notifications' and not t.tgisinternal
      and pg_get_triggerdef(t.oid) like '%AFTER INSERT%FOR EACH ROW%notify_task_volunteer_offer()%'));

select pg_temp.r1_catalog_record('16 leave trigger covers INSERT and status UPDATE',
  exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.task_leave_requests'::regclass
      and t.tgname='task_leave_requests_z8_request_notifications' and not t.tgisinternal
      and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE OF status%FOR EACH ROW%notify_task_leave_request()%'));

select pg_temp.r1_catalog_record('17 leave suppression trigger remains attached',
  exists(select 1 from pg_catalog.pg_trigger t
    where t.tgrelid='public.task_leave_requests'::regclass
      and t.tgname='task_leave_requests_z8_notification_suppression'
      and pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF status%'));

select pg_temp.r1_catalog_record('18 leave trigger names enforce suppression request activity order',
  'task_leave_requests_z8_notification_suppression' < 'task_leave_requests_z8_request_notifications'
  and 'task_leave_requests_z8_request_notifications' < 'task_leave_requests_z9_activity_log');

select pg_temp.r1_catalog_record('19 notification policies remain exact pair',
  2=(select count(*) from pg_catalog.pg_policies p
    where p.schemaname='public' and p.tablename='notifications'));

select pg_temp.r1_catalog_record('20 authenticated notification privilege remains SELECT only',
  has_table_privilege('authenticated','public.notifications','SELECT')
  and not has_table_privilege('authenticated','public.notifications','INSERT')
  and not has_table_privilege('authenticated','public.notifications','UPDATE')
  and not has_table_privilege('authenticated','public.notifications','DELETE'));

select pg_temp.r1_catalog_record('21 notification and queue foreign-key counts remain two each',
  2=(select count(*) from pg_catalog.pg_constraint c
    where c.conrelid='public.notifications'::regclass and c.contype='f')
  and 2=(select count(*) from pg_catalog.pg_constraint c
    where c.conrelid='ceit_connect_private.push_delivery_queue'::regclass and c.contype='f'));

select pg_temp.r1_catalog_record('22 R1 functions have no overloads',
  1=(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='ceit_connect_private' and p.proname='notify_task_volunteer_offer')
  and 1=(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='ceit_connect_private' and p.proname='notify_task_leave_request')
  and 1=(select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_push_deliveries'));

select pg_temp.r1_catalog_record('23 N3 cleanup remains notification-type agnostic',
  (select pg_catalog.strpos(pg_get_functiondef(p.oid),'notification_row.type')=0
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.purge_old_read_notifications(timestamptz)'::regprocedure));

set local role authenticated;
do $$ begin
  begin perform ceit_connect_private.notify_task_leave_request();
  exception when insufficient_privilege then
    perform pg_temp.r1_catalog_record('24 browser cannot execute leave trigger function',true); return;
  end;
  perform pg_temp.r1_catalog_record('24 browser cannot execute leave trigger function',false);
end $$;
reset role;

set local role authenticated;
select pg_temp.r1_catalog_record('25 authenticated fixture retains zero-row own reader boundary',
  public.get_notification_unread_count()=0);
reset role;

do $$
declare v_total integer; v_failed integer;
begin
  select count(*),count(*) filter(where not passed) into v_total,v_failed
  from public.r1_catalog_results;
  if v_total<>25 or v_failed<>0 then
    raise exception 'TEST RESULTS %/25 FAIL — % failed; transaction intentionally rolled back',v_total-v_failed,v_failed;
  end if;
  raise exception 'TEST RESULTS 25/25 PASS — transaction intentionally rolled back';
end $$;
```
