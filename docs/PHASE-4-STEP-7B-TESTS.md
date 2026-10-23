# Phase 4 Step 7B-DB — archive-only late-sharing tests

**Run on DEV only. Choose Run without RLS in the SQL Editor pop-up.**

Apply `20261023160000_archived_task_viewers.sql` to Dev through the owner's
normal process before running these tests. Do not run any block on Prod.

Each numbered test is one independent, self-contained paste. Every paste
creates its own `auth.users`, profile, committee, event, and task fixtures,
sets explicit authenticated JWT claims for impersonation, and ends with an
intentional `TEST RESULTS` exception. That exception rolls the transaction
back. Expected failures are caught inside the block. No test uses temporary
tables or deletes from `storage.objects`. Deferred-trigger paths execute
`set constraints all immediate` before their assertions. Concurrency contracts
are checked through function bodies and catalogs rather than two sessions.

Expected `TEST RESULTS` lines:

- TEST 1: 20 lines.
- TEST 2: 26 lines.
- TEST 3: 19 lines.
- TEST 4: 22 lines.
- TEST 5: 17 lines.

## TEST 1 — exact catalogs, ownership, grants, and unchanged freeze objects

```sql
begin;
select set_config('request.jwt.claims', '{}', true);

insert into public.committees (id, name) values
  ('7b010000-0000-4000-8000-000000000001', '7B Catalog');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '7b010000-0000-4000-8000-000000000011',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', '7b-catalog-admin@test.local', '', now(),
  '{}', '{}', now(), now()
);

insert into public.users (
  id, email, full_name, role, committee_id, is_active
)
values (
  '7b010000-0000-4000-8000-000000000011',
  '7b-catalog-admin@test.local', '7B Catalog Admin', 'Admin', null, true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by
)
values (
  '7b010000-0000-4000-8000-000000000101', '7B Catalog Event',
  current_date, current_date, 'Active',
  '7b010000-0000-4000-8000-000000000011'
);

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, priority, task_type,
  created_by, is_confidential, primary_assignees, assist_assignees,
  allowed_viewers, sort_order
)
values (
  '7b010000-0000-4000-8000-000000000201',
  '7b010000-0000-4000-8000-000000000101',
  '7b010000-0000-4000-8000-000000000001',
  '7B Catalog Task', 'Planning', 'To Do', 'Medium', 'Deliverable',
  '7b010000-0000-4000-8000-000000000011', true, '{}', '{}', '{}', 1024
);

do $$
declare
  v_ok boolean;
  v_results text := '';
  v_columns text[];
  v_definition text;
begin
  select array_agg(
    column_name || ':' || data_type || ':' || is_nullable
    order by ordinal_position
  )
  into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'archived_task_viewers';
  v_ok := v_columns = array[
    'task_id:uuid:NO',
    'user_id:uuid:NO',
    'granted_by:uuid:NO',
    'created_at:timestamp with time zone:NO'
  ];
  v_results := v_results || format(E'\nEXACT_FOUR_COLUMNS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_constraint
  where conrelid = 'public.archived_task_viewers'::regclass
    and contype = 'p'
    and conkey = array[
      (select attnum from pg_attribute where attrelid = 'public.archived_task_viewers'::regclass and attname = 'task_id'),
      (select attnum from pg_attribute where attrelid = 'public.archived_task_viewers'::regclass and attname = 'user_id')
    ]::smallint[];
  v_results := v_results || format(E'\nTASK_USER_PRIMARY_KEY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_constraint
  where conrelid = 'public.archived_task_viewers'::regclass
    and contype = 'f'
    and confrelid = 'public.tasks'::regclass
    and confdeltype = 'c';
  v_results := v_results || format(E'\nTASK_FK_CASCADES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_constraint
  where conrelid = 'public.archived_task_viewers'::regclass
    and contype = 'f'
    and confrelid = 'public.users'::regclass
    and confdeltype = 'c';
  v_results := v_results || format(E'\nTARGET_USER_FK_CASCADES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.archived_task_viewers'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.users'::regclass
    and a.attname = 'granted_by'
    and c.confdeltype = 'a';
  v_results := v_results || format(E'\nGRANTOR_FK_PRESERVES_HISTORY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'archived_task_viewers'
    and indexname in (
      'archived_task_viewers_pkey',
      'archived_task_viewers_user_task_idx',
      'archived_task_viewers_grantor_history_idx'
    );
  v_results := v_results || format(E'\nEXACT_PLANNED_INDEXES_PRESENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select relrowsecurity into v_ok
  from pg_class
  where oid = 'public.archived_task_viewers'::regclass;
  v_results := v_results || format(E'\nRLS_ENABLED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from pg_policy
  where polrelid = 'public.archived_task_viewers'::regclass;
  v_results := v_results || format(E'\nNO_RLS_POLICIES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := not has_table_privilege('authenticated', 'public.archived_task_viewers', 'SELECT')
    and not has_table_privilege('authenticated', 'public.archived_task_viewers', 'INSERT')
    and not has_table_privilege('authenticated', 'public.archived_task_viewers', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.archived_task_viewers', 'DELETE');
  v_results := v_results || format(E'\nAUTHENTICATED_TABLE_DENY_BY_DEFAULT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_trigger
  where tgrelid = 'public.archived_task_viewers'::regclass
    and tgname = 'archived_task_viewers_guard_writes'
    and tgenabled = 'O'
    and not tgisinternal;
  v_results := v_results || format(E'\nWRITE_GUARD_ATTACHED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.guard_archived_task_viewer_writes()'::regprocedure
    and r.rolname = 'postgres' and p.prosecdef and p.provolatile = 'v'
    and p.proconfig = array['search_path='];
  v_results := v_results || format(E'\nGUARD_OWNER_DEFINER_VOLATILE_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.task_content_access_for_user(uuid,uuid)'::regprocedure
    and r.rolname = 'postgres' and p.prosecdef and p.provolatile = 's'
    and p.proconfig = array['search_path='];
  v_results := v_results || format(E'\nUSER_HELPER_ATTRIBUTES_PRESERVED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.get_task_detail(uuid)'::regprocedure
    and r.rolname = 'postgres' and p.prosecdef and p.provolatile = 's'
    and p.proconfig = array['search_path=']
    and pg_get_function_result(p.oid) =
      'TABLE(id uuid, event_id uuid, event_name text, event_status text, title text, description text, phase text, status text, effective_priority text, task_type text, due_date timestamp with time zone, call_time timestamp with time zone, end_time timestamp with time zone, created_at timestamp with time zone, committee_id uuid, committee_name text, primary_assignees jsonb, assist_assignees jsonb, is_confidential boolean, is_masked boolean, has_dependency boolean, is_blocked boolean, dependency_label text, access_list jsonb)';
  v_results := v_results || format(E'\nDETAIL_SHAPE_AND_ATTRIBUTES_PRESERVED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 into v_ok
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid in (
    'public.grant_archived_task_viewer(uuid,uuid)'::regprocedure,
    'public.revoke_archived_task_viewer(uuid,uuid)'::regprocedure
  ) and r.rolname = 'postgres' and p.prosecdef and p.provolatile = 'v'
    and p.proconfig = array['search_path='];
  v_results := v_results || format(E'\nMUTATOR_ATTRIBUTES_EXACT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_proc p join pg_roles r on r.oid = p.proowner
  where p.oid = 'public.get_archived_task_share_controls(uuid,text)'::regprocedure
    and r.rolname = 'postgres' and p.prosecdef and p.provolatile = 's'
    and p.proconfig = array['search_path=']
    and pg_get_function_result(p.oid) =
      'TABLE(out_id uuid, out_full_name text, out_avatar_url text, out_is_archive_only boolean)';
  v_results := v_results || format(E'\nCONTROLS_SHAPE_STABLE_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := has_function_privilege('authenticated', 'public.grant_archived_task_viewer(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.revoke_archived_task_viewer(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_archived_task_share_controls(uuid,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_task_detail(uuid)', 'EXECUTE');
  v_results := v_results || format(E'\nAUTHENTICATED_PUBLIC_APIS_GRANTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := not has_function_privilege('anon', 'public.grant_archived_task_viewer(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.revoke_archived_task_viewer(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_archived_task_share_controls(uuid,text)', 'EXECUTE');
  v_results := v_results || format(E'\nANON_PUBLIC_APIS_REVOKED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := not has_function_privilege('authenticated', 'public.task_content_access_for_user(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.task_content_access(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_archived_task_viewer_writes()', 'EXECUTE');
  v_results := v_results || format(E'\nINTERNAL_FUNCTIONS_UNGRANTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_get_functiondef('public.guard_archived_event_task_writes()'::regprocedure)
  into v_definition;
  v_ok := lower(v_definition) like '%for share%'
    and lower(v_definition) like '%archived%';
  v_results := v_results || format(E'\nTASK_ARCHIVE_GUARD_STILL_PRESENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) >= 1 into v_ok
  from pg_trigger
  where tgrelid = 'public.events'::regclass
    and not tgisinternal
    and pg_get_triggerdef(oid) ilike '%guard_event_updates%';
  v_results := v_results || format(E'\nEVENT_ARCHIVE_GUARD_STILL_ATTACHED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;

rollback;
```

