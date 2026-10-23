# Phase 4 Step 10 — hardening and gate tests

## 10A — read-only live Dev catalog inventory

Run this paste only in the **Dev** Supabase SQL Editor. It is read-only: every statement is a `SELECT`, and it reads only `pg_proc`, `pg_class`, `pg_policies`, `pg_trigger`, and `information_schema` views. It does not impersonate a user because it inspects catalog metadata rather than application RLS behavior.

Expected result sets, in order:

1. **57 function rows** with columns `function_signature`, `owner`, `security_mode`, `volatility`, `settings`, `public_execute`, `anon_execute`, and `authenticated_execute`. Every `settings` value must contain `search_path=""`; every owner must be `postgres`. Exactly 35 rows should have `authenticated_execute = true`; all `public_execute` and `anon_execute` values must be false.
2. **8 table rows** with RLS flags and effective authenticated privileges. Every `rls_enabled` value must be true. The four child tables must show `NONE`; the paste deliberately reports existing effective privileges on `events`, `tasks`, `notifications`, and `activity_log` rather than assuming they are empty.
3. **11 policy rows**: four on `events`, four on `tasks`, two on `notifications`, and one on `activity_log`. The four Phase 4 child tables must contribute none.
4. **20 trigger rows**. Every `enabled_state` must be `ENABLED`; the three Active-event invariant triggers must show `deferrable = true` and `initially_deferred = true`.
5. **0 overload rows**. Any row here means a Phase 4 function name has more than one live signature and must be investigated.

If any count differs, preserve the result and stop; do not change the database.

