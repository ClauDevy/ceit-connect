# Step 14 Part 2: session invalidation Dev verification

Run this paste in the Dev SQL Editor as `postgres` after applying
`20261109123000_revoke_inactive_user_sessions.sql`. It is rollback-only. The
final exception is the success sentinel and must say
`TEST RESULTS: 13/13 PASS — transaction intentionally rolled back`.

```sql
begin;
set local statement_timeout = '120s';

create temporary table batch_14_part_2_results (
  seq integer generated always as identity,
  label text not null,
  passed boolean not null
) on commit drop;
grant insert on batch_14_part_2_results to authenticated;
grant usage, select on sequence batch_14_part_2_results_seq_seq to authenticated;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  banned_until, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1420000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'b142-session@test.local', '', now(),
  now() + interval '100 years',
  '{"provider":"email","providers":["email"]}',
  '{"display_name":"Session Fixture"}', now(), now()
);
insert into auth.identities (
  id, user_id, identity_data, provider, provider_id,
  created_at, updated_at, last_sign_in_at
) values (
  'c1420000-0000-4000-8000-000000000001',
  'b1420000-0000-4000-8000-000000000001',
  '{"sub":"b1420000-0000-4000-8000-000000000001","email":"b142-session@test.local","email_verified":true,"phone_verified":false}',
  'email', 'b142-session@test.local', now(), now(), now()
);
insert into public.committees(id,name)
values ('b142c000-0000-4000-8000-000000000001','B14 Part 2');
insert into public.users(id,email,full_name,role,committee_id,is_active)
values (
  'b1420000-0000-4000-8000-000000000001',
  'b142-session@test.local', 'B14 Session Fixture', 'Member',
  'b142c000-0000-4000-8000-000000000001', false
);
insert into auth.sessions(id,user_id,created_at,updated_at)
values (
  'd1420000-0000-4000-8000-000000000001',
  'b1420000-0000-4000-8000-000000000001', now(), now()
);
insert into auth.refresh_tokens(token,user_id,revoked,created_at,updated_at,session_id)
values (
  'b142-refresh-token',
  'b1420000-0000-4000-8000-000000000001', false, now(), now(),
  'd1420000-0000-4000-8000-000000000001'
);

insert into batch_14_part_2_results(label,passed)
select 'function owner is postgres',pg_get_userbyid(proowner)='postgres'
from pg_proc where oid='public.revoke_inactive_user_sessions(uuid)'::regprocedure;

insert into batch_14_part_2_results(label,passed)
select 'function is volatile',provolatile='v'
from pg_proc where oid='public.revoke_inactive_user_sessions(uuid)'::regprocedure;

insert into batch_14_part_2_results(label,passed)
select 'function is security definer',prosecdef
from pg_proc where oid='public.revoke_inactive_user_sessions(uuid)'::regprocedure;

insert into batch_14_part_2_results(label,passed)
select 'function has an empty search path',proconfig=array['search_path=""']
from pg_proc where oid='public.revoke_inactive_user_sessions(uuid)'::regprocedure;

insert into batch_14_part_2_results(label,passed)
select 'exact exposed-role grant is service_role only',
  has_function_privilege('service_role',oid,'EXECUTE')
  and not has_function_privilege('public',oid,'EXECUTE')
  and not has_function_privilege('anon',oid,'EXECUTE')
  and not has_function_privilege('authenticated',oid,'EXECUTE')
  and (
    select count(*)=1
      and bool_and(
        acl.grantee='service_role'::regrole
        and acl.grantor='postgres'::regrole
        and not acl.is_grantable
      )
    from aclexplode(coalesce(pg_proc.proacl,acldefault('f',pg_proc.proowner))) acl
    where acl.privilege_type='EXECUTE' and acl.grantee<>pg_proc.proowner
  )
from pg_proc where oid='public.revoke_inactive_user_sessions(uuid)'::regprocedure;

insert into batch_14_part_2_results(label,passed)
select 'function has no overloads',count(*)=1
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='revoke_inactive_user_sessions';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1420000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare rejected boolean:=false;
begin
  begin
    perform public.revoke_inactive_user_sessions('b1420000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then
    rejected:=true;
  end;
  insert into batch_14_part_2_results(label,passed)
  values ('authenticated caller is denied',rejected);
end $$;
reset role;

set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config(
  'b142.cleanup_result',
  (select out_user_id::text||':'||out_outcome
   from public.revoke_inactive_user_sessions('b1420000-0000-4000-8000-000000000001')),
  true
);
reset role;

insert into batch_14_part_2_results(label,passed)
select 'cleanup returns the exact target and outcome',
  current_setting('b142.cleanup_result')='b1420000-0000-4000-8000-000000000001:revoked';
insert into batch_14_part_2_results(label,passed)
select 'all Auth sessions are removed',not exists(
  select 1 from auth.sessions where user_id='b1420000-0000-4000-8000-000000000001'
);
insert into batch_14_part_2_results(label,passed)
select 'all refresh tokens are removed',not exists(
  select 1 from auth.refresh_tokens where user_id='b1420000-0000-4000-8000-000000000001'
);
insert into batch_14_part_2_results(label,passed)
select 'Auth identity is preserved',count(*)=1
from auth.identities where user_id='b1420000-0000-4000-8000-000000000001';
insert into batch_14_part_2_results(label,passed)
select 'ordinary Auth metadata is preserved',
  raw_user_meta_data='{"display_name":"Session Fixture"}'::jsonb
  and raw_app_meta_data='{"provider":"email","providers":["email"]}'::jsonb
from auth.users where id='b1420000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1420000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into batch_14_part_2_results(label,passed)
select 'old access token has no active app role',public.my_role() is null;
reset role;

do $$
declare failures text;
begin
  select string_agg(label,', ' order by seq) into failures
  from batch_14_part_2_results where not passed;
  if (select count(*) from batch_14_part_2_results)<>13 or failures is not null then
    raise exception 'Batch 14 Part 2 failed. Expected 13 rows. Failing labels: %',
      coalesce(failures,'result-line count');
  end if;
end $$;
do $$ begin raise exception 'TEST RESULTS: 13/13 PASS — transaction intentionally rolled back'; end $$;
```

The application test suite separately pins that an old authenticated cookie is
still rejected with `403` when its profile is inactive, even during the short
remaining lifetime of its access JWT. The database paste proves that the same
account cannot refresh that session afterward.