## TEST 5 — late viewers read but never write; archive freeze remains intact

```sql
begin;
select set_config('request.jwt.claims', '{}', true);

insert into public.committees (id,name) values
  ('7b050000-0000-4000-8000-000000000001','7B Freeze');

insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  email,'',now(),'{}','{}',now(),now()
from (values
  ('7b050000-0000-4000-8000-000000000011'::uuid,'7b5-admin@test.local'),
  ('7b050000-0000-4000-8000-000000000012'::uuid,'7b5-primary@test.local'),
  ('7b050000-0000-4000-8000-000000000013'::uuid,'7b5-late@test.local')
) fixture(id,email);

insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7b050000-0000-4000-8000-000000000011','7b5-admin@test.local','Freeze Admin','Admin',null,true),
  ('7b050000-0000-4000-8000-000000000012','7b5-primary@test.local','Freeze Primary','Member','7b050000-0000-4000-8000-000000000001',true),
  ('7b050000-0000-4000-8000-000000000013','7b5-late@test.local','Freeze Late','Member','7b050000-0000-4000-8000-000000000001',true);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7b050000-0000-4000-8000-000000000101','Freeze Archive',current_date,current_date,'Active','7b050000-0000-4000-8000-000000000011');

insert into public.tasks (
  id,event_id,committee_id,title,phase,status,priority,task_type,created_by,
  is_confidential,primary_assignees,assist_assignees,allowed_viewers,sort_order,
  request_backup,due_date
)
values (
  '7b050000-0000-4000-8000-000000000201',
  '7b050000-0000-4000-8000-000000000101',
  '7b050000-0000-4000-8000-000000000001',
  'Freeze Secret','Planning','To Do','Medium','Deliverable',
  '7b050000-0000-4000-8000-000000000011',true,
  array['7b050000-0000-4000-8000-000000000012']::uuid[],'{}','{}',1024,
  true,clock_timestamp() + interval '10 days'
);

select set_config('request.jwt.claims','{"sub":"7b050000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select * from public.add_task_work_link(
  '7b050000-0000-4000-8000-000000000201',
  'Freeze link',
  'https://drive.google.com/file/d/9ZyXwVuTsRqPoNmLkJiHgFeDcBa/view'
);
select * from public.add_task_comment(
  '7b050000-0000-4000-8000-000000000201',
  'Freeze comment',false,'{}'
);

select set_config('request.jwt.claims','{}',true);
update public.events set status = 'Archived'
where id = '7b050000-0000-4000-8000-000000000101';

select set_config('request.jwt.claims','{"sub":"7b050000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select public.grant_archived_task_viewer(
  '7b050000-0000-4000-8000-000000000201',
  '7b050000-0000-4000-8000-000000000013'
);

do $$
declare
  v_ok boolean;
  v_denied boolean;
  v_results text := '';
  v_comment_id uuid;
  v_link_id uuid;
  v_activity_before bigint;
  v_notification_before bigint;
begin
  select id into v_comment_id from public.task_comments
  where task_id = '7b050000-0000-4000-8000-000000000201';
  select id into v_link_id from public.task_work_links
  where task_id = '7b050000-0000-4000-8000-000000000201';
  select count(*) into v_activity_before from public.activity_log;
  select count(*) into v_notification_before from public.notifications;

  perform set_config('request.jwt.claims','{"sub":"7b050000-0000-4000-8000-000000000013","role":"authenticated"}',true);

  v_denied := false;
  begin perform public.add_task_comment('7b050000-0000-4000-8000-000000000201','Late write',false,'{}'); exception when sqlstate 'CCC05' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_ADD_COMMENT: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.add_task_work_link('7b050000-0000-4000-8000-000000000201','Late link','https://drive.google.com/file/d/2AbCdEfGhIjKlMnOpQrStUvWxYz/view'); exception when sqlstate 'CCL03' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_ADD_WORK_LINK: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.edit_task_comment(v_comment_id,'Late edit',false,'{}',null); exception when sqlstate 'CCC05' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_EDIT_COMMENT: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.delete_task_comment(v_comment_id); exception when sqlstate 'CCC05' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_DELETE_COMMENT: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.remove_task_work_link(v_link_id); exception when sqlstate 'CCL03' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_REMOVE_WORK_LINK: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.claim_task('7b050000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB02' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_CLAIM_ARCHIVED_TASK: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.volunteer_for_task('7b050000-0000-4000-8000-000000000201'); exception when sqlstate 'CCB02' then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_VOLUNTEER_ARCHIVED_TASK: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.set_task_backup_request('7b050000-0000-4000-8000-000000000201',false); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_CHANGE_BACKUP_REQUEST: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.unassign_self('7b050000-0000-4000-8000-000000000201'); exception when raise_exception then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_SELF_UNASSIGN_ARCHIVED_TASK: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.set_task_dependency('7b050000-0000-4000-8000-000000000201',null); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_CHANGE_DEPENDENCY: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.assign_task_people('7b050000-0000-4000-8000-000000000201','{}','{}'); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_ASSIGN_PEOPLE: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.delete_task('7b050000-0000-4000-8000-000000000201'); exception when insufficient_privilege then v_denied := true; end;
  v_results := v_results || format(E'\nLATE_VIEWER_CANNOT_DELETE_TASK_RPC: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin update public.tasks set title = 'Forged title' where id = '7b050000-0000-4000-8000-000000000201'; exception when raise_exception then v_denied := true; end;
  v_results := v_results || format(E'\nARCHIVED_TASK_UPDATE_STILL_FROZEN: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin delete from public.tasks where id = '7b050000-0000-4000-8000-000000000201'; exception when raise_exception then v_denied := true; end;
  v_results := v_results || format(E'\nARCHIVED_TASK_DELETE_STILL_FROZEN: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin update public.events set name = 'Forged event' where id = '7b050000-0000-4000-8000-000000000101'; exception when raise_exception then v_denied := true; end;
  v_results := v_results || format(E'\nARCHIVED_EVENT_UPDATE_STILL_FROZEN: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin delete from public.events where id = '7b050000-0000-4000-8000-000000000101'; exception when raise_exception then v_denied := true; end;
  v_results := v_results || format(E'\nARCHIVED_EVENT_DELETE_STILL_FROZEN: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b050000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  perform public.revoke_archived_task_viewer('7b050000-0000-4000-8000-000000000201','7b050000-0000-4000-8000-000000000013');
  perform public.grant_archived_task_viewer('7b050000-0000-4000-8000-000000000201','7b050000-0000-4000-8000-000000000013');
  select
    (select count(*) from public.activity_log) = v_activity_before
    and (select count(*) from public.notifications) = v_notification_before
  into v_ok;
  v_results := v_results || format(E'\nSHARING_WRITES_NO_ACTIVITY_OR_NOTIFICATIONS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  set constraints all immediate;
  raise exception 'TEST RESULTS %', v_results;
end
$$;

rollback;
```

