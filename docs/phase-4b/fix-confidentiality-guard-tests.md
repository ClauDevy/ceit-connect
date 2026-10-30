# Confidentiality task-guard regression tests

Run this as **one self-contained paste in the Dev SQL Editor only**, after applying
`20261030120000_fix_confidentiality_task_guard.sql`. Turn **Run without RLS** on.
Never run this paste on Prod. It owns uniquely tokenized Auth/profile fixtures,
impersonates every application caller with `set local role authenticated` plus JWT
claims, uses no temporary tables, and intentionally rolls the transaction back with
its final exception.

Expected result lines: **25** — 24 named `PASS` notices followed by
`TEST RESULTS: 24/24 PASS — confidentiality task guard; transaction intentionally rolled back`.
Every failed assertion raises a named `FAIL` exception instead.

```sql
begin;

do $fixtures$
declare
  v_token text := 'fix-confidentiality-guard-' || gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_coadmin_a uuid := gen_random_uuid();
  v_coadmin_b uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_assignee uuid := gen_random_uuid();
  v_requester uuid := gen_random_uuid();
  v_volunteer uuid := gen_random_uuid();
  v_committee_a uuid := gen_random_uuid();
  v_committee_b uuid := gen_random_uuid();
  v_active_event uuid := gen_random_uuid();
  v_draft_event uuid := gen_random_uuid();
  v_admin_active_task uuid := gen_random_uuid();
  v_admin_draft_task uuid := gen_random_uuid();
  v_coadmin_active_task uuid := gen_random_uuid();
  v_coadmin_draft_task uuid := gen_random_uuid();
  v_guard_task uuid := gen_random_uuid();
  v_denied_task uuid := gen_random_uuid();
  v_officer_leave_task uuid := gen_random_uuid();
  v_officer_help_task uuid := gen_random_uuid();
  v_cancel_task uuid := gen_random_uuid();
  v_approve_task uuid := gen_random_uuid();
  v_deny_task uuid := gen_random_uuid();
  v_accept_task uuid := gen_random_uuid();
begin
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  select
    fixture.id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    v_token || '-' || fixture.label || '@example.test',
    crypt('Confidentiality-guard-test-1!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('test_token', v_token || '-' || fixture.label),
    now(),
    now()
  from (values
    (v_admin, 'admin'),
    (v_coadmin_a, 'coadmin-a'),
    (v_coadmin_b, 'coadmin-b'),
    (v_viewer, 'viewer'),
    (v_assignee, 'assignee'),
    (v_requester, 'requester'),
    (v_volunteer, 'volunteer')
  ) as fixture(id, label);

  insert into public.committees(id, name) values
    (v_committee_a, 'Confidentiality Guard A ' || v_token),
    (v_committee_b, 'Confidentiality Guard B ' || v_token);

  perform pg_catalog.set_config('ceit_connect.officer_writer', 'invite_new_officer', true);
  insert into public.users(id, email, full_name, role, committee_id, is_active) values
    (v_admin, v_token || '-admin@example.test', 'Guard Admin', 'Admin', null, true),
    (v_coadmin_a, v_token || '-coadmin-a@example.test', 'Guard Co-Admin A', 'Co-Admin', v_committee_a, true),
    (v_coadmin_b, v_token || '-coadmin-b@example.test', 'Guard Co-Admin B', 'Co-Admin', v_committee_b, true);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users(id, email, full_name, role, committee_id, is_active) values
    (v_viewer, v_token || '-viewer@example.test', 'Guard Viewer', 'Member', v_committee_b, true),
    (v_assignee, v_token || '-assignee@example.test', 'Guard Assignee', 'Member', v_committee_a, true),
    (v_requester, v_token || '-requester@example.test', 'Guard Requester', 'Member', v_committee_a, true),
    (v_volunteer, v_token || '-volunteer@example.test', 'Guard Volunteer', 'Member', v_committee_b, true);

  insert into public.events(id, name, start_date, end_date, status, created_by) values
    (v_active_event, v_token || '-active', current_date, current_date + 1, 'Active', v_admin),
    (v_draft_event, v_token || '-draft', current_date, current_date + 1, 'Draft', v_admin);

  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', 'create_event_with_tasks', true);
  perform pg_catalog.set_config('ceit_connect.task_access_writer', 'create_active_event_task', true);
  insert into public.tasks(
    id, event_id, committee_id, title, phase, status, due_date,
    primary_assignees, assist_assignees, request_backup,
    is_confidential, allowed_viewers, created_by, sort_order
  ) values
    (v_admin_active_task, v_active_event, v_committee_a, v_token || '-admin-active', 'Guard', 'To Do', now() + interval '1 day', '{}', '{}', false, false, '{}', v_admin, 1024),
    (v_admin_draft_task, v_draft_event, v_committee_a, v_token || '-admin-draft', 'Guard', 'To Do', now() + interval '1 day', '{}', '{}', false, false, '{}', v_admin, 1024),
    (v_coadmin_active_task, v_active_event, v_committee_a, v_token || '-coadmin-active', 'Guard', 'To Do', now() + interval '1 day', '{}', '{}', false, false, '{}', v_admin, 2048),
    (v_coadmin_draft_task, v_draft_event, v_committee_a, v_token || '-coadmin-draft', 'Guard', 'To Do', now() + interval '1 day', '{}', '{}', false, false, '{}', v_admin, 2048),
    (v_guard_task, v_active_event, v_committee_a, v_token || '-guard', 'Guard', 'To Do', now() + interval '1 day', array[v_assignee], '{}', false, false, '{}', v_admin, 3072),
    (v_denied_task, v_active_event, v_committee_a, v_token || '-denied', 'Guard', 'To Do', now() + interval '1 day', '{}', '{}', false, false, '{}', v_admin, 4096),
    (v_officer_leave_task, v_active_event, v_committee_a, v_token || '-officer-leave', 'Actions', 'To Do', now(), array[v_coadmin_a], '{}', false, false, '{}', v_admin, 1024),
    (v_officer_help_task, v_active_event, v_committee_a, v_token || '-officer-help', 'Actions', 'To Do', now(), '{}', '{}', true, false, '{}', v_admin, 2048),
    (v_cancel_task, v_active_event, v_committee_a, v_token || '-cancel', 'Leave', 'To Do', now() + interval '1 hour', array[v_requester], '{}', false, false, '{}', v_admin, 1024),
    (v_approve_task, v_active_event, v_committee_a, v_token || '-approve', 'Leave', 'To Do', now() + interval '1 hour', array[v_requester], '{}', false, false, '{}', v_admin, 2048),
    (v_deny_task, v_active_event, v_committee_a, v_token || '-deny', 'Leave', 'To Do', now() + interval '1 hour', array[v_requester], '{}', false, false, '{}', v_admin, 3072),
    (v_accept_task, v_active_event, v_committee_a, v_token || '-accept', 'Volunteer', 'To Do', now() + interval '1 day', '{}', '{}', true, false, '{}', v_admin, 1024);
  perform pg_catalog.set_config('ceit_connect.task_access_writer', '', true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);

  perform pg_catalog.set_config('ceit_connect.test_token', v_token, true);
  perform pg_catalog.set_config('ceit_connect.test_admin', v_admin::text, true);
  perform pg_catalog.set_config('ceit_connect.test_coadmin_a', v_coadmin_a::text, true);
  perform pg_catalog.set_config('ceit_connect.test_coadmin_b', v_coadmin_b::text, true);
  perform pg_catalog.set_config('ceit_connect.test_viewer', v_viewer::text, true);
  perform pg_catalog.set_config('ceit_connect.test_assignee', v_assignee::text, true);
  perform pg_catalog.set_config('ceit_connect.test_requester', v_requester::text, true);
  perform pg_catalog.set_config('ceit_connect.test_volunteer', v_volunteer::text, true);
  perform pg_catalog.set_config('ceit_connect.test_committee_a', v_committee_a::text, true);
  perform pg_catalog.set_config('ceit_connect.test_active_event', v_active_event::text, true);
  perform pg_catalog.set_config('ceit_connect.test_admin_active_task', v_admin_active_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_admin_draft_task', v_admin_draft_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_coadmin_active_task', v_coadmin_active_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_coadmin_draft_task', v_coadmin_draft_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_guard_task', v_guard_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_denied_task', v_denied_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_officer_leave_task', v_officer_leave_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_officer_help_task', v_officer_help_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_cancel_task', v_cancel_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_approve_task', v_approve_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_deny_task', v_deny_task::text, true);
  perform pg_catalog.set_config('ceit_connect.test_accept_task', v_accept_task::text, true);
end;
$fixtures$;

do $catalog$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_public_execute boolean;
begin
  select * into strict v_proc
  from pg_catalog.pg_proc
  where oid = 'public.restrict_assignee_task_updates()'::regprocedure;

  select exists(
    select 1
    from pg_catalog.aclexplode(coalesce(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) into v_public_execute;

  if v_proc.prosecdef
     or pg_catalog.pg_get_userbyid(v_proc.proowner) <> 'postgres'
     or v_proc.proconfig is distinct from array['search_path=""']::text[]
     or pg_catalog.position('ceit_connect.task_access_writer' in v_proc.prosrc) = 0
     or pg_catalog.position('The task confidentiality writer attempted an out-of-scope update.' in v_proc.prosrc) = 0
     or v_public_execute
     or pg_catalog.has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') then
    raise exception 'FAIL [01 trigger catalog] Expected invoker security, postgres ownership, empty search_path, the exact access branch, and no client execute grants.';
  end if;
  raise notice 'PASS [01 trigger catalog] exact access-marker branch, invoker security, owner, empty search_path, and revokes are present';
end;
$catalog$;

set local role authenticated;
do $admin_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_admin'), 'role', 'authenticated')::text,
    true
  );
end;
$admin_claims$;

do $admin_confidentiality$
declare
  v_task uuid;
  v_viewer uuid := current_setting('ceit_connect.test_viewer')::uuid;
  v_assignee uuid := current_setting('ceit_connect.test_assignee')::uuid;
  v_denied boolean;
  v_message text;
begin
  v_task := current_setting('ceit_connect.test_admin_active_task')::uuid;
  perform * from public.set_task_confidentiality(v_task, true, '{}');
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [02 Admin Active confidentiality] true with empty viewers was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, true, array[v_viewer]);
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers=array[v_viewer]) then
    raise exception 'FAIL [02 Admin Active confidentiality] true with one eligible viewer was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, false, '{}');
  if not exists(select 1 from public.tasks where id=v_task and not is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [02 Admin Active confidentiality] false with empty viewers was not stored.';
  end if;
  raise notice 'PASS [02 Admin Active confidentiality] public RPC stored true-empty, true-one-viewer, then false-empty';

  v_task := current_setting('ceit_connect.test_admin_draft_task')::uuid;
  perform * from public.set_task_confidentiality(v_task, true, '{}');
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [03 Admin Draft confidentiality] true with empty viewers was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, true, array[v_viewer]);
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers=array[v_viewer]) then
    raise exception 'FAIL [03 Admin Draft confidentiality] true with one eligible viewer was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, false, '{}');
  if not exists(select 1 from public.tasks where id=v_task and not is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [03 Admin Draft confidentiality] final stored row is incorrect.';
  end if;
  raise notice 'PASS [03 Admin Draft confidentiality] public RPC stored true-empty, true-one-viewer, then false-empty';

  v_task := current_setting('ceit_connect.test_guard_task')::uuid;
  v_denied := false;
  begin
    perform * from public.set_task_confidentiality(v_task, true, array[v_assignee]);
  exception when sqlstate 'CCP01' then v_denied := true; end;
  if not v_denied then
    raise exception 'FAIL [04 assignee viewer guard] An existing assignee was accepted as a new viewer.';
  end if;
  raise notice 'PASS [04 assignee viewer guard] public RPC rejects an existing assignee as a new viewer with CCP01';

  v_denied := false;
  begin
    perform * from public.set_task_confidentiality(
      current_setting('ceit_connect.test_denied_task')::uuid,
      true,
      array[current_setting('ceit_connect.test_admin')::uuid]
    );
  exception when sqlstate 'CCP01' then v_denied := true; end;
  if not v_denied then
    raise exception 'FAIL [05 actor viewer guard] The acting Admin was accepted as a new viewer.';
  end if;
  raise notice 'PASS [05 actor viewer guard] public RPC rejects the actor as a new viewer with CCP01';

  v_denied := false;
  v_message := null;
  begin
    update public.tasks set is_confidential=true
    where id=current_setting('ceit_connect.test_denied_task')::uuid;
  exception when sqlstate '42501' then
    v_denied := true;
    get stacked diagnostics v_message=message_text;
  end;
  if not v_denied or v_message <> 'Task access must be written through an approved function.' then
    raise exception 'FAIL [06 raw authenticated access update] Expected the access guard denial, got %.', coalesce(v_message, '<none>');
  end if;
  raise notice 'PASS [06 raw authenticated access update] authenticated Admin cannot update confidentiality outside the public RPC';
end;
$admin_confidentiality$;
reset role;

set local role authenticated;
do $coadmin_a_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_coadmin_a'), 'role', 'authenticated')::text,
    true
  );
end;
$coadmin_a_claims$;

do $coadmin_confidentiality$
declare
  v_task uuid;
  v_viewer uuid := current_setting('ceit_connect.test_viewer')::uuid;
begin
  v_task := current_setting('ceit_connect.test_coadmin_active_task')::uuid;
  perform * from public.set_task_confidentiality(v_task, true, '{}');
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [07 owning Co-Admin Active confidentiality] true with empty viewers was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, true, array[v_viewer]);
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers=array[v_viewer]) then
    raise exception 'FAIL [07 owning Co-Admin Active confidentiality] true with one eligible viewer was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, false, '{}');
  if not exists(select 1 from public.tasks where id=v_task and not is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [07 owning Co-Admin Active confidentiality] final stored row is incorrect.';
  end if;
  raise notice 'PASS [07 owning Co-Admin Active confidentiality] public RPC stored true-empty, true-one-viewer, then false-empty';

  v_task := current_setting('ceit_connect.test_coadmin_draft_task')::uuid;
  perform * from public.set_task_confidentiality(v_task, true, '{}');
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [08 owning Co-Admin Draft confidentiality] true with empty viewers was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, true, array[v_viewer]);
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers=array[v_viewer]) then
    raise exception 'FAIL [08 owning Co-Admin Draft confidentiality] true with one eligible viewer was not stored.';
  end if;
  perform * from public.set_task_confidentiality(v_task, false, '{}');
  if not exists(select 1 from public.tasks where id=v_task and not is_confidential and allowed_viewers='{}'::uuid[]) then
    raise exception 'FAIL [08 owning Co-Admin Draft confidentiality] final stored row is incorrect.';
  end if;
  raise notice 'PASS [08 owning Co-Admin Draft confidentiality] public RPC stored true-empty, true-one-viewer, then false-empty';
end;
$coadmin_confidentiality$;
reset role;

set local role authenticated;
do $coadmin_b_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_coadmin_b'), 'role', 'authenticated')::text,
    true
  );
end;
$coadmin_b_claims$;

do $wrong_coadmin$
declare
  v_denied boolean := false;
  v_message text;
begin
  begin
    perform * from public.set_task_confidentiality(
      current_setting('ceit_connect.test_denied_task')::uuid, true, '{}'
    );
  exception when sqlstate '42501' then
    v_denied := true;
    get stacked diagnostics v_message=message_text;
  end;
  if not v_denied or v_message <> 'You are not allowed to change this task''s confidentiality.' then
    raise exception 'FAIL [09 other-committee Co-Admin] Expected fixed authorization denial, got %.', coalesce(v_message, '<none>');
  end if;
  raise notice 'PASS [09 other-committee Co-Admin] public RPC denies a Co-Admin from another committee';
end;
$wrong_coadmin$;
reset role;

do $postgres_denials$
declare
  v_task uuid := current_setting('ceit_connect.test_denied_task')::uuid;
  v_denied boolean;
  v_message text;
begin
  perform pg_catalog.set_config('ceit_connect.task_access_writer', '', true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  v_denied := false;
  v_message := null;
  begin
    update public.tasks set is_confidential=true where id=v_task;
  exception when sqlstate '42501' then
    v_denied := true;
    get stacked diagnostics v_message=message_text;
  end;
  if not v_denied or v_message <> 'Task access must be written through an approved function.' then
    raise exception 'FAIL [10 postgres without marker] Expected access-guard denial, got %.', coalesce(v_message, '<none>');
  end if;
  raise notice 'PASS [10 postgres without marker] postgres cannot write access fields without an approved access marker';

  perform pg_catalog.set_config('ceit_connect.task_access_writer', 'create_active_event_task', true);
  v_denied := false;
  v_message := null;
  begin
    update public.tasks set is_confidential=true where id=v_task;
  exception when others then
    v_denied := true;
    get stacked diagnostics v_message=message_text;
  end;
  if not v_denied or v_message <> 'Privileged task writers may update only status, sort_order, depends_on_task_id, primary_assignees, assist_assignees, and request_backup.' then
    raise exception 'FAIL [11 another access writer marker] Expected six-column restriction denial, got %.', coalesce(v_message, '<none>');
  end if;
  raise notice 'PASS [11 another access writer marker] a different approved access writer still reaches and fails the six-column branch';

  perform pg_catalog.set_config('ceit_connect.task_access_writer', 'set_task_confidentiality', true);
  v_denied := false;
  v_message := null;
  begin
    update public.tasks
    set is_confidential=true, title=title || '-forbidden'
    where id=v_task;
  exception when others then
    v_denied := true;
    get stacked diagnostics v_message=message_text;
  end;
  if not v_denied or v_message <> 'The task confidentiality writer attempted an out-of-scope update.' then
    raise exception 'FAIL [12 confidentiality marker plus title] Expected fixed out-of-scope denial, got %.', coalesce(v_message, '<none>');
  end if;
  raise notice 'PASS [12 confidentiality marker plus title] exact marker cannot change title alongside access fields';

  v_denied := false;
  v_message := null;
  begin
    update public.tasks
    set is_confidential=true, status='In Progress'
    where id=v_task;
  exception when others then
    v_denied := true;
    get stacked diagnostics v_message=message_text;
  end;
  if not v_denied or v_message <> 'The task confidentiality writer attempted an out-of-scope update.' then
    raise exception 'FAIL [13 confidentiality marker plus status] Expected fixed out-of-scope denial, got %.', coalesce(v_message, '<none>');
  end if;
  raise notice 'PASS [13 confidentiality marker plus status] exact marker cannot change status alongside access fields';
  perform pg_catalog.set_config('ceit_connect.task_access_writer', '', true);
end;
$postgres_denials$;

set local role authenticated;
do $coadmin_actions_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_coadmin_a'), 'role', 'authenticated')::text,
    true
  );
end;
$coadmin_actions_claims$;

do $officer_actions$
declare
  v_actor uuid := current_setting('ceit_connect.test_coadmin_a')::uuid;
  v_task uuid;
  v_no_offer boolean := false;
begin
  v_task := current_setting('ceit_connect.test_officer_leave_task')::uuid;
  perform * from public.unassign_self(v_task);
  if exists(select 1 from public.tasks where id=v_task and (v_actor=any(primary_assignees) or v_actor=any(assist_assignees)))
     or exists(select 1 from public.list_pending_task_leave_requests(v_task)) then
    raise exception 'FAIL [14 officer immediate leave] Officer remained assigned or created a request.';
  end if;
  raise notice 'PASS [14 officer immediate leave] owning Co-Admin leaves immediately through public unassign_self';

  v_task := current_setting('ceit_connect.test_officer_help_task')::uuid;
  perform * from public.volunteer_for_task(v_task);
  begin
    perform public.withdraw_task_volunteer(v_task);
  exception when sqlstate 'CCB06' then v_no_offer := true; end;
  if not exists(select 1 from public.tasks where id=v_task and v_actor=any(assist_assignees))
     or not v_no_offer then
    raise exception 'FAIL [15 officer immediate helper] Officer was not assigned directly or a pending offer remained.';
  end if;
  raise notice 'PASS [15 officer immediate helper] owning Co-Admin becomes an assist assignee through public volunteer_for_task';
end;
$officer_actions$;
reset role;

set local role authenticated;
do $requester_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_requester'), 'role', 'authenticated')::text,
    true
  );
end;
$requester_claims$;

do $member_requests$
declare
  v_request uuid;
begin
  perform * from public.unassign_self(current_setting('ceit_connect.test_cancel_task')::uuid);
  select out_id into v_request
  from public.list_pending_task_leave_requests(current_setting('ceit_connect.test_cancel_task')::uuid)
  where out_is_requester;
  if v_request is null then
    raise exception 'FAIL [16 Member inside-72-hours request] Public unassign_self did not create a pending request.';
  end if;
  raise notice 'PASS [16 Member inside-72-hours request] assigned Member creates a pending request through public unassign_self';

  perform public.cancel_task_leave_request(current_setting('ceit_connect.test_cancel_task')::uuid);
  if exists(select 1 from public.list_pending_task_leave_requests(current_setting('ceit_connect.test_cancel_task')::uuid)) then
    raise exception 'FAIL [17 requester cancellation] Pending request remained visible after cancellation.';
  end if;
  raise notice 'PASS [17 requester cancellation] requester cancels through public cancel_task_leave_request';

  perform * from public.unassign_self(current_setting('ceit_connect.test_approve_task')::uuid);
  select out_id into v_request
  from public.list_pending_task_leave_requests(current_setting('ceit_connect.test_approve_task')::uuid)
  where out_is_requester;
  if v_request is null then raise exception 'FAIL [18 approval fixture] Approval request was not created.'; end if;
  perform pg_catalog.set_config('ceit_connect.test_approve_request', v_request::text, true);

  perform * from public.unassign_self(current_setting('ceit_connect.test_deny_task')::uuid);
  select out_id into v_request
  from public.list_pending_task_leave_requests(current_setting('ceit_connect.test_deny_task')::uuid)
  where out_is_requester;
  if v_request is null then raise exception 'FAIL [19 denial fixture] Denial request was not created.'; end if;
  perform pg_catalog.set_config('ceit_connect.test_deny_request', v_request::text, true);
end;
$member_requests$;
reset role;

set local role authenticated;
do $admin_resolution_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_admin'), 'role', 'authenticated')::text,
    true
  );
end;
$admin_resolution_claims$;

do $leadership_resolution$
declare
  v_requester uuid := current_setting('ceit_connect.test_requester')::uuid;
begin
  perform public.resolve_task_leave_request(current_setting('ceit_connect.test_approve_request')::uuid, 'approved');
  if exists(select 1 from public.tasks where id=current_setting('ceit_connect.test_approve_task')::uuid and (v_requester=any(primary_assignees) or v_requester=any(assist_assignees)))
     or exists(select 1 from public.list_pending_task_leave_requests(current_setting('ceit_connect.test_approve_task')::uuid)) then
    raise exception 'FAIL [18 leadership approval] Request remained pending or requester remained assigned.';
  end if;
  raise notice 'PASS [18 leadership approval] Admin approves through public resolve_task_leave_request and removes the requester';

  perform public.resolve_task_leave_request(current_setting('ceit_connect.test_deny_request')::uuid, 'denied');
  if not exists(select 1 from public.tasks where id=current_setting('ceit_connect.test_deny_task')::uuid and v_requester=any(primary_assignees))
     or exists(select 1 from public.list_pending_task_leave_requests(current_setting('ceit_connect.test_deny_task')::uuid)) then
    raise exception 'FAIL [19 leadership denial] Request remained pending or requester assignment changed.';
  end if;
  raise notice 'PASS [19 leadership denial] Admin denies through public resolve_task_leave_request without changing assignment';
end;
$leadership_resolution$;
reset role;

set local role authenticated;
do $volunteer_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_volunteer'), 'role', 'authenticated')::text,
    true
  );
end;
$volunteer_claims$;

do $member_volunteer$
declare
  v_task uuid;
  v_user uuid;
begin
  select out_task_id, out_user_id into v_task, v_user
  from public.volunteer_for_task(current_setting('ceit_connect.test_accept_task')::uuid);
  if v_task is distinct from current_setting('ceit_connect.test_accept_task')::uuid
     or v_user is distinct from current_setting('ceit_connect.test_volunteer')::uuid then
    raise exception 'FAIL [20 Member volunteer offer] Public volunteer_for_task did not create a pending offer.';
  end if;
  raise notice 'PASS [20 Member volunteer offer] Member creates a pending offer through public volunteer_for_task';
end;
$member_volunteer$;
reset role;

set local role authenticated;
do $admin_final_claims$
begin
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', current_setting('ceit_connect.test_admin'), 'role', 'authenticated')::text,
    true
  );
end;
$admin_final_claims$;

do $accept_and_active_editor$
declare
  v_task uuid;
  v_updated_at timestamptz;
  v_viewer uuid := current_setting('ceit_connect.test_viewer')::uuid;
  v_second_viewer uuid := current_setting('ceit_connect.test_volunteer')::uuid;
begin
  perform * from public.accept_task_volunteer(
    current_setting('ceit_connect.test_accept_task')::uuid,
    current_setting('ceit_connect.test_volunteer')::uuid
  );
  if not exists(
    select 1 from public.tasks
    where id=current_setting('ceit_connect.test_accept_task')::uuid
      and current_setting('ceit_connect.test_volunteer')::uuid=any(assist_assignees)
  ) then
    raise exception 'FAIL [21 volunteer acceptance] Accepted volunteer is missing from assist assignees.';
  end if;
  raise notice 'PASS [21 volunteer acceptance] Admin accepts through public accept_task_volunteer and the guarded assignment succeeds';

  select out_task_id, out_updated_at into v_task, v_updated_at
  from public.create_active_event_task(
    current_setting('ceit_connect.test_active_event')::uuid,
    current_setting('ceit_connect.test_token') || '-rpc-created',
    'Created through the public RPC',
    'RPC',
    current_setting('ceit_connect.test_committee_a')::uuid,
    'Deliverable',
    'Medium',
    now() + interval '1 day',
    null,
    null,
    '{}',
    true,
    array[v_viewer]
  );
  if not exists(select 1 from public.tasks where id=v_task and is_confidential and allowed_viewers=array[v_viewer]) then
    raise exception 'FAIL [22 create Active task with viewers] Stored access fields are incorrect.';
  end if;
  raise notice 'PASS [22 create Active task with viewers] Admin creates through public create_active_event_task with one eligible viewer';

  perform * from public.edit_active_event_task(
    v_task,
    v_updated_at,
    current_setting('ceit_connect.test_token') || '-rpc-edited',
    'Edited through the public RPC',
    'RPC',
    current_setting('ceit_connect.test_committee_a')::uuid,
    'Deliverable',
    'High',
    now() + interval '2 days',
    null,
    null,
    '{}',
    true,
    array[v_viewer, v_second_viewer]
  );
  if not exists(
    select 1 from public.tasks
    where id=v_task
      and title=current_setting('ceit_connect.test_token') || '-rpc-edited'
      and is_confidential
      and allowed_viewers=array[v_viewer, v_second_viewer]
  ) then
    raise exception 'FAIL [23 edit Active task with viewers] Stored edit/access fields are incorrect.';
  end if;
  raise notice 'PASS [23 edit Active task with viewers] Admin edits through public edit_active_event_task with two eligible viewers';
end;
$accept_and_active_editor$;
reset role;

do $marker_cleanup$
begin
  if coalesce(pg_catalog.current_setting('ceit_connect.task_access_writer', true), '') <> ''
     or coalesce(pg_catalog.current_setting('ceit_connect.task_assignee_writer', true), '') <> ''
     or coalesce(pg_catalog.current_setting('ceit_connect.task_self_assignment_writer', true), '') <> '' then
    raise exception 'FAIL [24 marker cleanup] A writer marker remained set after successful public RPC calls.';
  end if;
  raise notice 'PASS [24 marker cleanup] access, assignee, and self-assignment markers are empty after public RPC success paths';
end;
$marker_cleanup$;

do $results$
begin
  raise exception 'TEST RESULTS: 24/24 PASS — confidentiality task guard; transaction intentionally rolled back';
end;
$results$;
```

