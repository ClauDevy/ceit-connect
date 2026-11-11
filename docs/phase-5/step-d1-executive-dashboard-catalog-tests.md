# D1 Executive Dashboard catalog test

Run this single paste on **Dev only** in the Supabase SQL Editor with
**Run without RLS**, after the D1 migration and behaviour paste have been
reviewed. It uses an ordinary rollback-only result table and its own
`auth.users`, profile, and committee fixture. It creates no temporary table.

The finished paste has **32 result rows**. Its success sentinel is
`TEST RESULTS 32/32 PASS — transaction intentionally rolled back`.

```sql
begin;

create table public.d1_catalog_test_results (
  ordinal integer primary key,
  label text not null unique,
  passed boolean not null,
  detail text not null
);

grant select, insert on public.d1_catalog_test_results to authenticated;

set local session_replication_role = replica;
insert into public.committees (id, name)
values ('d2000000-0000-4000-8000-000000000001', 'D1 Catalog Fixture');
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd2100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'd1-catalog-admin@example.invalid', '',
  pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
);
insert into public.users (
  id, email, full_name, role, committee_id, is_active
) values (
  'd2100000-0000-4000-8000-000000000001',
  'd1-catalog-admin@example.invalid', 'D1 Catalog Admin',
  'Admin', null, true
);
set local session_replication_role = origin;

insert into public.d1_catalog_test_results
select 1, 'PRIVATE_HELPER_EXISTS', pg_catalog.to_regprocedure('ceit_connect_private.executive_dashboard_committee_counts(uuid)') is not null, 'private helper';
insert into public.d1_catalog_test_results
select 2, 'LEVEL1_EXISTS', pg_catalog.to_regprocedure('public.list_executive_dashboard_committee_totals()') is not null, 'Level 1';
insert into public.d1_catalog_test_results
select 3, 'LEVEL2_SUMMARY_EXISTS', pg_catalog.to_regprocedure('public.get_executive_dashboard_committee_summary(uuid)') is not null, 'Level 2 summary';
insert into public.d1_catalog_test_results
select 4, 'LEVEL2_MEMBERS_EXISTS', pg_catalog.to_regprocedure('public.list_executive_dashboard_committee_members(uuid)') is not null, 'Level 2 members';

insert into public.d1_catalog_test_results
select 5, 'PRIVATE_HELPER_NO_OVERLOAD', pg_catalog.count(*) = 1, pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
join pg_catalog.pg_namespace as namespace_row on namespace_row.oid = procedure_row.pronamespace
where namespace_row.nspname = 'ceit_connect_private' and procedure_row.proname = 'executive_dashboard_committee_counts';
insert into public.d1_catalog_test_results
select 6, 'LEVEL1_NO_OVERLOAD', pg_catalog.count(*) = 1, pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
join pg_catalog.pg_namespace as namespace_row on namespace_row.oid = procedure_row.pronamespace
where namespace_row.nspname = 'public' and procedure_row.proname = 'list_executive_dashboard_committee_totals';
insert into public.d1_catalog_test_results
select 7, 'SUMMARY_NO_OVERLOAD', pg_catalog.count(*) = 1, pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
join pg_catalog.pg_namespace as namespace_row on namespace_row.oid = procedure_row.pronamespace
where namespace_row.nspname = 'public' and procedure_row.proname = 'get_executive_dashboard_committee_summary';
insert into public.d1_catalog_test_results
select 8, 'MEMBERS_NO_OVERLOAD', pg_catalog.count(*) = 1, pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
join pg_catalog.pg_namespace as namespace_row on namespace_row.oid = procedure_row.pronamespace
where namespace_row.nspname = 'public' and procedure_row.proname = 'list_executive_dashboard_committee_members';

insert into public.d1_catalog_test_results
select 9, 'ALL_POSTGRES_OWNED', pg_catalog.bool_and(procedure_row.proowner = 'postgres'::regrole), pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);
insert into public.d1_catalog_test_results
select 10, 'ALL_STABLE', pg_catalog.bool_and(procedure_row.provolatile = 's'), pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);
insert into public.d1_catalog_test_results
select 11, 'ALL_SECURITY_DEFINER', pg_catalog.bool_and(procedure_row.prosecdef), pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);
insert into public.d1_catalog_test_results
select 12, 'ALL_FIXED_EMPTY_PATH', pg_catalog.bool_and(procedure_row.proconfig = array['search_path=""']), pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);

insert into public.d1_catalog_test_results
select 13, 'HELPER_PUBLIC_REVOKED', not exists (
  select 1 from pg_catalog.aclexplode(procedure_row.proacl) as privilege
  where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
), 'PUBLIC execute absent'
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure;
insert into public.d1_catalog_test_results
select 14, 'HELPER_ANON_REVOKED', not pg_catalog.has_function_privilege('anon', 'ceit_connect_private.executive_dashboard_committee_counts(uuid)', 'EXECUTE'), 'anon execute absent';
insert into public.d1_catalog_test_results
select 15, 'HELPER_AUTHENTICATED_REVOKED', not pg_catalog.has_function_privilege('authenticated', 'ceit_connect_private.executive_dashboard_committee_counts(uuid)', 'EXECUTE'), 'authenticated execute absent';
insert into public.d1_catalog_test_results
select 16, 'HELPER_SERVICE_ROLE_REVOKED', not pg_catalog.has_function_privilege('service_role', 'ceit_connect_private.executive_dashboard_committee_counts(uuid)', 'EXECUTE'), 'service_role execute absent';

insert into public.d1_catalog_test_results
select 17, 'LEVEL1_AUTHENTICATED_ONLY',
  pg_catalog.has_function_privilege('authenticated', 'public.list_executive_dashboard_committee_totals()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.list_executive_dashboard_committee_totals()', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', 'public.list_executive_dashboard_committee_totals()', 'EXECUTE'),
  'authenticated yes; anon/service no';
insert into public.d1_catalog_test_results
select 18, 'SUMMARY_AUTHENTICATED_ONLY',
  pg_catalog.has_function_privilege('authenticated', 'public.get_executive_dashboard_committee_summary(uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.get_executive_dashboard_committee_summary(uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', 'public.get_executive_dashboard_committee_summary(uuid)', 'EXECUTE'),
  'authenticated yes; anon/service no';
insert into public.d1_catalog_test_results
select 19, 'MEMBERS_AUTHENTICATED_ONLY',
  pg_catalog.has_function_privilege('authenticated', 'public.list_executive_dashboard_committee_members(uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('anon', 'public.list_executive_dashboard_committee_members(uuid)', 'EXECUTE')
  and not pg_catalog.has_function_privilege('service_role', 'public.list_executive_dashboard_committee_members(uuid)', 'EXECUTE'),
  'authenticated yes; anon/service no';
insert into public.d1_catalog_test_results
select 20, 'PUBLIC_EXECUTE_REVOKED_FROM_ALL', pg_catalog.bool_and(not exists (
  select 1 from pg_catalog.aclexplode(procedure_row.proacl) as privilege
  where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
)), pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);

insert into public.d1_catalog_test_results
select 21, 'HELPER_OUTPUT_SHAPE',
  procedure_row.proargnames[2:7] = array[
    'out_unique_active_task_count', 'out_covered_task_count',
    'out_unassigned_task_count', 'out_inactive_only_task_count',
    'out_active_outside_committee_only_task_count',
    'out_tasks_without_member_bar_count'
  ]
  and procedure_row.proallargtypes[2:7] = array[
    'int8'::regtype::oid, 'int8'::regtype::oid, 'int8'::regtype::oid,
    'int8'::regtype::oid, 'int8'::regtype::oid, 'int8'::regtype::oid
  ],
  procedure_row.proargnames::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure;
insert into public.d1_catalog_test_results
select 22, 'LEVEL1_OUTPUT_SHAPE',
  procedure_row.proargnames = array[
    'out_committee_id', 'out_committee_name',
    'out_unique_active_task_count', 'out_covered_task_count',
    'out_unassigned_task_count', 'out_inactive_only_task_count',
    'out_active_outside_committee_only_task_count',
    'out_tasks_without_member_bar_count'
  ],
  procedure_row.proargnames::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'public.list_executive_dashboard_committee_totals()'::regprocedure;
insert into public.d1_catalog_test_results
select 23, 'SUMMARY_OUTPUT_SHAPE',
  procedure_row.proargnames[2:9] = array[
    'out_committee_id', 'out_committee_name',
    'out_unique_active_task_count', 'out_covered_task_count',
    'out_unassigned_task_count', 'out_inactive_only_task_count',
    'out_active_outside_committee_only_task_count',
    'out_tasks_without_member_bar_count'
  ],
  procedure_row.proargnames::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure;
insert into public.d1_catalog_test_results
select 24, 'MEMBERS_OUTPUT_SHAPE',
  procedure_row.proargnames[2:6] = array[
    'out_committee_id', 'out_member_id', 'out_full_name',
    'out_avatar_url', 'out_active_task_count'
  ],
  procedure_row.proargnames::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'public.list_executive_dashboard_committee_members(uuid)'::regprocedure;

insert into public.d1_catalog_test_results
select 25, 'NO_D1_TABLE', not exists (
  select 1 from pg_catalog.pg_class as relation_row
  join pg_catalog.pg_namespace as namespace_row on namespace_row.oid = relation_row.relnamespace
  where namespace_row.nspname in ('public', 'ceit_connect_private')
    and relation_row.relkind in ('r', 'p')
    and relation_row.relname like '%executive_dashboard%'
), 'no dashboard table';
insert into public.d1_catalog_test_results
select 26, 'NO_D1_FOREIGN_KEY', not exists (
  select 1 from pg_catalog.pg_constraint as constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.conname like '%executive_dashboard%'
), 'no dashboard FK';
insert into public.d1_catalog_test_results
select 27, 'NO_TASK_CONTENT_OUTPUT_NAMES', not exists (
  select 1
  from pg_catalog.pg_proc as procedure_row
  cross join lateral pg_catalog.unnest(procedure_row.proargnames) as argument_name(name)
  where procedure_row.oid = any(array[
    'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
    'public.list_executive_dashboard_committee_totals()'::regprocedure,
    'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
    'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
  ])
    and argument_name.name in ('task_id', 'event_id', 'title', 'description', 'phase', 'due_date', 'is_confidential')
), 'no task content output';
insert into public.d1_catalog_test_results
select 28, 'HELPER_HAS_NO_AUTHORIZATION',
  pg_catalog.strpos(procedure_row.prosrc, 'auth.uid()') = 0
  and pg_catalog.strpos(pg_catalog.lower(procedure_row.prosrc), 'access denied') = 0,
  'helper has no auth branch'
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure;
insert into public.d1_catalog_test_results
select 29, 'READERS_TAKE_NO_LOCKS', pg_catalog.bool_and(
  pg_catalog.strpos(pg_catalog.lower(procedure_row.prosrc), 'for update') = 0
  and pg_catalog.strpos(pg_catalog.lower(procedure_row.prosrc), 'for share') = 0
  and pg_catalog.strpos(pg_catalog.lower(procedure_row.prosrc), 'advisory') = 0
), pg_catalog.count(*)::text
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = any(array[
  'ceit_connect_private.executive_dashboard_committee_counts(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_totals()'::regprocedure,
  'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure,
  'public.list_executive_dashboard_committee_members(uuid)'::regprocedure
]);
insert into public.d1_catalog_test_results
select 30, 'LEVEL1_AUTHORIZES_BEFORE_HELPER',
  pg_catalog.strpos(procedure_row.prosrc, 'Executive Dashboard access denied.') > 0
  and pg_catalog.strpos(procedure_row.prosrc, 'Executive Dashboard access denied.')
      < pg_catalog.strpos(procedure_row.prosrc, 'executive_dashboard_committee_counts'),
  'authorization precedes helper'
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'public.list_executive_dashboard_committee_totals()'::regprocedure;
insert into public.d1_catalog_test_results
select 31, 'SUMMARY_AUTHORIZES_BEFORE_HELPER',
  pg_catalog.strpos(procedure_row.prosrc, 'Executive Dashboard access denied.') > 0
  and pg_catalog.strpos(procedure_row.prosrc, 'Executive Dashboard access denied.')
      < pg_catalog.strpos(procedure_row.prosrc, 'executive_dashboard_committee_counts'),
  'authorization precedes helper'
from pg_catalog.pg_proc as procedure_row
where procedure_row.oid = 'public.get_executive_dashboard_committee_summary(uuid)'::regprocedure;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'd2100000-0000-4000-8000-000000000001', true);
insert into public.d1_catalog_test_results
select 32, 'AUTHENTICATED_FIXTURE_CALLS_PUBLIC_NOT_PRIVATE',
  summary.out_unique_active_task_count = 0
  and not pg_catalog.has_function_privilege(
    'authenticated'::name,
    (
      select procedure_row.oid
      from pg_catalog.pg_proc as procedure_row
      join pg_catalog.pg_namespace as namespace_row
        on namespace_row.oid = procedure_row.pronamespace
      where namespace_row.nspname = 'ceit_connect_private'
        and procedure_row.proname = 'executive_dashboard_committee_counts'
    ),
    'EXECUTE'
  ),
  'public summary returned; helper remains uncallable'
from public.get_executive_dashboard_committee_summary('d2000000-0000-4000-8000-000000000001') as summary;
reset role;

select ordinal, label, passed, detail
from public.d1_catalog_test_results
order by ordinal;

do $$
declare
  v_total integer;
  v_passed integer;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where result.passed)::integer
  into v_total, v_passed
  from public.d1_catalog_test_results as result;

  if v_total = 32 and v_passed = 32 then
    raise exception 'TEST RESULTS 32/32 PASS — transaction intentionally rolled back';
  end if;

  raise exception 'TEST RESULTS %/32 PASS — transaction intentionally rolled back',
    v_passed;
end
$$;
```
