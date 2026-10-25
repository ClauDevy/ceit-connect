# Step 3H: Home event progress tests

Run these only on **Dev**, after the owner applies
`20261025120000_home_event_progress.sql` through the normal migration process.
In the Supabase SQL Editor choose **Run without RLS**. Each numbered test is one
self-contained paste with its own `auth.users` fixtures and an intentional final
`TEST RESULTS` exception that rolls the transaction back.

Expected result lines:

- TEST 1: **18** lines.
- TEST 2: **19** lines.
- TEST 3: **20** lines.

No paste creates a temporary table, touches `storage.objects`, disables a
trigger, or weakens a constraint. Each paste issues `SET CONSTRAINTS ALL
IMMEDIATE` after establishing a valid final fixture state.

## TEST 1 — catalog, grants, validation, and active-profile gate

```sql
begin;

insert into public.committees (id, name) values
  ('3a100000-0000-4000-8000-000000000001', '3H T1 Committee');

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('3a100000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t1-active@test.local', '', now(), '{}', '{}', now(), now()),
  ('3a100000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t1-inactive@test.local', '', now(), '{}', '{}', now(), now()),
  ('3a100000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t1-profileless@test.local', '', now(), '{}', '{}', now(), now());

insert into public.users
  (id, email, full_name, role, committee_id, is_active)
values
  ('3a100000-0000-4000-8000-000000000011', '3h-t1-active@test.local', '3H T1 Active', 'Member', '3a100000-0000-4000-8000-000000000001', true),
  ('3a100000-0000-4000-8000-000000000012', '3h-t1-inactive@test.local', '3H T1 Inactive', 'Member', '3a100000-0000-4000-8000-000000000001', false);

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('3a100000-0000-4000-8000-000000000101', '3H T1 Active', '2026-10-25', '2026-10-26', 'Active', '3a100000-0000-4000-8000-000000000011');

insert into public.tasks
  (id, event_id, committee_id, title, phase, status, primary_assignees,
   assist_assignees, is_confidential, allowed_viewers, request_backup,
   created_by, sort_order)
values
  ('3a100000-0000-4000-8000-000000000201', '3a100000-0000-4000-8000-000000000101', '3a100000-0000-4000-8000-000000000001', '3H T1 Task', 'Setup', 'To Do', '{}', '{}', false, '{}', false, '3a100000-0000-4000-8000-000000000011', 1024);

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_proc oid := 'public.list_home_event_progress(uuid[])'::regprocedure;
  v_names text[];
  v_modes "char"[];
  v_types oid[];
begin
  select count(*) = 1 into v_ok
  from pg_catalog.pg_proc
  where oid = v_proc;
  v_results := v_results || format(E'\nEXACT_SIGNATURE_EXISTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_catalog.pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'list_home_event_progress';
  v_results := v_results || format(E'\nONE_NAME_ZERO_OVERLOADS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select proargnames, proargmodes, proallargtypes
  into v_names, v_modes, v_types
  from pg_catalog.pg_proc where oid = v_proc;
  v_ok := v_names = array['p_event_ids','out_event_id','out_phase_label','out_progress_percentage','out_visible_backup_request_count','out_backlog_count']
    and v_modes = array['i','t','t','t','t','t']::"char"[]
    and v_types = array['uuid[]'::regtype,'uuid'::regtype,'text'::regtype,'integer'::regtype,'integer'::regtype,'integer'::regtype]::oid[];
  v_results := v_results || format(E'\nFIXED_FIVE_COLUMN_OUTPUT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select prosecdef into v_ok from pg_catalog.pg_proc where oid = v_proc;
  v_results := v_results || format(E'\nSECURITY_DEFINER: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select provolatile = 's' into v_ok from pg_catalog.pg_proc where oid = v_proc;
  v_results := v_results || format(E'\nSTABLE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select proconfig = array['search_path=""']::text[] into v_ok from pg_catalog.pg_proc where oid = v_proc;
  v_results := v_results || format(E'\nFIXED_EMPTY_SEARCH_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select pg_catalog.pg_get_userbyid(proowner) = 'postgres' into v_ok from pg_catalog.pg_proc where oid = v_proc;
  v_results := v_results || format(E'\nPOSTGRES_OWNER: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select pg_catalog.has_function_privilege('authenticated', v_proc, 'EXECUTE') into v_ok;
  v_results := v_results || format(E'\nAUTHENTICATED_EXECUTE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select not pg_catalog.has_function_privilege('anon', v_proc, 'EXECUTE') into v_ok;
  v_results := v_results || format(E'\nANON_NO_EXECUTE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select not (coalesce((select proacl from pg_catalog.pg_proc where oid = v_proc), pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = v_proc)))::text ~ '(^\{|,)=X/') into v_ok;
  v_results := v_results || format(E'\nPUBLIC_NO_EXECUTE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  v_denied := false; begin perform count(*) from public.list_home_event_progress(null::uuid[]); exception when sqlstate '22023' then v_denied := true; end;
  v_results := v_results || format(E'\nNULL_ARRAY_22023: %s', case when v_denied then 'PASS' else 'FAIL' end);
  v_denied := false; begin perform count(*) from public.list_home_event_progress('{}'::uuid[]); exception when sqlstate '22023' then v_denied := true; end;
  v_results := v_results || format(E'\nEMPTY_ARRAY_22023: %s', case when v_denied then 'PASS' else 'FAIL' end);
  v_denied := false; begin perform count(*) from public.list_home_event_progress(array[null::uuid]); exception when sqlstate '22023' then v_denied := true; end;
  v_results := v_results || format(E'\nNULL_ELEMENT_22023: %s', case when v_denied then 'PASS' else 'FAIL' end);
  v_denied := false; begin perform count(*) from public.list_home_event_progress(pg_catalog.array_fill('3a100000-0000-4000-8000-000000000101'::uuid, array[21])); exception when sqlstate '22023' then v_denied := true; end;
  v_results := v_results || format(E'\nOVER_TWENTY_22023: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '{}', true);
  v_denied := false; begin perform count(*) from public.list_home_event_progress(array['3a100000-0000-4000-8000-000000000101'::uuid]); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nMISSING_CALLER_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000013","role":"authenticated"}', true);
  v_denied := false; begin perform count(*) from public.list_home_event_progress(array['3a100000-0000-4000-8000-000000000101'::uuid]); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nPROFILELESS_CALLER_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000012","role":"authenticated"}', true);
  v_denied := false; begin perform count(*) from public.list_home_event_progress(array['3a100000-0000-4000-8000-000000000101'::uuid]); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nINACTIVE_CALLER_42501: %s', case when v_denied then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '{"sub":"3a100000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  select count(*) = 1 into v_ok from public.list_home_event_progress(array['3a100000-0000-4000-8000-000000000101'::uuid]);
  v_results := v_results || format(E'\nACTIVE_CALLER_VALID_RESULT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — roles, confidential masking, lifecycle, and deduplication

```sql
begin;

