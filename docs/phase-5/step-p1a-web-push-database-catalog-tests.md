# P1a Paste A: web-push catalog and security boundary

Run this self-contained paste in the **Dev SQL Editor** only, with **Run
without RLS** enabled (postgres), after reviewing and applying
`20261112120000_web_push_database.sql`. It records exactly **44** assertions
and intentionally rolls back. Do not run it on Prod.

Expected sentinel:

`TEST RESULTS 44/44 PASS — transaction intentionally rolled back`

```sql
begin;
set local statement_timeout='120s';

create table p1a_catalog_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);
create function pg_temp.p1a_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  insert into public.p1a_catalog_results(label,passed) values(p_label,coalesce(p_passed,false));
end $$;

select pg_temp.p1a_record('01 subscription table exists',
  to_regclass('public.push_subscriptions') is not null);
select pg_temp.p1a_record('02 queue table exists',
  to_regclass('ceit_connect_private.push_delivery_queue') is not null);
select pg_temp.p1a_record('03 credential table exists',
  to_regclass('ceit_connect_private.push_sender_credentials') is not null);
select pg_temp.p1a_record('05 run log table exists',
  to_regclass('ceit_connect_private.push_delivery_runs') is not null);
select pg_temp.p1a_record('06 kick tables exist',
  to_regclass('ceit_connect_private.push_kick_state') is not null and
  to_regclass('ceit_connect_private.push_environment_config') is not null);

select pg_temp.p1a_record('07 subscriptions RLS enabled',
  (select relrowsecurity from pg_class where oid='public.push_subscriptions'::regclass));
select pg_temp.p1a_record('08 subscriptions have one owner policy',
  1=(select count(*) from pg_policies where schemaname='public' and
    tablename='push_subscriptions' and policyname='push_subscriptions_select_own'
    and cmd='SELECT' and roles='{authenticated}'));
select pg_temp.p1a_record('09 owner policy checks uid and active role',exists(
  select 1 from pg_policies where schemaname='public' and tablename='push_subscriptions'
  and qual like '%user_id = auth.uid()%' and qual like '%my_role() IS NOT NULL%'));
select pg_temp.p1a_record('10 authenticated cannot read endpoint',
  not has_column_privilege('authenticated','public.push_subscriptions','endpoint','SELECT')
  and not has_column_privilege('authenticated','public.push_subscriptions','p256dh','SELECT')
  and not has_column_privilege('authenticated','public.push_subscriptions','auth_secret','SELECT'));
select pg_temp.p1a_record('11 authenticated can read safe subscription metadata',
  has_column_privilege('authenticated','public.push_subscriptions','id','SELECT')
  and has_column_privilege('authenticated','public.push_subscriptions','device_label','SELECT')
  and has_column_privilege('authenticated','public.push_subscriptions','platform','SELECT'));
select pg_temp.p1a_record('12 browser roles cannot write subscriptions directly',
  not has_table_privilege('anon','public.push_subscriptions','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','public.push_subscriptions','INSERT,UPDATE,DELETE'));
select pg_temp.p1a_record('13 endpoint hash is unique',exists(
  select 1 from pg_constraint where conrelid='public.push_subscriptions'::regclass
  and contype='u' and pg_get_constraintdef(oid) like '%endpoint_hash%'));
select pg_temp.p1a_record('14 per-user recent index exact',exists(
  select 1 from pg_indexes where schemaname='public' and tablename='push_subscriptions'
  and indexname='push_subscriptions_user_recent_idx'
  and indexdef like '%(user_id, last_seen_at DESC, id)%'));

select pg_temp.p1a_record('15 queue has exactly notification and user foreign keys',
  array['notifications','users']::text[]=(select array_agg(referenced.relname::text order by referenced.relname)
  from pg_constraint constraint_row
  join pg_class referenced on referenced.oid=constraint_row.confrelid
  where constraint_row.conrelid='ceit_connect_private.push_delivery_queue'::regclass
  and constraint_row.contype='f'));
select pg_temp.p1a_record('16 queue has no subscription foreign key',not exists(
  select 1 from pg_constraint where conrelid='ceit_connect_private.push_delivery_queue'::regclass
  and contype='f' and pg_get_constraintdef(oid) like '%subscription_id%'));
select pg_temp.p1a_record('17 notification foreign key cascades',exists(
  select 1 from pg_constraint where conrelid='ceit_connect_private.push_delivery_queue'::regclass
  and contype='f' and pg_get_constraintdef(oid) like '%notification_id%ON DELETE CASCADE%'));
select pg_temp.p1a_record('18 queue uniqueness prevents duplicate delivery',exists(
  select 1 from pg_constraint where conrelid='ceit_connect_private.push_delivery_queue'::regclass
  and contype='u' and pg_get_constraintdef(oid) like '%notification_id, subscription_id%'));
select pg_temp.p1a_record('19 queue claim index is pending-only',exists(
  select 1 from pg_indexes where schemaname='ceit_connect_private'
  and indexname='push_delivery_queue_claim_idx' and indexdef like '%WHERE (state = ''pending''%'));
select pg_temp.p1a_record('20 queue retry deadline is one hour',
  (select column_default like '%01:00:00%' from information_schema.columns
   where table_schema='ceit_connect_private' and table_name='push_delivery_queue'
   and column_name='retry_deadline_at'));

select pg_temp.p1a_record('21 every private table has RLS',not exists(
  select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='ceit_connect_private' and c.relname=any(array[
    'push_delivery_queue','push_sender_credentials','push_delivery_runs',
    'push_kick_state','push_environment_config']) and not c.relrowsecurity));
select pg_temp.p1a_record('22 no private table app grants',not exists(
  select 1 from information_schema.role_table_grants where table_schema='ceit_connect_private'
  and table_name like 'push_%' and grantee in ('anon','authenticated','service_role')));
select pg_temp.p1a_record('23 credentials have current-next slot check',exists(
  select 1 from pg_constraint where conrelid='ceit_connect_private.push_sender_credentials'::regclass
  and contype='c' and pg_get_constraintdef(oid) like '%current%next%'));
select pg_temp.p1a_record('24 credential salt and hash are bytea',
  2=(select count(*) from information_schema.columns where table_schema='ceit_connect_private'
  and table_name='push_sender_credentials' and column_name in ('salt','secret_hash')
  and data_type='bytea'));
select pg_temp.p1a_record('25 credentials contain no raw secret column',not exists(
  select 1 from information_schema.columns where table_schema='ceit_connect_private'
  and table_name='push_sender_credentials' and column_name in ('secret','raw_secret','capability')));
select pg_temp.p1a_record('28 run log has no subject identifiers',not exists(
  select 1 from information_schema.columns where table_schema='ceit_connect_private'
  and table_name='push_delivery_runs' and column_name in
  ('user_id','notification_id','task_id','subscription_id','endpoint','message','body','title')));
select pg_temp.p1a_record('29 run log contains exact outcome counts',
  6=(select count(*) from information_schema.columns where table_schema='ceit_connect_private'
  and table_name='push_delivery_runs' and column_name in
  ('claimed_count','delivered_count','retry_scheduled_count','terminal_count',
   'expired_subscription_count','unacknowledged_count')));
select pg_temp.p1a_record('30 coalescing window is fixed at ten seconds',
  (select coalescing_seconds=10 from ceit_connect_private.push_environment_config where singleton));

select pg_temp.p1a_record('31 enqueue trigger is after insert row-level',exists(
  select 1 from pg_trigger where tgrelid='public.notifications'::regclass
  and tgname='notifications_z9_enqueue_push' and not tgisinternal
  and pg_get_triggerdef(oid) like '%AFTER INSERT%FOR EACH ROW%'));
select pg_temp.p1a_record('32 deactivation trigger is update row-level',exists(
  select 1 from pg_trigger where tgrelid='public.users'::regclass
  and tgname='users_z9_remove_deactivated_push_subscriptions' and not tgisinternal
  and pg_get_triggerdef(oid) like '%AFTER UPDATE OF is_active%'));
select pg_temp.p1a_record('33 existing notification functions were not replaced by P1a',
  pg_get_functiondef('ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure)
    not like '%push_delivery%');
select pg_temp.p1a_record('34 sender public functions have exact signatures',
  to_regprocedure('public.claim_push_deliveries(integer)') is not null and
  to_regprocedure('public.acknowledge_push_delivery(uuid,uuid,text,integer)') is not null and
  to_regprocedure('public.finish_push_delivery_run(uuid,uuid)') is not null);
select pg_temp.p1a_record('35 sender functions are postgres definer empty-path',not exists(
  select 1 from pg_proc where oid=any(array[
    'public.claim_push_deliveries(integer)'::regprocedure,
    'public.acknowledge_push_delivery(uuid,uuid,text,integer)'::regprocedure,
    'public.finish_push_delivery_run(uuid,uuid)'::regprocedure])
  and not (prosecdef and pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""'])));
select pg_temp.p1a_record('36 anon can execute only sender surface',
  has_function_privilege('anon','public.claim_push_deliveries(integer)','EXECUTE')
  and has_function_privilege('anon','public.acknowledge_push_delivery(uuid,uuid,text,integer)','EXECUTE')
  and has_function_privilege('anon','public.finish_push_delivery_run(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.register_push_subscription(text,text,text,text,text,timestamptz)','EXECUTE'));
select pg_temp.p1a_record('37 service role has no sender execute',
  not has_function_privilege('service_role','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.acknowledge_push_delivery(uuid,uuid,text,integer)','EXECUTE'));
select pg_temp.p1a_record('38 subscription RPCs are authenticated only',
  has_function_privilege('authenticated','public.register_push_subscription(text,text,text,text,text,timestamptz)','EXECUTE')
  and has_function_privilege('authenticated','public.list_my_push_subscriptions()','EXECUTE')
  and has_function_privilege('authenticated','public.remove_my_push_subscription(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.remove_all_my_push_subscriptions()','EXECUTE')
  and not has_function_privilege('anon','public.list_my_push_subscriptions()','EXECUTE'));
select pg_temp.p1a_record('39 cleanup and credential writers are postgres-session only grants',
  not has_function_privilege('anon','public.run_push_delivery_cleanup()','EXECUTE')
  and not has_function_privilege('authenticated','public.run_push_delivery_cleanup()','EXECUTE')
  and not has_function_privilege('anon','public.configure_push_sender_credential_hash(text,bigint,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.configure_push_sender_credential_hash(text,bigint,text,text)','EXECUTE')
  and not has_function_privilege('service_role','public.configure_push_sender_credential_hash(text,bigint,text,text)','EXECUTE')
  and not has_function_privilege('anon','public.retire_push_sender_credential(text)','EXECUTE')
  and not has_function_privilege('authenticated','public.retire_push_sender_credential(text)','EXECUTE')
  and not has_function_privilege('service_role','public.retire_push_sender_credential(text)','EXECUTE'));
select pg_temp.p1a_record('40 no service-role exception exists',not exists(
  select 1 from information_schema.routine_privileges where specific_schema in ('public','ceit_connect_private')
  and routine_name like '%push%' and grantee='service_role'));

select pg_temp.p1a_record('strict endpoint allowlist is pinned in registration body',
  pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'fcm.googleapis.com')>0
  and pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'updates.push.services.mozilla.com')>0
  and pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'web.push.apple.com')>0
  and pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'notify\.windows\.com')>0
  and pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'strpos(v_endpoint, ''@'')')>0
  and pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'strpos(v_host, '':'')')>0
  and pg_catalog.strpos(pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure),'strpos(v_endpoint, ''#'')')>0);
select pg_temp.p1a_record('base64url key ranges are pinned in registration body',
  pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure)
    like '%between 80 and 100%'
  and pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure)
    like '%between 16 and 32%'
  and pg_get_functiondef('public.register_push_subscription(text,text,text,text,text,timestamptz)'::regprocedure)
    like '%[A-Za-z0-9_-]+%');
select pg_temp.p1a_record('kick state acquisition skips locked rows',
  pg_catalog.lower(pg_get_functiondef('ceit_connect_private.request_push_kick(boolean)'::regprocedure))
    like '%for update skip locked%');
select pg_temp.p1a_record('if-due wake helper exists and is private',
  to_regprocedure('ceit_connect_private.request_push_kick_if_due()') is not null
  and not has_function_privilege('anon','ceit_connect_private.request_push_kick_if_due()','EXECUTE')
  and not has_function_privilege('authenticated','ceit_connect_private.request_push_kick_if_due()','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.request_push_kick_if_due()','EXECUTE'));
select pg_temp.p1a_record('if-due checks pending and expired-lease work then coalesces',
  pg_get_functiondef('ceit_connect_private.request_push_kick_if_due()'::regprocedure)
    like '%state = ''pending''%next_attempt_at <= v_now%'
  and pg_get_functiondef('ceit_connect_private.request_push_kick_if_due()'::regprocedure)
    like '%retry_deadline_at > v_now%'
  and pg_get_functiondef('ceit_connect_private.request_push_kick_if_due()'::regprocedure)
    like '%attempt_count < 8%'
  and pg_get_functiondef('ceit_connect_private.request_push_kick_if_due()'::regprocedure)
    like '%state = ''leased''%lease_expires_at <= v_now%'
  and pg_get_functiondef('ceit_connect_private.request_push_kick_if_due()'::regprocedure)
    like '%request_push_kick(false)%');
select pg_temp.p1a_record('cleanup output has five counts and no auth-log field',
  5=(select count(*) from information_schema.parameters
     where specific_schema='public'
       and specific_name like 'run_push_delivery_cleanup_%'
       and parameter_mode='OUT')
  and not exists(select 1 from information_schema.parameters
     where specific_schema='public'
       and specific_name like 'run_push_delivery_cleanup_%'
       and parameter_name like '%auth%'));
select pg_temp.p1a_record('sender authentication keeps generic null denial result',
  pg_get_functiondef('ceit_connect_private.authenticate_push_sender()'::regprocedure)
    like '%return null;%');

do $$
declare v_total integer; v_pass integer;
begin
  select count(*),count(*) filter(where passed) into v_total,v_pass
  from public.p1a_catalog_results;
  if v_total<>44 or v_pass<>44 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back',v_pass,v_total;
  end if;
  raise exception 'TEST RESULTS 44/44 PASS — transaction intentionally rolled back';
end
$$;
```

