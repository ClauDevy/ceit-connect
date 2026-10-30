# Step 10 Stage A SQL tests

Run this paste on **Dev only**, after reviewing and applying
`20261027150000_former_member_anonymization.sql`. In the Supabase SQL editor,
choose **Run without RLS**. The paste owns all of its Auth/profile fixtures,
uses no temporary table, and ends with an intentional `TEST RESULTS`
exception so the whole transaction is rolled back.

Expected result: exactly **190 result lines**:

- 20 schema and users-guard lines.
- 24 function catalog, ownership, search-path, and grant lines.
- 12 raw users-guard lines.
- 36 officer/member transition and finalizer lines.
- 23 A1 lock, writer-inventory, hardening, and caller-parity lines.
- 16 preview authorization/input/shape lines.
- 18 open-task matrix lines.
- 8 eligibility-order lines.
- 18 anonymization, preservation, and re-invite lines.
- 5 permanent activation-denial lines.
- 10 marker-cleanup, sequential-race, and orphan-save lines.

The one live-catalog result line simultaneously pins the eight broad matches,
the six true writers, and proves that `move_task` and
`set_task_backup_request` contain no assignment to either assignee array.
The two-session races are represented by function-body/catalog assertions and
sequential simulations of both possible committed winners because the SQL
editor cannot hold two sessions.

## One rollback-safe SQL paste