## TEST 4 — unioned readers, immediate revoke, board, and My Tasks

```sql
begin;
select set_config('request.jwt.claims', '{}', true);

insert into public.committees (id,name) values
  ('7b040000-0000-4000-8000-000000000001','7B Readers');

insert into auth.users (
  id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  email,'',now(),'{}','{}',now(),now()
from (values
  ('7b040000-0000-4000-8000-000000000011'::uuid,'7b4-admin@test.local'),
  ('7b040000-0000-4000-8000-000000000012'::uuid,'7b4-owner@test.local'),
  ('7b040000-0000-4000-8000-000000000013'::uuid,'7b4-primary@test.local'),
  ('7b040000-0000-4000-8000-000000000014'::uuid,'7b4-allowed@test.local'),
  ('7b040000-0000-4000-8000-000000000015'::uuid,'7b4-late@test.local'),
  ('7b040000-0000-4000-8000-000000000016'::uuid,'7b4-other@test.local')
) fixture(id,email);

insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7b040000-0000-4000-8000-000000000011','7b4-admin@test.local','Reader Admin','Admin',null,true),
  ('7b040000-0000-4000-8000-000000000012','7b4-owner@test.local','Reader CoAdmin','Co-Admin','7b040000-0000-4000-8000-000000000001',true),
  ('7b040000-0000-4000-8000-000000000013','7b4-primary@test.local','Reader Primary','Member','7b040000-0000-4000-8000-000000000001',true),
  ('7b040000-0000-4000-8000-000000000014','7b4-allowed@test.local','Reader Allowed','Member','7b040000-0000-4000-8000-000000000001',true),
  ('7b040000-0000-4000-8000-000000000015','7b4-late@test.local','Reader Late','Member','7b040000-0000-4000-8000-000000000001',true),
  ('7b040000-0000-4000-8000-000000000016','7b4-other@test.local','Reader Other','Member','7b040000-0000-4000-8000-000000000001',true);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7b040000-0000-4000-8000-000000000101','Reader Archive',current_date,current_date,'Active','7b040000-0000-4000-8000-000000000011'),
  ('7b040000-0000-4000-8000-000000000102','Reader Active',current_date,current_date,'Active','7b040000-0000-4000-8000-000000000011'),
  ('7b040000-0000-4000-8000-000000000103','Reader Draft',current_date,null,'Draft','7b040000-0000-4000-8000-000000000011');

insert into public.tasks (
  id,event_id,committee_id,title,description,phase,status,priority,task_type,
  created_by,is_confidential,primary_assignees,assist_assignees,allowed_viewers,
  sort_order
)
values
  ('7b040000-0000-4000-8000-000000000201','7b040000-0000-4000-8000-000000000101','7b040000-0000-4000-8000-000000000001','Archived Reader Secret','Real archived description','Planning','To Do','Medium','Deliverable','7b040000-0000-4000-8000-000000000011',true,array['7b040000-0000-4000-8000-000000000013']::uuid[],'{}',array['7b040000-0000-4000-8000-000000000014']::uuid[],1024),
  ('7b040000-0000-4000-8000-000000000202','7b040000-0000-4000-8000-000000000102','7b040000-0000-4000-8000-000000000001','Active Reader Secret',null,'Planning','To Do','Medium','Deliverable','7b040000-0000-4000-8000-000000000011',true,'{}','{}',array['7b040000-0000-4000-8000-000000000014']::uuid[],1024),
  ('7b040000-0000-4000-8000-000000000203','7b040000-0000-4000-8000-000000000103','7b040000-0000-4000-8000-000000000001','Draft Reader Secret',null,'Planning','To Do','Medium','Deliverable','7b040000-0000-4000-8000-000000000011',true,'{}','{}','{}',1024);

select set_config('request.jwt.claims','{"sub":"7b040000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select * from public.add_task_work_link(
  '7b040000-0000-4000-8000-000000000201',
  'Reader link',
  'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view'
);
select * from public.add_task_comment(
  '7b040000-0000-4000-8000-000000000201',
  'Archived reader comment', false, '{}'
);

select set_config('request.jwt.claims', '{}', true);
update public.events set status = 'Archived'
where id = '7b040000-0000-4000-8000-000000000101';

select set_config('request.jwt.claims','{"sub":"7b040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select public.grant_archived_task_viewer(
  '7b040000-0000-4000-8000-000000000201',
  '7b040000-0000-4000-8000-000000000015'
);

do $$
declare
  v_ok boolean;
  v_denied boolean;
  v_results text := '';
  v_access jsonb;
begin
  perform set_config('request.jwt.claims','{"sub":"7b040000-0000-4000-8000-000000000015","role":"authenticated"}',true);

  v_ok := public.task_content_access_for_user('7b040000-0000-4000-8000-000000000201','7b040000-0000-4000-8000-000000000015') = 'real';
  v_results := v_results || format(E'\nARCHIVE_GRANT_USER_HELPER_REAL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := public.task_content_access('7b040000-0000-4000-8000-000000000201') = 'real';
  v_results := v_results || format(E'\nARCHIVE_GRANT_WRAPPER_REAL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 and bool_and(title = 'Archived Reader Secret') into v_ok
  from public.get_task('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nGET_TASK_RETURNS_REAL_CONTENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 and bool_and(not is_masked and title = 'Archived Reader Secret') into v_ok
  from public.get_task_detail('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nDETAIL_RETURNS_REAL_CONTENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select access_list into v_access
  from public.get_task_detail('7b040000-0000-4000-8000-000000000201');
  v_ok := jsonb_array_length(v_access) = 2
    and v_access @> '[{"id":"7b040000-0000-4000-8000-000000000014"}]'::jsonb
    and v_access @> '[{"id":"7b040000-0000-4000-8000-000000000015"}]'::jsonb;
  v_results := v_results || format(E'\nDETAIL_LIST_UNIONS_ORDINARY_AND_ARCHIVE_VIEWERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select coalesce(bool_and((item - array['id','full_name','avatar_url']::text[]) = '{}'::jsonb),false)
  into v_ok from jsonb_array_elements(v_access) item;
  v_results := v_results || format(E'\nCOMBINED_LIST_HAS_ONLY_SAFE_FIELDS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from public.get_task_work_links('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nLATE_VIEWER_RECEIVES_WORK_LINK_RESPONSE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not can_add into v_ok
  from public.get_task_work_links('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nARCHIVED_WORK_LINK_CAN_ADD_FALSE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select coalesce(bool_and(not (link ->> 'can_remove')::boolean),true) into v_ok
  from public.get_task_work_links('7b040000-0000-4000-8000-000000000201') response,
    lateral jsonb_array_elements(response.links) link;
  v_results := v_results || format(E'\nARCHIVED_WORK_LINK_CAN_REMOVE_FALSE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from public.list_task_comments('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nLATE_VIEWER_READS_COMMENTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select coalesce(bool_and(not out_can_edit),true) into v_ok
  from public.list_task_comments('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nARCHIVED_COMMENT_CAN_EDIT_FALSE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select coalesce(bool_and(not out_can_delete),true) into v_ok
  from public.list_task_comments('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nARCHIVED_COMMENT_CAN_DELETE_FALSE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from public.list_task_comment_mention_candidates('7b040000-0000-4000-8000-000000000201','Reader Late',20)
  where out_id = '7b040000-0000-4000-8000-000000000015';
  v_results := v_results || format(E'\nLATE_VIEWER_IS_REAL_MENTION_CANDIDATE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from public.list_event_board_tasks('7b040000-0000-4000-8000-000000000101',null);
  v_results := v_results || format(E'\nARCHIVED_EVENT_BOARD_REMAINS_EMPTY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from public.list_my_tasks(null,'deadline',50,0)
  where out_id = '7b040000-0000-4000-8000-000000000201';
  v_results := v_results || format(E'\nARCHIVE_GRANT_NOT_ADDED_TO_MY_TASKS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select count(*) = 1 and bool_and(out_is_archive_only) into v_ok
  from public.get_archived_task_share_controls('7b040000-0000-4000-8000-000000000201','Reader Late');
  v_results := v_results || format(E'\nCONTROLS_MARK_STORED_ARCHIVE_GRANT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := public.task_content_access_for_user('7b040000-0000-4000-8000-000000000203','7b040000-0000-4000-8000-000000000015') = 'hidden';
  v_results := v_results || format(E'\nDRAFT_MEMBER_BEHAVIOR_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := public.task_content_access_for_user('7b040000-0000-4000-8000-000000000202','7b040000-0000-4000-8000-000000000015') = 'masked';
  v_results := v_results || format(E'\nACTIVE_MASKED_BEHAVIOR_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := public.task_content_access_for_user('7b040000-0000-4000-8000-000000000202','7b040000-0000-4000-8000-000000000014') = 'real';
  v_results := v_results || format(E'\nACTIVE_ALLOWED_VIEWER_BEHAVIOR_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform public.revoke_archived_task_viewer('7b040000-0000-4000-8000-000000000201','7b040000-0000-4000-8000-000000000015');
  perform set_config('request.jwt.claims','{"sub":"7b040000-0000-4000-8000-000000000015","role":"authenticated"}',true);
  v_ok := public.task_content_access('7b040000-0000-4000-8000-000000000201') = 'masked';
  v_results := v_results || format(E'\nREVOKE_IMMEDIATELY_RETURNS_MASKED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 and bool_and(is_masked and title = 'Confidential Task' and access_list = '[]'::jsonb)
  into v_ok from public.get_task_detail('7b040000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nREVOKED_DETAIL_IS_EXACT_MASKED_SHELL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := (select count(*) = 0 from public.get_task_work_links('7b040000-0000-4000-8000-000000000201'));
  v_denied := false;
  begin perform count(*) from public.list_task_comments('7b040000-0000-4000-8000-000000000201'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_ok := v_ok and v_denied;
  v_results := v_results || format(E'\nREVOKE_IMMEDIATELY_REMOVES_LINK_AND_COMMENT_READS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;

rollback;
```

