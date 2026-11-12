# R2 retry follow-up — Dev verification paste

Apply `20261117120000_deadline_reminder_retry_backoff.sql` on **Dev**, then run
this as one paste in the SQL Editor with **Run without RLS** enabled. The final
exception is intentional and rolls back every fixture, trigger, and test row.
Expected final result: `TEST RESULTS 12/12 PASS — transaction intentionally
rolled back`.

```sql
begin;
set local timezone='Asia/Manila';
set local statement_timeout='120s';

create table r2_retry_results(
  ordinal integer generated always as identity,
  label text not null,
  passed boolean not null
);
create function pg_temp.r2_retry_record(p_label text,p_passed boolean)
returns void language plpgsql security definer set search_path=''
as $$ begin insert into public.r2_retry_results(label,passed) values(p_label,p_passed); end $$;

select pg_temp.r2_retry_record('01 retry table is postgres-owned zero-policy RLS',
  (select c.relowner='postgres'::regrole and c.relrowsecurity and not c.relforcerowsecurity
   from pg_catalog.pg_class c
   where c.oid='ceit_connect_private.deadline_reminder_retry_state'::regclass)
  and 0=(select count(*) from pg_catalog.pg_policy
         where polrelid='ceit_connect_private.deadline_reminder_retry_state'::regclass)
  and (select pg_catalog.pg_get_constraintdef(c.oid)=
        'PRIMARY KEY (task_id, reminder_kind, target_at, user_id)'
       from pg_catalog.pg_constraint c
       where c.conrelid='ceit_connect_private.deadline_reminder_retry_state'::regclass
         and c.contype='p'));

select pg_temp.r2_retry_record('02 application roles have no retry-table privilege',
  not has_table_privilege('anon','ceit_connect_private.deadline_reminder_retry_state','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('authenticated','ceit_connect_private.deadline_reminder_retry_state','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  and not has_table_privilege('service_role','ceit_connect_private.deadline_reminder_retry_state','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));

select pg_temp.r2_retry_record('03 retry cleanup is hardened and ungranted',
  (select p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v'
          and p.proconfig=array['search_path=""']::text[]
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)'::regprocedure)
  and not has_function_privilege('anon','ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)','EXECUTE')
  and not has_function_privilege('anon','ceit_connect_private.emit_deadline_reminder_occurrence(uuid,text,timestamptz,uuid,timestamptz)','EXECUTE')
  and not has_function_privilege('authenticated','ceit_connect_private.emit_deadline_reminder_occurrence(uuid,text,timestamptz,uuid,timestamptz)','EXECUTE')
  and not has_function_privilege('service_role','ceit_connect_private.emit_deadline_reminder_occurrence(uuid,text,timestamptz,uuid,timestamptz)','EXECUTE'));

select pg_temp.r2_retry_record('04 latest worker filters retry state before the cap',
  (select pg_get_functiondef(p.oid) like '%retry_row.user_id = proposed.user_id%limit public.deadline_reminder_batch_size()%for v_recipient in%v_recipient_sqlstate%'
   from pg_catalog.pg_proc p
   where p.oid='ceit_connect_private.run_deadline_reminders_at(timestamptz)'::regprocedure));

insert into public.committees(id,name) values
('7400c000-0000-4000-8000-000000000001','R2 Retry Committee');

insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) select fixture.id,'00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated',fixture.email,'',now(),'{}','{}',now(),now()
from (values
 ('74000000-0000-4000-8000-000000000001'::uuid,'r2-retry-admin@test.local'),
 ('74000000-0000-4000-8000-000000000002'::uuid,'r2-retry-member@test.local'),
 ('74000000-0000-4000-8000-000000000003'::uuid,'r2-retry-new-member@test.local')
) fixture(id,email);

select set_config('ceit_connect.officer_writer','invite_new_officer',true);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
('74000000-0000-4000-8000-000000000001','r2-retry-admin@test.local','R2 Retry Admin','Admin',null,true),
('74000000-0000-4000-8000-000000000002','r2-retry-member@test.local','R2 Retry Member','Member','7400c000-0000-4000-8000-000000000001',true),
('74000000-0000-4000-8000-000000000003','r2-retry-new-member@test.local','R2 Retry New Member','Member','7400c000-0000-4000-8000-000000000001',true);
select set_config('ceit_connect.officer_writer','',true);

insert into public.events(id,name,start_date,end_date,status,created_by) values
('74002000-0000-4000-8000-000000000001','R2 Retry Event','2026-11-01','2027-12-31','Active','74000000-0000-4000-8000-000000000001');

-- Silence every pre-existing Dev occurrence at the controlled clock before
-- inserting this paste's fixtures, so the global scanner is deterministic.
select ceit_connect_private.bootstrap_deadline_reminders_at('2026-11-20 00:00+00');
select set_config('request.jwt.claims','{"sub":"74000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true);
select set_config('ceit_connect.task_access_writer','create_active_event_task',true);
insert into public.tasks(id,event_id,committee_id,title,phase,status,task_type,due_date,
  primary_assignees,assist_assignees,is_confidential,request_backup) values
('74003000-0000-4000-8000-000000000001','74002000-0000-4000-8000-000000000001','7400c000-0000-4000-8000-000000000001','R2 forced failure','R2','To Do','Deliverable','2026-11-20 12:00+00',array['74000000-0000-4000-8000-000000000002'::uuid],array['74000000-0000-4000-8000-000000000003'::uuid],false,false),
('74003000-0000-4000-8000-000000000002','74002000-0000-4000-8000-000000000001','7400c000-0000-4000-8000-000000000001','R2 healthy later','R2','To Do','Deliverable','2026-11-20 12:01+00',array['74000000-0000-4000-8000-000000000002'::uuid],'{}',false,false),
('74003000-0000-4000-8000-000000000003','74002000-0000-4000-8000-000000000001','7400c000-0000-4000-8000-000000000001','R2 exhausted','R2','To Do','Deliverable','2026-11-20 12:02+00',array['74000000-0000-4000-8000-000000000002'::uuid],'{}',false,false);
select set_config('ceit_connect.task_assignee_writer','',true);
select set_config('ceit_connect.task_access_writer','',true);
delete from public.notifications where task_id::text like '74003%';

create function pg_temp.r2_force_notification_failure()
returns trigger language plpgsql set search_path=''
as $$ begin
  if new.task_id in (
       '74003000-0000-4000-8000-000000000001'::uuid,
       '74003000-0000-4000-8000-000000000003'::uuid
     )
     and new.user_id='74000000-0000-4000-8000-000000000002'::uuid
     and new.type='task_due_soon' then
    raise exception using errcode='P0001',message='Forced R2 retry test failure.';
  end if;
  return new;
end $$;
create trigger r2_force_notification_failure
before insert on public.notifications for each row
execute function pg_temp.r2_force_notification_failure();

create table r2_retry_first_run as
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:00+00');
select pg_temp.r2_retry_record('05 one recipient failure does not block a healthy recipient or later occurrence',
  (select out_status='Completed with failures.' and out_notifications_created>=1
   from r2_retry_first_run)
  and exists(select 1 from public.notifications
             where task_id='74003000-0000-4000-8000-000000000001'
               and user_id='74000000-0000-4000-8000-000000000003'
               and type='task_due_soon')
  and exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
             where task_id='74003000-0000-4000-8000-000000000001'
               and user_id='74000000-0000-4000-8000-000000000003'
               and reminder_kind='task_due_soon')
  and exists(select 1 from public.notifications
             where task_id='74003000-0000-4000-8000-000000000002'
               and type='task_due_soon'));
select pg_temp.r2_retry_record('06 failed occurrence is not marked sent',
  not exists(select 1 from public.notifications
             where task_id='74003000-0000-4000-8000-000000000001'
               and user_id='74000000-0000-4000-8000-000000000002')
  and not exists(select 1 from ceit_connect_private.task_deadline_reminder_ledger
                 where task_id='74003000-0000-4000-8000-000000000001'
                   and user_id='74000000-0000-4000-8000-000000000002'));
select pg_temp.r2_retry_record('07 caught failure persists a 15-minute retry outside the exception',
  exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
         where task_id='74003000-0000-4000-8000-000000000001'
           and reminder_kind='task_due_soon' and failure_count=1
           and last_failed_at='2026-11-20 00:00+00'
           and next_retry_at='2026-11-20 00:15+00'
           and last_error_sqlstate='P0001'));

select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:05+00');
select pg_temp.r2_retry_record('08 occurrence is skipped before its retry instant',
  not exists(select 1 from public.notifications
             where task_id='74003000-0000-4000-8000-000000000001'
               and user_id='74000000-0000-4000-8000-000000000002')
  and exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
             where task_id='74003000-0000-4000-8000-000000000001'
               and user_id='74000000-0000-4000-8000-000000000002'
               and failure_count=1));

select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:15+00');
select pg_temp.r2_retry_record('09 conflict update increments failure and lengthens backoff',
  exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
         where task_id='74003000-0000-4000-8000-000000000001'
           and user_id='74000000-0000-4000-8000-000000000002'
           and failure_count=2
           and last_failed_at='2026-11-20 00:15+00'
           and next_retry_at='2026-11-20 00:45+00')
  and exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
         where task_id='74003000-0000-4000-8000-000000000003'
           and user_id='74000000-0000-4000-8000-000000000002'
           and failure_count=2
           and next_retry_at='2026-11-20 00:45+00'));

create or replace function pg_temp.r2_force_notification_failure()
returns trigger language plpgsql set search_path=''
as $$ begin
  if new.task_id='74003000-0000-4000-8000-000000000003'::uuid
     and new.user_id='74000000-0000-4000-8000-000000000002'::uuid
     and new.type='task_due_soon' then
    raise exception using errcode='P0001',message='Forced R2 retry test failure.';
  end if;
  return new;
end $$;

select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 00:45+00');
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 01:45+00');
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 03:45+00');
select set_config('ceit_connect.task_assignee_writer','edit_active_event_task',true);
update public.tasks
set assist_assignees=array['74000000-0000-4000-8000-000000000003'::uuid]
where id='74003000-0000-4000-8000-000000000003';
select set_config('ceit_connect.task_assignee_writer','',true);
select * from ceit_connect_private.run_deadline_reminders_at('2026-11-20 03:45+00');
select pg_temp.r2_retry_record('10 repeated failures cap one recipient while a new assignee still receives',
  exists(select 1 from public.notifications
         where task_id='74003000-0000-4000-8000-000000000001'
           and user_id='74000000-0000-4000-8000-000000000002'
           and type='task_due_soon')
  and not exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
                 where task_id='74003000-0000-4000-8000-000000000001')
  and exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
             where task_id='74003000-0000-4000-8000-000000000003'
               and user_id='74000000-0000-4000-8000-000000000002'
               and failure_count=5
               and next_retry_at='2026-11-20 12:02+00')
  and not exists(select 1 from public.notifications
                 where task_id='74003000-0000-4000-8000-000000000003'
                   and user_id='74000000-0000-4000-8000-000000000002')
  and exists(select 1 from public.notifications
             where task_id='74003000-0000-4000-8000-000000000003'
               and user_id='74000000-0000-4000-8000-000000000003'
               and type='task_due_soon'));

drop trigger r2_force_notification_failure on public.notifications;

insert into ceit_connect_private.deadline_reminder_retry_state(
  task_id,reminder_kind,target_at,user_id,failure_count,next_retry_at,last_failed_at,last_error_sqlstate
) values (
  '74003fff-0000-4000-8000-000000000001','task_due_soon','2026-09-01 00:00+00',
  '74000000-0000-4000-8000-000000000002',1,
  '2026-09-01 00:00+00','2026-08-31 23:45+00','P0001'
);
select set_config('r2.retry_rows_cleaned',
  ceit_connect_private.purge_deadline_reminder_retry_state('2026-11-20 00:15+00')::text,true);
select pg_temp.r2_retry_record('11 old retry state is cleaned by the bounded helper',
  current_setting('r2.retry_rows_cleaned')::integer>=1
  and not exists(select 1 from ceit_connect_private.deadline_reminder_retry_state
                 where task_id='74003fff-0000-4000-8000-000000000001'));

select pg_temp.r2_retry_record('12 public runner shape and service-role denial are unchanged',
  pg_get_function_result('public.run_deadline_reminders()'::regprocedure) like 'TABLE(out_occurrences_handled integer, out_notifications_created integer, out_skipped_concurrent boolean, out_ledger_rows_cleaned integer, out_run_history_rows_cleaned integer, out_status text)'
  and not has_function_privilege('service_role','public.run_deadline_reminders()','EXECUTE')
  and (select pg_get_functiondef(p.oid) like
        '%v_previous_live_clock%exception when others then%reset ceit_connect.deadline_reminder_live_clock%'
       from pg_catalog.pg_proc p
       where p.oid='public.run_deadline_reminders()'::regprocedure));

do $$
declare v_total integer; v_failed integer; v_failed_labels text;
begin
  select count(*),count(*) filter(where not passed),
    string_agg(label,'; ' order by ordinal) filter(where not passed)
  into v_total,v_failed,v_failed_labels from public.r2_retry_results;
  if v_total<>12 or v_failed<>0 then
    raise exception 'TEST RESULTS %/12 FAIL — % failed: %; transaction intentionally rolled back',
      v_total-v_failed,v_failed,coalesce(v_failed_labels,'unexpected result-row count');
  end if;
  raise exception 'TEST RESULTS 12/12 PASS — transaction intentionally rolled back';
end $$;
```
