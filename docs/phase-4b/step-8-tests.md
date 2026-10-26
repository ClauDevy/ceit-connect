# Step 8 — officer invitations and transitions tests

Run these pastes on **Dev only**, after the owner has reviewed and applied
`20261026120000_officer_invitations_and_transitions.sql`. Choose **Run without
RLS**. Every numbered test is one independent paste, creates its own fixtures,
and ends with an intentional `TEST RESULTS` exception that rolls the transaction
back. No paste commits fixtures and no two-session test is used.

Expected result lines:

- TEST 1: 21 lines.
- TEST 2: 22 lines.
- TEST 3: 21 lines.
- TEST 4: 16 lines.
- TEST 5: 17 lines.
- TEST 6: 28 lines (the seven-writer loop emits 21 lines).
- TEST 7: 14 lines.
- TEST 8: 5 lines.
- TEST 9: 2 lines.

The Admin `committee_id` preflight returned zero rows on Dev and zero rows on
Prod, owner-confirmed before migration work.

## TEST 1 — singleton, invitation schema, policy, privileges, and signatures

```sql
begin;
do $$
declare
  r text := '';
  ok boolean;
  n integer;
begin
  select count(*) = 1 into ok from public.app_settings where key = 'global' and not enforce_officer_role_caps;
  r := r || format(E'\nSETTINGS_EXACT_SEED: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 1 into ok from pg_constraint where conrelid = 'public.app_settings'::regclass and contype = 'p';
  r := r || format(E'\nSETTINGS_PRIMARY_KEY: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 1 into ok from pg_constraint where conrelid = 'public.app_settings'::regclass and conname = 'app_settings_singleton_key';
  r := r || format(E'\nSETTINGS_FIXED_KEY_CHECK: %s', case when ok then 'PASS' else 'FAIL' end);
  select relrowsecurity into ok from pg_class where oid = 'public.app_settings'::regclass;
  r := r || format(E'\nSETTINGS_RLS_ENABLED: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 0 into ok from pg_policies where schemaname = 'public' and tablename = 'app_settings';
  r := r || format(E'\nSETTINGS_ZERO_POLICIES: %s', case when ok then 'PASS' else 'FAIL' end);
  ok := not has_table_privilege('anon','public.app_settings','SELECT') and not has_table_privilege('authenticated','public.app_settings','SELECT');
  r := r || format(E'\nSETTINGS_NO_CLIENT_PRIVILEGES: %s', case when ok then 'PASS' else 'FAIL' end);
  begin insert into public.app_settings(key) values ('other'); ok := false; exception when check_violation then ok := true; end;
  r := r || format(E'\nSETTINGS_INVALID_KEY_REJECTED: %s', case when ok then 'PASS' else 'FAIL' end);
  begin insert into public.app_settings(key) values ('global'); ok := false; exception when unique_violation then ok := true; end;
  r := r || format(E'\nSETTINGS_DUPLICATE_REJECTED: %s', case when ok then 'PASS' else 'FAIL' end);
  select relrowsecurity into ok from pg_class where oid = 'public.officer_invites'::regclass;
  r := r || format(E'\nINVITES_RLS_ENABLED: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 0 into ok from pg_policies where schemaname = 'public' and tablename = 'officer_invites';
  r := r || format(E'\nINVITES_ZERO_POLICIES: %s', case when ok then 'PASS' else 'FAIL' end);
  ok := not has_table_privilege('anon','public.officer_invites','SELECT') and not has_table_privilege('authenticated','public.officer_invites','SELECT');
  r := r || format(E'\nINVITES_NO_CLIENT_PRIVILEGES: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 8 into ok from pg_constraint where conrelid = 'public.officer_invites'::regclass and contype = 'c';
  r := r || format(E'\nINVITES_EIGHT_STATE_CHECKS: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 4 into ok from pg_indexes where schemaname = 'public' and tablename = 'officer_invites' and indexname like 'officer_invites_%';
  r := r || format(E'\nINVITES_FOUR_INDEXES: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) into n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('invite_new_officer','appoint_member_as_officer','return_coadmin_to_member','move_member_to_committee','cancel_officer_invite','step_down_as_admin');
  r := r || format(E'\nSIX_EXACT_TRANSITION_FUNCTIONS: %s', case when n = 6 then 'PASS' else 'FAIL' end);
  select count(*) = 1 into ok from pg_proc where oid = 'public.set_officer_active(uuid,boolean)'::regprocedure;
  r := r || format(E'\nONE_ACTIVE_STATE_FUNCTION: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 1 into ok from pg_proc where oid = 'public.list_pending_officer_invites()'::regprocedure;
  r := r || format(E'\nONE_PENDING_READER: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 0 into ok from pg_proc where pronamespace = 'public'::regnamespace and proname in ('change_role','set_user_role','transition_officer');
  r := r || format(E'\nNO_GENERIC_TRANSITION_FUNCTION: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 1 into ok from pg_policies where schemaname='public' and tablename='users' and policyname='admin_view_all_users' and cmd='SELECT';
  r := r || format(E'\nADMIN_POLICY_SELECT_ONLY: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 0 into ok from pg_policies where schemaname='public' and tablename='users' and policyname='admin_full_access_users';
  r := r || format(E'\nOLD_ADMIN_ALL_POLICY_GONE: %s', case when ok then 'PASS' else 'FAIL' end);
  ok := not has_table_privilege('authenticated','public.users','INSERT') and not has_table_privilege('authenticated','public.users','UPDATE') and not has_table_privilege('authenticated','public.users','DELETE');
  r := r || format(E'\nUSERS_CLIENT_WRITES_REVOKED: %s', case when ok then 'PASS' else 'FAIL' end);
  select count(*) = 1 into ok from pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes' and not tgisinternal;
  r := r || format(E'\nUSERS_GUARD_ATTACHED_ONCE: %s', case when ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %', r;
end $$;
rollback;
```

## TEST 2 — caps off and all seven writers

