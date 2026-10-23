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

## 10C-1 — current confidential access everywhere

Referenced rather than copied: Step 6 TESTS 2–3, Step 7 TEST 3, Step 7B
TESTS 4–5, and Step 9 TESTS 2–3 and 5.

Run this entire paste on **Dev** with **Run without RLS**. The intentional final
exception must contain exactly **18 result lines**, all `PASS`. Expected access
decisions are literal fixture data; `task_content_access_for_user` is an
independent cross-check. Raw `tasks` access deliberately remains narrower for
ordinary and archive-only viewers.

```sql
begin;

do $$
declare v_committees uuid[];
begin
  select array_agg(id order by name) into v_committees from public.committees;
  if coalesce(cardinality(v_committees), 0) < 2 then
    raise exception '10C-1 requires at least two committees.';
  end if;
  perform set_config('test.s10c1_c1', v_committees[1]::text, true);
  perform set_config('test.s10c1_c2', v_committees[2]::text, true);
end $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values
  ('c1010000-0000-4000-8000-000000000001'::uuid,'s10c1-admin@test.local'),
  ('c1010000-0000-4000-8000-000000000002'::uuid,'s10c1-co-own@test.local'),
  ('c1010000-0000-4000-8000-000000000003'::uuid,'s10c1-co-other@test.local'),
  ('c1010000-0000-4000-8000-000000000004'::uuid,'s10c1-assigned@test.local'),
  ('c1010000-0000-4000-8000-000000000005'::uuid,'s10c1-unassigned@test.local'),
  ('c1010000-0000-4000-8000-000000000006'::uuid,'s10c1-allowed@test.local'),
  ('c1010000-0000-4000-8000-000000000007'::uuid,'s10c1-late@test.local'),
  ('c1010000-0000-4000-8000-000000000008'::uuid,'s10c1-inactive@test.local'),
  ('c1010000-0000-4000-8000-000000000009'::uuid,'s10c1-profileless@test.local')
) f(id,email);

insert into public.users (id,email,full_name,role,committee_id,is_active)
select id,email,name,role,
  case committee_no when 1 then current_setting('test.s10c1_c1')::uuid
    when 2 then current_setting('test.s10c1_c2')::uuid end,
  active
from (values
  ('c1010000-0000-4000-8000-000000000001'::uuid,'s10c1-admin@test.local','C1 Admin','Admin',0,true),
  ('c1010000-0000-4000-8000-000000000002'::uuid,'s10c1-co-own@test.local','C1 Co Own','Co-Admin',1,true),
  ('c1010000-0000-4000-8000-000000000003'::uuid,'s10c1-co-other@test.local','C1 Co Other','Co-Admin',2,true),
  ('c1010000-0000-4000-8000-000000000004'::uuid,'s10c1-assigned@test.local','C1 Assigned','Member',1,true),
  ('c1010000-0000-4000-8000-000000000005'::uuid,'s10c1-unassigned@test.local','C1 Unassigned','Member',1,true),
  ('c1010000-0000-4000-8000-000000000006'::uuid,'s10c1-allowed@test.local','C1 Allowed','Member',1,true),
  ('c1010000-0000-4000-8000-000000000007'::uuid,'s10c1-late@test.local','C1 Late','Member',1,true),
  ('c1010000-0000-4000-8000-000000000008'::uuid,'s10c1-inactive@test.local','C1 Inactive','Admin',0,false)
) f(id,email,name,role,committee_no,active);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('c1011000-0000-4000-8000-000000000001','10C1 Draft','2026-11-01','2026-11-02','Draft','c1010000-0000-4000-8000-000000000001'),
  ('c1011000-0000-4000-8000-000000000002','10C1 Active','2026-11-03','2026-11-04','Active','c1010000-0000-4000-8000-000000000001'),
  ('c1011000-0000-4000-8000-000000000003','10C1 Archive','2026-11-05','2026-11-06','Active','c1010000-0000-4000-8000-000000000001'),
  ('c1011000-0000-4000-8000-000000000004','10C1 Other Archive','2026-11-07','2026-11-08','Active','c1010000-0000-4000-8000-000000000001');

insert into public.tasks (
  id,event_id,committee_id,title,status,primary_assignees,is_confidential,
  allowed_viewers,created_by
) values
  ('c1012000-0000-4000-8000-000000000001','c1011000-0000-4000-8000-000000000001',current_setting('test.s10c1_c1')::uuid,'10C1 Draft secret','To Do',array['c1010000-0000-4000-8000-000000000004'::uuid],true,array['c1010000-0000-4000-8000-000000000006'::uuid],'c1010000-0000-4000-8000-000000000001'),
  ('c1012000-0000-4000-8000-000000000002','c1011000-0000-4000-8000-000000000002',current_setting('test.s10c1_c1')::uuid,'10C1 Active secret','To Do',array['c1010000-0000-4000-8000-000000000004'::uuid],true,array['c1010000-0000-4000-8000-000000000006'::uuid],'c1010000-0000-4000-8000-000000000001'),
  ('c1012000-0000-4000-8000-000000000003','c1011000-0000-4000-8000-000000000003',current_setting('test.s10c1_c1')::uuid,'10C1 Archived secret','To Do',array['c1010000-0000-4000-8000-000000000004'::uuid],true,array['c1010000-0000-4000-8000-000000000006'::uuid],'c1010000-0000-4000-8000-000000000001'),
  ('c1012000-0000-4000-8000-000000000004','c1011000-0000-4000-8000-000000000004',current_setting('test.s10c1_c1')::uuid,'10C1 Other archived secret','To Do','{}',true,'{}','c1010000-0000-4000-8000-000000000001');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1010000-0000-4000-8000-000000000001','role','authenticated')::text,true);
select * from public.add_task_comment('c1012000-0000-4000-8000-000000000003','10C1 archived seed');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1010000-0000-4000-8000-000000000004','role','authenticated')::text,true);
select * from public.add_task_work_link('c1012000-0000-4000-8000-000000000003','Seed','https://drive.google.com/file/d/10C1Seed/view');

reset role;
update public.events set status='Archived'
where id in ('c1011000-0000-4000-8000-000000000003','c1011000-0000-4000-8000-000000000004');
set constraints all immediate;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1010000-0000-4000-8000-000000000001','role','authenticated')::text,true);
select public.grant_archived_task_viewer('c1012000-0000-4000-8000-000000000003','c1010000-0000-4000-8000-000000000007');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1010000-0000-4000-8000-000000000001','role','authenticated')::text,true);
select public.grant_archived_task_viewer('c1012000-0000-4000-8000-000000000004','c1010000-0000-4000-8000-000000000007');

reset role;
select set_config('test.s10c1_results','',true);

do $$
declare
  c record; v_ok boolean; v_group jsonb := '{}'::jsonb; v_helper text;
  v_raw integer; v_detail integer; v_masked boolean; v_title text;
  v_comments integer; v_links integer; v_added integer; v_code text; v_message text;
  v_pre_revoke boolean := true;
begin
  for c in select * from (values
    (1,'DRAFT_ADMIN_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000001'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'real',1,'draft'),
    (2,'DRAFT_OWNING_COADMIN_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000002'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'real',1,'draft'),
    (3,'DRAFT_OTHER_COADMIN_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000003'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (4,'DRAFT_ASSIGNED_MEMBER_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000004'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (5,'DRAFT_UNASSIGNED_AND_VIEWER_MEMBERS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000005'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (5,'DRAFT_UNASSIGNED_AND_VIEWER_MEMBERS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000006'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (5,'DRAFT_UNASSIGNED_AND_VIEWER_MEMBERS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000007'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (6,'DRAFT_INACTIVE_AND_PROFILELESS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000008'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (6,'DRAFT_INACTIVE_AND_PROFILELESS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000009'::uuid,'c1012000-0000-4000-8000-000000000001'::uuid,'hidden',0,'draft'),
    (7,'ACTIVE_ADMIN_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000001'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'real',1,'active'),
    (8,'ACTIVE_OWNING_COADMIN_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000002'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'real',1,'active'),
    (9,'ACTIVE_OTHER_COADMIN_MASKED_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000003'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'masked',0,'active'),
    (10,'ACTIVE_ASSIGNED_MEMBER_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000004'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'real',1,'active'),
    (11,'ACTIVE_UNASSIGNED_MEMBER_MASKED_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000005'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'masked',0,'active'),
    (12,'ACTIVE_ALLOWED_VIEWER_REAL_RPCS_RAW_ZERO','c1010000-0000-4000-8000-000000000006'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'real',0,'active'),
    (13,'OTHER_ARCHIVE_SHARE_HOLDER_MASKED_ON_ACTIVE_AND_ACTIVE_SHARE_INSERT_CCS02','c1010000-0000-4000-8000-000000000007'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'masked',0,'active'),
    (14,'ACTIVE_INACTIVE_AND_PROFILELESS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000008'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'hidden',0,'active'),
    (14,'ACTIVE_INACTIVE_AND_PROFILELESS_HIDDEN_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000009'::uuid,'c1012000-0000-4000-8000-000000000002'::uuid,'hidden',0,'active'),
    (15,'ARCHIVED_ADMIN_OWNING_COADMIN_ASSIGNEE_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000001'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'real',1,'archived'),
    (15,'ARCHIVED_ADMIN_OWNING_COADMIN_ASSIGNEE_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000002'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'real',1,'archived'),
    (15,'ARCHIVED_ADMIN_OWNING_COADMIN_ASSIGNEE_REAL_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000004'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'real',1,'archived'),
    (16,'ARCHIVED_UNAUTHORIZED_ROLES_MASKED_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000003'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'masked',0,'archived'),
    (16,'ARCHIVED_UNAUTHORIZED_ROLES_MASKED_ACROSS_SURFACES','c1010000-0000-4000-8000-000000000005'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'masked',0,'archived'),
    (17,'ARCHIVED_ALLOWED_AND_LATE_VIEWERS_REAL_RPCS_RAW_ZERO','c1010000-0000-4000-8000-000000000006'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'real',0,'archived'),
    (17,'ARCHIVED_ALLOWED_AND_LATE_VIEWERS_REAL_RPCS_RAW_ZERO','c1010000-0000-4000-8000-000000000007'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'real',0,'archived'),
    (18,'ARCHIVE_SHARE_REVOKE_IMMEDIATELY_UPDATES_EVERY_SURFACE','c1010000-0000-4000-8000-000000000007'::uuid,'c1012000-0000-4000-8000-000000000003'::uuid,'masked',0,'archived')
  ) x(ord,label,user_id,task_id,expected,raw_expected,lifecycle) order by ord loop
    if c.ord = 18 then
      v_pre_revoke := public.task_content_access_for_user(c.task_id,c.user_id) = 'real';
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims',json_build_object('sub','c1010000-0000-4000-8000-000000000001','role','authenticated')::text,true);
      perform public.revoke_archived_task_viewer(c.task_id,c.user_id);
      execute 'reset role';
    end if;

    v_helper := public.task_content_access_for_user(c.task_id,c.user_id);
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims',json_build_object('sub',c.user_id,'role','authenticated')::text,true);
    select count(*) into v_raw from public.tasks where id=c.task_id;
    select count(*),bool_or(is_masked),max(title) into v_detail,v_masked,v_title
      from public.get_task_detail(c.task_id);
    select count(*) into v_links from public.get_task_work_links(c.task_id);
    v_code := 'NO_ERROR'; v_message := 'NO_ERROR'; v_comments := null;
    begin select count(*) into v_comments from public.list_task_comments(c.task_id);
    exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text; end;
    v_added := 0;
    begin select count(*) into v_added from public.add_task_comment(c.task_id,'10C1 access probe');
    exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text; end;
    execute 'reset role';

    v_ok := v_helper=c.expected and v_raw=c.raw_expected and (
      (c.expected='real' and v_detail=1 and coalesce(v_masked,false)=false and v_title<>'Confidential Task' and v_links=1 and v_comments is not null and ((c.lifecycle='archived' and v_code='CCC05' and v_message='Archived task comments are read-only.') or (c.lifecycle<>'archived' and v_added=1)))
      or (c.expected='masked' and v_detail=1 and v_masked is true and v_title='Confidential Task' and v_links=0 and v_code='CCC01' and v_message='The task comments are unavailable.')
      or (c.expected='hidden' and v_detail=0 and v_links=0 and v_code='CCC01' and v_message='The task comments are unavailable.')
    );

    if c.ord=13 then
      v_code:='NO_ERROR'; v_message:='NO_ERROR';
      begin
        insert into public.archived_task_viewers(task_id,user_id,granted_by)
        values(c.task_id,c.user_id,'c1010000-0000-4000-8000-000000000001');
      exception when others then get stacked diagnostics v_code=returned_sqlstate,v_message=message_text; end;
      v_ok := v_ok and v_code='CCS02' and v_message='Archive-only sharing is unavailable for this task.';
    end if;
    if c.ord=18 then v_ok := v_ok and v_pre_revoke; end if;
    v_group := jsonb_set(v_group,array[c.label],to_jsonb(coalesce((v_group->>c.label)::boolean,true) and v_ok),true);
  end loop;

  for c in select * from (values
    (1,'DRAFT_ADMIN_REAL_ACROSS_SURFACES'),(2,'DRAFT_OWNING_COADMIN_REAL_ACROSS_SURFACES'),(3,'DRAFT_OTHER_COADMIN_HIDDEN_ACROSS_SURFACES'),(4,'DRAFT_ASSIGNED_MEMBER_HIDDEN_ACROSS_SURFACES'),(5,'DRAFT_UNASSIGNED_AND_VIEWER_MEMBERS_HIDDEN_ACROSS_SURFACES'),(6,'DRAFT_INACTIVE_AND_PROFILELESS_HIDDEN_ACROSS_SURFACES'),(7,'ACTIVE_ADMIN_REAL_ACROSS_SURFACES'),(8,'ACTIVE_OWNING_COADMIN_REAL_ACROSS_SURFACES'),(9,'ACTIVE_OTHER_COADMIN_MASKED_ACROSS_SURFACES'),(10,'ACTIVE_ASSIGNED_MEMBER_REAL_ACROSS_SURFACES'),(11,'ACTIVE_UNASSIGNED_MEMBER_MASKED_ACROSS_SURFACES'),(12,'ACTIVE_ALLOWED_VIEWER_REAL_RPCS_RAW_ZERO'),(13,'OTHER_ARCHIVE_SHARE_HOLDER_MASKED_ON_ACTIVE_AND_ACTIVE_SHARE_INSERT_CCS02'),(14,'ACTIVE_INACTIVE_AND_PROFILELESS_HIDDEN_ACROSS_SURFACES'),(15,'ARCHIVED_ADMIN_OWNING_COADMIN_ASSIGNEE_REAL_ACROSS_SURFACES'),(16,'ARCHIVED_UNAUTHORIZED_ROLES_MASKED_ACROSS_SURFACES'),(17,'ARCHIVED_ALLOWED_AND_LATE_VIEWERS_REAL_RPCS_RAW_ZERO'),(18,'ARCHIVE_SHARE_REVOKE_IMMEDIATELY_UPDATES_EVERY_SURFACE')
  ) x(ord,label) order by ord loop
    perform set_config('test.s10c1_results',current_setting('test.s10c1_results')||format(E'\n%s: %s',c.label,case when (v_group->>c.label)::boolean then 'PASS' else 'FAIL' end),true);
  end loop;
end $$;

reset role;
set constraints all immediate;
do $$ begin raise exception 'TEST RESULTS %',current_setting('test.s10c1_results'); end $$;
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

## 10C-2 — archive serialization and post-archive denials

Referenced rather than copied: Step 1 TESTS 4–6, Step 5B TEST 5, Step 7
TEST 2, Step 7A TEST 3, Step 7B TESTS 1, 3 and 5, Step 8 TESTS 2 and 5,
and Step 9 TEST 5.

Run this entire paste on **Dev** with **Run without RLS**. The intentional final
exception must contain exactly **16 result lines**, all `PASS`. Catalog and body
checks read `pg_proc.prosrc` and `pg_trigger`; they never text-match
`pg_get_functiondef`.

```sql
begin;

