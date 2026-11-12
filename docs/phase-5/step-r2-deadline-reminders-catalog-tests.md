# R2 Paste A — deadline-reminder catalog and security boundary

Run this as one paste in the **Dev** SQL Editor with **Run without RLS** enabled.
The final exception is intentional and rolls back every fixture. Expected final
result: `TEST RESULTS 25/25 PASS — transaction intentionally rolled back`. The
finished paste records exactly **25** result rows.

```sql
begin;
set local statement_timeout='120s';

create table r2_catalog_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);
create function pg_temp.r2_catalog_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin
  insert into public.r2_catalog_results(label,passed) values(p_label,p_passed);
end $$;

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  '73a00000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','r2-catalog@test.local','',now(),
  '{}','{}',now(),now()
);
insert into public.users(id,email,full_name,role,committee_id,is_active)
values('73a00000-0000-4000-8000-000000000001','r2-catalog@test.local',
  'R2 Catalog Member','Member',null,true);
select set_config('request.jwt.claims',
  '{"sub":"73a00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if auth.uid() is distinct from '73a00000-0000-4000-8000-000000000001'::uuid then
    raise exception 'R2 catalog impersonation fixture failed.';
  end if;
end $$;
reset role;

select pg_temp.r2_catalog_record('01 both constraints contain all thirteen types',
  2=(select count(*) from pg_catalog.pg_constraint c
    where ((c.conrelid='public.notifications'::regclass
            and c.conname='notifications_type_check')
        or (c.conrelid='ceit_connect_private.push_delivery_queue'::regclass
            and c.conname='push_delivery_queue_notification_type_check'))
      and c.convalidated)
  and 26=(select count(*)
    from pg_catalog.pg_constraint c
    cross join (values
      ('mention'),('heads_up'),('assignment'),('status_change'),('unlock'),
      ('backup_request'),('volunteer_offer'),('leave_requested'),
      ('leave_cancelled'),('leave_approved'),('leave_denied'),
      ('task_due_soon'),('live_operation_prep')
    ) as expected(type_name)
    where ((c.conrelid='public.notifications'::regclass
            and c.conname='notifications_type_check')
        or (c.conrelid='ceit_connect_private.push_delivery_queue'::regclass
            and c.conname='push_delivery_queue_notification_type_check'))
      and c.convalidated
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(c.oid),
        pg_catalog.quote_literal(expected.type_name)
      )>0));

select pg_temp.r2_catalog_record('02 reminder ledger has exact primary key and no foreign keys',
  (select pg_catalog.pg_get_constraintdef(c.oid)=
    'PRIMARY KEY (task_id, reminder_kind, target_at, user_id)'
   from pg_catalog.pg_constraint c
   where c.conrelid='ceit_connect_private.task_deadline_reminder_ledger'::regclass
     and c.contype='p')
  and 0=(select count(*) from pg_catalog.pg_constraint c
    where c.conrelid='ceit_connect_private.task_deadline_reminder_ledger'::regclass
      and c.contype='f'));

select pg_temp.r2_catalog_record('03 ledger records exact kinds and reasons',
  (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'''task_due_soon''')>0
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'''live_operation_prep''')>0
   from pg_catalog.pg_constraint c
   where c.conrelid='ceit_connect_private.task_deadline_reminder_ledger'::regclass
     and c.conname like '%reminder_kind_check')
  and (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'''bootstrap''')>0
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'''sent''')>0
   from pg_catalog.pg_constraint c
   where c.conrelid='ceit_connect_private.task_deadline_reminder_ledger'::regclass
     and c.conname like '%recorded_reason_check'));

select pg_temp.r2_catalog_record('04 private tables have RLS, no application privileges, and safe count checks',
  (select pg_catalog.bool_and(c.relrowsecurity) from pg_catalog.pg_class c
   where c.oid in ('ceit_connect_private.task_deadline_reminder_ledger'::regclass,
     'ceit_connect_private.deadline_reminder_runs'::regclass))
  and not exists (
    select 1
    from (values
      ('anon'::name),
      ('authenticated'::name),
      ('service_role'::name)
    ) as role_row(role_name)
    cross join (values
      ('ceit_connect_private.task_deadline_reminder_ledger'::text),
      ('ceit_connect_private.deadline_reminder_runs'::text)
    ) as table_row(table_name)
    cross join (values
      ('SELECT'::text),
      ('INSERT'::text),
      ('UPDATE'::text),
      ('DELETE'::text),
      ('TRUNCATE'::text),
      ('REFERENCES'::text),
      ('TRIGGER'::text)
    ) as privilege_row(privilege_name)
    where has_table_privilege(
      role_row.role_name,
      table_row.table_name,
      privilege_row.privilege_name
    )
  )
  and (select pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'notifications_created >= 0')>0
      and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid),'10000')=0
    from pg_catalog.pg_constraint c
    where c.conrelid='ceit_connect_private.deadline_reminder_runs'::regclass
      and c.conname='deadline_reminder_runs_notifications_created_check'));

select pg_temp.r2_catalog_record('05 private tables have zero policies',
  0=(select count(*) from pg_catalog.pg_policies p
    where p.schemaname='ceit_connect_private'
      and p.tablename in ('task_deadline_reminder_ledger','deadline_reminder_runs')));

select pg_temp.r2_catalog_record('06 reminder indexes exist with expected predicates',
  pg_catalog.to_regclass('public.tasks_deadline_reminder_due_idx') is not null
  and pg_catalog.to_regclass('public.tasks_live_operation_reminder_call_idx') is not null
  and pg_catalog.to_regclass('ceit_connect_private.task_deadline_reminder_ledger_cleanup_idx') is not null
  and pg_catalog.to_regclass('ceit_connect_private.deadline_reminder_runs_finished_idx') is not null);

select pg_temp.r2_catalog_record('07 constants are private immutable 100 and 30',
  public.deadline_reminder_batch_size()=100
  and public.deadline_reminder_retention_days()=30
  and (select p.provolatile='i' from pg_catalog.pg_proc p
    where p.oid='public.deadline_reminder_batch_size()'::regprocedure)
  and not has_function_privilege('service_role','public.deadline_reminder_batch_size()','EXECUTE'));

select pg_temp.r2_catalog_record('08 bootstrap is hardened postgres-member migration definer',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[]
      and pg_catalog.strpos(pg_get_functiondef(p.oid),
        'pg_catalog.pg_has_role(session_user, ''postgres'', ''MEMBER'')')>0
      and pg_catalog.strpos(pg_get_functiondef(p.oid),
        'raise exception using errcode = ''42501'', message = ''Postgres session required.''')>0)
  and not has_function_privilege('authenticator','ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)','EXECUTE')
  and not has_function_privilege('anon','ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)','EXECUTE')
  and not pg_catalog.pg_has_role('authenticator','postgres','MEMBER')
  and not pg_catalog.pg_has_role('anon','postgres','MEMBER')
  and not pg_catalog.pg_has_role('authenticated','postgres','MEMBER')
  and not pg_catalog.pg_has_role('service_role','postgres','MEMBER'));

select pg_temp.r2_catalog_record('09 bootstrap is idempotent and notification-free',
  (select pg_get_functiondef(p.oid) like '%on conflict (task_id, reminder_kind, target_at, user_id) do nothing%'
      and pg_catalog.strpos(pg_get_functiondef(p.oid),'insert into public.notifications')=0
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.bootstrap_deadline_reminders_at(timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('10 occurrence emitter claims ledger before notification insert',
  (select 0<pg_catalog.strpos(pg_get_functiondef(p.oid),'insert into ceit_connect_private.task_deadline_reminder_ledger')
      and pg_catalog.strpos(pg_get_functiondef(p.oid),'insert into ceit_connect_private.task_deadline_reminder_ledger')
        < pg_catalog.strpos(pg_get_functiondef(p.oid),'insert into public.notifications')
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.emit_deadline_reminder_occurrence(uuid,text,timestamptz,timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('11 occurrence emitter rechecks authoritative state',
  (select pg_get_functiondef(p.oid) like '%event_row.status = ''Active''%'
      and pg_get_functiondef(p.oid) like '%task_row.status <> ''Completed''%'
      and pg_get_functiondef(p.oid) like '%task_row.due_date = p_target_at%'
      and pg_get_functiondef(p.oid) like '%task_row.call_time = p_target_at%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.emit_deadline_reminder_occurrence(uuid,text,timestamptz,timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('12 clock-injected runner is hardened postgres-only definer',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[])
  and not has_function_privilege('authenticated','ceit_connect_private.run_deadline_reminders_at(timestamptz)','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.run_deadline_reminders_at(timestamptz)','EXECUTE'));

select pg_temp.r2_catalog_record('13 public real-clock runner is hardened and ungranted',
  exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
    where p.oid='public.run_deadline_reminders()'::regprocedure
      and r.rolname='postgres' and p.prosecdef and p.provolatile='v'
      and p.proconfig=array['search_path=""']::text[])
  and not has_function_privilege('public','public.run_deadline_reminders()','EXECUTE')
  and not has_function_privilege('anon','public.run_deadline_reminders()','EXECUTE')
  and not has_function_privilege('authenticated','public.run_deadline_reminders()','EXECUTE')
  and not has_function_privilege('service_role','public.run_deadline_reminders()','EXECUTE'));

select pg_temp.r2_catalog_record('14 public runner returns exactly six readable OUT columns',
  (select p.proargnames=array['out_occurrences_handled','out_notifications_created',
    'out_skipped_concurrent','out_ledger_rows_cleaned','out_run_history_rows_cleaned','out_status']
   from pg_catalog.pg_proc p where p.oid='public.run_deadline_reminders()'::regprocedure));

select pg_temp.r2_catalog_record('15 strict runner helpers authorize before work and wrapper delegates',
  (select pg_catalog.strpos(pg_get_functiondef(p.oid),'session_user <> ''postgres''')>0
      and pg_catalog.strpos(pg_get_functiondef(p.oid),'session_user <> ''postgres''')
        < pg_catalog.strpos(pg_get_functiondef(p.oid),'pg_try_advisory_xact_lock')
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure)
  and not exists (
    select 1
    from (values
      ('ceit_connect_private.emit_deadline_reminder_occurrence(uuid,text,timestamptz,timestamptz)'::regprocedure),
      ('ceit_connect_private.purge_deadline_reminder_ledger(timestamptz)'::regprocedure),
      ('ceit_connect_private.purge_deadline_reminder_runs(timestamptz,uuid)'::regprocedure),
      ('ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure)
    ) as strict_function(function_oid)
    where pg_catalog.strpos(
      pg_get_functiondef(strict_function.function_oid),
      'session_user <> ''postgres'''
    )=0
  )
  and (select pg_catalog.strpos(pg_get_functiondef(p.oid),
      'ceit_connect_private.run_deadline_reminders_at')>0
    from pg_catalog.pg_proc p
    where p.oid='public.run_deadline_reminders()'::regprocedure));

select pg_temp.r2_catalog_record('16 candidate cap ignores fully-ledgered occurrences',
  (select pg_get_functiondef(p.oid) like '%where exists (%task_deadline_reminder_ledger%limit public.deadline_reminder_batch_size()%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('17 candidates are earliest-target first',
  (select pg_get_functiondef(p.oid) like '%order by occurrence.target_at,%occurrence.reminder_kind,%occurrence.task_id%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('18 exact 24-hour and 2-hour windows are pinned',
  (select pg_get_functiondef(p.oid) like '%due_date > p_as_of%due_date <= p_as_of + interval ''24 hours''%'
      and pg_get_functiondef(p.oid) like '%call_time > p_as_of%call_time <= p_as_of + interval ''2 hours''%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('19 both assignee arrays and active profiles qualify',
  (select pg_get_functiondef(p.oid) like '%occurrence.primary_assignees%occurrence.assist_assignees%'
      and pg_get_functiondef(p.oid) like '%profile.is_active is true%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure));

select pg_temp.r2_catalog_record('20 cleanup is bounded oldest-first skip-locked',
  (select pg_get_functiondef(p.oid) like '%order by ledger_row.target_at,%limit 500%for update skip locked%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.purge_deadline_reminder_ledger(timestamptz)'::regprocedure)
  and (select pg_get_functiondef(p.oid) like '%order by run_row.finished_at, run_row.id%limit 500%for update skip locked%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.purge_deadline_reminder_runs(timestamptz,uuid)'::regprocedure));

select pg_temp.r2_catalog_record('21 insert helper accepts both R2 types and keeps actor filtering',
  (select pg_get_functiondef(p.oid) like '%''task_due_soon''%''live_operation_prep''%'
      and pg_get_functiondef(p.oid) like '%proposed.user_id is distinct from p_actor_id%'
      and pg_get_functiondef(p.oid) like '%profile.is_active is true%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])'::regprocedure));

select pg_temp.r2_catalog_record('22 push claim retains thirteen OUT columns and anon-only execute',
  13=(select count(*) from information_schema.parameters p
    where p.specific_schema='public' and p.specific_name like 'claim_push_deliveries_%'
      and p.parameter_mode='OUT')
  and has_function_privilege('anon','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_push_deliveries(integer)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_push_deliveries(integer)','EXECUTE'));

select pg_temp.r2_catalog_record('23 push claim contains exact generic R2 copy',
  (select pg_get_functiondef(p.oid) like '%when ''task_due_soon'' then ''A task is due soon.''%'
      and pg_get_functiondef(p.oid) like '%when ''live_operation_prep'' then ''A Live Operation call time is soon.''%'
   from pg_catalog.pg_proc p where p.oid='public.claim_push_deliveries(integer)'::regprocedure));

set local role authenticated;
do $$ begin
  begin perform ceit_connect_private.bootstrap_deadline_reminders_at(clock_timestamp());
  exception when insufficient_privilege then
    perform pg_temp.r2_catalog_record('24 browser cannot execute bootstrap',true); return;
  end;
  perform pg_temp.r2_catalog_record('24 browser cannot execute bootstrap',false);
end $$;
reset role;

set local role service_role;
do $$ begin
  begin perform * from public.run_deadline_reminders();
  exception when insufficient_privilege then
    perform pg_temp.r2_catalog_record('25 service role cannot execute runner',true); return;
  end;
  perform pg_temp.r2_catalog_record('25 service role cannot execute runner',false);
end $$;
reset role;

do $$
declare v_total integer; v_failed integer;
begin
  select count(*),count(*) filter(where not passed) into v_total,v_failed
  from public.r2_catalog_results;
  if v_total<>25 or v_failed<>0 then
    raise exception 'TEST RESULTS %/25 FAIL — % failed; transaction intentionally rolled back',v_total-v_failed,v_failed;
  end if;
  raise exception 'TEST RESULTS 25/25 PASS — transaction intentionally rolled back';
end $$;
```