```sql
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',x.confirmed,'{}','{}',now(),now()
from (values
 ('b8020000-0000-4000-8000-000000000001'::uuid,'b8-admin1@test.local',now()),
 ('b8020000-0000-4000-8000-000000000002'::uuid,'b8-admin2@test.local',now()),
 ('b8020000-0000-4000-8000-000000000003'::uuid,'b8-member1@test.local',now()),
 ('b8020000-0000-4000-8000-000000000004'::uuid,'b8-member2@test.local',now()),
 ('b8020000-0000-4000-8000-000000000005'::uuid,'b8-co@test.local',now()),
 ('b8020000-0000-4000-8000-000000000006'::uuid,'b8-invite@test.local',null::timestamptz)
) x(id,email,confirmed);
do $$
declare c1 uuid; c2 uuid; c3 uuid;
begin
  select id into c1 from public.committees order by name limit 1;
  select id into c2 from public.committees order by name offset 1 limit 1;
  select id into c3 from public.committees order by name offset 2 limit 1;
  perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
  insert into public.users(id,email,full_name,role,committee_id) values
   ('b8020000-0000-4000-8000-000000000001','b8-admin1@test.local','Admin One','Admin',null),
   ('b8020000-0000-4000-8000-000000000002','b8-admin2@test.local','Admin Two','Admin',null),
   ('b8020000-0000-4000-8000-000000000005','b8-co@test.local','Co One','Co-Admin',c1);
  perform set_config('ceit_connect.officer_writer','',true);
  insert into public.users(id,email,full_name,role,committee_id) values
   ('b8020000-0000-4000-8000-000000000003','b8-member1@test.local','Member One','Member',c1),
   ('b8020000-0000-4000-8000-000000000004','b8-member2@test.local','Member Two','Member',c1);
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b8020000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare r text := ''; c1 uuid; c2 uuid; c3 uuid; j jsonb; ok boolean;
begin
  select id into c1 from public.committees order by name limit 1;
  select id into c2 from public.committees order by name offset 1 limit 1;
  select id into c3 from public.committees order by name offset 2 limit 1;
  select public.invite_new_officer('b8021000-0000-4000-8000-000000000001',null,'B8-Invite@Test.Local',' Invited Officer ','Co-Admin',c3) into j;
  r:=r||format(E'\nPREPARE_NORMALIZED: %s',case when j->>'outcome'='prepared' then 'PASS' else 'FAIL' end);
  select public.invite_new_officer('b8021000-0000-4000-8000-000000000001','b8020000-0000-4000-8000-000000000006',null,null,null,null) into j;
  r:=r||format(E'\nFINALIZE_SENT: %s',case when j->>'outcome'='sent' then 'PASS' else 'FAIL' end);
  select role='Co-Admin' and is_active and committee_id=c3 into ok from public.users where id='b8020000-0000-4000-8000-000000000006';
  r:=r||format(E'\nFINAL_PROFILE_IS_SEAT: %s',case when ok then 'PASS' else 'FAIL' end);
  select status='sent' and reservation_released_at is not null into ok from public.officer_invites where id='b8021000-0000-4000-8000-000000000001';
  r:=r||format(E'\nFINALIZATION_COALESCE_PATH_EXECUTED: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.appoint_member_as_officer('b8020000-0000-4000-8000-000000000003','Co-Admin',c1);
  select role='Co-Admin' into ok from public.users where id='b8020000-0000-4000-8000-000000000003';
  r:=r||format(E'\nSECOND_COADMIN_CAPS_OFF: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.return_coadmin_to_member('b8020000-0000-4000-8000-000000000003',c2);
  select role='Member' and committee_id=c2 into ok from public.users where id='b8020000-0000-4000-8000-000000000003';
  r:=r||format(E'\nRETURN_TO_MEMBER: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.move_member_to_committee('b8020000-0000-4000-8000-000000000003',c3);
  select committee_id=c3 into ok from public.users where id='b8020000-0000-4000-8000-000000000003';
  r:=r||format(E'\nMOVE_MEMBER: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.appoint_member_as_officer('b8020000-0000-4000-8000-000000000004','Admin',null);
  select role='Admin' and committee_id is null into ok from public.users where id='b8020000-0000-4000-8000-000000000004';
  r:=r||format(E'\nTHIRD_ADMIN_CAPS_OFF: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.set_officer_active('b8020000-0000-4000-8000-000000000005',false);
  select not is_active and avatar_url is null into ok from public.users where id='b8020000-0000-4000-8000-000000000005';
  r:=r||format(E'\nCOADMIN_DEACTIVATED: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.set_officer_active('b8020000-0000-4000-8000-000000000005',true);
  select is_active into ok from public.users where id='b8020000-0000-4000-8000-000000000005';
  r:=r||format(E'\nCOADMIN_REACTIVATED_CAPS_OFF: %s',case when ok then 'PASS' else 'FAIL' end);
  perform public.return_coadmin_to_member('b8020000-0000-4000-8000-000000000006',c3);
  select role='Member' and is_active into ok from public.users where id='b8020000-0000-4000-8000-000000000006';
  r:=r||format(E'\nINVITEE_RETURNED_TO_MEMBER_BEFORE_CANCEL: %s',case when ok then 'PASS' else 'FAIL' end);
  select public.cancel_officer_invite('b8021000-0000-4000-8000-000000000001') into j;
  r:=r||format(E'\nUNACCEPTED_CANCELLED: %s',case when j->>'outcome'='cancelled' then 'PASS' else 'FAIL' end);
  select role='Member' and not is_active into ok from public.users where id='b8020000-0000-4000-8000-000000000006';
  r:=r||format(E'\nCANCEL_DEACTIVATES_PROFILE: %s',case when ok then 'PASS' else 'FAIL' end);
  select public.cancel_officer_invite('b8021000-0000-4000-8000-000000000001') into j;
  r:=r||format(E'\nCANCEL_IDEMPOTENT: %s',case when j->>'outcome'='cancelled' then 'PASS' else 'FAIL' end);
  perform public.step_down_as_admin(c1);
  select role='Member' and committee_id=c1 into ok from public.users where id='b8020000-0000-4000-8000-000000000001';
  r:=r||format(E'\nSELF_STEP_DOWN: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=2 into ok from public.users where role='Admin' and is_active;
  r:=r||format(E'\nOTHER_ADMINS_PRESERVED: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=1 into ok from public.committees where name='President';
  r:=r||format(E'\nPRESIDENT_LOOKUP_PRESERVED: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=0 into ok from public.users where role='Admin' and committee_id is not null;
  r:=r||format(E'\nALL_ADMINS_NULL_COMMITTEE: %s',case when ok then 'PASS' else 'FAIL' end);
  select not enforce_officer_role_caps into ok from public.app_settings where key='global';
  r:=r||format(E'\nCAPS_OFF_SETTING_READ: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=1 into ok from public.users where lower(btrim(email))='b8-invite@test.local';
  r:=r||format(E'\nONE_ACCOUNT_PER_PERSON: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=7 into ok from pg_proc where pronamespace='public'::regnamespace and proname in ('invite_new_officer','appoint_member_as_officer','return_coadmin_to_member','move_member_to_committee','cancel_officer_invite','step_down_as_admin','set_officer_active');
  r:=r||format(E'\nEXACT_WRITERS_ONLY: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=0 into ok from pg_proc where pronamespace='public'::regnamespace and proname in ('change_role','set_user_role','transition_officer');
  r:=r||format(E'\nNO_GENERIC_ROLE_CHANGE: %s',case when ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 3 — caps on, reservations, stale release, and never-zero

```sql
begin;
-- This paste uses the same Auth/profile fixture shape as TEST 2 with ids in
-- the b803... range: two active Admins, two active Co-Admins in committee 1
-- (an intentional pre-cap overage), one active Member, and one unconfirmed
-- Auth-only invitee. Officer fixture
-- inserts set the owner-only invite_new_officer writer token and immediately
-- clear it. The complete fixture statements are deliberately explicit below.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',x.confirmed,'{}','{}',now(),now()
from (values
 ('b8030000-0000-4000-8000-000000000001'::uuid,'b803-a1@test.local',now()),('b8030000-0000-4000-8000-000000000002','b803-a2@test.local',now()),
 ('b8030000-0000-4000-8000-000000000003','b803-co@test.local',now()),('b8030000-0000-4000-8000-000000000004','b803-m1@test.local',now()),
 ('b8030000-0000-4000-8000-000000000005','b803-m2@test.local',now()),('b8030000-0000-4000-8000-000000000006','b803-new@test.local',null::timestamptz)
) x(id,email,confirmed);
do $$ declare c1 uuid; c2 uuid; begin
 select id into c1 from public.committees order by name limit 1; select id into c2 from public.committees order by name offset 1 limit 1;
 perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8030000-0000-4000-8000-000000000001','b803-a1@test.local','A1','Admin',null),('b8030000-0000-4000-8000-000000000002','b803-a2@test.local','A2','Admin',null),
 ('b8030000-0000-4000-8000-000000000003','b803-co@test.local','CO','Co-Admin',c1),
 ('b8030000-0000-4000-8000-000000000004','b803-m1@test.local','Existing over cap','Co-Admin',c1);
 perform set_config('ceit_connect.officer_writer','',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8030000-0000-4000-8000-000000000005','b803-m2@test.local','M2','Member',c2);
 insert into public.officer_invites(id,email,full_name,officer_role,committee_id,invited_by,status,created_at)
 values('b8031000-0000-4000-8000-000000000003','stale@test.local','Stale','Co-Admin',c2,'b8030000-0000-4000-8000-000000000001','preparing',now()-interval '16 minutes');
 update public.app_settings set enforce_officer_role_caps=true where key='global';
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b8030000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare r text:=''; c1 uuid; c2 uuid; c3 uuid; j jsonb; ok boolean; denied boolean; released timestamptz;
begin
 select id into c1 from public.committees order by name limit 1; select id into c2 from public.committees order by name offset 1 limit 1; select id into c3 from public.committees order by name offset 2 limit 1;
 select count(*)=2 into ok from public.users where role='Co-Admin' and committee_id=c1 and is_active;
 r:=r||format(E'\nEXISTING_OVERLIMIT_NOT_REWRITTEN: %s',case when ok then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.invite_new_officer('b8031000-0000-4000-8000-000000000001',null,'third-admin@test.local','Third','Admin',null); exception when sqlstate 'CCO04' then denied:=true; end;
 r:=r||format(E'\nTHIRD_ADMIN_PREPARE_BLOCKED: %s',case when denied then 'PASS' else 'FAIL' end);
 select public.invite_new_officer('b8031000-0000-4000-8000-000000000002',null,'reserved@test.local','Reserved','Co-Admin',c2) into j;
 r:=r||format(E'\nPREPARING_RESERVES_EMPTY_SEAT: %s',case when j->>'outcome'='prepared' then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.appoint_member_as_officer('b8030000-0000-4000-8000-000000000005','Co-Admin',c2); exception when sqlstate 'CCO04' then denied:=true; end;
 r:=r||format(E'\nAPPOINTMENT_COUNTS_PREPARING: %s',case when denied then 'PASS' else 'FAIL' end);
 select public.cancel_officer_invite('b8031000-0000-4000-8000-000000000002') into j;
 r:=r||format(E'\nFAILED_ATTEMPT_RELEASED: %s',case when j->>'outcome'='cancelled' then 'PASS' else 'FAIL' end);
 select reservation_released_at into released from public.officer_invites where id='b8031000-0000-4000-8000-000000000002';
 perform public.cancel_officer_invite('b8031000-0000-4000-8000-000000000002');
 select reservation_released_at=released into ok from public.officer_invites where id='b8031000-0000-4000-8000-000000000002';
 r:=r||format(E'\nRESERVATION_RELEASED_EXACTLY_ONCE: %s',case when ok then 'PASS' else 'FAIL' end);
 perform public.appoint_member_as_officer('b8030000-0000-4000-8000-000000000005','Co-Admin',c2);
 select role='Co-Admin' and committee_id=c2 and is_active into ok from public.users where id='b8030000-0000-4000-8000-000000000005';
 r:=r||format(E'\nRELEASE_MAKES_SEAT_REUSABLE: %s',case when ok then 'PASS' else 'FAIL' end);
 select role='Co-Admin' into ok from public.users where id='b8030000-0000-4000-8000-000000000005';
 r:=r||format(E'\nSTALE_PREPARING_DOES_NOT_COUNT_TOWARD_CAP: %s',case when ok then 'PASS' else 'FAIL' end);
 select public.invite_new_officer('b8031000-0000-4000-8000-000000000003',null,'stale@test.local','Stale','Co-Admin',c2) into j;
 r:=r||format(E'\nSTALE_15_MINUTE_PREPARING_BECOMES_CLEANUP: %s',case when j->>'outcome'='cleanup_pending' then 'PASS' else 'FAIL' end);
 select status='cleanup_pending' and reservation_released_at is not null into ok from public.officer_invites where id='b8031000-0000-4000-8000-000000000003';
 r:=r||format(E'\nSTALE_RESERVATION_RELEASED: %s',case when ok then 'PASS' else 'FAIL' end);
 perform public.return_coadmin_to_member('b8030000-0000-4000-8000-000000000003',c1);
 select role='Member' and committee_id=c1 into ok from public.users where id='b8030000-0000-4000-8000-000000000003';
 r:=r||format(E'\nREDUCING_OPERATION_ALLOWED_AT_CAP: %s',case when ok then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.appoint_member_as_officer('b8030000-0000-4000-8000-000000000003','Co-Admin',c1); exception when sqlstate 'CCO04' then denied:=true; end;
 r:=r||format(E'\nACTIVE_COADMIN_CAP_STILL_BLOCKS: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.step_down_as_admin(c1); exception when others then denied:=true; end;
 r:=r||format(E'\nSTEPDOWN_WITH_OTHER_ADMIN_ALLOWED: %s',case when not denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"b8030000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 denied:=false; begin perform public.step_down_as_admin(c1); exception when sqlstate 'CCO09' then denied:=true; end;
 r:=r||format(E'\nLAST_ADMIN_ALWAYS_PROTECTED: %s',case when denied then 'PASS' else 'FAIL' end);
 select enforce_officer_role_caps into ok from public.app_settings where key='global';
 r:=r||format(E'\nCAPS_SETTING_TRUE: %s',case when ok then 'PASS' else 'FAIL' end);
 select (select count(*) from public.users where role='Co-Admin' and committee_id=c2 and is_active)+(select count(*) from public.officer_invites where officer_role='Co-Admin' and committee_id=c2 and status='preparing')=1 into ok;
 r:=r||format(E'\nACTIVE_PLUS_PREPARING_FORMULA: %s',case when ok then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"b8030000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 perform public.invite_new_officer('b8031000-0000-4000-8000-000000000004',null,'b803-new@test.local','New','Co-Admin',c3);
 perform public.invite_new_officer('b8031000-0000-4000-8000-000000000004','b8030000-0000-4000-8000-000000000006',null,null,null,null);
 select status='sent' and reservation_released_at is not null into ok from public.officer_invites where id='b8031000-0000-4000-8000-000000000004';
 r:=r||format(E'\nFINALIZATION_REPLACES_RESERVATION: %s',case when ok then 'PASS' else 'FAIL' end);
 select (select count(*) from public.users where role='Co-Admin' and committee_id=c3 and is_active)+(select count(*) from public.officer_invites where officer_role='Co-Admin' and committee_id=c3 and status='preparing')=1 into ok;
 r:=r||format(E'\nNO_DOUBLE_COUNT: %s',case when ok then 'PASS' else 'FAIL' end);
 perform public.move_member_to_committee('b8030000-0000-4000-8000-000000000003',c2);
 select role='Member' and committee_id=c2 into ok from public.users where id='b8030000-0000-4000-8000-000000000003';
 r:=r||format(E'\nMOVE_MEMBER_CONSUMES_NO_SEAT: %s',case when ok then 'PASS' else 'FAIL' end);
 perform public.set_officer_active('b8030000-0000-4000-8000-000000000005',false);
 select not is_active into ok from public.users where id='b8030000-0000-4000-8000-000000000005';
 r:=r||format(E'\nDEACTIVATION_REMAINS_AVAILABLE: %s',case when ok then 'PASS' else 'FAIL' end);
 perform public.invite_new_officer('b8031000-0000-4000-8000-000000000005',null,'b803-c2-reserve@test.local','C2 Reserve','Co-Admin',c2);
 denied:=false; begin perform public.set_officer_active('b8030000-0000-4000-8000-000000000005',true); exception when sqlstate 'CCO04' then denied:=true; end;
 r:=r||format(E'\nREACTIVATION_COUNTS_PREPARING: %s',case when denied then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 4 — spoofed writer token, raw writes, and Auth cascade protection

```sql
begin;
-- Minimal fixtures, followed by transaction-only grants so the trigger—not a
-- missing table grant—proves that a forged GUC is insufficient.
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('b8040000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b804-admin@test.local','',now(),'{}','{}',now(),now()),
('b8040000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b804-co@test.local','',now(),'{}','{}',now(),now()),
('b8040000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b804-member@test.local','',now(),'{}','{}',now(),now());
do $$ declare c uuid; begin select id into c from public.committees order by name limit 1; perform set_config('ceit_connect.officer_writer','invite_new_officer',true); insert into public.users(id,email,full_name,role,committee_id) values('b8040000-0000-4000-8000-000000000001','b804-admin@test.local','Admin','Admin',null),('b8040000-0000-4000-8000-000000000002','b804-co@test.local','Co','Co-Admin',c); perform set_config('ceit_connect.officer_writer','',true); insert into public.users(id,email,full_name,role,committee_id) values('b8040000-0000-4000-8000-000000000003','b804-member@test.local','Member','Member',c); end $$;
grant insert,update,delete on public.users to authenticated;
create policy step8_test_authenticated_users_write
on public.users for all to authenticated
using (true) with check (true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b8040000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('ceit_connect.officer_writer','appoint_member_as_officer',true);
do $$
declare r text:=''; denied boolean; c uuid;
begin
 select id into c from public.committees order by name offset 1 limit 1;
 denied:=false; begin update public.users set role='Co-Admin' where id='b8040000-0000-4000-8000-000000000003'; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nAUTH_GUC_CANNOT_CHANGE_ROLE: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin update public.users set committee_id=c where id='b8040000-0000-4000-8000-000000000002'; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nAUTH_GUC_CANNOT_CHANGE_COMMITTEE: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin update public.users set is_active=false where id='b8040000-0000-4000-8000-000000000002'; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nAUTH_GUC_CANNOT_CHANGE_OFFICER_ACTIVE: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin delete from public.users where id='b8040000-0000-4000-8000-000000000002'; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nAUTH_GUC_CANNOT_DELETE_PROFILE: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin insert into public.users(id,email,full_name,role) values(gen_random_uuid(),'forged@test.local','Forged','Admin'); exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nAUTH_GUC_CANNOT_INSERT_OFFICER: %s',case when denied then 'PASS' else 'FAIL' end);
 select not prosecdef into denied from pg_proc where oid='public.guard_officer_user_writes()'::regprocedure;
 r:=r||format(E'\nTRIGGER_IS_SECURITY_INVOKER: %s',case when denied then 'PASS' else 'FAIL' end);
 select pg_get_functiondef('public.guard_officer_user_writes()'::regprocedure) like '%current_user = ''postgres''%' into denied;
 r:=r||format(E'\nTOKEN_REQUIRES_POSTGRES_CURRENT_USER: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin update public.users set role='Admin' where id='b8040000-0000-4000-8000-000000000003'; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nMEMBER_RAW_ROLE_STILL_BLOCKED: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('ceit_connect.test_results',r,true);
end $$;
reset role;
drop policy step8_test_authenticated_users_write on public.users;
revoke insert,update,delete on public.users from authenticated;
do $$ declare r text:=current_setting('ceit_connect.test_results'); denied boolean; ok boolean; begin
 perform set_config('ceit_connect.officer_writer','',true);
 denied:=false; begin delete from auth.users where id='b8040000-0000-4000-8000-000000000002'; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nAUTH_DELETE_CANNOT_CASCADE_PROFILE: %s',case when denied then 'PASS' else 'FAIL' end);
 select exists(select 1 from public.users where id='b8040000-0000-4000-8000-000000000002') into ok;
 r:=r||format(E'\nESTABLISHED_PROFILE_REMAINS: %s',case when ok then 'PASS' else 'FAIL' end);
 execute 'set local role service_role';
 begin update public.users set is_active=false where id='b8040000-0000-4000-8000-000000000002'; denied:=false; exception when sqlstate 'CCO08' then denied:=true; end;
 r:=r||format(E'\nSERVICE_ROLE_RAW_OFFICER_UPDATE_BLOCKED: %s',case when denied then 'PASS' else 'FAIL' end);
 update public.users set is_active=false where id='b8040000-0000-4000-8000-000000000003';
 select not is_active into ok from public.users where id='b8040000-0000-4000-8000-000000000003';
 r:=r||format(E'\nSERVICE_ROLE_MEMBER_SIMPLE_PATH_REMAINS: %s',case when ok then 'PASS' else 'FAIL' end);
 execute 'reset role';
 select pg_get_functiondef('public.guard_officer_user_writes()'::regprocedure) like '%if tg_op = ''DELETE''%' into ok;
 r:=r||format(E'\nDELETE_ALWAYS_REJECTED: %s',case when ok then 'PASS' else 'FAIL' end);
 select pg_get_functiondef('public.guard_officer_user_writes()'::regprocedure) like '%set_officer_active%' into ok;
 r:=r||format(E'\nOFFICER_RPC_PATH_REQUIRED: %s',case when ok then 'PASS' else 'FAIL' end);
 select not has_table_privilege('authenticated','public.users','INSERT') and not has_table_privilege('authenticated','public.users','UPDATE') and not has_table_privilege('authenticated','public.users','DELETE') into ok;
 r:=r||format(E'\nTRACKED_CLIENT_USERS_WRITES_REVOKED: %s',case when ok then 'PASS' else 'FAIL' end);
 select (tgtype::integer & 28)=28 into ok from pg_trigger where tgrelid='public.users'::regclass and tgname='users_guard_officer_writes';
 r:=r||format(E'\nGUARD_COVERS_INSERT_UPDATE_DELETE: %s',case when ok then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 5 — Auth-owned finalization, acceptance, cancellation, and reinvite

```sql
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',x.confirmed,'{}','{}',now(),now()
from (values
 ('b8050000-0000-4000-8000-000000000001'::uuid,'b805-admin@test.local',now()),
 ('b8050000-0000-4000-8000-000000000002','b805-good@test.local',null::timestamptz),
 ('b8050000-0000-4000-8000-000000000003','b805-wrong@test.local',null::timestamptz),
 ('b8050000-0000-4000-8000-000000000004','b805-existing@test.local',now())
) x(id,email,confirmed);
do $$ declare c uuid; begin
 select id into c from public.committees order by name limit 1;
 perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8050000-0000-4000-8000-000000000001','b805-admin@test.local','Admin','Admin',null);
 perform set_config('ceit_connect.officer_writer','',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8050000-0000-4000-8000-000000000004','b805-existing@test.local','Existing','Member',c);
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b8050000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare r text:=''; c uuid; denied boolean; j jsonb; ok boolean;
begin
  select id into c from public.committees order by name limit 1;
  perform public.invite_new_officer('b8051000-0000-4000-8000-000000000001',null,'b805-good@test.local','Good','Co-Admin',c);
  denied:=false; begin perform public.invite_new_officer('b8051000-0000-4000-8000-000000000001','b8059999-0000-4000-8000-000000000001',null,null,null,null); exception when sqlstate 'CCO03' then denied:=true; end;
  r:=r||format(E'\nAUTH_UUID_MUST_EXIST: %s',case when denied then 'PASS' else 'FAIL' end);
  denied:=false; begin perform public.invite_new_officer('b8051000-0000-4000-8000-000000000001','b8050000-0000-4000-8000-000000000003',null,null,null,null); exception when sqlstate 'CCO03' then denied:=true; end;
  r:=r||format(E'\nAUTH_EMAIL_MUST_MATCH_PREPARATION: %s',case when denied then 'PASS' else 'FAIL' end);
  denied:=false; begin perform public.invite_new_officer('b8051000-0000-4000-8000-000000000001','b8050000-0000-4000-8000-000000000002','forged@test.local',null,null,null); exception when sqlstate 'CCO02' then denied:=true; end;
  r:=r||format(E'\nCALLER_DETAILS_FORBIDDEN_ON_FINALIZE: %s',case when denied then 'PASS' else 'FAIL' end);
  select public.invite_new_officer('b8051000-0000-4000-8000-000000000001','b8050000-0000-4000-8000-000000000002',null,null,null,null) into j;
  r:=r||format(E'\nAUTH_ROW_FINALIZES_MATCHED_EMAIL: %s',case when j->>'outcome'='sent' then 'PASS' else 'FAIL' end);
  select email='b805-good@test.local' and role='Co-Admin' into ok from public.users where id='b8050000-0000-4000-8000-000000000002';
  r:=r||format(E'\nPROFILE_DERIVED_FROM_PREPARATION: %s',case when ok then 'PASS' else 'FAIL' end);
  select public.cancel_officer_invite('b8051000-0000-4000-8000-000000000001') into j;
  r:=r||format(E'\nUNACCEPTED_INVITE_CANCELLABLE: %s',case when j->>'cleanup_action'='revoke' then 'PASS' else 'FAIL' end);
  select status='cancelled' and reservation_released_at is not null and cancelled_at is not null into ok from public.officer_invites where id='b8051000-0000-4000-8000-000000000001';
  r:=r||format(E'\nCANCELLATION_COALESCE_PATH_EXECUTED: %s',case when ok then 'PASS' else 'FAIL' end);
  denied:=false; begin perform public.set_officer_active('b8050000-0000-4000-8000-000000000002',true); exception when sqlstate 'CCO03' then denied:=true; end;
  r:=r||format(E'\nCANCELLED_UNCONFIRMED_INVITEE_REACTIVATION_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
  select exists(select 1 from auth.users where id='b8050000-0000-4000-8000-000000000002') and exists(select 1 from public.users where id='b8050000-0000-4000-8000-000000000002') into ok;
  r:=r||format(E'\nCANCELLED_PROFILE_AND_AUTH_REMAIN: %s',case when ok then 'PASS' else 'FAIL' end);
  denied:=false; begin perform public.invite_new_officer('b8051000-0000-4000-8000-000000000002',null,'b805-good@test.local','Again','Co-Admin',c); exception when sqlstate 'CCO03' then denied:=true; end;
  r:=r||format(E'\nCANCELLED_EMAIL_REINVITE_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
  execute 'reset role';
  update auth.users set email_confirmed_at=now() where id='b8050000-0000-4000-8000-000000000002';
  update public.officer_invites set status='sent',cancelled_at=null where id='b8051000-0000-4000-8000-000000000001';
  execute 'set local role authenticated';
  denied:=false; begin perform public.cancel_officer_invite('b8051000-0000-4000-8000-000000000001'); exception when sqlstate 'CCO07' then denied:=true; end;
  r:=r||format(E'\nACCEPTED_EMAIL_CONFIRMED_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
  select count(*)=0 into ok from public.list_pending_officer_invites() where id='b8051000-0000-4000-8000-000000000001';
  r:=r||format(E'\nPENDING_READER_EXCLUDES_ACCEPTED: %s',case when ok then 'PASS' else 'FAIL' end);
  denied:=false; begin perform public.invite_new_officer('b8051000-0000-4000-8000-000000000003',null,'b805-existing@test.local','Existing','Co-Admin',c); exception when sqlstate 'CCO03' then denied:=true; end;
  r:=r||format(E'\nEXISTING_PROFILE_EMAIL_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
  select count(*)=1 into ok from public.users where lower(btrim(email))='b805-good@test.local';
  r:=r||format(E'\nNO_DUPLICATE_ACCOUNT_HISTORY: %s',case when ok then 'PASS' else 'FAIL' end);
  select pg_get_functiondef('public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure) like '%from auth.users%' into ok;
  r:=r||format(E'\nAUTH_EMAIL_READ_IN_DEFINER: %s',case when ok then 'PASS' else 'FAIL' end);
  select pg_get_functiondef('public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure) like '%profile.id = p_auth_user_id%' into ok;
  r:=r||format(E'\nFINALIZE_REQUIRES_NO_PROFILE: %s',case when ok then 'PASS' else 'FAIL' end);
  select count(*)=1 into ok from public.officer_invites where email='b805-good@test.local' and status='sent';
  r:=r||format(E'\nREINVITE_REQUIRES_FUTURE_RECOVERY_FLOW: %s',case when ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 6 — rollback-only concurrency proof through bodies and catalogs

```sql
begin;
do $$
declare
  r text := '';
  fn regprocedure;
  body text;
  begin_pos integer;
  lock_pos integer;
  first_read_pos integer;
  row_lock_pos integer;
  affected_pos integer;
  reset_pos integer;
  ok boolean;
begin
  foreach fn in array array[
    'public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure,
    'public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure,
    'public.return_coadmin_to_member(uuid,uuid)'::regprocedure,
    'public.move_member_to_committee(uuid,uuid)'::regprocedure,
    'public.cancel_officer_invite(uuid)'::regprocedure,
    'public.step_down_as_admin(uuid)'::regprocedure,
    'public.set_officer_active(uuid,boolean)'::regprocedure
  ] loop
    body := lower(pg_get_functiondef(fn));
    begin_pos := strpos(body,'begin');
    lock_pos := strpos(body,'pg_advisory_xact_lock');
    first_read_pos := least(
      case when strpos(body,' select ') = 0 then 2147483647 else strpos(body,' select ') end,
      case when strpos(body,' from public.') = 0 then 2147483647 else strpos(body,' from public.') end,
      case when strpos(body,'officer_require_active_admin') = 0 then 2147483647 else strpos(body,'officer_require_active_admin') end
    );
    ok := lock_pos > begin_pos and lock_pos < first_read_pos;
    r:=r||format(E'\nLOCK_FIRST_%s: %s',fn::text,case when ok then 'PASS' else 'FAIL' end);
    ok := body like '%public.officer_advisory_lock_key()%'
      and (length(body)-length(replace(body,'pg_advisory_xact_lock','')))/length('pg_advisory_xact_lock')=1;
    r:=r||format(E'\nONE_SHARED_KEY_%s: %s',fn::text,case when ok then 'PASS' else 'FAIL' end);
    row_lock_pos := strpos(body,'for update');
    affected_pos := strpos(body,'get diagnostics');
    reset_pos := strpos(body,'set_config(''ceit_connect.officer_writer'', '''', true)');
    ok := row_lock_pos > lock_pos
      and affected_pos > row_lock_pos
      and (reset_pos = 0 or affected_pos < reset_pos)
      and body like '%if v_affected <> 1%'
      and (fn <> 'public.cancel_officer_invite(uuid)'::regprocedure
           or body like '%if v_affected not in (0, 1)%');
    r:=r||format(E'\nROW_LOCK_AND_EXACT_AFFECTED_CHECK_%s: %s',fn::text,case when ok then 'PASS' else 'FAIL' end);
  end loop;
  body:=lower(pg_get_functiondef('public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure));
  r:=r||format(E'\nINVITE_UUID_ORDER_BEFORE_ROW_LOCK: %s',case when strpos(body,'order by invitation.id')>0 and strpos(body,'order by invitation.id')<strpos(body,'for update') then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nLOCK_HELPER_IMMUTABLE_UNGRANTED: %s',case when (select provolatile='i' from pg_proc where oid='public.officer_advisory_lock_key()'::regprocedure) and not has_function_privilege('authenticated','public.officer_advisory_lock_key()','EXECUTE') then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nWRITERS_VOLATILE: %s',case when (select bool_and(provolatile='v') from pg_proc where oid=any(array['public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure::oid,'public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure::oid,'public.return_coadmin_to_member(uuid,uuid)'::regprocedure::oid,'public.move_member_to_committee(uuid,uuid)'::regprocedure::oid,'public.cancel_officer_invite(uuid)'::regprocedure::oid,'public.step_down_as_admin(uuid)'::regprocedure::oid,'public.set_officer_active(uuid,boolean)'::regprocedure::oid])) then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nWRITERS_DEFINER_EMPTY_PATH: %s',case when (select bool_and(prosecdef and coalesce(array_to_string(proconfig,','),'') in ('search_path=','search_path=""')) from pg_proc where oid=any(array['public.invite_new_officer(uuid,uuid,text,text,text,uuid)'::regprocedure::oid,'public.appoint_member_as_officer(uuid,text,uuid)'::regprocedure::oid,'public.return_coadmin_to_member(uuid,uuid)'::regprocedure::oid,'public.move_member_to_committee(uuid,uuid)'::regprocedure::oid,'public.cancel_officer_invite(uuid)'::regprocedure::oid,'public.step_down_as_admin(uuid)'::regprocedure::oid,'public.set_officer_active(uuid,boolean)'::regprocedure::oid])) then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nTRIGGER_INVOKER_EMPTY_PATH: %s',case when (select not prosecdef and coalesce(array_to_string(proconfig,','),'') in ('search_path=','search_path=""') from pg_proc where oid='public.guard_officer_user_writes()'::regprocedure) then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nEXACT_AUTHENTICATED_GRANTS: %s',case when has_function_privilege('authenticated','public.invite_new_officer(uuid,uuid,text,text,text,uuid)','EXECUTE') and has_function_privilege('authenticated','public.set_officer_active(uuid,boolean)','EXECUTE') and not has_function_privilege('anon','public.set_officer_active(uuid,boolean)','EXECUTE') then 'PASS' else 'FAIL' end);
  r:=r||format(E'\nNO_UNEXPECTED_OVERLOADS: %s',case when (select count(*)=1 from pg_proc where pronamespace='public'::regnamespace and proname='invite_new_officer') then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 7 — caller matrix and transition validation

```sql
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),'{}','{}',now(),now()
from (values
 ('b8070000-0000-4000-8000-000000000001'::uuid,'b807-a1@test.local'),
 ('b8070000-0000-4000-8000-000000000002','b807-a2@test.local'),
 ('b8070000-0000-4000-8000-000000000003','b807-inactive@test.local'),
 ('b8070000-0000-4000-8000-000000000004','b807-co@test.local'),
 ('b8070000-0000-4000-8000-000000000005','b807-member@test.local'),
 ('b8070000-0000-4000-8000-000000000006','b807-profileless@test.local')
) x(id,email);
do $$ declare c uuid; begin
 select id into c from public.committees order by name limit 1;
 perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
 insert into public.users(id,email,full_name,role,committee_id,is_active) values
 ('b8070000-0000-4000-8000-000000000001','b807-a1@test.local','A1','Admin',null,true),
 ('b8070000-0000-4000-8000-000000000002','b807-a2@test.local','A2','Admin',null,true),
 ('b8070000-0000-4000-8000-000000000003','b807-inactive@test.local','Inactive','Admin',null,false),
 ('b8070000-0000-4000-8000-000000000004','b807-co@test.local','Co','Co-Admin',c,true);
 perform set_config('ceit_connect.officer_writer','',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8070000-0000-4000-8000-000000000005','b807-member@test.local','Member','Member',c);
end $$;
set local role authenticated;
do $$
declare r text:=''; denied boolean; c uuid; bad uuid:='b8079999-0000-4000-8000-000000000001';
begin
 select id into c from public.committees order by name limit 1;
 perform set_config('request.jwt.claims','{"sub":"b8070000-0000-4000-8000-000000000004","role":"authenticated"}',true);
 denied:=false; begin perform public.appoint_member_as_officer('b8070000-0000-4000-8000-000000000005','Co-Admin',c); exception when sqlstate 'CCO01' then denied:=true; end;
 r:=r||format(E'\nCOADMIN_CALLER_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.list_pending_officer_invites(); exception when sqlstate 'CCO01' then denied:=true; end;
 r:=r||format(E'\nPENDING_READER_COADMIN_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"b8070000-0000-4000-8000-000000000005","role":"authenticated"}',true);
 denied:=false; begin perform public.move_member_to_committee('b8070000-0000-4000-8000-000000000005',c); exception when sqlstate 'CCO01' then denied:=true; end;
 r:=r||format(E'\nMEMBER_CALLER_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"b8070000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 denied:=false; begin perform public.step_down_as_admin(c); exception when sqlstate 'CCO01' then denied:=true; end;
 r:=r||format(E'\nINACTIVE_ADMIN_CALLER_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"b8070000-0000-4000-8000-000000000006","role":"authenticated"}',true);
 denied:=false; begin perform public.cancel_officer_invite(bad); exception when sqlstate 'CCO01' then denied:=true; end;
 r:=r||format(E'\nPROFILELESS_CALLER_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{}',true);
 denied:=false; begin perform public.cancel_officer_invite(bad); exception when sqlstate 'CCO01' then denied:=true; end;
 r:=r||format(E'\nSIGNED_OUT_CALLER_DENIED: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('request.jwt.claims','{"sub":"b8070000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 denied:=false; begin perform public.return_coadmin_to_member('b8070000-0000-4000-8000-000000000002',c); exception when sqlstate 'CCO03' then denied:=true; end;
 r:=r||format(E'\nADMIN_CANNOT_RETURN_OTHER_ADMIN: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.set_officer_active('b8070000-0000-4000-8000-000000000002',false); exception when sqlstate 'CCO03' then denied:=true; end;
 r:=r||format(E'\nADMIN_CANNOT_DEACTIVATE_OTHER_ADMIN: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.set_officer_active('b8070000-0000-4000-8000-000000000001',false); exception when sqlstate 'CCO03' then denied:=true; end;
 r:=r||format(E'\nADMIN_CANNOT_DEACTIVATE_SELF: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.appoint_member_as_officer('b8070000-0000-4000-8000-000000000005','Co-Admin',bad); exception when sqlstate 'CCO02' then denied:=true; end;
 r:=r||format(E'\nINVALID_COMMITTEE_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.move_member_to_committee('b8070000-0000-4000-8000-000000000004',c); exception when sqlstate 'CCO03' then denied:=true; end;
 r:=r||format(E'\nMOVE_REQUIRES_MEMBER_TARGET: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.return_coadmin_to_member('b8070000-0000-4000-8000-000000000005',c); exception when sqlstate 'CCO03' then denied:=true; end;
 r:=r||format(E'\nRETURN_REQUIRES_COADMIN_TARGET: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.cancel_officer_invite(bad); exception when sqlstate 'CCO03' then denied:=true; end;
 r:=r||format(E'\nUNKNOWN_INVITE_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.step_down_as_admin(bad); exception when sqlstate 'CCO02' then denied:=true; end;
 r:=r||format(E'\nSTEPDOWN_INVALID_COMMITTEE_REJECTED: %s',case when denied then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 8 — zero-row writer assertions are not masked by token reset

```sql
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),'{}','{}',now(),now()
from (values
 ('b8080000-0000-4000-8000-000000000001'::uuid,'b808-a1@test.local'),
 ('b8080000-0000-4000-8000-000000000002','b808-a2@test.local'),
 ('b8080000-0000-4000-8000-000000000003','b808-co@test.local'),
 ('b8080000-0000-4000-8000-000000000004','b808-member@test.local')
) x(id,email);
do $$ declare c uuid; begin
 select id into c from public.committees order by name limit 1;
 perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8080000-0000-4000-8000-000000000001','b808-a1@test.local','A1','Admin',null),
 ('b8080000-0000-4000-8000-000000000002','b808-a2@test.local','A2','Admin',null),
 ('b8080000-0000-4000-8000-000000000003','b808-co@test.local','Co','Co-Admin',c);
 perform set_config('ceit_connect.officer_writer','',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8080000-0000-4000-8000-000000000004','b808-member@test.local','Member','Member',c);
end $$;
create function pg_temp.step8_suppress_target_update()
returns trigger language plpgsql as $$
begin
  if new.id::text = current_setting('test.step8_suppress_user',true) then
    return null;
  end if;
  return new;
end $$;
create trigger zz_step8_suppress_target_update
before update on public.users
for each row execute function pg_temp.step8_suppress_target_update();
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b8080000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare r text:=''; denied boolean; c1 uuid; c2 uuid;
begin
 select id into c1 from public.committees order by name limit 1;
 select id into c2 from public.committees order by name offset 1 limit 1;
 perform set_config('test.step8_suppress_user','b8080000-0000-4000-8000-000000000004',true);
 denied:=false; begin perform public.appoint_member_as_officer('b8080000-0000-4000-8000-000000000004','Co-Admin',c1); exception when sqlstate 'CCO06' then denied:=true; end;
 r:=r||format(E'\nAPPOINT_ZERO_ROW_ASSERTION_FIRES: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.move_member_to_committee('b8080000-0000-4000-8000-000000000004',c2); exception when sqlstate 'CCO06' then denied:=true; end;
 r:=r||format(E'\nMOVE_ZERO_ROW_ASSERTION_FIRES: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('test.step8_suppress_user','b8080000-0000-4000-8000-000000000003',true);
 denied:=false; begin perform public.return_coadmin_to_member('b8080000-0000-4000-8000-000000000003',c1); exception when sqlstate 'CCO06' then denied:=true; end;
 r:=r||format(E'\nRETURN_ZERO_ROW_ASSERTION_FIRES: %s',case when denied then 'PASS' else 'FAIL' end);
 denied:=false; begin perform public.set_officer_active('b8080000-0000-4000-8000-000000000003',false); exception when sqlstate 'CCO06' then denied:=true; end;
 r:=r||format(E'\nACTIVE_ZERO_ROW_ASSERTION_FIRES: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('test.step8_suppress_user','b8080000-0000-4000-8000-000000000001',true);
 denied:=false; begin perform public.step_down_as_admin(c1); exception when sqlstate 'CCO06' then denied:=true; end;
 r:=r||format(E'\nSTEPDOWN_ZERO_ROW_ASSERTION_FIRES: %s',case when denied then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## TEST 9 — step-down requires a confirmed active successor

```sql
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('b8090000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b809-caller@test.local','',now(),'{}','{}',now(),now()),
('b8090000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b809-invitee@test.local','',null,'{}','{}',now(),now());
do $$ declare c uuid; begin
 select id into c from public.committees order by name limit 1;
 perform set_config('ceit_connect.officer_writer','invite_new_officer',true);
 insert into public.users(id,email,full_name,role,committee_id) values
 ('b8090000-0000-4000-8000-000000000001','b809-caller@test.local','Caller Admin','Admin',null),
 ('b8090000-0000-4000-8000-000000000002','b809-invitee@test.local','Invited Admin','Admin',null);
 perform set_config('ceit_connect.officer_writer','',true);
 insert into public.officer_invites(id,email,full_name,officer_role,committee_id,auth_user_id,invited_by,status,sent_at,reservation_released_at)
 values('b8091000-0000-4000-8000-000000000001','b809-invitee@test.local','Invited Admin','Admin',null,'b8090000-0000-4000-8000-000000000002','b8090000-0000-4000-8000-000000000001','sent',now(),now());
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b8090000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare r text:=''; c uuid; denied boolean; begin
 select id into c from public.committees order by name limit 1;
 denied:=false;
 begin perform public.step_down_as_admin(c); exception when sqlstate 'CCO09' then denied:=true; end;
 r:=r||format(E'\nUNCONFIRMED_ONLY_OTHER_ADMIN_REJECTS_STEPDOWN: %s',case when denied then 'PASS' else 'FAIL' end);
 perform set_config('test.step8_stepdown_results',r,true);
end $$;
reset role;
update auth.users set email_confirmed_at=now() where id='b8090000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ declare r text:=current_setting('test.step8_stepdown_results'); c uuid; ok boolean; begin
 select id into c from public.committees order by name limit 1;
 perform public.step_down_as_admin(c);
 select caller.role='Member' and caller.committee_id=c
 into ok
 from public.users caller
 where caller.id='b8090000-0000-4000-8000-000000000001';
 r:=r||format(E'\nCONFIRMED_OTHER_ADMIN_ALLOWS_STEPDOWN: %s',case when ok then 'PASS' else 'FAIL' end);
 raise exception 'TEST RESULTS %',r;
end $$;
rollback;
```

## Historical regression reruns

Counts below were checked against the source-count ledger in
`docs/PHASE-4-STEP-10E-GATE.md`, not copied from the earlier draft plan:

- Batch 0 current users suite: `32` lines.
- Phase 4 Step 2 unaffected Tests 1–4 and 6: `8 / 6 / 6 / 5 / 10`.
  Test 5's former four-policy assertion stays historical.
- Phase 4 Step 3 unaffected Tests 1–5: `2 / 2 / 5 / 5 / 2`.
  Test 6's former users-policy catalog stays historical.
- Phase 4 Step 4 unaffected Tests 1–5 and 7: `4 / 6 / 4 / 5 / 3 / 5`.
  Test 6's former users-policy assertion stays historical.
- Current Step 10 raw-read and write-gate pastes: `10 / 16`.

### Test-only officer fixture token added to older pastes

The Batch 8 users guard remains strict. The following rollback-only owner-run
pastes now set `ceit_connect.officer_writer = 'invite_new_officer'` before
their direct Admin/Co-Admin fixture inserts:

- Batch 0: its single 32-line paste.
- Phase 4 Step 2: Tests 1–5. Test 6 has no officer-profile fixture insert.
- Phase 4 Step 3: Tests 1–6.
- Phase 4 Step 4: Tests 1–7.
- Phase 4 Step 10: 10C-1, 10B-1, 10B-2, 10C-2, 10C-3, 10D-1,
  10D-2, and 10D-3. The read-only 10A catalog paste needs no token.

The token does not weaken the trigger: those pastes run fixture setup as
`postgres`, while an authenticated caller setting the same GUC still fails
TEST 4 because `current_user` is not `postgres`.

Phase 4 Step 4 TEST 4 and TEST 7 additionally disable only
`users_guard_officer_writes` immediately around their intentional
`auth.users` deletion, then re-enable it before evaluating or raising their
final `TEST RESULTS`. This preserves foreign-key cascades and does not use
`session_replication_role`.

## Manual Auth acceptance row — required on Dev

This cannot be claimed locally and must be completed with a real Dev invitation:

1. Record only whether `auth.users.email_confirmed_at` and `last_sign_in_at` are
   null for the invited Auth UUID; do not copy tokens or secrets.
2. Accept once through the email invitation and record which columns become
   non-null.
3. Repeat with a separately invited address accepted through Google.
4. Confirm the app callback admits both only after its existing
   `email_confirmed_at` check succeeds.
5. If Google acceptance does not make `email_confirmed_at` non-null, stop before
   UI implementation and revise the cancellation predicate through a new
   migration; do not silently switch to `last_sign_in_at`.

The migration uses `email_confirmed_at` provisionally because the current
callback already treats that field as the verified-email admission contract.
`last_sign_in_at` proves a login occurred, not specifically that the invited
email identity was verified.