do $$ declare c uuid[]; begin
  select array_agg(id order by name) into c from public.committees;
  if coalesce(cardinality(c),0)<1 then raise exception '10C-2 requires a committee.'; end if;
  perform set_config('test.s10c2_c',c[1]::text,true);
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
from (values
 ('c1020000-0000-4000-8000-000000000001'::uuid,'s10c2-admin@test.local'),
 ('c1020000-0000-4000-8000-000000000002'::uuid,'s10c2-assigned@test.local'),
 ('c1020000-0000-4000-8000-000000000003'::uuid,'s10c2-volunteer@test.local')
) f(id,email);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('c1020000-0000-4000-8000-000000000001','s10c2-admin@test.local','C2 Admin','Admin',null,true),
 ('c1020000-0000-4000-8000-000000000002','s10c2-assigned@test.local','C2 Assigned','Member',current_setting('test.s10c2_c')::uuid,true),
 ('c1020000-0000-4000-8000-000000000003','s10c2-volunteer@test.local','C2 Volunteer','Member',current_setting('test.s10c2_c')::uuid,true);
insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('c1021000-0000-4000-8000-000000000001','10C2 Archive','2026-12-01','2026-12-02','Active','c1020000-0000-4000-8000-000000000001'),
 ('c1021000-0000-4000-8000-000000000002','10C2 Destination','2026-12-03','2026-12-04','Active','c1020000-0000-4000-8000-000000000001');