insert into public.committees (id, name) values
  ('3a200000-0000-4000-8000-000000000001', '3H T2 One'),
  ('3a200000-0000-4000-8000-000000000002', '3H T2 Two');

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('3a200000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t2-admin@test.local', '', now(), '{}', '{}', now(), now()),
  ('3a200000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t2-coadmin@test.local', '', now(), '{}', '{}', now(), now()),
  ('3a200000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t2-member@test.local', '', now(), '{}', '{}', now(), now());

insert into public.users
  (id, email, full_name, role, committee_id, is_active)
values
  ('3a200000-0000-4000-8000-000000000011', '3h-t2-admin@test.local', '3H T2 Admin', 'Admin', null, true),
  ('3a200000-0000-4000-8000-000000000012', '3h-t2-coadmin@test.local', '3H T2 CoAdmin', 'Co-Admin', '3a200000-0000-4000-8000-000000000001', true),
  ('3a200000-0000-4000-8000-000000000013', '3h-t2-member@test.local', '3H T2 Member', 'Member', '3a200000-0000-4000-8000-000000000001', true);

insert into public.events
  (id, name, start_date, end_date, status, created_by)
values
  ('3a200000-0000-4000-8000-000000000101', '3H T2 Active', '2026-10-25', '2026-10-26', 'Active', '3a200000-0000-4000-8000-000000000011'),
  ('3a200000-0000-4000-8000-000000000102', '3H T2 Draft', '2026-10-25', '2026-10-26', 'Draft', '3a200000-0000-4000-8000-000000000011'),
  ('3a200000-0000-4000-8000-000000000103', '3H T2 Archive', '2026-10-25', '2026-10-26', 'Active', '3a200000-0000-4000-8000-000000000011');

