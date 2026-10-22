# Phase 4 Step 9-DB — task comment tests

**Run on DEV only. Choose Run without RLS in the SQL Editor pop-up.**

Apply these migrations to Dev through the owner's normal process, in order,
before running the tests:

1. `20261023120000_task_content_access_for_user.sql`
2. `20261023130000_task_comments.sql`

Do not run these blocks on Prod. Each numbered test is one independent,
self-contained paste with its own Auth/profile/event/task fixtures. Each block
ends with an intentional `TEST RESULTS` exception, so its transaction rolls
back. Expected failures are caught inside the block. No block depends on data
from another block.

Expected `TEST RESULTS` lines:

- TEST 1: 23 lines.
- TEST 2: 15 lines.
- TEST 3: 19 lines.
- TEST 4: 19 lines.
- TEST 5: 20 lines.

Coverage map:

- Exact helper parity, ownership, grants, volatility, empty paths, schema,
  indexes, RLS, function shapes, and authenticated-only entry points: TEST 1.
- Admin, both Co-Admin scopes, assigned/unassigned Members, allowed viewer,
  inactive and profile-less callers, Draft/Active/Archived behavior, and
  hidden/unknown `CCC01` parity: TEST 2.
- Empty-thread meaning, safe author/mention shapes, all-role mention access to
  active real-access users, rejection of masked/inactive/unknown targets,
  search, the 20-row limit, both-or-neither keyset cursors, stable pagination,
  and immediate read revocation: TEST 3.
- Server-derived authors, whitespace-class trimming, body/mention caps,
  insert/edit mention validation, unordered-set no-op detection, stale edits,
  author-only editing, and `edited_at`: TEST 4.
- Author/Admin deletion, no Co-Admin blanket delete, Archived readability and
  immutability, task/event cascade compatibility, lock order, retryable races,
  exact comment writers, no notification writes, and Step 7B compatibility:
  TEST 5.

## TEST 1 — catalogs, helper parity contract, schema, grants, and writers

```sql
begin;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_proc pg_catalog.pg_proc%rowtype;
  v_body text;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.task_content_access(uuid)'::regprocedure;

  v_ok := v_proc.prosecdef
    and v_proc.provolatile = 's'
    and pg_catalog.pg_get_userbyid(v_proc.proowner) = 'postgres'
    and coalesce(v_proc.proconfig, '{}'::text[]) @> array['search_path=""'];
  v_results := v_results || format(E'\nWRAPPER_STABLE_DEFINER_POSTGRES_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(v_proc.oid)) into v_body;
  v_ok := v_body like '%task_content_access_for_user(p_task_id, auth.uid())%';
  v_results := v_results || format(E'\nWRAPPER_DELEGATES_AUTH_UID: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.task_content_access_for_user(uuid,uuid)'::regprocedure;
  v_ok := v_proc.prosecdef
    and v_proc.provolatile = 's'
    and pg_catalog.pg_get_userbyid(v_proc.proowner) = 'postgres'
    and coalesce(v_proc.proconfig, '{}'::text[]) @> array['search_path=""'];
  v_results := v_results || format(E'\nUSER_HELPER_STABLE_DEFINER_POSTGRES_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.aclexplode(
        coalesce(proacl, pg_catalog.acldefault('f', proowner))
      ) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok
  from pg_catalog.pg_proc
  where oid = 'public.task_content_access(uuid)'::regprocedure;
  v_results := v_results || format(E'\nWRAPPER_REMAINS_UNGRANTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
    and not exists (
      select 1 from pg_catalog.aclexplode(
        coalesce(proacl, pg_catalog.acldefault('f', proowner))
      ) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok
  from pg_catalog.pg_proc
  where oid = 'public.task_content_access_for_user(uuid,uuid)'::regprocedure;
  v_results := v_results || format(E'\nUSER_HELPER_UNGRANTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'task_comment_profile_visible_to_user'
  ) into v_ok;
  v_results := v_results || format(E'\nREMOVED_PROFILE_VISIBILITY_HELPER_ABSENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 8 into v_ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'task_comments';
  v_results := v_results || format(E'\nEXACT_EIGHT_COMMENT_COLUMNS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'task_comments'
    and column_name = 'mentioned_user_ids'
    and data_type = 'ARRAY' and is_nullable = 'NO';
  v_results := v_results || format(E'\nMENTIONS_UUID_ARRAY_NOT_NULL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select c.relrowsecurity and not c.relforcerowsecurity into v_ok
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'task_comments';
  v_results := v_results || format(E'\nRLS_ENABLED_NOT_FORCED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 0 into v_ok
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'task_comments';
  v_results := v_results || format(E'\nNO_DIRECT_RLS_POLICIES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not pg_catalog.has_table_privilege('authenticated', 'public.task_comments', 'SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('anon', 'public.task_comments', 'SELECT,INSERT,UPDATE,DELETE')
  into v_ok;
  v_results := v_results || format(E'\nNO_CLIENT_TABLE_PRIVILEGES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 into v_ok
  from pg_catalog.pg_indexes
  where schemaname = 'public' and tablename = 'task_comments'
    and indexname in ('task_comments_task_thread_idx','task_comments_mentions_idx');
  v_results := v_results || format(E'\nTHREAD_AND_MENTION_INDEXES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4 into v_ok
  from pg_catalog.pg_constraint
  where conrelid = 'public.task_comments'::regclass
    and conname in (
      'task_comments_body_length','task_comments_mention_count',
      'task_comments_mention_nulls','task_comments_edited_after_creation'
    );
  v_results := v_results || format(E'\nALL_FOUR_CHECKS_PRESENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_catalog.pg_trigger
  where tgrelid = 'public.task_comments'::regclass
    and tgname = 'task_comments_guard_writes' and not tgisinternal;
  v_results := v_results || format(E'\nONE_WRITE_GUARD_TRIGGER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 into v_ok
  from unnest(array[
    'public.list_task_comments(uuid,integer,timestamp with time zone,uuid)'::regprocedure,
    'public.list_task_comment_mention_candidates(uuid,text,integer)'::regprocedure
  ]) p(oid)
  where pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  v_results := v_results || format(E'\nTWO_AUTHENTICATED_ONLY_READERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from unnest(array[
    'public.add_task_comment(uuid,text,boolean,uuid[])'::regprocedure,
    'public.edit_task_comment(uuid,text,boolean,uuid[],timestamp with time zone)'::regprocedure,
    'public.delete_task_comment(uuid)'::regprocedure
  ]) p(oid)
  where pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE');
  v_results := v_results || format(E'\nTHREE_AUTHENTICATED_ONLY_WRITERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 5 into v_ok
  from unnest(array[
    'public.list_task_comments(uuid,integer,timestamp with time zone,uuid)'::regprocedure,
    'public.list_task_comment_mention_candidates(uuid,text,integer)'::regprocedure,
    'public.add_task_comment(uuid,text,boolean,uuid[])'::regprocedure,
    'public.edit_task_comment(uuid,text,boolean,uuid[],timestamp with time zone)'::regprocedure,
    'public.delete_task_comment(uuid)'::regprocedure
  ]) p(oid)
  join pg_catalog.pg_proc proc on proc.oid = p.oid
  where proc.prosecdef
    and pg_catalog.pg_get_userbyid(proc.proowner) = 'postgres'
    and coalesce(proc.proconfig, '{}'::text[]) @> array['search_path=""'];
  v_results := v_results || format(E'\nALL_PUBLIC_FUNCTIONS_DEFINER_POSTGRES_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 into v_ok
  from unnest(array[
    'public.list_task_comments(uuid,integer,timestamp with time zone,uuid)'::regprocedure,
    'public.list_task_comment_mention_candidates(uuid,text,integer)'::regprocedure
  ]) p(oid)
  join pg_catalog.pg_proc proc on proc.oid = p.oid
  where proc.provolatile = 's';
  v_results := v_results || format(E'\nREADERS_STABLE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from unnest(array[
    'public.add_task_comment(uuid,text,boolean,uuid[])'::regprocedure,
    'public.edit_task_comment(uuid,text,boolean,uuid[],timestamp with time zone)'::regprocedure,
    'public.delete_task_comment(uuid)'::regprocedure
  ]) p(oid)
  join pg_catalog.pg_proc proc on proc.oid = p.oid
  where proc.provolatile = 'v';
  v_results := v_results || format(E'\nWRITERS_VOLATILE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_catalog.pg_get_function_result(
    'public.list_task_comment_mention_candidates(uuid,text,integer)'::regprocedure
  ) = 'TABLE(out_id uuid, out_full_name text, out_avatar_url text)'
  into v_ok;
  v_results := v_results || format(E'\nMENTION_READER_EXACT_SAFE_SHAPE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select pg_catalog.pg_get_function_result(
    'public.list_task_comments(uuid,integer,timestamp with time zone,uuid)'::regprocedure
  ) like 'TABLE(out_id uuid, out_body text, out_is_heads_up boolean, out_created_at timestamp with time zone, out_edited_at timestamp with time zone, out_author_id uuid, out_author_full_name text, out_author_avatar_url text, out_mentions jsonb, out_can_edit boolean, out_can_delete boolean, out_has_more boolean)'
  into v_ok;
  v_results := v_results || format(E'\nCOMMENT_READER_EXACT_FIXED_SHAPE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef(
    'public.guard_task_comment_writes()'::regprocedure
  )) into v_body;
  v_ok := strpos(v_body, 'for no key update') > 0
    and strpos(v_body, 'for share') > strpos(v_body, 'for no key update');
  v_results := v_results || format(E'\nGUARD_TASK_THEN_EVENT_LOCK_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 into v_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and lower(pg_catalog.pg_get_functiondef(p.oid)) ~ '(insert into|update|delete from) public\.task_comments';
  v_results := v_results || format(E'\nEXACT_THREE_DIRECT_COMMENT_WRITERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — access parity, role matrix, lifecycle, and non-leaking readers

```sql
begin;