```sql
begin;

select pg_catalog.set_config('ceit_connect.step10_count', '0', true);
select pg_catalog.set_config('ceit_connect.step10_results', '', true);

create function pg_temp.step10_record(
  p_label text,
  p_ok boolean,
  p_override text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := coalesce(
    nullif(pg_catalog.current_setting('ceit_connect.step10_count', true), ''),
    '0'
  )::integer + 1;
  v_outcome text := coalesce(
    p_override,
    case when p_ok then 'PASS' else 'FAIL' end
  );
  v_prior text := coalesce(
    pg_catalog.current_setting('ceit_connect.step10_results', true),
    ''
  );
begin
  perform pg_catalog.set_config(
    'ceit_connect.step10_count', v_count::text, true
  );
  perform pg_catalog.set_config(
    'ceit_connect.step10_results',
    v_prior
      || case when v_prior = '' then '' else pg_catalog.chr(10) end
      || pg_catalog.lpad(v_count::text, 3, '0')
      || ' ' || p_label || ': ' || v_outcome,
    true
  );
end;
$$;

create function pg_temp.step10_probe(
  p_label text,
  p_sql text,
  p_expect_success boolean,
  p_expected_sqlstate text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_succeeded boolean := false;
  v_sqlstate text;
begin
  begin
    execute p_sql;
    raise exception using
      errcode = 'P1000', message = 'rollback successful probe';
  exception
    when sqlstate 'P1000' then
      v_succeeded := true;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;

  perform pg_temp.step10_record(
    p_label,
    v_succeeded = p_expect_success
      and (
        p_expect_success
        or p_expected_sqlstate is null
        or v_sqlstate = p_expected_sqlstate
      ),
    case
      when v_succeeded = p_expect_success
       and (p_expect_success or p_expected_sqlstate is null
            or v_sqlstate = p_expected_sqlstate)
        then null
      else 'FAIL (SQLSTATE ' || coalesce(v_sqlstate, 'success') || ')'
    end
  );
end;
$$;

create function pg_temp.step10_query(p_label text, p_sql text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  execute p_sql into v_ok;
  perform pg_temp.step10_record(p_label, coalesce(v_ok, false));
exception
  when others then
    perform pg_temp.step10_record(p_label, false);
end;
$$;

-- Auth fixtures. The original removed address belongs to ...0009; ...0020 is
-- the later, brand-new Auth UUID used by the re-invite test.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, invited_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture.id,
       '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', fixture.email, '',
       fixture.confirmed_at, fixture.invited_at, fixture.last_sign_in_at,
       '{}', '{}', pg_catalog.now(), pg_catalog.now()
from (values
  ('a2100000-0000-4000-8000-000000000001'::uuid,'a2-admin@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000002'::uuid,'a2-admin2@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000003'::uuid,'a2-co-own@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000004'::uuid,'a2-co-other@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000005'::uuid,'a2-member@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000006'::uuid,'a2-inactive-admin@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000007'::uuid,'a2-inactive-co@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000008'::uuid,'a2-eligible@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-000000000009'::uuid,'a2-original@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-00000000000a'::uuid,'a2-open@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-00000000000b'::uuid,'a2-race-assign@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now()),
  ('a2100000-0000-4000-8000-00000000000c'::uuid,'a2-race-remove@test.local',pg_catalog.now(),null::timestamptz,pg_catalog.now())
) as fixture(id,email,confirmed_at,invited_at,last_sign_in_at);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('a2101000-0000-4000-8000-' || pg_catalog.lpad(i::text,12,'0'))::uuid,
       '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated',
       'a2-matrix-' || i || '@test.local', '', pg_catalog.now(),
       '{}', '{}', pg_catalog.now(), pg_catalog.now()
from pg_catalog.generate_series(1,18) as series(i);

do $$
declare
  v_c1 uuid;
  v_c2 uuid;
begin
  select committee.id into v_c1
  from public.committees as committee order by committee.name, committee.id limit 1;
  select committee.id into v_c2
  from public.committees as committee order by committee.name, committee.id offset 1 limit 1;

  if v_c1 is null or v_c2 is null then
    raise exception 'TEST FIXTURE ERROR: two committees are required.';
  end if;

  select pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    ('a2100000-0000-4000-8000-000000000001','a2-admin@test.local','A2 Admin','Admin',null,true),
    ('a2100000-0000-4000-8000-000000000002','a2-admin2@test.local','A2 Admin Two','Admin',null,true),
    ('a2100000-0000-4000-8000-000000000003','a2-co-own@test.local','A2 Co Own','Co-Admin',v_c1,true),
    ('a2100000-0000-4000-8000-000000000004','a2-co-other@test.local','A2 Co Other','Co-Admin',v_c2,true),
    ('a2100000-0000-4000-8000-000000000006','a2-inactive-admin@test.local','A2 Inactive Admin','Admin',null,false),
    ('a2100000-0000-4000-8000-000000000007','a2-inactive-co@test.local','A2 Inactive Co','Co-Admin',v_c1,false);
  select pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users(id,email,full_name,role,committee_id,is_active,avatar_url,discord_id) values
    ('a2100000-0000-4000-8000-000000000005','a2-member@test.local','A2 Member','Member',v_c1,true,null,null),
    ('a2100000-0000-4000-8000-000000000008','a2-eligible@test.local','A2 Eligible','Member',v_c1,false,'avatars/a2.png','a2-discord'),
    ('a2100000-0000-4000-8000-000000000009','a2-original@test.local','A2 Original','Member',v_c1,false,'avatars/original.png','original-discord'),
    ('a2100000-0000-4000-8000-00000000000a','a2-open@test.local','A2 Open','Member',v_c1,false,null,null),
    ('a2100000-0000-4000-8000-00000000000b','a2-race-assign@test.local','A2 Race Assign','Member',v_c1,false,null,null),
    ('a2100000-0000-4000-8000-00000000000c','a2-race-remove@test.local','A2 Race Remove','Member',v_c1,false,null,null);

  insert into public.users(id,email,full_name,role,committee_id,is_active)
  select ('a2101000-0000-4000-8000-' || pg_catalog.lpad(i::text,12,'0'))::uuid,
         'a2-matrix-' || i || '@test.local', 'A2 Matrix ' || i,
         'Member', v_c1, false
  from pg_catalog.generate_series(1,18) as series(i);
end $$;

-- Three parent lifecycles and the full 2 x 3 x 3 open-task matrix.
insert into public.events(id,name,start_date,end_date,status,created_by) values
  ('a2102000-0000-4000-8000-000000000001','A2 Draft',current_date,current_date,'Draft','a2100000-0000-4000-8000-000000000001'),
  ('a2102000-0000-4000-8000-000000000002','A2 Active',current_date,current_date,'Draft','a2100000-0000-4000-8000-000000000001'),
  ('a2102000-0000-4000-8000-000000000003','A2 Archived',current_date,current_date,'Draft','a2100000-0000-4000-8000-000000000001'),
  ('a2102000-0000-4000-8000-000000000004','A2 Orphan Save',current_date,current_date,'Draft','a2100000-0000-4000-8000-000000000001'),
  ('a2102000-0000-4000-8000-000000000005','A2 Race',current_date,current_date,'Draft','a2100000-0000-4000-8000-000000000001');

do $$
declare
  v_c1 uuid;
  v_parent integer;
  v_status integer;
  v_side integer;
  v_i integer := 0;
  v_user_id uuid;
begin
  select committee.id into v_c1
  from public.committees as committee order by committee.name, committee.id limit 1;
  perform pg_catalog.set_config(
    'ceit_connect.task_assignee_writer', 'edit_event_with_tasks', true
  );
  for v_parent in 1..3 loop
    for v_status in 1..3 loop
      for v_side in 1..2 loop
        v_i := v_i + 1;
        v_user_id := (
          'a2101000-0000-4000-8000-'
          || pg_catalog.lpad(v_i::text,12,'0')
        )::uuid;
        insert into public.tasks(
          id,event_id,committee_id,title,phase,status,priority,task_type,
          primary_assignees,assist_assignees,allowed_viewers,created_by,sort_order
        ) values (
          ('a2103000-0000-4000-8000-' || pg_catalog.lpad(v_i::text,12,'0'))::uuid,
          ('a2102000-0000-4000-8000-' || pg_catalog.lpad(v_parent::text,12,'0'))::uuid,
          v_c1,'A2 Matrix Task ' || v_i,'Matrix',
          (array['To Do','In Progress','Completed'])[v_status],
          'Medium','Deliverable',
          case when v_side=1 then array[v_user_id] else '{}'::uuid[] end,
          case when v_side=2 then array[v_user_id] else '{}'::uuid[] end,
          '{}'::uuid[],'a2100000-0000-4000-8000-000000000001',v_i
        );
      end loop;
    end loop;
  end loop;

  -- One ordinary open task for the named blocker and race fixtures.
  insert into public.tasks(
    id,event_id,committee_id,title,phase,status,priority,task_type,
    primary_assignees,assist_assignees,allowed_viewers,created_by,sort_order
  ) values (
    'a2103000-0000-4000-8000-000000000100',
    'a2102000-0000-4000-8000-000000000005',v_c1,'A2 Open Task','Race','To Do','Medium','Deliverable',
    array['a2100000-0000-4000-8000-00000000000a'::uuid],
    '{}'::uuid[],'{}'::uuid[],'a2100000-0000-4000-8000-000000000001',100
  );

  -- The only deliberate orphan UUID in any assignee fixture.
  insert into public.tasks(
    id,event_id,committee_id,title,phase,status,priority,task_type,
    primary_assignees,assist_assignees,allowed_viewers,created_by,sort_order
  ) values (
    'a2103000-0000-4000-8000-000000000101',
    'a2102000-0000-4000-8000-000000000004',v_c1,'A2 Orphan Task','Orphan','To Do','Medium','Deliverable',
    array['a2100000-0000-4000-8000-000000000005'::uuid],
    array['a210ffff-ffff-4fff-8fff-ffffffffffff'::uuid],
    '{}'::uuid[],'a2100000-0000-4000-8000-000000000001',101
  );
  perform pg_catalog.set_config('ceit_connect.task_assignee_writer', '', true);
end $$;

update public.events set status='Active'
where id in (
  'a2102000-0000-4000-8000-000000000002',
  'a2102000-0000-4000-8000-000000000003'
);
update public.events set status='Archived'
where id='a2102000-0000-4000-8000-000000000003';
set constraints all immediate;

-- 1-20: schema and users guard.
do $$
declare
  v_check record;
begin
  for v_check in
    select * from (values
      ('S01_ANONYMIZED_COLUMN', exists(select 1 from information_schema.columns where table_schema='public' and table_name='users' and column_name='anonymized_at' and data_type='timestamp with time zone' and is_nullable='YES')),
      ('S02_TERMINAL_CONSTRAINT_NAMED', exists(select 1 from pg_catalog.pg_constraint where conrelid='public.users'::regclass and conname='users_anonymized_terminal_state_check' and contype='c')),
      ('S03_TERMINAL_REQUIRES_INACTIVE', pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conrelid='public.users'::regclass and conname='users_anonymized_terminal_state_check')) ~ 'is_active IS FALSE'),
      ('S04_TERMINAL_REQUIRES_NAME', pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conrelid='public.users'::regclass and conname='users_anonymized_terminal_state_check')) ~ 'Former member'),
      ('S05_TERMINAL_REQUIRES_EMAIL', pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conrelid='public.users'::regclass and conname='users_anonymized_terminal_state_check')) ~ 'former.invalid'),
      ('S06_TERMINAL_REQUIRES_AVATAR_NULL', pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conrelid='public.users'::regclass and conname='users_anonymized_terminal_state_check')) ~ 'avatar_url IS NULL'),
      ('S07_TERMINAL_REQUIRES_DISCORD_NULL', pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conrelid='public.users'::regclass and conname='users_anonymized_terminal_state_check')) ~ 'discord_id IS NULL'),
      ('S08_GUARD_TRIGGER_ONCE', (select pg_catalog.count(*)=1 from pg_catalog.pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and not tgisinternal)),
      ('S09_GUARD_BEFORE_INSERT', (select (tgtype & 2)=2 and (tgtype & 4)=4 from pg_catalog.pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and not tgisinternal)),
      ('S10_GUARD_BEFORE_UPDATE', (select (tgtype & 2)=2 and (tgtype & 16)=16 from pg_catalog.pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and not tgisinternal)),
      ('S11_GUARD_BEFORE_DELETE', (select (tgtype & 2)=2 and (tgtype & 8)=8 from pg_catalog.pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and not tgisinternal)),
      ('S12_GUARD_OWNER_POSTGRES', (select pg_catalog.pg_get_userbyid(proowner)='postgres' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S13_GUARD_INVOKER', (select not prosecdef from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S14_GUARD_EMPTY_PATH', (select coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S15_GUARD_HAS_FORMER_MARKER', (select prosrc ~ 'ceit_connect[.]former_member_writer' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S16_GUARD_MARKER_EXACT', (select prosrc ~ 'anonymize_former_member' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S17_GUARD_REACTIVATION_UNCONDITIONAL', (select prosrc ~ 'old[.]anonymized_at is not null' and prosrc ~ 'new[.]is_active is true' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S18_GUARD_TIMESTAMP_IMMUTABLE', (select prosrc ~ 'new[.]anonymized_at is distinct from old[.]anonymized_at' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S19_GUARD_ROLE_HISTORY', (select prosrc ~ 'new[.]role is distinct from old[.]role' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('S20_GUARD_COMMITTEE_HISTORY', (select prosrc ~ 'new[.]committee_id is distinct from old[.]committee_id' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure))
    ) as checks(label,ok)
  loop
    perform pg_temp.step10_record(v_check.label, coalesce(v_check.ok,false));
  end loop;
end $$;
-- 21-44: function catalogs, ownership, paths, and grants.
do $$
declare
  v_check record;
begin
  for v_check in
    select * from (values
      ('F01_ELIGIBILITY_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and provolatile='s' and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.former_member_eligibility(uuid)'::regprocedure)),
      ('F02_PREVIEW_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and provolatile='s' and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.preview_former_member_removal(uuid[])'::regprocedure)),
      ('F03_ANONYMIZE_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and provolatile='v' and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure)),
      ('F04_APPOINT_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure)),
      ('F05_RETURN_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.return_coadmin_to_member(uuid,uuid)'::regprocedure)),
      ('F06_MOVE_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.move_member_to_committee(uuid,uuid)'::regprocedure)),
      ('F07_SET_ACTIVE_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.set_officer_active(uuid,boolean)'::regprocedure)),
      ('F08_REACTIVATE_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.reactivate_committee_member(uuid)'::regprocedure)),
      ('F09_NAME_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.update_committee_member_full_name(uuid,text)'::regprocedure)),
      ('F10_GUARD_METADATA', (select pg_catalog.pg_get_userbyid(proowner)='postgres' and not prosecdef and coalesce(proconfig,'{}'::text[]) @> array['search_path=""'] from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('F11_HELPER_PRIVATE', not has_function_privilege('authenticated','public.former_member_eligibility(uuid)','EXECUTE') and not has_function_privilege('anon','public.former_member_eligibility(uuid)','EXECUTE')),
      ('F12_PREVIEW_AUTH_ONLY', has_function_privilege('authenticated','public.preview_former_member_removal(uuid[])','EXECUTE') and not has_function_privilege('anon','public.preview_former_member_removal(uuid[])','EXECUTE')),
      ('F13_ANONYMIZE_AUTH_ONLY', has_function_privilege('authenticated','public.anonymize_former_member(uuid)','EXECUTE') and not has_function_privilege('anon','public.anonymize_former_member(uuid)','EXECUTE')),
      ('F14_APPOINT_AUTH_ONLY', has_function_privilege('authenticated','public.appoint_member_as_officer(uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.appoint_member_as_officer(uuid,text,uuid)','EXECUTE')),
      ('F15_RETURN_AUTH_ONLY', has_function_privilege('authenticated','public.return_coadmin_to_member(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.return_coadmin_to_member(uuid,uuid)','EXECUTE')),
      ('F16_MOVE_AUTH_ONLY', has_function_privilege('authenticated','public.move_member_to_committee(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.move_member_to_committee(uuid,uuid)','EXECUTE')),
      ('F17_SET_ACTIVE_AUTH_ONLY', has_function_privilege('authenticated','public.set_officer_active(uuid,boolean)','EXECUTE') and not has_function_privilege('anon','public.set_officer_active(uuid,boolean)','EXECUTE')),
      ('F18_REACTIVATE_AUTH_ONLY', has_function_privilege('authenticated','public.reactivate_committee_member(uuid)','EXECUTE') and not has_function_privilege('anon','public.reactivate_committee_member(uuid)','EXECUTE')),
      ('F19_NAME_AUTH_ONLY', has_function_privilege('authenticated','public.update_committee_member_full_name(uuid,text)','EXECUTE') and not has_function_privilege('anon','public.update_committee_member_full_name(uuid,text)','EXECUTE')),
      ('F20_PREVIEW_USES_AUTH_UID', (select prosrc ~ 'auth[.]uid[(][)]' from pg_catalog.pg_proc where oid='public.preview_former_member_removal(uuid[])'::regprocedure)),
      ('F21_ANONYMIZE_USES_AUTH_UID', (select prosrc ~ 'auth[.]uid[(][)]' from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure)),
      ('F22_CMR_PREFIX_COMPLETE', (select prosrc ~ 'CMR01' and prosrc ~ 'CMR02' and prosrc ~ 'CMR03' and prosrc ~ 'CMR05' from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure) and (select prosrc ~ 'CMR04' from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure)),
      ('F23_NO_CMR_COLLISION', not exists(select 1 from pg_catalog.pg_proc where pronamespace='public'::regnamespace and proname not in ('former_member_eligibility','preview_former_member_removal','anonymize_former_member','guard_officer_user_writes','appoint_member_as_officer','return_coadmin_to_member','move_member_to_committee','set_officer_active','reactivate_committee_member','update_committee_member_full_name') and prosrc ~ 'CMR0[1-5]')),
      ('F24_NO_NEW_RLS_POLICY', not exists(select 1 from pg_catalog.pg_policies where schemaname='public' and policyname ~* 'former|anonym'))
    ) as checks(label,ok)
  loop
    perform pg_temp.step10_record(v_check.label, coalesce(v_check.ok,false));
  end loop;
end $$;

-- Establish correctly formed anonymized Member and Co-Admin fixtures through
-- the real function. These setup calls are asserted in later counted lines.
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
select * from public.anonymize_former_member(
  'a2100000-0000-4000-8000-000000000009'
);
select * from public.anonymize_former_member(
  'a2100000-0000-4000-8000-000000000007'
);
reset role;

-- 45-56: raw users-guard behavior, including postgres and service_role.
select pg_temp.step10_probe('G01_POSTGRES_REACTIVATE', $$update public.users set is_active=true where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
select pg_catalog.set_config('ceit_connect.officer_writer','set_officer_active',true);
select pg_temp.step10_probe('G02_POSTGRES_OFFICER_MARKER_REACTIVATE', $$update public.users set is_active=true where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
select pg_catalog.set_config('ceit_connect.officer_writer','',true);
set local role service_role;
select pg_temp.step10_probe('G03_SERVICE_ROLE_REACTIVATE', $$update public.users set is_active=true where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
reset role;
select pg_temp.step10_probe('G04_TIMESTAMP_TO_NULL', $$update public.users set anonymized_at=null where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
select pg_temp.step10_probe('G05_TIMESTAMP_CHANGED', $$update public.users set anonymized_at=anonymized_at+interval '1 second' where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
select pg_temp.step10_probe('G06_RAW_NEW_ANON_MARKER', $$update public.users set anonymized_at=pg_catalog.clock_timestamp() where id='a2100000-0000-4000-8000-000000000008'$$, false, 'CMR04');
select pg_catalog.set_config('ceit_connect.former_member_writer','wrong_writer',true);
select pg_temp.step10_probe('G07_WRONG_FORMER_MARKER', $$update public.users set anonymized_at=pg_catalog.clock_timestamp() where id='a2100000-0000-4000-8000-000000000008'$$, false, 'CMR04');
select pg_catalog.set_config('ceit_connect.former_member_writer','',true);
select pg_temp.step10_probe('G08_INSERT_PREANONYMIZED', $$insert into public.users(id,email,full_name,role,is_active,anonymized_at) values('a210eeee-0000-4000-8000-000000000001','a210eeee-0000-4000-8000-000000000001@former.invalid','Former member','Member',false,pg_catalog.now())$$, false, 'CMR04');
select pg_temp.step10_probe('G09_CHANGE_ANON_ROLE_RAW', $$update public.users set role='Co-Admin' where id='a2100000-0000-4000-8000-000000000009'$$, false);
select pg_temp.step10_probe('G10_CHANGE_ANON_COMMITTEE_RAW', $$update public.users set committee_id=(select id from public.committees order by name,id offset 1 limit 1) where id='a2100000-0000-4000-8000-000000000009'$$, false);
select pg_temp.step10_probe('G11_BREAK_ANON_EMAIL', $$update public.users set email='changed@test.local' where id='a2100000-0000-4000-8000-000000000009'$$, false, '23514');
select pg_temp.step10_probe('G12_DELETE_STILL_DENIED', $$delete from public.users where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CCO08');

-- 57-92: transition functions and unchanged invite-finalizer boundaries.
do $$
declare
  v_function regprocedure;
  v_source text;
  v_name text;
begin
  foreach v_function in array array[
    'public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure,
    'public.return_coadmin_to_member(uuid,uuid)'::regprocedure,
    'public.move_member_to_committee(uuid,uuid)'::regprocedure,
    'public.set_officer_active(uuid,boolean)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  ] loop
    select procedure.proname, procedure.prosrc into v_name, v_source
    from pg_catalog.pg_proc as procedure where procedure.oid=v_function;
    perform pg_temp.step10_record(
      'T_EXPLICIT_CMR04_' || pg_catalog.upper(v_name),
      v_source ~ 'anonymized_at is not null' and v_source ~ 'CMR04'
    );
  end loop;

  foreach v_function in array array[
    'public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure,
    'public.return_coadmin_to_member(uuid,uuid)'::regprocedure,
    'public.move_member_to_committee(uuid,uuid)'::regprocedure,
    'public.set_officer_active(uuid,boolean)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  ] loop
    select procedure.proname, procedure.prosrc into v_name, v_source
    from pg_catalog.pg_proc as procedure where procedure.oid=v_function;
    perform pg_temp.step10_record(
      'T_FINAL_PREDICATE_' || pg_catalog.upper(v_name),
      v_source ~ 'and anonymized_at is null'
    );
  end loop;

  foreach v_function in array array[
    'public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure,
    'public.return_coadmin_to_member(uuid,uuid)'::regprocedure,
    'public.move_member_to_committee(uuid,uuid)'::regprocedure,
    'public.set_officer_active(uuid,boolean)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  ] loop
    select procedure.proname, procedure.prosrc into v_name, v_source
    from pg_catalog.pg_proc as procedure where procedure.oid=v_function;
    perform pg_temp.step10_record(
      'T_LOCK_ORDER_' || pg_catalog.upper(v_name),
      pg_catalog.strpos(v_source,'officer_advisory_lock_key') > 0
      and pg_catalog.strpos(v_source,'officer_advisory_lock_key')
        < pg_catalog.strpos(v_source,'lock_task_assignee_users')
      and pg_catalog.strpos(v_source,'lock_task_assignee_users')
        < pg_catalog.strpos(v_source,'for update')
    );
  end loop;
end $$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_probe('T19_APPOINT_REJECTS_ANON', $$select public.appoint_member_as_officer('a2100000-0000-4000-8000-000000000009','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CMR04');
select pg_temp.step10_probe('T20_RETURN_REJECTS_ANON', $$select public.return_coadmin_to_member('a2100000-0000-4000-8000-000000000007',(select id from public.committees order by name,id limit 1))$$, false, 'CMR04');
select pg_temp.step10_probe('T21_MOVE_REJECTS_ANON', $$select public.move_member_to_committee('a2100000-0000-4000-8000-000000000009',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CMR04');
select pg_temp.step10_probe('T22_SET_ACTIVE_REJECTS_ANON', $$select public.set_officer_active('a2100000-0000-4000-8000-000000000007',true)$$, false, 'CMR04');
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step10_probe('T23_REACTIVATE_REJECTS_ANON', $$select public.reactivate_committee_member('a2100000-0000-4000-8000-000000000009')$$, false, 'CMR04');
select pg_temp.step10_probe('T24_NAME_REJECTS_ANON', $$select public.update_committee_member_full_name('a2100000-0000-4000-8000-000000000009','Changed')$$, false, 'CMR04');
reset role;

do $$
declare
  v_guard text := (select prosrc from pg_catalog.pg_proc where oid='public.guard_officer_user_writes()'::regprocedure);
begin
  perform pg_temp.step10_record('T25_GUARD_REJECTS_REACTIVATION_FIRST', pg_catalog.strpos(v_guard,'new.is_active is true') < pg_catalog.strpos(v_guard,'new.role is distinct'));
  perform pg_temp.step10_record('T26_GUARD_MARKER_CANNOT_REACTIVATE', v_guard ~ 'An anonymized profile can never be reactivated');
  perform pg_temp.step10_record('T27_GUARD_ANONYMIZE_PRESERVES_ROLE', v_guard ~ 'new[.]role is distinct from old[.]role');
  perform pg_temp.step10_record('T28_GUARD_ANONYMIZE_PRESERVES_COMMITTEE', v_guard ~ 'new[.]committee_id is distinct from old[.]committee_id');
  perform pg_temp.step10_record('T29_MEMBER_FINALIZER_SIGNATURE', to_regprocedure('public.finalize_member_invite(uuid,text,text,uuid)') is not null);
  perform pg_temp.step10_record('T30_OFFICER_FINALIZER_SIGNATURE', to_regprocedure('public.invite_new_officer(uuid,uuid,text,text,text,uuid)') is not null);
  perform pg_temp.step10_record('T31_MEMBER_FINALIZER_NO_REACTIVATION', (select prosrc !~* 'update[[:space:]]+public[.]users' from pg_catalog.pg_proc where oid='public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure));
  perform pg_temp.step10_record('T32_OFFICER_FINALIZER_NEW_UUID', (select prosrc ~ 'p_auth_user_id' and prosrc ~* 'insert[[:space:]]+into[[:space:]]+public[.]users' from pg_catalog.pg_proc where oid='public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure));
  perform pg_temp.step10_record('T33_APPOINT_ROLE_RULE_PRESERVED', (select prosrc ~ 'Only an active Member can be appointed' from pg_catalog.pg_proc where oid='public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure));
  perform pg_temp.step10_record('T34_SET_ACTIVE_COADMIN_ONLY', (select prosrc ~ 'Only a Co-Admin can use' from pg_catalog.pg_proc where oid='public.set_officer_active(uuid,boolean)'::regprocedure));
  perform pg_temp.step10_record('T35_REACTIVATE_COMMITTEE_SCOPE', (select prosrc ~ 'committee_id is distinct from v_caller_committee_id' from pg_catalog.pg_proc where oid='public.reactivate_committee_member(uuid)'::regprocedure));
  perform pg_temp.step10_record('T36_NAME_COMMITTEE_SCOPE', (select prosrc ~ 'committee_id is distinct from v_caller_committee_id' from pg_catalog.pg_proc where oid='public.update_committee_member_full_name(uuid,text)'::regprocedure));
end $$;



-- 93-115: shared locks, writer inventory, hardening, and unchanged caller
-- authority for the two SECURITY DEFINER event writers.
do $$
declare
  v_broad text[];
  v_true text[];
  v_reader_sources_safe boolean;
  v_source text;
begin
  select coalesce(pg_catalog.array_agg(candidate.proname order by candidate.proname),'{}'::text[])
  into v_broad
  from (
    select distinct procedure.proname
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.prokind='f'
      and procedure.prosrc ~* '(insert[[:space:]]+into|update)[[:space:]]+public[.]tasks'
      and procedure.prosrc ~* '(primary_assignees|assist_assignees)'
  ) as candidate;

  select coalesce(pg_catalog.array_agg(candidate.proname order by candidate.proname),'{}'::text[])
  into v_true
  from (
    select procedure.proname
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public'
      and procedure.proname=any(array[
        'accept_task_volunteer','assign_task_people','claim_task',
        'create_event_with_tasks','edit_event_with_tasks','unassign_self'
      ]::text[])
  ) as candidate;

  select pg_catalog.bool_and(
    procedure.prosrc !~* 'primary_assignees[[:space:]]*='
    and procedure.prosrc !~* 'assist_assignees[[:space:]]*='
  ) into v_reader_sources_safe
  from pg_catalog.pg_proc as procedure
  where procedure.pronamespace='public'::regnamespace
    and procedure.proname in ('move_task','set_task_backup_request');

  perform pg_temp.step10_record(
    'L01_LIVE_CATALOG_8_MATCH_6_WRITE_2_READ_ONLY',
    v_broad = array[
      'accept_task_volunteer','assign_task_people','claim_task',
      'create_event_with_tasks','edit_event_with_tasks','move_task',
      'set_task_backup_request','unassign_self'
    ]::text[]
    and v_true = array[
      'accept_task_volunteer','assign_task_people','claim_task',
      'create_event_with_tasks','edit_event_with_tasks','unassign_self'
    ]::text[]
    and coalesce(v_reader_sources_safe,false)
  );

  select prosrc into v_source from pg_catalog.pg_proc
  where oid='public.lock_task_assignee_users(uuid[])'::regprocedure;
  perform pg_temp.step10_record('L02_LOCK_SORTED_UNIQUE', v_source ~ 'select distinct' and v_source ~ 'order by requested[.]user_id');
  perform pg_temp.step10_record('L03_LOCK_ONE_NAMESPACE', (select prosrc ~ 'ceit-connect:task-assignee-user:v1:' from pg_catalog.pg_proc where oid='public.task_assignee_lock_key(uuid)'::regprocedure));
  perform pg_temp.step10_record('L04_NO_PER_USER_THEN_OFFICER', not exists(select 1 from pg_catalog.pg_proc where pronamespace='public'::regnamespace and prosrc ~ 'lock_task_assignee_users' and prosrc ~ 'officer_advisory_lock_key' and pg_catalog.strpos(prosrc,'lock_task_assignee_users') < pg_catalog.strpos(prosrc,'officer_advisory_lock_key')));
  perform pg_temp.step10_record('L05_ANONYMIZE_USER_ROW_TASK_ORDER', (select pg_catalog.strpos(prosrc,'lock_task_assignee_users') < pg_catalog.strpos(prosrc,'for update') and pg_catalog.strpos(prosrc,'for update') < pg_catalog.strpos(prosrc,'from public.tasks') from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure));
  perform pg_temp.step10_record('L06_EDIT_ZERO_ROW_IS_40001', (select prosrc ~ 'v_affected <> 1' and prosrc ~ '40001' and prosrc ~ 'The task changed[.] Refresh and try again[.]' from pg_catalog.pg_proc where oid='public.edit_event_with_tasks(uuid,timestamp with time zone,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)'::regprocedure));
  perform pg_temp.step10_record('L07_EDIT_LOCKS_EXISTING_USERS_ONLY', (select prosrc ~ 'join public[.]users as lock_user' from pg_catalog.pg_proc where oid='public.edit_event_with_tasks(uuid,timestamp with time zone,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)'::regprocedure));
  perform pg_temp.step10_record('L08_CREATE_LOCKS_EXISTING_USERS_ONLY', (select prosrc ~ 'join public[.]users as lock_user' from pg_catalog.pg_proc where oid='public.create_event_with_tasks(text,text,date,date,text,jsonb)'::regprocedure));
  perform pg_temp.step10_record('L09_ASSIGN_LOCKS_EXISTING_USERS_ONLY', (select prosrc ~ 'join public[.]users as lock_user' from pg_catalog.pg_proc where oid='public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure));
  perform pg_temp.step10_record('L10_ASSIGN_CAP_BEFORE_LOCK', (select pg_catalog.strpos(prosrc,'> 100') < pg_catalog.strpos(prosrc,'lock_task_assignee_users') from pg_catalog.pg_proc where oid='public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure));
  perform pg_temp.step10_record('L11_ASSIGN_NULL_BEFORE_LOCK', (select pg_catalog.strpos(prosrc,'p_primary_assignees is null') < pg_catalog.strpos(prosrc,'lock_task_assignee_users') from pg_catalog.pg_proc where oid='public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure));
end $$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_probe('L12_CREATE_ADMIN', $$select public.create_event_with_tasks('A2 Create Admin',null,current_date,null,'Draft','[]'::jsonb)$$, true);
select pg_temp.step10_probe('L13_EDIT_ADMIN', $$select public.edit_event_with_tasks('a2102000-0000-4000-8000-000000000004',(select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,'[]'::jsonb,'{}'::uuid[],
  '[]'::jsonb
)$$, true);
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step10_probe('L14_CREATE_CO_OWN', $$select public.create_event_with_tasks('A2 Create Co Own',null,current_date,null,'Draft','[]'::jsonb)$$, true);
select pg_temp.step10_probe('L15_EDIT_CO_OWN', $$select public.edit_event_with_tasks('a2102000-0000-4000-8000-000000000004',(select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,'[]'::jsonb,'{}'::uuid[],
  '[]'::jsonb
)$$, true);
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.step10_probe('L16_CREATE_CO_OTHER', $$select public.create_event_with_tasks('A2 Create Co Other',null,current_date,null,'Draft','[]'::jsonb)$$, true);
select pg_temp.step10_probe('L17_EDIT_CO_OTHER', $$select public.edit_event_with_tasks('a2102000-0000-4000-8000-000000000004',(select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,'[]'::jsonb,'{}'::uuid[],
  '[]'::jsonb
)$$, true);
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select pg_temp.step10_probe('L18_CREATE_MEMBER', $$select public.create_event_with_tasks('A2 Create Member',null,current_date,null,'Draft','[]'::jsonb)$$, false);
select pg_temp.step10_probe('L19_EDIT_MEMBER', $$select public.edit_event_with_tasks('a2102000-0000-4000-8000-000000000004',(select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,'[]'::jsonb,'{}'::uuid[],
  '[]'::jsonb
)$$, false);
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select pg_temp.step10_probe('L20_CREATE_INACTIVE_ADMIN', $$select public.create_event_with_tasks('A2 Create Inactive Admin',null,current_date,null,'Draft','[]'::jsonb)$$, false);
select pg_temp.step10_probe('L21_EDIT_INACTIVE_ADMIN', $$select public.edit_event_with_tasks('a2102000-0000-4000-8000-000000000004',(select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,'[]'::jsonb,'{}'::uuid[],
  '[]'::jsonb
)$$, false);
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000007","role":"authenticated"}',true);
select pg_temp.step10_probe('L22_CREATE_INACTIVE_CO', $$select public.create_event_with_tasks('A2 Create Inactive Co',null,current_date,null,'Draft','[]'::jsonb)$$, false);
select pg_temp.step10_probe('L23_EDIT_INACTIVE_CO', $$select public.edit_event_with_tasks('a2102000-0000-4000-8000-000000000004',(select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,'[]'::jsonb,'{}'::uuid[],
  '[]'::jsonb
)$$, false);
reset role;

-- 116-131: preview caller gate, validation, authoritative shape, and order.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select pg_temp.step10_probe('P01_MEMBER_DENIED', $$select * from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid])$$, false, 'CMR01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step10_probe('P02_COADMIN_DENIED', $$select * from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid])$$, false, 'CMR01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000006","role":"authenticated"}',true);
select pg_temp.step10_probe('P03_INACTIVE_ADMIN_DENIED', $$select * from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid])$$, false, 'CMR01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_probe('P04_NULL_ARRAY', $$select * from public.preview_former_member_removal(null::uuid[])$$, false, 'CMR02');
select pg_temp.step10_probe('P05_ZERO_IDS', $$select * from public.preview_former_member_removal('{}'::uuid[])$$, false, 'CMR02');
select pg_temp.step10_probe('P06_FIFTY_ONE_IDS', $$select * from public.preview_former_member_removal(array(select ('a2110000-0000-4000-8000-'||pg_catalog.lpad(i::text,12,'0'))::uuid from pg_catalog.generate_series(1,51) as s(i)))$$, false, 'CMR02');
select pg_temp.step10_probe('P07_DUPLICATE_IDS', $$select * from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid,'a2100000-0000-4000-8000-000000000008'::uuid])$$, false, 'CMR02');
select pg_temp.step10_probe('P08_NULL_ELEMENT', $$select * from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid,null::uuid])$$, false, 'CMR02');
select pg_temp.step10_query('P09_ONE_ROW_PER_ID', $$select pg_catalog.count(*)=3 from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid,'a210eeee-0000-4000-8000-000000000002'::uuid,'a2100000-0000-4000-8000-000000000005'::uuid])$$);
select pg_temp.step10_query('P10_INPUT_ORDER', $$select pg_catalog.array_agg(user_id order by input_ordinal)=array['a2100000-0000-4000-8000-000000000008'::uuid,'a210eeee-0000-4000-8000-000000000002'::uuid,'a2100000-0000-4000-8000-000000000005'::uuid] from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid,'a210eeee-0000-4000-8000-000000000002'::uuid,'a2100000-0000-4000-8000-000000000005'::uuid])$$);
select pg_temp.step10_query('P11_UNKNOWN_NON_SENSITIVE', $$select outcome='skipped' and reason_code='unavailable' and full_name is null and email is null and role is null and committee_id is null from public.preview_former_member_removal(array['a210eeee-0000-4000-8000-000000000002'::uuid])$$);
select pg_temp.step10_query('P12_SELF_SKIPPED', $$select outcome='skipped' and reason_code='self' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000001'::uuid])$$);
select pg_temp.step10_query('P13_ADMIN_SKIPPED', $$select outcome='skipped' and reason_code='admin' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000002'::uuid])$$);
select pg_temp.step10_query('P14_ACTIVE_SKIPPED', $$select outcome='skipped' and reason_code='active' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000005'::uuid])$$);
select pg_temp.step10_query('P15_ALREADY_ANONYMIZED', $$select outcome='already_anonymized' and reason_code='already_anonymized' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000009'::uuid])$$);
select pg_temp.step10_query('P16_ELIGIBLE_INACTIVE', $$select outcome='eligible' and reason_code='eligible' and open_task_count=0 from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid])$$);
reset role;

-- 132-149: exact primary/assist x task status x parent status matrix.
do $$
declare
  v_i integer;
  v_parent integer;
  v_task_status integer;
  v_expected_block boolean;
  v_actual_outcome text;
  v_actual_reason text;
  v_actual_count bigint;
  v_user_id uuid;
begin
  for v_i in 1..18 loop
    v_parent := ((v_i-1)/6)+1;
    v_task_status := (((v_i-1)/2)%3)+1;
    v_expected_block := v_parent in (1,2) and v_task_status in (1,2);
    v_user_id := (
      'a2101000-0000-4000-8000-'
      || pg_catalog.lpad(v_i::text,12,'0')
    )::uuid;

    select result.out_outcome, result.out_reason_code, result.out_open_task_count
    into v_actual_outcome, v_actual_reason, v_actual_count
    from public.former_member_eligibility(v_user_id) as result;

    perform pg_temp.step10_record(
      'O' || pg_catalog.lpad(v_i::text,2,'0')
        || '_PARENT_' || v_parent || '_STATUS_' || v_task_status
        || '_SIDE_' || case when v_i%2=1 then 'PRIMARY' else 'ASSIST' end,
      case when v_expected_block
        then v_actual_outcome='skipped'
          and v_actual_reason='open_tasks' and v_actual_count=1
        else v_actual_outcome='eligible'
          and v_actual_reason='eligible' and v_actual_count=0
      end
    );
  end loop;
end $$;



-- 150-157: eligibility order and normal ineligibility outcomes.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_query('E01_SELF_BEFORE_ADMIN_TARGET', $$select outcome='skipped' and reason_code='self' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000001'::uuid])$$);
select pg_temp.step10_query('E02_OTHER_ADMIN_TARGET', $$select outcome='skipped' and reason_code='admin' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000002'::uuid])$$);
select pg_temp.step10_query('E03_ALREADY_BEFORE_ACTIVE_CHECK', $$select outcome='already_anonymized' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000007'::uuid])$$);
select pg_temp.step10_query('E04_ACTIVE_BEFORE_TASK_CHECK', $$select outcome='skipped' and reason_code='active' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000005'::uuid])$$);
select pg_temp.step10_query('E05_OPEN_TASK_INELIGIBLE', $$select outcome='skipped' and reason_code='open_tasks' and open_task_count=1 from public.preview_former_member_removal(array['a2100000-0000-4000-8000-00000000000a'::uuid])$$);
select pg_temp.step10_query('E06_INACTIVE_NO_OPEN_ELIGIBLE', $$select outcome='eligible' and reason_code='eligible' from public.preview_former_member_removal(array['a2100000-0000-4000-8000-000000000008'::uuid])$$);
select pg_temp.step10_query('E07_UNKNOWN_UNAVAILABLE', $$select outcome='skipped' and reason_code='unavailable' from public.preview_former_member_removal(array['a210eeee-0000-4000-8000-000000000003'::uuid])$$);
select pg_temp.step10_probe('E08_ANONYMIZE_UNKNOWN_CMR03', $$select * from public.anonymize_former_member('a210eeee-0000-4000-8000-000000000003')$$, false, 'CMR03');

-- 158-175: anonymization, preservation, DB idempotence, and address re-use.
select pg_temp.step10_query('A01_ELIGIBLE_ANONYMIZED_OUTCOME', $$select out_outcome='anonymized' and out_reason_code='anonymized' from public.anonymize_former_member('a2100000-0000-4000-8000-000000000008')$$);
select pg_temp.step10_query('A02_DETERMINISTIC_EMAIL', $$select email=id::text||'@former.invalid' from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A03_FIXED_NAME', $$select full_name='Former member' from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A04_INACTIVE', $$select is_active is false from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A05_AVATAR_CLEARED', $$select avatar_url is null from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A06_DISCORD_CLEARED', $$select discord_id is null from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A07_TIMESTAMP_SET', $$select anonymized_at is not null and anonymized_at<=pg_catalog.clock_timestamp() from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A08_UUID_ROLE_COMMITTEE_PRESERVED', $$select id='a2100000-0000-4000-8000-000000000008' and role='Member' and committee_id=(select id from public.committees order by name,id limit 1) from public.users where id='a2100000-0000-4000-8000-000000000008'$$);
select pg_temp.step10_query('A09_ALREADY_DB_OUTCOME', $$select out_outcome='already_anonymized' and out_reason_code='already_anonymized' and out_email='a2100000-0000-4000-8000-000000000008@former.invalid' and out_anonymized_at is not null from public.anonymize_former_member('a2100000-0000-4000-8000-000000000008')$$);
select pg_temp.step10_query('A10_OPEN_TASK_SKIPPED', $$select out_outcome='skipped' and out_reason_code='open_tasks' from public.anonymize_former_member('a2100000-0000-4000-8000-00000000000a')$$);
select pg_temp.step10_query('A11_ACTIVE_SKIPPED', $$select out_outcome='skipped' and out_reason_code='active' from public.anonymize_former_member('a2100000-0000-4000-8000-000000000005')$$);
select pg_temp.step10_query('A12_SELF_SKIPPED', $$select out_outcome='skipped' and out_reason_code='self' from public.anonymize_former_member('a2100000-0000-4000-8000-000000000001')$$);
select pg_temp.step10_query('A13_ADMIN_SKIPPED', $$select out_outcome='skipped' and out_reason_code='admin' from public.anonymize_former_member('a2100000-0000-4000-8000-000000000002')$$);
select pg_temp.step10_query('A14_DEPENDENT_HISTORY_NOT_WRITTEN', $$select (select prosrc !~* '(update|delete[[:space:]]+from)[[:space:]]+public[.](events|tasks|task_comments|task_volunteers|notifications|activity_log|archived_task_viewers|task_work_links)' from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure)$$);
select pg_temp.step10_query('A15_ONLY_PROFILE_COLUMNS_WRITTEN', $$select (select prosrc ~ 'set email = profile[.]id::text' and prosrc ~ 'full_name = ''Former member''' and prosrc ~ 'avatar_url = null' and prosrc ~ 'discord_id = null' and prosrc ~ 'is_active = false' and prosrc ~ 'anonymized_at = v_now' from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure)$$);
reset role;

-- Stage B performs this Auth email update and ban before inviting again. The
-- SQL fixture mirrors only the identity change needed to prove the DB path.
update auth.users
set email='a2100000-0000-4000-8000-000000000009@former.invalid',
    updated_at=pg_catalog.clock_timestamp()
where id='a2100000-0000-4000-8000-000000000009';
insert into auth.users(
  id,instance_id,aud,role,email,encrypted_password,invited_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  'a2100000-0000-4000-8000-000000000020',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'a2-original@test.local','',pg_catalog.now(),'{}','{}',
  pg_catalog.now(),pg_catalog.now()
);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_query('A16_REINVITE_FINALIZES_NEW_UUID', $$select public.finalize_member_invite('a2100000-0000-4000-8000-000000000020','a2-original@test.local','A2 Reinvited',(select id from public.committees order by name,id limit 1))='a2100000-0000-4000-8000-000000000020'::uuid$$);
select pg_temp.step10_query('A17_ORIGINAL_EMAIL_IS_FREE', $$select (select email from public.users where id='a2100000-0000-4000-8000-000000000020')='a2-original@test.local' and (select email from public.users where id='a2100000-0000-4000-8000-000000000009')='a2100000-0000-4000-8000-000000000009@former.invalid'$$);
select pg_temp.step10_query('A18_NO_REACTIVATION_OR_MERGE', $$select (select anonymized_at is not null and is_active is false from public.users where id='a2100000-0000-4000-8000-000000000009') and (select anonymized_at is null and id<>'a2100000-0000-4000-8000-000000000009'::uuid from public.users where id='a2100000-0000-4000-8000-000000000020')$$);
reset role;


-- 176-180: permanent activation denial through every database boundary used by
-- the Admin route or Co-Admin management path.
select pg_temp.step10_probe('R01_POSTGRES_RAW_REACTIVATION', $$update public.users set is_active=true where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
set local role service_role;
select pg_temp.step10_probe('R02_SERVICE_ROLE_RAW_REACTIVATION', $$update public.users set is_active=true where id='a2100000-0000-4000-8000-000000000009'$$, false, 'CMR04');
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_probe('R03_ADMIN_ROUTE_SET_OFFICER_ACTIVE', $$select public.set_officer_active('a2100000-0000-4000-8000-000000000007',true)$$, false, 'CMR04');
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step10_probe('R04_COADMIN_REACTIVATE_MEMBER', $$select public.reactivate_committee_member('a2100000-0000-4000-8000-000000000009')$$, false, 'CMR04');
reset role;
select pg_temp.step10_query('R05_TRIGGER_IS_ONLY_BYPASS_BOUNDARY', $$select exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and tgenabled<>'D' and not tgisinternal)$$);

-- 181-190: marker cleanup, editor orphan compatibility, and both sequential
-- winners of the assignment/removal serialization contract.
select pg_temp.step10_query('M01_FORMER_MARKER_CLEARED_SUCCESS', $$select coalesce(pg_catalog.current_setting('ceit_connect.former_member_writer',true),'')=''$$);

create function pg_temp.step10_force_anonymize_failure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id='a2100000-0000-4000-8000-00000000000c'::uuid
     and new.anonymized_at is not null then
    raise exception 'forced rollback-safe anonymization failure';
  end if;
  return new;
end;
$$;
create trigger zz_step10_force_anonymize_failure
after update on public.users
for each row execute function pg_temp.step10_force_anonymize_failure();
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_probe('M02_CAUGHT_ERROR_PATH_RAISES_CMR05', $$select * from public.anonymize_former_member('a2100000-0000-4000-8000-00000000000c')$$, false, 'CMR05');
reset role;
select pg_temp.step10_query('M03_FORMER_MARKER_CLEARED_CAUGHT_ERROR', $$select coalesce(pg_catalog.current_setting('ceit_connect.former_member_writer',true),'')=''$$);
drop trigger zz_step10_force_anonymize_failure on public.users;
drop function pg_temp.step10_force_anonymize_failure();

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_probe('M04_ORPHAN_ASSIGNEE_EDIT_SAVE', $$select public.edit_event_with_tasks(
  'a2102000-0000-4000-8000-000000000004',
  (select updated_at from public.events where id='a2102000-0000-4000-8000-000000000004'),
  'A2 Orphan Save',null,current_date,current_date,'Draft','[]'::jsonb,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id','a2103000-0000-4000-8000-000000000101',
    'title','A2 Orphan Task Saved','description',null,'phase','Orphan',
    'committee_id',(select id::text from public.committees order by name,id limit 1),
    'task_type','Deliverable','priority','Medium','due_date',null,
    'call_time',null,'end_time',null,
    'assignee_ids',pg_catalog.jsonb_build_array('a2100000-0000-4000-8000-000000000005')
  )), '{}'::uuid[]
,
  '[]'::jsonb
)$$, true);
reset role;
select pg_temp.step10_query('M05_TASK_MARKER_CLEARED_SUCCESS', $$select coalesce(pg_catalog.current_setting('ceit_connect.task_assignee_writer',true),'')=''$$);
select pg_temp.step10_probe('M06_LATER_RAW_ARRAY_WRITE_REJECTED', $$update public.tasks set primary_assignees=primary_assignees||array['a2100000-0000-4000-8000-000000000003'::uuid] where id='a2103000-0000-4000-8000-000000000101'$$, false, '42501');

-- Sequential winner 1: assignment commits first. The target is then inactive,
-- and removal re-reads the open assignment and returns skipped/open_tasks.
update public.users set is_active=true
where id='a2100000-0000-4000-8000-00000000000b';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select * from public.assign_task_people(
  'a2103000-0000-4000-8000-000000000100',
  array['a2100000-0000-4000-8000-00000000000b'::uuid],
  '{}'::uuid[]
);
reset role;
update public.users set is_active=false
where id='a2100000-0000-4000-8000-00000000000b';
set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step10_query('M07_ASSIGNMENT_WINNER_BLOCKS_REMOVAL', $$select out_outcome='skipped' and out_reason_code='open_tasks' from public.anonymize_former_member('a2100000-0000-4000-8000-00000000000b')$$);

-- Sequential winner 2: removal commits first; assignment re-reads the target
-- after the same per-user lock and rejects it as inactive/anonymized.
select * from public.anonymize_former_member(
  'a2100000-0000-4000-8000-00000000000c'
);
select pg_temp.step10_probe('M08_REMOVAL_WINNER_BLOCKS_ASSIGNMENT', $$select * from public.assign_task_people('a2103000-0000-4000-8000-000000000100',array['a2100000-0000-4000-8000-00000000000c'::uuid],'{}'::uuid[])$$, false);
reset role;
select pg_temp.step10_query('M09_NO_PARTIAL_ARRAY_AFTER_LOSER', $$select primary_assignees=array['a2100000-0000-4000-8000-00000000000b'::uuid] and assist_assignees='{}'::uuid[] from public.tasks where id='a2103000-0000-4000-8000-000000000100'$$);
select pg_temp.step10_query('M10_RACE_BODY_RECHECKS_AUTHORITATIVE_STATE', $$select (select pg_catalog.strpos(prosrc,'lock_task_assignee_users')<pg_catalog.strpos(prosrc,'for update') and pg_catalog.strpos(prosrc,'for update')<pg_catalog.strpos(prosrc,'from public.tasks') from pg_catalog.pg_proc where oid='public.anonymize_former_member(uuid)'::regprocedure) and (select pg_catalog.strpos(prosrc,'lock_task_assignee_users')<pg_catalog.strpos(prosrc,'Every assignee must exist and be active') from pg_catalog.pg_proc where oid='public.assign_task_people(uuid,uuid[],uuid[])'::regprocedure)$$);

do $$
declare
  v_count integer := pg_catalog.current_setting(
    'ceit_connect.step10_count', true
  )::integer;
  v_results text := pg_catalog.current_setting(
    'ceit_connect.step10_results', true
  );
begin
  if v_count <> 190 then
    raise exception 'TEST DEFINITION ERROR: expected 190 lines, got %', v_count;
  end if;
  raise exception E'TEST RESULTS (190 lines)\n%', v_results;
end $$;

rollback;
```