insert into public.tasks
  (id, event_id, committee_id, title, phase, status, primary_assignees,
   assist_assignees, is_confidential, allowed_viewers, request_backup,
   created_by, sort_order)
values
  ('3a200000-0000-4000-8000-000000000201', '3a200000-0000-4000-8000-000000000101', '3a200000-0000-4000-8000-000000000001', 'Public complete', 'Setup', 'Completed', '{}', '{}', false, '{}', true, '3a200000-0000-4000-8000-000000000011', 100),
  ('3a200000-0000-4000-8000-000000000202', '3a200000-0000-4000-8000-000000000101', '3a200000-0000-4000-8000-000000000002', 'Confidential setup', 'Setup', 'To Do', '{}', '{}', true, array['3a200000-0000-4000-8000-000000000013']::uuid[], true, '3a200000-0000-4000-8000-000000000011', 200),
  ('3a200000-0000-4000-8000-000000000203', '3a200000-0000-4000-8000-000000000101', '3a200000-0000-4000-8000-000000000001', 'Public execute', 'Execute', 'In Progress', array['3a200000-0000-4000-8000-000000000011']::uuid[], '{}', false, '{}', true, '3a200000-0000-4000-8000-000000000011', 300),
  ('3a200000-0000-4000-8000-000000000204', '3a200000-0000-4000-8000-000000000102', '3a200000-0000-4000-8000-000000000001', 'Draft task', 'Draft phase', 'To Do', '{}', '{}', false, '{}', false, '3a200000-0000-4000-8000-000000000011', 100),
  ('3a200000-0000-4000-8000-000000000205', '3a200000-0000-4000-8000-000000000103', '3a200000-0000-4000-8000-000000000001', 'Archive task', 'Archive phase', 'To Do', '{}', '{}', false, '{}', false, '3a200000-0000-4000-8000-000000000011', 100);

update public.events set status = 'Archived'
where id = '3a200000-0000-4000-8000-000000000103';
set constraints all immediate;
set local role authenticated;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_admin record;
  v_coadmin record;
  v_member record;
