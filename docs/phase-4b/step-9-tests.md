# Step 9 — Co-Admin user management tests

Run this paste on **Dev only**, after the owner has reviewed and applied
`20261026150000_coadmin_user_management.sql`. Choose **Run without RLS**. The
paste is one transaction, creates its own fixtures, and ends with the
intentional `TEST RESULTS` exception so every fixture is rolled back.

Expected result: exactly **116 result lines**, broken down as follows:

- 81 matrix lines: the 9 Step 9 matrix rows × 9 capability columns.
- 5 stale-state lines.
- 11 reader/search/paging lines.
- 15 catalog and boundary lines.
- 4 Member-invite identity lines.

The count is unchanged when `public.users.anonymized_at` is absent. In that
case, its one counted stale-state line reads
`ANONYMIZED_CASE: SKIPPED (column absent)`.

The SQL matrix treats cells labelled “Admin contract” or “Step 8 contract” in
`step-9.md` as delegation assertions: Step 9's Co-Admin functions must not
grant those operations. The established Admin route and Step 8 SQL suites are
rerun separately below.

## One rollback-safe SQL paste

```sql
begin;

create temporary table step9_results (
  sequence integer generated always as identity,
  label text not null,
  outcome text not null
) on commit drop;

create function pg_temp.step9_record(
  p_label text,
  p_ok boolean,
  p_override text default null
)
returns void
language sql
security definer
set search_path = pg_temp
as $$
  insert into step9_results(label, outcome)
  values (
    p_label,
    coalesce(p_override, case when p_ok then 'PASS' else 'FAIL' end)
  );
$$;

create function pg_temp.step9_probe(
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
    raise exception using errcode = 'P9000', message = 'rollback successful probe';
  exception
    when sqlstate 'P9000' then
      v_succeeded := true;
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      v_succeeded := false;
  end;

  perform pg_temp.step9_record(
    p_label,
    v_succeeded = p_expect_success
      and (
        p_expect_success
        or p_expected_sqlstate is null
        or v_sqlstate = p_expected_sqlstate
      )
  );
end;
$$;

create function pg_temp.step9_query(p_label text, p_sql text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  execute p_sql into v_ok;
  perform pg_temp.step9_record(p_label, coalesce(v_ok, false));
exception when others then
  perform pg_temp.step9_record(p_label, false);
end;
$$;

-- Fixed fixtures.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, invited_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select fixture.id,
       '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', fixture.email, '',
       fixture.confirmed_at, fixture.invited_at, fixture.last_sign_in_at,
       '{}', '{}', now(), now()
from (values
  ('b9000000-0000-4000-8000-000000000001'::uuid, 'b9-admin@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000002'::uuid, 'b9-admin2@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000003'::uuid, 'b9-co-own@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000004'::uuid, 'b9-co-other@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000005'::uuid, 'b9-co-null@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000006'::uuid, 'b9-own-active@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000007'::uuid, 'b9-own-inactive@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000008'::uuid, 'b9-other-active@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-000000000009'::uuid, 'b9-other-inactive@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-00000000000a'::uuid, 'b9-inactive-co@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-00000000000b'::uuid, 'b9-inactive-admin@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-00000000000c'::uuid, 'b9-member-caller@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-00000000000d'::uuid, 'b9-profileless@test.local', now(), null::timestamptz, now()),
  ('b9000000-0000-4000-8000-00000000000e'::uuid, 'b9-pending-admin@test.local', null::timestamptz, now(), null::timestamptz),
  ('b9000000-0000-4000-8000-00000000000f'::uuid, 'b9-pending-co@test.local', null::timestamptz, now(), null::timestamptz),
  ('b9000000-0000-4000-8000-000000000010'::uuid, 'b9-auth-actual@test.local', null::timestamptz, now(), null::timestamptz),
  ('b9000000-0000-4000-8000-000000000011'::uuid, 'b9-existing@test.local', null::timestamptz, now(), null::timestamptz),
  ('b9000000-0000-4000-8000-000000000012'::uuid, 'b9-officer-collision@test.local', null::timestamptz, now(), null::timestamptz)
) as fixture(id,email,confirmed_at,invited_at,last_sign_in_at);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('b9001000-0000-4000-8000-' || pg_catalog.lpad(i::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated',
       'b9-page-' || i || '@test.local', '', now(), '{}', '{}', now(), now()
from pg_catalog.generate_series(1, 27) as series(i);

do $$
declare
  c1 uuid;
  c2 uuid;
begin
  select id into c1 from public.committees order by name, id limit 1;
  select id into c2 from public.committees order by name, id offset 1 limit 1;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    ('b9000000-0000-4000-8000-000000000001','b9-admin@test.local','B9 Admin','Admin',null,true),
    ('b9000000-0000-4000-8000-000000000002','b9-admin2@test.local','B9 Admin Two','Admin',null,true),
    ('b9000000-0000-4000-8000-000000000003','b9-co-own@test.local','B9 Own Co-Admin','Co-Admin',c1,true),
    ('b9000000-0000-4000-8000-000000000004','b9-co-other@test.local','B9 Other Co-Admin','Co-Admin',c2,true),
    ('b9000000-0000-4000-8000-000000000005','b9-co-null@test.local','B9 Null Co-Admin','Co-Admin',null,true),
    ('b9000000-0000-4000-8000-00000000000a','b9-inactive-co@test.local','B9 Inactive Co-Admin','Co-Admin',c1,false),
    ('b9000000-0000-4000-8000-00000000000b','b9-inactive-admin@test.local','B9 Inactive Admin','Admin',null,false);
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  insert into public.users(id,email,full_name,role,committee_id,is_active) values
    ('b9000000-0000-4000-8000-000000000006','b9-own-active@test.local','B9 Own Active','Member',c1,true),
    ('b9000000-0000-4000-8000-000000000007','b9-own-inactive@test.local','B9 Own Inactive','Member',c1,false),
    ('b9000000-0000-4000-8000-000000000008','b9-other-active@test.local','B9 Other Active','Member',c2,true),
    ('b9000000-0000-4000-8000-000000000009','b9-other-inactive@test.local','B9 Other Inactive','Member',c2,false),
    ('b9000000-0000-4000-8000-00000000000c','b9-member-caller@test.local','B9 Member Caller','Member',c1,true),
    ('b9000000-0000-4000-8000-000000000011','b9-existing@test.local','B9 Existing Profile','Member',c1,true);

  insert into public.users(id,email,full_name,role,committee_id,is_active)
  select ('b9001000-0000-4000-8000-' || pg_catalog.lpad(i::text, 12, '0'))::uuid,
         'b9-page-' || i || '@test.local',
         case
           when i = 26 then 'ZZZ Whole Tab Needle'
           when i = 27 then E'ZZZ Literal %_\\ Match'
           else 'B9 Paged ' || pg_catalog.lpad(i::text, 2, '0')
         end,
         'Member', c1, true
  from pg_catalog.generate_series(1, 27) as series(i);

  insert into public.officer_invites (
    id, email, full_name, officer_role, committee_id, auth_user_id,
    invited_by, status, sent_at, reservation_released_at
  ) values (
    'b9008000-0000-4000-8000-000000000001',
    'b9-officer-collision@test.local',
    'Officer Collision',
    'Co-Admin',
    c2,
    'b9000000-0000-4000-8000-000000000012',
    'b9000000-0000-4000-8000-000000000001',
    'sent',
    now(),
    now()
  );
end $$;

set local role authenticated;

-- MATRIX ROW 1: active Admin -> Member, any committee.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step9_query('M01_VIEW_MEMBER', $$select exists(select 1 from public.list_managed_users(true,null,0) where id='b9000000-0000-4000-8000-000000000008')$$);
select pg_temp.step9_probe('M01_INVITE_MEMBER', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000e','B9-PENDING-ADMIN@TEST.LOCAL',' Admin Invited ',(select id from public.committees order by name,id offset 1 limit 1))$$, true);
select pg_temp.step9_probe('M01_DEACTIVATE_ADMIN_CONTRACT', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, false, 'CCM01');
select pg_temp.step9_probe('M01_REACTIVATE_ADMIN_CONTRACT', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-000000000007')$$, false, 'CCM01');
select pg_temp.step9_probe('M01_EDIT_NAME_ADMIN_CONTRACT', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000006','Admin Edit')$$, false, 'CCM01');
select pg_temp.step9_probe('M01_CHANGE_ROLE_NO_GENERIC_PATH', $$update public.users set role='Co-Admin' where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');
select pg_temp.step9_probe('M01_MOVE_COMMITTEE_STEP8_CONTRACT', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000006',(select id from public.committees order by name,id offset 1 limit 1))$$, true);
select pg_temp.step9_probe('M01_INVITE_OFFICER_STEP8_CONTRACT', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000001',null,'b9-new-officer@test.local','New Officer','Co-Admin',(select id from public.committees order by name,id offset 1 limit 1))$$, true);
select pg_temp.step9_probe('M01_DELETE_ANONYMIZE_STEP10_ONLY', $$delete from public.users where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');

-- MATRIX ROW 2: active Admin -> Admin/Co-Admin.
select pg_temp.step9_query('M02_VIEW_OFFICER', $$select exists(select 1 from public.list_managed_users(true,null,0) where id='b9000000-0000-4000-8000-000000000003')$$);
select pg_temp.step9_probe('M02_INVITE_MEMBER_ADMIN_SCOPE', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000e','b9-pending-admin@test.local','Admin Invited',(select id from public.committees order by name,id limit 1))$$, true);
select pg_temp.step9_probe('M02_DEACTIVATE_OFFICER_NOT_MEMBER_PATH', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000003')$$, false, 'CCM01');
select pg_temp.step9_probe('M02_REACTIVATE_OFFICER_NOT_MEMBER_PATH', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-00000000000a')$$, false, 'CCM01');
select pg_temp.step9_probe('M02_EDIT_OFFICER_NOT_MEMBER_PATH', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000003','Forged')$$, false, 'CCM01');
select pg_temp.step9_probe('M02_CHANGE_ROLE_NO_GENERIC_PATH', $$update public.users set role='Member' where id='b9000000-0000-4000-8000-000000000003'$$, false, '42501');
select pg_temp.step9_probe('M02_MOVE_OFFICER_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000003',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CCO03');
select pg_temp.step9_probe('M02_INVITE_OFFICER_STEP8_ONLY', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000002',null,'b9-new-admin@test.local','New Admin','Admin',null)$$, true);
select pg_temp.step9_probe('M02_DELETE_OFFICER_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000003'$$, false, '42501');

-- MATRIX ROW 3: active Co-Admin -> own-committee Member.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step9_query('M03_VIEW_OWN_MEMBER', $$select exists(select 1 from public.list_managed_users(true,null,0) where id='b9000000-0000-4000-8000-000000000006')$$);
select pg_temp.step9_probe('M03_INVITE_OWN_MEMBER', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000f','b9-pending-co@test.local',' Co Invited ',null)$$, true);
select pg_temp.step9_probe('M03_DEACTIVATE_OWN_MEMBER', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, true);
select pg_temp.step9_probe('M03_REACTIVATE_OWN_MEMBER', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-000000000007')$$, true);
select pg_temp.step9_probe('M03_EDIT_OWN_MEMBER_NAME', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000006',E'\u00a0Renamed Own Member\u00a0')$$, true);
select pg_temp.step9_probe('M03_CHANGE_ROLE_DENIED', $$update public.users set role='Co-Admin' where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');
select pg_temp.step9_probe('M03_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000006',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M03_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000003',null,'b9-forged-officer@test.local','Forged Officer','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M03_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');

-- MATRIX ROW 4: active Co-Admin -> other-committee Member.
select pg_temp.step9_query('M04_VIEW_OTHER_MEMBER_DENIED', $$select not exists(select 1 from public.list_managed_users(true,null,0) where id='b9000000-0000-4000-8000-000000000008')$$);
select pg_temp.step9_probe('M04_INVITE_OTHER_COMMITTEE_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000f','b9-pending-co@test.local','Forged Committee',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CCM02');
select pg_temp.step9_probe('M04_DEACTIVATE_OTHER_MEMBER_DENIED', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000008')$$, false, 'CCM03');
select pg_temp.step9_probe('M04_REACTIVATE_OTHER_MEMBER_DENIED', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-000000000009')$$, false, 'CCM03');
select pg_temp.step9_probe('M04_EDIT_OTHER_MEMBER_DENIED', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000008','Forged')$$, false, 'CCM03');
select pg_temp.step9_probe('M04_CHANGE_ROLE_DENIED', $$update public.users set role='Co-Admin' where id='b9000000-0000-4000-8000-000000000008'$$, false, '42501');
select pg_temp.step9_probe('M04_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000008',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M04_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000004',null,'b9-forged-officer2@test.local','Forged Officer','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M04_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000008'$$, false, '42501');

-- MATRIX ROW 5: active Co-Admin -> Admin.
select pg_temp.step9_query('M05_VIEW_ADMIN_DENIED', $$select not exists(select 1 from public.list_managed_users(true,null,0) where id='b9000000-0000-4000-8000-000000000001')$$);
select pg_temp.step9_probe('M05_INVITE_AS_ADMIN_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-000000000001','b9-admin@test.local','Forged Admin',null)$$, false, 'CCM06');
select pg_temp.step9_probe('M05_DEACTIVATE_ADMIN_DENIED', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000001')$$, false, 'CCM03');
select pg_temp.step9_probe('M05_REACTIVATE_ADMIN_DENIED', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-00000000000b')$$, false, 'CCM03');
select pg_temp.step9_probe('M05_EDIT_ADMIN_DENIED', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000001','Forged')$$, false, 'CCM03');
select pg_temp.step9_probe('M05_CHANGE_ROLE_DENIED', $$update public.users set role='Member' where id='b9000000-0000-4000-8000-000000000001'$$, false, '42501');
select pg_temp.step9_probe('M05_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000001',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M05_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000005',null,'b9-forged-admin@test.local','Forged Admin','Admin',null)$$, false, 'CCO01');
select pg_temp.step9_probe('M05_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000001'$$, false, '42501');

-- MATRIX ROW 6: active Co-Admin -> Co-Admin, same or other committee.
select pg_temp.step9_query('M06_VIEW_COADMIN_DENIED', $$select not exists(select 1 from public.list_managed_users(true,null,0) where id in ('b9000000-0000-4000-8000-000000000003','b9000000-0000-4000-8000-000000000004'))$$);
select pg_temp.step9_probe('M06_INVITE_AS_COADMIN_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-000000000004','b9-co-other@test.local','Forged Co-Admin',null)$$, false, 'CCM06');
select pg_temp.step9_probe('M06_DEACTIVATE_COADMIN_DENIED', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000004')$$, false, 'CCM03');
select pg_temp.step9_probe('M06_REACTIVATE_COADMIN_DENIED', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-00000000000a')$$, false, 'CCM03');
select pg_temp.step9_probe('M06_EDIT_COADMIN_DENIED', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000004','Forged')$$, false, 'CCM03');
select pg_temp.step9_probe('M06_CHANGE_ROLE_DENIED', $$update public.users set role='Member' where id='b9000000-0000-4000-8000-000000000004'$$, false, '42501');
select pg_temp.step9_probe('M06_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000004',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M06_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000006',null,'b9-forged-coadmin@test.local','Forged Co-Admin','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M06_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000004'$$, false, '42501');

-- MATRIX ROW 7: active Member -> any target.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000c","role":"authenticated"}',true);
select pg_temp.step9_query('M07_VIEW_MANAGEMENT_DENIED', $$select count(*)=0 from public.list_managed_users(true,null,0)$$);
select pg_temp.step9_probe('M07_INVITE_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000f','b9-pending-co@test.local','Forged',null)$$, false, 'CCM01');
select pg_temp.step9_probe('M07_DEACTIVATE_DENIED', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, false, 'CCM01');
select pg_temp.step9_probe('M07_REACTIVATE_DENIED', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-000000000007')$$, false, 'CCM01');
select pg_temp.step9_probe('M07_EDIT_NAME_DENIED', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000006','Forged')$$, false, 'CCM01');
select pg_temp.step9_probe('M07_CHANGE_ROLE_DENIED', $$update public.users set role='Co-Admin' where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');
select pg_temp.step9_probe('M07_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000006',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M07_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000007',null,'b9-member-officer@test.local','Forged','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M07_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');

-- MATRIX ROW 8: inactive Admin/Co-Admin -> any target.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000b","role":"authenticated"}',true);
select pg_temp.step9_query('M08_VIEW_MANAGEMENT_DENIED', $$select count(*)=0 from public.list_managed_users(true,null,0)$$);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000a","role":"authenticated"}',true);
select pg_temp.step9_probe('M08_INVITE_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000f','b9-pending-co@test.local','Forged',null)$$, false, 'CCM01');
select pg_temp.step9_probe('M08_DEACTIVATE_DENIED', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, false, 'CCM01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000b","role":"authenticated"}',true);
select pg_temp.step9_probe('M08_REACTIVATE_DENIED', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-000000000007')$$, false, 'CCM01');
select pg_temp.step9_probe('M08_EDIT_NAME_DENIED', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000006','Forged')$$, false, 'CCM01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000a","role":"authenticated"}',true);
select pg_temp.step9_probe('M08_CHANGE_ROLE_DENIED', $$update public.users set role='Co-Admin' where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');
select pg_temp.step9_probe('M08_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000006',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CCO01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000b","role":"authenticated"}',true);
select pg_temp.step9_probe('M08_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000008',null,'b9-inactive-officer@test.local','Forged','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M08_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');

-- MATRIX ROW 9: profile-less authenticated caller -> any target.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000d","role":"authenticated"}',true);
select pg_temp.step9_query('M09_VIEW_MANAGEMENT_DENIED', $$select count(*)=0 from public.list_managed_users(true,null,0)$$);
select pg_temp.step9_probe('M09_INVITE_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-00000000000f','b9-pending-co@test.local','Forged',null)$$, false, 'CCM01');
select pg_temp.step9_probe('M09_DEACTIVATE_DENIED', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, false, 'CCM01');
select pg_temp.step9_probe('M09_REACTIVATE_DENIED', $$select public.reactivate_committee_member('b9000000-0000-4000-8000-000000000007')$$, false, 'CCM01');
select pg_temp.step9_probe('M09_EDIT_NAME_DENIED', $$select public.update_committee_member_full_name('b9000000-0000-4000-8000-000000000006','Forged')$$, false, 'CCM01');
select pg_temp.step9_probe('M09_CHANGE_ROLE_DENIED', $$update public.users set role='Co-Admin' where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');
select pg_temp.step9_probe('M09_MOVE_COMMITTEE_DENIED', $$select public.move_member_to_committee('b9000000-0000-4000-8000-000000000006',(select id from public.committees order by name,id offset 1 limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M09_INVITE_OFFICER_DENIED', $$select public.invite_new_officer('b9009000-0000-4000-8000-000000000009',null,'b9-profileless-officer@test.local','Forged','Co-Admin',(select id from public.committees order by name,id limit 1))$$, false, 'CCO01');
select pg_temp.step9_probe('M09_DELETE_ANONYMIZE_DENIED', $$delete from public.users where id='b9000000-0000-4000-8000-000000000006'$$, false, '42501');

-- Five stale-state cases.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step9_probe('STALE_TARGET_PROMOTED_TO_COADMIN', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000004')$$, false, 'CCM03');
select pg_temp.step9_probe('STALE_TARGET_MOVED_COMMITTEE', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000008')$$, false, 'CCM03');

reset role;
do $anonymized$
declare
  v_has_column boolean;
  v_denied boolean := false;
begin
  select exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.users'::regclass
      and attname = 'anonymized_at'
      and attnum > 0
      and not attisdropped
  ) into v_has_column;

  if not v_has_column then
    perform pg_temp.step9_record(
      'ANONYMIZED_CASE', true, 'SKIPPED (column absent)'
    );
    return;
  end if;

  begin
    execute $sql$update public.users set anonymized_at=now()
             where id='b9000000-0000-4000-8000-000000000007'$sql$;
  exception when others then
    perform pg_temp.step9_record('ANONYMIZED_CASE', false);
    return;
  end;

  begin
    perform public.reactivate_committee_member(
      'b9000000-0000-4000-8000-000000000007'
    );
  exception when others then
    v_denied := true;
  end;
  perform pg_temp.step9_record('ANONYMIZED_CASE', v_denied);
end $anonymized$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000c","role":"authenticated"}',true);
select pg_temp.step9_probe('STALE_CALLER_LOST_COADMIN_ROLE', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, false, 'CCM01');
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000a","role":"authenticated"}',true);
select pg_temp.step9_probe('STALE_CALLER_BECAME_INACTIVE', $$select public.deactivate_committee_member('b9000000-0000-4000-8000-000000000006')$$, false, 'CCM01');

-- Eleven reader/search/paging cases.
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.step9_query('READER_ADMIN_ACTIVE_SCOPE', $$select exists(select 1 from public.list_managed_users(true,null,0) where role='Admin')$$);
select pg_temp.step9_query('READER_ADMIN_DEACTIVATED_SCOPE', $$select exists(select 1 from public.list_managed_users(false,null,0) where id='b9000000-0000-4000-8000-00000000000b')$$);
select pg_temp.step9_query('READER_ADMIN_COMMITTEE_NAME_SEARCH', $$select exists(select 1 from public.list_managed_users(true,(select committee.name from public.committees as committee join public.users as profile on profile.committee_id=committee.id where profile.id='b9000000-0000-4000-8000-000000000008'),0) where id='b9000000-0000-4000-8000-000000000008')$$);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step9_query('READER_COADMIN_MEMBER_ONLY', $$select count(*)>0 and bool_and(role='Member' and committee_id=(select committee_id from public.users where id='b9000000-0000-4000-8000-000000000003')) from public.list_managed_users(true,null,0)$$);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
select pg_temp.step9_query('READER_NULL_COMMITTEE_EMPTY', $$select count(*)=0 from public.list_managed_users(true,null,0)$$);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000c","role":"authenticated"}',true);
select pg_temp.step9_query('READER_MEMBER_EMPTY', $$select count(*)=0 from public.list_managed_users(true,null,0)$$);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-00000000000d","role":"authenticated"}',true);
select pg_temp.step9_query('READER_PROFILELESS_EMPTY', $$select count(*)=0 from public.list_managed_users(true,null,0)$$);
select pg_catalog.set_config('request.jwt.claims','{"sub":"b9000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select pg_temp.step9_query('READER_FETCHES_21', $$select count(*)=21 from public.list_managed_users(true,null,0)$$);
select pg_temp.step9_query('READER_OFFSET_20_NO_OVERLAP', $$select not exists((select id from public.list_managed_users(true,null,0) limit 20) intersect (select id from public.list_managed_users(true,null,20) limit 20))$$);
select pg_temp.step9_query('READER_WHOLE_TAB_SEARCH', $$select count(*)=1 from public.list_managed_users(true,'Whole Tab Needle',0) where full_name='ZZZ Whole Tab Needle'$$);
select pg_temp.step9_query('READER_LITERAL_PERCENT_UNDERSCORE_BACKSLASH', $$select count(*)=1 from public.list_managed_users(true,E'%_\\',0) where full_name=E'ZZZ Literal %_\\ Match'$$);

-- Four explicit Member-invite identity checks.
select pg_temp.step9_probe('INVITE_FORGED_AUTH_UUID_DENIED', $$select public.finalize_member_invite('b900ffff-0000-4000-8000-000000000001','missing@test.local','Missing Auth',null)$$, false, 'CCM06');
select pg_temp.step9_probe('INVITE_MISMATCHED_AUTH_EMAIL_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-000000000010','wrong@test.local','Wrong Email',null)$$, false, 'CCM06');
select pg_temp.step9_probe('INVITE_EXISTING_PROFILE_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-000000000011','b9-existing@test.local','Duplicate',null)$$, false, 'CCM07');
select pg_temp.step9_probe('INVITE_OFFICER_RESERVATION_COLLISION_DENIED', $$select public.finalize_member_invite('b9000000-0000-4000-8000-000000000012','b9-officer-collision@test.local','Collision',null)$$, false, 'CCM07');

reset role;

-- Fifteen catalog and boundary checks. Catalog properties come from pg_catalog;
-- function bodies are not text-matched to infer security/search-path metadata.
do $$
declare
  v_ok boolean;
begin
  select count(*) = 5 into v_ok
  from pg_catalog.pg_proc
  where oid in (
    'public.list_managed_users(boolean,text,integer)'::regprocedure,
    'public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure,
    'public.deactivate_committee_member(uuid)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  );
  perform pg_temp.step9_record('CATALOG_FIVE_EXACT_FUNCTIONS', v_ok);

  select count(*) = 5 into v_ok
  from pg_catalog.pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in (
      'list_managed_users','finalize_member_invite',
      'deactivate_committee_member','reactivate_committee_member',
      'update_committee_member_full_name'
    );
  perform pg_temp.step9_record('CATALOG_NO_OVERLOADS', v_ok);

  select pg_catalog.bool_and(prosecdef) into v_ok
  from pg_catalog.pg_proc
  where oid in (
    'public.list_managed_users(boolean,text,integer)'::regprocedure,
    'public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure,
    'public.deactivate_committee_member(uuid)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  );
  perform pg_temp.step9_record('CATALOG_ALL_SECURITY_DEFINER', v_ok);

  select (select provolatile='s' from pg_catalog.pg_proc where oid='public.list_managed_users(boolean,text,integer)'::regprocedure)
    and (select pg_catalog.bool_and(provolatile='v') from pg_catalog.pg_proc where oid in (
      'public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure,
      'public.deactivate_committee_member(uuid)'::regprocedure,
      'public.reactivate_committee_member(uuid)'::regprocedure,
      'public.update_committee_member_full_name(uuid,text)'::regprocedure
    )) into v_ok;
  perform pg_temp.step9_record('CATALOG_EXACT_VOLATILITY', v_ok);

  select pg_catalog.bool_and(
    coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
  ) into v_ok
  from pg_catalog.pg_proc
  where oid in (
    'public.list_managed_users(boolean,text,integer)'::regprocedure,
    'public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure,
    'public.deactivate_committee_member(uuid)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  );
  perform pg_temp.step9_record('CATALOG_FIXED_EMPTY_SEARCH_PATHS', v_ok);

  select pg_catalog.bool_and(pg_catalog.pg_get_userbyid(proowner)='postgres') into v_ok
  from pg_catalog.pg_proc
  where oid in (
    'public.list_managed_users(boolean,text,integer)'::regprocedure,
    'public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure,
    'public.deactivate_committee_member(uuid)'::regprocedure,
    'public.reactivate_committee_member(uuid)'::regprocedure,
    'public.update_committee_member_full_name(uuid,text)'::regprocedure
  );
  perform pg_temp.step9_record('CATALOG_POSTGRES_OWNERS', v_ok);

  v_ok := has_function_privilege('authenticated','public.list_managed_users(boolean,text,integer)','EXECUTE')
    and has_function_privilege('authenticated','public.finalize_member_invite(uuid,text,text,uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.deactivate_committee_member(uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.reactivate_committee_member(uuid)','EXECUTE')
    and has_function_privilege('authenticated','public.update_committee_member_full_name(uuid,text)','EXECUTE');
  perform pg_temp.step9_record('GRANTS_AUTHENTICATED_EXECUTE', v_ok);

  select not exists (
    select 1
    from pg_catalog.pg_proc as function_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_row.proacl,
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) as privilege_row
    where function_row.oid in (
      'public.list_managed_users(boolean,text,integer)'::regprocedure,
      'public.finalize_member_invite(uuid,text,text,uuid)'::regprocedure,
      'public.deactivate_committee_member(uuid)'::regprocedure,
      'public.reactivate_committee_member(uuid)'::regprocedure,
      'public.update_committee_member_full_name(uuid,text)'::regprocedure
    )
      and privilege_row.grantee = 0
      and privilege_row.privilege_type = 'EXECUTE'
  ) into v_ok;
  perform pg_temp.step9_record('GRANTS_PUBLIC_REVOKED', v_ok);

  v_ok := not has_function_privilege('anon','public.list_managed_users(boolean,text,integer)','EXECUTE')
    and not has_function_privilege('anon','public.finalize_member_invite(uuid,text,text,uuid)','EXECUTE')
    and not has_function_privilege('anon','public.deactivate_committee_member(uuid)','EXECUTE')
    and not has_function_privilege('anon','public.reactivate_committee_member(uuid)','EXECUTE')
    and not has_function_privilege('anon','public.update_committee_member_full_name(uuid,text)','EXECUTE');
  perform pg_temp.step9_record('GRANTS_ANON_REVOKED', v_ok);

  v_ok := not has_table_privilege('authenticated','public.users','INSERT')
    and not has_table_privilege('authenticated','public.users','UPDATE')
    and not has_table_privilege('authenticated','public.users','DELETE');
  perform pg_temp.step9_record('USERS_DIRECT_WRITES_STILL_REVOKED', v_ok);

  select count(*)=0 into v_ok from pg_catalog.pg_policies
  where schemaname='public' and tablename='users'
    and policyname='co_admin_update_own_committee_members';
  perform pg_temp.step9_record('NO_BROAD_COADMIN_UPDATE_POLICY', v_ok);

  select count(*)=3 into v_ok from pg_catalog.pg_policies
  where schemaname='public' and tablename='users' and cmd='SELECT'
    and policyname in (
      'users_select_own_row','co_admin_view_own_committee_members',
      'admin_view_all_users'
    );
  perform pg_temp.step9_record('USERS_THREE_SELECT_POLICIES_PRESERVED', v_ok);

  select prosecdef and provolatile='v'
    and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']
  into v_ok from pg_catalog.pg_proc
  where oid='public.set_officer_active(uuid,boolean)'::regprocedure;
  perform pg_temp.step9_record('STEP8_SET_OFFICER_ACTIVE_UNCHANGED_CONTRACT', v_ok);

  select count(*)=1 into v_ok from pg_catalog.pg_trigger
  where tgrelid='public.users'::regclass
    and tgname='users_guard_officer_writes'
    and not tgisinternal;
  perform pg_temp.step9_record('STEP8_USERS_GUARD_STILL_ATTACHED_ONCE', v_ok);

  select count(*)=0 into v_ok
  from pg_catalog.pg_proc
  where pronamespace='public'::regnamespace
    and proname in (
      'list_managed_users','finalize_member_invite',
      'deactivate_committee_member','reactivate_committee_member',
      'update_committee_member_full_name'
    )
    and prosrc ~ 'CC[OBS][0-9][0-9]';
  perform pg_temp.step9_record('SQLSTATES_DO_NOT_COLLIDE_WITH_CCO_CCB_CCS', v_ok);
end $$;

do $$
declare
  v_count integer;
  v_results text;
begin
  select count(*), pg_catalog.string_agg(
    label || ': ' || outcome, E'\n' order by sequence
  )
  into v_count, v_results
  from step9_results;

  if v_count <> 116 then
    raise exception 'TEST DEFINITION ERROR: expected 116 lines, got %', v_count;
  end if;

  raise exception E'TEST RESULTS (116 lines)\n%', v_results;
end $$;

rollback;
```