## Required historical reruns after A2

Run each historical paste without changing its historical expected count:

1. The Batch 0 users-policy tests.
2. All nine independent pastes in `docs/phase-4b/step-8-tests.md`, especially
   Admin protection, last-active-Admin, officer guard, grant, cap, and
   `set_officer_active` coverage.
3. `docs/phase-4b/step-9-tests.md`: it must still report exactly **116 lines**,
   and its conditional line must now read `ANONYMIZED_CASE: PASS` (not
   `SKIPPED`).
4. `docs/PHASE-4-STEP-7A-TESTS.md`.
5. `docs/PHASE-4-STEP-8-TESTS.md`.
6. `docs/PHASE-3-STEP-6-ARCHIVE-VISIBILITY-TESTS.md`.
7. `docs/PHASE-4-STEP-7B-TESTS.md`.
8. `docs/PHASE-4-STEP-9-TESTS.md` for retained comments and current-profile
   rendering.
9. `docs/PHASE-4-STEP-1A-TESTS.md` for immutable activity snapshots and its
   authoritative catalog coverage.

Stage B must additionally remove a Google-linked Dev Member, perform the
idempotent Auth email update/ban and Storage cleanup, re-invite the original
address as a new UUID, and sign in with Google. If the old banned Auth user's
retained Google identity prevents that sign-in, stop before building the UI
and implement the required identity-cleanup strategy. The owner confirmed this
failure; Phase 1b's replacement gate is in
`docs/phase-4b/step-10-phase-1b-tests.md`.