```sql
-- RESULT 1: Phase 4 functions and effective execute privileges (57 rows).
with phase4_function_names(function_name) as (
  values
    ('accept_task_volunteer'),
    ('add_task_comment'),
    ('add_task_work_link'),
    ('archive_event'),
    ('assign_task_creation_metadata'),
    ('assign_task_people'),
    ('calculate_effective_task_priority'),
    ('claim_task'),
    ('delete_task'),
    ('delete_task_comment'),
    ('edit_event_with_tasks'),
    ('edit_task_comment'),
    ('get_archived_task_share_controls'),
    ('get_task'),
    ('get_task_backup_state'),
    ('get_task_detail'),
    ('get_task_edit_controls'),
    ('get_task_work_links'),
    ('grant_archived_task_viewer'),
    ('guard_archived_event_task_writes'),
    ('guard_archived_task_viewer_writes'),
    ('guard_referenced_prerequisite_deletion'),
    ('guard_task_comment_writes'),
    ('guard_task_volunteer_writes'),
    ('guard_task_work_link_updates'),
    ('guard_task_work_link_writes'),
    ('list_active_task_assignees_with_workload'),
    ('list_event_board_tasks'),
    ('list_help_wanted_tasks'),
    ('list_my_tasks'),
    ('list_task_comment_mention_candidates'),
    ('list_task_comments'),
    ('log_task_activity'),
    ('move_task'),
    ('normalize_task_comment_mentions'),
    ('prepare_unassigned_task_reset'),
    ('reject_task_created_by_changes'),
    ('reject_task_event_id_changes'),
    ('remove_task_work_link'),
    ('restrict_assignee_task_updates'),
    ('revoke_archived_task_viewer'),
    ('set_task_backup_request'),
    ('set_task_confidentiality'),
    ('set_task_dependency'),
    ('set_task_destination_lane_order'),
    ('task_comment_mentions_are_valid'),
    ('task_comment_trim_body'),
    ('task_content_access'),
    ('task_content_access_for_user'),
    ('task_dependency_allows_forward_move'),
    ('task_dependency_lock_key'),
    ('task_lane_tail_sort_order'),
    ('task_work_link_url_is_canonical'),
    ('unassign_self'),
    ('validate_task_dependency'),
    ('volunteer_for_task'),
    ('withdraw_task_volunteer')
)
select
  format(
    'public.%I(%s)',
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid)
  ) as function_signature,
  p.proowner::regrole::text as owner,
  case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end
    as security_mode,
  case p.provolatile
    when 'i' then 'IMMUTABLE'
    when 's' then 'STABLE'
    else 'VOLATILE'
  end as volatility,
  coalesce(array_to_string(p.proconfig, ', '), '<unset>') as settings,
  coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))::text
    ~ '(^\{|,)=X/' as public_execute,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    as authenticated_execute
from pg_catalog.pg_proc p
join phase4_function_names expected on expected.function_name = p.proname
where p.pronamespace = 'public'::regnamespace
order by p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- RESULT 2: reviewed tables, RLS, and effective authenticated privileges (8 rows).
with reviewed_tables(table_name) as (
  values
    ('events'),
    ('tasks'),
    ('task_work_links'),
    ('task_volunteers'),
    ('task_comments'),
    ('archived_task_viewers'),
    ('notifications'),
    ('activity_log')
)
select
  format('public.%I', c.relname) as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  nullif(
    concat_ws(', ',
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') then 'SELECT' end,
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT') then 'INSERT' end,
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE') then 'UPDATE' end,
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE') then 'DELETE' end,
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'TRUNCATE') then 'TRUNCATE' end,
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'REFERENCES') then 'REFERENCES' end,
      case when pg_catalog.has_table_privilege('authenticated', c.oid, 'TRIGGER') then 'TRIGGER' end
    ),
    ''
  ) as authenticated_effective_privileges,
  coalesce((
    select string_agg(g.privilege_type, ', ' order by g.privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = c.relname
      and g.grantee = 'authenticated'
  ), 'NONE') as authenticated_direct_grants
from pg_catalog.pg_class c
join reviewed_tables expected on expected.table_name = c.relname
where c.relnamespace = 'public'::regnamespace
  and c.relkind in ('r', 'p')
order by c.relname;

-- RESULT 3: every policy on the reviewed tables (11 rows).
with reviewed_tables(table_name) as (
  values
    ('events'),
    ('tasks'),
    ('task_work_links'),
    ('task_volunteers'),
    ('task_comments'),
    ('archived_task_viewers'),
    ('notifications'),
    ('activity_log')
)
select
  format('%I.%I', p.schemaname, p.tablename) as table_name,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual as using_expression,
  p.with_check as with_check_expression
from pg_catalog.pg_policies p
join reviewed_tables expected on expected.table_name = p.tablename
where p.schemaname = 'public'
order by p.tablename, p.policyname;

-- RESULT 4: every non-internal trigger on the reviewed tables (20 rows).
with reviewed_tables(table_name) as (
  values
    ('events'),
    ('tasks'),
    ('task_work_links'),
    ('task_volunteers'),
    ('task_comments'),
    ('archived_task_viewers'),
    ('notifications'),
    ('activity_log')
)
select
  t.tgname as trigger_name,
  format('public.%I', c.relname) as table_name,
  t.tgfoid::regprocedure::text as function_signature,
  case
    when (t.tgtype & 2) = 2 then 'BEFORE'
    when (t.tgtype & 64) = 64 then 'INSTEAD OF'
    else 'AFTER'
  end as timing,
  concat_ws(' OR ',
    case when (t.tgtype & 4) = 4 then 'INSERT' end,
    case when (t.tgtype & 16) = 16 then 'UPDATE' end,
    case when (t.tgtype & 8) = 8 then 'DELETE' end,
    case when (t.tgtype & 32) = 32 then 'TRUNCATE' end
  ) as events,
  case when (t.tgtype & 1) = 1 then 'ROW' else 'STATEMENT' end as level,
  case t.tgenabled
    when 'O' then 'ENABLED'
    when 'D' then 'DISABLED'
    when 'R' then 'REPLICA'
    when 'A' then 'ALWAYS'
  end as enabled_state,
  t.tgdeferrable as deferrable,
  t.tginitdeferred as initially_deferred
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join reviewed_tables expected on expected.table_name = c.relname
where c.relnamespace = 'public'::regnamespace
  and not t.tgisinternal
order by c.relname, t.tgname;

-- RESULT 5: unexpected overloaded Phase 4 function names (0 rows).
with phase4_function_names(function_name) as (
  values
    ('accept_task_volunteer'), ('add_task_comment'), ('add_task_work_link'),
    ('archive_event'), ('assign_task_creation_metadata'), ('assign_task_people'),
    ('calculate_effective_task_priority'), ('claim_task'), ('delete_task'),
    ('delete_task_comment'), ('edit_event_with_tasks'), ('edit_task_comment'),
    ('get_archived_task_share_controls'), ('get_task'), ('get_task_backup_state'),
    ('get_task_detail'), ('get_task_edit_controls'), ('get_task_work_links'),
    ('grant_archived_task_viewer'), ('guard_archived_event_task_writes'),
    ('guard_archived_task_viewer_writes'),
    ('guard_referenced_prerequisite_deletion'), ('guard_task_comment_writes'),
    ('guard_task_volunteer_writes'), ('guard_task_work_link_updates'),
    ('guard_task_work_link_writes'),
    ('list_active_task_assignees_with_workload'), ('list_event_board_tasks'),
    ('list_help_wanted_tasks'), ('list_my_tasks'),
    ('list_task_comment_mention_candidates'), ('list_task_comments'),
    ('log_task_activity'), ('move_task'), ('normalize_task_comment_mentions'),
    ('prepare_unassigned_task_reset'), ('reject_task_created_by_changes'),
    ('reject_task_event_id_changes'), ('remove_task_work_link'),
    ('restrict_assignee_task_updates'), ('revoke_archived_task_viewer'),
    ('set_task_backup_request'), ('set_task_confidentiality'),
    ('set_task_dependency'), ('set_task_destination_lane_order'),
    ('task_comment_mentions_are_valid'), ('task_comment_trim_body'),
    ('task_content_access'), ('task_content_access_for_user'),
    ('task_dependency_allows_forward_move'), ('task_dependency_lock_key'),
    ('task_lane_tail_sort_order'), ('task_work_link_url_is_canonical'),
    ('unassign_self'), ('validate_task_dependency'), ('volunteer_for_task'),
    ('withdraw_task_volunteer')
)
select
  p.proname as function_name,
  count(*) as signature_count,
  string_agg(
    format(
      'public.%I(%s)',
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid)
    ),
    E'\n' order by pg_catalog.pg_get_function_identity_arguments(p.oid)
  ) as signatures
from pg_catalog.pg_proc p
join phase4_function_names expected on expected.function_name = p.proname
where p.pronamespace = 'public'::regnamespace
group by p.proname
having count(*) > 1
order by p.proname;
```

