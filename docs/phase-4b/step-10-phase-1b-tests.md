# Step 10 Stage B Phase 1b: Auth identity cleanup Dev gate

Do not run this paste until the Dev catalog query in `step-10.md` has been
compared with the unapplied migration. After the owner applies the migration,
run the whole paste in the Dev SQL editor. It is one transaction and always
rolls back. The final diagnostic must contain exactly **42 result lines**, all
`PASS`.

The service-role cases set both the PostgreSQL role and
`request.jwt.claims.role`. Success fixtures reach `anonymized_at` only through
the real Stage A `anonymize_former_member()` function. Each negative guard
captures the target's profile/Auth/identity/session fingerprint before the call
and proves it is identical afterward.

## Expected result lines

1. `C01_FUNCTION_EXISTS: PASS`
2. `C02_SECURITY_OWNER: PASS`
3. `C03_FIXED_SEARCH_PATH: PASS`
4. `C04_SERVICE_ROLE_EXECUTE: PASS`
5. `C05_CLIENT_EXECUTE_REVOKED: PASS`
6. `C06_RETURN_SHAPE: PASS`
7. `C07_NO_AUTH_USER_OR_AUDIT_DELETE: PASS`
8. `C08_IDENTITY_COLLISION_GUARD_PRESENT: PASS`
9. `C09_OPTIONALS_USE_PG_ATTRIBUTE: PASS`
10. `C10_OPTIONAL_FLOW_AND_AUDIT_POLICY: PASS`
11. `S01_STAGE_A_STANDARD: PASS`
12. `S02_STAGE_A_ZERO_EMAIL: PASS`
13. `S03_AUTH_PRECONDITION_READY: PASS`
14. `S04_CLEANED_ONE_EMAIL_RESULT: PASS`
15. `S05_PROTECTED_AUTH_CORE_PRESERVED: PASS`
16. `S06_OPERATIONAL_TIMESTAMPS_PRESERVED: PASS`
17. `S07_USER_METADATA_EMPTY: PASS`
18. `S08_APP_METADATA_EMAIL_ONLY: PASS`
19. `S09_PHONE_STATE_CLEARED: PASS`
20. `S10_EMAIL_CHANGE_STATE_CLEARED: PASS`
21. `S11_OTHER_AUTH_TOKENS_CLEARED: PASS`
22. `S12_NON_EMAIL_IDENTITIES_DELETED: PASS`
23. `S13_EMAIL_IDENTITY_CANONICAL: PASS`
24. `S14_EMAIL_IDENTITY_COUNT_ONE: PASS`
25. `S15_SESSIONS_AND_REFRESH_TOKENS_DELETED: PASS`
26. `S16_MFA_FACTORS_DELETED_IF_PRESENT: PASS`
27. `S17_ONE_TIME_TOKENS_DELETED_IF_PRESENT: PASS`
28. `S18_FLOW_STATE_DELETED_IF_PRESENT: PASS`
29. `S19_PUBLIC_TERMINAL_STATE_UNCHANGED: PASS`
30. `Z01_ZERO_EMAIL_RESULT: PASS`
31. `Z02_ZERO_EMAIL_NOT_MANUFACTURED: PASS`
32. `Z03_ZERO_EMAIL_METADATA_CLEAN: PASS`
33. `R01_IDEMPOTENT_RETRY_RESULT: PASS`
34. `R02_IDEMPOTENT_RETRY_STATE: PASS`
35. `G01_WRONG_ROLE_CMI01_UNCHANGED: PASS`
36. `G02_ACTIVE_TARGET_CMI03_UNCHANGED: PASS`
37. `G03_NOT_ANONYMIZED_CMI04_UNCHANGED: PASS`
38. `G04_UNBANNED_CMI08_UNCHANGED: PASS`
39. `G05_WRONG_EMAIL_CMI06_UNCHANGED: PASS`
40. `G06_MULTIPLE_EMAIL_CMI09_UNCHANGED: PASS`
41. `G07_PROVIDER_COLLISION_CMI10_UNCHANGED: PASS`
42. `F01_EXACT_RESULT_COUNT: PASS`

## Rollback-safe SQL paste