## TEST 3 — child integrity, parent guard, and concurrency catalogs

```sql
begin;
select set_config('request.jwt.claims', '{}', true);

insert into public.committees (id, name) values
  ('7b030000-0000-4000-8000-000000000001', '7B Guard');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated',
  'authenticated', email, '', now(), '{}', '{}', now(), now()
from (values
  ('7b030000-0000-4000-8000-000000000011'::uuid,'7b3-admin@test.local'),
  ('7b030000-0000-4000-8000-000000000012'::uuid,'7b3-target@test.local'),
  ('7b030000-0000-4000-8000-000000000013'::uuid,'7b3-other@test.local')
) fixture(id,email);

insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('7b030000-0000-4000-8000-000000000011','7b3-admin@test.local','Guard Admin','Admin',null,true),
  ('7b030000-0000-4000-8000-000000000012','7b3-target@test.local','Guard Target','Member','7b030000-0000-4000-8000-000000000001',true),
  ('7b030000-0000-4000-8000-000000000013','7b3-other@test.local','Guard Other','Member','7b030000-0000-4000-8000-000000000001',true);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('7b030000-0000-4000-8000-000000000101','Guard Archive',current_date,current_date,'Active','7b030000-0000-4000-8000-000000000011'),
  ('7b030000-0000-4000-8000-000000000102','Guard Active',current_date,current_date,'Active','7b030000-0000-4000-8000-000000000011'),
  ('7b030000-0000-4000-8000-000000000103','Guard Draft',current_date,null,'Draft','7b030000-0000-4000-8000-000000000011');

insert into public.tasks (
  id,event_id,committee_id,title,phase,status,priority,task_type,created_by,
  is_confidential,primary_assignees,assist_assignees,allowed_viewers,sort_order
)
values
  ('7b030000-0000-4000-8000-000000000201','7b030000-0000-4000-8000-000000000101','7b030000-0000-4000-8000-000000000001','Guard Archived','Planning','To Do','Medium','Deliverable','7b030000-0000-4000-8000-000000000011',true,'{}','{}','{}',1024),
  ('7b030000-0000-4000-8000-000000000202','7b030000-0000-4000-8000-000000000102','7b030000-0000-4000-8000-000000000001','Guard Active','Planning','To Do','Medium','Deliverable','7b030000-0000-4000-8000-000000000011',true,'{}','{}','{}',1024),
  ('7b030000-0000-4000-8000-000000000203','7b030000-0000-4000-8000-000000000103','7b030000-0000-4000-8000-000000000001','Guard Draft','Planning','To Do','Medium','Deliverable','7b030000-0000-4000-8000-000000000011',true,'{}','{}','{}',1024);

update public.events set status = 'Archived'
where id = '7b030000-0000-4000-8000-000000000101';

select set_config('request.jwt.claims','{"sub":"7b030000-0000-4000-8000-000000000011","role":"authenticated"}',true);

do $$
declare
  v_ok boolean;
  v_denied boolean;
  v_results text := '';
  v_affected integer;
  v_guard text;
  v_grant text;
  v_revoke text;
begin
  insert into public.archived_task_viewers (task_id,user_id,granted_by)
  values (
    '7b030000-0000-4000-8000-000000000201',
    '7b030000-0000-4000-8000-000000000012',
    '7b030000-0000-4000-8000-000000000013'
  );
  select granted_by = '7b030000-0000-4000-8000-000000000011'
  into v_ok from public.archived_task_viewers
  where task_id = '7b030000-0000-4000-8000-000000000201'
    and user_id = '7b030000-0000-4000-8000-000000000012';
  v_results := v_results || format(E'\nFORGED_GRANTOR_REPLACED_WITH_AUTH_UID: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    insert into public.archived_task_viewers (task_id,user_id,granted_by)
    values ('7b030000-0000-4000-8000-000000000201','7b030000-0000-4000-8000-000000000012','7b030000-0000-4000-8000-000000000011');
  exception when unique_violation then v_denied := true; end;
  v_results := v_results || format(E'\nDUPLICATE_PAIR_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    insert into public.archived_task_viewers (task_id,user_id,granted_by)
    values ('7b030000-0000-4000-8000-000000000202','7b030000-0000-4000-8000-000000000013','7b030000-0000-4000-8000-000000000011');
  exception when sqlstate 'CCS02' then v_denied := true; end;
  v_results := v_results || format(E'\nACTIVE_PARENT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    insert into public.archived_task_viewers (task_id,user_id,granted_by)
    values ('7b030000-0000-4000-8000-000000000203','7b030000-0000-4000-8000-000000000013','7b030000-0000-4000-8000-000000000011');
  exception when sqlstate 'CCS02' then v_denied := true; end;
  v_results := v_results || format(E'\nDRAFT_PARENT_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    insert into public.archived_task_viewers (task_id,user_id,granted_by)
    values ('7b030000-0000-4000-8000-000000000299','7b030000-0000-4000-8000-000000000013','7b030000-0000-4000-8000-000000000011');
  exception when sqlstate 'CCS02' then v_denied := true; end;
  v_results := v_results || format(E'\nMISSING_TASK_FAILS_CLOSED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin update public.archived_task_viewers set task_id = '7b030000-0000-4000-8000-000000000202' where task_id = '7b030000-0000-4000-8000-000000000201'; exception when sqlstate 'CCS07' then v_denied := true; end;
  v_results := v_results || format(E'\nTASK_ID_IMMUTABLE_CCS07: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin update public.archived_task_viewers set user_id = '7b030000-0000-4000-8000-000000000013' where task_id = '7b030000-0000-4000-8000-000000000201'; exception when sqlstate 'CCS07' then v_denied := true; end;
  v_results := v_results || format(E'\nUSER_ID_IMMUTABLE_CCS07: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin update public.archived_task_viewers set granted_by = '7b030000-0000-4000-8000-000000000013' where task_id = '7b030000-0000-4000-8000-000000000201'; exception when sqlstate 'CCS07' then v_denied := true; end;
  v_results := v_results || format(E'\nGRANTOR_IMMUTABLE_CCS07: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin update public.archived_task_viewers set created_at = created_at + interval '1 second' where task_id = '7b030000-0000-4000-8000-000000000201'; exception when sqlstate 'CCS07' then v_denied := true; end;
  v_results := v_results || format(E'\nCREATED_AT_IMMUTABLE_CCS07: %s', case when v_denied then 'PASS' else 'FAIL' end);

  delete from public.archived_task_viewers
  where task_id = '7b030000-0000-4000-8000-000000000201'
    and user_id = '7b030000-0000-4000-8000-000000000012';
  get diagnostics v_affected = row_count;
  v_ok := v_affected = 1;
  v_results := v_results || format(E'\nARCHIVED_DIRECT_DELETE_ALLOWED_FOR_OWNER_FIXTURE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_get_functiondef('public.guard_archived_task_viewer_writes()'::regprocedure)) into v_guard;
  v_ok := strpos(v_guard,'for no key update') > 0
    and strpos(v_guard,'for no key update') < strpos(v_guard,'for share');
  v_results := v_results || format(E'\nGUARD_TASK_THEN_EVENT_LOCK_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_guard like '%task_row.event_id = v_event_id%'
    and strpos(v_guard,'task_row.event_id = v_event_id') > strpos(v_guard,'for share');
  v_results := v_results || format(E'\nGUARD_POST_LOCK_RELATIONSHIP_RECHECK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_guard not like '%pg_trigger_depth%'
    and v_guard like '%if not found then%'
    and v_guard like '%missing parent always fails closed%';
  v_results := v_results || format(E'\nGUARD_HAS_NO_NESTED_CASCADE_EXCEPTION: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_get_functiondef('public.grant_archived_task_viewer(uuid,uuid)'::regprocedure)),
         lower(pg_get_functiondef('public.revoke_archived_task_viewer(uuid,uuid)'::regprocedure))
  into v_grant, v_revoke;
  v_ok := v_grant like '%v_task_event_id is distinct from v_discovered_event_id%'
    and v_grant like '%caller.is_active is true%'
    and strpos(v_grant,'caller.is_active is true') < strpos(v_grant,'insert into public.archived_task_viewers');
  v_results := v_results || format(E'\nGRANT_POST_LOCK_RELATIONSHIP_AND_AUTHORITY_RECHECK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_revoke like '%v_task_event_id is distinct from v_discovered_event_id%'
    and v_revoke like '%caller.is_active is true%'
    and strpos(v_revoke,'caller.is_active is true') < strpos(v_revoke,'delete from public.archived_task_viewers');
  v_results := v_results || format(E'\nREVOKE_POST_LOCK_RELATIONSHIP_AND_AUTHORITY_RECHECK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_grant like '%get diagnostics v_affected = row_count%'
    and v_grant like '%if v_affected <> 1 then%';
  v_results := v_results || format(E'\nGRANT_CHECKS_EXACT_INSERT_COUNT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := v_revoke like '%get diagnostics v_affected = row_count%'
    and v_revoke like '%if v_affected <> 1 then%';
  v_results := v_results || format(E'\nREVOKE_CHECKS_EXACT_DELETE_COUNT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_constraint
  where conrelid = 'public.archived_task_viewers'::regclass
    and conname = 'archived_task_viewers_pkey';
  v_results := v_results || format(E'\nPAIR_UNIQUENESS_IS_DATABASE_ENFORCED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin
    insert into public.archived_task_viewers (task_id,user_id,granted_by)
    values ('7b030000-0000-4000-8000-000000000201','7b030000-0000-4000-8000-000000000099','7b030000-0000-4000-8000-000000000011');
    set constraints all immediate;
  exception when foreign_key_violation then v_denied := true; end;
  v_results := v_results || format(E'\nUNKNOWN_TARGET_FK_REJECTED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;

rollback;
```

