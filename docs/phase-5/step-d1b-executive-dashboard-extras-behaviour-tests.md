# D1b Executive Dashboard extras behaviour test

Run this single paste on **Dev only** in the Supabase SQL Editor with
**Run without RLS**. It creates ordinary rollback-only fixture/result tables
and helper functions, not temporary tables. Its `auth.users`, profile,
committee, event, task, approval, and push fixtures are self-contained.

The finished paste has **57 result rows**. Its success sentinel is
`TEST RESULTS 57/57 PASS — transaction intentionally rolled back`.

Every false negative is observable: denial checks fail on success or a changed
error; privacy checks fail on any secret/person/task-ID leak; exclusion checks
fail when the protected row changes a count; ordering/cap checks fail on a
wrong, duplicate, or extra row; and reconciliation checks fail on either side
of each independently computed equality.

```sql
begin;

create table public.d1b_behaviour_test_results (
  ordinal integer primary key,
  label text not null unique,
  passed boolean not null,
  detail text not null
);

grant select, insert on public.d1b_behaviour_test_results
to anon, authenticated, service_role;

create function public.d1b_behaviour_record(
  p_ordinal integer,
  p_label text,
  p_passed boolean,
  p_detail text
)
returns void
language sql
set search_path = ''
as $$
  insert into public.d1b_behaviour_test_results(ordinal, label, passed, detail)
  values (p_ordinal, p_label, coalesce(p_passed, false), coalesce(p_detail, 'null'))
$$;

create function public.d1b_behaviour_expect_denied(
  p_ordinal integer,
  p_label text,
  p_sql text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
    perform public.d1b_behaviour_record(
      p_ordinal, p_label, false, 'call unexpectedly succeeded'
    );
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      perform public.d1b_behaviour_record(
        p_ordinal,
        p_label,
        v_state = '42501'
          and v_message = 'Executive Dashboard access denied.',
        v_state || ': ' || v_message
      );
  end;
end;
$$;

create function public.d1b_behaviour_expected_push_adoption()
returns table(
  out_active_profiles_with_push_count bigint,
  out_active_profile_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pg_catalog.count(*) filter (
      where profile.is_active
        and exists (
          select 1
          from public.push_subscriptions as subscription
          where subscription.user_id = profile.id
            and (
              subscription.expires_at is null
              or subscription.expires_at > pg_catalog.statement_timestamp()
            )
        )
    )::bigint,
    pg_catalog.count(*) filter (where profile.is_active)::bigint
  from public.users as profile
$$;

alter function public.d1b_behaviour_record(integer, text, boolean, text)
owner to postgres;
alter function public.d1b_behaviour_expect_denied(integer, text, text)
owner to postgres;
alter function public.d1b_behaviour_expected_push_adoption()
owner to postgres;
revoke all on function public.d1b_behaviour_record(integer, text, boolean, text)
from public, anon, authenticated, service_role;
revoke all on function public.d1b_behaviour_expect_denied(integer, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.d1b_behaviour_expected_push_adoption()
from public, anon, authenticated, service_role;
grant execute on function public.d1b_behaviour_record(integer, text, boolean, text)
to anon, authenticated, service_role;
grant execute on function public.d1b_behaviour_expect_denied(integer, text, text)
to anon, authenticated, service_role;
grant execute on function public.d1b_behaviour_expected_push_adoption()
to authenticated;

set local session_replication_role = replica;

insert into public.committees(id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'D1b Alpha'),
  ('e1000000-0000-4000-8000-000000000002', 'D1b Beta'),
  ('e1000000-0000-4000-8000-000000000003', 'D1b Cap'),
  ('e1000000-0000-4000-8000-000000000004', 'D1b Empty No Co-Admin');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000001','authenticated','authenticated','d1b-admin@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000002','authenticated','authenticated','d1b-coadmin@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000003','authenticated','authenticated','d1b-two@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000004','authenticated','authenticated','d1b-three@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000005','authenticated','authenticated','d1b-zero@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000006','authenticated','authenticated','d1b-inactive@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000007','authenticated','authenticated','d1b-beta-coadmin@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000008','authenticated','authenticated','d1b-beta-member@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000009','authenticated','authenticated','d1b-volunteer@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000010','authenticated','authenticated','d1b-profileless@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000','e1100000-0000-4000-8000-000000000011','authenticated','authenticated','d1b-inactive-coadmin@example.invalid','',pg_catalog.now(),pg_catalog.now(),pg_catalog.now());

insert into public.users(
  id, email, full_name, role, committee_id, is_active, avatar_url
) values
  ('e1100000-0000-4000-8000-000000000001','d1b-admin@example.invalid','D1b Admin','Admin',null,true,null),
  ('e1100000-0000-4000-8000-000000000002','d1b-coadmin@example.invalid','Able Co-Admin','Co-Admin','e1000000-0000-4000-8000-000000000001',true,null),
  ('e1100000-0000-4000-8000-000000000003','d1b-two@example.invalid','Bravo Exactly Two','Member','e1000000-0000-4000-8000-000000000001',true,null),
  ('e1100000-0000-4000-8000-000000000004','d1b-three@example.invalid','Charlie Exactly Three','Member','e1000000-0000-4000-8000-000000000001',true,null),
  ('e1100000-0000-4000-8000-000000000005','d1b-zero@example.invalid','Delta Zero','Member','e1000000-0000-4000-8000-000000000001',true,null),
  ('e1100000-0000-4000-8000-000000000006','d1b-inactive@example.invalid','Echo Inactive','Member','e1000000-0000-4000-8000-000000000001',false,null),
  ('e1100000-0000-4000-8000-000000000007','d1b-beta-coadmin@example.invalid','Foxtrot Beta Co-Admin','Co-Admin','e1000000-0000-4000-8000-000000000002',true,null),
  ('e1100000-0000-4000-8000-000000000008','d1b-beta-member@example.invalid','Golf Beta Member','Member','e1000000-0000-4000-8000-000000000002',true,null),
  ('e1100000-0000-4000-8000-000000000009','d1b-volunteer@example.invalid','Hotel Volunteer','Member','e1000000-0000-4000-8000-000000000001',true,null),
  ('e1100000-0000-4000-8000-000000000011','d1b-inactive-coadmin@example.invalid','India Inactive Co-Admin','Co-Admin','e1000000-0000-4000-8000-000000000001',false,null);

insert into public.events(
  id, name, start_date, end_date, status, created_by,
  archived_unfinished_task_count
) values
  ('e1200000-0000-4000-8000-000000000001','D1b Active','2026-01-01','2035-12-31','Active','e1100000-0000-4000-8000-000000000001',null),
  ('e1200000-0000-4000-8000-000000000002','D1b Draft','2026-01-01','2035-12-31','Draft','e1100000-0000-4000-8000-000000000001',null),
  ('e1200000-0000-4000-8000-000000000003','D1b Archived','2025-01-01','2025-12-31','Archived','e1100000-0000-4000-8000-000000000001',1);

insert into public.tasks(
  id, event_id, committee_id, title, description, status, due_date,
  primary_assignees, assist_assignees, is_confidential, request_backup,
  created_by, sort_order, created_at
) values
  ('e1300000-0000-4000-8000-000000000001','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha overdue','ordinary','To Do',statement_timestamp()-interval '10 minutes',array['e1100000-0000-4000-8000-000000000003']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',1024,statement_timestamp()-interval '20 days'),
  ('e1300000-0000-4000-8000-000000000002','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha due soon','ordinary','In Progress',statement_timestamp()+interval '10 minutes',array['e1100000-0000-4000-8000-000000000004']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',2048,statement_timestamp()-interval '19 days'),
  ('e1300000-0000-4000-8000-000000000003','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha at risk','ordinary','To Do',statement_timestamp()+interval '36 hours',array['e1100000-0000-4000-8000-000000000004']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',3072,statement_timestamp()-interval '18 days'),
  ('e1300000-0000-4000-8000-000000000004','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha later','ordinary','To Do',statement_timestamp()+interval '72 hours',array['e1100000-0000-4000-8000-000000000004']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',4096,statement_timestamp()-interval '17 days'),
  ('e1300000-0000-4000-8000-000000000005','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha no deadline','ordinary','In Progress',null,array['e1100000-0000-4000-8000-000000000002']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',5120,statement_timestamp()-interval '16 days'),
  ('e1300000-0000-4000-8000-000000000006','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha completed','ordinary','Completed',statement_timestamp()-interval '1 day',array['e1100000-0000-4000-8000-000000000003']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',6144,statement_timestamp()-interval '15 days'),
  ('e1300000-0000-4000-8000-000000000007','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha unassigned','ordinary','To Do',statement_timestamp()+interval '72 hours','{}'::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',7168,statement_timestamp()-interval '14 days'),
  ('e1300000-0000-4000-8000-000000000008','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha needs owner','ordinary','To Do',statement_timestamp()+interval '96 hours',array['e1100000-0000-4000-8000-000000000006']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',8192,statement_timestamp()-interval '13 days'),
  ('e1300000-0000-4000-8000-000000000009','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Alpha help wanted','ordinary','To Do',statement_timestamp()+interval '72 hours',array['e1100000-0000-4000-8000-000000000001']::uuid[],'{}'::uuid[],false,true,'e1100000-0000-4000-8000-000000000001',9216,statement_timestamp()-interval '12 days'),
  ('e1300000-0000-4000-8000-000000000010','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','TOP SECRET TASK','TOP SECRET DESCRIPTION','To Do',statement_timestamp()-interval '20 minutes',array['e1100000-0000-4000-8000-000000000001']::uuid[],'{}'::uuid[],true,false,'e1100000-0000-4000-8000-000000000001',10240,statement_timestamp()-interval '11 days'),
  ('e1300000-0000-4000-8000-000000000011','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002','Beta cross-scope assignment','ordinary','To Do',statement_timestamp()+interval '72 hours',array['e1100000-0000-4000-8000-000000000003']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',11264,statement_timestamp()-interval '10 days'),
  ('e1300000-0000-4000-8000-000000000012','e1200000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','Draft ignored','ordinary','To Do',statement_timestamp()-interval '1 day','{}'::uuid[],'{}'::uuid[],false,true,'e1100000-0000-4000-8000-000000000001',12288,statement_timestamp()-interval '9 days'),
  ('e1300000-0000-4000-8000-000000000013','e1200000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','Archived ignored','ordinary','To Do',statement_timestamp()-interval '1 day','{}'::uuid[],'{}'::uuid[],false,true,'e1100000-0000-4000-8000-000000000001',13312,statement_timestamp()-interval '8 days'),
  ('e1300000-0000-4000-8000-000000000014','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Earlier today Manila','ordinary','To Do',((statement_timestamp() at time zone 'Asia/Manila')::date::timestamp at time zone 'Asia/Manila'),array['e1100000-0000-4000-8000-000000000001']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',14336,statement_timestamp()-interval '7 days'),
  ('e1300000-0000-4000-8000-000000000015','e1200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Tomorrow Manila','ordinary','To Do',(((statement_timestamp() at time zone 'Asia/Manila')::date+1)::timestamp+interval '12 hours') at time zone 'Asia/Manila',array['e1100000-0000-4000-8000-000000000001']::uuid[],'{}'::uuid[],false,false,'e1100000-0000-4000-8000-000000000001',15360,statement_timestamp()-interval '6 days');

insert into public.tasks(
  id, event_id, committee_id, title, status, due_date,
  primary_assignees, assist_assignees, is_confidential, request_backup,
  created_by, sort_order, created_at
)
select
  ('e3300000-0000-4000-8000-' || pg_catalog.lpad(series_row.i::text, 12, '0'))::uuid,
  'e1200000-0000-4000-8000-000000000001'::uuid,
  'e1000000-0000-4000-8000-000000000003'::uuid,
  'Cap candidate ' || series_row.i,
  'To Do',
  statement_timestamp() - interval '2 days' + series_row.i * interval '1 minute',
  '{}'::uuid[], '{}'::uuid[], false, false,
  'e1100000-0000-4000-8000-000000000001'::uuid,
  series_row.i * 1024,
  statement_timestamp() - interval '30 days' + series_row.i * interval '1 second'
from pg_catalog.generate_series(1, 22) as series_row(i);

insert into public.task_leave_requests(
  id, task_id, requester_id, status, created_at
) values
  ('e1400000-0000-4000-8000-000000000001','e1300000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000003','pending',statement_timestamp()-interval '5 days'),
  ('e1400000-0000-4000-8000-000000000002','e1300000-0000-4000-8000-000000000007','e1100000-0000-4000-8000-000000000003','pending',statement_timestamp()-interval '4 days'),
  ('e1400000-0000-4000-8000-000000000003','e1300000-0000-4000-8000-000000000010','e1100000-0000-4000-8000-000000000001','pending',statement_timestamp()-interval '3 days');

insert into public.task_volunteers(task_id, user_id, created_at) values
  ('e1300000-0000-4000-8000-000000000009','e1100000-0000-4000-8000-000000000009',statement_timestamp()-interval '2 days'),
  ('e1300000-0000-4000-8000-000000000009','e1100000-0000-4000-8000-000000000006',statement_timestamp()-interval '1 day');

insert into public.push_subscriptions(
  id, user_id, endpoint, endpoint_hash, p256dh, auth_secret,
  device_label, platform, expires_at
) values
  ('e1500000-0000-4000-8000-000000000001','e1100000-0000-4000-8000-000000000001','https://push.example.invalid/one',pg_catalog.decode(pg_catalog.repeat('01',32),'hex'),pg_catalog.repeat('A',80),pg_catalog.repeat('B',16),'Admin null expiry','desktop',null),
  ('e1500000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000004','https://push.example.invalid/two',pg_catalog.decode(pg_catalog.repeat('02',32),'hex'),pg_catalog.repeat('C',80),pg_catalog.repeat('D',16),'Member second device','desktop',statement_timestamp()+interval '10 days'),
  ('e1500000-0000-4000-8000-000000000003','e1100000-0000-4000-8000-000000000003','https://push.example.invalid/three',pg_catalog.decode(pg_catalog.repeat('03',32),'hex'),pg_catalog.repeat('E',80),pg_catalog.repeat('F',16),'Expired member','desktop',statement_timestamp()-interval '10 minutes'),
  ('e1500000-0000-4000-8000-000000000004','e1100000-0000-4000-8000-000000000004','https://push.example.invalid/four',pg_catalog.decode(pg_catalog.repeat('04',32),'hex'),pg_catalog.repeat('G',80),pg_catalog.repeat('H',16),'Future member','desktop',statement_timestamp()+interval '10 minutes'),
  ('e1500000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000006','https://push.example.invalid/five',pg_catalog.decode(pg_catalog.repeat('05',32),'hex'),pg_catalog.repeat('I',80),pg_catalog.repeat('J',16),'Inactive member','desktop',null);

set local session_replication_role = origin;

select public.d1b_behaviour_record(1, 'CLASSIFIER_BEFORE_AS_OF_OVERDUE',
  c.out_is_overdue and not c.out_is_due_in_24_hours and c.out_bucket='Overdue', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-01 11:59:59.999999+00','To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(2, 'CLASSIFIER_AT_AS_OF_DUE',
  not c.out_is_overdue and c.out_is_due_in_24_hours and c.out_bucket='Due in 24 hours', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-01 12:00:00+00','To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(3, 'CLASSIFIER_EXACT_24_HOURS_DUE',
  c.out_is_due_in_24_hours and not c.out_is_at_risk and c.out_bucket='Due in 24 hours', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-02 12:00:00+00','To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(4, 'CLASSIFIER_AFTER_24_HOURS_AT_RISK',
  not c.out_is_due_in_24_hours and c.out_is_at_risk and c.out_bucket='To Do', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-02 12:00:00.000001+00','To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(5, 'CLASSIFIER_EXACT_48_HOURS_AT_RISK',
  c.out_is_at_risk and c.out_bucket='To Do', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-03 12:00:00+00','To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(6, 'CLASSIFIER_AFTER_48_HOURS_NOT_AT_RISK',
  not c.out_is_at_risk and c.out_bucket='To Do', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-03 12:00:00.000001+00','To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(7, 'CLASSIFIER_IN_PROGRESS_NOT_AT_RISK',
  not c.out_is_at_risk and c.out_bucket='In Progress', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2026-01-03 00:00:00+00','In Progress','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(8, 'CLASSIFIER_COMPLETED_PRECEDENCE',
  not c.out_is_overdue and not c.out_is_due_in_24_hours and not c.out_is_at_risk and c.out_bucket='Completed', c::text)
from ceit_connect_private.classify_executive_dashboard_task('2025-01-01 00:00:00+00','Completed','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(9, 'CLASSIFIER_NULL_DEADLINE_STATUS_BUCKET',
  not c.out_is_overdue and not c.out_is_due_in_24_hours and not c.out_is_at_risk and c.out_bucket='To Do', c::text)
from ceit_connect_private.classify_executive_dashboard_task(null,'To Do','2026-01-01 12:00:00+00') c;
select public.d1b_behaviour_record(10, 'CLASSIFIER_BUCKET_ALLOWLIST_EXACT',
  pg_catalog.array_agg(distinct c.out_bucket order by c.out_bucket)=array['Completed','Due in 24 hours','In Progress','Overdue','To Do']::text[],
  pg_catalog.array_agg(distinct c.out_bucket order by c.out_bucket)::text)
from (values
  ('2025-01-01 00:00:00+00'::timestamptz,'To Do'),
  ('2026-01-01 12:00:00+00'::timestamptz,'To Do'),
  (null::timestamptz,'In Progress'),
  (null::timestamptz,'To Do'),
  (null::timestamptz,'Completed')
) v(due_date,status)
cross join lateral ceit_connect_private.classify_executive_dashboard_task(v.due_date,v.status,'2026-01-01 12:00:00+00') c;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);

select public.d1b_behaviour_record(11, 'OVERVIEW_OPEN_EQUALS_D1_SUMMARY',
  x.out_open_task_count=d.out_unique_active_task_count,
  x.out_open_task_count||'/'||d.out_unique_active_task_count)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x
cross join public.get_executive_dashboard_committee_summary('e1000000-0000-4000-8000-000000000001') d;
select public.d1b_behaviour_record(12, 'OVERVIEW_OVERDUE_EQUALS_DONUT',x.out_overdue_task_count=x.out_donut_overdue_count,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(13, 'OVERVIEW_DUE_EQUALS_DONUT',x.out_due_in_24_hours_task_count=x.out_donut_due_in_24_hours_count,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(14, 'OVERVIEW_OPEN_RECONCILES_DONUT',
  x.out_open_task_count=x.out_donut_overdue_count+x.out_donut_due_in_24_hours_count+x.out_donut_in_progress_count+x.out_donut_to_do_count,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(15, 'OVERVIEW_COMPLETED_ACTIVE_ONLY',x.out_donut_completed_count=1,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(16, 'OVERVIEW_HELP_EXCLUDES_DRAFT_ARCHIVED',x.out_help_wanted_task_count=1,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(17, 'OVERVIEW_APPROVAL_VALIDITY',x.out_needs_approval_count=3,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(18, 'OVERVIEW_UNASSIGNED_EXACT',x.out_unassigned_task_count=1,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001') x;
select public.d1b_behaviour_record(19, 'COUNCIL_OPEN_EQUALS_D1_TOTALS',
  x.out_open_task_count=(select pg_catalog.sum(d.out_unique_active_task_count) from public.list_executive_dashboard_committee_totals() d),x::text)
from public.get_executive_dashboard_extras_overview() x;

select public.d1b_behaviour_record(20, 'ATTENTION_CATEGORY_ORDER',
  pg_catalog.bool_and(q.previous_rank is null or q.previous_rank<=q.category_rank),
  pg_catalog.array_agg(q.category order by q.row_number)::text)
from (
  select a.out_category as category,
    case a.out_category when 'overdue' then 1 when 'due_in_24_hours' then 2 when 'needs_approval' then 3 when 'help_wanted' then 4 when 'needs_new_owner' then 5 when 'unassigned' then 6 end as category_rank,
    pg_catalog.lag(case a.out_category when 'overdue' then 1 when 'due_in_24_hours' then 2 when 'needs_approval' then 3 when 'help_wanted' then 4 when 'needs_new_owner' then 5 when 'unassigned' then 6 end) over () as previous_rank,
    pg_catalog.row_number() over () as row_number
  from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a
) q;
select public.d1b_behaviour_record(21, 'ATTENTION_NEEDS_NEW_OWNER_BEFORE_UNASSIGNED_DESPITE_TIEBREAKERS',
  pg_catalog.count(*) filter (where a.out_task_id in ('e1300000-0000-4000-8000-000000000007','e1300000-0000-4000-8000-000000000008'))=2
    and pg_catalog.min(a.ordinality) filter (where a.out_task_id='e1300000-0000-4000-8000-000000000008')
      < pg_catalog.min(a.ordinality) filter (where a.out_task_id='e1300000-0000-4000-8000-000000000007'),
  pg_catalog.array_agg(a.out_task_id order by a.ordinality)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') with ordinality a;
select public.d1b_behaviour_record(22, 'ATTENTION_APPROVAL_LABELS_GENERIC',
  pg_catalog.count(*)=3 and pg_catalog.bool_and(a.out_label in ('Leave request','Volunteer offer')),
  pg_catalog.array_agg(a.out_label)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a
where a.out_category='needs_approval';
select public.d1b_behaviour_record(23, 'ATTENTION_CONFIDENTIAL_TASK_MASKED',
  pg_catalog.count(*)=1 and pg_catalog.bool_and(a.out_task_id is null and a.out_label='Confidential task'),
  pg_catalog.array_agg(a.out_label||':'||coalesce(a.out_task_id::text,'null'))::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a
where a.out_label='Confidential task';
select public.d1b_behaviour_record(24, 'ATTENTION_CONFIDENTIAL_APPROVAL_NULL_ID',
  pg_catalog.count(*)=1 and pg_catalog.bool_and(a.out_task_id is null),pg_catalog.count(*)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a
where a.out_category='needs_approval' and a.out_label='Leave request' and a.out_task_id is null;
select public.d1b_behaviour_record(25, 'ATTENTION_NO_SECRET_TEXT',
  pg_catalog.count(*) filter (where a.out_label like '%TOP SECRET%')=0,pg_catalog.array_agg(a.out_label)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a;
select public.d1b_behaviour_record(26, 'ATTENTION_TASK_ROWS_NOT_DUPLICATED',
  pg_catalog.count(a.out_task_id)=pg_catalog.count(distinct a.out_task_id),pg_catalog.count(a.out_task_id)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a
where a.out_category<>'needs_approval';
select public.d1b_behaviour_record(27, 'ATTENTION_STALE_LEAVE_EXCLUDED',
  pg_catalog.count(*) filter (where a.out_task_id='e1300000-0000-4000-8000-000000000007')=1,
  pg_catalog.count(*) filter (where a.out_task_id='e1300000-0000-4000-8000-000000000007')::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001') a;
select public.d1b_behaviour_record(28, 'ATTENTION_CAP_EXACTLY_20',pg_catalog.count(*)=20,pg_catalog.count(*)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000003');
select public.d1b_behaviour_record(29, 'ATTENTION_CAP_APPLIED_AFTER_ORDER',
  pg_catalog.max(pg_catalog.right(a.out_task_id::text,12)::bigint)=20 and pg_catalog.min(pg_catalog.right(a.out_task_id::text,12)::bigint)=1,
  pg_catalog.min(pg_catalog.right(a.out_task_id::text,12))||'/'||pg_catalog.max(pg_catalog.right(a.out_task_id::text,12)))
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000003') a;
select public.d1b_behaviour_record(30, 'ATTENTION_CAP_NO_TASK_DUPLICATE',pg_catalog.count(*)=pg_catalog.count(distinct a.out_task_id),pg_catalog.count(*)::text)
from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000003') a;

select public.d1b_behaviour_record(31, 'DEADLINES_EXACTLY_SEVEN_DAYS',pg_catalog.count(*)=7,pg_catalog.count(*)::text)
from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000001');
select public.d1b_behaviour_record(32, 'DEADLINES_CONSECUTIVE_AND_ORDERED',
  pg_catalog.max(d.out_calendar_date)-pg_catalog.min(d.out_calendar_date)=6 and pg_catalog.count(distinct d.out_calendar_date)=7,
  pg_catalog.min(d.out_calendar_date)||'/'||pg_catalog.max(d.out_calendar_date))
from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000001') d;
select public.d1b_behaviour_record(33, 'DEADLINES_INCLUDE_ZERO_DAYS',
  pg_catalog.count(*)=2 and pg_catalog.bool_and(d.out_open_task_count=0),
  pg_catalog.array_agg(d.out_calendar_date||':'||d.out_open_task_count order by d.out_calendar_date)::text)
from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000001') d
where d.out_calendar_date in (
  (statement_timestamp() at time zone 'Asia/Manila')::date+5,
  (statement_timestamp() at time zone 'Asia/Manila')::date+6
);
select public.d1b_behaviour_record(34, 'DEADLINES_EARLIER_TODAY_COUNTS',d.out_open_task_count>=1,d::text)
from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000001') d
where d.out_calendar_date=(statement_timestamp() at time zone 'Asia/Manila')::date;
select public.d1b_behaviour_record(35, 'DEADLINES_TOMORROW_COUNTS',d.out_open_task_count>=1,d::text)
from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000001') d
where d.out_calendar_date=(statement_timestamp() at time zone 'Asia/Manila')::date+1;

select public.d1b_behaviour_record(36, 'FREE_EXACTLY_TWO_INCLUDED',f.out_open_task_count=2,f::text)
from public.list_executive_dashboard_free_members() f where f.out_member_id='e1100000-0000-4000-8000-000000000003';
select public.d1b_behaviour_record(37, 'FREE_EXACTLY_THREE_EXCLUDED',pg_catalog.count(*)=0,pg_catalog.count(*)::text)
from public.list_executive_dashboard_free_members() f where f.out_member_id='e1100000-0000-4000-8000-000000000004';
select public.d1b_behaviour_record(38, 'FREE_ADMINS_EXCLUDED',pg_catalog.count(*) filter (where f.out_role='Admin')=0,pg_catalog.array_agg(f.out_role)::text)
from public.list_executive_dashboard_free_members() f;
select public.d1b_behaviour_record(39, 'FREE_COMMITTEE_SCOPE_COUNCIL_WORKLOAD',f.out_open_task_count=2,f::text)
from public.list_executive_dashboard_free_members('e1000000-0000-4000-8000-000000000001') f where f.out_member_id='e1100000-0000-4000-8000-000000000003';
select public.d1b_behaviour_record(40, 'FREE_COMMITTEE_SCOPE_PEOPLE_ONLY',pg_catalog.count(*) filter (where f.out_member_id in ('e1100000-0000-4000-8000-000000000007','e1100000-0000-4000-8000-000000000008'))=0,pg_catalog.count(*)::text)
from public.list_executive_dashboard_free_members('e1000000-0000-4000-8000-000000000001') f;
select public.d1b_behaviour_record(41, 'FREE_ORDER_COUNT_NAME_ID',
  pg_catalog.bool_and(q.previous_key is null or q.previous_key<=q.current_key),pg_catalog.array_agg(q.current_key)::text)
from (
  select pg_catalog.lag(pg_catalog.lpad(f.out_open_task_count::text,3,'0')||f.out_full_name||f.out_member_id) over () as previous_key,
    pg_catalog.lpad(f.out_open_task_count::text,3,'0')||f.out_full_name||f.out_member_id as current_key
  from public.list_executive_dashboard_free_members() f
) q;

select public.d1b_behaviour_record(42, 'SLIPPING_LOCAL_OPEN_DIFFERS_FROM_FREE',s.out_open_task_count=1 and s.out_overdue_task_count=1,s::text)
from public.list_executive_dashboard_member_slipping_signals('e1000000-0000-4000-8000-000000000001') s where s.out_member_id='e1100000-0000-4000-8000-000000000003';
select public.d1b_behaviour_record(43, 'SLIPPING_AT_RISK_AND_OPEN',s.out_open_task_count=3 and s.out_at_risk_task_count=1,s::text)
from public.list_executive_dashboard_member_slipping_signals('e1000000-0000-4000-8000-000000000001') s where s.out_member_id='e1100000-0000-4000-8000-000000000004';
select public.d1b_behaviour_record(44, 'SLIPPING_ZERO_MEMBER_PRESENT',s.out_open_task_count=0 and s.out_overdue_task_count=0 and s.out_at_risk_task_count=0,s::text)
from public.list_executive_dashboard_member_slipping_signals('e1000000-0000-4000-8000-000000000001') s where s.out_member_id='e1100000-0000-4000-8000-000000000005';
select public.d1b_behaviour_record(45, 'SLIPPING_ORDER_COMMITTEE_NAME_MEMBER_NAME_ID',
  pg_catalog.array_agg(s.out_member_id)=array['e1100000-0000-4000-8000-000000000002','e1100000-0000-4000-8000-000000000003','e1100000-0000-4000-8000-000000000004','e1100000-0000-4000-8000-000000000005','e1100000-0000-4000-8000-000000000009']::uuid[],
  pg_catalog.array_agg(s.out_member_id)::text)
from public.list_executive_dashboard_member_slipping_signals('e1000000-0000-4000-8000-000000000001') s;

select public.d1b_behaviour_record(46, 'PUSH_COUNTS_DISTINCT_ACTIVE_PEOPLE',
  p.out_active_profiles_with_push_count=e.out_active_profiles_with_push_count
    and p.out_active_profile_count=e.out_active_profile_count,
  p::text||' expected '||e::text)
from public.get_executive_dashboard_push_adoption() p
cross join public.d1b_behaviour_expected_push_adoption() e;
select public.d1b_behaviour_record(47, 'PUSH_NULL_EXPIRY_COUNTS',
  p.out_active_profiles_with_push_count=e.out_active_profiles_with_push_count
    and p.out_active_profile_count=e.out_active_profile_count,
  p::text||' expected '||e::text)
from public.get_executive_dashboard_push_adoption() p
cross join public.d1b_behaviour_expected_push_adoption() e;

reset role;
update public.push_subscriptions
set expires_at=statement_timestamp()-interval '10 minutes'
where id='e1500000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);

select public.d1b_behaviour_record(48, 'PUSH_EXPIRED_AND_INACTIVE_DO_NOT_COUNT',
  p.out_active_profiles_with_push_count=e.out_active_profiles_with_push_count
    and p.out_active_profile_count=e.out_active_profile_count,
  p::text||' expected '||e::text)
from public.get_executive_dashboard_push_adoption() p
cross join public.d1b_behaviour_expected_push_adoption() e;

select public.d1b_behaviour_record(49, 'EMPTY_COMMITTEE_FIXED_ZERO_OVERVIEW',
  x.out_open_task_count=0 and x.out_overdue_task_count=0 and x.out_due_in_24_hours_task_count=0 and x.out_unassigned_task_count=0 and x.out_help_wanted_task_count=0 and x.out_needs_approval_count=0,x::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000004') x;
select public.d1b_behaviour_record(50, 'EMPTY_NO_COADMIN_ADMIN_READABLE',
  pg_catalog.count(*)=7 and pg_catalog.sum(d.out_open_task_count)=0,pg_catalog.count(*)::text)
from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000004') d;

reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select public.d1b_behaviour_expect_denied(51,'COADMIN_OMITTED_ARGUMENT_DENIED',$$select * from public.get_executive_dashboard_extras_overview()$$);
select public.d1b_behaviour_record(52,'COADMIN_OWN_COMMITTEE_ALLOWED',pg_catalog.count(*)=1,pg_catalog.count(*)::text)
from public.get_executive_dashboard_extras_overview('e1000000-0000-4000-8000-000000000001');
select public.d1b_behaviour_expect_denied(53,'COADMIN_OTHER_COMMITTEE_DENIED',$$select * from public.list_executive_dashboard_deadlines('e1000000-0000-4000-8000-000000000002')$$);
select public.d1b_behaviour_expect_denied(54,'COADMIN_PUSH_DENIED',$$select * from public.get_executive_dashboard_push_adoption()$$);

select pg_catalog.set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
select public.d1b_behaviour_expect_denied(55,'MEMBER_READER_DENIED',$$select * from public.list_executive_dashboard_free_members('e1000000-0000-4000-8000-000000000001')$$);
select pg_catalog.set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000011',true);
select public.d1b_behaviour_expect_denied(56,'INACTIVE_READER_DENIED',$$select * from public.list_executive_dashboard_member_slipping_signals('e1000000-0000-4000-8000-000000000001')$$);
select pg_catalog.set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000010',true);
select public.d1b_behaviour_expect_denied(57,'PROFILELESS_READER_DENIED',$$select * from public.list_executive_dashboard_needs_attention('e1000000-0000-4000-8000-000000000001')$$);
reset role;

select ordinal, label, passed, detail
from public.d1b_behaviour_test_results
order by ordinal;

do $$
declare
  v_total integer;
  v_passed integer;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where result.passed)::integer
  into v_total, v_passed
  from public.d1b_behaviour_test_results as result;

  if v_total = 57 and v_passed = 57 then
    raise exception 'TEST RESULTS 57/57 PASS — transaction intentionally rolled back';
  end if;

  raise exception 'TEST RESULTS %/57 PASS — transaction intentionally rolled back',
    v_passed;
end
$$;
```