begin
  perform set_config('request.jwt.claims', '{"sub":"3a200000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  select * into v_admin from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000101'::uuid]);
  v_results := v_results || format(E'\nADMIN_RECEIVES_ACTIVE: %s', case when v_admin.out_event_id is not null then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '{"sub":"3a200000-0000-4000-8000-000000000012","role":"authenticated"}', true);
  select * into v_coadmin from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000101'::uuid]);
  v_results := v_results || format(E'\nCOADMIN_RECEIVES_ACTIVE: %s', case when v_coadmin.out_event_id is not null then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '{"sub":"3a200000-0000-4000-8000-000000000013","role":"authenticated"}', true);
  select * into v_member from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000101'::uuid]);
  v_results := v_results || format(E'\nMEMBER_RECEIVES_ACTIVE: %s', case when v_member.out_event_id is not null then 'PASS' else 'FAIL' end);

  v_ok := v_admin.out_progress_percentage = 33 and v_coadmin.out_progress_percentage = 33 and v_member.out_progress_percentage = 33;
  v_results := v_results || format(E'\nROLE_INVARIANT_PROGRESS_INCLUDES_MASKED: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_ok := v_admin.out_phase_label = 'Setup' and v_coadmin.out_phase_label = 'Setup' and v_member.out_phase_label = 'Setup';
  v_results := v_results || format(E'\nROLE_INVARIANT_CURRENT_PHASE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_ok := v_admin.out_backlog_count = 1 and v_coadmin.out_backlog_count = 1 and v_member.out_backlog_count = 1;
  v_results := v_results || format(E'\nROLE_INVARIANT_BACKLOG: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nADMIN_SEES_TWO_OPEN_REQUESTS: %s', case when v_admin.out_visible_backup_request_count = 2 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nCOADMIN_MASKED_REQUEST_OMITTED: %s', case when v_coadmin.out_visible_backup_request_count = 1 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nMEMBER_ALLOWED_REQUEST_INCLUDED: %s', case when v_member.out_visible_backup_request_count = 2 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nMASKED_INCOMPLETE_AFFECTS_PERCENT: %s', case when v_coadmin.out_progress_percentage = 33 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nMASKED_UNASSIGNED_AFFECTS_BACKLOG: %s', case when v_coadmin.out_backlog_count = 1 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nMASKED_INCOMPLETE_SELECTS_PHASE: %s', case when v_coadmin.out_phase_label = 'Setup' then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000101'::uuid, '3a200000-0000-4000-8000-000000000101'::uuid]);
  v_results := v_results || format(E'\nDUPLICATE_ID_DEDUPED: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select count(*) = 0 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000999'::uuid]);
  v_results := v_results || format(E'\nUNKNOWN_ID_OMITTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000102'::uuid]);
  perform set_config('request.jwt.claims', '{"sub":"3a200000-0000-4000-8000-000000000012","role":"authenticated"}', true);
  select v_ok and count(*) = 0 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000102'::uuid]);
  perform set_config('request.jwt.claims', '{"sub":"3a200000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  v_results := v_results || format(E'\nDRAFT_OMITTED_FOR_PRIVILEGED_ROLES: %s', case when v_ok then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '{"sub":"3a200000-0000-4000-8000-000000000013","role":"authenticated"}', true);
  select count(*) = 0 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000102'::uuid]);
  v_results := v_results || format(E'\nDRAFT_OMITTED_FOR_MEMBER: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select count(*) = 0 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000103'::uuid]);
  v_results := v_results || format(E'\nARCHIVED_ID_OMITTED: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select count(*) = 1 into v_ok from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000999'::uuid, '3a200000-0000-4000-8000-000000000101'::uuid, '3a200000-0000-4000-8000-000000000102'::uuid]);
  v_results := v_results || format(E'\nMIXED_INPUT_RETURNS_ONLY_ACTIVE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select (array_agg(out_event_id))[1] = '3a200000-0000-4000-8000-000000000101'::uuid into v_ok
  from public.list_home_event_progress(array['3a200000-0000-4000-8000-000000000999'::uuid, '3a200000-0000-4000-8000-000000000101'::uuid]);
  v_results := v_results || format(E'\nVALID_RESULT_PRESERVES_FIRST_INPUT_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — percentage, zero/all-complete, phase order, Backlog, and backup state

The zero-task assertion uses the existing deferred final-task guard exactly as
implemented: delete the only task, read before the deferred check, restore the
task, and then force every deferred constraint immediate. If that behavior ever
changes, remove the two zero-task lines and change this test's expected count to
**18**; never disable the guard.

```sql
begin;

insert into public.committees (id, name) values
  ('3a300000-0000-4000-8000-000000000001', '3H T3 One'),
  ('3a300000-0000-4000-8000-000000000002', '3H T3 Two');

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('3a300000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t3-admin@test.local', '', now(), '{}', '{}', now(), now()),
  ('3a300000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '3h-t3-member@test.local', '', now(), '{}', '{}', now(), now());

insert into public.users
  (id, email, full_name, role, committee_id, is_active)
values
  ('3a300000-0000-4000-8000-000000000011', '3h-t3-admin@test.local', '3H T3 Admin', 'Admin', null, true),
  ('3a300000-0000-4000-8000-000000000012', '3h-t3-member@test.local', '3H T3 Member', 'Member', '3a300000-0000-4000-8000-000000000001', true);

insert into public.events
  (id, name, start_date, end_date, status, created_by)
select id, name, '2026-10-25'::date, '2026-10-26'::date, 'Active', '3a300000-0000-4000-8000-000000000011'::uuid
from (values
  ('3a300000-0000-4000-8000-000000000101'::uuid, '3H Zero'),
  ('3a300000-0000-4000-8000-000000000102'::uuid, '3H Complete'),
  ('3a300000-0000-4000-8000-000000000103'::uuid, '3H One Third'),
  ('3a300000-0000-4000-8000-000000000104'::uuid, '3H Two Thirds'),
  ('3a300000-0000-4000-8000-000000000105'::uuid, '3H Phase Order'),
  ('3a300000-0000-4000-8000-000000000106'::uuid, '3H Tie Order'),
  ('3a300000-0000-4000-8000-000000000107'::uuid, '3H Unphased'),
  ('3a300000-0000-4000-8000-000000000108'::uuid, '3H Backlog'),
  ('3a300000-0000-4000-8000-000000000109'::uuid, '3H Backup'),
  ('3a300000-0000-4000-8000-000000000110'::uuid, '3H Case Sensitive')
) fixture(id, name);

insert into public.tasks
  (id, event_id, committee_id, title, phase, status, primary_assignees,
   assist_assignees, is_confidential, allowed_viewers, request_backup,
   created_by, sort_order)
values
  ('3a300000-0000-4000-8000-000000000201', '3a300000-0000-4000-8000-000000000101', '3a300000-0000-4000-8000-000000000001', 'Zero restore', 'Only', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000202', '3a300000-0000-4000-8000-000000000102', '3a300000-0000-4000-8000-000000000001', 'Complete named', 'Done', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000203', '3a300000-0000-4000-8000-000000000102', '3a300000-0000-4000-8000-000000000001', 'Complete unphased', null, 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000204', '3a300000-0000-4000-8000-000000000103', '3a300000-0000-4000-8000-000000000001', 'Third done', 'P', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000205', '3a300000-0000-4000-8000-000000000103', '3a300000-0000-4000-8000-000000000001', 'Third todo', 'P', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000206', '3a300000-0000-4000-8000-000000000103', '3a300000-0000-4000-8000-000000000001', 'Third progress', 'P', 'In Progress', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 300),
  ('3a300000-0000-4000-8000-000000000207', '3a300000-0000-4000-8000-000000000104', '3a300000-0000-4000-8000-000000000001', 'Two third one', 'P', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000209', '3a300000-0000-4000-8000-000000000104', '3a300000-0000-4000-8000-000000000001', 'Two third two', 'P', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000210', '3a300000-0000-4000-8000-000000000104', '3a300000-0000-4000-8000-000000000001', 'Two third three', 'P', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 300),
  ('3a300000-0000-4000-8000-000000000211', '3a300000-0000-4000-8000-000000000105', '3a300000-0000-4000-8000-000000000001', 'Completed first', 'Setup', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000212', '3a300000-0000-4000-8000-000000000105', '3a300000-0000-4000-8000-000000000001', 'Later incomplete', 'Later', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000213', '3a300000-0000-4000-8000-000000000105', '3a300000-0000-4000-8000-000000000001', 'Execute incomplete', 'Execute', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 300),
  ('3a300000-0000-4000-8000-000000000214', '3a300000-0000-4000-8000-000000000106', '3a300000-0000-4000-8000-000000000001', 'Tie alpha', 'Alpha', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000215', '3a300000-0000-4000-8000-000000000106', '3a300000-0000-4000-8000-000000000001', 'Tie beta', 'Beta', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000216', '3a300000-0000-4000-8000-000000000107', '3a300000-0000-4000-8000-000000000001', 'Blank done', '   ', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000217', '3a300000-0000-4000-8000-000000000107', '3a300000-0000-4000-8000-000000000001', 'Null incomplete', null, 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000218', '3a300000-0000-4000-8000-000000000108', '3a300000-0000-4000-8000-000000000001', 'Unassigned', 'P', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000219', '3a300000-0000-4000-8000-000000000108', '3a300000-0000-4000-8000-000000000001', 'Assist only', 'P', 'To Do', '{}', array['3a300000-0000-4000-8000-000000000012']::uuid[], false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000220', '3a300000-0000-4000-8000-000000000108', '3a300000-0000-4000-8000-000000000001', 'Primary', 'P', 'To Do', array['3a300000-0000-4000-8000-000000000012']::uuid[], '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 300),
  ('3a300000-0000-4000-8000-000000000221', '3a300000-0000-4000-8000-000000000108', '3a300000-0000-4000-8000-000000000001', 'Completed unassigned', 'P', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 400),
  ('3a300000-0000-4000-8000-000000000222', '3a300000-0000-4000-8000-000000000109', '3a300000-0000-4000-8000-000000000001', 'Open', 'P', 'To Do', array['3a300000-0000-4000-8000-000000000011']::uuid[], '{}', false, '{}', true, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000223', '3a300000-0000-4000-8000-000000000109', '3a300000-0000-4000-8000-000000000001', 'Closed', 'P', 'To Do', array['3a300000-0000-4000-8000-000000000011']::uuid[], '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200),
  ('3a300000-0000-4000-8000-000000000224', '3a300000-0000-4000-8000-000000000109', '3a300000-0000-4000-8000-000000000001', 'Completed stale', 'P', 'Completed', array['3a300000-0000-4000-8000-000000000011']::uuid[], '{}', false, '{}', true, '3a300000-0000-4000-8000-000000000011', 300),
  ('3a300000-0000-4000-8000-000000000226', '3a300000-0000-4000-8000-000000000109', '3a300000-0000-4000-8000-000000000002', 'Masked open', 'P', 'To Do', '{}', '{}', true, '{}', true, '3a300000-0000-4000-8000-000000000011', 400);

insert into public.tasks
  (id, event_id, committee_id, title, phase, status, primary_assignees,
   assist_assignees, is_confidential, allowed_viewers, request_backup,
   created_by, sort_order)
values
  ('3a300000-0000-4000-8000-000000000227', '3a300000-0000-4000-8000-000000000107', '3a300000-0000-4000-8000-000000000001', 'Named after Unphased', 'Named', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 300),
  ('3a300000-0000-4000-8000-000000000228', '3a300000-0000-4000-8000-000000000110', '3a300000-0000-4000-8000-000000000001', 'Upper complete', 'Setup', 'Completed', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100),
  ('3a300000-0000-4000-8000-000000000229', '3a300000-0000-4000-8000-000000000110', '3a300000-0000-4000-8000-000000000001', 'Lower incomplete', 'setup', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 200);

insert into public.task_volunteers (task_id, user_id) values
  ('3a300000-0000-4000-8000-000000000222', '3a300000-0000-4000-8000-000000000012');

set constraints all immediate;
set constraints all deferred;
delete from public.tasks where id = '3a300000-0000-4000-8000-000000000201';

set local role authenticated;
do $$
declare v_row record;
begin
  perform set_config('request.jwt.claims', '{"sub":"3a300000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  select * into v_row from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000101'::uuid]);
  perform set_config('test.3h.zero_phase', (v_row.out_phase_label is null)::text, true);
  perform set_config('test.3h.zero_percent', (v_row.out_progress_percentage = 0)::text, true);
end
$$;
reset role;

insert into public.tasks
  (id, event_id, committee_id, title, phase, status, primary_assignees,
   assist_assignees, is_confidential, allowed_viewers, request_backup,
   created_by, sort_order)
values
  ('3a300000-0000-4000-8000-000000000201', '3a300000-0000-4000-8000-000000000101', '3a300000-0000-4000-8000-000000000001', 'Zero restore', 'Only', 'To Do', '{}', '{}', false, '{}', false, '3a300000-0000-4000-8000-000000000011', 100);
set constraints all immediate;
set local role authenticated;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_row record;
begin
  perform set_config('request.jwt.claims', '{"sub":"3a300000-0000-4000-8000-000000000011","role":"authenticated"}', true);
  v_results := v_results || format(E'\nZERO_TASK_PHASE_NULL: %s', case when current_setting('test.3h.zero_phase') = 'true' then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nZERO_TASK_PERCENT_ZERO: %s', case when current_setting('test.3h.zero_percent') = 'true' then 'PASS' else 'FAIL' end);
  select * into v_row from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000102'::uuid]);
  v_results := v_results || format(E'\nALL_COMPLETE_LABEL: %s', case when v_row.out_phase_label = 'All phases complete' then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nALL_COMPLETE_PERCENT_100: %s', case when v_row.out_progress_percentage = 100 then 'PASS' else 'FAIL' end);
  select out_progress_percentage = 33 into v_ok from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000103'::uuid]);
  v_results := v_results || format(E'\nONE_THIRD_ROUNDS_33: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select out_progress_percentage = 67 into v_ok from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000104'::uuid]);
  v_results := v_results || format(E'\nTWO_THIRDS_ROUNDS_67: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select * into v_row from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000105'::uuid]);
  v_results := v_results || format(E'\nCOMPLETED_EARLIER_PHASE_SKIPPED: %s', case when v_row.out_phase_label <> 'Setup' then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nFIRST_INCOMPLETE_PHASE_SELECTED: %s', case when v_row.out_phase_label = 'Later' then 'PASS' else 'FAIL' end);
  select out_phase_label = 'setup' into v_ok from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000110'::uuid]);
  v_results := v_results || format(E'\nPHASE_KEYS_ARE_CASE_SENSITIVE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nSORT_ORDER_DEFINES_FIRST_SEEN: %s', case when v_row.out_phase_label = 'Later' then 'PASS' else 'FAIL' end);
  select out_phase_label = 'Alpha' into v_ok from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000106'::uuid]);
  v_results := v_results || format(E'\nTASK_ID_BREAKS_SORT_ORDER_TIE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select * into v_row from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000107'::uuid]);
  v_results := v_results || format(E'\nNULL_PHASE_NORMALIZES_UNPHASED: %s', case when v_row.out_phase_label = 'Unphased' then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nBLANK_PHASE_JOINS_UNPHASED: %s', case when v_row.out_phase_label = 'Unphased' then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nUNPHASED_FIRST_SEEN_POSITION: %s', case when v_row.out_phase_label = 'Unphased' then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nINCOMPLETE_UNPHASED_IS_CURRENT: %s', case when v_row.out_phase_label = 'Unphased' then 'PASS' else 'FAIL' end);
  select out_phase_label = 'All phases complete' into v_ok from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000102'::uuid]);
  v_results := v_results || format(E'\nCOMPLETED_UNPHASED_ALLOWS_HOME_COMPLETE: %s', case when v_ok then 'PASS' else 'FAIL' end);
  select * into v_row from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000108'::uuid]);
  v_results := v_results || format(E'\nEMPTY_PRIMARY_COUNTS_BACKLOG: %s', case when v_row.out_backlog_count = 2 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nASSIST_ONLY_COUNTS_PRIMARY_BACKLOG: %s', case when v_row.out_backlog_count = 2 then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nPRIMARY_AND_COMPLETED_EXCLUDED_BACKLOG: %s', case when v_row.out_backlog_count = 2 then 'PASS' else 'FAIL' end);
  perform set_config('request.jwt.claims', '{"sub":"3a300000-0000-4000-8000-000000000012","role":"authenticated"}', true);
  select out_visible_backup_request_count = 1 into v_ok from public.list_home_event_progress(array['3a300000-0000-4000-8000-000000000109'::uuid]);
  v_results := v_results || format(E'\nOPEN_REAL_ONLY_AND_VOLUNTEERS_DO_NOT_MULTIPLY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## Manual checklist

Run on Dev as **Claudee (Admin)**, **Claude HAAAA (Co-Admin)**, and **tv
(Member)** at phone and desktop widths in both light and dark themes.

- Compare every Home percentage with the event-board header ring.
- Confirm phase order matches the board tabs, including `Unphased` at its actual
  first-seen position rather than forced first or last.
- Complete the final incomplete task in one phase and verify Home advances to
  the next incomplete phase after refresh. Complete every task and verify `All
  phases complete`.
- Compare Backlog with the board's unfiltered Backlog. Include unassigned,
  assist-only, primary-assigned, and Completed-unassigned tasks.
- Confirm the visible label is `Backup requests you can see`. A masked
  confidential request may make Claude HAAAA or tv's count lower than
  Claudee's, while phase, progress, and Backlog remain identical.
- Confirm no confidential title, description, committee, task id, assignee, or
  request state appears on Home.
- Confirm Draft cards are unchanged and never receive progress UI.
- Verify Active links, menus, archive confirmation counts, status badges, and
  descriptions are unchanged.
- Verify the combined Home page still shows 20 items, Load more remains stable,
  and only the visible Active subset is summarized.
- With the progress RPC unavailable, verify Active cards show `Progress
  unavailable` while the list, links, menus, Drafts, and Load more still work.
- Check long phase/event names, focus rings, progress semantics, contrast, and
  horizontal overflow.
