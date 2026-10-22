# Phase 4 Step 7A — assignment, deletion, and self-unassign tests

**Run on DEV only. Choose Run without RLS in the SQL Editor pop-up.**

Apply `20261021130000_task_assignment_deletion_self_unassign.sql` to Dev
through the owner's normal process before running these tests. Do not run these
blocks on Prod. Each numbered SQL test is an independent paste, creates its own
fixtures, impersonates callers where relevant, and ends with an intentional
`TEST RESULTS` exception so the transaction rolls back.

Deferred-trigger tests call `set constraints all immediate` before their
assertions. Catalog values are computed as the SQL Editor owner before caller
impersonation because an impersonated role cannot inspect every protected row.

Expected `TEST RESULTS` lines:

- TEST 1: 13 lines (the lock-order loop emits two lines).
- TEST 2: 12 lines.
- TEST 3: 10 lines (up from 7: Member denial plus two Archived-operation checks).
- TEST 4: 10 lines, unchanged (the exact/overdue loop emits two lines).
- TEST 5: 2 lines.

## TEST 1 — catalogs, grants, five-plus-helper/nine writers, and lock order

```sql
begin;

do $$
declare
  v_assign_oid oid := 'public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure;
  v_delete_oid oid := 'public.delete_task(uuid)'::regprocedure;
  v_unassign_oid oid := 'public.unassign_self(uuid)'::regprocedure;
  v_reset_oid oid := 'public.prepare_unassigned_task_reset(uuid,uuid,text)'::regprocedure;
  v_board_oid oid := 'public.list_event_board_tasks(uuid,uuid)'::regprocedure;
  v_guard_oid oid := 'public.restrict_assignee_task_updates()'::regprocedure;
  v_event_guard_oid oid := 'public.guard_event_updates()'::regprocedure;
  v_edit_oid oid := 'public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[])'::regprocedure;
  v_confidentiality_oid oid := 'public.set_task_confidentiality(uuid,boolean,uuid[])'::regprocedure;
  v_names text[];
  v_count integer;
  v_body text;
  v_event_lock_pos integer;
  v_advisory_lock_pos integer;
  v_task_lock_pos integer;
  v_ok boolean;
  v_results text := '';
begin
  select count(*), array_agg(writer.proname order by writer.proname)
  into v_count, v_names
  from (
    select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and p.prosecdef is true
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and (
        p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
        or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M'
      )
  ) writer;
  v_ok := v_count = 5 and v_names = array[
    'assign_task_people', 'delete_task', 'move_task',
    'set_task_dependency', 'unassign_self'
  ]::text[];
  v_results := v_results || format(E'\nOWNER_BRANCH_WRITERS_EXACT_FIVE: %s (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_names);

  select count(*), array_agg(writer.proname order by writer.proname)
  into v_count, v_names
  from (
    select p.proname
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and (
        p.prosrc ~* '\mupdate[[:space:]]+public\.tasks\M'
        or p.prosrc ~* '\mdelete[[:space:]]+from[[:space:]]+public\.tasks\M'
      )
  ) writer;
  v_ok := v_count = 9 and v_names = array[
    'assign_task_people', 'delete_task', 'edit_event_with_tasks',
    'guard_event_updates', 'move_task', 'prepare_unassigned_task_reset',
    'set_task_confidentiality', 'set_task_dependency', 'unassign_self'
  ]::text[];
  v_results := v_results || format(E'\nFULL_DIRECT_WRITER_SET_EXACT_NINE: %s (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_names);

  select count(*) = 3 and bool_and(
    p.prosecdef
    and p.provolatile = 'v'
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  )
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid in (v_assign_oid, v_delete_oid, v_unassign_oid);
  v_results := v_results || format(E'\nPUBLIC_WRITERS_DEFINER_VOLATILE_POSTGRES_EMPTY_PATH: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select
    not p.prosecdef
    and p.provolatile = 'v'
    and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and not pg_catalog.has_function_privilege('anon', v_reset_oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', v_reset_oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = v_reset_oid;
  v_results := v_results || format(E'\nRESET_HELPER_INVOKER_EMPTY_PATH_UNGRANTED: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select count(*), array_agg(p.proname order by p.proname)
  into v_count, v_names
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ '\mpublic\.prepare_unassigned_task_reset\M';
  v_ok := v_count = 2
    and v_names = array['assign_task_people', 'unassign_self']::text[];
  v_results := v_results || format(E'\nRESET_HELPER_ONLY_APPROVED_CALLERS: %s (%s)', case when v_ok then 'PASS' else 'FAIL' end, v_names);

  select count(*) = 3 and bool_and(
    pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  )
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid in (v_assign_oid, v_delete_oid, v_unassign_oid);
  v_results := v_results || format(E'\nPUBLIC_WRITERS_AUTHENTICATED_ONLY: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select
    p.prosecdef
    and p.prorettype = 'pg_catalog.trigger'::regtype
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_event_guard_oid;
  v_results := v_results || format(E'\nPREEXISTING_guard_event_updates: SECURITY DEFINER, search_path empty, no PUBLIC/anon/authenticated grant: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select
    not p.prosecdef
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_edit_oid;
  v_results := v_results || format(E'\nPREEXISTING_edit_event_with_tasks: SECURITY INVOKER, search_path empty, authenticated-only grant: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select
    not p.prosecdef
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_confidentiality_oid;
  v_results := v_results || format(E'\nPREEXISTING_set_task_confidentiality: SECURITY INVOKER, search_path empty, authenticated-only grant: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select
    p.prosecdef and p.provolatile = 's'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and pg_catalog.pg_get_function_result(v_board_oid) =
      'TABLE(id uuid, title text, phase text, status text, effective_priority text, due_date timestamp with time zone, committee_id uuid, committee_name text, primary_assignees jsonb, assist_assignees jsonb, is_backlog boolean, is_masked boolean)'
  into v_ok
  from pg_catalog.pg_proc p where p.oid = v_board_oid;
  v_results := v_results || format(E'\nBOARD_READER_12_COLUMNS_AND_ATTRIBUTES_UNCHANGED: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(v_guard_oid)) into v_body;
  v_ok := v_body like '%- ''status''%'
    and v_body like '%- ''sort_order''%'
    and v_body like '%- ''depends_on_task_id''%'
    and v_body like '%- ''primary_assignees''%'
    and v_body like '%- ''assist_assignees''%'
    and v_body not like '%- ''phase''%'
    and v_body not like '%- ''event_id''%'
    and v_body not like '%- ''is_confidential''%'
    and v_body like '%status, sort_order, depends_on_task_id, primary_assignees, and assist_assignees%';
  v_results := v_results || format(E'\nOWNER_GUARD_EXACT_FIVE_COLUMNS_AND_MESSAGE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  foreach v_body in array array[
    lower(pg_catalog.pg_get_functiondef(v_assign_oid)),
    lower(pg_catalog.pg_get_functiondef(v_unassign_oid))
  ] loop
    v_event_lock_pos := strpos(v_body, 'for share');
    v_advisory_lock_pos := strpos(v_body, 'pg_advisory_xact_lock');
    v_task_lock_pos := strpos(v_body, 'for update');
    v_ok := v_event_lock_pos > 0
      and v_advisory_lock_pos > v_event_lock_pos
      and v_task_lock_pos > v_advisory_lock_pos;
    v_results := v_results || format(E'\nASSIGNMENT_WRITER_EVENT_ADVISORY_TASK_LOCK_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);
  end loop;

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

The three extra full-set writers are pre-existing and intentionally out of
scope for Step 7A: `guard_event_updates` is the event lifecycle trigger,
`edit_event_with_tasks` is the Step 5 RLS-backed editor, and
`set_task_confidentiality` is the Step 7 RLS-backed writer.

## TEST 2 — assignment roles, real access, validation, Completed, and activity

```sql
begin;

