# N1 Paste A: notification catalog and security boundary

Run this one self-contained paste in the **Dev SQL Editor** only, with
**Run without RLS** enabled (postgres),
after reviewing and applying `20261110120000_notification_foundation.sql`.
It creates its own Auth/profile fixture and impersonates that browser user. It
records exactly **30** result rows and intentionally aborts the transaction.

Expected sentinel:

`TEST RESULTS 30/30 PASS — transaction intentionally rolled back`

```sql
begin;
set local statement_timeout='120s';

create table n1_catalog_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '51a00000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','n1-catalog-admin@test.local','',now(),
  '{}','{}',now(),now()
);
select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values(
  '51a00000-0000-4000-8000-000000000001',
  'n1-catalog-admin@test.local','N1 Catalog Admin','Admin',null,true
);
select set_config('ceit_connect.officer_writer','',true);
select set_config(
  'request.jwt.claims',
  '{"sub":"51a00000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
do $$
begin
  if auth.uid() is distinct from '51a00000-0000-4000-8000-000000000001'::uuid
     or (select count(*) from public.notifications) <> 0 then
    raise exception 'N1 catalog impersonation fixture failed.';
  end if;
end
$$;
reset role;

insert into n1_catalog_results(label,passed)
select '01 authenticated keeps SELECT only',
  has_table_privilege('authenticated','public.notifications','SELECT')
  and not has_table_privilege('authenticated','public.notifications','INSERT')
  and not has_table_privilege('authenticated','public.notifications','UPDATE')
  and not has_table_privilege('authenticated','public.notifications','DELETE')
  and not has_table_privilege('authenticated','public.notifications','TRUNCATE')
  and not has_table_privilege('authenticated','public.notifications','REFERENCES')
  and not has_table_privilege('authenticated','public.notifications','TRIGGER');

insert into n1_catalog_results(label,passed)
select '02 notifications RLS remains enabled',relrowsecurity
from pg_catalog.pg_class where oid='public.notifications'::regclass;

insert into n1_catalog_results(label,passed)
select '03 select policy is active owner only',
  cmd='SELECT' and roles='{authenticated}'
  and qual like '%user_id = auth.uid()%'
  and qual like '%my_role() IS NOT NULL%'
from pg_catalog.pg_policies
where schemaname='public' and tablename='notifications'
  and policyname='notifications_select_own';

insert into n1_catalog_results(label,passed)
select '04 update policy fails closed',
  cmd='UPDATE' and roles='{authenticated}' and qual='false' and with_check='false'
from pg_catalog.pg_policies
where schemaname='public' and tablename='notifications'
  and policyname='notifications_update_own';

insert into n1_catalog_results(label,passed)
select '05 exactly two notification policies',count(*)=2
from pg_catalog.pg_policies
where schemaname='public' and tablename='notifications';

insert into n1_catalog_results(label,passed)
select '06 paging index exact',
  pg_get_indexdef(indexrelid) like '%(user_id, created_at DESC, id DESC)%'
from pg_catalog.pg_index
where indexrelid='public.notifications_user_page_idx'::regclass;

insert into n1_catalog_results(label,passed)
select '07 unread index is partial',
  pg_get_expr(indpred,indrelid)='(read_at IS NULL)'
from pg_catalog.pg_index
where indexrelid='public.notifications_user_unread_idx'::regclass;

insert into n1_catalog_results(label,passed)
select '08 Realtime publication covers notifications',
  publication.puballtables or exists(
    select 1 from pg_catalog.pg_publication_tables publication_table
    where publication_table.pubname=publication.pubname
      and publication_table.schemaname='public'
      and publication_table.tablename='notifications'
  )
from pg_catalog.pg_publication publication
where publication.pubname='supabase_realtime';

insert into n1_catalog_results(label,passed)
select '09 suppression context exact columns',
  array_agg(column_name::text order by ordinal_position)=
    array['transaction_id','task_id']::text[]
from information_schema.columns
where table_schema='ceit_connect_private'
  and table_name='notification_suppression_context';

insert into n1_catalog_results(label,passed)
select '10 suppression context private RLS',class_row.relrowsecurity
  and not has_table_privilege('anon',class_row.oid,'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated',class_row.oid,'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role',class_row.oid,'SELECT,INSERT,UPDATE,DELETE')
from pg_catalog.pg_class class_row
where class_row.oid='ceit_connect_private.notification_suppression_context'::regclass;

insert into n1_catalog_results(label,passed)
select '11 suppression context has no FK',not exists(
  select 1 from pg_catalog.pg_constraint
  where conrelid='ceit_connect_private.notification_suppression_context'::regclass
    and contype='f'
);

insert into n1_catalog_results(label,passed)
select '12 private function signatures exact',count(*)=7
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='ceit_connect_private'
  and procedure.proname=any(array[
    'insert_notifications','suppress_approved_leave_notifications',
    'notify_task_change','notify_event_launch','notify_task_comment',
    'notification_unread_count_for_user','list_notifications_for_user'
  ]);

insert into n1_catalog_results(label,passed)
select '13 private functions postgres definer empty path',count(*)=7
from pg_catalog.pg_proc procedure
where procedure.oid=any(array[
  'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure,
  'ceit_connect_private.suppress_approved_leave_notifications()'::regprocedure,
  'ceit_connect_private.notify_task_change()'::regprocedure,
  'ceit_connect_private.notify_event_launch()'::regprocedure,
  'ceit_connect_private.notify_task_comment()'::regprocedure,
  'ceit_connect_private.notification_unread_count_for_user(uuid)'::regprocedure,
  'ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)'::regprocedure
]) and pg_get_userbyid(procedure.proowner)='postgres'
  and procedure.prosecdef and procedure.proconfig=array['search_path=""'];

insert into n1_catalog_results(label,passed)
select '14 private functions have no app execute',count(*)=7
from pg_catalog.pg_proc procedure
where procedure.oid=any(array[
  'ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure,
  'ceit_connect_private.suppress_approved_leave_notifications()'::regprocedure,
  'ceit_connect_private.notify_task_change()'::regprocedure,
  'ceit_connect_private.notify_event_launch()'::regprocedure,
  'ceit_connect_private.notify_task_comment()'::regprocedure,
  'ceit_connect_private.notification_unread_count_for_user(uuid)'::regprocedure,
  'ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)'::regprocedure
]) and not has_function_privilege('anon',procedure.oid,'EXECUTE')
  and not has_function_privilege('authenticated',procedure.oid,'EXECUTE')
  and not has_function_privilege('service_role',procedure.oid,'EXECUTE');

insert into n1_catalog_results(label,passed)
select '15 public function signatures exact',count(*)=4
from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
where namespace.nspname='public'
  and procedure.proname=any(array[
    'get_notification_unread_count','list_notifications',
    'mark_notification_read','mark_all_notifications_read'
  ]);

insert into n1_catalog_results(label,passed)
select '16 public functions postgres definer empty path',count(*)=4
from pg_catalog.pg_proc procedure
where procedure.oid=any(array[
  'public.get_notification_unread_count()'::regprocedure,
  'public.list_notifications(integer,timestamptz,uuid)'::regprocedure,
  'public.mark_notification_read(uuid)'::regprocedure,
  'public.mark_all_notifications_read()'::regprocedure
]) and pg_get_userbyid(procedure.proowner)='postgres'
  and procedure.prosecdef and procedure.proconfig=array['search_path=""'];

insert into n1_catalog_results(label,passed)
select '17 public functions authenticated only',count(*)=4
from pg_catalog.pg_proc procedure
where procedure.oid=any(array[
  'public.get_notification_unread_count()'::regprocedure,
  'public.list_notifications(integer,timestamptz,uuid)'::regprocedure,
  'public.mark_notification_read(uuid)'::regprocedure,
  'public.mark_all_notifications_read()'::regprocedure
]) and has_function_privilege('authenticated',procedure.oid,'EXECUTE')
  and not has_function_privilege('anon',procedure.oid,'EXECUTE')
  and not has_function_privilege('service_role',procedure.oid,'EXECUTE')
  and not exists(select 1 from pg_catalog.aclexplode(coalesce(procedure.proacl,acldefault('f',procedure.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE');

insert into n1_catalog_results(label,passed)
select '18 public readers are stable',count(*)=2
from pg_catalog.pg_proc procedure
where procedure.oid=any(array[
  'public.get_notification_unread_count()'::regprocedure,
  'public.list_notifications(integer,timestamptz,uuid)'::regprocedure
]) and procedure.provolatile='s';

insert into n1_catalog_results(label,passed)
select '19 public mutations are volatile',count(*)=2
from pg_catalog.pg_proc procedure
where procedure.oid=any(array[
  'public.mark_notification_read(uuid)'::regprocedure,
  'public.mark_all_notifications_read()'::regprocedure
]) and procedure.provolatile='v';

insert into n1_catalog_results(label,passed)
select '20 unread public reader delegates after auth',
  position('profile.is_active is true' in lower(prosrc))>0
  and position('profile.is_active is true' in lower(prosrc))
    < position('notification_unread_count_for_user' in lower(prosrc))
from pg_catalog.pg_proc where oid='public.get_notification_unread_count()'::regprocedure;

insert into n1_catalog_results(label,passed)
select '21 list public reader delegates after auth',
  position('profile.is_active is true' in lower(prosrc))>0
  and position('profile.is_active is true' in lower(prosrc))
    < position('list_notifications_for_user' in lower(prosrc))
  and (
    select position(
      'when notification_row.content_access = ''hidden'' then null::uuid'
      in lower(private_reader.prosrc)
    )>0
    from pg_catalog.pg_proc private_reader
    where private_reader.oid=
      'ceit_connect_private.list_notifications_for_user(uuid,integer,timestamptz,uuid)'::regprocedure
  )
from pg_catalog.pg_proc where oid='public.list_notifications(integer,timestamptz,uuid)'::regprocedure;

insert into n1_catalog_results(label,passed)
select '22 mark one authorizes before update',
  position('profile.is_active is true' in lower(prosrc))
    < position('update public.notifications as notification_row' in lower(prosrc))
from pg_catalog.pg_proc where oid='public.mark_notification_read(uuid)'::regprocedure;

insert into n1_catalog_results(label,passed)
select '23 mark all authorizes before update',
  position('profile.is_active is true' in lower(prosrc))
    < position('update public.notifications as notification_row' in lower(prosrc))
from pg_catalog.pg_proc where oid='public.mark_all_notifications_read()'::regprocedure;

insert into n1_catalog_results(label,passed)
select '24 task trigger attached once',count(*)=1
from pg_catalog.pg_trigger where tgrelid='public.tasks'::regclass
  and tgname='tasks_z8_notifications' and not tgisinternal and tgenabled='O';

insert into n1_catalog_results(label,passed)
select '25 event launch trigger attached once',count(*)=1
from pg_catalog.pg_trigger where tgrelid='public.events'::regclass
  and tgname='events_z8_notification_launch' and not tgisinternal and tgenabled='O';

insert into n1_catalog_results(label,passed)
select '26 comment trigger attached once',count(*)=1
from pg_catalog.pg_trigger where tgrelid='public.task_comments'::regclass
  and tgname='task_comments_z8_notifications' and not tgisinternal and tgenabled='O';

insert into n1_catalog_results(label,passed)
select '27 leave suppression trigger attached once and consumes before lifecycle return',
  count(*)=1
  and (
    select position(
      'delete from ceit_connect_private.notification_suppression_context'
      in lower(task_trigger.prosrc)
    ) < position('select event_row.status' in lower(task_trigger.prosrc))
    from pg_catalog.pg_proc task_trigger
    where task_trigger.oid='ceit_connect_private.notify_task_change()'::regprocedure
  )
from pg_catalog.pg_trigger where tgrelid='public.task_leave_requests'::regclass
  and tgname='task_leave_requests_z8_notification_suppression'
  and not tgisinternal and tgenabled='O';

insert into n1_catalog_results(label,passed)
select '28 leave suppression precedes activity trigger',
  'task_leave_requests_z8_notification_suppression'<'task_leave_requests_z9_activity_log';

insert into n1_catalog_results(label,passed)
select '29 latest content helper blocks browser execute',
  not has_function_privilege('anon','public.task_content_access_for_user(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.task_content_access_for_user(uuid,uuid)','EXECUTE')
  and not exists(
    select 1
    from pg_catalog.aclexplode(
      coalesce(procedure.proacl,acldefault('f',procedure.proowner))
    ) as acl
    where acl.grantee=0 and acl.privilege_type='EXECUTE'
  )
from pg_catalog.pg_proc as procedure
where procedure.oid='public.task_content_access_for_user(uuid,uuid)'::regprocedure;

insert into n1_catalog_results(label,passed)
select '30 existing notification FK remains CCE09 inventoried',exists(
  select 1 from ceit_connect_private.event_delete_fk_lock_list
  where constraint_name='notifications_task_id_fkey'
    and referencing_schema='public' and referencing_table='notifications'
    and referenced_table='tasks' and lock_kind='task_child_rows'
    and lock_order=70
);

do $$
declare v_bad text; v_count integer;
begin
  select count(*),string_agg(ordinal||' '||label,', ' order by ordinal) filter(where not passed)
  into v_count,v_bad from n1_catalog_results;
  if v_count<>30 or v_bad is not null then
    raise exception 'TEST FAILURES: %',coalesce(v_bad,'wrong result count');
  end if;
  raise exception 'TEST RESULTS 30/30 PASS — transaction intentionally rolled back';
end
```

