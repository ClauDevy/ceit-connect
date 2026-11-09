# N3a Paste A: notification housekeeping catalog boundary

Run this one self-contained paste in the **Dev SQL Editor** only, with
**Run without RLS** enabled (postgres), after reviewing and applying
`20261111120000_notification_housekeeping.sql`. It owns its Auth/profile
fixture, impersonates the browser user, records exactly **38** result rows, and
intentionally aborts the transaction. The SQL block is **226 lines**. Do not
run it on Prod.

Expected sentinel:

`TEST RESULTS 38/38 PASS — transaction intentionally rolled back`

```sql
begin;
set local statement_timeout='120s';

create table n3a_catalog_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);

create function pg_temp.n3a_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  insert into public.n3a_catalog_results(label,passed) values(p_label,p_passed);
end $$;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '53a00000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','n3a-catalog@test.local','',now(),
  '{}','{}',now(),now()
);
insert into public.committees(id,name)
values('53a0c000-0000-4000-8000-000000000001','N3a Catalog Committee');
select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values(
  '53a00000-0000-4000-8000-000000000001',
  'n3a-catalog@test.local','N3a Catalog User','Member',
  '53a0c000-0000-4000-8000-000000000001',true
);
select set_config('ceit_connect.officer_writer','',true);

select pg_temp.n3a_record('01 authenticated keeps SELECT without raw DELETE',
  has_table_privilege('authenticated','public.notifications','SELECT')
  and not has_table_privilege('authenticated','public.notifications','DELETE'));
select pg_temp.n3a_record('02 notifications RLS remains enabled',
  (select relrowsecurity from pg_catalog.pg_class where oid='public.notifications'::regclass));
select pg_temp.n3a_record('03 exactly two notification policies remain',
  (select count(*)=2 from pg_catalog.pg_policies where schemaname='public' and tablename='notifications'));
select pg_temp.n3a_record('04 no notification DELETE policy exists',not exists(
  select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='notifications' and cmd='DELETE'));
select pg_temp.n3a_record('05 N1 select policy remains active-owner only',exists(
  select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='notifications'
  and policyname='notifications_select_own' and cmd='SELECT'
  and qual like '%user_id = auth.uid()%' and qual like '%my_role() IS NOT NULL%'));
select pg_temp.n3a_record('06 N1 update policy remains fail-closed',exists(
  select 1 from pg_catalog.pg_policies where schemaname='public' and tablename='notifications'
  and policyname='notifications_update_own' and cmd='UPDATE' and qual='false' and with_check='false'));
select pg_temp.n3a_record('07 cleanup index is ordered and partial',exists(
  select 1 from pg_catalog.pg_index where indexrelid='public.notifications_read_cleanup_idx'::regclass
  and pg_get_indexdef(indexrelid) like '%(read_at, id)%'
  and pg_get_expr(indpred,indrelid)='(read_at IS NOT NULL)'));
select pg_temp.n3a_record('08 history has exact aggregate columns',(
  select array_agg(column_name::text order by ordinal_position)=array[
    'id','started_at','finished_at','cutoff_at','status','eligible_count',
    'deleted_count','cleanup_error_sqlstate','cleanup_error_message',
    'retention_deleted_count','retention_error_sqlstate','retention_error_message'
  ]::text[]
  from information_schema.columns where table_schema='ceit_connect_private'
  and table_name='notification_cleanup_runs'));
select pg_temp.n3a_record('09 history RLS is enabled',
  (select relrowsecurity from pg_catalog.pg_class
   where oid='ceit_connect_private.notification_cleanup_runs'::regclass));
select pg_temp.n3a_record('10 history has zero policies',not exists(
  select 1 from pg_catalog.pg_policies where schemaname='ceit_connect_private'
  and tablename='notification_cleanup_runs'));
select pg_temp.n3a_record('11 history blocks all application roles',
  not has_table_privilege('anon','ceit_connect_private.notification_cleanup_runs','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','ceit_connect_private.notification_cleanup_runs','SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role','ceit_connect_private.notification_cleanup_runs','SELECT,INSERT,UPDATE,DELETE'));
select pg_temp.n3a_record('12 history has no foreign keys',not exists(
  select 1 from pg_catalog.pg_constraint
  where conrelid='ceit_connect_private.notification_cleanup_runs'::regclass and contype='f'));
select pg_temp.n3a_record('13 public signatures are exact',
  to_regprocedure('public.delete_notification(uuid)') is not null
  and to_regprocedure('public.clear_read_notifications()') is not null
  and to_regprocedure('public.run_notification_cleanup()') is not null);
select pg_temp.n3a_record('14 private signatures are exact',
  to_regprocedure('ceit_connect_private.delete_notification_for_user(uuid,uuid)') is not null
  and to_regprocedure('ceit_connect_private.clear_read_notifications_for_user(uuid)') is not null
  and to_regprocedure('ceit_connect_private.purge_old_read_notifications(timestamptz)') is not null
  and to_regprocedure('ceit_connect_private.purge_notification_cleanup_runs()') is not null);
select pg_temp.n3a_record('15 public delete is postgres definer with empty path',exists(
  select 1 from pg_catalog.pg_proc where oid='public.delete_notification(uuid)'::regprocedure
  and pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'])) ;
select pg_temp.n3a_record('16 public clear is postgres definer with empty path',exists(
  select 1 from pg_catalog.pg_proc where oid='public.clear_read_notifications()'::regprocedure
  and pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'])) ;
select pg_temp.n3a_record('17 runner is postgres definer with empty path',exists(
  select 1 from pg_catalog.pg_proc where oid='public.run_notification_cleanup()'::regprocedure
  and pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'])) ;
select pg_temp.n3a_record('18 all private mutators are postgres definers with empty paths',(
  select count(*)=4 from pg_catalog.pg_proc where oid=any(array[
    'ceit_connect_private.delete_notification_for_user(uuid,uuid)'::regprocedure,
    'ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure,
    'ceit_connect_private.purge_old_read_notifications(timestamptz)'::regprocedure,
    'ceit_connect_private.purge_notification_cleanup_runs()'::regprocedure
  ]) and pg_get_userbyid(proowner)='postgres' and prosecdef and proconfig=array['search_path=""'])) ;
select pg_temp.n3a_record('19 delete execute is authenticated only',
  has_function_privilege('authenticated','public.delete_notification(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.delete_notification(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.delete_notification(uuid)','EXECUTE'));
select pg_temp.n3a_record('20 clear execute is authenticated only',
  has_function_privilege('authenticated','public.clear_read_notifications()','EXECUTE')
  and not has_function_privilege('anon','public.clear_read_notifications()','EXECUTE')
  and not has_function_privilege('service_role','public.clear_read_notifications()','EXECUTE'));
select pg_temp.n3a_record('21 runner blocks every application role',
  not has_function_privilege('anon','public.run_notification_cleanup()','EXECUTE')
  and not has_function_privilege('authenticated','public.run_notification_cleanup()','EXECUTE')
  and not has_function_privilege('service_role','public.run_notification_cleanup()','EXECUTE'));
select pg_temp.n3a_record('22 private mutators block every application role',(
  select count(*)=4 from pg_catalog.pg_proc where oid=any(array[
    'ceit_connect_private.delete_notification_for_user(uuid,uuid)'::regprocedure,
    'ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure,
    'ceit_connect_private.purge_old_read_notifications(timestamptz)'::regprocedure,
    'ceit_connect_private.purge_notification_cleanup_runs()'::regprocedure
  ]) and not has_function_privilege('anon',oid,'EXECUTE')
  and not has_function_privilege('authenticated',oid,'EXECUTE')
  and not has_function_privilege('service_role',oid,'EXECUTE')));
select pg_temp.n3a_record('23 constants are fixed at 60 30 and 500',
  public.notification_read_retention_days()=60
  and public.notification_cleanup_run_retention_days()=30
  and public.notification_cleanup_batch_size()=500);
select pg_temp.n3a_record('24 constants are postgres invokers with empty paths',(
  select count(*)=3 from pg_catalog.pg_proc where oid=any(array[
    'public.notification_read_retention_days()'::regprocedure,
    'public.notification_cleanup_run_retention_days()'::regprocedure,
    'public.notification_cleanup_batch_size()'::regprocedure
  ]) and pg_get_userbyid(proowner)='postgres' and not prosecdef
  and provolatile='i' and proconfig=array['search_path=""'])) ;
select pg_temp.n3a_record('25 constants block every application role',(
  select count(*)=3 from pg_catalog.pg_proc where oid=any(array[
    'public.notification_read_retention_days()'::regprocedure,
    'public.notification_cleanup_run_retention_days()'::regprocedure,
    'public.notification_cleanup_batch_size()'::regprocedure
  ]) and not has_function_privilege('anon',oid,'EXECUTE')
  and not has_function_privilege('authenticated',oid,'EXECUTE')
  and not has_function_privilege('service_role',oid,'EXECUTE')));
select pg_temp.n3a_record('26 runner returns exact aggregate columns',(
  select proallargtypes=array[
    'uuid'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid,
    'timestamptz'::regtype::oid,'text'::regtype::oid,'bigint'::regtype::oid,
    'integer'::regtype::oid,'integer'::regtype::oid
  ]::oid[]
  and proargmodes=array[
    't'::"char",'t'::"char",'t'::"char",'t'::"char",
    't'::"char",'t'::"char",'t'::"char",'t'::"char"
  ]::"char"[]
  from pg_catalog.pg_proc where oid='public.run_notification_cleanup()'::regprocedure));
select pg_temp.n3a_record('27 no new task event or comment foreign key exists',not exists(
  select 1 from pg_catalog.pg_constraint where conrelid='ceit_connect_private.notification_cleanup_runs'::regclass
  and confrelid=any(array['public.tasks'::regclass,'public.events'::regclass,'public.task_comments'::regclass])));
select pg_temp.n3a_record('28 cleanup adds no notification trigger',not exists(
  select 1 from pg_catalog.pg_trigger where tgrelid='public.notifications'::regclass
  and not tgisinternal and tgname like '%cleanup%'));
select pg_temp.n3a_record('29 history owner is postgres',
  (select pg_get_userbyid(relowner)='postgres' from pg_catalog.pg_class
   where oid='ceit_connect_private.notification_cleanup_runs'::regclass));
select pg_temp.n3a_record('30 history RLS is not forced',
  (select not relforcerowsecurity from pg_catalog.pg_class
   where oid='ceit_connect_private.notification_cleanup_runs'::regclass));
select pg_temp.n3a_record('31 history retention index is exact',exists(
  select 1 from pg_catalog.pg_index
  where indexrelid='ceit_connect_private.notification_cleanup_runs_finished_at_id_idx'::regclass
  and pg_get_indexdef(indexrelid) like '%(finished_at, id)%'));
select pg_temp.n3a_record('32 N3a function names have no overloads',(
  select count(*)=10 and count(distinct procedure.proname)=10
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname in ('public','ceit_connect_private')
  and procedure.proname=any(array[
    'notification_read_retention_days','notification_cleanup_run_retention_days',
    'notification_cleanup_batch_size','delete_notification',
    'delete_notification_for_user','clear_read_notifications',
    'clear_read_notifications_for_user','purge_old_read_notifications',
    'purge_notification_cleanup_runs','run_notification_cleanup'
  ])));
select pg_temp.n3a_record('33 automatic purge is ordered bounded and skip-locked',(
  select prosrc like '%order by notification_row.read_at, notification_row.id%'
  and prosrc like '%limit public.notification_cleanup_batch_size()%'
  and prosrc like '%for update of notification_row skip locked%'
  from pg_catalog.pg_proc
  where oid='ceit_connect_private.purge_old_read_notifications(timestamptz)'::regprocedure));
select pg_temp.n3a_record('34 clear-read is ID-ordered and skip-locked',(
  select prosrc like '%order by notification_row.id%'
  and prosrc like '%for update of notification_row skip locked%'
  from pg_catalog.pg_proc
  where oid='ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure));
select pg_temp.n3a_record('35 clear-read deletes only selected owner read victims',(
  select prosrc like '%notification_row.user_id = p_user_id%'
  and prosrc like '%notification_row.read_at is not null%'
  and prosrc like '%using victims%'
  from pg_catalog.pg_proc
  where oid='ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure));
select pg_temp.n3a_record('36 owner deletion returns are exact and volatile',(
  select count(*)=4 from pg_catalog.pg_proc where oid=any(array[
    'public.delete_notification(uuid)'::regprocedure,
    'ceit_connect_private.delete_notification_for_user(uuid,uuid)'::regprocedure,
    'public.clear_read_notifications()'::regprocedure,
    'ceit_connect_private.clear_read_notifications_for_user(uuid)'::regprocedure
  ]) and provolatile='v'
  and prorettype=case when proname like '%clear_read%' then 'bigint'::regtype::oid else 'boolean'::regtype::oid end));

select set_config('request.jwt.claims',
  '{"sub":"53a00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.n3a_record('37 active impersonation gets idempotent delete false',
  public.delete_notification('53afffff-0000-4000-8000-000000000001') is false);
select pg_temp.n3a_record('38 active impersonation gets idempotent clear zero',
  public.clear_read_notifications()=0);
reset role;

do $$
declare v_total integer; v_pass integer;
begin
  select count(*),count(*) filter(where passed) into v_total,v_pass
  from public.n3a_catalog_results;
  if v_total<>38 or v_pass<>38 then
    raise exception 'TEST RESULTS %/% FAIL — transaction intentionally rolled back',v_pass,v_total;
  end if;
  raise exception 'TEST RESULTS 38/38 PASS — transaction intentionally rolled back';
end
$$;
```