## Stage B Phase 1 route tests

Phase 1 adds Vitest coverage in:

- `src/lib/users/former-member-removal.test.ts`
- `src/app/api/remove-former-members/route.test.ts`
- `src/app/api/toggle-user-active/route.test.ts`

The focused suites cover exact request and RPC shapes, 0/1/50/51 and duplicate
selection handling, caller denial, no-store preview ordering, authoritative
confirmation, fresh and already-anonymized retries, exact Auth email/confirm/ban
arguments, returned Auth-state verification, the service-role identity cleanup
RPC and strict result contract, Storage cleanup, safe failure messages,
per-item continuation, repeated Admin checks, and pre-service-role reactivation
denial. The owner-confirmed Google gate requires Phase 1b; no removal UI is
present.

## Stage B Phase 2 UI verification

Implemented locally without a migration, service-role list read, Supabase
command, commit, or push. The tracked `users` policies permit the second
caller-session marker read: Admins have `admin_view_all_users`; Co-Admins have
same-committee SELECT, and `list_managed_users` returns them only Members from
that same committee. The migrations revoke direct writes but do not revoke
authenticated table/column SELECT.

Automated verification completed on 2026-10-27:

- Focused Part A: 56/56 tests passed across reader enrichment, terminal
  presentation, role-aware actions, selection, Users API/page, and desktop/
  phone rendering.