## New SQLSTATEs

| Code | Meaning |
|---|---|
| `CCM01` | Caller is unavailable or lacks the required active Admin/Co-Admin authority. |
| `CCM02` | Request, reader input, UUID, or caller-supplied authority is invalid. |
| `CCM03` | Target is missing, is not a Member, or is outside the Co-Admin's current committee. |
| `CCM04` | Target active state is stale for the requested activate/deactivate operation. |
| `CCM05` | Full name fails the shared normalization and bounds contract. |
| `CCM06` | Auth invitation is absent, mismatched, confirmed, previously signed in, or not an invitation. |
| `CCM07` | A `public.users` profile or live officer invitation already exists for the Auth UUID or normalized email. |
| `CCM08` | Admin-selected Member committee is missing or invalid. |
| `CCM09` | A narrow write affected an unexpected number of rows. |

`CCM01`–`CCM09` do not collide with Step 8's `CCO01`–`CCO09`, backup's
`CCB01`–`CCB10`, or archive sharing's `CCS01`–`CCS07`.

## Route/component tests to run after the UI checkpoint

- Update `/api/users` tests for Admin and Co-Admin scopes, null-committee safe
  emptiness, malformed inputs, fixed response shape, and RPC failures.
- Update `/api/invite` tests for Admin committee validation, absence of a role
  payload, Co-Admin server-derived committee, forged authority, Auth/profile
  finalization failures, the existing `429 over_email_send_rate_limit` mapping,
  the fail-closed live-officer-invite email pre-check, and the Step 8 cleanup
  helper. Prove the pre-check never sends an Auth invite on a match or lookup
  error, and prove Auth deletion occurs only after a checked query finds no
  profile for that Auth UUID.
- Update `/api/toggle-user-active` tests for the three Member RPC boundaries,
  unchanged Admin avatar removal with checked Storage results, and proof that a
  Co-Admin path never bans/unbans Auth or reaches an officer operation.
- Add name-route, page-guard, navigation, desktop/phone action, paging/search,
  motion, and reduced-motion coverage described in `step-9.md`.

## Historical Dev reruns

After the new paste passes, rerun without changing historical expected counts:

1. `docs/phase-4b/step-0-tests.md`.
2. `docs/PHASE-4-STEP-1A-TESTS.md`.
3. `docs/PHASE-4-STEP-2-TESTS.md`.
4. `docs/PHASE-4-STEP-3-TESTS.md`.
5. `docs/PHASE-4-STEP-4-TESTS.md`.
6. `docs/PHASE-4-STEP-10-TESTS.md` where shared caller gates are covered.
7. `docs/phase-4b/step-7-tests.md` Users paging/search coverage.
8. All nine independent pastes in `docs/phase-4b/step-8-tests.md`, especially
   the officer writer, guard, grant, cap, and `set_officer_active` assertions.
9. The authoritative Phase 4B function/policy/grant inventory after adding only
   the five Step 9 functions.