insert into public.tasks(id,event_id,committee_id,title,status,primary_assignees,is_confidential,allowed_viewers,request_backup,created_by) values
 ('c1022000-0000-4000-8000-000000000001','c1021000-0000-4000-8000-000000000001',current_setting('test.s10c2_c')::uuid,'10C2 archived target','To Do',array['c1020000-0000-4000-8000-000000000002'::uuid],true,array['c1020000-0000-4000-8000-000000000003'::uuid],true,'c1020000-0000-4000-8000-000000000001'),
 ('c1022000-0000-4000-8000-000000000002','c1021000-0000-4000-8000-000000000001',current_setting('test.s10c2_c')::uuid,'10C2 prerequisite','To Do','{}',false,'{}',false,'c1020000-0000-4000-8000-000000000001'),
 ('c1022000-0000-4000-8000-000000000003','c1021000-0000-4000-8000-000000000002',current_setting('test.s10c2_c')::uuid,'10C2 destination spare','To Do','{}',false,'{}',false,'c1020000-0000-4000-8000-000000000001');

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000001','role','authenticated')::text,true);
with added as (
  select out_id from public.add_task_comment('c1022000-0000-4000-8000-000000000001','10C2 seed')
)
select set_config('test.s10c2_comment',(select out_id::text from added),true);

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000002','role','authenticated')::text,true);
with added as (
  select id from public.add_task_work_link('c1022000-0000-4000-8000-000000000001','10C2 seed','https://drive.google.com/file/d/10C2Seed/view')
)
select set_config('test.s10c2_link',(select id::text from added),true);

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000003','role','authenticated')::text,true);
select * from public.volunteer_for_task('c1022000-0000-4000-8000-000000000001');

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000001','role','authenticated')::text,true);
select public.archive_event('c1021000-0000-4000-8000-000000000001',2,(select updated_at from public.events where id='c1021000-0000-4000-8000-000000000001'));