## Prod read-only

After the migration has been pushed to Prod by the owner, run this **single-row,
read-only** catalog query in the Prod SQL Editor. Every boolean must be `true`.

```sql
with target as (
  select
    proc.oid,
    proc.prosrc,
    proc.proowner,
    proc.proconfig,
    proc.proacl
  from pg_catalog.pg_proc proc
  where proc.oid = 'public.restrict_assignee_task_updates()'::regprocedure
), public_acl as (
  select exists (
    select 1
    from target
    cross join lateral pg_catalog.aclexplode(
      coalesce(target.proacl, pg_catalog.acldefault('f', target.proowner))
    ) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) as can_execute
)
select pg_catalog.jsonb_build_object(
  'has_exact_access_marker_branch',
    pg_catalog.position('ceit_connect.task_access_writer' in target.prosrc) > 0
    and pg_catalog.position(
      'The task confidentiality writer attempted an out-of-scope update.'
      in target.prosrc
    ) > 0,
  'owner_is_postgres', pg_catalog.pg_get_userbyid(target.proowner) = 'postgres',
  'empty_search_path', target.proconfig = array['search_path=""']::text[],
  'public_cannot_execute', not public_acl.can_execute,
  'anon_cannot_execute',
    not pg_catalog.has_function_privilege('anon', target.oid, 'EXECUTE'),
  'authenticated_cannot_execute',
    not pg_catalog.has_function_privilege('authenticated', target.oid, 'EXECUTE')
) as confidentiality_guard_prod_catalog
from target
cross join public_acl;
```