```sql
begin;

select pg_catalog.set_config('ceit_connect.p1b_count', '0', true);
select pg_catalog.set_config('ceit_connect.p1b_results', '', true);

create function pg_temp.p1b_record(p_label text, p_ok boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer := coalesce(
    nullif(pg_catalog.current_setting('ceit_connect.p1b_count', true), ''),
    '0'
  )::integer + 1;
  v_results text := coalesce(
    pg_catalog.current_setting('ceit_connect.p1b_results', true), ''
  );
begin
  perform pg_catalog.set_config('ceit_connect.p1b_count', v_count::text, true);
  perform pg_catalog.set_config(
    'ceit_connect.p1b_results',
    v_results || case when v_results = '' then '' else E'\n' end
      || p_label || ': ' || case when p_ok then 'PASS' else 'FAIL' end,
    true
  );
end;
$$;

create function pg_temp.p1b_query(p_label text, p_sql text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  execute p_sql into v_ok;
  perform pg_temp.p1b_record(p_label, coalesce(v_ok, false));
exception
  when others then
    perform pg_temp.p1b_record(p_label, false);
end;
$$;

create function pg_temp.p1b_optional_count(p_table text, p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint := 0;
begin
  if p_table not in ('mfa_factors', 'one_time_tokens', 'flow_state') then
    raise exception 'Unexpected optional table';
  end if;
  if pg_catalog.to_regclass('auth.' || p_table) is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.' || p_table)
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute pg_catalog.format(
      'select count(*) from auth.%I where user_id = $1', p_table
    ) into v_count using p_user_id;
  end if;
  return v_count;
end;
$$;

alter function pg_temp.p1b_optional_count(text, uuid) owner to postgres;

create function pg_temp.p1b_fingerprint(p_user_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.md5(pg_catalog.jsonb_build_object(
    'profile', (select pg_catalog.to_jsonb(profile) from public.users as profile where profile.id = p_user_id),
    'auth', (select pg_catalog.to_jsonb(auth_user) from auth.users as auth_user where auth_user.id = p_user_id),
    'identities', (
      select coalesce(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(identity) order by identity.id),
        '[]'::jsonb
      )
      from auth.identities as identity
      where identity.user_id = p_user_id
    ),
    'sessions', (select count(*) from auth.sessions as session where session.user_id = p_user_id),
    'refresh', (select count(*) from auth.refresh_tokens as token where token.user_id = p_user_id::text),
    'mfa', pg_temp.p1b_optional_count('mfa_factors', p_user_id),
    'ott', pg_temp.p1b_optional_count('one_time_tokens', p_user_id),
    'flow', pg_temp.p1b_optional_count('flow_state', p_user_id)
  )::text);
$$;

alter function pg_temp.p1b_fingerprint(uuid) owner to postgres;

create function pg_temp.p1b_probe_unchanged(
  p_label text,
  p_sql text,
  p_expected_sqlstate text,
  p_user_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before text := pg_temp.p1b_fingerprint(p_user_id);
  v_after text;
  v_sqlstate text;
begin
  begin
    execute p_sql;
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  v_after := pg_temp.p1b_fingerprint(p_user_id);
  perform pg_temp.p1b_record(
    p_label,
    v_sqlstate = p_expected_sqlstate and v_before = v_after
  );
end;
$$;

select pg_temp.p1b_query('C01_FUNCTION_EXISTS', $$
  select pg_catalog.to_regprocedure('public.cleanup_former_member_auth(uuid)') is not null
$$);
select pg_temp.p1b_query('C02_SECURITY_OWNER', $$
  select procedure.prosecdef and owner.rolname = 'postgres'
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
$$);
select pg_temp.p1b_query('C03_FIXED_SEARCH_PATH', $$
  select procedure.proconfig = array['search_path=""']
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
$$);
select pg_temp.p1b_query('C04_SERVICE_ROLE_EXECUTE', $$
  select pg_catalog.has_function_privilege(
    'service_role', 'public.cleanup_former_member_auth(uuid)', 'EXECUTE'
  )
$$);
select pg_temp.p1b_query('C05_CLIENT_EXECUTE_REVOKED', $$
  select not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) as acl
    where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee in (
        0,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated')
      )
  )
$$);
select pg_temp.p1b_query('C06_RETURN_SHAPE', $$
  select pg_catalog.pg_get_function_result(
    'public.cleanup_former_member_auth(uuid)'::regprocedure
  ) = 'TABLE(out_user_id uuid, out_outcome text, out_email_identity_count integer)'
$$);
select pg_temp.p1b_query('C07_NO_AUTH_USER_OR_AUDIT_DELETE', $$
  select procedure.prosrc !~* 'delete[[:space:]]+from[[:space:]]+auth[.]users'
     and procedure.prosrc !~* 'audit_log_entries'
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
$$);
select pg_temp.p1b_query('C08_IDENTITY_COLLISION_GUARD_PRESENT', $$
  select procedure.prosrc ~ 'provider_id = p_user_id::text'
     and procedure.prosrc ~ 'v_email_identity_count > 1'
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
$$);
select pg_temp.p1b_query('C09_OPTIONALS_USE_PG_ATTRIBUTE', $$
  select procedure.prosrc ~ 'pg_catalog[.]pg_attribute'
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
$$);
select pg_temp.p1b_query('C10_OPTIONAL_FLOW_AND_AUDIT_POLICY', $$
  select procedure.prosrc ~ 'auth[.]flow_state'
     and procedure.prosrc ~ 'auth[.]mfa_factors'
     and procedure.prosrc ~ 'auth[.]one_time_tokens'
     and procedure.prosrc !~ 'auth[.]audit_log_entries'
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.cleanup_former_member_auth(uuid)'::regprocedure
$$);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, last_sign_in_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
select fixture.id,
       '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', fixture.email, 'kept-hash',
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
       '{"provider":"google","providers":["google","email"]}'::jsonb,
       '{"name":"Personal Name","email":"personal@example.com","picture":"https://example.com/p.jpg","sub":"google-sub"}'::jsonb,
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from (values
  ('b10b0000-0000-4000-8000-000000000001'::uuid, 'p1b-admin@test.local'),
  ('b10b0000-0000-4000-8000-000000000002'::uuid, 'p1b-standard@test.local'),
  ('b10b0000-0000-4000-8000-000000000003'::uuid, 'p1b-zero@test.local'),
  ('b10b0000-0000-4000-8000-000000000004'::uuid, 'p1b-wrong-role@test.local'),
  ('b10b0000-0000-4000-8000-000000000005'::uuid, 'p1b-active@test.local'),
  ('b10b0000-0000-4000-8000-000000000006'::uuid, 'p1b-not-anon@test.local'),
  ('b10b0000-0000-4000-8000-000000000007'::uuid, 'p1b-unbanned@test.local'),
  ('b10b0000-0000-4000-8000-000000000008'::uuid, 'p1b-wrong-email@test.local'),
  ('b10b0000-0000-4000-8000-000000000009'::uuid, 'p1b-multiple@test.local'),
  ('b10b0000-0000-4000-8000-00000000000a'::uuid, 'p1b-collision@test.local'),
  ('b10b0000-0000-4000-8000-00000000000b'::uuid, 'p1b-collision-owner@test.local')
) as fixture(id, email);

do $$
declare
  v_committee uuid;
begin
  select committee.id into v_committee
  from public.committees as committee
  order by committee.name, committee.id
  limit 1;
  if v_committee is null then
    raise exception 'TEST FIXTURE ERROR: one committee is required.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  ) values (
    'b10b0000-0000-4000-8000-000000000001',
    'p1b-admin@test.local', 'P1B Admin', 'Admin', null, true
  );
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  )
  select fixture.id, fixture.email, fixture.name, 'Member', v_committee,
         fixture.active
  from (values
    ('b10b0000-0000-4000-8000-000000000002'::uuid, 'p1b-standard@test.local', 'Standard', false),
    ('b10b0000-0000-4000-8000-000000000003'::uuid, 'p1b-zero@test.local', 'Zero', false),
    ('b10b0000-0000-4000-8000-000000000004'::uuid, 'p1b-wrong-role@test.local', 'Wrong Role', false),
    ('b10b0000-0000-4000-8000-000000000005'::uuid, 'p1b-active@test.local', 'Active', true),
    ('b10b0000-0000-4000-8000-000000000006'::uuid, 'p1b-not-anon@test.local', 'Not Anon', false),
    ('b10b0000-0000-4000-8000-000000000007'::uuid, 'p1b-unbanned@test.local', 'Unbanned', false),
    ('b10b0000-0000-4000-8000-000000000008'::uuid, 'p1b-wrong-email@test.local', 'Wrong Email', false),
    ('b10b0000-0000-4000-8000-000000000009'::uuid, 'p1b-multiple@test.local', 'Multiple', false),
    ('b10b0000-0000-4000-8000-00000000000a'::uuid, 'p1b-collision@test.local', 'Collision', false),
    ('b10b0000-0000-4000-8000-00000000000b'::uuid, 'p1b-collision-owner@test.local', 'Collision Owner', false)
  ) as fixture(id, email, name, active);
end;
$$;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b10b0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_temp.p1b_query('S01_STAGE_A_STANDARD', $$
  select out_outcome = 'anonymized'
  from public.anonymize_former_member('b10b0000-0000-4000-8000-000000000002')
$$);
select pg_temp.p1b_query('S02_STAGE_A_ZERO_EMAIL', $$
  select out_outcome = 'anonymized'
  from public.anonymize_former_member('b10b0000-0000-4000-8000-000000000003')
$$);
select * from public.anonymize_former_member('b10b0000-0000-4000-8000-000000000004');
select * from public.anonymize_former_member('b10b0000-0000-4000-8000-000000000007');
select * from public.anonymize_former_member('b10b0000-0000-4000-8000-000000000008');
select * from public.anonymize_former_member('b10b0000-0000-4000-8000-000000000009');
select * from public.anonymize_former_member('b10b0000-0000-4000-8000-00000000000a');
reset role;

-- Every nonempty Auth value covered by a unique index is deterministic per
-- fixture UUID. The phone strings remain distinct even for the hexadecimal
-- UUID suffix used by the collision target.
update auth.users as auth_user
set email = auth_user.id::text || '@former.invalid',
    email_confirmed_at = coalesce(
      auth_user.email_confirmed_at, pg_catalog.clock_timestamp()
    ),
    banned_until = pg_catalog.clock_timestamp() + interval '100 years',
    phone = '+63917' || pg_catalog.translate(
      pg_catalog.right(pg_catalog.replace(auth_user.id::text, '-', ''), 7),
      'abcdef',
      '012345'
    ),
    phone_confirmed_at = pg_catalog.clock_timestamp(),
    phone_change = '+63918' || pg_catalog.translate(
      pg_catalog.right(pg_catalog.replace(auth_user.id::text, '-', ''), 7),
      'abcdef',
      '012345'
    ),
    phone_change_token = 'phone-secret-' || auth_user.id::text,
    phone_change_sent_at = pg_catalog.clock_timestamp(),
    email_change = 'old-personal-' || auth_user.id::text || '@example.com',
    email_change_token_new = 'new-secret-' || auth_user.id::text,
    email_change_token_current = 'current-secret-' || auth_user.id::text,
    email_change_sent_at = pg_catalog.clock_timestamp(),
    email_change_confirm_status = 1,
    confirmation_token = 'confirm-secret-' || auth_user.id::text,
    confirmation_sent_at = pg_catalog.clock_timestamp(),
    recovery_token = 'recovery-secret-' || auth_user.id::text,
    recovery_sent_at = pg_catalog.clock_timestamp(),
    reauthentication_token = 'reauth-secret-' || auth_user.id::text,
    reauthentication_sent_at = pg_catalog.clock_timestamp()
where auth_user.id in (
  'b10b0000-0000-4000-8000-000000000002',
  'b10b0000-0000-4000-8000-000000000003',
  'b10b0000-0000-4000-8000-000000000004',
  'b10b0000-0000-4000-8000-000000000007',
  'b10b0000-0000-4000-8000-000000000008',
  'b10b0000-0000-4000-8000-000000000009',
  'b10b0000-0000-4000-8000-00000000000a'
);
update auth.users
set banned_until = null
where id = 'b10b0000-0000-4000-8000-000000000007';
update auth.users
set email = 'still-personal@test.local'
where id = 'b10b0000-0000-4000-8000-000000000008';

-- Every inserted (provider_id, provider) pair is unique. The final two rows do
-- not collide at insert time: cleanup later tries to rewrite collision-old to
-- the other user's provider_id, which is the deliberate CMI10 guard fixture.
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  created_at, updated_at, last_sign_in_at
) values
  ('c10b0000-0000-4000-8000-000000000001', 'b10b0000-0000-4000-8000-000000000002', '{"sub":"google-1","email":"p1b-standard@test.local","name":"Personal Name","picture":"https://example.com/p.jpg"}', 'google', 'google-1', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('c10b0000-0000-4000-8000-000000000002', 'b10b0000-0000-4000-8000-000000000002', '{"sub":"old-email-1","email":"p1b-standard@test.local","email_verified":true,"phone_verified":false}', 'email', 'old-email-1', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('c10b0000-0000-4000-8000-000000000003', 'b10b0000-0000-4000-8000-000000000003', '{"sub":"google-3","email":"p1b-zero@test.local"}', 'google', 'google-3', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('c10b0000-0000-4000-8000-000000000004', 'b10b0000-0000-4000-8000-000000000009', '{"sub":"multi-1","email":"one@test.local"}', 'email', 'multi-1', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('c10b0000-0000-4000-8000-000000000005', 'b10b0000-0000-4000-8000-000000000009', '{"sub":"multi-2","email":"two@test.local"}', 'email', 'multi-2', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('c10b0000-0000-4000-8000-000000000006', 'b10b0000-0000-4000-8000-00000000000a', '{"sub":"collision-old","email":"p1b-collision@test.local"}', 'email', 'collision-old', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('c10b0000-0000-4000-8000-000000000007', 'b10b0000-0000-4000-8000-00000000000b', '{"sub":"b10b0000-0000-4000-8000-00000000000a","email":"p1b-collision-owner@test.local"}', 'email', 'b10b0000-0000-4000-8000-00000000000a', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  'd10b0000-0000-4000-8000-000000000001',
  'b10b0000-0000-4000-8000-000000000002',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
insert into auth.refresh_tokens (
  token, user_id, revoked, created_at, updated_at, session_id
) values (
  'p1b-refresh-token',
  'b10b0000-0000-4000-8000-000000000002'::text,
  false, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
  'd10b0000-0000-4000-8000-000000000001'
);

select pg_catalog.set_config(
  'ceit_connect.p1b_auth_baseline',
  (
    select pg_catalog.jsonb_build_object(
      'id', id,
      'encrypted_password', encrypted_password,
      'email_confirmed_at', email_confirmed_at,
      'banned_until', banned_until,
      'created_at', created_at,
      'updated_at', updated_at,
      'last_sign_in_at', last_sign_in_at,
      'invited_at', invited_at
    )::text
    from auth.users
    where id = 'b10b0000-0000-4000-8000-000000000002'
  ),
  true
);

select pg_temp.p1b_query('S03_AUTH_PRECONDITION_READY', $$
  select email = id::text || '@former.invalid'
     and email_confirmed_at is not null
     and banned_until > pg_catalog.clock_timestamp()
  from auth.users
  where id = 'b10b0000-0000-4000-8000-000000000002'
$$);

set local role service_role;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b10b0000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select pg_temp.p1b_query('S04_CLEANED_ONE_EMAIL_RESULT', $$
  select out_user_id = 'b10b0000-0000-4000-8000-000000000002'
     and out_outcome = 'cleaned'
     and out_email_identity_count = 1
  from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000002')
$$);
reset role;

select pg_temp.p1b_query('S05_PROTECTED_AUTH_CORE_PRESERVED', $$
  select current_row.id::text = baseline.value ->> 'id'
     and current_row.email = current_row.id::text || '@former.invalid'
     and current_row.email_confirmed_at =
       (baseline.value ->> 'email_confirmed_at')::timestamptz
     and current_row.banned_until =
       (baseline.value ->> 'banned_until')::timestamptz
     and current_row.encrypted_password =
       baseline.value ->> 'encrypted_password'
  from auth.users as current_row
  cross join lateral (
    select pg_catalog.current_setting(
      'ceit_connect.p1b_auth_baseline', true
    )::jsonb as value
  ) as baseline
  where current_row.id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S06_OPERATIONAL_TIMESTAMPS_PRESERVED', $$
  select current_row.created_at =
       (baseline.value ->> 'created_at')::timestamptz
     and current_row.updated_at =
       (baseline.value ->> 'updated_at')::timestamptz
     and current_row.last_sign_in_at is not distinct from
       (baseline.value ->> 'last_sign_in_at')::timestamptz
     and current_row.invited_at is not distinct from
       (baseline.value ->> 'invited_at')::timestamptz
  from auth.users as current_row
  cross join lateral (
    select pg_catalog.current_setting(
      'ceit_connect.p1b_auth_baseline', true
    )::jsonb as value
  ) as baseline
  where current_row.id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S07_USER_METADATA_EMPTY', $$
  select raw_user_meta_data = '{}'::jsonb
  from auth.users where id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S08_APP_METADATA_EMAIL_ONLY', $$
  select raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb
  from auth.users where id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S09_PHONE_STATE_CLEARED', $$
  select phone is null and coalesce(phone_change, '') = ''
     and coalesce(phone_change_token, '') = ''
     and phone_confirmed_at is null and phone_change_sent_at is null
  from auth.users where id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S10_EMAIL_CHANGE_STATE_CLEARED', $$
  select coalesce(email_change, '') = ''
     and coalesce(email_change_token_new, '') = ''
     and coalesce(email_change_token_current, '') = ''
     and email_change_sent_at is null
     and email_change_confirm_status = 0
  from auth.users where id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S11_OTHER_AUTH_TOKENS_CLEARED', $$
  select coalesce(confirmation_token, '') = '' and confirmation_sent_at is null
     and coalesce(recovery_token, '') = '' and recovery_sent_at is null
     and coalesce(reauthentication_token, '') = ''
     and reauthentication_sent_at is null
  from auth.users where id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S12_NON_EMAIL_IDENTITIES_DELETED', $$
  select not exists (
    select 1 from auth.identities
    where user_id = 'b10b0000-0000-4000-8000-000000000002'
      and provider <> 'email'
  )
$$);
select pg_temp.p1b_query('S13_EMAIL_IDENTITY_CANONICAL', $$
  select provider_id = user_id::text
     and identity_data = pg_catalog.jsonb_build_object(
       'sub', user_id::text,
       'email', user_id::text || '@former.invalid',
       'email_verified', true,
       'phone_verified', false
     )
  from auth.identities
  where user_id = 'b10b0000-0000-4000-8000-000000000002'
    and provider = 'email'
$$);
select pg_temp.p1b_query('S14_EMAIL_IDENTITY_COUNT_ONE', $$
  select count(*) = 1 from auth.identities
  where user_id = 'b10b0000-0000-4000-8000-000000000002'
$$);
select pg_temp.p1b_query('S15_SESSIONS_AND_REFRESH_TOKENS_DELETED', $$
  select not exists (
    select 1 from auth.sessions
    where user_id = 'b10b0000-0000-4000-8000-000000000002'
  ) and not exists (
    select 1 from auth.refresh_tokens
    where user_id = 'b10b0000-0000-4000-8000-000000000002'::text
  )
$$);
select pg_temp.p1b_query('S16_MFA_FACTORS_DELETED_IF_PRESENT', $$
  select pg_temp.p1b_optional_count(
    'mfa_factors', 'b10b0000-0000-4000-8000-000000000002'
  ) = 0
$$);
select pg_temp.p1b_query('S17_ONE_TIME_TOKENS_DELETED_IF_PRESENT', $$
  select pg_temp.p1b_optional_count(
    'one_time_tokens', 'b10b0000-0000-4000-8000-000000000002'
  ) = 0
$$);
select pg_temp.p1b_query('S18_FLOW_STATE_DELETED_IF_PRESENT', $$
  select pg_temp.p1b_optional_count(
    'flow_state', 'b10b0000-0000-4000-8000-000000000002'
  ) = 0
$$);
select pg_temp.p1b_query('S19_PUBLIC_TERMINAL_STATE_UNCHANGED', $$
  select not is_active and anonymized_at is not null
     and full_name = 'Former member'
     and email = id::text || '@former.invalid'
  from public.users where id = 'b10b0000-0000-4000-8000-000000000002'
$$);

set local role service_role;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b10b0000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select pg_temp.p1b_query('Z01_ZERO_EMAIL_RESULT', $$
  select out_outcome = 'cleaned' and out_email_identity_count = 0
  from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000003')
$$);
reset role;
select pg_temp.p1b_query('Z02_ZERO_EMAIL_NOT_MANUFACTURED', $$
  select count(*) = 0 from auth.identities
  where user_id = 'b10b0000-0000-4000-8000-000000000003'
$$);
select pg_temp.p1b_query('Z03_ZERO_EMAIL_METADATA_CLEAN', $$
  select raw_user_meta_data = '{}'::jsonb
     and raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb
  from auth.users where id = 'b10b0000-0000-4000-8000-000000000003'
$$);

set local role service_role;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b10b0000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select pg_temp.p1b_query('R01_IDEMPOTENT_RETRY_RESULT', $$
  select out_outcome = 'cleaned' and out_email_identity_count = 1
  from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000002')
$$);
reset role;
select pg_temp.p1b_query('R02_IDEMPOTENT_RETRY_STATE', $$
  select raw_user_meta_data = '{}'::jsonb
     and raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb
     and (
       select count(*) from auth.identities as identity
       where identity.user_id = auth_user.id
     ) = 1
  from auth.users as auth_user
  where id = 'b10b0000-0000-4000-8000-000000000002'
$$);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b10b0000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select pg_temp.p1b_probe_unchanged(
  'G01_WRONG_ROLE_CMI01_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000004')$$,
  'CMI01', 'b10b0000-0000-4000-8000-000000000004'
);

set local role service_role;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"b10b0000-0000-4000-8000-000000000001","role":"service_role"}',
  true
);
select pg_temp.p1b_probe_unchanged(
  'G02_ACTIVE_TARGET_CMI03_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000005')$$,
  'CMI03', 'b10b0000-0000-4000-8000-000000000005'
);
select pg_temp.p1b_probe_unchanged(
  'G03_NOT_ANONYMIZED_CMI04_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000006')$$,
  'CMI04', 'b10b0000-0000-4000-8000-000000000006'
);
select pg_temp.p1b_probe_unchanged(
  'G04_UNBANNED_CMI08_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000007')$$,
  'CMI08', 'b10b0000-0000-4000-8000-000000000007'
);
select pg_temp.p1b_probe_unchanged(
  'G05_WRONG_EMAIL_CMI06_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000008')$$,
  'CMI06', 'b10b0000-0000-4000-8000-000000000008'
);
select pg_temp.p1b_probe_unchanged(
  'G06_MULTIPLE_EMAIL_CMI09_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-000000000009')$$,
  'CMI09', 'b10b0000-0000-4000-8000-000000000009'
);
select pg_temp.p1b_probe_unchanged(
  'G07_PROVIDER_COLLISION_CMI10_UNCHANGED',
  $$select * from public.cleanup_former_member_auth('b10b0000-0000-4000-8000-00000000000a')$$,
  'CMI10', 'b10b0000-0000-4000-8000-00000000000a'
);
reset role;

select pg_temp.p1b_record(
  'F01_EXACT_RESULT_COUNT',
  pg_catalog.current_setting('ceit_connect.p1b_count', true)::integer = 41
);

do $$
declare
  v_count integer := pg_catalog.current_setting(
    'ceit_connect.p1b_count', true
  )::integer;
  v_results text := pg_catalog.current_setting(
    'ceit_connect.p1b_results', true
  );
begin
  if v_count <> 42 then
    raise exception 'TEST DEFINITION ERROR: expected 42 lines, got %', v_count;
  end if;
  raise exception E'TEST RESULTS (42 lines)\n%', v_results;
end;
$$;

rollback;
```