reset role; set constraints all immediate;
select set_config('test.s10c2_results','',true);

do $$
declare b text; ok boolean; r record;
begin
  select prosrc into b from pg_proc where oid='public.archive_event(uuid,bigint,timestamp with time zone)'::regprocedure;
  select p.prosecdef and p.provolatile='v' and p.proconfig=array['search_path=""']::text[] and pg_get_userbyid(p.proowner)='postgres'
  into ok from pg_proc p where p.oid='public.archive_event(uuid,bigint,timestamp with time zone)'::regprocedure;
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVE_EVENT_CATALOG_PROPERTIES: %s',case when ok then 'PASS' else 'FAIL' end),true);
  ok:=strpos(lower(b),'for update')>0 and strpos(lower(b),'for update')<strpos(lower(b),'count(*)') and strpos(lower(b),'count(*)')<strpos(lower(b),'update public.events');
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVE_EVENT_LOCKS_EVENT_BEFORE_RECOUNT_AND_UPDATE: %s',case when ok then 'PASS' else 'FAIL' end),true);
  ok:=lower(b) not like '%from public.tasks%for update%' and b not like '%task_work_links%' and b not like '%task_comments%' and b not like '%task_volunteers%' and b not like '%archived_task_viewers%';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVE_EVENT_NEVER_LOCKS_TASK_OR_CHILD_ROWS: %s',case when ok then 'PASS' else 'FAIL' end),true);

  for r in select * from (values
    ('TASK_ARCHIVE_GUARD_FOR_SHARE_THEN_STATUS_REREAD','public.guard_archived_event_task_writes()'::regprocedure,'tasks_guard_archived_event_writes','public.tasks'::regclass),
    ('WORK_LINK_ARCHIVE_GUARD_FOR_SHARE_THEN_STATUS_REREAD','public.guard_task_work_link_writes()'::regprocedure,'task_work_links_guard_writes','public.task_work_links'::regclass),
    ('VOLUNTEER_ARCHIVE_GUARD_FOR_SHARE_THEN_STATUS_REREAD','public.guard_task_volunteer_writes()'::regprocedure,'task_volunteers_guard_writes','public.task_volunteers'::regclass),
    ('COMMENT_ARCHIVE_GUARD_FOR_SHARE_THEN_STATUS_REREAD','public.guard_task_comment_writes()'::regprocedure,'task_comments_guard_writes','public.task_comments'::regclass),
    ('ARCHIVE_VIEWER_GUARD_FOR_SHARE_THEN_STATUS_REREAD','public.guard_archived_task_viewer_writes()'::regprocedure,'archived_task_viewers_guard_writes','public.archived_task_viewers'::regclass)
  ) x(label,fn,trig,tbl) loop
    select p.prosrc into b from pg_proc p where p.oid=r.fn;
    select strpos(lower(b),'for share')>0
      and strpos(substring(lower(b) from strpos(lower(b),'for share')+1),'status')>0
      and exists(select 1 from pg_trigger t where t.tgrelid=r.tbl and t.tgname=r.trig and t.tgenabled='O' and not t.tgisinternal and t.tgfoid=r.fn)
    into ok;
    perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\n%s: %s',r.label,case when ok then 'PASS' else 'FAIL' end),true);
  end loop;
end $$;

