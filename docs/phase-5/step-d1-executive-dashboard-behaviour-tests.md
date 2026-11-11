# D1 Executive Dashboard behaviour test

Run this single paste on **Dev only** in the Supabase SQL Editor with
**Run without RLS**. It creates ordinary rollback-only fixture and result
tables, not temporary tables. The final raised exception is intentional and
rolls back every `auth.users`, profile, committee, event, task, helper, and
result row.

The finished paste has **56 result rows**. Its success sentinel is
`TEST RESULTS 56/56 PASS — transaction intentionally rolled back`.

The rollback-only `d1_behaviour_expect_denied` definer deliberately reaches
the reader body for missing-JWT assertions. Direct anon/service execution is
still revoked and is proved separately by the catalog paste.

```sql
begin;

create table public.d1_behaviour_test_results (
  ordinal integer primary key,
  label text not null unique,
  passed boolean not null,
  detail text not null
);

grant select, insert on public.d1_behaviour_test_results
to anon, authenticated, service_role;

create function public.d1_behaviour_expect_denied(
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
    insert into public.d1_behaviour_test_results
      (ordinal, label, passed, detail)
    values
      (p_ordinal, p_label, false, 'call unexpectedly succeeded');
  exception
    when others then
      get stacked diagnostics
        v_state = returned_sqlstate,
        v_message = message_text;
      insert into public.d1_behaviour_test_results
        (ordinal, label, passed, detail)
      values (
        p_ordinal,
        p_label,
        v_state = '42501'
          and v_message = 'Executive Dashboard access denied.',
        v_state || ': ' || v_message
      );
  end;
end;
$$;

alter function public.d1_behaviour_expect_denied(integer, text, text)
owner to postgres;
revoke all on function public.d1_behaviour_expect_denied(integer, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.d1_behaviour_expect_denied(integer, text, text)
to anon, authenticated, service_role;

set local session_replication_role = replica;

insert into public.committees (id, name) values
  ('d1000000-0000-4000-8000-000000000001', 'D1 Alpha'),
  ('d1000000-0000-4000-8000-000000000002', 'D1 Beta No Co-Admin'),
  ('d1000000-0000-4000-8000-000000000003', 'D1 Empty'),
  ('d1000000-0000-4000-8000-000000000004', 'D1 No Active Members');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'd1-admin@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'd1-coadmin@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'd1-member@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'd1-zero@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'd1-inactive@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'd1-outsider@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'd1-inactive-coadmin@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'd1-inactive-admin@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()),
  ('00000000-0000-0000-0000-000000000000', 'd1100000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'd1-profileless@example.invalid', '', pg_catalog.now(), pg_catalog.now(), pg_catalog.now());

insert into public.users (
  id, email, full_name, role, committee_id, is_active, avatar_url
) values
  ('d1100000-0000-4000-8000-000000000001', 'd1-admin@example.invalid', 'D1 Admin', 'Admin', null, true, null),
  ('d1100000-0000-4000-8000-000000000002', 'd1-coadmin@example.invalid', 'Able Co-Admin', 'Co-Admin', 'd1000000-0000-4000-8000-000000000001', true, 'https://example.invalid/coadmin.webp'),
  ('d1100000-0000-4000-8000-000000000003', 'd1-member@example.invalid', 'Bravo Member', 'Member', 'd1000000-0000-4000-8000-000000000001', true, 'https://example.invalid/member.webp'),
  ('d1100000-0000-4000-8000-000000000004', 'd1-zero@example.invalid', 'Charlie Zero', 'Member', 'd1000000-0000-4000-8000-000000000001', true, null),
  ('d1100000-0000-4000-8000-000000000005', 'd1-inactive@example.invalid', 'Delta Inactive', 'Member', 'd1000000-0000-4000-8000-000000000001', false, null),
  ('d1100000-0000-4000-8000-000000000006', 'd1-outsider@example.invalid', 'Echo Outsider', 'Member', 'd1000000-0000-4000-8000-000000000002', true, null),
  ('d1100000-0000-4000-8000-000000000007', 'd1-inactive-coadmin@example.invalid', 'Foxtrot Inactive Co-Admin', 'Co-Admin', 'd1000000-0000-4000-8000-000000000001', false, null),
  ('d1100000-0000-4000-8000-000000000008', 'd1-inactive-admin@example.invalid', 'Golf Inactive Admin', 'Admin', null, false, null);

insert into public.events (
  id, name, start_date, end_date, status, created_by,
  archived_unfinished_task_count
) values
  ('d1200000-0000-4000-8000-000000000001', 'D1 Active', '2026-11-01', '2026-11-30', 'Active', 'd1100000-0000-4000-8000-000000000001', null),
  ('d1200000-0000-4000-8000-000000000002', 'D1 Draft', '2026-11-01', '2026-11-30', 'Draft', 'd1100000-0000-4000-8000-000000000001', null),
  ('d1200000-0000-4000-8000-000000000003', 'D1 Archived', '2026-10-01', '2026-10-31', 'Archived', 'd1100000-0000-4000-8000-000000000001', 1);

insert into public.tasks (
  id, event_id, committee_id, title, status,
  primary_assignees, assist_assignees, is_confidential,
  created_by, sort_order
) values
  ('d1300000-0000-4000-8000-000000000001', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 shared overlap', 'To Do', array['d1100000-0000-4000-8000-000000000003']::uuid[], array['d1100000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000002']::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 1024),
  ('d1300000-0000-4000-8000-000000000002', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 unassigned', 'To Do', '{}'::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 2048),
  ('d1300000-0000-4000-8000-000000000003', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 inactive only', 'To Do', array['d1100000-0000-4000-8000-000000000005']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 3072),
  ('d1300000-0000-4000-8000-000000000004', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 active outsider only', 'In Progress', array['d1100000-0000-4000-8000-000000000006']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 4096),
  ('d1300000-0000-4000-8000-000000000005', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 Admin only', 'To Do', array['d1100000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 5120),
  ('d1300000-0000-4000-8000-000000000006', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 local and inactive', 'To Do', array['d1100000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000005']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 6144),
  ('d1300000-0000-4000-8000-000000000007', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 local and outsider', 'In Progress', array['d1100000-0000-4000-8000-000000000003','d1100000-0000-4000-8000-000000000006']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 7168),
  ('d1300000-0000-4000-8000-000000000008', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 confidential secret', 'To Do', array['d1100000-0000-4000-8000-000000000003']::uuid[], '{}'::uuid[], true, 'd1100000-0000-4000-8000-000000000001', 8192),
  ('d1300000-0000-4000-8000-000000000009', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'D1 completed excluded', 'Completed', array['d1100000-0000-4000-8000-000000000003']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 9216),
  ('d1300000-0000-4000-8000-000000000010', 'd1200000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'D1 Draft excluded', 'To Do', array['d1100000-0000-4000-8000-000000000003']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 10240),
  ('d1300000-0000-4000-8000-000000000011', 'd1200000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'D1 Archived excluded', 'To Do', array['d1100000-0000-4000-8000-000000000003']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 11264),
  ('d1300000-0000-4000-8000-000000000012', 'd1200000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'D1 no-member Admin assignment', 'To Do', array['d1100000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[], false, 'd1100000-0000-4000-8000-000000000001', 12288);

set local session_replication_role = origin;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000001', true);

insert into public.d1_behaviour_test_results
select 1, 'ADMIN_LEVEL1_ALPHA_UNIQUE', out_unique_active_task_count = 8, out_unique_active_task_count::text
from public.list_executive_dashboard_committee_totals()
where out_committee_id = 'd1000000-0000-4000-8000-000000000001';

insert into public.d1_behaviour_test_results
select 2, 'ADMIN_SUMMARY_ALPHA_UNIQUE', out_unique_active_task_count = 8, out_unique_active_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');

insert into public.d1_behaviour_test_results
select 3, 'LEVEL1_LEVEL2_EXACT_MATCH', level1.row_value = level2.row_value, level1.row_value::text || ' / ' || level2.row_value::text
from (
  select row(out_unique_active_task_count, out_covered_task_count, out_unassigned_task_count, out_inactive_only_task_count, out_active_outside_committee_only_task_count, out_tasks_without_member_bar_count) as row_value
  from public.list_executive_dashboard_committee_totals()
  where out_committee_id = 'd1000000-0000-4000-8000-000000000001'
) as level1
cross join (
  select row(out_unique_active_task_count, out_covered_task_count, out_unassigned_task_count, out_inactive_only_task_count, out_active_outside_committee_only_task_count, out_tasks_without_member_bar_count) as row_value
  from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001')
) as level2;

insert into public.d1_behaviour_test_results
select 4, 'COVERED_COUNT', out_covered_task_count = 6, out_covered_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 5, 'UNASSIGNED_COUNT', out_unassigned_task_count = 1, out_unassigned_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 6, 'INACTIVE_ONLY_COUNT', out_inactive_only_task_count = 1, out_inactive_only_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 7, 'PARTITION_EQUALS_UNIQUE', out_covered_task_count + out_unassigned_task_count + out_inactive_only_task_count = out_unique_active_task_count, 'partition checked'
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 8, 'OUTSIDE_ONLY_COUNT_INCLUDES_ADMIN', out_active_outside_committee_only_task_count = 2, out_active_outside_committee_only_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 9, 'READY_NOTE_COUNT', out_tasks_without_member_bar_count = 4, out_tasks_without_member_bar_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');

insert into public.d1_behaviour_test_results
select 10, 'ADMIN_ONLY_ASSIGNMENT_IS_COVERED', out_covered_task_count = 1, out_covered_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000004');
insert into public.d1_behaviour_test_results
select 11, 'ADMIN_ONLY_ASSIGNMENT_IS_OUTSIDE', out_active_outside_committee_only_task_count = 1, out_active_outside_committee_only_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000004');
insert into public.d1_behaviour_test_results
select 12, 'NO_ACTIVE_MEMBERS_SUMMARY_RETURNS', out_unique_active_task_count = 1, out_unique_active_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000004');
insert into public.d1_behaviour_test_results
select 13, 'NO_ACTIVE_MEMBERS_READY_NOTE', out_tasks_without_member_bar_count = 1, out_tasks_without_member_bar_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000004');
insert into public.d1_behaviour_test_results
select 14, 'NO_ACTIVE_MEMBERS_LIST_EMPTY', pg_catalog.count(*) = 0, pg_catalog.count(*)::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000004');

insert into public.d1_behaviour_test_results
select 15, 'ALPHA_ACTIVE_MEMBER_ROW_COUNT', pg_catalog.count(*) = 3, pg_catalog.count(*)::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 16, 'COADMIN_GETS_NORMAL_BAR', out_active_task_count = 1, out_active_task_count::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')
where out_member_id = 'd1100000-0000-4000-8000-000000000002';
insert into public.d1_behaviour_test_results
select 17, 'MEMBER_TRUE_WORKLOAD', out_active_task_count = 4, out_active_task_count::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')
where out_member_id = 'd1100000-0000-4000-8000-000000000003';
insert into public.d1_behaviour_test_results
select 18, 'ZERO_TASK_MEMBER_INCLUDED', out_active_task_count = 0, out_active_task_count::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')
where out_member_id = 'd1100000-0000-4000-8000-000000000004';
insert into public.d1_behaviour_test_results
select 19, 'PRIMARY_ASSIST_OVERLAP_DEDUPED', out_active_task_count = 4, out_active_task_count::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')
where out_member_id = 'd1100000-0000-4000-8000-000000000003';
insert into public.d1_behaviour_test_results
select 20, 'SHARED_TASK_COUNTS_FOR_BOTH_LOCAL_PEOPLE',
  pg_catalog.sum(out_active_task_count) = 5,
  pg_catalog.sum(out_active_task_count)::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 21, 'MEMBER_ORDER_NAME_THEN_ID',
  pg_catalog.array_agg(out_member_id order by member_rows.ordinality) = array[
    'd1100000-0000-4000-8000-000000000002',
    'd1100000-0000-4000-8000-000000000003',
    'd1100000-0000-4000-8000-000000000004'
  ]::uuid[],
  pg_catalog.array_agg(out_full_name order by member_rows.ordinality)::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')
with ordinality as member_rows;
insert into public.d1_behaviour_test_results
select 22, 'LEVEL1_ORDER_NAME_THEN_ID',
  pg_catalog.array_agg(out_committee_id order by total_rows.ordinality)
    = pg_catalog.array_agg(out_committee_id order by out_committee_name, out_committee_id),
  'ordered'
from public.list_executive_dashboard_committee_totals()
with ordinality as total_rows;
insert into public.d1_behaviour_test_results
select 23, 'ZERO_TASK_COMMITTEE_INCLUDED', out_unique_active_task_count = 0, out_unique_active_task_count::text
from public.list_executive_dashboard_committee_totals()
where out_committee_id = 'd1000000-0000-4000-8000-000000000003';
insert into public.d1_behaviour_test_results
select 24, 'NO_COADMIN_COMMITTEE_STILL_READABLE', out_unique_active_task_count = 0, out_unique_active_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000002');
insert into public.d1_behaviour_test_results
select 25, 'COMPLETED_TASK_EXCLUDED', out_unique_active_task_count = 8, 'completed did not increase total'
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 26, 'DRAFT_EVENT_EXCLUDED', out_unique_active_task_count = 8, 'Draft did not increase total'
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 27, 'ARCHIVED_EVENT_EXCLUDED', out_unique_active_task_count = 8, 'Archived did not increase total'
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 28, 'CONFIDENTIAL_TASK_CONTRIBUTES_NUMBER', out_active_task_count = 4, 'confidential task included in numeric workload'
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')
where out_member_id = 'd1100000-0000-4000-8000-000000000003';
insert into public.d1_behaviour_test_results
select 29, 'NO_SYNTHETIC_ASSIGNMENT_ROWS', pg_catalog.count(*) = 3, pg_catalog.count(*)::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 30, 'ACTIVE_PLUS_INACTIVE_IS_COVERED', out_covered_task_count = 6 and out_inactive_only_task_count = 1, 'mixed task did not enter inactive-only'
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 31, 'ACTIVE_LOCAL_PLUS_OUTSIDER_HAS_LOCAL_BAR', out_active_outside_committee_only_task_count = 2, 'mixed task did not enter outside-only'
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 32, 'SUMMARY_HAS_NO_TASK_CONTENT_COLUMNS',
  not exists (
    select 1
    from pg_catalog.pg_proc as procedure_row
    cross join lateral pg_catalog.generate_subscripts(
      procedure_row.proargnames,
      1
    ) as argument_position(arg_index)
    where procedure_row.oid = any(array[
      'public.list_executive_dashboard_committee_totals()'::regprocedure,
      'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
      'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
    ])
      and procedure_row.proargmodes[argument_position.arg_index] in ('o', 'b', 't')
      and exists (
        select 1
        from pg_catalog.unnest(array[
          'task_id',
          'title',
          'description',
          'event_id',
          'is_confidential'
        ]::text[]) as forbidden_name(name)
        where pg_catalog.strpos(
          pg_catalog.lower(
            procedure_row.proargnames[argument_position.arg_index]
          ),
          forbidden_name.name
        ) > 0
      )
  ),
  'no task content columns';

reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000002', true);
insert into public.d1_behaviour_test_results
select 33, 'COADMIN_OWN_SUMMARY_ALLOWED', out_unique_active_task_count = 8, out_unique_active_task_count::text
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001');
insert into public.d1_behaviour_test_results
select 34, 'COADMIN_OWN_MEMBER_LIST_ALLOWED', pg_catalog.count(*) = 3, pg_catalog.count(*)::text
from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001');
select public.d1_behaviour_expect_denied(35, 'COADMIN_OTHER_SUMMARY_DENIED', $$select * from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000002')$$);
select public.d1_behaviour_expect_denied(36, 'COADMIN_MISSING_SUMMARY_SAME_DENIAL', $$select * from public.get_executive_dashboard_committee_summary('d1ffffff-ffff-4fff-8fff-ffffffffffff')$$);
select public.d1_behaviour_expect_denied(37, 'COADMIN_NULL_SUMMARY_SAME_DENIAL', $$select * from public.get_executive_dashboard_committee_summary(null)$$);
select public.d1_behaviour_expect_denied(38, 'COADMIN_OTHER_MEMBERS_DENIED', $$select * from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000002')$$);
select public.d1_behaviour_expect_denied(39, 'COADMIN_MISSING_MEMBERS_SAME_DENIAL', $$select * from public.list_executive_dashboard_committee_members('d1ffffff-ffff-4fff-8fff-ffffffffffff')$$);
select public.d1_behaviour_expect_denied(40, 'COADMIN_NULL_MEMBERS_SAME_DENIAL', $$select * from public.list_executive_dashboard_committee_members(null)$$);
select public.d1_behaviour_expect_denied(41, 'COADMIN_LEVEL1_DENIED', $$select * from public.list_executive_dashboard_committee_totals()$$);
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000003', true);
select public.d1_behaviour_expect_denied(42, 'MEMBER_SUMMARY_DENIED', $$select * from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(43, 'MEMBER_MEMBERS_DENIED', $$select * from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(44, 'MEMBER_LEVEL1_DENIED', $$select * from public.list_executive_dashboard_committee_totals()$$);
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000007', true);
select public.d1_behaviour_expect_denied(45, 'INACTIVE_COADMIN_SUMMARY_DENIED', $$select * from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(46, 'INACTIVE_COADMIN_MEMBERS_DENIED', $$select * from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')$$);
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000008', true);
select public.d1_behaviour_expect_denied(47, 'INACTIVE_ADMIN_LEVEL1_DENIED', $$select * from public.list_executive_dashboard_committee_totals()$$);
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000009', true);
select public.d1_behaviour_expect_denied(48, 'PROFILELESS_SUMMARY_DENIED', $$select * from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(49, 'PROFILELESS_MEMBERS_DENIED', $$select * from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(50, 'PROFILELESS_LEVEL1_DENIED', $$select * from public.list_executive_dashboard_committee_totals()$$);
reset role;

set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
select public.d1_behaviour_expect_denied(51, 'ANON_SUMMARY_BODY_DENIAL', $$select * from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(52, 'ANON_MEMBERS_BODY_DENIAL', $$select * from public.list_executive_dashboard_committee_members('d1000000-0000-4000-8000-000000000001')$$);
select public.d1_behaviour_expect_denied(53, 'ANON_LEVEL1_BODY_DENIAL', $$select * from public.list_executive_dashboard_committee_totals()$$);
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd1100000-0000-4000-8000-000000000001', true);
select public.d1_behaviour_expect_denied(54, 'ADMIN_NULL_SUMMARY_DENIED', $$select * from public.get_executive_dashboard_committee_summary(null)$$);
select public.d1_behaviour_expect_denied(55, 'ADMIN_NULL_MEMBERS_DENIED', $$select * from public.list_executive_dashboard_committee_members(null)$$);
insert into public.d1_behaviour_test_results
select 56, 'ADMIN_ANY_EXISTING_COMMITTEE_ALLOWED', out_committee_id = 'd1000000-0000-4000-8000-000000000002', out_committee_name
from public.get_executive_dashboard_committee_summary('d1000000-0000-4000-8000-000000000002');
reset role;

select ordinal, label, passed, detail
from public.d1_behaviour_test_results
order by ordinal;

do $$
declare
  v_total integer;
  v_passed integer;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where result.passed)::integer
  into v_total, v_passed
  from public.d1_behaviour_test_results as result;

  if v_total = 56 and v_passed = 56 then
    raise exception 'TEST RESULTS 56/56 PASS — transaction intentionally rolled back';
  end if;

  raise exception 'TEST RESULTS %/56 PASS — transaction intentionally rolled back',
    v_passed;
end
$$;
```