- Focused Part B: 93/93 tests passed across strict preview/result contracts,
  route regressions, 20/65-second abort contracts, frozen snapshots, retry
  filtering, unknown outcomes, motion, and role-aware UI.
- Final full Vitest run: 546/546 tests passed across 59 files.
- Next.js 16.3.4 production build: passed, including TypeScript and all 28
  routes.
- ESLint: passed with zero issues.

UI follow-up verification completed on 2026-10-27 after the Dev UX review:

- Focused visibility/loading/selection/removal UI coverage: 44/44 tests passed
  across six files.
- Final full Vitest run: 561/561 tests passed across 62 files.
- Next.js 16.3.4 production build: passed, including TypeScript and all 28
  routes.
- ESLint: passed with zero issues.
- No migration, route contract, service-role reader, or Supabase command was
  added or run.

Manual browser rows remain owner-pending. Use Dev only and verify both desktop
and phone widths, light and dark themes, then repeat the motion row with OS
reduced motion enabled:

- [ ] In light/dark desktop and phone views, removed rows are hidden by default.
  The keyboard-operable `Show removed members` toggle reveals `Former member`
  rows with `Removed`, committee, and role badges without requesting data or
  resetting paging; shorter pages, all-loaded-removed state, and Load more stay
  accurate.
- [ ] Admin Deactivated selection works by mouse and keyboard; select-all uses
  only visible non-removed rows, excludes removed/Admin/lookahead/unloaded rows,
  stays across Load more, clears on tab/search changes, accepts 50, and
  atomically rejects 51. Co-Admins receive no selection controls.