do $$
declare code text; msg text; ok boolean; n integer; old_event uuid;
begin
  -- Line 9: RPC plus raw UPDATE/INSERT as Admin and owner.
  code:=''; msg:=''; execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000001','role','authenticated')::text,true);
  begin perform public.move_task('c1022000-0000-4000-8000-000000000001',null,'To Do','In Progress',null,null); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=code='P0001' and msg='Tasks in Archived events are read-only.';
  code:=''; begin update public.tasks set priority='High' where id='c1022000-0000-4000-8000-000000000001'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Tasks in Archived events are read-only.';
  code:=''; begin insert into public.tasks(id,event_id,committee_id,title) values('c1022000-0000-4000-8000-000000000004','c1021000-0000-4000-8000-000000000001',current_setting('test.s10c2_c')::uuid,'blocked admin insert'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Tasks in Archived events are read-only.'; execute 'reset role';
  code:=''; begin update public.tasks set priority='Critical' where id='c1022000-0000-4000-8000-000000000001'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Tasks in Archived events are read-only.';
  code:=''; begin insert into public.tasks(id,event_id,committee_id,title) values('c1022000-0000-4000-8000-000000000005','c1021000-0000-4000-8000-000000000001',current_setting('test.s10c2_c')::uuid,'blocked owner insert'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Tasks in Archived events are read-only.';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_MOVE_EXACT_ERROR: %s',case when ok then 'PASS' else 'FAIL' end),true);

  execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000001','role','authenticated')::text,true);
  code:=''; begin perform public.claim_task('c1022000-0000-4000-8000-000000000001'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_CLAIM_EXACT_ERROR: %s',case when code='CCB02' and msg='Only Active-event tasks can be claimed.' then 'PASS' else 'FAIL' end),true);
  code:=''; begin perform public.assign_task_people('c1022000-0000-4000-8000-000000000001',array['c1020000-0000-4000-8000-000000000002'::uuid],'{}'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_ASSIGN_EXACT_ERROR: %s',case when code='P0001' and msg='Tasks in Archived events are read-only.' then 'PASS' else 'FAIL' end),true);

  code:=''; begin perform public.delete_task('c1022000-0000-4000-8000-000000000001'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=code='P0001' and msg='Tasks in Archived events are read-only.';
  code:=''; begin delete from public.tasks where id='c1022000-0000-4000-8000-000000000001'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Tasks in Archived events are read-only.';
  update public.events set name=name where id='c1021000-0000-4000-8000-000000000001'; get diagnostics n=row_count;
  ok:=ok and n=0; execute 'reset role';
  code:=''; begin delete from public.tasks where id='c1022000-0000-4000-8000-000000000001'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Tasks in Archived events are read-only.';
  code:=''; begin update public.events set name='blocked owner' where id='c1021000-0000-4000-8000-000000000001'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='P0001' and msg='Archived events are read-only.';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_DELETE_EXACT_ERROR: %s',case when ok then 'PASS' else 'FAIL' end),true);

  execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000001','role','authenticated')::text,true);
  code:=''; begin perform public.set_task_dependency('c1022000-0000-4000-8000-000000000001','c1022000-0000-4000-8000-000000000002'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=code='P0001' and msg='Tasks in Archived events are read-only.';
  code:=''; begin perform public.set_task_confidentiality('c1022000-0000-4000-8000-000000000001',false,'{}'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  ok:=ok and code='42501' and msg='The task event is Archived or unavailable.';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_DEPENDENCY_AND_CONFIDENTIALITY_EXACT_ERRORS: %s',case when ok then 'PASS' else 'FAIL' end),true);

  code:=''; begin perform public.add_task_comment('c1022000-0000-4000-8000-000000000001','blocked'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCC05' and msg='Archived task comments are read-only.';
  code:=''; begin perform public.edit_task_comment(current_setting('test.s10c2_comment')::uuid,'blocked',false,'{}',null); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCC05' and msg='Archived task comments are read-only.';
  code:=''; begin perform public.delete_task_comment(current_setting('test.s10c2_comment')::uuid); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCC05' and msg='Archived task comments are read-only.';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_COMMENT_WRITES_EXACT_ERRORS: %s',case when ok then 'PASS' else 'FAIL' end),true);

  code:=''; begin perform public.add_task_work_link('c1022000-0000-4000-8000-000000000001','blocked','https://drive.google.com/file/d/blocked/view'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCL03' and msg='Work links in Archived events are read-only.';
  code:=''; begin perform public.remove_task_work_link(current_setting('test.s10c2_link')::uuid); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCL03' and msg='Work links in Archived events are read-only.';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_WORK_LINK_WRITES_EXACT_ERRORS: %s',case when ok then 'PASS' else 'FAIL' end),true);

  execute 'reset role'; execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000003','role','authenticated')::text,true);
  code:=''; begin perform public.volunteer_for_task('c1022000-0000-4000-8000-000000000001'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCB02' and msg='Volunteering is available only for Active events.';
  code:=''; begin perform public.withdraw_task_volunteer('c1022000-0000-4000-8000-000000000001'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCB02' and msg='Volunteer offers are writable only for Active events.';
  execute 'reset role'; execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1020000-0000-4000-8000-000000000001','role','authenticated')::text,true);
  code:=''; begin perform public.accept_task_volunteer('c1022000-0000-4000-8000-000000000001','c1020000-0000-4000-8000-000000000003'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCB02' and msg='Volunteers can be accepted only for Active events.';
  perform set_config('test.s10c2_results',current_setting('test.s10c2_results')||format(E'\nARCHIVED_VOLUNTEER_WRITES_EXACT_ERRORS: %s',case when ok then 'PASS' else 'FAIL' end),true);
  execute 'reset role';
end $$;

reset role; set constraints all immediate;
do $$ begin raise exception 'TEST RESULTS %',current_setting('test.s10c2_results'); end $$;
```

## 10C-3 — dependency, ordering, activity, and immutable-parent integration

Referenced rather than copied: Step 5B TESTS 1, 3 and 5, Step 6 ordering
tests, Step 7 TEST 4, Step 7A TEST 3, Step 7B TESTS 3 and 5, Step 8 TEST 5,
and Step 9 TEST 5.

Run this entire paste on **Dev** with **Run without RLS**. The intentional final
exception must contain exactly **16 result lines**, all `PASS`.

```sql
begin;

do $$ declare c uuid[]; begin
  select array_agg(id order by name) into c from public.committees;
  if coalesce(cardinality(c),0)<2 then raise exception '10C-3 requires two committees.'; end if;
  perform set_config('test.s10c3_c1',c[1]::text,true);
  perform set_config('test.s10c3_c2',c[2]::text,true);
end $$;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
from (values
 ('c1030000-0000-4000-8000-000000000001'::uuid,'s10c3-admin@test.local'),
 ('c1030000-0000-4000-8000-000000000002'::uuid,'s10c3-co@test.local'),
 ('c1030000-0000-4000-8000-000000000003'::uuid,'s10c3-member@test.local'),
 ('c1030000-0000-4000-8000-000000000004'::uuid,'s10c3-viewer@test.local')
) f(id,email);
insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('c1030000-0000-4000-8000-000000000001','s10c3-admin@test.local','C3 Admin','Admin',null,true),
 ('c1030000-0000-4000-8000-000000000002','s10c3-co@test.local','C3 Co','Co-Admin',current_setting('test.s10c3_c1')::uuid,true),
 ('c1030000-0000-4000-8000-000000000003','s10c3-member@test.local','C3 Member','Member',current_setting('test.s10c3_c1')::uuid,true),
 ('c1030000-0000-4000-8000-000000000004','s10c3-viewer@test.local','C3 Viewer','Member',current_setting('test.s10c3_c1')::uuid,true);

insert into public.events(id,name,start_date,end_date,status,created_by) values
 ('c1031000-0000-4000-8000-000000000001','10C3 Active A','2027-01-01','2027-01-02','Active','c1030000-0000-4000-8000-000000000001'),
 ('c1031000-0000-4000-8000-000000000002','10C3 Active B','2027-01-03','2027-01-04','Active','c1030000-0000-4000-8000-000000000001'),
 ('c1031000-0000-4000-8000-000000000003','10C3 Archive','2027-01-05','2027-01-06','Active','c1030000-0000-4000-8000-000000000001');

insert into public.tasks(id,event_id,committee_id,title,status,primary_assignees,is_confidential,allowed_viewers,request_backup,depends_on_task_id,created_by) values
 ('c1032000-0000-4000-8000-000000000001','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Prerequisite','To Do',array['c1030000-0000-4000-8000-000000000003'::uuid],false,'{}',false,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000002','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Dependent','To Do',array['c1030000-0000-4000-8000-000000000003'::uuid],false,'{}',false,'c1032000-0000-4000-8000-000000000001','c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000003','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Already progressed','In Progress','{}',false,'{}',false,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000004','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'New prerequisite','To Do','{}',false,'{}',false,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000005','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Admin reparent','To Do','{}',false,'{}',false,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000006','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Co reparent','To Do','{}',false,'{}',false,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000007','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Owner reparent','To Do','{}',false,'{}',false,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000008','c1031000-0000-4000-8000-000000000001',current_setting('test.s10c3_c1')::uuid,'Active child parent','To Do',array['c1030000-0000-4000-8000-000000000003'::uuid],false,array['c1030000-0000-4000-8000-000000000004'::uuid],true,null,'c1030000-0000-4000-8000-000000000001'),
 ('c1032000-0000-4000-8000-000000000009','c1031000-0000-4000-8000-000000000003',current_setting('test.s10c3_c1')::uuid,'Archived child parent','To Do',array['c1030000-0000-4000-8000-000000000003'::uuid],true,array['c1030000-0000-4000-8000-000000000004'::uuid],true,null,'c1030000-0000-4000-8000-000000000001');

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000003','role','authenticated')::text,true);
with added as (select id from public.add_task_work_link('c1032000-0000-4000-8000-000000000008','active','https://drive.google.com/file/d/C3Active/view'))
select set_config('test.s10c3_active_link',(select id::text from added),true);
reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000003','role','authenticated')::text,true);
with added as (select id from public.add_task_work_link('c1032000-0000-4000-8000-000000000009','archive','https://drive.google.com/file/d/C3Archive/view'))
select set_config('test.s10c3_archive_link',(select id::text from added),true);

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000004','role','authenticated')::text,true);
select * from public.volunteer_for_task('c1032000-0000-4000-8000-000000000008');
reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000004','role','authenticated')::text,true);
select * from public.volunteer_for_task('c1032000-0000-4000-8000-000000000009');

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
with added as (select out_id from public.add_task_comment('c1032000-0000-4000-8000-000000000008','active comment'))
select set_config('test.s10c3_active_comment',(select out_id::text from added),true);
reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
with added as (select out_id from public.add_task_comment('c1032000-0000-4000-8000-000000000009','archive comment'))
select set_config('test.s10c3_archive_comment',(select out_id::text from added),true);
reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
select public.set_task_confidentiality('c1032000-0000-4000-8000-000000000009',true,'{}');

reset role; update public.events set status='Archived' where id='c1031000-0000-4000-8000-000000000003'; set constraints all immediate;
reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
select public.grant_archived_task_viewer('c1032000-0000-4000-8000-000000000009','c1030000-0000-4000-8000-000000000004');

-- Seed the otherwise-unrepresentable invalid row solely to exercise DELETE's
-- fail-closed non-Archived-parent branch. Trigger state and row roll back.
reset role;
alter table public.archived_task_viewers disable trigger archived_task_viewers_guard_writes;
insert into public.archived_task_viewers(task_id,user_id,granted_by) values
 ('c1032000-0000-4000-8000-000000000008','c1030000-0000-4000-8000-000000000002','c1030000-0000-4000-8000-000000000001');
alter table public.archived_task_viewers enable trigger archived_task_viewers_guard_writes;
select set_config('test.s10c3_results','',true);

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
do $$ declare code text; msg text; begin
  begin perform public.move_task('c1032000-0000-4000-8000-000000000002',null,'To Do','In Progress',null,null); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nINCOMPLETE_PREREQUISITE_BLOCKS_FORWARD_EXACT_ERROR: %s',case when code='P0001' and msg='Complete the prerequisite task before moving this task forward.' then 'PASS' else 'FAIL' end),true);
end $$;

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
do $$ declare ok boolean; begin
  perform public.move_task('c1032000-0000-4000-8000-000000000001',null,'To Do','Completed',null,null);
  perform public.move_task('c1032000-0000-4000-8000-000000000002',null,'To Do','In Progress',null,null);
  select status='In Progress' into ok from public.tasks where id='c1032000-0000-4000-8000-000000000002';
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nCOMPLETED_PREREQUISITE_UNLOCKS_FORWARD: %s',case when ok then 'PASS' else 'FAIL' end),true);
  perform public.move_task('c1032000-0000-4000-8000-000000000001',null,'Completed','In Progress',null,null);
  select status='In Progress' into ok from public.tasks where id='c1032000-0000-4000-8000-000000000002';
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nBACKWARD_PREREQUISITE_MOVE_DOES_NOT_AUTO_REVERT: %s',case when ok then 'PASS' else 'FAIL' end),true);
  perform public.set_task_dependency('c1032000-0000-4000-8000-000000000003','c1032000-0000-4000-8000-000000000004');
  select status='In Progress' and depends_on_task_id='c1032000-0000-4000-8000-000000000004' into ok from public.tasks where id='c1032000-0000-4000-8000-000000000003';
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nADDED_PREREQUISITE_DOES_NOT_AUTO_REVERT: %s',case when ok then 'PASS' else 'FAIL' end),true);
end $$;

reset role;
do $$ declare ok boolean; b text; r regprocedure; begin
  select condeferrable and condeferred and contype='u' into ok from pg_constraint where conrelid='public.tasks'::regclass and conname='tasks_lane_sort_order_key';
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nTASKS_LANE_SORT_ORDER_KEY_CATALOG: %s',case when ok then 'PASS' else 'FAIL' end),true);
  select provolatile='v' into ok from pg_proc where oid='public.task_lane_tail_sort_order(uuid,text,text,uuid)'::regprocedure;
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nTASK_LANE_TAIL_SORT_ORDER_IS_VOLATILE: %s',case when ok then 'PASS' else 'FAIL' end),true);
  ok:=true;
  foreach r in array array[
    'public.assign_task_creation_metadata()'::regprocedure,'public.validate_task_dependency()'::regprocedure,
    'public.set_task_destination_lane_order()'::regprocedure,'public.edit_event_with_tasks(uuid,timestamp with time zone,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure,
    'public.move_task(uuid,text,text,text,uuid,uuid)'::regprocedure,'public.set_task_dependency(uuid,uuid)'::regprocedure,
    'public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure,'public.delete_task(uuid)'::regprocedure,'public.unassign_self(uuid)'::regprocedure
  ] loop
    select prosrc into b from pg_proc where oid=r;
    ok:=ok and strpos(b,'pg_catalog.pg_advisory_xact_lock')>0 and strpos(b,'public.task_dependency_lock_key(')>0;
  end loop;
  foreach r in array array['public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure,'public.unassign_self(uuid)'::regprocedure] loop
    select prosrc into b from pg_proc where oid=r;
    ok:=ok and strpos(b,'public.prepare_unassigned_task_reset(')>0;
  end loop;
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nORDERING_WRITERS_USE_SHARED_PER_EVENT_ADVISORY_LOCK: %s',case when ok then 'PASS' else 'FAIL' end),true);
end $$;

do $$ declare before_n bigint; after_n bigint; ok boolean; begin
  select count(*) into before_n from public.activity_log where task_id='c1032000-0000-4000-8000-000000000004';
  update public.tasks set title=title where id='c1032000-0000-4000-8000-000000000004';
  select count(*) into after_n from public.activity_log where task_id='c1032000-0000-4000-8000-000000000004';
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nNO_OP_UPDATE_WRITES_NO_ACTIVITY: %s',case when before_n=after_n then 'PASS' else 'FAIL' end),true);
  before_n:=after_n; update public.tasks set sort_order=sort_order+1 where id='c1032000-0000-4000-8000-000000000004';
  select count(*) into after_n from public.activity_log where task_id='c1032000-0000-4000-8000-000000000004';
  perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nSORT_ORDER_ONLY_UPDATE_WRITES_NO_ACTIVITY: %s',case when before_n=after_n then 'PASS' else 'FAIL' end),true);
end $$;

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
do $$ declare code text; msg text; unchanged boolean; begin
 begin update public.tasks set event_id='c1031000-0000-4000-8000-000000000002' where id='c1032000-0000-4000-8000-000000000005'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
 select event_id='c1031000-0000-4000-8000-000000000001' into unchanged from public.tasks where id='c1032000-0000-4000-8000-000000000005';
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nADMIN_EVENT_ID_CHANGE_EXACT_ERROR_AND_UNCHANGED: %s',case when code='P0001' and msg='A task cannot be moved to another event.' and unchanged then 'PASS' else 'FAIL' end),true);
end $$;

reset role; set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000002','role','authenticated')::text,true);
do $$ declare code text; msg text; unchanged boolean; begin
 begin update public.tasks set event_id='c1031000-0000-4000-8000-000000000002' where id='c1032000-0000-4000-8000-000000000006'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
 select event_id='c1031000-0000-4000-8000-000000000001' into unchanged from public.tasks where id='c1032000-0000-4000-8000-000000000006';
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nOWNING_COADMIN_EVENT_ID_CHANGE_EXACT_ERROR_AND_UNCHANGED: %s',case when code='P0001' and msg='A task cannot be moved to another event.' and unchanged then 'PASS' else 'FAIL' end),true);
end $$;

reset role;
do $$ declare code text; msg text; unchanged boolean; enabled boolean; begin
 begin update public.tasks set event_id='c1031000-0000-4000-8000-000000000002' where id='c1032000-0000-4000-8000-000000000007'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end;
 select event_id='c1031000-0000-4000-8000-000000000001' into unchanged from public.tasks where id='c1032000-0000-4000-8000-000000000007';
 select tgenabled='O' into enabled from pg_trigger where tgrelid='public.tasks'::regclass and tgname='tasks_z0_reject_event_id_changes' and not tgisinternal;
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nTABLE_OWNER_EVENT_ID_CHANGE_EXACT_ERROR_Z0_ENABLED_AND_UNCHANGED: %s',case when code='P0001' and msg='Privileged task writers may update only status, sort_order, depends_on_task_id, primary_assignees, assist_assignees, and request_backup.' and unchanged and enabled then 'PASS' else 'FAIL' end),true);
end $$;

do $$ declare code text; msg text; ok boolean; task_before jsonb; task_after jsonb; event_before jsonb; event_after jsonb; begin
 code:=''; begin update public.task_work_links set task_id='c1032000-0000-4000-8000-000000000009' where id=current_setting('test.s10c3_active_link')::uuid; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCL05' and msg='Work links cannot be updated.';
 code:=''; begin insert into public.task_work_links(task_id,name,url) values('c1032000-0000-4000-8000-000000000009','blocked','https://drive.google.com/file/d/C3Blocked/view'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCL03' and msg='Work links in Archived events are read-only.';
 code:=''; begin delete from public.task_work_links where id=current_setting('test.s10c3_archive_link')::uuid; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCL03' and msg='Work links in Archived events are read-only.';
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nWORK_LINK_TASK_ID_IMMUTABLE_AND_ARCHIVED_FROZEN: %s',case when ok then 'PASS' else 'FAIL' end),true);
 code:=''; begin update public.task_volunteers set task_id='c1032000-0000-4000-8000-000000000009' where task_id='c1032000-0000-4000-8000-000000000008'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCB09' and msg='Volunteer offers cannot be updated; task_id is immutable.';
 code:=''; begin insert into public.task_volunteers(task_id,user_id) values('c1032000-0000-4000-8000-000000000009','c1030000-0000-4000-8000-000000000002'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCB08' and msg='Volunteer offers in Archived events are read-only.';
 code:=''; begin delete from public.task_volunteers where task_id='c1032000-0000-4000-8000-000000000009'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCB08' and msg='Volunteer offers in Archived events are read-only.';
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nVOLUNTEER_TASK_ID_IMMUTABLE_AND_ARCHIVED_FROZEN: %s',case when ok then 'PASS' else 'FAIL' end),true);
 code:=''; begin update public.task_comments set task_id='c1032000-0000-4000-8000-000000000009' where id=current_setting('test.s10c3_active_comment')::uuid; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCC10' and msg='A comment cannot be moved to another task.';
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true);
 code:=''; begin perform public.add_task_comment('c1032000-0000-4000-8000-000000000009','blocked'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; execute 'reset role'; ok:=ok and code='CCC05' and msg='Archived task comments are read-only.';
 code:=''; begin delete from public.task_comments where id=current_setting('test.s10c3_archive_comment')::uuid; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCC05' and msg='Archived task comments are read-only.';
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nCOMMENT_TASK_ID_IMMUTABLE_AND_ARCHIVED_FROZEN: %s',case when ok then 'PASS' else 'FAIL' end),true);

 select to_jsonb(t),to_jsonb(e) into task_before,event_before from public.tasks t join public.events e on e.id=t.event_id where t.id='c1032000-0000-4000-8000-000000000009';
 code:=''; begin update public.archived_task_viewers set task_id='c1032000-0000-4000-8000-000000000008' where task_id='c1032000-0000-4000-8000-000000000009' and user_id='c1030000-0000-4000-8000-000000000004'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=code='CCS07' and msg='Archive-only task shares cannot be updated.';
 code:=''; begin insert into public.archived_task_viewers(task_id,user_id,granted_by) values('c1032000-0000-4000-8000-000000000008','c1030000-0000-4000-8000-000000000003','c1030000-0000-4000-8000-000000000001'); exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCS02' and msg='Archive-only sharing is unavailable for this task.';
 code:=''; begin delete from public.archived_task_viewers where task_id='c1032000-0000-4000-8000-000000000008' and user_id='c1030000-0000-4000-8000-000000000002'; exception when others then get stacked diagnostics code=returned_sqlstate,msg=message_text; end; ok:=ok and code='CCS02' and msg='Archive-only sharing is unavailable for this task.';
 execute 'set local role authenticated'; perform set_config('request.jwt.claims',json_build_object('sub','c1030000-0000-4000-8000-000000000001','role','authenticated')::text,true); perform public.revoke_archived_task_viewer('c1032000-0000-4000-8000-000000000009','c1030000-0000-4000-8000-000000000004'); perform public.grant_archived_task_viewer('c1032000-0000-4000-8000-000000000009','c1030000-0000-4000-8000-000000000004'); execute 'reset role';
 select to_jsonb(t),to_jsonb(e) into task_after,event_after from public.tasks t join public.events e on e.id=t.event_id where t.id='c1032000-0000-4000-8000-000000000009'; ok:=ok and task_before=task_after and event_before=event_after;
 perform set_config('test.s10c3_results',current_setting('test.s10c3_results')||format(E'\nARCHIVE_VIEWER_EXACT_UPDATE_AND_PARENT_LIFECYCLE_GUARDS: %s',case when ok then 'PASS' else 'FAIL' end),true);
end $$;

reset role; set constraints all immediate;
do $$ begin raise exception 'TEST RESULTS %',current_setting('test.s10c3_results'); end $$;
```