## 10B-1 — Step 1A post-fix denial and direct-SELECT matrix

This is a fresh gate regression for the contracts covered by Step 1A TEST 1
(the former pre-fix leak), TEST 4 (inactive/profile-less denial), TEST 7 (the
full direct-`SELECT` matrix), and TEST 8 (sharing flags grant no raw access).
It references those tests rather than copying their fixtures or SQL.

Run this entire paste on **Dev** with **Run without RLS**. The intentional final
exception must contain exactly **10 result lines**, all `PASS`. It creates its
own Auth/profile fixtures and rolls every change back.

```sql
begin;

do $$
declare
  v_committees uuid[];
begin
  select array_agg(c.id order by c.name)
  into v_committees
  from public.committees c;

  if coalesce(cardinality(v_committees), 0) < 2 then
    raise exception '10B-1 requires at least two committees.';
  end if;

  perform set_config('test.s10b1_committee_one', v_committees[1]::text, true);
  perform set_config('test.s10b1_committee_two', v_committees[2]::text, true);
end
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('10b10000-0000-4000-8000-000000000001'::uuid, 's10b1-admin@test.local'),
  ('10b10000-0000-4000-8000-000000000002'::uuid, 's10b1-co-one@test.local'),
  ('10b10000-0000-4000-8000-000000000003'::uuid, 's10b1-co-two@test.local'),
  ('10b10000-0000-4000-8000-000000000004'::uuid, 's10b1-primary@test.local'),
  ('10b10000-0000-4000-8000-000000000005'::uuid, 's10b1-assist@test.local'),
  ('10b10000-0000-4000-8000-000000000006'::uuid, 's10b1-unassigned@test.local'),
  ('10b10000-0000-4000-8000-000000000007'::uuid, 's10b1-viewer@test.local'),
  ('10b10000-0000-4000-8000-000000000008'::uuid, 's10b1-inactive@test.local'),
  ('10b10000-0000-4000-8000-000000000009'::uuid, 's10b1-profileless@test.local')
) fixture(id, email);

insert into public.users (
  id, email, full_name, role, committee_id, is_active
)
select
  fixture.id,
  fixture.email,
  fixture.full_name,
  fixture.role,
  case fixture.committee_number
    when 1 then current_setting('test.s10b1_committee_one')::uuid
    when 2 then current_setting('test.s10b1_committee_two')::uuid
    else null
  end,
  fixture.is_active
from (values
  ('10b10000-0000-4000-8000-000000000001'::uuid, 's10b1-admin@test.local', '10B1 Admin', 'Admin', 0, true),
  ('10b10000-0000-4000-8000-000000000002'::uuid, 's10b1-co-one@test.local', '10B1 Co One', 'Co-Admin', 1, true),
  ('10b10000-0000-4000-8000-000000000003'::uuid, 's10b1-co-two@test.local', '10B1 Co Two', 'Co-Admin', 2, true),
  ('10b10000-0000-4000-8000-000000000004'::uuid, 's10b1-primary@test.local', '10B1 Primary', 'Member', 1, true),
  ('10b10000-0000-4000-8000-000000000005'::uuid, 's10b1-assist@test.local', '10B1 Assist', 'Member', 1, true),
  ('10b10000-0000-4000-8000-000000000006'::uuid, 's10b1-unassigned@test.local', '10B1 Unassigned', 'Member', 1, true),
  ('10b10000-0000-4000-8000-000000000007'::uuid, 's10b1-viewer@test.local', '10B1 Viewer', 'Member', 1, true),
  ('10b10000-0000-4000-8000-000000000008'::uuid, 's10b1-inactive@test.local', '10B1 Inactive Admin', 'Admin', 0, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (
  id, name, start_date, end_date, status, created_by
)
values
  ('10b11000-0000-4000-8000-000000000001', '10B1 Active One', '2026-11-01', '2026-11-02', 'Active', '10b10000-0000-4000-8000-000000000001'),
  ('10b11000-0000-4000-8000-000000000002', '10B1 Active Two', '2026-11-03', '2026-11-04', 'Active', '10b10000-0000-4000-8000-000000000001'),
  ('10b11000-0000-4000-8000-000000000003', '10B1 Draft One', '2026-11-05', '2026-11-06', 'Draft', '10b10000-0000-4000-8000-000000000001'),
  ('10b11000-0000-4000-8000-000000000004', '10B1 Archive Source', '2026-11-07', '2026-11-08', 'Active', '10b10000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, description, status,
  primary_assignees, assist_assignees, is_confidential,
  request_backup, allowed_viewers
)
values
  ('10b12000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000001', current_setting('test.s10b1_committee_one')::uuid, '10B1 active one public', 'raw content one', 'To Do', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[]),
  ('10b12000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000001', current_setting('test.s10b1_committee_one')::uuid, '10B1 former leak target', 'must stay raw-hidden', 'To Do', array['10b10000-0000-4000-8000-000000000004'::uuid], array['10b10000-0000-4000-8000-000000000005'::uuid], true, true, array['10b10000-0000-4000-8000-000000000007'::uuid]),
  ('10b12000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000002', current_setting('test.s10b1_committee_two')::uuid, '10B1 active two public', 'raw content three', 'To Do', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[]),
  ('10b12000-0000-4000-8000-000000000004', '10b11000-0000-4000-8000-000000000002', current_setting('test.s10b1_committee_two')::uuid, '10B1 active two confidential', 'raw content four', 'To Do', '{}'::uuid[], '{}'::uuid[], true, false, '{}'::uuid[]),
  ('10b12000-0000-4000-8000-000000000005', '10b11000-0000-4000-8000-000000000003', current_setting('test.s10b1_committee_one')::uuid, '10B1 draft assigned', 'draft raw content', 'To Do', array['10b10000-0000-4000-8000-000000000004'::uuid], array['10b10000-0000-4000-8000-000000000005'::uuid], false, false, '{}'::uuid[]),
  ('10b12000-0000-4000-8000-000000000006', '10b11000-0000-4000-8000-000000000004', current_setting('test.s10b1_committee_two')::uuid, '10B1 archived public', 'archived public raw content', 'To Do', '{}'::uuid[], '{}'::uuid[], false, false, '{}'::uuid[]),
  ('10b12000-0000-4000-8000-000000000007', '10b11000-0000-4000-8000-000000000004', current_setting('test.s10b1_committee_one')::uuid, '10B1 archived confidential', 'archived confidential raw content', 'To Do', array['10b10000-0000-4000-8000-000000000004'::uuid], array['10b10000-0000-4000-8000-000000000005'::uuid], true, false, '{}'::uuid[]);

update public.events
set status = 'Archived'
where id = '10b11000-0000-4000-8000-000000000004';

set constraints all immediate;
select set_config('test.s10b1_results', '', true);

-- Former Step 1A leak: allowed_viewers/request_backup still grant no raw row.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen
  from (select title, description from public.tasks
        where id = '10b12000-0000-4000-8000-000000000002') direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nPOST_FIX_BACKUP_VIEWER_LEAK_DENIED: %s', case when rows_seen = 0 then 'PASS' else 'FAIL (got ' || rows_seen || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen
  from (select title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nADMIN_SEES_ALL_SEVEN_RAW_ROWS: %s', case when rows_seen = 7 then 'PASS' else 'FAIL (got ' || rows_seen || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen,
    count(*) filter (where id not in ('10b12000-0000-4000-8000-000000000001', '10b12000-0000-4000-8000-000000000002', '10b12000-0000-4000-8000-000000000005', '10b12000-0000-4000-8000-000000000006', '10b12000-0000-4000-8000-000000000007'))::integer as unexpected
  from (select id, title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nOWNING_COADMIN_SEES_FIVE_EXPECTED_ROWS: %s', case when rows_seen = 5 and unexpected = 0 then 'PASS' else 'FAIL (rows=' || rows_seen || ', unexpected=' || unexpected || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen,
    count(*) filter (where id not in ('10b12000-0000-4000-8000-000000000003', '10b12000-0000-4000-8000-000000000004', '10b12000-0000-4000-8000-000000000006'))::integer as unexpected
  from (select id, title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nOTHER_SCOPE_COADMIN_SEES_THREE_EXPECTED_ROWS: %s', case when rows_seen = 3 and unexpected = 0 then 'PASS' else 'FAIL (rows=' || rows_seen || ', unexpected=' || unexpected || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen,
    count(*) filter (where id not in ('10b12000-0000-4000-8000-000000000002', '10b12000-0000-4000-8000-000000000006', '10b12000-0000-4000-8000-000000000007'))::integer as unexpected
  from (select id, title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nPRIMARY_SEES_NON_DRAFT_ASSIGNMENTS_AND_ARCHIVED_PUBLIC: %s', case when rows_seen = 3 and unexpected = 0 then 'PASS' else 'FAIL (rows=' || rows_seen || ', unexpected=' || unexpected || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen,
    count(*) filter (where id not in ('10b12000-0000-4000-8000-000000000002', '10b12000-0000-4000-8000-000000000006', '10b12000-0000-4000-8000-000000000007'))::integer as unexpected
  from (select id, title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nASSIST_SEES_NON_DRAFT_ASSIGNMENTS_AND_ARCHIVED_PUBLIC: %s', case when rows_seen = 3 and unexpected = 0 then 'PASS' else 'FAIL (rows=' || rows_seen || ', unexpected=' || unexpected || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen,
    count(*) filter (where id <> '10b12000-0000-4000-8000-000000000006')::integer as unexpected
  from (select id, title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nUNASSIGNED_MEMBER_SEES_ONLY_ARCHIVED_PUBLIC: %s', case when rows_seen = 1 and unexpected = 0 then 'PASS' else 'FAIL (rows=' || rows_seen || ', unexpected=' || unexpected || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen,
    count(*) filter (where id <> '10b12000-0000-4000-8000-000000000006')::integer as unexpected
  from (select id, title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nALLOWED_VIEWER_SEES_ONLY_ARCHIVED_PUBLIC_RAW: %s', case when rows_seen = 1 and unexpected = 0 then 'PASS' else 'FAIL (rows=' || rows_seen || ', unexpected=' || unexpected || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000008', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen
  from (select title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nINACTIVE_ADMIN_SEES_ZERO_RAW_ROWS: %s', case when rows_seen = 0 then 'PASS' else 'FAIL (got ' || rows_seen || ')' end), true)
from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b10000-0000-4000-8000-000000000009', 'role', 'authenticated')::text, true);
with observed as (
  select count(*)::integer as rows_seen
  from (select title, description from public.tasks where event_id in ('10b11000-0000-4000-8000-000000000001', '10b11000-0000-4000-8000-000000000002', '10b11000-0000-4000-8000-000000000003', '10b11000-0000-4000-8000-000000000004')) direct_raw
)
select set_config('test.s10b1_results', current_setting('test.s10b1_results') ||
  format(E'\nPROFILELESS_AUTHENTICATED_CALLER_SEES_ZERO_RAW_ROWS: %s', case when rows_seen = 0 then 'PASS' else 'FAIL (got ' || rows_seen || ')' end), true)
from observed;

reset role;
set constraints all immediate;

do $$
begin
  raise exception 'TEST RESULTS %', current_setting('test.s10b1_results');
end
$$;
```