## TEST 2 — authorization, target validation, search, and function ordering

```sql
begin;
select set_config('request.jwt.claims', '{}', true);

insert into public.committees (id, name) values
  ('7b020000-0000-4000-8000-000000000001', '7B Owner'),
  ('7b020000-0000-4000-8000-000000000002', '7B Other');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  fixture.id,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', fixture.email, '', now(), '{}', '{}',
  now(), now()
from (
  values
    ('7b020000-0000-4000-8000-000000000011'::uuid, '7b2-admin@test.local'),
    ('7b020000-0000-4000-8000-000000000012'::uuid, '7b2-owner@test.local'),
    ('7b020000-0000-4000-8000-000000000013'::uuid, '7b2-other@test.local'),
    ('7b020000-0000-4000-8000-000000000014'::uuid, '7b2-member@test.local'),
    ('7b020000-0000-4000-8000-000000000015'::uuid, '7b2-inactive@test.local'),
    ('7b020000-0000-4000-8000-000000000016'::uuid, '7b2-allowed@test.local'),
    ('7b020000-0000-4000-8000-000000000017'::uuid, '7b2-assigned@test.local')
) fixture(id, email)
union all
select
  ('7b020000-0000-4000-8000-' || lpad(series.n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  '7b2-target-' || series.n || '@test.local', '', now(), '{}', '{}', now(), now()
from generate_series(301, 325) series(n);

insert into public.users (
  id, email, full_name, role, committee_id, is_active
)
values
  ('7b020000-0000-4000-8000-000000000011','7b2-admin@test.local','7B Admin','Admin',null,true),
  ('7b020000-0000-4000-8000-000000000012','7b2-owner@test.local','7B Owner CoAdmin','Co-Admin','7b020000-0000-4000-8000-000000000001',true),
  ('7b020000-0000-4000-8000-000000000013','7b2-other@test.local','7B Other CoAdmin','Co-Admin','7b020000-0000-4000-8000-000000000002',true),
  ('7b020000-0000-4000-8000-000000000014','7b2-member@test.local','7B Member','Member','7b020000-0000-4000-8000-000000000001',true),
  ('7b020000-0000-4000-8000-000000000015','7b2-inactive@test.local','7B Inactive','Member','7b020000-0000-4000-8000-000000000001',false),
  ('7b020000-0000-4000-8000-000000000016','7b2-allowed@test.local','7B Allowed','Member','7b020000-0000-4000-8000-000000000001',true),
  ('7b020000-0000-4000-8000-000000000017','7b2-assigned@test.local','7B Assigned','Member','7b020000-0000-4000-8000-000000000001',true);

insert into public.users (
  id, email, full_name, role, committee_id, is_active
)
select
  ('7b020000-0000-4000-8000-' || lpad(series.n::text, 12, '0'))::uuid,
  '7b2-target-' || series.n || '@test.local',
  'Search Target ' || lpad((series.n - 300)::text, 2, '0'),
  'Member', '7b020000-0000-4000-8000-000000000001', true
from generate_series(301, 325) series(n);

insert into public.events (
  id, name, start_date, end_date, status, created_by
)
values
  ('7b020000-0000-4000-8000-000000000101','7B Archived',current_date,current_date,'Active','7b020000-0000-4000-8000-000000000011'),
  ('7b020000-0000-4000-8000-000000000102','7B Active',current_date,current_date,'Active','7b020000-0000-4000-8000-000000000011'),
  ('7b020000-0000-4000-8000-000000000103','7B Public Archive',current_date,current_date,'Active','7b020000-0000-4000-8000-000000000011');

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, priority, task_type,
  created_by, is_confidential, primary_assignees, assist_assignees,
  allowed_viewers, sort_order
)
values
  ('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000101','7b020000-0000-4000-8000-000000000001','Archived Secret','Planning','To Do','Medium','Deliverable','7b020000-0000-4000-8000-000000000011',true,array['7b020000-0000-4000-8000-000000000017']::uuid[],'{}',array['7b020000-0000-4000-8000-000000000016']::uuid[],1024),
  ('7b020000-0000-4000-8000-000000000202','7b020000-0000-4000-8000-000000000102','7b020000-0000-4000-8000-000000000001','Active Secret','Planning','To Do','Medium','Deliverable','7b020000-0000-4000-8000-000000000011',true,'{}','{}','{}',1024),
  ('7b020000-0000-4000-8000-000000000203','7b020000-0000-4000-8000-000000000103','7b020000-0000-4000-8000-000000000001','Archived Public','Planning','To Do','Medium','Deliverable','7b020000-0000-4000-8000-000000000011',false,'{}','{}','{}',1024);

update public.events
set status = 'Archived'
where id in (
  '7b020000-0000-4000-8000-000000000101',
  '7b020000-0000-4000-8000-000000000103'
);

do $$
declare
  v_ok boolean;
  v_denied boolean;
  v_results text := '';
  v_count integer;
  v_grant_definition text;
  v_revoke_definition text;
  v_reader_definition text;
begin
  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  perform public.grant_archived_task_viewer(
    '7b020000-0000-4000-8000-000000000201',
    '7b020000-0000-4000-8000-000000000301'
  );
  select count(*) = 1 and bool_and(granted_by = '7b020000-0000-4000-8000-000000000011')
  into v_ok
  from public.archived_task_viewers
  where task_id = '7b020000-0000-4000-8000-000000000201'
    and user_id = '7b020000-0000-4000-8000-000000000301';
  v_results := v_results || format(E'\nADMIN_GRANT_DERIVES_GRANTOR: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000302');
  select count(*) = 1 into v_ok from public.archived_task_viewers
  where task_id = '7b020000-0000-4000-8000-000000000201' and user_id = '7b020000-0000-4000-8000-000000000302';
  v_results := v_results || format(E'\nOWNING_COADMIN_GRANTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  update public.users set is_active = false
  where id = '7b020000-0000-4000-8000-000000000302';
  perform public.revoke_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000302');
  select count(*) = 0 into v_ok from public.archived_task_viewers
  where task_id = '7b020000-0000-4000-8000-000000000201' and user_id = '7b020000-0000-4000-8000-000000000302';
  v_results := v_results || format(E'\nOWNING_COADMIN_REVOKES_EXACT_INACTIVE_TARGET_ROW: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.revoke_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000302'); exception when sqlstate 'CCS05' then v_denied := true; end;
  v_results := v_results || format(E'\nMISSING_REVOKE_CCS05: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000301'); exception when sqlstate 'CCS04' then v_denied := true; end;
  v_results := v_results || format(E'\nDUPLICATE_GRANT_CCS04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000016'); exception when sqlstate 'CCS04' then v_denied := true; end;
  v_results := v_results || format(E'\nALLOWED_VIEWER_ALREADY_REAL_CCS04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000017'); exception when sqlstate 'CCS04' then v_denied := true; end;
  v_results := v_results || format(E'\nASSIGNEE_ALREADY_REAL_CCS04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000011'); exception when sqlstate 'CCS04' then v_denied := true; end;
  v_results := v_results || format(E'\nADMIN_TARGET_ALREADY_REAL_CCS04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000015'); exception when sqlstate 'CCS03' then v_denied := true; end;
  v_results := v_results || format(E'\nINACTIVE_TARGET_CCS03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000399'); exception when sqlstate 'CCS03' then v_denied := true; end;
  v_results := v_results || format(E'\nMISSING_TARGET_CCS03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_ok := true;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201',null); v_ok := false; exception when sqlstate 'CCS03' then null; end;
  begin execute 'select public.grant_archived_task_viewer(''7b020000-0000-4000-8000-000000000201'', ''not-a-uuid'')'; v_ok := false; exception when invalid_text_representation then null; end;
  v_results := v_results || format(E'\nNULL_AND_MALFORMED_TARGETS_REJECTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000014","role":"authenticated"}',true);
  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nMEMBER_GRANT_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.revoke_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000301'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nMEMBER_REVOKE_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nOTHER_COADMIN_GRANT_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.revoke_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000301'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nOTHER_COADMIN_REVOKE_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000015","role":"authenticated"}',true);
  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nINACTIVE_CALLER_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000099","role":"authenticated"}',true);
  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000201','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nPROFILELESS_CALLER_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000299','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS01' then v_denied := true; end;
  v_results := v_results || format(E'\nUNKNOWN_TASK_CCS01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000202','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS02' then v_denied := true; end;
  v_results := v_results || format(E'\nACTIVE_TASK_CCS02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform public.grant_archived_task_viewer('7b020000-0000-4000-8000-000000000203','7b020000-0000-4000-8000-000000000303'); exception when sqlstate 'CCS02' then v_denied := true; end;
  v_results := v_results || format(E'\nNONCONFIDENTIAL_ARCHIVE_CCS02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_ok := true;
  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000014","role":"authenticated"}',true);
  begin perform count(*) from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000201',repeat('x',101)); v_ok := false; exception when sqlstate 'CCS01' then null; end;
  perform set_config('request.jwt.claims','{"sub":"7b020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  begin perform count(*) from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000201',repeat('x',101)); v_ok := false; exception when sqlstate 'CCS06' then null; end;
  begin perform count(*) from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000299','valid'); v_ok := false; exception when sqlstate 'CCS01' then null; end;
  begin perform count(*) from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000202','valid'); v_ok := false; exception when sqlstate 'CCS02' then null; end;
  v_results := v_results || format(E'\nSHARE_CONTROLS_ERROR_ORDER_AUTH_SEARCH_LIFECYCLE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000201','target 01');
  v_results := v_results || format(E'\nCONTROLS_CASE_INSENSITIVE_SUBSTRING_SEARCH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) into v_count
  from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000201','Search Target');
  v_ok := v_count = 20;
  v_results := v_results || format(E'\nCONTROLS_RESULTS_CAPPED_AT_20: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select
    (select out_is_archive_only from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000201','Target 01'))
    and not (select out_is_archive_only from public.get_archived_task_share_controls('7b020000-0000-4000-8000-000000000201','Target 03'))
  into v_ok;
  v_results := v_results || format(E'\nCONTROLS_DISTINGUISH_GRANT_AND_REVOKE_TARGETS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_get_functiondef('public.grant_archived_task_viewer(uuid,uuid)'::regprocedure)),
         lower(pg_get_functiondef('public.revoke_archived_task_viewer(uuid,uuid)'::regprocedure))
  into v_grant_definition, v_revoke_definition;
  v_ok := strpos(v_grant_definition, 'errcode = ''ccs01''') > 0
    and strpos(v_grant_definition, 'errcode = ''ccs01''') < strpos(v_grant_definition, 'for no key update')
    and strpos(v_grant_definition, 'for no key update') < strpos(v_grant_definition, 'for share')
    and strpos(v_revoke_definition, 'errcode = ''ccs01''') > 0
    and strpos(v_revoke_definition, 'errcode = ''ccs01''') < strpos(v_revoke_definition, 'for no key update')
    and strpos(v_revoke_definition, 'for no key update') < strpos(v_revoke_definition, 'for share');
  v_results := v_results || format(E'\nGRANT_REVOKE_AUTHORIZATION_PRECEDES_TASK_AND_EVENT_LOCKS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_get_functiondef('public.get_archived_task_share_controls(uuid,text)'::regprocedure))
  into v_reader_definition;
  select p.provolatile = 's'
    and v_reader_definition not like '%for no key update%'
    and v_reader_definition not like '%for share%'
    and v_reader_definition not like '%for update%'
    and v_reader_definition not like '%pg_advisory%'
    and v_reader_definition not like '%insert into%'
    and v_reader_definition not like '%update public.%'
    and v_reader_definition not like '%delete from%'
  into v_ok
  from pg_proc p
  where p.oid = 'public.get_archived_task_share_controls(uuid,text)'::regprocedure;
  v_results := v_results || format(E'\nSHARE_CONTROLS_STABLE_LOCK_FREE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;

rollback;
```