insert into public.committees (id, name) values
  ('7a020000-0000-4000-8000-000000000001', 'S7A One'),
  ('7a020000-0000-4000-8000-000000000002', 'S7A Two');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('7a020000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-admin@test.local','',now(),'{}','{}',now(),now()),
  ('7a020000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-co-one@test.local','',now(),'{}','{}',now(),now()),
  ('7a020000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-co-two@test.local','',now(),'{}','{}',now(),now()),
  ('7a020000-0000-4000-8000-000000000014','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-member@test.local','',now(),'{}','{}',now(),now()),
  ('7a020000-0000-4000-8000-000000000015','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-inactive@test.local','',now(),'{}','{}',now(),now());

insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7a020000-0000-4000-8000-000000000011','s7a-admin@test.local','S7A Admin','Admin',null,true),
  ('7a020000-0000-4000-8000-000000000012','s7a-co-one@test.local','S7A Co One','Co-Admin','7a020000-0000-4000-8000-000000000001',true),
  ('7a020000-0000-4000-8000-000000000013','s7a-co-two@test.local','S7A Co Two','Co-Admin','7a020000-0000-4000-8000-000000000002',true),
  ('7a020000-0000-4000-8000-000000000014','s7a-member@test.local','S7A Member','Member','7a020000-0000-4000-8000-000000000001',true),
  ('7a020000-0000-4000-8000-000000000015','s7a-inactive@test.local','S7A Inactive','Member','7a020000-0000-4000-8000-000000000001',false);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7a020000-0000-4000-8000-000000000101','S7A Active','2026-10-01','2026-11-30','Active','7a020000-0000-4000-8000-000000000011');