## 10B-2 — raw UPDATE/DELETE matrix and non-authorization

This is a fresh gate regression for Step 1A TEST 5. It extends that contract
with both Co-Admin scopes, both assignee arrays, unassigned/viewer callers, and
the explicit rule that `created_by` is provenance rather than authorization.
It references the earlier test rather than copying its fixtures or SQL.

Run this entire paste on **Dev** with **Run without RLS**. The intentional final
exception must contain exactly **16 result lines**, all `PASS`. Every denial is
asserted through exact affected-row counts; the assignee-column exception also
asserts its SQLSTATE, exact message, and unchanged stored title.

```sql
begin;

do $$
declare
  v_committees uuid[];
begin
  select array_agg(c.id order by c.name)
  into v_committees
  from public.committees c;

  if coalesce(cardinality(v_committees), 0) < 2 then
    raise exception '10B-2 requires at least two committees.';
  end if;

  perform set_config('test.s10b2_committee_one', v_committees[1]::text, true);
  perform set_config('test.s10b2_committee_two', v_committees[2]::text, true);
end
$$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('10b20000-0000-4000-8000-000000000001'::uuid, 's10b2-admin@test.local'),
  ('10b20000-0000-4000-8000-000000000002'::uuid, 's10b2-co-one@test.local'),
  ('10b20000-0000-4000-8000-000000000003'::uuid, 's10b2-co-two@test.local'),
  ('10b20000-0000-4000-8000-000000000004'::uuid, 's10b2-primary@test.local'),
  ('10b20000-0000-4000-8000-000000000005'::uuid, 's10b2-assist@test.local'),
  ('10b20000-0000-4000-8000-000000000006'::uuid, 's10b2-unassigned@test.local'),
  ('10b20000-0000-4000-8000-000000000007'::uuid, 's10b2-viewer@test.local'),
  ('10b20000-0000-4000-8000-000000000008'::uuid, 's10b2-creator@test.local'),
  ('10b20000-0000-4000-8000-000000000009'::uuid, 's10b2-inactive@test.local'),
  ('10b20000-0000-4000-8000-00000000000a'::uuid, 's10b2-profileless@test.local')
) fixture(id, email);

insert into public.users (
  id, email, full_name, role, committee_id, is_active
)
select
  fixture.id,
  fixture.email,
  fixture.full_name,
  fixture.role,
  case fixture.committee_number
    when 1 then current_setting('test.s10b2_committee_one')::uuid
    when 2 then current_setting('test.s10b2_committee_two')::uuid
    else null
  end,
  fixture.is_active
from (values
  ('10b20000-0000-4000-8000-000000000001'::uuid, 's10b2-admin@test.local', '10B2 Admin', 'Admin', 0, true),
  ('10b20000-0000-4000-8000-000000000002'::uuid, 's10b2-co-one@test.local', '10B2 Co One', 'Co-Admin', 1, true),
  ('10b20000-0000-4000-8000-000000000003'::uuid, 's10b2-co-two@test.local', '10B2 Co Two', 'Co-Admin', 2, true),
  ('10b20000-0000-4000-8000-000000000004'::uuid, 's10b2-primary@test.local', '10B2 Primary', 'Member', 1, true),
  ('10b20000-0000-4000-8000-000000000005'::uuid, 's10b2-assist@test.local', '10B2 Assist', 'Member', 1, true),
  ('10b20000-0000-4000-8000-000000000006'::uuid, 's10b2-unassigned@test.local', '10B2 Unassigned', 'Member', 1, true),
  ('10b20000-0000-4000-8000-000000000007'::uuid, 's10b2-viewer@test.local', '10B2 Viewer', 'Member', 1, true),
  ('10b20000-0000-4000-8000-000000000008'::uuid, 's10b2-creator@test.local', '10B2 Creator', 'Member', 1, true),
  ('10b20000-0000-4000-8000-000000000009'::uuid, 's10b2-inactive@test.local', '10B2 Inactive Admin', 'Admin', 0, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (
  id, name, start_date, end_date, status, created_by
)
values (
  '10b21000-0000-4000-8000-000000000001',
  '10B2 raw write matrix',
  '2026-11-10',
  '2026-11-11',
  'Active',
  '10b20000-0000-4000-8000-000000000008'
);

insert into public.tasks (
  id, event_id, committee_id, title, status,
  primary_assignees, assist_assignees, request_backup, allowed_viewers
)
values
  ('10b22000-0000-4000-8000-000000000001', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 admin update', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000002', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 admin delete', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000003', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 co update', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000004', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 co delete', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000005', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 other co update', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000006', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 other co delete', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000007', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 primary status', 'To Do', array['10b20000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000008', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 primary delete denied', 'To Do', array['10b20000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000009', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 assist status', 'To Do', '{}'::uuid[], array['10b20000-0000-4000-8000-000000000005'::uuid], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-00000000000a', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 assist delete denied', 'To Do', '{}'::uuid[], array['10b20000-0000-4000-8000-000000000005'::uuid], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-00000000000b', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 assignee guard original', 'To Do', array['10b20000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-00000000000c', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 unassigned denied', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-00000000000d', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 viewer denied', 'To Do', '{}'::uuid[], '{}'::uuid[], true, array['10b20000-0000-4000-8000-000000000007'::uuid]),
  ('10b22000-0000-4000-8000-00000000000e', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 creator denied', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-00000000000f', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 inactive denied', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000010', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 profileless denied', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]),
  ('10b22000-0000-4000-8000-000000000011', '10b21000-0000-4000-8000-000000000001', current_setting('test.s10b2_committee_one')::uuid, '10B2 invariant spare', 'To Do', '{}'::uuid[], '{}'::uuid[], false, '{}'::uuid[]);

set constraints all immediate;
select set_config('test.s10b2_results', '', true);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
with changed as (
  update public.tasks set priority = 'High'
  where id = '10b22000-0000-4000-8000-000000000001' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nADMIN_UPDATE_EXACTLY_ONE: %s', case when affected = 1 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
with changed as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-000000000002' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nADMIN_DELETE_EXACTLY_ONE: %s', case when affected = 1 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
with changed as (
  update public.tasks set priority = 'Critical'
  where id = '10b22000-0000-4000-8000-000000000003' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nOWNING_COADMIN_UPDATE_EXACTLY_ONE: %s', case when affected = 1 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
with changed as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-000000000004' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nOWNING_COADMIN_DELETE_EXACTLY_ONE: %s', case when affected = 1 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
with changed as (
  update public.tasks set priority = 'Low'
  where id = '10b22000-0000-4000-8000-000000000005' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nOTHER_SCOPE_COADMIN_UPDATE_ZERO: %s', case when affected = 0 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
with changed as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-000000000006' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nOTHER_SCOPE_COADMIN_DELETE_ZERO: %s', case when affected = 0 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
with changed as (
  update public.tasks set status = 'In Progress'
  where id = '10b22000-0000-4000-8000-000000000007' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nPRIMARY_STATUS_UPDATE_EXACTLY_ONE: %s', case when affected = 1 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
with changed as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-000000000008' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nPRIMARY_DELETE_ZERO: %s', case when affected = 0 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
with changed as (
  update public.tasks set status = 'In Progress'
  where id = '10b22000-0000-4000-8000-000000000009' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nASSIST_STATUS_UPDATE_EXACTLY_ONE: %s', case when affected = 1 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
with changed as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-00000000000a' returning 1
), observed as (select count(*)::integer as affected from changed)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nASSIST_DELETE_ZERO: %s', case when affected = 0 then 'PASS' else 'FAIL (got ' || affected || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
do $$
declare
  v_code text := 'NO_ERROR';
  v_message text := 'NO_ERROR';
  v_title text;
begin
  begin
    update public.tasks
    set title = '10B2 forged title'
    where id = '10b22000-0000-4000-8000-00000000000b';
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate, v_message = message_text;
  end;

  select task_row.title into v_title
  from public.tasks task_row
  where task_row.id = '10b22000-0000-4000-8000-00000000000b';

  perform set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
    format(E'\nASSIGNEE_COLUMN_GUARD_EXACT_ERROR_AND_UNCHANGED: %s',
      case when v_code = 'P0001'
                 and v_message = 'Assignees can only update a task''s status.'
                 and v_title = '10B2 assignee guard original'
           then 'PASS'
           else format('FAIL (code=%s message=%s title=%s)', v_code, v_message, coalesce(v_title, 'null'))
      end), true);
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
with changed_update as (
  update public.tasks set priority = 'Low'
  where id = '10b22000-0000-4000-8000-00000000000c' returning 1
), changed_delete as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-00000000000c' returning 1
), observed as (
  select (select count(*) from changed_update)::integer as updates,
    (select count(*) from changed_delete)::integer as deletes
)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nUNASSIGNED_MEMBER_UPDATE_DELETE_ZERO: %s', case when updates = 0 and deletes = 0 then 'PASS' else 'FAIL (updates=' || updates || ', deletes=' || deletes || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
with changed_update as (
  update public.tasks set priority = 'Low'
  where id = '10b22000-0000-4000-8000-00000000000d' returning 1
), changed_delete as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-00000000000d' returning 1
), observed as (
  select (select count(*) from changed_update)::integer as updates,
    (select count(*) from changed_delete)::integer as deletes
)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nALLOWED_VIEWER_UPDATE_DELETE_ZERO: %s', case when updates = 0 and deletes = 0 then 'PASS' else 'FAIL (updates=' || updates || ', deletes=' || deletes || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000008', 'role', 'authenticated')::text, true);
with changed_update as (
  update public.tasks set priority = 'Low'
  where id = '10b22000-0000-4000-8000-00000000000e' returning 1
), changed_delete as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-00000000000e' returning 1
), observed as (
  select (select count(*) from changed_update)::integer as updates,
    (select count(*) from changed_delete)::integer as deletes
)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nCREATOR_PROVENANCE_UPDATE_DELETE_ZERO: %s', case when updates = 0 and deletes = 0 then 'PASS' else 'FAIL (updates=' || updates || ', deletes=' || deletes || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-000000000009', 'role', 'authenticated')::text, true);
with changed_update as (
  update public.tasks set priority = 'Low'
  where id = '10b22000-0000-4000-8000-00000000000f' returning 1
), changed_delete as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-00000000000f' returning 1
), observed as (
  select (select count(*) from changed_update)::integer as updates,
    (select count(*) from changed_delete)::integer as deletes
)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nINACTIVE_ADMIN_UPDATE_DELETE_ZERO: %s', case when updates = 0 and deletes = 0 then 'PASS' else 'FAIL (updates=' || updates || ', deletes=' || deletes || ')' end), true) from observed;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '10b20000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
with changed_update as (
  update public.tasks set priority = 'Low'
  where id = '10b22000-0000-4000-8000-000000000010' returning 1
), changed_delete as (
  delete from public.tasks where id = '10b22000-0000-4000-8000-000000000010' returning 1
), observed as (
  select (select count(*) from changed_update)::integer as updates,
    (select count(*) from changed_delete)::integer as deletes
)
select set_config('test.s10b2_results', current_setting('test.s10b2_results') ||
  format(E'\nPROFILELESS_AUTHENTICATED_UPDATE_DELETE_ZERO: %s', case when updates = 0 and deletes = 0 then 'PASS' else 'FAIL (updates=' || updates || ', deletes=' || deletes || ')' end), true) from observed;

reset role;
set constraints all immediate;

do $$
begin
  raise exception 'TEST RESULTS %', current_setting('test.s10b2_results');
end
$$;
```
