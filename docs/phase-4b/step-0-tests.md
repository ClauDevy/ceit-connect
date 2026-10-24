# Step 0 — users authorization fix tests

Run this only against **Dev** in the Supabase SQL Editor with **Run without RLS** enabled. The paste creates its own `auth.users` fixtures, contains every impersonation line, uses no temporary tables, never deletes from `storage.objects`, and rolls back through its final intentional exception.

The exception must contain exactly **32 result lines**, all `PASS`. Line 30 aggregates the eight forged protected-field attempts. The transaction-only `anonymized_at` and `step_0_future_marker` columns are removed by the same final rollback.

```sql
begin;

alter table public.users add column anonymized_at timestamptz;
alter table public.users add column step_0_future_marker text;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', pg_catalog.now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.now(), pg_catalog.now()
from (values
  ('b0000000-0000-4000-8000-000000000001'::uuid, 'step0-admin@test.local'),
  ('b0000000-0000-4000-8000-000000000002'::uuid, 'step0-co@test.local'),
  ('b0000000-0000-4000-8000-000000000003'::uuid, 'step0-member@test.local'),
  ('b0000000-0000-4000-8000-000000000004'::uuid, 'step0-same-co@test.local'),
  ('b0000000-0000-4000-8000-000000000005'::uuid, 'step0-other@test.local'),
  ('b0000000-0000-4000-8000-000000000006'::uuid, 'step0-inactive@test.local'),
  ('b0000000-0000-4000-8000-000000000007'::uuid, 'step0-profileless@test.local')
) fixture(id, email);

with committees as (
  select id, pg_catalog.row_number() over (order by name) as position
  from public.committees
), fixtures(id, email, full_name, role, committee_position, is_active) as (values
  ('b0000000-0000-4000-8000-000000000002'::uuid, 'step0-co@test.local', 'Original Co', 'Co-Admin', 1::bigint, true),
  ('b0000000-0000-4000-8000-000000000003'::uuid, 'step0-member@test.local', 'Original Member', 'Member', 1::bigint, true),
  ('b0000000-0000-4000-8000-000000000004'::uuid, 'step0-same-co@test.local', 'Same Committee Co', 'Co-Admin', 1::bigint, true),
  ('b0000000-0000-4000-8000-000000000005'::uuid, 'step0-other@test.local', 'Other Committee Member', 'Member', 2::bigint, true),
  ('b0000000-0000-4000-8000-000000000006'::uuid, 'step0-inactive@test.local', 'Inactive Member', 'Member', 1::bigint, false)
)
insert into public.users (id, email, full_name, role, committee_id, is_active)
select f.id, f.email, f.full_name, f.role, c.id, f.is_active
from fixtures f
join committees c on c.position = f.committee_position;

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  'b0000000-0000-4000-8000-000000000001',
  'step0-admin@test.local', 'Original Admin', 'Admin', null, true
);

select pg_catalog.set_config('test.step0_results', '', true);

do $$
declare
  v_ok boolean;
  v_definition text;
begin
  select pg_catalog.count(*) = 3
    and pg_catalog.count(*) filter (where policyname in (
      'users_select_own_row',
      'co_admin_view_own_committee_members',
      'admin_full_access_users'
    )) = 3
  into v_ok
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'users';
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nEXACT_THREE_USERS_POLICIES: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select pg_catalog.count(*) = 2 into v_ok
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'users' and (
    (policyname = 'users_select_own_row' and cmd = 'SELECT'
      and pg_catalog.lower(qual) like '%id = auth.uid()%')
    or
    (policyname = 'co_admin_view_own_committee_members' and cmd = 'SELECT'
      and pg_catalog.lower(qual) like '%my_role() = ''co-admin''%'
      and pg_catalog.lower(qual) like '%my_committee_id() = committee_id%')
  );
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nUSERS_SELECT_POLICIES_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'users'
      and policyname = 'co_admin_update_own_committee_members'
  ) into v_ok;
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nCOADMIN_UPDATE_POLICY_ABSENT: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select pg_catalog.count(*) = 1
    and pg_catalog.min(pg_catalog.pg_get_function_identity_arguments(p.oid)) = 'p_full_name text'
  into v_ok
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_own_profile';
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nRPC_EXACT_SIGNATURE_AND_NO_OVERLOAD: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select pg_catalog.pg_get_userbyid(proowner) = 'postgres' into v_ok
  from pg_catalog.pg_proc
  where oid = 'public.update_own_profile(text)'::regprocedure;
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nRPC_POSTGRES_OWNER: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select prosecdef and provolatile = 'v' and proconfig = array['search_path=']
  into v_ok
  from pg_catalog.pg_proc
  where oid = 'public.update_own_profile(text)'::regprocedure;
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nRPC_DEFINER_VOLATILE_EMPTY_PATH: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select has_function_privilege('authenticated', 'public.update_own_profile(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_own_profile(text)', 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(p.proacl) acl
      where p.oid = 'public.update_own_profile(text)'::regprocedure
        and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
    )
  into v_ok;
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nRPC_AUTHENTICATED_ONLY_EXECUTE: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select not exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = 'public.users'::regclass
      and acl.privilege_type = 'UPDATE'
      and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
  ) into v_ok;
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nPUBLIC_ANON_AUTHENTICATED_NO_TABLE_UPDATE: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select not exists (
    select 1
    from pg_catalog.pg_attribute a
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    where a.attrelid = 'public.users'::regclass
      and a.attnum > 0 and not a.attisdropped
      and acl.privilege_type = 'UPDATE'
      and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
  ) into v_ok;
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nPUBLIC_ANON_AUTHENTICATED_NO_COLUMN_UPDATE: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select pg_catalog.pg_get_functiondef('public.update_own_profile(text)'::regprocedure)
  into v_definition;
  v_ok := pg_catalog.lower(v_definition) like '%update public.users%set full_name = v_full_name%where id = v_caller_id%'
    and pg_catalog.lower(v_definition) not like '%set role =%'
    and pg_catalog.lower(v_definition) not like '%set committee_id =%'
    and pg_catalog.lower(v_definition) not like '%set is_active =%'
    and pg_catalog.lower(v_definition) not like '%set email =%'
    and pg_catalog.lower(v_definition) not like '%set password_set =%'
    and pg_catalog.lower(v_definition) not like '%set avatar_url =%';
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nRPC_CALLER_DERIVED_EXPLICIT_FULL_NAME_UPDATE: %s', case when v_ok then 'PASS' else 'FAIL' end), true);

  select pg_catalog.count(*) = 1 into v_ok
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'users'
    and policyname = 'admin_full_access_users' and cmd = 'ALL'
    and pg_catalog.lower(qual) like '%my_role() = ''admin''%';
  perform pg_catalog.set_config('test.step0_results',
    current_setting('test.step0_results') || format(E'\nADMIN_ALL_POLICY_REMAINS: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end;
$$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select pg_catalog.set_config('test.step0_admin_visible', pg_catalog.count(*)::text, true)
from public.users;
reset role;
select pg_catalog.set_config('test.step0_results',
  current_setting('test.step0_results') || format(E'\nACTIVE_ADMIN_SELECT_STILL_WORKS: %s',
    case when current_setting('test.step0_admin_visible')::integer = 6 then 'PASS' else 'FAIL' end), true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select pg_catalog.set_config('test.step0_admin_saved',
  public.update_own_profile(pg_catalog.chr(160) || 'Admin Saved' || pg_catalog.chr(160)), true);
reset role;
select pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') ||
  format(E'\nACTIVE_ADMIN_NBSP_TRIMMED_SUCCESS: %s', case when current_setting('test.step0_admin_saved') = 'Admin Saved'
    and (select full_name = 'Admin Saved' from public.users where id = 'b0000000-0000-4000-8000-000000000001') then 'PASS' else 'FAIL' end), true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
select public.update_own_profile('Co Saved');
reset role;
select pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') ||
  format(E'\nACTIVE_COADMIN_RPC_SUCCESS: %s', case when (select full_name = 'Co Saved' from public.users where id = 'b0000000-0000-4000-8000-000000000002') then 'PASS' else 'FAIL' end), true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
select public.update_own_profile('Member Saved');
reset role;
select pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') ||
  format(E'\nACTIVE_MEMBER_RPC_SUCCESS: %s', case when (select full_name = 'Member Saved' from public.users where id = 'b0000000-0000-4000-8000-000000000003') then 'PASS' else 'FAIL' end), true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
select pg_catalog.set_config('test.step0_unicode_saved', public.update_own_profile(pg_catalog.repeat('🙂', 100)), true);
reset role;
select pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') ||
  format(E'\nUNICODE_100_CODE_POINTS_SUCCESS: %s', case when pg_catalog.char_length(current_setting('test.step0_unicode_saved')) = 100 then 'PASS' else 'FAIL' end), true);

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
do $$
declare v_ok boolean := true; v_code text;
begin
  begin perform public.update_own_profile(null); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  begin perform public.update_own_profile('   '); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  begin perform public.update_own_profile(pg_catalog.repeat(pg_catalog.chr(160), 2)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nNULL_EMPTY_NBSP_ONLY_REJECTED_CCP02: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end $$;
do $$ declare v_ok boolean := true; v_code text; begin
  begin perform public.update_own_profile(pg_catalog.repeat('🙂', 101)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  begin perform public.update_own_profile(pg_catalog.repeat('🙂', 1001)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nOVER_100_AND_RAW_1001_CODE_POINTS_REJECTED_CCP02: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end $$;
do $$ declare v_ok boolean := true; v_code text; begin
  begin perform public.update_own_profile('Name' || pg_catalog.chr(1)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  begin perform public.update_own_profile('Name' || pg_catalog.chr(127)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  begin perform public.update_own_profile('Name' || pg_catalog.chr(133)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nCONTROL_DEL_NEL_REJECTED_CCP02: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end $$;
do $$ declare v_ok boolean := true; v_code text; begin
  begin perform public.update_own_profile('Name' || pg_catalog.chr(8232)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  begin perform public.update_own_profile('Name' || pg_catalog.chr(8233)); exception when others then get stacked diagnostics v_code = returned_sqlstate; v_ok := v_ok and v_code = 'CCP02'; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nLINE_SEPARATORS_REJECTED_CCP02: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end $$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
do $$ declare v_code text := ''; begin
  begin perform public.update_own_profile(null); exception when others then get stacked diagnostics v_code = returned_sqlstate; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nINACTIVE_INVALID_INPUT_REJECTED_CCP01_FIRST: %s', case when v_code = 'CCP01' then 'PASS' else 'FAIL' end), true);
end $$;
reset role;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
do $$ declare v_code text := ''; begin
  begin perform public.update_own_profile(null); exception when others then get stacked diagnostics v_code = returned_sqlstate; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nPROFILELESS_INVALID_INPUT_REJECTED_CCP01_FIRST: %s', case when v_code = 'CCP01' then 'PASS' else 'FAIL' end), true);
end $$;
reset role;

set local role anon;
select pg_catalog.set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$ declare v_code text := ''; begin
  begin perform public.update_own_profile('Anon'); exception when others then get stacked diagnostics v_code = returned_sqlstate; end;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nUNAUTHENTICATED_HAS_NO_EXECUTE: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true);
end $$;
reset role;

-- Lines 24–29: every direct authenticated UPDATE is denied before RLS can grant it.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
do $$ declare v_code text := ''; begin begin update public.users set full_name = 'Forged' where id = 'b0000000-0000-4000-8000-000000000003'; exception when others then get stacked diagnostics v_code = returned_sqlstate; end; perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRAW_ADMIN_UPDATE_DENIED: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true); end $$;
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
do $$ declare v_code text := ''; begin begin update public.users set full_name = 'Forged' where id = 'b0000000-0000-4000-8000-000000000002'; exception when others then get stacked diagnostics v_code = returned_sqlstate; end; perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRAW_COADMIN_SELF_UPDATE_DENIED: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true); end $$;
do $$ declare v_code text := ''; begin begin update public.users set full_name = 'Forged' where id = 'b0000000-0000-4000-8000-000000000003'; exception when others then get stacked diagnostics v_code = returned_sqlstate; end; perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRAW_COADMIN_SAME_MEMBER_UPDATE_DENIED: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true); end $$;
do $$ declare v_code text := ''; begin begin update public.users set full_name = 'Forged' where id = 'b0000000-0000-4000-8000-000000000004'; exception when others then get stacked diagnostics v_code = returned_sqlstate; end; perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRAW_COADMIN_SAME_COADMIN_UPDATE_DENIED: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true); end $$;
do $$ declare v_code text := ''; begin begin update public.users set full_name = 'Forged' where id = 'b0000000-0000-4000-8000-000000000005'; exception when others then get stacked diagnostics v_code = returned_sqlstate; end; perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRAW_COADMIN_OTHER_COMMITTEE_UPDATE_DENIED: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true); end $$;
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', 'b0000000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
do $$ declare v_code text := ''; begin begin update public.users set full_name = 'Forged' where id = 'b0000000-0000-4000-8000-000000000003'; exception when others then get stacked diagnostics v_code = returned_sqlstate; end; perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRAW_MEMBER_SELF_UPDATE_DENIED: %s', case when v_code = '42501' then 'PASS' else 'FAIL' end), true); end $$;

do $$
declare
  v_ok boolean := true;
  v_code text;
  v_statement text;
begin
  foreach v_statement in array array[
    'update public.users set role = ''Admin'' where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set committee_id = null where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set is_active = false where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set email = ''forged@test.local'' where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set password_set = true where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set avatar_url = ''https://forged.invalid/avatar'' where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set anonymized_at = pg_catalog.now() where id = ''b0000000-0000-4000-8000-000000000003''',
    'update public.users set step_0_future_marker = ''forged'' where id = ''b0000000-0000-4000-8000-000000000003'''
  ] loop
    v_code := '';
    begin execute v_statement; exception when others then get stacked diagnostics v_code = returned_sqlstate; end;
    v_ok := v_ok and v_code = '42501';
  end loop;
  perform pg_catalog.set_config('test.step0_forged_denied', v_ok::text, true);
end $$;
reset role;
do $$ declare v_ok boolean; begin
  select current_setting('test.step0_forged_denied')::boolean
    and role = 'Member' and committee_id is not null and is_active
    and email = 'step0-member@test.local' and not password_set
    and avatar_url is null and anonymized_at is null and step_0_future_marker is null
  into v_ok from public.users where id = 'b0000000-0000-4000-8000-000000000003';
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nEIGHT_PROTECTED_FIELDS_DENIED_NO_PARTIAL_WRITE: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end $$;

do $$ declare v_ok boolean; begin
  select
    (select full_name = 'Admin Saved' from public.users where id = 'b0000000-0000-4000-8000-000000000001')
    and (select full_name = 'Co Saved' from public.users where id = 'b0000000-0000-4000-8000-000000000002')
    and (select full_name = pg_catalog.repeat('🙂', 100) from public.users where id = 'b0000000-0000-4000-8000-000000000003')
    and (select full_name = 'Same Committee Co' from public.users where id = 'b0000000-0000-4000-8000-000000000004')
    and (select full_name = 'Other Committee Member' from public.users where id = 'b0000000-0000-4000-8000-000000000005')
  into v_ok;
  perform pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') || format(E'\nRPC_CHANGES_ONLY_CALLER_ROW: %s', case when v_ok then 'PASS' else 'FAIL' end), true);
end $$;

select pg_catalog.set_config('test.step0_results', current_setting('test.step0_results') ||
  format(E'\nRPC_LEAVES_AUTH_EMAIL_UNCHANGED: %s', case when (
    select email = 'step0-member@test.local' from auth.users
    where id = 'b0000000-0000-4000-8000-000000000003'
  ) then 'PASS' else 'FAIL' end), true);

do $$
begin
  raise exception 'TEST RESULTS %', current_setting('test.step0_results');
end;
$$;
```