insert into public.committees (id, name) values
  ('c9020000-0000-4000-8000-000000000001','S9 One'),
  ('c9020000-0000-4000-8000-000000000002','S9 Two');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
  ('c9020000-0000-4000-8000-000000000011'::uuid,'s9-admin@test.local'),
  ('c9020000-0000-4000-8000-000000000012'::uuid,'s9-own-co@test.local'),
  ('c9020000-0000-4000-8000-000000000013'::uuid,'s9-other-co@test.local'),
  ('c9020000-0000-4000-8000-000000000014'::uuid,'s9-assigned@test.local'),
  ('c9020000-0000-4000-8000-000000000015'::uuid,'s9-member@test.local'),
  ('c9020000-0000-4000-8000-000000000016'::uuid,'s9-viewer@test.local'),
  ('c9020000-0000-4000-8000-000000000017'::uuid,'s9-inactive@test.local'),
  ('c9020000-0000-4000-8000-000000000018'::uuid,'s9-profileless@test.local')
) fixture(id,email);

insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('c9020000-0000-4000-8000-000000000011','s9-admin@test.local','S9 Admin','Admin',null,true),
  ('c9020000-0000-4000-8000-000000000012','s9-own-co@test.local','S9 Own Co','Co-Admin','c9020000-0000-4000-8000-000000000001',true),
  ('c9020000-0000-4000-8000-000000000013','s9-other-co@test.local','S9 Other Co','Co-Admin','c9020000-0000-4000-8000-000000000002',true),
  ('c9020000-0000-4000-8000-000000000014','s9-assigned@test.local','S9 Assigned','Member','c9020000-0000-4000-8000-000000000002',true),
  ('c9020000-0000-4000-8000-000000000015','s9-member@test.local','S9 Member','Member','c9020000-0000-4000-8000-000000000001',true),
  ('c9020000-0000-4000-8000-000000000016','s9-viewer@test.local','S9 Viewer','Member','c9020000-0000-4000-8000-000000000001',true),
  ('c9020000-0000-4000-8000-000000000017','s9-inactive@test.local','S9 Inactive','Member','c9020000-0000-4000-8000-000000000001',false);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('c9020000-0000-4000-8000-000000000101','S9 Active','2026-10-01','2026-10-02','Active','c9020000-0000-4000-8000-000000000011'),
  ('c9020000-0000-4000-8000-000000000102','S9 Draft','2026-10-01',null,'Draft','c9020000-0000-4000-8000-000000000011'),
  ('c9020000-0000-4000-8000-000000000103','S9 Archive','2026-10-01','2026-10-02','Active','c9020000-0000-4000-8000-000000000011');