insert into public.tasks (
  id,event_id,committee_id,title,phase,status,due_date,
  primary_assignees,assist_assignees,is_confidential,allowed_viewers,created_by
) values
  ('7a020000-0000-4000-8000-000000000201','7a020000-0000-4000-8000-000000000101','7a020000-0000-4000-8000-000000000001','Non-confidential','Phase','In Progress',null,array['7a020000-0000-4000-8000-000000000014']::uuid[],'{}',false,'{}','7a020000-0000-4000-8000-000000000011'),
  ('7a020000-0000-4000-8000-000000000202','7a020000-0000-4000-8000-000000000101','7a020000-0000-4000-8000-000000000001','Confidential','Phase','To Do',null,array['7a020000-0000-4000-8000-000000000014']::uuid[],'{}',true,'{}','7a020000-0000-4000-8000-000000000011'),
  ('7a020000-0000-4000-8000-000000000203','7a020000-0000-4000-8000-000000000101','7a020000-0000-4000-8000-000000000001','Completed','Phase','Completed',null,array['7a020000-0000-4000-8000-000000000014']::uuid[],'{}',false,'{}','7a020000-0000-4000-8000-000000000011'),
  ('7a020000-0000-4000-8000-000000000204','7a020000-0000-4000-8000-000000000101','7a020000-0000-4000-8000-000000000001','Inactive retained','Phase','To Do',null,array['7a020000-0000-4000-8000-000000000015']::uuid[],'{}',false,'{}','7a020000-0000-4000-8000-000000000011'),
  ('7a020000-0000-4000-8000-000000000205','7a020000-0000-4000-8000-000000000101','7a020000-0000-4000-8000-000000000001','To Do assist only','Stable rank','To Do',null,'{}',array['7a020000-0000-4000-8000-000000000014']::uuid[],false,'{}','7a020000-0000-4000-8000-000000000011');

update public.tasks set sort_order = 777
where id = '7a020000-0000-4000-8000-000000000205';

set local role authenticated;

