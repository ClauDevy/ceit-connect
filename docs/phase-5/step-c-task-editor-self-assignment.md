# Phase 5 Batch C — task-editor self-assignment

Board and Event task create/edit assignee pickers now include the active Admin or own-committee Co-Admin who is editing. Viewer choices and every non-assignee rule remain unchanged. Migration `20261123120000_task_editor_self_assignment.sql` is required.

Manual UI check: as an Admin, add and edit a Board task and an Event task for two different committees and select yourself. As a Co-Admin, repeat for your committee and confirm no other committee is manageable. In the Board editor, confirm you still do not appear under additional viewers. Save, refresh, and confirm the assignment remains.

## Dev SQL paste

Run once in the Dev SQL Editor with **Run without RLS** after applying the migration. The final `TEST RESULTS` exception is intentional and rolls back every fixture. The finished paste is 448 lines and contains 17 result rows.

```sql
begin;

create temporary table batch_c_results (
  seq integer generated always as identity,
  label text not null,
  passed boolean not null
) on commit drop;

create function pg_temp.batch_c_insert_self(
  p_marker text,
  p_actor uuid,
  p_event uuid,
  p_committee uuid,
  p_title text
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_task uuid;
begin
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', p_marker, true
  );
  insert into public.tasks(
    event_id, committee_id, title, phase, status, priority, task_type,
    primary_assignees, assist_assignees, is_confidential, allowed_viewers
  ) values (
    p_event, p_committee, p_title, 'Setup', 'To Do', 'Medium',
    'Deliverable', array[p_actor], '{}', false, '{}'
  ) returning id into v_task;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  return v_task;
exception when others then
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  raise;
end;
$$;

create function pg_temp.batch_c_insert_unassigned(
  p_event uuid,
  p_committee uuid,
  p_title text
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_task uuid;
begin
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'create_event_with_tasks', true
  );
  insert into public.tasks(
    event_id, committee_id, title, phase, status, priority, task_type,
    primary_assignees, assist_assignees, is_confidential, allowed_viewers
  ) values (
    p_event, p_committee, p_title, 'Setup', 'To Do', 'Medium',
    'Deliverable', '{}', '{}', false, '{}'
  ) returning id into v_task;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  return v_task;
exception when others then
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  raise;
end;
$$;

do $test$
declare
  admin_id constant uuid := 'c1000000-0000-4000-8000-000000000001';
  coadmin_id constant uuid := 'c1000000-0000-4000-8000-000000000002';
  member_id constant uuid := 'c1000000-0000-4000-8000-000000000003';
  inactive_id constant uuid := 'c1000000-0000-4000-8000-000000000004';
  own_committee constant uuid := 'c1000000-0000-4000-8000-000000000101';
  other_committee constant uuid := 'c1000000-0000-4000-8000-000000000102';
  event_id constant uuid := 'c1000000-0000-4000-8000-000000000201';
  task_id uuid;
  notification_task_id uuid;
  ok boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'Batch C paste must run without RLS as postgres.';
  end if;

  insert into public.committees(id, name) values
    (own_committee, 'Batch C Own Committee'),
    (other_committee, 'Batch C Other Committee');

  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    (admin_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'batch-c-admin@example.test',
      crypt('Batch-C-test-1!', gen_salt('bf')), pg_catalog.now(), '{}', '{}',
      pg_catalog.now(), pg_catalog.now()),
    (coadmin_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'batch-c-coadmin@example.test',
      crypt('Batch-C-test-1!', gen_salt('bf')), pg_catalog.now(), '{}', '{}',
      pg_catalog.now(), pg_catalog.now()),
    (member_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'batch-c-member@example.test',
      crypt('Batch-C-test-1!', gen_salt('bf')), pg_catalog.now(), '{}', '{}',
      pg_catalog.now(), pg_catalog.now()),
    (inactive_id, '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'batch-c-inactive@example.test',
      crypt('Batch-C-test-1!', gen_salt('bf')), pg_catalog.now(), '{}', '{}',
      pg_catalog.now(), pg_catalog.now());

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values
    (admin_id, 'batch-c-admin@example.test', 'Batch C Admin',
      'Admin', null, true),
    (coadmin_id, 'batch-c-coadmin@example.test', 'Batch C Co-Admin',
      'Co-Admin', own_committee, true),
    (inactive_id, 'batch-c-inactive@example.test', 'Batch C Inactive',
      'Co-Admin', own_committee, false);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);
  insert into public.users(
    id, email, full_name, role, committee_id, is_active
  ) values (
    member_id, 'batch-c-member@example.test', 'Batch C Member',
    'Member', own_committee, true
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  insert into public.events(
    id, name, start_date, end_date, status, created_by
  ) values (
    event_id, 'Batch C Active Event', current_date, current_date + 30,
    'Draft', admin_id
  );
  perform pg_temp.batch_c_insert_unassigned(
    event_id, own_committee, 'Batch C launch seed'
  );
  update public.events set status = 'Active' where id = event_id;

  task_id := pg_temp.batch_c_insert_self(
    'create_event_with_tasks', admin_id, event_id, other_committee,
    'Admin Event create self'
  );
  insert into batch_c_results(label, passed) values (
    'Admin Event create may self-select across committees',
    (select admin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  task_id := pg_temp.batch_c_insert_self(
    'create_event_from_archived_template', admin_id, event_id, other_committee,
    'Admin template create self'
  );
  insert into batch_c_results(label, passed) values (
    'Admin template Event create may self-select',
    (select admin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  notification_task_id := pg_temp.batch_c_insert_self(
    'create_active_event_task', admin_id, event_id, other_committee,
    'Admin Board create self'
  );
  insert into batch_c_results(label, passed) values (
    'Admin Board create may self-select across committees',
    (select admin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = notification_task_id)
  );

  insert into batch_c_results(label, passed) values (
    'Self-selection sends no assignment notification to actor',
    not exists(
      select 1 from public.notifications as notification_row
      where notification_row.user_id = admin_id and notification_row.task_id = notification_task_id
    )
  );

  task_id := pg_temp.batch_c_insert_unassigned(
    event_id, other_committee, 'Admin Event edit seed'
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_event_with_tasks', true
  );
  update public.tasks set primary_assignees = array[admin_id] where id = task_id;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  insert into batch_c_results(label, passed) values (
    'Admin Event edit may self-select across committees',
    (select admin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  task_id := pg_temp.batch_c_insert_unassigned(
    event_id, other_committee, 'Admin Board edit seed'
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_active_event_task', true
  );
  update public.tasks set primary_assignees = array[admin_id] where id = task_id;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  insert into batch_c_results(label, passed) values (
    'Admin Board edit may self-select across committees',
    (select admin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', coadmin_id, 'role', 'authenticated')::text,
    true
  );
  task_id := pg_temp.batch_c_insert_self(
    'create_active_event_task', coadmin_id, event_id, own_committee,
    'Co-Admin own create'
  );
  insert into batch_c_results(label, passed) values (
    'Co-Admin own-committee INSERT may self-select',
    (select coadmin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  task_id := pg_temp.batch_c_insert_unassigned(
    event_id, own_committee, 'Co-Admin own edit'
  );
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_active_event_task', true
  );
  update public.tasks set primary_assignees = array[coadmin_id] where id = task_id;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  insert into batch_c_results(label, passed) values (
    'Co-Admin UPDATE accepts matching old and new own committee',
    (select coadmin_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  ok := false;
  begin
    perform pg_temp.batch_c_insert_self(
      'create_active_event_task', coadmin_id, event_id, other_committee,
      'Co-Admin foreign create'
    );
  exception when others then
    ok := sqlstate = 'CCP01'
      and sqlerrm = 'The acting user cannot be newly selected.';
  end;
  insert into batch_c_results(label, passed) values (
    'Co-Admin foreign-committee INSERT is denied', ok
  );

  task_id := pg_temp.batch_c_insert_unassigned(
    event_id, own_committee, 'Co-Admin committee-change seed'
  );
  ok := false;
  begin
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', 'edit_active_event_task', true
    );
    update public.tasks
    set committee_id = other_committee,
        primary_assignees = array[coadmin_id]
    where id = task_id;
  exception when others then
    ok := sqlstate = 'CCP01'
      and sqlerrm = 'The acting user cannot be newly selected.';
  end;
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  insert into batch_c_results(label, passed) values (
    'Co-Admin UPDATE rejects a foreign new committee', ok
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', member_id, 'role', 'authenticated')::text,
    true
  );
  ok := false;
  begin
    perform pg_temp.batch_c_insert_self(
      'create_active_event_task', member_id, event_id, own_committee,
      'Member self create'
    );
  exception when others then
    ok := sqlstate = 'CCP01'
      and sqlerrm = 'The acting user cannot be newly selected.';
  end;
  insert into batch_c_results(label, passed) values (
    'Member editor-marker self-selection is denied', ok
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', inactive_id, 'role', 'authenticated')::text,
    true
  );
  ok := false;
  begin
    perform pg_temp.batch_c_insert_self(
      'create_active_event_task', inactive_id, event_id, own_committee,
      'Inactive self create'
    );
  exception when others then
    ok := sqlstate = 'CCP01'
      and sqlerrm = 'The acting user cannot be newly selected.';
  end;
  insert into batch_c_results(label, passed) values (
    'Inactive Co-Admin editor-marker self-selection is denied', ok
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  ok := false;
  begin
    perform pg_temp.batch_c_insert_self(
      'assign_task_people', admin_id, event_id, own_committee,
      'Assignment RPC marker self'
    );
  exception when others then
    ok := sqlstate = 'CCP01'
      and sqlerrm = 'The acting user cannot be newly selected.';
  end;
  insert into batch_c_results(label, passed) values (
    'assign_task_people marker retains self-selection denial', ok
  );

  ok := false;
  begin
    execute 'set local role authenticated';
    insert into public.tasks(
      event_id, committee_id, title, phase, status, priority, task_type,
      primary_assignees, assist_assignees, is_confidential, allowed_viewers
    ) values (
      event_id, own_committee, 'Raw authenticated self', 'Setup', 'To Do',
      'Medium', 'Deliverable', array[admin_id], '{}', false, '{}'
    );
  exception when others then
    ok := sqlstate = '42501'
      and sqlerrm = 'permission denied for table task_volunteers';
  end;
  execute 'reset role';
  insert into batch_c_results(label, passed) values (
    'Raw authenticated write keeps its existing task_volunteers denial', ok
  );

  task_id := pg_temp.batch_c_insert_unassigned(
    event_id, own_committee, 'Claim self seed'
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', member_id, 'role', 'authenticated')::text,
    true
  );
  perform * from public.claim_task(task_id);
  insert into batch_c_results(label, passed) values (
    'claim_task keeps its existing self-assignment exception',
    (select member_id = any(task_row.primary_assignees) from public.tasks as task_row where task_row.id = task_id)
  );

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object('sub', admin_id, 'role', 'authenticated')::text,
    true
  );
  ok := false;
  begin
    perform pg_catalog.set_config(
      'ceit_connect.task_assignee_writer', 'create_active_event_task', true
    );
    perform pg_catalog.set_config('ceit_connect.task_access_writer', 'create_active_event_task', true);
    insert into public.tasks(
      event_id, committee_id, title, phase, status, priority, task_type,
      primary_assignees, assist_assignees, is_confidential, allowed_viewers
    ) values (
      event_id, own_committee, 'Actor viewer overlap', 'Setup', 'To Do',
      'Medium', 'Deliverable', array[admin_id], '{}', true, array[admin_id]
    );
  exception when others then
    ok := sqlstate = 'CCP01';
  end;
  perform pg_catalog.set_config('ceit_connect.task_access_writer', '', true);
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
  insert into batch_c_results(label, passed) values (
    'Actor remains forbidden as both assignee and viewer', ok
  );

  insert into batch_c_results(label, passed)
  select 'Helper grants, trigger, and task policies stay narrow',
    not pg_catalog.has_function_privilege(
      'anon',
      'public.task_editor_self_assignment_allowed(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      'public.task_editor_self_assignment_allowed(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'service_role',
      'public.task_editor_self_assignment_allowed(uuid,uuid,uuid,text)',
      'EXECUTE'
    )
    and exists(
      select 1 from pg_catalog.pg_trigger
      where tgname = 'tasks_guard_assignee_writes' and not tgisinternal
    )
    and exists(
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'tasks'
        and policyname = 'tasks_insert'
    )
    and exists(
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'tasks'
        and policyname = 'tasks_update'
    );
end
$test$;

do $results$
declare
  passed_count integer;
  total_count integer;
  failed_labels text;
begin
  select pg_catalog.count(*) filter (where passed), pg_catalog.count(*)
  into passed_count, total_count
  from batch_c_results;

  select pg_catalog.string_agg(label, ', ' order by seq)
  into failed_labels
  from batch_c_results
  where not passed;

  raise exception 'TEST RESULTS %/% PASS; FAILED: % (intentional rollback)',
    passed_count, total_count, coalesce(failed_labels, 'none');
end
$results$;

rollback;
```