insert into public.tasks (
  id,event_id,committee_id,title,is_confidential,primary_assignees,allowed_viewers
) values
  ('c9020000-0000-4000-8000-000000000201','c9020000-0000-4000-8000-000000000101','c9020000-0000-4000-8000-000000000001','Public',false,'{}','{}'),
  ('c9020000-0000-4000-8000-000000000202','c9020000-0000-4000-8000-000000000101','c9020000-0000-4000-8000-000000000001','Secret',true,array['c9020000-0000-4000-8000-000000000014']::uuid[],array['c9020000-0000-4000-8000-000000000016']::uuid[]),
  ('c9020000-0000-4000-8000-000000000203','c9020000-0000-4000-8000-000000000102','c9020000-0000-4000-8000-000000000001','Draft',false,'{}','{}'),
  ('c9020000-0000-4000-8000-000000000204','c9020000-0000-4000-8000-000000000103','c9020000-0000-4000-8000-000000000001','Archive',false,'{}','{}');

select set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select * from public.add_task_comment('c9020000-0000-4000-8000-000000000201','Public comment');
select * from public.add_task_comment('c9020000-0000-4000-8000-000000000202','Secret comment');
select * from public.add_task_comment('c9020000-0000-4000-8000-000000000203','Draft comment');
select * from public.add_task_comment('c9020000-0000-4000-8000-000000000204','Archive comment');
update public.events set status = 'Archived'
where id = 'c9020000-0000-4000-8000-000000000103';
set constraints all immediate;

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_user uuid;
  v_task uuid;
  v_expected text;