do $$
declare
  v_denied boolean;
  v_ok boolean;
  v_rank bigint;
  v_activity_before bigint;
  v_activity_after bigint;
  v_results text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  select count(*) into v_activity_before from public.activity_log where task_id = '7a020000-0000-4000-8000-000000000201' and action = 'UPDATE';
  perform public.assign_task_people(
    '7a020000-0000-4000-8000-000000000201',
    array['7a020000-0000-4000-8000-000000000013']::uuid[],
    array['7a020000-0000-4000-8000-000000000014']::uuid[]
  );
  select count(*) into v_activity_after from public.activity_log where task_id = '7a020000-0000-4000-8000-000000000201' and action = 'UPDATE';
  select status = 'In Progress'
    and primary_assignees = array['7a020000-0000-4000-8000-000000000013']::uuid[]
    and assist_assignees = array['7a020000-0000-4000-8000-000000000014']::uuid[]
  into v_ok from public.tasks where id = '7a020000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nOTHER_COMMITTEE_COADMIN_NONCONFIDENTIAL_ALLOWED: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nASSIGNMENT_ACTIVITY_EXACTLY_ONCE: %s', case when v_activity_after = v_activity_before + 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  select sort_order into v_rank from public.tasks where id = '7a020000-0000-4000-8000-000000000205';
  select count(*) into v_activity_before from public.activity_log where task_id = '7a020000-0000-4000-8000-000000000205' and action = 'UPDATE';
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  perform public.assign_task_people('7a020000-0000-4000-8000-000000000205','{}'::uuid[],'{}'::uuid[]);
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  select count(*) into v_activity_after from public.activity_log where task_id = '7a020000-0000-4000-8000-000000000205' and action = 'UPDATE';
  select status = 'To Do'
    and sort_order = v_rank
    and cardinality(primary_assignees) = 0
    and cardinality(assist_assignees) = 0
  into v_ok from public.tasks where id = '7a020000-0000-4000-8000-000000000205';
  v_results := v_results || format(E'\nASSIGN_TODO_ASSIST_REMOVAL_PRESERVES_RANK_AND_LOGS_ONCE: %s', case when v_ok and v_activity_after = v_activity_before + 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.assign_task_people('7a020000-0000-4000-8000-000000000202',array['7a020000-0000-4000-8000-000000000013']::uuid[],'{}'::uuid[]);
  exception when insufficient_privilege then v_denied := true;
  end;
  v_results := v_results || format(E'\nMASKED_OTHER_COADMIN_CONFIDENTIAL_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);
  select count(*) = 0 into v_ok from public.get_task_edit_controls('7a020000-0000-4000-8000-000000000202');
  v_results := v_results || format(E'\nMASKED_TASK_HAS_NO_ASSIGN_OR_DELETE_CONTROLS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  perform public.set_task_confidentiality('7a020000-0000-4000-8000-000000000202',true,array['7a020000-0000-4000-8000-000000000013']::uuid[]);
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  perform public.assign_task_people('7a020000-0000-4000-8000-000000000202',array['7a020000-0000-4000-8000-000000000013']::uuid[],'{}'::uuid[]);
  select primary_assignees = array['7a020000-0000-4000-8000-000000000013']::uuid[] into v_ok from public.tasks where id = '7a020000-0000-4000-8000-000000000202';
  v_results := v_results || format(E'\nALLOWED_VIEWER_COADMIN_CONFIDENTIAL_ALLOWED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  select sort_order into v_rank from public.tasks where id = '7a020000-0000-4000-8000-000000000203';
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  perform public.assign_task_people('7a020000-0000-4000-8000-000000000203','{}'::uuid[],array['7a020000-0000-4000-8000-000000000014']::uuid[]);
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  select status = 'Completed' and sort_order = v_rank into v_ok from public.tasks where id = '7a020000-0000-4000-8000-000000000203';
  v_results := v_results || format(E'\nCOMPLETED_ASSIGNMENT_PRESERVES_STATUS_AND_RANK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  perform public.assign_task_people('7a020000-0000-4000-8000-000000000204',array['7a020000-0000-4000-8000-000000000015','7a020000-0000-4000-8000-000000000014']::uuid[],'{}'::uuid[]);
  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000011','role','authenticated')::text, true);
  select '7a020000-0000-4000-8000-000000000015'::uuid = any(primary_assignees) into v_ok from public.tasks where id = '7a020000-0000-4000-8000-000000000204';
  v_results := v_results || format(E'\nSTORED_INACTIVE_PRIMARY_RETAINED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000013','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.assign_task_people('7a020000-0000-4000-8000-000000000204',array['7a020000-0000-4000-8000-000000000014']::uuid[],array['7a020000-0000-4000-8000-000000000015']::uuid[]);
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nINACTIVE_CATEGORY_MOVE_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.assign_task_people('7a020000-0000-4000-8000-000000000204',array['7a020000-0000-4000-8000-000000000014']::uuid[],array['7a020000-0000-4000-8000-000000000014']::uuid[]);
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nPRIMARY_ASSIST_OVERLAP_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.assign_task_people('7a020000-0000-4000-8000-000000000203','{}'::uuid[],array['7a020000-0000-4000-8000-000000000014']::uuid[]);
  exception when sqlstate 'CCN01' then v_denied := sqlerrm = 'Assignees are already up to date.';
  end;
  v_results := v_results || format(E'\nNOOP_STABLE_CODE_CCN01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','7a020000-0000-4000-8000-000000000014','role','authenticated')::text, true);
  v_denied := false;
  begin
    perform public.assign_task_people('7a020000-0000-4000-8000-000000000201','{}'::uuid[],'{}'::uuid[]);
  exception when insufficient_privilege then v_denied := true;
  end;
  v_results := v_results || format(E'\nMEMBER_ASSIGNMENT_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  set constraints all immediate;
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — deletion, dependency protection, and Active-event invariant

```sql
begin;

insert into public.committees (id,name) values
  ('7a030000-0000-4000-8000-000000000001','S7A Delete One'),
  ('7a030000-0000-4000-8000-000000000002','S7A Delete Two');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('7a030000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-delete-admin@test.local','',now(),'{}','{}',now(),now()),
  ('7a030000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-delete-co@test.local','',now(),'{}','{}',now(),now()),
  ('7a030000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-delete-member@test.local','',now(),'{}','{}',now(),now());
insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7a030000-0000-4000-8000-000000000011','s7a-delete-admin@test.local','Delete Admin','Admin',null,true),
  ('7a030000-0000-4000-8000-000000000012','s7a-delete-co@test.local','Delete Co','Co-Admin','7a030000-0000-4000-8000-000000000002',true),
  ('7a030000-0000-4000-8000-000000000013','s7a-delete-member@test.local','Delete Member','Member','7a030000-0000-4000-8000-000000000001',true);
insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7a030000-0000-4000-8000-000000000101','Delete Active','2026-10-01','2026-11-30','Active','7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000102','Delete Draft','2026-10-01',null,'Draft','7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000103','Delete Archived','2026-10-01','2026-11-30','Active','7a030000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,phase,status,depends_on_task_id,is_confidential,created_by) values
  ('7a030000-0000-4000-8000-000000000201','7a030000-0000-4000-8000-000000000101','7a030000-0000-4000-8000-000000000001','Prerequisite','Phase','To Do',null,false,'7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000202','7a030000-0000-4000-8000-000000000101','7a030000-0000-4000-8000-000000000001','Dependent','Phase','To Do','7a030000-0000-4000-8000-000000000201',false,'7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000203','7a030000-0000-4000-8000-000000000101','7a030000-0000-4000-8000-000000000001','Progressed','Phase','In Progress',null,false,'7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000204','7a030000-0000-4000-8000-000000000102','7a030000-0000-4000-8000-000000000001','Draft only','Phase','To Do',null,false,'7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000206','7a030000-0000-4000-8000-000000000101','7a030000-0000-4000-8000-000000000001','Confidential delete denied','Phase','To Do',null,true,'7a030000-0000-4000-8000-000000000011'),
  ('7a030000-0000-4000-8000-000000000207','7a030000-0000-4000-8000-000000000103','7a030000-0000-4000-8000-000000000001','Archived task','Phase','To Do',null,false,'7a030000-0000-4000-8000-000000000011');

update public.events
set status = 'Archived'
where id = '7a030000-0000-4000-8000-000000000103';

set local role authenticated;

do $$
declare
  v_denied boolean;
  v_before bigint;
  v_after bigint;
  v_results text := '';
begin
  perform set_config('request.jwt.claims',json_build_object('sub','7a030000-0000-4000-8000-000000000013','role','authenticated')::text,true);

  v_denied := false;
  begin
    perform public.delete_task('7a030000-0000-4000-8000-000000000203');
  exception when others then
    v_denied := sqlstate = '42501';
  end;
  v_results := v_results || format(E'\nMEMBER_DELETE_DENIED_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',json_build_object('sub','7a030000-0000-4000-8000-000000000012','role','authenticated')::text,true);

  v_denied := false;
  begin
    perform public.delete_task('7a030000-0000-4000-8000-000000000206');
  exception when insufficient_privilege then v_denied := true;
  end;
  v_results := v_results || format(E'\nMASKED_NONOWNING_COADMIN_DELETE_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.delete_task('7a030000-0000-4000-8000-000000000201');
  exception when sqlstate 'CCD01' then v_denied := true;
  end;
  v_results := v_results || format(E'\nREFERENCED_PREREQUISITE_REJECTED_CCD01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.delete_task('7a030000-0000-4000-8000-000000000203');
  exception when invalid_parameter_value then v_denied := true;
  end;
  v_results := v_results || format(E'\nNON_TODO_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',json_build_object('sub','7a030000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  select count(*) into v_before from public.activity_log where action = 'DELETE' and changes->>'id' = '7a030000-0000-4000-8000-000000000202';
  perform set_config('request.jwt.claims',json_build_object('sub','7a030000-0000-4000-8000-000000000012','role','authenticated')::text,true);
  perform public.delete_task('7a030000-0000-4000-8000-000000000202');
  perform set_config('request.jwt.claims',json_build_object('sub','7a030000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  set constraints all immediate;
  select count(*) into v_after from public.activity_log where action = 'DELETE' and changes->>'id' = '7a030000-0000-4000-8000-000000000202';
  v_results := v_results || format(E'\nCROSS_COMMITTEE_COADMIN_DELETE_AND_ONE_ACTIVITY: %s', case when v_after = v_before + 1 then 'PASS' else 'FAIL' end);

  perform public.delete_task('7a030000-0000-4000-8000-000000000204');
  set constraints all immediate;
  v_results := v_results || format(E'\nDRAFT_LAST_TASK_DELETE_ALLOWED: %s', case when not exists (select 1 from public.tasks where id = '7a030000-0000-4000-8000-000000000204') then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',json_build_object('sub','7a030000-0000-4000-8000-000000000011','role','authenticated')::text,true);

  v_denied := false;
  begin
    perform public.assign_task_people(
      '7a030000-0000-4000-8000-000000000207',
      array['7a030000-0000-4000-8000-000000000013']::uuid[],
      '{}'::uuid[]
    );
  exception when others then
    v_denied := sqlstate = 'P0001'
      and sqlerrm = 'Tasks in Archived events are read-only.';
  end;
  v_results := v_results || format(E'\nARCHIVED_ASSIGNMENT_REJECTED_READ_ONLY: %s', case when v_denied and exists (
    select 1 from public.tasks
    where id = '7a030000-0000-4000-8000-000000000207'
      and cardinality(primary_assignees) = 0
      and cardinality(assist_assignees) = 0
  ) then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    perform public.delete_task('7a030000-0000-4000-8000-000000000207');
  exception when others then
    v_denied := sqlstate = 'P0001'
      and sqlerrm = 'Tasks in Archived events are read-only.';
  end;
  v_results := v_results || format(E'\nARCHIVED_DELETE_REJECTED_READ_ONLY: %s', case when v_denied and exists (
    select 1 from public.tasks
    where id = '7a030000-0000-4000-8000-000000000207'
  ) then 'PASS' else 'FAIL' end);

  set constraints all deferred;
  delete from public.tasks where id in ('7a030000-0000-4000-8000-000000000201','7a030000-0000-4000-8000-000000000203','7a030000-0000-4000-8000-000000000206');
  insert into public.tasks (id,event_id,committee_id,title,phase,status,created_by)
  values ('7a030000-0000-4000-8000-000000000205','7a030000-0000-4000-8000-000000000101','7a030000-0000-4000-8000-000000000001','Last task','Phase','To Do','7a030000-0000-4000-8000-000000000011');

  v_denied := false;
  begin
    perform public.delete_task('7a030000-0000-4000-8000-000000000205');
  exception when check_violation then v_denied := true;
  end;
  v_results := v_results || format(E'\nRPC_LAST_ACTIVE_TASK_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    delete from public.tasks where id = '7a030000-0000-4000-8000-000000000205';
    set constraints all immediate;
  exception when check_violation then v_denied := true;
  end;
  v_results := v_results || format(E'\nDEFERRED_CONSTRAINT_INDEPENDENTLY_REJECTS_LAST_TASK: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — self-unassign timing, Completed, Backlog reset, and exhausted rank

```sql
begin;

insert into public.committees (id,name) values ('7a040000-0000-4000-8000-000000000001','S7A Leave');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('7a040000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-leave-admin@test.local','',now(),'{}','{}',now(),now()),
  ('7a040000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-leave-member@test.local','',now(),'{}','{}',now(),now()),
  ('7a040000-0000-4000-8000-000000000013','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-leave-assist@test.local','',now(),'{}','{}',now(),now());
insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7a040000-0000-4000-8000-000000000011','s7a-leave-admin@test.local','Leave Admin','Admin',null,true),
  ('7a040000-0000-4000-8000-000000000012','s7a-leave-member@test.local','Leave Member','Member','7a040000-0000-4000-8000-000000000001',true),
  ('7a040000-0000-4000-8000-000000000013','s7a-leave-assist@test.local','Leave Assist','Member','7a040000-0000-4000-8000-000000000001',true);
insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7a040000-0000-4000-8000-000000000101','Leave Active','2026-10-01','2026-11-30','Active','7a040000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,phase,status,due_date,primary_assignees,assist_assignees,is_confidential,created_by) values
  ('7a040000-0000-4000-8000-000000000201','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Null due','Phase','In Progress',null,array['7a040000-0000-4000-8000-000000000012']::uuid[],array['7a040000-0000-4000-8000-000000000013']::uuid[],true,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000202','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Far due','Phase','In Progress',clock_timestamp()+interval '73 hours',array['7a040000-0000-4000-8000-000000000012']::uuid[],'{}',false,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000203','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Exact due','Phase','To Do',now()+interval '72 hours',array['7a040000-0000-4000-8000-000000000012']::uuid[],'{}',false,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000204','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Overdue','Phase','To Do',clock_timestamp()-interval '1 hour',array['7a040000-0000-4000-8000-000000000012']::uuid[],'{}',false,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000205','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Completed','Phase','Completed',null,array['7a040000-0000-4000-8000-000000000012']::uuid[],'{}',false,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000206','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Old-rank target','Collision','In Progress',null,array['7a040000-0000-4000-8000-000000000012']::uuid[],'{}',false,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000207','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','Exhausted lane','Collision','To Do',null,array['7a040000-0000-4000-8000-000000000013']::uuid[],'{}',false,'7a040000-0000-4000-8000-000000000011'),
  ('7a040000-0000-4000-8000-000000000208','7a040000-0000-4000-8000-000000000101','7a040000-0000-4000-8000-000000000001','To Do assist only','Stable rank','To Do',null,'{}',array['7a040000-0000-4000-8000-000000000012']::uuid[],false,'7a040000-0000-4000-8000-000000000011');

update public.tasks set sort_order = 1024 where id = '7a040000-0000-4000-8000-000000000206';
update public.tasks set sort_order = 9223372036854775000 where id = '7a040000-0000-4000-8000-000000000207';
update public.tasks set sort_order = 777 where id = '7a040000-0000-4000-8000-000000000208';

set local role authenticated;

do $$
declare
  v_denied boolean;
  v_event_id uuid;
  v_activity_before bigint;
  v_activity_after bigint;
  v_actor_time_rows bigint;
  v_stored_sort_order bigint;
  v_ok boolean;
  v_results text := '';
begin
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000012','role','authenticated')::text,true);

  select self_unassign_will_lose_access into v_ok from public.get_task_edit_controls('7a040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nCONFIDENTIAL_ACCESS_LOSS_FLAG_BEFORE_REFRESH: %s', case when coalesce(v_ok, false) then 'PASS' else 'FAIL' end);

  select event_id into v_event_id
  from public.tasks where id = '7a040000-0000-4000-8000-000000000201';
  select count(*) into v_activity_before from public.activity_log where task_id = '7a040000-0000-4000-8000-000000000201' and action = 'UPDATE';
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000012','role','authenticated')::text,true);
  perform public.unassign_self('7a040000-0000-4000-8000-000000000201');
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  select count(*) into v_activity_after from public.activity_log where task_id = '7a040000-0000-4000-8000-000000000201' and action = 'UPDATE';
  select count(*) into v_actor_time_rows
  from public.activity_log
  where task_id = '7a040000-0000-4000-8000-000000000201'
    and action = 'UPDATE'
    and user_id = '7a040000-0000-4000-8000-000000000012';
  select event_id = v_event_id
    and status = 'To Do'
    and cardinality(primary_assignees) = 0
    and assist_assignees = array['7a040000-0000-4000-8000-000000000013']::uuid[]
  into v_ok from public.tasks where id = '7a040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nNULL_DUE_LAST_PRIMARY_RESET_PRESERVES_ASSIST_AND_EVENT: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nSELF_UNASSIGN_ACTIVITY_ACTOR_TIME_EXACTLY_ONCE: %s', case when v_activity_after = v_activity_before + 1 and v_actor_time_rows = 1 then 'PASS' else 'FAIL' end);

  select sort_order into v_stored_sort_order from public.tasks where id = '7a040000-0000-4000-8000-000000000208';
  select count(*) into v_activity_before from public.activity_log where task_id = '7a040000-0000-4000-8000-000000000208' and action = 'UPDATE';
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000012','role','authenticated')::text,true);
  perform public.unassign_self('7a040000-0000-4000-8000-000000000208');
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  select count(*) into v_activity_after from public.activity_log where task_id = '7a040000-0000-4000-8000-000000000208' and action = 'UPDATE';
  select status = 'To Do'
    and sort_order = v_stored_sort_order
    and cardinality(primary_assignees) = 0
    and cardinality(assist_assignees) = 0
  into v_ok from public.tasks where id = '7a040000-0000-4000-8000-000000000208';
  v_results := v_results || format(E'\nSELF_UNASSIGN_TODO_ASSIST_PRESERVES_RANK_AND_LOGS_ONCE: %s', case when v_ok and v_activity_after = v_activity_before + 1 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000012','role','authenticated')::text,true);
  perform public.unassign_self('7a040000-0000-4000-8000-000000000202');
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  v_results := v_results || format(E'\nMORE_THAN_72_HOURS_ALLOWED: %s', case when exists (select 1 from public.tasks where id = '7a040000-0000-4000-8000-000000000202' and cardinality(primary_assignees)=0) then 'PASS' else 'FAIL' end);

  foreach v_event_id in array array['7a040000-0000-4000-8000-000000000203'::uuid,'7a040000-0000-4000-8000-000000000204'::uuid] loop
    perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000012','role','authenticated')::text,true);
    v_denied := false;
    begin
      perform public.unassign_self(v_event_id);
    exception when sqlstate 'CCU72' then v_denied := sqlerrm like '%Ask an Admin or Co-Admin%';
    end;
    v_results := v_results || format(E'\nEXACT_OR_OVERDUE_REJECTED_CCU72: %s', case when v_denied then 'PASS' else 'FAIL' end);
  end loop;

  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000012','role','authenticated')::text,true);
  v_denied := false;
  begin
    perform public.unassign_self('7a040000-0000-4000-8000-000000000205');
  exception when sqlstate 'CCU73' then v_denied := sqlerrm like '%Completed tasks cannot be self-unassigned%';
  end;
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  v_results := v_results || format(E'\nCOMPLETED_REJECTED_CCU73_WITHOUT_RESET: %s', case when v_denied and exists (select 1 from public.tasks where id='7a040000-0000-4000-8000-000000000205' and status='Completed') then 'PASS' else 'FAIL' end);

  select count(*) into v_activity_before from public.activity_log where action='UPDATE' and task_id in ('7a040000-0000-4000-8000-000000000206','7a040000-0000-4000-8000-000000000207');
  perform set_config('request.jwt.claims',json_build_object('sub','7a040000-0000-4000-8000-000000000011','role','authenticated')::text,true);
  perform public.assign_task_people('7a040000-0000-4000-8000-000000000206','{}'::uuid[],'{}'::uuid[]);
  set constraints all immediate;
  select count(*) into v_activity_after from public.activity_log where action='UPDATE' and task_id in ('7a040000-0000-4000-8000-000000000206','7a040000-0000-4000-8000-000000000207');
  select target.status = 'To Do'
    and target.sort_order = 2048
    and other_task.sort_order = 1024
  into v_ok
  from public.tasks target
  join public.tasks other_task on other_task.id = '7a040000-0000-4000-8000-000000000207'
  where target.id = '7a040000-0000-4000-8000-000000000206';
  v_results := v_results || format(E'\nEXHAUSTED_TODO_LANE_REBALANCED_SAFELY: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nREBALANCE_STILL_ONE_BUSINESS_ACTIVITY: %s', case when v_activity_after = v_activity_before + 1 then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — exact Backlog meaning and unchanged reader contract

```sql
begin;

insert into public.committees (id,name) values ('7a050000-0000-4000-8000-000000000001','S7A Board');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('7a050000-0000-4000-8000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-board-admin@test.local','',now(),'{}','{}',now(),now()),
  ('7a050000-0000-4000-8000-000000000012','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s7a-board-assist@test.local','',now(),'{}','{}',now(),now());
insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7a050000-0000-4000-8000-000000000011','s7a-board-admin@test.local','Board Admin','Admin',null,true),
  ('7a050000-0000-4000-8000-000000000012','s7a-board-assist@test.local','Board Assist','Member','7a050000-0000-4000-8000-000000000001',true);
insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7a050000-0000-4000-8000-000000000101','Board Active','2026-10-01','2026-11-30','Active','7a050000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,phase,status,primary_assignees,assist_assignees,created_by) values
  ('7a050000-0000-4000-8000-000000000201','7a050000-0000-4000-8000-000000000101','7a050000-0000-4000-8000-000000000001','Assist Backlog','Phase','To Do','{}',array['7a050000-0000-4000-8000-000000000012']::uuid[],'7a050000-0000-4000-8000-000000000011'),
  ('7a050000-0000-4000-8000-000000000202','7a050000-0000-4000-8000-000000000101','7a050000-0000-4000-8000-000000000001','Completed unowned','Phase','Completed','{}','{}','7a050000-0000-4000-8000-000000000011');

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub','7a050000-0000-4000-8000-000000000011','role','authenticated')::text,true);

do $$
declare
  v_ok boolean;
  v_results text := '';
begin
  select is_backlog and jsonb_array_length(assist_assignees)=1
  into v_ok
  from public.list_event_board_tasks('7a050000-0000-4000-8000-000000000101',null)
  where id = '7a050000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nTODO_ZERO_PRIMARY_ONE_ASSIST_IS_BACKLOG: %s', case when coalesce(v_ok,false) then 'PASS' else 'FAIL' end);

  select not is_backlog
  into v_ok
  from public.list_event_board_tasks('7a050000-0000-4000-8000-000000000101',null)
  where id = '7a050000-0000-4000-8000-000000000202';
  v_results := v_results || format(E'\nCOMPLETED_ZERO_PRIMARY_NOT_BACKLOG: %s', case when coalesce(v_ok,false) then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## Read-only pre-push count for Dev and Prod

Run this read-only query separately in each project's SQL Editor before applying
the migration to learn how many existing rows will change Backlog classification:

```sql
select count(*) as tasks_without_primary_with_assist
from public.tasks
where pg_catalog.cardinality(primary_assignees) = 0
  and pg_catalog.cardinality(assist_assignees) > 0;
```

## Automated app tests

Run:

```text
npm test
```

The SQL suite additionally proves that both assignment paths remove the final
assist from an already-`To Do`, zero-primary task without changing its stored
rank and with exactly one activity row. The Vitest suite covers the expanded
edit-control response contract, hidden assignment state, exact no-op
comparison, prefixed mutation responses, stable `CCN01`/`CCU72`/`CCU73`
messages, and existing dependency/confidentiality regressions.

## Manual checklist — Claudee (Admin) and tv (Member)

Use two browser profiles on Dev so both accounts stay signed in.

### Claudee

1. Open a real, non-confidential task from another committee. Confirm **Manage
   assignees** appears and save different Primary and Assist selections.
2. Reopen the dialog. Confirm Save is disabled until a selection changes and an
   inactive retained person can be removed but not moved to the other category.
3. Remove the final primary from an incomplete task. Confirm it becomes To Do,
   moves to the Backlog, retains Assist people, and stays there after refresh.
4. Remove the final primary from a Completed task. Confirm it stays Completed
   and does not appear in Backlog.
5. Open a confidential task Claudee can see and confirm assignment works.
6. As a non-owning Co-Admin without viewer access, open the same task's masked
   shell and confirm assignment and Delete controls are absent. Add that
   Co-Admin as an allowed viewer and confirm the controls then appear.
7. Open a To Do task, choose Delete, cancel once, then confirm. Verify navigation
   returns to the event and the task stays gone after refresh.
8. Confirm Delete is absent for In Progress and Completed tasks. Use SQL TEST 3
   for prerequisite and last-Active-task rejection.
9. Open an Archived task and confirm every Step 7A control is absent.

### tv

1. Open an assigned, incomplete task with no due date. Confirm no assignment or
   Delete controls appear, but **Leave task** does.
2. Leave a non-confidential task due more than 72 hours away and confirm only tv
   is removed.
3. On tasks due exactly 72 hours away, inside 72 hours, and overdue, confirm the
   control is unavailable and says to ask an Admin or Co-Admin. It must not
   mention Request Backup.
4. On a Completed assignment, confirm the control is unavailable with the
   Completed-specific Admin/Co-Admin message and the status stays Completed.
5. On a confidential task where assignment is tv's only access, confirm the
   modal warns that access will be lost. Confirm and verify detail/work-link
   access disappears after reconciliation.
6. On a confidential task where tv is also an allowed viewer, confirm the loss
   warning is absent and viewer access remains after leaving.
7. In the browser Network panel, confirm the page uses only
   `assign_task_people`, `delete_task`, and `unassign_self` for Step 7A writes;
   there is no raw `tasks` update/delete. Double-click each action and confirm
   only one request remains in flight.