- [ ] Ordinary rows show Reactivate and Remove former member in their menus.
  Revealed removed rows show only Admin `Re-run cleanup`; Co-Admins see the row
  with no profile-changing, removal, or retry control.
- [ ] Single and bulk previews show eligible, open-task skipped, unavailable,
  and cleanup-retry states; a stale target is authoritatively rechecked and
  the exact full-count phrase is required.
- [ ] Mixed results preserve request order and accurate Auth, Google identity,
  and photo-cleanup messages; per-row Retry cleanup and Retry incomplete open
  a fresh preview containing only failed/cleanup-pending UUIDs.
- [ ] A timed-out preview releases controls and can be retried. A timed-out or
  network-failed removal reports an unknown outcome, refreshes Deactivated,
  and its `Show removed members` action waits for the page-one refresh before
  revealing marked rows and closing, without fabricating per-user failures.
- [ ] Co-Admin UI denial and direct API denial hold for Co-Admin, Member,
  inactive Admin, profile-less, and unauthenticated callers; an anonymized
  account remains non-reactivatable through UI and direct API.
- [ ] Normal motion uses stable row reveal and tab-only panel motion. Reduced
  motion immediately shows final list/dialog/control states with no spatial,
  stagger, or one-off timer animation.
- [ ] Tab and search input changes immediately show the shared roster skeleton,
  expose no stale selection or row actions, announce loading once, and resolve
  to success, empty, or error without getting stuck. Repeat this row with OS
  reduced motion enabled.