begin
  v_ok := true;
  for v_user, v_task, v_expected in
    select * from (values
      ('c9020000-0000-4000-8000-000000000011'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'real'),
      ('c9020000-0000-4000-8000-000000000012'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'real'),
      ('c9020000-0000-4000-8000-000000000013'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'masked'),
      ('c9020000-0000-4000-8000-000000000014'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'real'),
      ('c9020000-0000-4000-8000-000000000015'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'masked'),
      ('c9020000-0000-4000-8000-000000000016'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'real'),
      ('c9020000-0000-4000-8000-000000000017'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'hidden'),
      ('c9020000-0000-4000-8000-000000000018'::uuid,'c9020000-0000-4000-8000-000000000202'::uuid,'hidden')
    ) cases(user_id,task_id,expected)
  loop
    perform set_config('request.jwt.claims',json_build_object('sub',v_user,'role','authenticated')::text,true);
    v_ok := v_ok
      and public.task_content_access(v_task) = v_expected
      and public.task_content_access_for_user(v_task,v_user) = v_expected;
  end loop;
  v_results := v_results || format(E'\nWRAPPER_AND_USER_HELPER_ROLE_PARITY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{}',true);
  v_ok := public.task_content_access('c9020000-0000-4000-8000-000000000202') = 'hidden';
  v_results := v_results || format(E'\nNULL_CALLER_HIDDEN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000017","role":"authenticated"}',true);
  v_ok := public.task_content_access('c9020000-0000-4000-8000-000000000201') = 'hidden';
  v_results := v_results || format(E'\nINACTIVE_CALLER_HIDDEN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000018","role":"authenticated"}',true);
  v_ok := public.task_content_access('c9020000-0000-4000-8000-000000000201') = 'hidden';
  v_results := v_results || format(E'\nPROFILELESS_CALLER_HIDDEN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select count(*) = 1 into v_ok from public.list_task_comments('c9020000-0000-4000-8000-000000000203');
  v_results := v_results || format(E'\nADMIN_READS_DRAFT_COMMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  select count(*) = 1 into v_ok from public.list_task_comments('c9020000-0000-4000-8000-000000000203');
  v_results := v_results || format(E'\nOWNING_COADMIN_READS_DRAFT_COMMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9020000-0000-4000-8000-000000000203'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nOTHER_COADMIN_DRAFT_CCC01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000014","role":"authenticated"}',true);
  select count(*) = 1 into v_ok from public.list_task_comments('c9020000-0000-4000-8000-000000000202');
  v_results := v_results || format(E'\nASSIGNED_MEMBER_READS_SECRET: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000016","role":"authenticated"}',true);
  select count(*) = 1 into v_ok from public.list_task_comments('c9020000-0000-4000-8000-000000000202');
  v_results := v_results || format(E'\nALLOWED_VIEWER_READS_SECRET: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000015","role":"authenticated"}',true);
  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9020000-0000-4000-8000-000000000202'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nMASKED_MEMBER_CCC01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9020000-0000-4000-8000-000000000299'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nUNKNOWN_TASK_SAME_CCC01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000017","role":"authenticated"}',true);
  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9020000-0000-4000-8000-000000000201'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nINACTIVE_READER_CCC01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000018","role":"authenticated"}',true);
  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9020000-0000-4000-8000-000000000201'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nPROFILELESS_READER_CCC01: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9020000-0000-4000-8000-000000000015","role":"authenticated"}',true);
  select count(*) = 1 into v_ok from public.list_task_comments('c9020000-0000-4000-8000-000000000204');
  v_results := v_results || format(E'\nARCHIVED_PUBLIC_COMMENT_READABLE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok from public.list_task_comments('c9020000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nACTIVE_PUBLIC_REAL_VIEWER_READS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — empty thread, safe shapes, candidates, cursors, and revocation

```sql
begin;

insert into public.committees (id,name) values
  ('c9030000-0000-4000-8000-000000000001','S9 Three'),
  ('c9030000-0000-4000-8000-000000000002','S9 Four');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
 ('c9030000-0000-4000-8000-000000000011'::uuid,'s9-admin3@test.local'),
 ('c9030000-0000-4000-8000-000000000012'::uuid,'s9-co3@test.local'),
 ('c9030000-0000-4000-8000-000000000013'::uuid,'s9-member3@test.local'),
 ('c9030000-0000-4000-8000-000000000014'::uuid,'s9-other3@test.local'),
 ('c9030000-0000-4000-8000-000000000015'::uuid,'s9-masked3@test.local'),
 ('c9030000-0000-4000-8000-000000000016'::uuid,'s9-inactive3@test.local')
) f(id,email);
insert into public.users (id,email,full_name,role,committee_id,is_active) values
 ('c9030000-0000-4000-8000-000000000011','s9-admin3@test.local','Alpha Admin','Admin',null,true),
 ('c9030000-0000-4000-8000-000000000012','s9-co3@test.local','Beta Co','Co-Admin','c9030000-0000-4000-8000-000000000001',true),
 ('c9030000-0000-4000-8000-000000000013','s9-member3@test.local','Gamma Member','Member','c9030000-0000-4000-8000-000000000001',true),
 ('c9030000-0000-4000-8000-000000000014','s9-other3@test.local','Delta Other','Member','c9030000-0000-4000-8000-000000000002',true),
 ('c9030000-0000-4000-8000-000000000015','s9-masked3@test.local','Epsilon Masked','Member','c9030000-0000-4000-8000-000000000002',true),
 ('c9030000-0000-4000-8000-000000000016','s9-inactive3@test.local','Zeta Inactive','Member','c9030000-0000-4000-8000-000000000002',false);
insert into public.events (id,name,start_date,end_date,status,created_by)
values ('c9030000-0000-4000-8000-000000000101','S9 Read','2026-10-01','2026-10-02','Active','c9030000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,is_confidential,allowed_viewers)
values
 ('c9030000-0000-4000-8000-000000000201','c9030000-0000-4000-8000-000000000101','c9030000-0000-4000-8000-000000000001','Empty',false,'{}'),
 ('c9030000-0000-4000-8000-000000000202','c9030000-0000-4000-8000-000000000101','c9030000-0000-4000-8000-000000000001','Secret',true,array['c9030000-0000-4000-8000-000000000013','c9030000-0000-4000-8000-000000000014']::uuid[]);

select set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select * from public.add_task_comment('c9030000-0000-4000-8000-000000000202','First',false,array['c9030000-0000-4000-8000-000000000012','c9030000-0000-4000-8000-000000000013']::uuid[]);
select set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select * from public.add_task_comment('c9030000-0000-4000-8000-000000000202','Second',false,array['c9030000-0000-4000-8000-000000000011','c9030000-0000-4000-8000-000000000014']::uuid[]);
select set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select * from public.add_task_comment('c9030000-0000-4000-8000-000000000202','Third',false,array['c9030000-0000-4000-8000-000000000011','c9030000-0000-4000-8000-000000000014']::uuid[]);

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_cursor_time timestamptz;
  v_cursor_id uuid;
  v_first_page uuid[];
  v_second_page uuid[];
begin
  perform set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000011","role":"authenticated"}',true);

  select count(*) = 0 into v_ok from public.list_task_comments('c9030000-0000-4000-8000-000000000201');
  v_results := v_results || format(E'\nZERO_ROWS_MEANS_EMPTY_THREAD: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 3 and count(distinct out_author_id) = 3
    and bool_and(out_author_full_name in ('Alpha Admin','Beta Co','Gamma Member'))
  into v_ok from public.list_task_comments('c9030000-0000-4000-8000-000000000202');
  v_results := v_results || format(E'\nSAFE_AUTHOR_FIELDS_RETURNED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select jsonb_array_length(out_mentions) = 2
    and out_mentions @> '[{"full_name":"Beta Co"},{"full_name":"Gamma Member"}]'::jsonb
  into v_ok from public.list_task_comments('c9030000-0000-4000-8000-000000000202') where out_body = 'First';
  v_results := v_results || format(E'\nADMIN_SEES_SAFE_MENTION_FIELDS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select array_agg(out_id order by out_created_at desc,out_id desc), bool_and(out_has_more)
  into v_first_page, v_ok
  from public.list_task_comments('c9030000-0000-4000-8000-000000000202',2,null,null);
  v_results := v_results || format(E'\nFIRST_PAGE_TWO_AND_HAS_MORE: %s', case when cardinality(v_first_page)=2 and v_ok then 'PASS' else 'FAIL' end);

  select out_created_at,out_id into v_cursor_time,v_cursor_id
  from public.list_task_comments('c9030000-0000-4000-8000-000000000202',2,null,null)
  order by out_created_at,out_id limit 1;
  select array_agg(out_id), bool_and(not out_has_more) into v_second_page,v_ok
  from public.list_task_comments('c9030000-0000-4000-8000-000000000202',2,v_cursor_time,v_cursor_id);
  v_results := v_results || format(E'\nSECOND_PAGE_ONE_AND_DONE: %s', case when cardinality(v_second_page)=1 and v_ok then 'PASS' else 'FAIL' end);

  v_ok := not (v_first_page && v_second_page);
  v_results := v_results || format(E'\nPAGES_DO_NOT_OVERLAP: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9030000-0000-4000-8000-000000000202',25,now(),null); exception when sqlstate 'CCC02' then v_denied := true; end;
  v_results := v_results || format(E'\nCREATED_CURSOR_WITHOUT_ID_CCC02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9030000-0000-4000-8000-000000000202',25,null,gen_random_uuid()); exception when sqlstate 'CCC02' then v_denied := true; end;
  v_results := v_results || format(E'\nID_CURSOR_WITHOUT_CREATED_CCC02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9030000-0000-4000-8000-000000000202',51,null,null); exception when sqlstate 'CCC02' then v_denied := true; end;
  v_results := v_results || format(E'\nCOMMENT_LIMIT_OVER_50_CCC02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select count(*) = 4 into v_ok from public.list_task_comment_mention_candidates('c9030000-0000-4000-8000-000000000202',null,20);
  v_results := v_results || format(E'\nADMIN_CANDIDATES_ALL_ACTIVE_REAL_USERS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 and min(out_full_name) = 'Gamma Member' into v_ok
  from public.list_task_comment_mention_candidates('c9030000-0000-4000-8000-000000000202','gamma',20);
  v_results := v_results || format(E'\nCASE_INSENSITIVE_SUBSTRING_SEARCH: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  select count(*) = 4
    and count(*) filter (where out_id in ('c9030000-0000-4000-8000-000000000011','c9030000-0000-4000-8000-000000000014')) = 2
  into v_ok
  from public.list_task_comment_mention_candidates('c9030000-0000-4000-8000-000000000202',null,20);
  v_results := v_results || format(E'\nCOADMIN_CANDIDATES_INCLUDE_ADMIN_AND_CROSS_COMMITTEE_REAL_USER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  select count(*) = 4
    and count(*) filter (where out_id in ('c9030000-0000-4000-8000-000000000011','c9030000-0000-4000-8000-000000000014')) = 2
  into v_ok
  from public.list_task_comment_mention_candidates('c9030000-0000-4000-8000-000000000202',null,20);
  v_results := v_results || format(E'\nMEMBER_CANDIDATES_INCLUDE_ADMIN_AND_CROSS_COMMITTEE_REAL_USER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 and bool_and(
    created_by in ('c9030000-0000-4000-8000-000000000012','c9030000-0000-4000-8000-000000000013')
    and mentioned_user_ids = array['c9030000-0000-4000-8000-000000000011','c9030000-0000-4000-8000-000000000014']::uuid[]
  ) into v_ok
  from public.task_comments where body in ('Second','Third');
  v_results := v_results || format(E'\nCOADMIN_AND_MEMBER_MENTION_ADMIN_AND_CROSS_COMMITTEE_REAL_USER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select jsonb_array_length(out_mentions) = 2
    and out_mentions @> '[{"full_name":"Alpha Admin"},{"full_name":"Delta Other"}]'::jsonb
  into v_ok from public.list_task_comments('c9030000-0000-4000-8000-000000000202') where out_body='Second';
  v_results := v_results || format(E'\nMENTION_OUTPUT_RETURNS_ALL_SAFE_REAL_TARGETS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := true;
  begin
    perform public.add_task_comment('c9030000-0000-4000-8000-000000000202','Masked mention',false,array['c9030000-0000-4000-8000-000000000015']::uuid[]);
    v_ok := false;
  exception when sqlstate 'CCC04' then null; end;
  begin
    perform public.add_task_comment('c9030000-0000-4000-8000-000000000202','Inactive mention',false,array['c9030000-0000-4000-8000-000000000016']::uuid[]);
    v_ok := false;
  exception when sqlstate 'CCC04' then null; end;
  begin
    perform public.add_task_comment('c9030000-0000-4000-8000-000000000202','Unknown mention',false,array['c9030000-0000-4000-8000-000000000017']::uuid[]);
    v_ok := false;
  exception when sqlstate 'CCC04' then null; end;
  v_results := v_results || format(E'\nMASKED_INACTIVE_UNKNOWN_MENTIONS_CCC04: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_task_comment_mention_candidates('c9030000-0000-4000-8000-000000000202',null,21); exception when sqlstate 'CCC02' then v_denied := true; end;
  v_results := v_results || format(E'\nMENTION_LIMIT_OVER_20_CCC02: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  perform public.set_task_confidentiality(
    'c9030000-0000-4000-8000-000000000202',
    true,
    '{}'::uuid[]
  );
  perform set_config('request.jwt.claims','{"sub":"c9030000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  v_denied := false;
  begin perform count(*) from public.list_task_comments('c9030000-0000-4000-8000-000000000202'); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nIMMEDIATE_COMMENT_READ_REVOCATION: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied := false;
  begin perform count(*) from public.list_task_comment_mention_candidates('c9030000-0000-4000-8000-000000000202',null,20); exception when sqlstate 'CCC01' then v_denied := true; end;
  v_results := v_results || format(E'\nIMMEDIATE_CANDIDATE_REVOCATION: %s', case when v_denied then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — add/edit validation, unordered mentions, stale edits, and edited_at

```sql
begin;

insert into public.committees (id,name) values ('c9040000-0000-4000-8000-000000000001','S9 Edit');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
 ('c9040000-0000-4000-8000-000000000011'::uuid,'s9-admin4@test.local'),
 ('c9040000-0000-4000-8000-000000000012'::uuid,'s9-co4@test.local'),
 ('c9040000-0000-4000-8000-000000000013'::uuid,'s9-member4@test.local')
) f(id,email);
insert into public.users (id,email,full_name,role,committee_id,is_active) values
 ('c9040000-0000-4000-8000-000000000011','s9-admin4@test.local','Edit Admin','Admin',null,true),
 ('c9040000-0000-4000-8000-000000000012','s9-co4@test.local','Edit Co','Co-Admin','c9040000-0000-4000-8000-000000000001',true),
 ('c9040000-0000-4000-8000-000000000013','s9-member4@test.local','Edit Member','Member','c9040000-0000-4000-8000-000000000001',true);
insert into public.events (id,name,start_date,end_date,status,created_by)
values ('c9040000-0000-4000-8000-000000000101','S9 Edit','2026-10-01','2026-10-02','Active','c9040000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,is_confidential)
values ('c9040000-0000-4000-8000-000000000201','c9040000-0000-4000-8000-000000000101','c9040000-0000-4000-8000-000000000001','Edit task',false);

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_comment_id uuid;
  v_other_comment uuid;
  v_edited_at timestamptz;
  v_many uuid[];
begin
  perform set_config('request.jwt.claims','{"sub":"c9040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select out_id into v_comment_id from public.add_task_comment(
    'c9040000-0000-4000-8000-000000000201', E'\n\t  Trim me \r\n', true,
    array['c9040000-0000-4000-8000-000000000012','c9040000-0000-4000-8000-000000000013']::uuid[]
  );
  select body='Trim me' and created_by='c9040000-0000-4000-8000-000000000011' and edited_at is null into v_ok
  from public.task_comments where id=v_comment_id;
  v_results := v_results || format(E'\nWHITESPACE_CLASS_TRIM_AND_SERVER_AUTHOR: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select mentioned_user_ids = array['c9040000-0000-4000-8000-000000000012','c9040000-0000-4000-8000-000000000013']::uuid[] into v_ok
  from public.task_comments where id=v_comment_id;
  v_results := v_results || format(E'\nMENTIONS_NORMALIZED_AS_SET: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.add_task_comment('c9040000-0000-4000-8000-000000000201',E' \n\t '); exception when sqlstate 'CCC03' then v_denied:=true; end;
  v_results := v_results || format(E'\nWHITESPACE_ONLY_BODY_CCC03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.add_task_comment('c9040000-0000-4000-8000-000000000201',repeat('x',4001)); exception when sqlstate 'CCC03' then v_denied:=true; end;
  v_results := v_results || format(E'\nBODY_OVER_4000_CCC03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.add_task_comment('c9040000-0000-4000-8000-000000000201','Duplicate',false,array['c9040000-0000-4000-8000-000000000012','c9040000-0000-4000-8000-000000000012']::uuid[]); exception when sqlstate 'CCC04' then v_denied:=true; end;
  v_results := v_results || format(E'\nDUPLICATE_MENTION_CCC04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  select array_agg(md5(i::text)::uuid) into v_many from generate_series(1,21) g(i);
  v_denied:=false; begin perform public.add_task_comment('c9040000-0000-4000-8000-000000000201','Too many',false,v_many); exception when sqlstate 'CCC04' then v_denied:=true; end;
  v_results := v_results || format(E'\nOVER_20_MENTIONS_CCC04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9040000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  select out_id into v_other_comment from public.add_task_comment(
    'c9040000-0000-4000-8000-000000000201', 'Member own', false,
    array['c9040000-0000-4000-8000-000000000011','c9040000-0000-4000-8000-000000000012']::uuid[]
  );
  select mentioned_user_ids = array['c9040000-0000-4000-8000-000000000011','c9040000-0000-4000-8000-000000000012']::uuid[]
  into v_ok from public.task_comments where id=v_other_comment;
  v_results := v_results || format(E'\nMEMBER_CAN_MENTION_ADMIN_AND_COADMIN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select created_by='c9040000-0000-4000-8000-000000000013' into v_ok from public.task_comments where id=v_other_comment;
  v_results := v_results || format(E'\nMEMBER_AUTHOR_DERIVED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9040000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  v_denied:=false; begin perform public.edit_task_comment(v_other_comment,'Admin rewrite',false,'{}',null); exception when sqlstate 'CCC06' then v_denied:=true; end;
  v_results := v_results || format(E'\nADMIN_CANNOT_EDIT_ANOTHER_AUTHOR: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.edit_task_comment(v_comment_id,'Trim me',true,array['c9040000-0000-4000-8000-000000000013','c9040000-0000-4000-8000-000000000012']::uuid[],null); exception when sqlstate 'CCC09' then v_denied:=true; end;
  v_results := v_results || format(E'\nREORDERED_MENTION_SET_IS_NOOP_CCC09: %s', case when v_denied then 'PASS' else 'FAIL' end);

  select out_edited_at into v_edited_at from public.edit_task_comment(v_comment_id,'Actually edited',false,array['c9040000-0000-4000-8000-000000000012','c9040000-0000-4000-8000-000000000013']::uuid[],null);
  v_ok := v_edited_at is not null;
  v_results := v_results || format(E'\nREAL_EDIT_SETS_EDITED_AT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select body='Actually edited' and not is_heads_up and edited_at=v_edited_at into v_ok from public.task_comments where id=v_comment_id;
  v_results := v_results || format(E'\nEDIT_STORES_EXACT_NORMALIZED_VALUES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.edit_task_comment(v_comment_id,'Stale edit',false,'{}',null); exception when sqlstate 'CCC08' then v_denied:=true; end;
  v_results := v_results || format(E'\nSTALE_EXPECTED_EDITED_AT_CCC08: %s', case when v_denied then 'PASS' else 'FAIL' end);

  update public.users set is_active=false where id='c9040000-0000-4000-8000-000000000012';
  v_denied:=false; begin perform public.edit_task_comment(v_comment_id,'Mention recheck',false,array['c9040000-0000-4000-8000-000000000012','c9040000-0000-4000-8000-000000000013']::uuid[],v_edited_at); exception when sqlstate 'CCC04' then v_denied:=true; end;
  v_results := v_results || format(E'\nEDIT_REVALIDATES_INACTIVE_MENTION_CCC04: %s', case when v_denied then 'PASS' else 'FAIL' end);

  select out_edited_at into v_edited_at from public.edit_task_comment(v_comment_id,'Mention removed',false,array['c9040000-0000-4000-8000-000000000013']::uuid[],v_edited_at);
  v_ok := v_edited_at is not null;
  v_results := v_results || format(E'\nEDIT_SUCCEEDS_AFTER_INVALID_MENTION_REMOVED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select cardinality(mentioned_user_ids)=1 and mentioned_user_ids[1]='c9040000-0000-4000-8000-000000000013' into v_ok from public.task_comments where id=v_comment_id;
  v_results := v_results || format(E'\nEDIT_REPLACED_MENTION_SET: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.edit_task_comment(v_comment_id,'',false,'{}',v_edited_at); exception when sqlstate 'CCC03' then v_denied:=true; end;
  v_results := v_results || format(E'\nEDIT_EMPTY_BODY_CCC03: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform public.set_task_confidentiality(
    'c9040000-0000-4000-8000-000000000201',
    true,
    '{}'::uuid[]
  );
  perform set_config('request.jwt.claims','{"sub":"c9040000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  v_denied:=false; begin perform public.edit_task_comment(v_other_comment,'Revoked',false,'{}',null); exception when sqlstate 'CCC01' then v_denied:=true; end;
  v_results := v_results || format(E'\nEDIT_RECHECKS_CURRENT_REAL_ACCESS: %s', case when v_denied then 'PASS' else 'FAIL' end);

  select count(*)=2 into v_ok from public.task_comments;
  v_results := v_results || format(E'\nFAILED_WRITES_LEFT_TWO_COMMENTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — delete roles, Archived freeze, cascades, locks, and no notifications

```sql
begin;

insert into public.committees (id,name) values ('c9050000-0000-4000-8000-000000000001','S9 Delete');
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',email,'',now(),'{}','{}',now(),now()
from (values
 ('c9050000-0000-4000-8000-000000000011'::uuid,'s9-admin5@test.local'),
 ('c9050000-0000-4000-8000-000000000012'::uuid,'s9-co5@test.local'),
 ('c9050000-0000-4000-8000-000000000013'::uuid,'s9-member5@test.local')
) f(id,email);
insert into public.users (id,email,full_name,role,committee_id,is_active) values
 ('c9050000-0000-4000-8000-000000000011','s9-admin5@test.local','Delete Admin','Admin',null,true),
 ('c9050000-0000-4000-8000-000000000012','s9-co5@test.local','Delete Co','Co-Admin','c9050000-0000-4000-8000-000000000001',true),
 ('c9050000-0000-4000-8000-000000000013','s9-member5@test.local','Delete Member','Member','c9050000-0000-4000-8000-000000000001',true);
insert into public.events (id,name,start_date,end_date,status,created_by) values
 ('c9050000-0000-4000-8000-000000000101','S9 Active','2026-10-01','2026-10-02','Active','c9050000-0000-4000-8000-000000000011'),
 ('c9050000-0000-4000-8000-000000000102','S9 Archive','2026-10-01','2026-10-02','Active','c9050000-0000-4000-8000-000000000011'),
 ('c9050000-0000-4000-8000-000000000103','S9 Cascade','2026-10-01',null,'Draft','c9050000-0000-4000-8000-000000000011');
insert into public.tasks (id,event_id,committee_id,title,is_confidential) values
 ('c9050000-0000-4000-8000-000000000201','c9050000-0000-4000-8000-000000000101','c9050000-0000-4000-8000-000000000001','Active task',false),
 ('c9050000-0000-4000-8000-000000000202','c9050000-0000-4000-8000-000000000102','c9050000-0000-4000-8000-000000000001','Archive task',true),
 ('c9050000-0000-4000-8000-000000000203','c9050000-0000-4000-8000-000000000103','c9050000-0000-4000-8000-000000000001','Cascade task',false);

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_denied boolean;
  v_member_comment uuid;
  v_co_comment uuid;
  v_archive_comment uuid;
  v_notifications bigint;
  v_activity bigint;
  v_body text;
  v_late_share_installed boolean;
begin
  select count(*) into v_notifications from public.notifications;
  select count(*) into v_activity
  from public.activity_log
  where task_id in (
    'c9050000-0000-4000-8000-000000000201',
    'c9050000-0000-4000-8000-000000000202'
  );

  perform set_config('request.jwt.claims','{"sub":"c9050000-0000-4000-8000-000000000013","role":"authenticated"}',true);
  select out_id into v_member_comment from public.add_task_comment('c9050000-0000-4000-8000-000000000201','Member comment');

  perform set_config('request.jwt.claims','{"sub":"c9050000-0000-4000-8000-000000000012","role":"authenticated"}',true);
  select out_id into v_co_comment from public.add_task_comment('c9050000-0000-4000-8000-000000000201','Co comment');
  v_denied:=false; begin perform public.delete_task_comment(v_member_comment); exception when sqlstate 'CCC07' then v_denied:=true; end;
  v_results := v_results || format(E'\nCOADMIN_NO_BLANKET_DELETE_CCC07: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform public.delete_task_comment(v_co_comment);
  select count(*)=0 into v_ok from public.task_comments where id=v_co_comment;
  v_results := v_results || format(E'\nAUTHOR_DELETES_OWN_COMMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims','{"sub":"c9050000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  select out_id into v_archive_comment from public.add_task_comment('c9050000-0000-4000-8000-000000000202','Archive comment');
  perform public.delete_task_comment(v_member_comment);
  select count(*)=0 into v_ok from public.task_comments where id=v_member_comment;
  v_results := v_results || format(E'\nACTIVE_ADMIN_DELETES_ANY_COMMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select out_id into v_member_comment from public.add_task_comment('c9050000-0000-4000-8000-000000000203','Cascade comment');
  delete from public.events where id='c9050000-0000-4000-8000-000000000103';
  select count(*)=0 into v_ok from public.task_comments where id=v_member_comment;
  v_results := v_results || format(E'\nAPPROVED_PARENT_CASCADE_REMOVES_COMMENTS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  update public.events set status='Archived' where id='c9050000-0000-4000-8000-000000000102';
  select count(*)=1 into v_ok from public.list_task_comments('c9050000-0000-4000-8000-000000000202');
  v_results := v_results || format(E'\nARCHIVED_COMMENT_REMAINS_READABLE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.add_task_comment('c9050000-0000-4000-8000-000000000202','Blocked'); exception when sqlstate 'CCC05' then v_denied:=true; end;
  v_results := v_results || format(E'\nARCHIVED_INSERT_CCC05: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.edit_task_comment(v_archive_comment,'Blocked edit',false,'{}',null); exception when sqlstate 'CCC05' then v_denied:=true; end;
  v_results := v_results || format(E'\nARCHIVED_EDIT_CCC05: %s', case when v_denied then 'PASS' else 'FAIL' end);

  v_denied:=false; begin perform public.delete_task_comment(v_archive_comment); exception when sqlstate 'CCC05' then v_denied:=true; end;
  v_results := v_results || format(E'\nARCHIVED_DELETE_CCC05: %s', case when v_denied then 'PASS' else 'FAIL' end);

  select count(*)=v_notifications into v_ok from public.notifications;
  v_results := v_results || format(E'\nNO_NOTIFICATION_ROWS_CREATED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*)=v_activity into v_ok from public.activity_log where task_id in ('c9050000-0000-4000-8000-000000000201','c9050000-0000-4000-8000-000000000202');
  v_results := v_results || format(E'\nCOMMENTS_CREATE_NO_TASK_ACTIVITY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef('public.add_task_comment(uuid,text,boolean,uuid[])'::regprocedure)) into v_body;
  v_ok := strpos(v_body,'public.task_content_access(')>0
    and strpos(v_body,'public.task_content_access(')<strpos(v_body,'for no key update')
    and strpos(v_body,'for share')>strpos(v_body,'for no key update');
  v_results := v_results || format(E'\nADD_PRECHECK_THEN_TASK_THEN_EVENT_LOCK_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef('public.edit_task_comment(uuid,text,boolean,uuid[],timestamp with time zone)'::regprocedure)) into v_body;
  v_ok := strpos(v_body,'public.task_content_access(')>0
    and strpos(v_body,'public.task_content_access(')<strpos(v_body,'for no key update')
    and strpos(v_body,'for share')>strpos(v_body,'for no key update')
    and strpos(v_body,'for update')>strpos(v_body,'for share');
  v_results := v_results || format(E'\nEDIT_PRECHECK_THEN_PARENT_LOCKS_BEFORE_COMMENT: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select lower(pg_catalog.pg_get_functiondef('public.delete_task_comment(uuid)'::regprocedure)) into v_body;
  v_ok := strpos(v_body,'public.task_content_access(')>0
    and strpos(v_body,'public.task_content_access(')<strpos(v_body,'for no key update')
    and strpos(v_body,'for share')>strpos(v_body,'for no key update');
  v_results := v_results || format(E'\nDELETE_PRECHECK_THEN_TASK_THEN_EVENT_LOCK_ORDER: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := true;
  for v_body in select lower(pg_catalog.pg_get_functiondef(oid)) from pg_catalog.pg_proc where oid in (
    'public.add_task_comment(uuid,text,boolean,uuid[])'::regprocedure,
    'public.edit_task_comment(uuid,text,boolean,uuid[],timestamp with time zone)'::regprocedure,
    'public.delete_task_comment(uuid)'::regprocedure
  ) loop
    v_ok := v_ok
      and strpos(v_body,'public.task_content_access(')>0
      and strpos(v_body,'public.task_content_access(')<strpos(v_body,'for no key update');
  end loop;
  v_results := v_results || format(E'\nALL_THREE_WRITERS_PREAUTHORIZE_BEFORE_FIRST_LOCK: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*)=3 into v_ok from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and lower(pg_catalog.pg_get_functiondef(p.oid)) ~ '(insert into|update|delete from) public\.task_comments';
  v_results := v_results || format(E'\nEXACT_DIRECT_COMMENT_WRITER_INVENTORY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := to_regprocedure('public.edit_event_with_tasks(uuid,timestamp with time zone,text,text,date,date,text,jsonb,jsonb,uuid[])') is not null
    and to_regprocedure('public.archive_event(uuid,bigint,timestamp with time zone)') is not null
    and to_regprocedure('public.delete_task(uuid)') is not null
    and to_regprocedure('public.claim_task(uuid)') is not null
    and to_regprocedure('public.volunteer_for_task(uuid)') is not null;
  v_results := v_results || format(E'\nCONCURRENT_PARENT_WRITERS_RETAINED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := true;
  for v_body in select lower(pg_catalog.pg_get_functiondef(oid)) from pg_catalog.pg_proc where oid in (
    'public.guard_task_comment_writes()'::regprocedure,
    'public.add_task_comment(uuid,text,boolean,uuid[])'::regprocedure,
    'public.edit_task_comment(uuid,text,boolean,uuid[],timestamp with time zone)'::regprocedure,
    'public.delete_task_comment(uuid)'::regprocedure
  ) loop v_ok := v_ok and v_body like '%40001%'; end loop;
  v_results := v_results || format(E'\nSTALE_PARENT_RACES_USE_40001: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_late_share_installed := to_regclass('public.archived_task_viewers') is not null;
  if v_late_share_installed then
    execute $late$
      insert into public.archived_task_viewers (
        task_id, user_id, granted_by
      ) values (
        'c9050000-0000-4000-8000-000000000202',
        'c9050000-0000-4000-8000-000000000013',
        'c9050000-0000-4000-8000-000000000011'
      )
    $late$;
    perform set_config('request.jwt.claims','{"sub":"c9050000-0000-4000-8000-000000000013","role":"authenticated"}',true);
    select count(*)=1 into v_ok
    from public.list_task_comments('c9050000-0000-4000-8000-000000000202');
    perform set_config('request.jwt.claims','{"sub":"c9050000-0000-4000-8000-000000000011","role":"authenticated"}',true);
  else
    v_ok := lower(pg_catalog.pg_get_functiondef(
      'public.list_task_comments(uuid,integer,timestamp with time zone,uuid)'::regprocedure
    )) like '%task_content_access(p_task_id)%';
  end if;
  v_results := v_results || format(E'\nOPTIONAL_7B_SHARED_ACCESS_COMPATIBILITY_PIN: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select not pg_catalog.has_table_privilege(
    'authenticated', 'public.task_comments', 'INSERT'
  ) into v_ok;
  v_results := v_results || format(E'\nDIRECT_AUTHENTICATED_INSERT_DENIED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*)=1 into v_ok from public.task_comments where id=v_archive_comment;
  v_results := v_results || format(E'\nFAILED_ARCHIVED_WRITES_PRESERVE_ROW: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

`40001` means a stored task/event/comment relationship changed while a writer
was acquiring its locks. PostgreSQL may also return `40P01` when the accepted
task-child lock order meets an event-first task writer. Both are retryable UI
errors: refetch current state and ask the user to try again. Neither may be
treated as a successful or partially committed comment mutation.
